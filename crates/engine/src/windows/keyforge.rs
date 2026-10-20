//! Keyforge on Windows: applies [`InputProfile`]s through the low-level hooks.
//!
//! - A watcher thread follows the foreground app every 500 ms and activates the matching
//!   profile ([`resolve_active_profile`]); a `switchProfile` step can force one.
//! - The hook sink feeds physical events to the [`Remapper`] and swallows what it maps.
//!   AutoFlow's own output (marked with `INJECTED_MARKER`) is always ignored, so remaps can never
//!   loop; input injected by other software (on-screen keyboards, other remappers) is ignored too
//!   unless [`Keyforge::set_remap_foreign_injected`] opts in. The emergency stop combination
//!   always passes through.
//! - An executor thread injects outputs, runs repeats and expands text.
//! - Pointer settings of the active profile are applied for the session only (not persisted)
//!   and restored when the profile deactivates.

use super::hooks::{self, HookSink, RawEvent};
use super::keymap::{key_spec, KeySpec};
use super::{clipboard, input, process, shell};
use crate::engine::RunControl;
use crate::expr::{interpolate, system_now, ExprEnv, Vars};
use crate::input_profile::{
    find_conflicts, resolve_active_profile, InputProfile, MediaAction, MouseSettings, ProfileContext, WheelDirection,
};
use crate::remap::{ButtonAction, RemapAction, RemapInput, Remapper};
use crate::schema::{Hotkey, KeyAction, Modifier};
use crate::value::Value;
use ::windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, GetDoubleClickTime, SetDoubleClickTime, SwapMouseButton};
use ::windows::Win32::UI::WindowsAndMessaging::{
    SystemParametersInfoW, SPI_GETMOUSE, SPI_GETMOUSESPEED, SPI_GETWHEELSCROLLLINES, SPI_SETMOUSE, SPI_SETMOUSESPEED,
    SPI_SETWHEELSCROLLLINES, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS,
};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

const SINK: &str = "keyforge";

/// Host callbacks used by Keyforge.
pub trait KeyforgeHost: Send + Sync {
    /// The active profile changed (`None` = no profile).
    fn profile_activated(&self, profile_id: Option<&str>);
    /// A mapping asked to start a flow.
    fn start_flow(&self, flow_id: &str);
}

#[derive(Default)]
struct State {
    profiles: Vec<InputProfile>,
    enabled: bool,
    forced: Option<String>,
    active: Option<String>,
    remapper: Remapper,
    invert_wheel: bool,
    emergency: Option<Hotkey>,
    remap_foreign_injected: bool,
}

struct Shared {
    state: Mutex<State>,
    exec: Mutex<Option<mpsc::Sender<Exec>>>,
    started: Instant,
    host: Arc<dyn KeyforgeHost>,
    saved_mouse: Mutex<Option<SavedMouse>>,
}

impl Shared {
    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
    }
    fn send(&self, msg: Exec) {
        if let Some(tx) = self.exec.lock().unwrap_or_else(std::sync::PoisonError::into_inner).as_ref() {
            let _sent = tx.send(msg);
        }
    }
}

enum Exec {
    Actions(Vec<RemapAction>),
    Wheel(i32, bool),
    StopRepeats,
    Quit,
}

struct Sink(Arc<Shared>);

fn wheel_direction(horizontal: bool, delta: i32) -> WheelDirection {
    match (horizontal, delta > 0) {
        (false, true) => WheelDirection::Up,
        (false, false) => WheelDirection::Down,
        (true, true) => WheelDirection::Right,
        (true, false) => WheelDirection::Left,
    }
}

