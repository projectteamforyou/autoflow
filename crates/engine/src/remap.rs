//! Keyforge runtime: a platform-independent remapping state machine.
//!
//! The Windows low-level hooks translate each physical event into a [`RemapInput`] and ask
//! [`Remapper::handle`] what to do. The answer says whether to swallow the original event and
//! which [`RemapAction`]s to inject instead. Keeping the logic here makes it unit-testable on
//! every OS; the platform layer only translates and injects (and must ignore its own injected
//! events to avoid loops).
//!
//! Semantics:
//! - Layers: `layers[0]` is always active; `layer` outputs push a layer while the source is
//!   held (`hold`) or flip it on/off (`toggle`). Held layers win over toggled ones, which win
//!   over the base layer; within a layer the first enabled mapping wins.
//! - Key/mouse outputs mirror the source: source down → output down, source up → output up,
//!   so held keys behave naturally. Modifiers physically held for the source but not part of
//!   the output are released around the injected key (`release`).
//! - `repeat: whileHeld` repeats the output every `repeatMs` while the source is held;
//!   `toggle` starts/stops repeating on each press.
//! - Mouse gestures: `single`, `double` (second press within 400 ms) and `hold` (≥ 450 ms; a
//!   shorter press is replayed as a normal click).
//! - Text expansion: typed characters are buffered; when the buffer ends with an abbreviation
//!   (and the foreground app matches), the final key is swallowed and the platform deletes the
//!   rest of the abbreviation with Backspace before typing the expansion.

use crate::input_profile::{Gesture, InputOutput, InputProfile, InputSource, LayerMode, Mapping, MediaAction, RepeatMode, WheelDirection};
use crate::keys::{canonical_key, is_modifier};
use crate::schema::{KeyAction, Modifier, MouseButton};
use std::collections::HashMap;

/// A press shorter than this is a click, longer is a `hold` gesture.
pub const HOLD_MS: u64 = 450;
/// Max gap between two presses of a `double` gesture.
pub const DOUBLE_MS: u64 = 400;
const BUFFER_MAX: usize = 64;

/// Physical input as seen by the platform hook.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RemapInput {
    /// Key pressed (including OS auto-repeat).
    KeyDown {
        /// W3C key name of the physical key (any spelling; canonicalized internally).
        key: String,
        /// Character the key produces with the current keyboard state, if any.
        text: Option<String>,
        /// Modifiers currently held (excluding the key itself).
        modifiers: Vec<Modifier>,
    },
    /// Key released.
    KeyUp {
        /// W3C key name.
        key: String,
    },
    /// Mouse button pressed.
    MouseDown {
        /// Button.
        button: MouseButton,
    },
    /// Mouse button released.
    MouseUp {
        /// Button.
        button: MouseButton,
    },
    /// Wheel notch.
    Wheel {
        /// Direction.
        direction: WheelDirection,
    },
}

/// Mouse button action to inject.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ButtonAction {
    /// Press.
    Down,
    /// Release.
    Up,
    /// Press + release.
    Click,
}

/// Something the platform must inject or perform.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RemapAction {
    /// Inject a key event.
    Key {
        /// W3C key name.
        key: String,
        /// Modifiers to hold around the key.
        modifiers: Vec<Modifier>,
        /// Press / down / up.
        action: KeyAction,
        /// Physically held modifiers to release first (and restore after).
        release: Vec<Modifier>,
    },
    /// Inject a mouse button event.
    Mouse {
        /// Button.
        button: MouseButton,
        /// Action.
        action: ButtonAction,
    },
    /// Type literal text.
    Text {
        /// Text.
        text: String,
    },
    /// Delete `backspaces` characters, then type the interpolated `template`.
    Expand {
        /// Characters of the abbreviation already typed.
        backspaces: usize,
        /// Expansion template (`{{date()}}`, `{{time()}}`, `{{clipboard}}`).
        template: String,
    },
    /// Launch an app.
    Launch {
        /// Path / AUMID.
        app: String,
    },
    /// Start a flow.
    Flow {
        /// Flow id.
        flow_id: String,
    },
    /// Media key.
    Media {
        /// Action.
        action: MediaAction,
    },
    /// Start repeating `output` every `every_ms` until [`RemapAction::StopRepeat`].
    StartRepeat {
        /// Repeat id (mapping id).
        id: String,
        /// Interval.
        every_ms: u64,
        /// Output to repeat (press-style).
        output: Box<RemapAction>,
    },
    /// Stop a repeat.
    StopRepeat {
        /// Repeat id.
        id: String,
    },
    /// The active layer stack changed (informational).
    LayersChanged {
        /// Active layer ids, top first.
        active: Vec<String>,
    },
}

