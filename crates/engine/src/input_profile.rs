//! Keyforge input profiles — mirrors `packages/core/src/input-profile.ts`.
//!
//! Profiles hold key/button remappings in layers, text expansions, mouse settings and rules for
//! automatic switching. The runtime remapping state machine lives in [`crate::remap`].

use crate::schema::{Hotkey, Modifier, MouseButton};
use crate::schema::{ValidationIssue, Validator};
use chrono::{Datelike, NaiveDateTime, Timelike};
use serde::{Deserialize, Serialize};

/// Mouse gestures on a source button.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[allow(missing_docs)]
pub enum Gesture {
    #[default]
    Single,
    Double,
    Hold,
}

/// Wheel directions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[allow(missing_docs)]
pub enum WheelDirection {
    Up,
    Down,
    Left,
    Right,
}

impl WheelDirection {
    /// Lowercase name.
    pub fn as_str(self) -> &'static str {
        match self {
            WheelDirection::Up => "up",
            WheelDirection::Down => "down",
            WheelDirection::Left => "left",
            WheelDirection::Right => "right",
        }
    }
}

/// What the user presses.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[allow(missing_docs)]
pub enum InputSource {
    Key {
        key: String,
        #[serde(default)]
        modifiers: Vec<Modifier>,
    },
    Mouse {
        button: MouseButton,
        #[serde(default)]
        gesture: Gesture,
    },
    Wheel {
        direction: WheelDirection,
    },
}

/// Media actions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(missing_docs)]
pub enum MediaAction {
    PlayPause,
    Next,
    Previous,
    VolumeUp,
    VolumeDown,
    Mute,
}

/// Layer activation modes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[allow(missing_docs)]
pub enum LayerMode {
    Hold,
    Toggle,
}

/// What a mapping produces.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
#[allow(missing_docs)]
pub enum InputOutput {
    Key {
        key: String,
        #[serde(default)]
        modifiers: Vec<Modifier>,
    },
    Mouse {
        button: MouseButton,
    },
    Text {
        text: String,
    },
    Launch {
        app: String,
    },
    Flow {
        flow_id: String,
    },
    Media {
        action: MediaAction,
    },
    Layer {
        layer_id: String,
        mode: LayerMode,
    },
    Disabled,
}

/// Auto-repeat behaviour.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(missing_docs)]
pub enum RepeatMode {
    #[default]
    None,
    WhileHeld,
    Toggle,
}

/// One remapping.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mapping {
    /// Id.
    pub id: String,
    /// Source.
    pub from: InputSource,
    /// Output.
    pub to: InputOutput,
    /// Repeat mode.
    #[serde(default)]
    pub repeat: RepeatMode,
    /// Repeat interval.
    #[serde(default = "default_repeat_ms")]
    pub repeat_ms: u64,
    /// Enabled.
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_repeat_ms() -> u64 {
    100
}
fn default_true() -> bool {
    true
}

/// A layer of mappings (`layers[0]` is the base layer).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Layer {
    /// Id.
    pub id: String,
    /// Name.
    pub name: String,
    /// Mappings.
    #[serde(default)]
    pub mappings: Vec<Mapping>,
}

/// Abbreviation → text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TextExpansion {
    /// Id.
    pub id: String,
    /// Typed abbreviation (2..40 chars).
    pub abbreviation: String,
    /// Replacement; supports `{{date()}}`, `{{time()}}` and `{{clipboard}}`.
    pub text: String,
    /// Restrict to these apps (empty = everywhere).
    #[serde(default)]
    pub apps: Vec<String>,
}

/// Pointer settings.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(missing_docs)]
pub struct MouseSettings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub swap_buttons: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub double_click_ms: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pointer_speed: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enhance_precision: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wheel_lines: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub invert_wheel: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dpi_stages: Option<Vec<u32>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub polling_rate_hz: Option<u32>,
}

/// Automatic switching rules (all must match).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[allow(missing_docs)]
pub enum ProfileRule {
    App {
        app: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        window: Option<String>,
    },
    Time {
        from: String,
        to: String,
        #[serde(default = "all_days")]
        days: Vec<u8>,
    },
    Device {
        name: String,
    },
}

fn all_days() -> Vec<u8> {
    vec![0, 1, 2, 3, 4, 5, 6]
}