impl HookSink for Sink {
    fn on_event(&self, e: &RawEvent) -> bool {
        let (injected, ours) = match e {
            RawEvent::Key { injected, ours, .. } | RawEvent::Button { injected, ours, .. } | RawEvent::Wheel { injected, ours, .. } => {
                (*injected, *ours)
            }
        };
        if ours {
            return false;
        }
        let now = super::hooks::ms_since(self.0.started);
        let mut st = self.0.lock();
        if !st.enabled || st.active.is_none() || (injected && !st.remap_foreign_injected) {
            return false;
        }
        let input = match e {
            RawEvent::Key { key, text, down, modifiers, .. } => {
                // Never let a remap capture the emergency stop, even with extra modifiers held
                // (e.g. a Shift a flow left down).
                if let Some(h) = &st.emergency {
                    let k = crate::keys::canonical_key(key);
                    if *down && k == crate::keys::canonical_key(&h.key) && includes_all(modifiers, &h.modifiers) {
                        return false;
                    }
                }
                if *down {
                    RemapInput::KeyDown { key: key.clone(), text: text.clone(), modifiers: modifiers.clone() }
                } else {
                    RemapInput::KeyUp { key: key.clone() }
                }
            }
            RawEvent::Button { button, down, .. } => {
                if *down {
                    RemapInput::MouseDown { button: *button }
                } else {
                    RemapInput::MouseUp { button: *button }
                }
            }
            RawEvent::Wheel { horizontal, delta, .. } => {
                let d = st.remapper.handle(&RemapInput::Wheel { direction: wheel_direction(*horizontal, *delta) }, now);
                if d.swallow {
                    drop(st);
                    self.0.send(Exec::Actions(d.actions));
                    return true;
                }
                if st.invert_wheel {
                    drop(st);
                    self.0.send(Exec::Wheel(-*delta, *horizontal));
                    return true;
                }
                return false;
            }
        };
        let d = st.remapper.handle(&input, now);
        drop(st);
        if !d.actions.is_empty() {
            self.0.send(Exec::Actions(d.actions));
        }
        d.swallow
    }
}

/// True when every modifier of `wanted` is in `held` (extra held modifiers are ignored).
fn includes_all(held: &[Modifier], wanted: &[Modifier]) -> bool {
    wanted.iter().all(|m| held.contains(m))
}

/* --------------------------------------------------------------- executor */

fn media_key(a: MediaAction) -> KeySpec {
    let vk = match a {
        MediaAction::PlayPause => 0xB3,
        MediaAction::Next => 0xB0,
        MediaAction::Previous => 0xB1,
        MediaAction::VolumeUp => 0xAF,
        MediaAction::VolumeDown => 0xAE,
        MediaAction::Mute => 0xAD,
    };
    KeySpec { vk, extended: true, implied: [false; 3] }
}

fn physically_held(m: Modifier) -> bool {
    let vks: &[i32] = match m {
        Modifier::Ctrl => &[0x11],
        Modifier::Alt => &[0x12],
        Modifier::Shift => &[0x10],
        Modifier::Meta => &[0x5B, 0x5C],
    };
    // SAFETY: GetAsyncKeyState has no preconditions.
    vks.iter().any(|vk| {
        let state = unsafe { GetAsyncKeyState(*vk) };
        state < 0
    })
}

fn expand_template(template: &str) -> String {
    let mut vars = Vars::new();
    vars.insert("clipboard".into(), Value::Str(clipboard::get_text().unwrap_or_default()));
    let now = system_now;
    let random = crate::expr::default_random;
    interpolate(template, &ExprEnv { vars: &vars, now: &now, random: &random }, None).unwrap_or_else(|_| template.to_owned())
}