/// What to do with one physical event.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Decision {
    /// Suppress the original event.
    pub swallow: bool,
    /// Actions to perform, in order.
    pub actions: Vec<RemapAction>,
}

impl Decision {
    fn pass() -> Self {
        Self::default()
    }
    fn swallow(actions: Vec<RemapAction>) -> Self {
        Self { swallow: true, actions }
    }
}

#[derive(Debug, Clone)]
struct Pressed {
    on_release: Vec<RemapAction>,
    /// Re-sent while the OS auto-repeats the source key.
    on_autorepeat: Vec<RemapAction>,
    held_layer: bool,
}

#[derive(Debug, Clone)]
struct PendingHold {
    down_at: u64,
    hold: Mapping,
    single: Option<Mapping>,
}

/// Keyforge state machine for one active profile.
#[derive(Debug, Default)]
pub struct Remapper {
    profile: Option<InputProfile>,
    held_layers: Vec<(String, String)>,
    toggled_layers: Vec<String>,
    pressed: HashMap<String, Pressed>,
    toggled_repeats: Vec<String>,
    active_repeats: Vec<String>,
    buffer: String,
    app: Option<String>,
    pending_hold: HashMap<MouseButton, PendingHold>,
    last_up: HashMap<MouseButton, u64>,
}

fn same_mods(a: &[Modifier], b: &[Modifier]) -> bool {
    let mut x = a.to_vec();
    let mut y = b.to_vec();
    x.sort();
    x.dedup();
    y.sort();
    y.dedup();
    x == y
}

fn press_style(out: &InputOutput, release: &[Modifier]) -> Option<RemapAction> {
    Some(match out {
        InputOutput::Key { key, modifiers } => {
            RemapAction::Key { key: key.clone(), modifiers: modifiers.clone(), action: KeyAction::Press, release: release.to_vec() }
        }
        InputOutput::Mouse { button } => RemapAction::Mouse { button: *button, action: ButtonAction::Click },
        InputOutput::Text { text } => RemapAction::Text { text: text.clone() },
        InputOutput::Launch { app } => RemapAction::Launch { app: app.clone() },
        InputOutput::Flow { flow_id } => RemapAction::Flow { flow_id: flow_id.clone() },
        InputOutput::Media { action } => RemapAction::Media { action: *action },
        InputOutput::Layer { .. } | InputOutput::Disabled => return None,
    })
}

impl Remapper {
    /// An idle remapper (no profile: everything passes through).
    pub fn new() -> Self {
        Self::default()
    }

    /// Active profile id.
    pub fn profile_id(&self) -> Option<&str> {
        self.profile.as_ref().map(|p| p.id.as_str())
    }

    /// Switches profile. Returns actions that release whatever the old profile still held.
    pub fn set_profile(&mut self, profile: Option<InputProfile>) -> Vec<RemapAction> {
        let mut out = Vec::new();
        for (_, p) in self.pressed.drain() {
            out.extend(p.on_release.into_iter().filter(|a| !matches!(a, RemapAction::LayersChanged { .. })));
        }
        for id in self.active_repeats.drain(..) {
            out.push(RemapAction::StopRepeat { id });
        }
        self.toggled_repeats.clear();
        self.held_layers.clear();
        self.toggled_layers.clear();
        self.buffer.clear();
        self.pending_hold.clear();
        self.profile = profile.filter(|p| p.enabled);
        out
    }

