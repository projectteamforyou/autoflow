//! Mock backend — the Rust counterpart of `SandboxBackend` (`packages/core/src/sandbox.ts`).
//!
//! Runs any flow against a virtual screen. Used by the test-suite and by desktop dry runs:
//! nothing touches the real mouse, keyboard, clipboard, network or file system. Optional
//! emulated monitors and scripted probe answers (pixels, scene hashes) drive multi-monitor tests.

use crate::display::DisplayInfo;
use crate::engine::{BackendError, Clock, InputAction, InputBackend, RunControl, ScreenInfo};
use crate::expr::default_random;
use crate::schema::{FileOp, Pick, Platform, Space, Target};
use crate::value::{js_round, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};

/// One recorded action.
#[derive(Debug, Clone, PartialEq)]
pub struct MockEffect {
    /// Clock time of the action.
    pub at: u64,
    /// The action.
    pub action: InputAction,
    /// Resolved pixel positions on the virtual screen.
    pub points: Vec<(i64, i64)>,
}

/// Observable state of a [`MockBackend`].
#[derive(Debug, Default)]
pub struct MockState {
    /// Every performed action (capped at 5000, oldest dropped).
    pub effects: Vec<MockEffect>,
    /// Virtual clipboard.
    pub clipboard: String,
    /// Virtual pointer.
    pub pointer: (i64, i64),
    /// Text typed by `type` actions.
    pub typed: Vec<String>,
    /// Virtual files.
    pub files: HashMap<String, String>,
    /// Shown notifications (title, body).
    pub notifications: Vec<(String, String)>,
    /// Questions asked by confirm steps.
    pub confirms: Vec<String>,
    /// Probes in call order: `[x, y]` pixels and `[x, y, w, h]` scene regions.
    pub probes: Vec<Vec<f64>>,
}

/// Shared view of a mock backend's state; stays valid after the backend moved into a run.
#[derive(Debug, Clone, Default)]
pub struct MockHandle(Arc<Mutex<MockState>>);

impl MockHandle {
    /// Locks the state.
    pub fn lock(&self) -> MutexGuard<'_, MockState> {
        self.0.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
    }
    /// Number of effects of a given action type.
    pub fn count(&self, action_type: &str) -> usize {
        self.lock().effects.iter().filter(|e| e.action.type_name() == action_type).count()
    }
}

type Hook = Box<dyn FnMut(&InputAction) -> Option<Result<Value, BackendError>> + Send>;
type ConfirmFn = Box<dyn FnMut(&str) -> bool + Send>;

/// Virtual-screen backend.
pub struct MockBackend {
    platform: Platform,
    screen: ScreenInfo,
    state: MockHandle,
    clock: Option<Arc<dyn Clock>>,
    confirm: Option<ConfirmFn>,
    hook: Option<Hook>,
    report_screen: bool,
    displays: Option<Vec<DisplayInfo>>,
    pixels: HashMap<String, Vec<String>>,
    scene_hashes: HashMap<String, Vec<String>>,
}

/// Next scripted answer: each call takes the next value, the last one repeats.
fn next_answer(map: &mut HashMap<String, Vec<String>>, key: &str, fallback: &str) -> String {
    match map.get_mut(key) {
        Some(seq) if seq.len() > 1 => seq.remove(0),
        Some(seq) => seq.first().cloned().unwrap_or_else(|| fallback.to_owned()),
        None => fallback.to_owned(),
    }
}

fn num_key(v: f64) -> String {
    crate::value::js_number_to_string(v)
}

impl MockBackend {
    /// A 1280×800@1 virtual screen on `platform`.
    pub fn new(platform: Platform) -> Self {
        let screen = ScreenInfo { width: 1280, height: 800, scale: 1.0 };
        let state = MockHandle::default();
        state.lock().pointer = (i64::from(screen.width / 2), i64::from(screen.height / 2));
        Self {
            platform,
            screen,
            state,
            clock: None,
            confirm: None,
            hook: None,
            report_screen: true,
            displays: None,
            pixels: HashMap::new(),
            scene_hashes: HashMap::new(),
        }
    }