fn run_action(a: &RemapAction, host: &Arc<dyn KeyforgeHost>, control: &RunControl) {
    let r = match a {
        RemapAction::Key { key, modifiers, action, release } => {
            let restore: Vec<Modifier> = release.iter().copied().filter(|m| physically_held(*m)).collect();
            let _released = input::modifiers_transition(&restore, true);
            let r = match key_spec(key) {
                Some(spec) => match action {
                    KeyAction::Press => input::key_press(spec, modifiers),
                    KeyAction::Down => input::key_transition(spec, modifiers, false),
                    KeyAction::Up => input::key_transition(spec, modifiers, true),
                },
                None if *action != KeyAction::Up => input::type_text(key, 0, control),
                None => Ok(()),
            };
            if *action != KeyAction::Down {
                let still: Vec<Modifier> = restore.into_iter().filter(|m| physically_held(*m)).collect();
                let _restored = input::modifiers_transition(&still, false);
            }
            r
        }
        RemapAction::Mouse { button, action } => match action {
            ButtonAction::Down => input::button(*button, false),
            ButtonAction::Up => input::button(*button, true),
            ButtonAction::Click => input::button(*button, false).and_then(|()| input::button(*button, true)),
        },
        RemapAction::Text { text } => input::type_text(text, 0, control),
        RemapAction::Expand { backspaces, template } => {
            let bs = KeySpec { vk: 0x08, extended: false, implied: [false; 3] };
            let mut r = Ok(());
            for _ in 0..*backspaces {
                r = r.and_then(|()| input::key_press(bs, &[]));
            }
            r.and_then(|()| input::type_text(&expand_template(template), 0, control))
        }
        RemapAction::Launch { app } => shell::launch_app(app, &[]),
        RemapAction::Flow { flow_id } => {
            host.start_flow(flow_id);
            Ok(())
        }
        RemapAction::Media { action } => input::key_press(media_key(*action), &[]),
        RemapAction::StartRepeat { .. } | RemapAction::StopRepeat { .. } | RemapAction::LayersChanged { .. } => Ok(()),
    };
    // Remap failures (e.g. blocked by UIPI) must never disturb typing; they are dropped.
    let _ignored = r;
}