    /// Updates the foreground app (process name) used by app-restricted text expansions.
    pub fn set_app(&mut self, app: Option<String>) {
        if self.app != app {
            self.buffer.clear();
        }
        self.app = app;
    }

    /// Active layer ids, top first (base layer last).
    pub fn active_layers(&self) -> Vec<String> {
        let Some(p) = &self.profile else { return Vec::new() };
        let mut out: Vec<String> = self.held_layers.iter().rev().map(|(_, l)| l.clone()).collect();
        out.extend(self.toggled_layers.iter().rev().cloned());
        if let Some(base) = p.layers.first() {
            out.push(base.id.clone());
        }
        let mut seen = Vec::new();
        out.retain(|l| {
            let fresh = !seen.contains(l);
            seen.push(l.clone());
            fresh
        });
        out
    }

    fn find(&self, pred: impl Fn(&InputSource) -> bool) -> Option<Mapping> {
        let p = self.profile.as_ref()?;
        for layer_id in self.active_layers() {
            let Some(layer) = p.layers.iter().find(|l| l.id == layer_id) else { continue };
            if let Some(m) = layer.mappings.iter().find(|m| m.enabled && pred(&m.from)) {
                return Some(m.clone());
            }
        }
        None
    }

    /// Decides what to do with one physical event at time `now_ms`.
    pub fn handle(&mut self, input: &RemapInput, now_ms: u64) -> Decision {
        if self.profile.is_none() {
            return Decision::pass();
        }
        match input {
            RemapInput::KeyDown { key, text, modifiers } => self.key_down(key, text.as_deref(), modifiers),
            RemapInput::KeyUp { key } => self.key_up(key),
            RemapInput::MouseDown { button } => self.mouse_down(*button, now_ms),
            RemapInput::MouseUp { button } => self.mouse_up(*button, now_ms),
            RemapInput::Wheel { direction } => self.wheel(*direction),
        }
    }

    fn start_mapping(&mut self, src: String, m: &Mapping, held_mods: &[Modifier]) -> Decision {
        let release: Vec<Modifier> = match &m.to {
            InputOutput::Key { modifiers, .. } => held_mods.iter().copied().filter(|h| !modifiers.contains(h)).collect(),
            _ => Vec::new(),
        };
        let mut actions = Vec::new();
        let mut pressed = Pressed { on_release: Vec::new(), on_autorepeat: Vec::new(), held_layer: false };
        match &m.to {
            InputOutput::Layer { layer_id, mode: LayerMode::Hold } => {
                self.held_layers.push((src.clone(), layer_id.clone()));
                pressed.held_layer = true;
                actions.push(RemapAction::LayersChanged { active: self.active_layers() });
            }
            InputOutput::Layer { layer_id, mode: LayerMode::Toggle } => {
                if let Some(i) = self.toggled_layers.iter().position(|l| l == layer_id) {
                    self.toggled_layers.remove(i);
                } else {
                    self.toggled_layers.push(layer_id.clone());
                }
                actions.push(RemapAction::LayersChanged { active: self.active_layers() });
            }
            InputOutput::Disabled => {}
            out => match m.repeat {
                RepeatMode::WhileHeld => {
                    if let Some(o) = press_style(out, &release) {
                        actions.push(RemapAction::StartRepeat { id: m.id.clone(), every_ms: m.repeat_ms, output: Box::new(o) });
                        self.active_repeats.push(m.id.clone());
                        pressed.on_release.push(RemapAction::StopRepeat { id: m.id.clone() });
                    }
                }
                RepeatMode::Toggle => {
                    if let Some(i) = self.toggled_repeats.iter().position(|r| r == &m.id) {
                        self.toggled_repeats.remove(i);
                        self.active_repeats.retain(|r| r != &m.id);
                        actions.push(RemapAction::StopRepeat { id: m.id.clone() });
                    } else if let Some(o) = press_style(out, &release) {
                        self.toggled_repeats.push(m.id.clone());
                        self.active_repeats.push(m.id.clone());
                        actions.push(RemapAction::StartRepeat { id: m.id.clone(), every_ms: m.repeat_ms, output: Box::new(o) });
                    }
                }
                RepeatMode::None => match out {
                    InputOutput::Key { key, modifiers } => {
                        let down = RemapAction::Key {
                            key: key.clone(),
                            modifiers: modifiers.clone(),
                            action: KeyAction::Down,
                            release: release.clone(),
                        };
                        actions.push(down.clone());
                        pressed.on_autorepeat.push(down);
                        pressed.on_release.push(RemapAction::Key {
                            key: key.clone(),
                            modifiers: modifiers.clone(),
                            action: KeyAction::Up,
                            release,
                        });
                    }
                    InputOutput::Mouse { button } => {
                        actions.push(RemapAction::Mouse { button: *button, action: ButtonAction::Down });
                        pressed.on_release.push(RemapAction::Mouse { button: *button, action: ButtonAction::Up });
                    }
                    other => actions.extend(press_style(other, &release)),
                },
            },
        }
        self.pressed.insert(src, pressed);
        self.buffer.clear();
        Decision::swallow(actions)
    }