    /// Emulates these monitors (reported in this order).
    #[must_use]
    pub fn with_displays(mut self, displays: Vec<DisplayInfo>) -> Self {
        self.displays = Some(displays);
        self
    }

    /// Scripted pixel colors keyed `"x,y"` (each probe takes the next; the last repeats; default `#000000`).
    #[must_use]
    pub fn with_pixels(mut self, pixels: HashMap<String, Vec<String>>) -> Self {
        self.pixels = pixels;
        self
    }

    /// Scripted scene hashes keyed `"x,y,w,h"` (default `0000000000000000`).
    #[must_use]
    pub fn with_scene_hashes(mut self, hashes: HashMap<String, Vec<String>>) -> Self {
        self.scene_hashes = hashes;
        self
    }

    /// Uses a different virtual screen.
    #[must_use]
    pub fn with_screen(mut self, screen: ScreenInfo) -> Self {
        self.screen = screen;
        self.state.lock().pointer = (i64::from(screen.width / 2), i64::from(screen.height / 2));
        self
    }

    /// Does not report a live screen (skips the screen-change check).
    #[must_use]
    pub fn without_screen(mut self) -> Self {
        self.report_screen = false;
        self
    }

    /// Timestamps effects with this clock.
    #[must_use]
    pub fn with_clock(mut self, clock: Arc<dyn Clock>) -> Self {
        self.clock = Some(clock);
        self
    }

    /// Answers confirm steps (default: yes).
    #[must_use]
    pub fn with_confirm(mut self, f: impl FnMut(&str) -> bool + Send + 'static) -> Self {
        self.confirm = Some(Box::new(f));
        self
    }

    /// Intercepts actions; returning `Some` short-circuits the action (e.g. to inject failures).
    #[must_use]
    pub fn with_hook(mut self, f: impl FnMut(&InputAction) -> Option<Result<Value, BackendError>> + Send + 'static) -> Self {
        self.hook = Some(Box::new(f));
        self
    }

    /// Handle to inspect effects after the run.
    pub fn handle(&self) -> MockHandle {
        self.state.clone()
    }

    #[allow(clippy::cast_possible_truncation)]
    fn resolve(&self, t: &Target, pointer: (i64, i64)) -> (i64, i64) {
        let w = f64::from(self.screen.width);
        let h = f64::from(self.screen.height);
        let r = |v: f64| js_round(v) as i64;
        match t {
            Target::Point { x, y, space, .. } => {
                if *space == Space::Normalized {
                    (r(x * w), r(y * h))
                } else {
                    (r(*x), r(*y))
                }
            }
            Target::Region { x, y, w: rw, h: rh, space, pick, .. } => {
                let (sx, sy) = if *space == Space::Normalized { (w, h) } else { (1.0, 1.0) };
                let (x, y, rw, rh) = (x * sx, y * sy, rw * sx, rh * sy);
                if *pick == Pick::Random {
                    (r(x + default_random() * rw), r(y + default_random() * rh))
                } else {
                    (r(x + rw / 2.0), r(y + rh / 2.0))
                }
            }
            Target::Current => pointer,
            Target::Element { .. } | Target::Image(_) => (r(w / 2.0), r(h / 2.0)),
        }
    }
}

impl InputBackend for MockBackend {
    fn platform(&self) -> Platform {
        self.platform
    }

    fn screen(&mut self) -> Option<ScreenInfo> {
        self.report_screen.then_some(self.screen)
    }

    fn displays(&mut self) -> Vec<DisplayInfo> {
        match &self.displays {
            Some(d) => d.clone(),
            None => {
                let s = self.screen;
                let bounds = crate::schema::Rect { x: 0.0, y: 0.0, w: f64::from(s.width), h: f64::from(s.height) };
                vec![DisplayInfo::new("mock-1", true, bounds, s.scale)]
            }
        }
    }