/// A Keyforge profile.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputProfile {
    /// `"1.0"`.
    #[serde(default = "default_version")]
    pub schema_version: String,
    /// Id.
    pub id: String,
    /// Name.
    pub name: String,
    /// Icon.
    #[serde(default = "default_icon")]
    pub icon: String,
    /// Enabled.
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Higher wins.
    #[serde(default = "default_priority")]
    pub priority: u32,
    /// Rules.
    #[serde(default)]
    pub rules: Vec<ProfileRule>,
    /// Layers (≥ 1).
    pub layers: Vec<Layer>,
    /// Text expansions.
    #[serde(default)]
    pub text_expansions: Vec<TextExpansion>,
    /// Mouse settings.
    #[serde(default)]
    pub mouse: MouseSettings,
    /// ISO timestamp.
    pub created_at: String,
    /// ISO timestamp.
    pub updated_at: String,
}

fn default_version() -> String {
    "1.0".into()
}
fn default_icon() -> String {
    "keyboard".into()
}
fn default_priority() -> u32 {
    10
}

/// Parses and validates a profile document.
pub fn parse_profile(data: &serde_json::Value) -> Result<InputProfile, Vec<ValidationIssue>> {
    let mut data = data.clone();
    crate::schema::normalize_numbers(&mut data);
    let p: InputProfile =
        serde_json::from_value(data).map_err(|e| vec![ValidationIssue { path: String::new(), message: e.to_string() }])?;
    let mut v = Validator::default();
    if p.schema_version != "1.0" {
        v.issue("schemaVersion", "Invalid literal value, expected \"1.0\"");
    }
    v.plain_id("id", &p.id);
    v.len("name", &p.name, 1, 80);
    v.max("icon", &p.icon, 32);
    v.range_u("priority", u64::from(p.priority), 0, 1000);
    v.arr_max("rules", p.rules.len(), 50);
    v.arr_min("layers", p.layers.len(), 1);
    v.arr_max("layers", p.layers.len(), 16);
    for (li, layer) in p.layers.iter().enumerate() {
        v.plain_id(&format!("layers.{li}.id"), &layer.id);
        v.max(&format!("layers.{li}.name"), &layer.name, 60);
        v.arr_max(&format!("layers.{li}.mappings"), layer.mappings.len(), 500);
        for (mi, m) in layer.mappings.iter().enumerate() {
            let p = format!("layers.{li}.mappings.{mi}");
            v.plain_id(&format!("{p}.id"), &m.id);
            v.range_u(&format!("{p}.repeatMs"), m.repeat_ms, 10, 60_000);
            if let InputSource::Key { key, modifiers } = &m.from {
                v.len(&format!("{p}.from.key"), key, 1, 32);
                v.arr_max(&format!("{p}.from.modifiers"), modifiers.len(), 4);
            }
            match &m.to {
                InputOutput::Key { key, .. } => {
                    v.len(&format!("{p}.to.key"), key, 1, 32);
                }
                InputOutput::Text { text } => v.max(&format!("{p}.to.text"), text, 5000),
                InputOutput::Launch { app } => v.max(&format!("{p}.to.app"), app, 260),
                InputOutput::Flow { flow_id } => v.plain_id(&format!("{p}.to.flowId"), flow_id),
                InputOutput::Layer { layer_id, .. } => v.plain_id(&format!("{p}.to.layerId"), layer_id),
                _ => {}
            }
        }
    }
    v.arr_max("textExpansions", p.text_expansions.len(), 1000);
    for (i, t) in p.text_expansions.iter().enumerate() {
        v.plain_id(&format!("textExpansions.{i}.id"), &t.id);
        v.len(&format!("textExpansions.{i}.abbreviation"), &t.abbreviation, 2, 40);
        v.max(&format!("textExpansions.{i}.text"), &t.text, 10_000);
    }
    for (i, r) in p.rules.iter().enumerate() {
        if let ProfileRule::Time { from, to, days } = r {
            for (k, s) in [("from", from), ("to", to)] {
                if parse_hhmm(s).is_none() {
                    v.issue(&format!("rules.{i}.{k}"), "Invalid");
                }
            }
            if days.iter().any(|d| *d > 6) {
                v.issue(&format!("rules.{i}.days"), "Number must be less than or equal to 6");
            }
        }
    }
    v.datetime("createdAt", &p.created_at);
    v.datetime("updatedAt", &p.updated_at);
    if v.issues.is_empty() {
        Ok(p)
    } else {
        Err(v.issues)
    }
}

/// OS-reserved shortcuts that must not be remapped (`RESERVED_SHORTCUTS`).
pub const RESERVED_SHORTCUTS: [(&str, &str, &str); 8] = [
    ("windows", "Ctrl+Alt+Delete", "reserved.sas"),
    ("windows", "Meta+L", "reserved.lock"),
    ("windows", "Alt+Tab", "reserved.switcher"),
    ("windows", "Ctrl+Shift+Escape", "reserved.taskManager"),
    ("windows", "Meta+D", "reserved.desktop"),
    ("windows", "Meta+Tab", "reserved.taskView"),
    ("windows", "Alt+F4", "reserved.closeWindow"),
    ("android", "Power", "reserved.power"),
];