    fn release(&mut self, src: &str) -> Option<Decision> {
        let p = self.pressed.remove(src)?;
        let mut actions = p.on_release;
        for a in &actions {
            if let RemapAction::StopRepeat { id } = a {
                self.active_repeats.retain(|r| r != id);
            }
        }
        if p.held_layer {
            self.held_layers.retain(|(s, _)| s != src);
            actions.push(RemapAction::LayersChanged { active: self.active_layers() });
        }
        Some(Decision::swallow(actions))
    }

    fn key_down(&mut self, key: &str, text: Option<&str>, modifiers: &[Modifier]) -> Decision {
        let Some(key) = canonical_key(key) else { return Decision::pass() };
        let src = format!("key:{key}");
        if let Some(p) = self.pressed.get(&src) {
            // OS auto-repeat of a mapped key: repeat the mapped output's key-down only.
            return Decision::swallow(p.on_autorepeat.clone());
        }
        let found = self.find(|s| match s {
            InputSource::Key { key: k, modifiers: m } => canonical_key(k).as_deref() == Some(key.as_str()) && same_mods(m, modifiers),
            _ => false,
        });
        if let Some(m) = found {
            return self.start_mapping(src, &m, modifiers);
        }
        self.track_text(&key, text, modifiers)
    }

    fn track_text(&mut self, key: &str, text: Option<&str>, modifiers: &[Modifier]) -> Decision {
        if is_modifier(key) {
            return Decision::pass();
        }
        if key == "Backspace" {
            self.buffer.pop();
            return Decision::pass();
        }
        let chord = modifiers.iter().any(|m| *m != Modifier::Shift);
        let Some(ch) = text.filter(|t| !chord && t.chars().count() == 1 && !t.chars().any(char::is_control)) else {
            self.buffer.clear();
            return Decision::pass();
        };
        self.buffer.push_str(ch);
        if self.buffer.chars().count() > BUFFER_MAX {
            let drop = self.buffer.chars().next().map_or(0, char::len_utf8);
            self.buffer.drain(..drop);
        }
        let Some(p) = &self.profile else { return Decision::pass() };
        let app = self.app.as_deref().map(str::to_lowercase);
        let hit = p.text_expansions.iter().find(|t| {
            let app_ok = t.apps.is_empty() || app.as_ref().is_some_and(|a| t.apps.iter().any(|x| x.to_lowercase() == *a));
            app_ok && self.buffer.ends_with(&t.abbreviation)
        });
        if let Some(t) = hit {
            let action = RemapAction::Expand { backspaces: t.abbreviation.chars().count().saturating_sub(1), template: t.text.clone() };
            self.buffer.clear();
            // The final key of the abbreviation is swallowed; its key-up passes harmlessly.
            return Decision::swallow(vec![action]);
        }
        Decision::pass()
    }

    fn key_up(&mut self, key: &str) -> Decision {
        let Some(key) = canonical_key(key) else { return Decision::pass() };
        self.release(&format!("key:{key}")).unwrap_or_else(Decision::pass)
    }