    #[allow(clippy::cast_precision_loss)]
    fn pointer_position(&mut self) -> Option<(f64, f64)> {
        let (x, y) = self.state.lock().pointer;
        Some((x as f64, y as f64))
    }

    fn perform(&mut self, action: &InputAction, control: &RunControl) -> Result<Value, BackendError> {
        if control.is_stopped() {
            return Err(BackendError::aborted());
        }
        if let Some(hook) = self.hook.as_mut() {
            if let Some(res) = hook(action) {
                return res;
            }
        }
        let pointer = self.state.lock().pointer;
        let mut points = Vec::new();
        let mut result = Value::Null;
        {
            let mut st = self.state.lock();
            match action {
                InputAction::Click { target, .. } | InputAction::Move { target, .. } => {
                    let p = self.resolve(target, pointer);
                    points.push(p);
                    st.pointer = p;
                }
                InputAction::Drag { from, to, .. } => {
                    let a = self.resolve(from, pointer);
                    let b = self.resolve(to, pointer);
                    points.extend([a, b]);
                    st.pointer = b;
                }
                InputAction::Scroll { target: Some(t), .. } => {
                    let p = self.resolve(t, pointer);
                    points.push(p);
                    st.pointer = p;
                }
                InputAction::Pixel { x, y } => {
                    st.probes.push(vec![*x, *y]);
                    result = Value::Str(next_answer(&mut self.pixels, &format!("{},{}", num_key(*x), num_key(*y)), "#000000"));
                }
                InputAction::SceneHash { region: r } => {
                    st.probes.push(vec![r.x, r.y, r.w, r.h]);
                    let key = format!("{},{},{},{}", num_key(r.x), num_key(r.y), num_key(r.w), num_key(r.h));
                    result = Value::Str(next_answer(&mut self.scene_hashes, &key, "0000000000000000"));
                }
                InputAction::Type { text, .. } => st.typed.push(text.clone()),
                InputAction::ClipboardSet { value } => st.clipboard.clone_from(value),
                InputAction::ClipboardGet => result = Value::Str(st.clipboard.clone()),
                InputAction::Notify { title, body } => st.notifications.push((title.clone(), body.clone())),
                InputAction::Http { method, url, .. } => result = Value::Str(format!("simulated {} {url}", method.as_str())),
                InputAction::File { op, path, content, .. } => match op {
                    FileOp::Write => {
                        st.files.insert(path.clone(), content.clone().unwrap_or_default());
                    }
                    FileOp::Append => {
                        let prev = st.files.get(path).cloned().unwrap_or_default();
                        st.files.insert(path.clone(), prev + content.as_deref().unwrap_or(""));
                    }
                    FileOp::Read => result = Value::Str(st.files.get(path).cloned().unwrap_or_default()),
                    FileOp::Exists => result = Value::Bool(st.files.contains_key(path)),
                    FileOp::Delete => {
                        st.files.remove(path);
                    }
                    FileOp::Copy | FileOp::Move => {}
                },
                InputAction::Ocr { .. } => result = Value::Str(String::new()),
                _ => {}
            }
            let at = self.clock.as_ref().map_or_else(|| crate::engine::Clock::now(&crate::engine::RealClock), |c| c.now());
            st.effects.push(MockEffect { at, action: action.clone(), points });
            if st.effects.len() > 5000 {
                let excess = st.effects.len() - 5000;
                st.effects.drain(..excess);
            }
        }
        Ok(result)
    }

    fn confirm(&mut self, message: &str, control: &RunControl) -> Result<bool, BackendError> {
        if control.is_stopped() {
            return Err(BackendError::aborted());
        }
        self.state.lock().confirms.push(message.to_owned());
        Ok(self.confirm.as_mut().map_or(true, |f| f(message)))
    }
}