/// Conflict kinds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(missing_docs)]
pub enum ConflictKind {
    Duplicate,
    Reserved,
    FlowHotkey,
    SelfLoop,
}

/// A mapping conflict.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MappingConflict {
    /// Kind.
    pub kind: ConflictKind,
    /// Layer.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layer_id: Option<String>,
    /// Involved mappings.
    pub mapping_ids: Vec<String>,
    /// Detail.
    pub detail: String,
}

/// `sourceKey()`.
pub fn source_key(s: &InputSource) -> String {
    match s {
        InputSource::Key { key, modifiers } => {
            format!("key:{}", Hotkey { key: key.clone(), modifiers: modifiers.clone() }.to_display_string())
        }
        InputSource::Mouse { button, gesture } => {
            let g = match gesture {
                Gesture::Single => "single",
                Gesture::Double => "double",
                Gesture::Hold => "hold",
            };
            format!("mouse:{}:{g}", button.as_str())
        }
        InputSource::Wheel { direction } => format!("wheel:{}", direction.as_str()),
    }
}

/// Finds duplicate sources, reserved shortcuts, flow-hotkey collisions and self loops.
pub fn find_conflicts(profile: &InputProfile, flow_hotkeys: &[(String, Hotkey)]) -> Vec<MappingConflict> {
    let mut out = Vec::new();
    for layer in &profile.layers {
        let mut seen: Vec<(String, String)> = Vec::new();
        for m in layer.mappings.iter().filter(|m| m.enabled) {
            let k = source_key(&m.from);
            if let Some((_, prev)) = seen.iter().find(|(key, _)| *key == k) {
                out.push(MappingConflict {
                    kind: ConflictKind::Duplicate,
                    layer_id: Some(layer.id.clone()),
                    mapping_ids: vec![prev.clone(), m.id.clone()],
                    detail: k.clone(),
                });
            } else {
                seen.push((k.clone(), m.id.clone()));
            }
            if let InputSource::Key { key, modifiers } = &m.from {
                let combo = Hotkey { key: key.clone(), modifiers: modifiers.clone() }.to_display_string().to_lowercase();
                if let Some((_, reserved, _)) = RESERVED_SHORTCUTS.iter().find(|(_, c, _)| c.to_lowercase() == combo) {
                    out.push(MappingConflict {
                        kind: ConflictKind::Reserved,
                        layer_id: Some(layer.id.clone()),
                        mapping_ids: vec![m.id.clone()],
                        detail: (*reserved).to_owned(),
                    });
                }
                if let Some((flow_id, _)) = flow_hotkeys.iter().find(|(_, h)| format!("key:{}", h.to_display_string()) == k) {
                    out.push(MappingConflict {
                        kind: ConflictKind::FlowHotkey,
                        layer_id: Some(layer.id.clone()),
                        mapping_ids: vec![m.id.clone()],
                        detail: flow_id.clone(),
                    });
                }
                if let InputOutput::Key { key: to_key, modifiers: to_mods } = &m.to {
                    if to_key == key && to_mods == modifiers {
                        out.push(MappingConflict {
                            kind: ConflictKind::SelfLoop,
                            layer_id: Some(layer.id.clone()),
                            mapping_ids: vec![m.id.clone()],
                            detail: k,
                        });
                    }
                }
            }
        }
    }
    let mut abbr: Vec<(&str, &str)> = Vec::new();
    for t in &profile.text_expansions {
        if let Some((_, prev)) = abbr.iter().find(|(a, _)| *a == t.abbreviation) {
            out.push(MappingConflict {
                kind: ConflictKind::Duplicate,
                layer_id: None,
                mapping_ids: vec![(*prev).to_owned(), t.id.clone()],
                detail: format!("text:{}", t.abbreviation),
            });
        } else {
            abbr.push((&t.abbreviation, &t.id));
        }
    }
    out
}

/// Context used to pick the active profile.
#[derive(Debug, Clone, Default)]
pub struct ProfileContext {
    /// Foreground process name, e.g. `game.exe`.
    pub app: Option<String>,
    /// Foreground window title.
    pub window: Option<String>,
    /// Active input device name.
    pub device: Option<String>,
    /// Local wall-clock time (defaults to now).
    pub date: Option<NaiveDateTime>,
}

fn parse_hhmm(s: &str) -> Option<u32> {
    let (h, m) = s.split_once(':')?;
    if h.len() != 2 || m.len() != 2 || !h.bytes().chain(m.bytes()).all(|b| b.is_ascii_digit()) {
        return None;
    }
    Some(h.parse::<u32>().ok()? * 60 + m.parse::<u32>().ok()?)
}