    fn mouse_mapping(&self, button: MouseButton, gesture: Gesture) -> Option<Mapping> {
        self.find(|s| matches!(s, InputSource::Mouse { button: b, gesture: g } if *b == button && *g == gesture))
    }

    fn mouse_down(&mut self, button: MouseButton, now: u64) -> Decision {
        self.buffer.clear();
        let src = format!("mouse:{}", button.as_str());
        if let Some(hold) = self.mouse_mapping(button, Gesture::Hold) {
            let single = self.mouse_mapping(button, Gesture::Single);
            self.pending_hold.insert(button, PendingHold { down_at: now, hold, single });
            return Decision::swallow(Vec::new());
        }
        if let Some(double) = self.mouse_mapping(button, Gesture::Double) {
            if self.last_up.get(&button).is_some_and(|t| now.saturating_sub(*t) <= DOUBLE_MS) {
                self.last_up.remove(&button);
                return self.start_mapping(src, &double, &[]);
            }
        }
        if let Some(single) = self.mouse_mapping(button, Gesture::Single) {
            return self.start_mapping(src, &single, &[]);
        }
        Decision::pass()
    }

    fn mouse_up(&mut self, button: MouseButton, now: u64) -> Decision {
        if let Some(pending) = self.pending_hold.remove(&button) {
            let chosen = if now.saturating_sub(pending.down_at) >= HOLD_MS { Some(pending.hold) } else { pending.single };
            let actions = match chosen {
                Some(m) => press_style(&m.to, &[]).into_iter().collect(),
                None => vec![RemapAction::Mouse { button, action: ButtonAction::Click }],
            };
            return Decision::swallow(actions);
        }
        let src = format!("mouse:{}", button.as_str());
        if let Some(d) = self.release(&src) {
            return d;
        }
        self.last_up.insert(button, now);
        Decision::pass()
    }