fn executor(rx: mpsc::Receiver<Exec>, host: Arc<dyn KeyforgeHost>) {
    let control = RunControl::new();
    let mut repeats: HashMap<String, (Instant, Duration, RemapAction)> = HashMap::new();
    loop {
        let timeout =
            repeats.values().map(|(due, _, _)| due.saturating_duration_since(Instant::now())).min().unwrap_or(Duration::from_secs(3600));
        match rx.recv_timeout(timeout) {
            Ok(Exec::Quit) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Ok(Exec::StopRepeats) => repeats.clear(),
            Ok(Exec::Wheel(delta, horizontal)) => {
                let _ignored = if horizontal { input::wheel(i64::from(delta), 0) } else { input::wheel(0, -i64::from(delta)) };
            }
            Ok(Exec::Actions(actions)) => {
                for a in actions {
                    match a {
                        RemapAction::StartRepeat { id, every_ms, output } => {
                            run_action(&output, &host, &control);
                            let every = Duration::from_millis(every_ms.max(10));
                            repeats.insert(id, (Instant::now() + every, every, *output));
                        }
                        RemapAction::StopRepeat { id } => {
                            repeats.remove(&id);
                        }
                        other => run_action(&other, &host, &control),
                    }
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
        let now = Instant::now();
        for (due, every, action) in repeats.values_mut() {
            if *due <= now {
                run_action(action, &host, &control);
                *due = now + *every;
            }
        }
    }
}

/* ------------------------------------------------------------ mouse settings */

#[derive(Debug, Clone, Copy)]
struct SavedMouse {
    speed: u32,
    wheel_lines: u32,
    double_click: u32,
    accel: [i32; 3],
    swapped: bool,
}

const NO_PERSIST: SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS = SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0);

fn read_mouse() -> SavedMouse {
    let mut speed = 10u32;
    let mut lines = 3u32;
    let mut accel = [6i32, 10, 1];
    // SAFETY: out-params sized for each SPI_GET* action.
    unsafe {
        let _a = SystemParametersInfoW(SPI_GETMOUSESPEED, 0, Some(std::ptr::addr_of_mut!(speed).cast()), NO_PERSIST);
        let _b = SystemParametersInfoW(SPI_GETWHEELSCROLLLINES, 0, Some(std::ptr::addr_of_mut!(lines).cast()), NO_PERSIST);
        let _c = SystemParametersInfoW(SPI_GETMOUSE, 0, Some(accel.as_mut_ptr().cast()), NO_PERSIST);
        // SwapMouseButton returns the previous state; call twice to read without changing it.
        let swapped = SwapMouseButton(true).as_bool();
        let _restore = SwapMouseButton(swapped);
        SavedMouse { speed, wheel_lines: lines, double_click: GetDoubleClickTime(), accel, swapped }
    }
}

fn write_mouse(
    speed: Option<u32>,
    lines: Option<u32>,
    double_click: Option<u32>,
    precision: Option<bool>,
    swap: Option<bool>,
    base: &SavedMouse,
) {
    // SAFETY: SPI_SET* values are passed by value in pvParam/uiParam as documented.
    unsafe {
        if let Some(s) = speed {
            let _r = SystemParametersInfoW(SPI_SETMOUSESPEED, 0, Some(s.clamp(1, 20) as usize as *mut _), NO_PERSIST);
        }
        if let Some(l) = lines {
            let _r = SystemParametersInfoW(SPI_SETWHEELSCROLLLINES, l.clamp(1, 100), None, NO_PERSIST);
        }
        if let Some(d) = double_click {
            let _r = SetDoubleClickTime(d.clamp(100, 900));
        }
        if let Some(p) = precision {
            let mut a = base.accel;
            a[2] = i32::from(p);
            let _r = SystemParametersInfoW(SPI_SETMOUSE, 0, Some(a.as_mut_ptr().cast()), NO_PERSIST);
        }
        if let Some(sw) = swap {
            let _prev = SwapMouseButton(sw);
        }
    }
}

fn apply_mouse(shared: &Shared, settings: Option<&MouseSettings>) {
    let mut saved = shared.saved_mouse.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    let wants = settings.is_some_and(|m| {
        m.pointer_speed.is_some()
            || m.wheel_lines.is_some()
            || m.double_click_ms.is_some()
            || m.enhance_precision.is_some()
            || m.swap_buttons.is_some()
    });
    if let Some(orig) = saved.take() {
        write_mouse(Some(orig.speed), Some(orig.wheel_lines), Some(orig.double_click), Some(orig.accel[2] != 0), Some(orig.swapped), &orig);
    }
    if let (true, Some(m)) = (wants, settings) {
        let orig = read_mouse();
        write_mouse(m.pointer_speed, m.wheel_lines, m.double_click_ms, m.enhance_precision, m.swap_buttons, &orig);
        *saved = Some(orig);
    }
}

/* ------------------------------------------------------------------ public */

/// Running Keyforge service.
pub struct Keyforge {
    shared: Arc<Shared>,
    stop: Arc<AtomicBool>,
    watcher: Option<JoinHandle<()>>,
    exec: Option<JoinHandle<()>>,
}

fn reevaluate(shared: &Shared) {
    let ctx = {
        let fg = process::foreground();
        ProfileContext { app: fg.as_ref().map(|f| f.0.clone()), window: fg.map(|f| f.1), device: None, date: None }
    };
    let mut st = shared.lock();
    let app = ctx.app.clone();
    st.remapper.set_app(app);
    let next = if !st.enabled {
        None
    } else if let Some(forced) = st.forced.clone().filter(|f| st.profiles.iter().any(|p| &p.id == f && p.enabled)) {
        st.profiles.iter().find(|p| p.id == forced).cloned()
    } else {
        resolve_active_profile(&st.profiles, &ctx).cloned()
    };
    let next_id = next.as_ref().map(|p| p.id.clone());
    if next_id == st.active {
        return;
    }
    let releases = st.remapper.set_profile(next.clone());
    st.invert_wheel = next.as_ref().is_some_and(|p| p.mouse.invert_wheel == Some(true));
    st.active.clone_from(&next_id);
    drop(st);
    if !releases.is_empty() {
        shared.send(Exec::Actions(releases));
    }
    apply_mouse(shared, next.as_ref().map(|p| &p.mouse));
    shared.host.profile_activated(next_id.as_deref());
}

impl Keyforge {
    /// Starts the watcher and executor threads (hooks are installed only while a profile is
    /// active).
    ///
    /// # Errors
    /// Fails when a thread cannot be created.
    pub fn start(host: Arc<dyn KeyforgeHost>) -> Result<Self, String> {
        let (tx, rx) = mpsc::channel();
        let shared = Arc::new(Shared {
            state: Mutex::new(State::default()),
            exec: Mutex::new(Some(tx)),
            started: Instant::now(),
            host: Arc::clone(&host),
            saved_mouse: Mutex::new(None),
        });
        let exec =
            std::thread::Builder::new().name("autoflow-keyforge".into()).spawn(move || executor(rx, host)).map_err(|e| e.to_string())?;
        let stop = Arc::new(AtomicBool::new(false));
        let (s2, stop2) = (Arc::clone(&shared), Arc::clone(&stop));
        let watcher = std::thread::Builder::new()
            .name("autoflow-keyforge-watch".into())
            .spawn(move || {
                let mut hooked = false;
                while !stop2.load(Ordering::SeqCst) {
                    reevaluate(&s2);
                    let want = s2.lock().active.is_some();
                    if want && !hooked {
                        hooked = hooks::add_sink(SINK, Arc::new(Sink(Arc::clone(&s2)))).is_ok();
                    } else if !want && hooked {
                        hooks::remove_sink(SINK);
                        hooked = false;
                    }
                    std::thread::sleep(Duration::from_millis(500));
                }
                if hooked {
                    hooks::remove_sink(SINK);
                }
            })
            .map_err(|e| e.to_string())?;
        Ok(Self { shared, stop, watcher: Some(watcher), exec: Some(exec) })
    }

    /// Replaces the profiles. Returns the active profile and conflict warnings.
    pub fn apply(
        &self,
        profiles: Vec<InputProfile>,
        enabled: bool,
        flow_hotkeys: &[(String, Hotkey)],
        emergency: Hotkey,
    ) -> (Option<String>, Vec<String>) {
        let mut warnings = Vec::new();
        for p in &profiles {
            for c in find_conflicts(p, flow_hotkeys) {
                let layer = c.layer_id.as_deref().map(|l| format!(" in layer {l}")).unwrap_or_default();
                warnings.push(format!("{}: {:?} {}{layer} ({})", p.name, c.kind, c.detail, c.mapping_ids.join(", ")));
            }
            if p.mouse.dpi_stages.is_some() || p.mouse.polling_rate_hz.is_some() {
                warnings.push(format!("{}: DPI stages and polling rate need the mouse vendor's software", p.name));
            }
        }
        {
            let mut st = self.shared.lock();
            st.profiles = profiles;
            st.enabled = enabled;
            st.emergency = Some(emergency);
            st.active = None;
            let releases = st.remapper.set_profile(None);
            drop(st);
            if !releases.is_empty() {
                self.shared.send(Exec::Actions(releases));
            }
        }
        reevaluate(&self.shared);
        (self.shared.lock().active.clone(), warnings)
    }

    /// Forces a profile (`switchProfile` step); `None` returns to automatic selection.
    pub fn force(&self, profile_id: Option<String>) -> Result<(), String> {
        {
            let mut st = self.shared.lock();
            if let Some(id) = &profile_id {
                if !st.profiles.iter().any(|p| &p.id == id) {
                    return Err(format!("profile \"{id}\" is not installed on this PC"));
                }
            }
            st.forced = profile_id;
        }
        reevaluate(&self.shared);
        Ok(())
    }

    /// Stops every auto-repeat and releases whatever the active profile holds down (Halt). The
    /// profile stays active; its mappings start fresh.
    pub fn stop_repeats(&self) {
        let releases = {
            let mut st = self.shared.lock();
            let current = st.active.as_ref().and_then(|id| st.profiles.iter().find(|p| &p.id == id).cloned());
            st.remapper.set_profile(current)
        };
        self.shared.send(Exec::StopRepeats);
        if !releases.is_empty() {
            self.shared.send(Exec::Actions(releases));
        }
    }

    /// Also remap input injected by other software (on-screen keyboards, other tools). Off by
    /// default to avoid ping-pong loops with other remappers; AutoFlow's own output is never
    /// remapped either way.
    pub fn set_remap_foreign_injected(&self, on: bool) {
        self.shared.lock().remap_foreign_injected = on;
    }

    /// Currently active profile id.
    pub fn active(&self) -> Option<String> {
        self.shared.lock().active.clone()
    }
}

impl Drop for Keyforge {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(w) = self.watcher.take() {
            let _joined = w.join();
        }
        apply_mouse(&self.shared, None);
        self.shared.send(Exec::Quit);
        if let Some(e) = self.exec.take() {
            let _joined = e.join();
        }
    }
}