fn rule_matches(r: &ProfileRule, ctx: &ProfileContext) -> bool {
    match r {
        ProfileRule::App { app, window } => {
            let Some(cur) = &ctx.app else { return false };
            if cur.to_lowercase() != app.to_lowercase() {
                return false;
            }
            window.as_ref().map_or(true, |w| ctx.window.as_deref().unwrap_or("").to_lowercase().contains(&w.to_lowercase()))
        }
        ProfileRule::Device { name } => ctx.device.as_ref().is_some_and(|d| d.to_lowercase().contains(&name.to_lowercase())),
        ProfileRule::Time { from, to, days } => {
            let d = ctx.date.unwrap_or_else(|| chrono::Local::now().naive_local());
            #[allow(clippy::cast_possible_truncation)]
            let wd = d.weekday().num_days_from_sunday() as u8;
            if !days.contains(&wd) {
                return false;
            }
            let cur = d.hour() * 60 + d.minute();
            let (Some(from), Some(to)) = (parse_hhmm(from), parse_hhmm(to)) else { return false };
            if from <= to {
                cur >= from && cur < to
            } else {
                cur >= from || cur < to
            }
        }
    }
}

/// Picks the active profile: enabled, all rules match (no rules = fallback), highest priority
/// wins, then the one with more rules; ties keep list order.
pub fn resolve_active_profile<'a>(profiles: &'a [InputProfile], ctx: &ProfileContext) -> Option<&'a InputProfile> {
    let mut best: Option<&InputProfile> = None;
    for p in profiles {
        if !p.enabled || !(p.rules.is_empty() || p.rules.iter().all(|r| rule_matches(r, ctx))) {
            continue;
        }
        let better = best.map_or(true, |b| (p.priority, p.rules.len()) > (b.priority, b.rules.len()));
        if better {
            best = Some(p);
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    fn profile(id: &str, priority: u32, rules: Vec<ProfileRule>) -> InputProfile {
        InputProfile {
            schema_version: "1.0".into(),
            id: id.into(),
            name: id.into(),
            icon: "keyboard".into(),
            enabled: true,
            priority,
            rules,
            layers: vec![Layer { id: "base".into(), name: "Base".into(), mappings: vec![] }],
            text_expansions: vec![],
            mouse: MouseSettings::default(),
            created_at: "2026-01-01T00:00:00.000Z".into(),
            updated_at: "2026-01-01T00:00:00.000Z".into(),
        }
    }

    fn key_map(id: &str, key: &str, mods: Vec<Modifier>, to: InputOutput) -> Mapping {
        Mapping {
            id: id.into(),
            from: InputSource::Key { key: key.into(), modifiers: mods },
            to,
            repeat: RepeatMode::None,
            repeat_ms: 100,
            enabled: true,
        }
    }

    #[test]
    fn conflicts_match_typescript() {
        let mut p = profile("work", 10, vec![]);
        p.layers[0].mappings = vec![
            key_map("m1", "CapsLock", vec![], InputOutput::Key { key: "Escape".into(), modifiers: vec![] }),
            key_map("m2", "CapsLock", vec![], InputOutput::Disabled),
            key_map("m3", "Tab", vec![Modifier::Alt], InputOutput::Disabled),
            key_map("m4", "F9", vec![], InputOutput::Text { text: "x".into() }),
        ];
        let kinds: Vec<ConflictKind> =
            find_conflicts(&p, &[("f1".into(), Hotkey { key: "F9".into(), modifiers: vec![] })]).into_iter().map(|c| c.kind).collect();
        assert_eq!(kinds, vec![ConflictKind::Duplicate, ConflictKind::Reserved, ConflictKind::FlowHotkey]);
    }

    #[test]
    fn resolves_active_profile() {
        let game = profile("game", 50, vec![ProfileRule::App { app: "game.exe".into(), window: None }]);
        let base = profile("def", 0, vec![]);
        let night = profile("night", 20, vec![ProfileRule::Time { from: "22:00".into(), to: "06:00".into(), days: all_days() }]);
        let all = [base, game, night];
        let at = |h| NaiveDate::from_ymd_opt(2026, 1, 1).and_then(|d| d.and_hms_opt(h, 0, 0));
        let ctx = |app: &str, h| ProfileContext { app: Some(app.into()), date: at(h), ..Default::default() };
        assert_eq!(resolve_active_profile(&all, &ctx("game.exe", 12)).map(|p| p.id.as_str()), Some("game"));
        assert_eq!(resolve_active_profile(&all, &ctx("x.exe", 23)).map(|p| p.id.as_str()), Some("night"));
        assert_eq!(resolve_active_profile(&all, &ctx("x.exe", 12)).map(|p| p.id.as_str()), Some("def"));
    }
}