    fn wheel(&mut self, direction: WheelDirection) -> Decision {
        let Some(m) = self.find(|s| matches!(s, InputSource::Wheel { direction: d } if *d == direction)) else { return Decision::pass() };
        Decision::swallow(press_style(&m.to, &[]).into_iter().collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::input_profile::{Layer, MouseSettings, TextExpansion};

    fn mapping(id: &str, from: InputSource, to: InputOutput, repeat: RepeatMode) -> Mapping {
        Mapping { id: id.into(), from, to, repeat, repeat_ms: 50, enabled: true }
    }
    fn key(k: &str) -> InputSource {
        InputSource::Key { key: k.into(), modifiers: vec![] }
    }
    fn profile(layers: Vec<Layer>, text: Vec<TextExpansion>) -> InputProfile {
        InputProfile {
            schema_version: "1.0".into(),
            id: "p".into(),
            name: "P".into(),
            icon: "keyboard".into(),
            enabled: true,
            priority: 10,
            rules: vec![],
            layers,
            text_expansions: text,
            mouse: MouseSettings::default(),
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: "2026-01-01T00:00:00Z".into(),
        }
    }
    fn down(k: &str, text: Option<&str>) -> RemapInput {
        RemapInput::KeyDown { key: k.into(), text: text.map(str::to_owned), modifiers: vec![] }
    }
    fn up(k: &str) -> RemapInput {
        RemapInput::KeyUp { key: k.into() }
    }

    #[test]
    fn maps_keys_down_and_up() {
        let mut r = Remapper::new();
        r.set_profile(Some(profile(
            vec![Layer {
                id: "base".into(),
                name: "Base".into(),
                mappings: vec![mapping(
                    "m",
                    key("CapsLock"),
                    InputOutput::Key { key: "Escape".into(), modifiers: vec![] },
                    RepeatMode::None,
                )],
            }],
            vec![],
        )));
        let d = r.handle(&down("CapsLock", None), 0);
        assert!(d.swallow);
        assert!(matches!(&d.actions[0], RemapAction::Key { key, action: KeyAction::Down, .. } if key == "Escape"));
        let d = r.handle(&up("CapsLock"), 10);
        assert!(matches!(&d.actions[0], RemapAction::Key { action: KeyAction::Up, .. }));
        assert!(!r.handle(&down("a", Some("a")), 20).swallow);
    }

    #[test]
    fn hold_layers_and_disabled_keys() {
        let mut r = Remapper::new();
        r.set_profile(Some(profile(
            vec![
                Layer {
                    id: "base".into(),
                    name: "Base".into(),
                    mappings: vec![mapping(
                        "fn",
                        key("CapsLock"),
                        InputOutput::Layer { layer_id: "nav".into(), mode: LayerMode::Hold },
                        RepeatMode::None,
                    )],
                },
                Layer {
                    id: "nav".into(),
                    name: "Nav".into(),
                    mappings: vec![
                        mapping("h", key("h"), InputOutput::Key { key: "ArrowLeft".into(), modifiers: vec![] }, RepeatMode::None),
                        mapping("x", key("x"), InputOutput::Disabled, RepeatMode::None),
                    ],
                },
            ],
            vec![],
        )));
        assert!(!r.handle(&down("h", Some("h")), 0).swallow);
        r.handle(&up("h"), 1);
        r.handle(&down("CapsLock", None), 2);
        assert_eq!(r.active_layers(), vec!["nav".to_string(), "base".to_string()]);
        let d = r.handle(&down("H", Some("h")), 3);
        assert!(matches!(&d.actions[0], RemapAction::Key { key, .. } if key == "ArrowLeft"));
        let d = r.handle(&down("x", Some("x")), 4);
        assert!(d.swallow && d.actions.is_empty());
        r.handle(&up("CapsLock"), 5);
        assert_eq!(r.active_layers(), vec!["base".to_string()]);
    }

    #[test]
    fn expands_text_and_repeats() {
        let mut r = Remapper::new();
        r.set_profile(Some(profile(
            vec![Layer {
                id: "base".into(),
                name: "Base".into(),
                mappings: vec![mapping("rep", key("F6"), InputOutput::Mouse { button: MouseButton::Left }, RepeatMode::WhileHeld)],
            }],
            vec![TextExpansion { id: "t".into(), abbreviation: ";sig".into(), text: "Best regards".into(), apps: vec![] }],
        )));
        for c in [";", "s", "i"] {
            assert!(!r.handle(&down(c, Some(c)), 0).swallow);
        }
        let d = r.handle(&down("g", Some("g")), 0);
        assert_eq!(d.actions, vec![RemapAction::Expand { backspaces: 3, template: "Best regards".into() }]);
        let d = r.handle(&down("F6", None), 0);
        assert!(matches!(&d.actions[0], RemapAction::StartRepeat { every_ms: 50, .. }));
        let d = r.handle(&up("F6"), 100);
        assert_eq!(d.actions, vec![RemapAction::StopRepeat { id: "rep".into() }]);
    }

    #[test]
    fn mouse_hold_gesture() {
        let mut r = Remapper::new();
        r.set_profile(Some(profile(
            vec![Layer {
                id: "base".into(),
                name: "Base".into(),
                mappings: vec![mapping(
                    "h",
                    InputSource::Mouse { button: MouseButton::X1, gesture: Gesture::Hold },
                    InputOutput::Key { key: "F5".into(), modifiers: vec![] },
                    RepeatMode::None,
                )],
            }],
            vec![],
        )));
        assert!(r.handle(&RemapInput::MouseDown { button: MouseButton::X1 }, 0).swallow);
        let d = r.handle(&RemapInput::MouseUp { button: MouseButton::X1 }, 100);
        assert_eq!(d.actions, vec![RemapAction::Mouse { button: MouseButton::X1, action: ButtonAction::Click }]);
        r.handle(&RemapInput::MouseDown { button: MouseButton::X1 }, 1000);
        let d = r.handle(&RemapInput::MouseUp { button: MouseButton::X1 }, 1600);
        assert!(matches!(&d.actions[0], RemapAction::Key { key, action: KeyAction::Press, .. } if key == "F5"));
    }
}
