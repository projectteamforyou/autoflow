//! Native triggers synced from the web app (`triggers_sync`): global hotkeys, schedules and
//! app/device events. The emergency stop (Halt) is always registered.
//!
//! Hotkey and Keyforge starts are attended (a person pressed a key), so risky flows ask for
//! approval in a native dialog. Schedules and app/device events are unattended and never
//! approve risky steps; such runs fail visibly with "risky steps were not approved".

use crate::platform;
use crate::runs::{self, Origin};
use crate::state::{emit, lock, AppState};
use autoflow_engine::bridge::{BridgeEvent, HotkeyAction, TriggerFailure, TriggersSynced};
use autoflow_engine::keys::{canonical_key, is_modifier, is_printable};
use autoflow_engine::schedule::Schedule;
use autoflow_engine::schema::{
    default_stop_hotkey, parse_flow, AppEventKind, DeviceEventKind, Flow, Hotkey, HotkeyScope, Modifier, Trigger,
};
use std::collections::{HashMap, HashSet};
use std::time::Duration;
use tauri::{AppHandle, Manager};

/// Hotkey id of the emergency stop.
pub const HALT_ID: i32 = 1;
/// First id of the emergency stop with extra modifiers (ids `2..=16`, below flow ids at 100).
const HALT_VARIANT_ID: i32 = 2;

/// What a registered hotkey does.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Binding {
    /// Stop every run.
    Halt,
    /// Start a flow (optionally only while an app is focused).
    Start(String, Option<String>),
    /// Pause/resume a flow's runs.
    Pause(String),
    /// Stop a flow's runs.
    Stop(String),
}

/// Registered triggers and watcher memory.
#[derive(Default)]
pub struct TriggerTable {
    /// Hotkey id → action.
    pub bindings: HashMap<i32, Binding>,
    /// Schedules per flow.
    pub schedules: Vec<(String, Schedule)>,
    /// App events per flow.
    pub app_events: Vec<(String, AppEventKind, String)>,
    /// Device events per flow.
    pub device_events: Vec<(String, DeviceEventKind)>,
    prev_processes: Option<HashSet<String>>,
    prev_foreground: Option<String>,
    prev_power: Option<(bool, Option<u8>)>,
}

fn combo(h: &Hotkey) -> String {
    let mut mods: Vec<&str> = h.modifiers.iter().map(|m| m.as_str()).collect();
    mods.sort_unstable();
    mods.dedup();
    format!("{}+{}", mods.join("+"), canonical_key(&h.key).unwrap_or_default())
}

fn now_ms() -> u64 {
    u64::try_from(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis())).unwrap_or(0)
}

/// Checks an emergency stop combination: a real, non-modifier key with at least one modifier,
/// and never a plain character with only Shift (that would swallow typing system-wide).
pub fn check_emergency(h: &Hotkey) -> Result<(), String> {
    let key = canonical_key(&h.key).filter(|k| !k.is_empty()).ok_or_else(|| format!("unknown key \"{}\"", h.key))?;
    if is_modifier(&key) {
        return Err("the emergency stop needs a key besides the modifiers".into());
    }
    if h.modifiers.is_empty() {
        return Err("the emergency stop needs at least one modifier (Ctrl, Alt, Shift or Win)".into());
    }
    if is_printable(&key) && h.modifiers.iter().all(|m| *m == Modifier::Shift) {
        return Err("Shift plus a character cannot be the emergency stop".into());
    }
    Ok(())
}

/// The emergency stop plus every combination with extra modifiers held, so Halt still fires
/// while a flow holds Shift/Win/… down (`RegisterHotKey` matches modifiers exactly). Variants
/// another app already uses are skipped silently.
fn halt_hotkeys(emergency: &Hotkey) -> Vec<(i32, Hotkey)> {
    let extra: Vec<Modifier> =
        [Modifier::Ctrl, Modifier::Alt, Modifier::Shift, Modifier::Meta].into_iter().filter(|m| !emergency.modifiers.contains(m)).collect();
    let mut out = vec![(HALT_ID, emergency.clone())];
    for (id, mask) in (HALT_VARIANT_ID..).zip(1u32..(1 << extra.len())) {
        let mut h = emergency.clone();
        h.modifiers.extend(extra.iter().enumerate().filter(|(i, _)| mask & (1 << i) != 0).map(|(_, m)| *m));
        out.push((id, h));
    }
    out
}

fn is_halt_variant(id: i32) -> bool {
    (HALT_VARIANT_ID..100).contains(&id)
}

/// Emergency stops to try, in order: `wanted` (when valid), the one registered before, then the
/// default Ctrl+Alt+Esc — so a bad or taken combination never leaves the app without Halt.
fn emergency_candidates(wanted: Option<Hotkey>, previous: Hotkey) -> Vec<Hotkey> {
    let mut out: Vec<Hotkey> = Vec::new();
    for h in wanted.into_iter().chain([previous, default_stop_hotkey()]) {
        if check_emergency(&h).is_ok() && !out.iter().any(|o| combo(o) == combo(&h)) {
            out.push(h);
        }
    }
    out
}

/// Registers only the emergency stop (at startup, before the web app syncs).
pub fn register_halt(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let emergency = lock(&state.emergency).clone();
    let hk = lock(&state.hotkeys);
    let hk = hk.as_ref().ok_or("global hotkeys are unavailable")?;
    let mut first_err = None;
    for candidate in emergency_candidates(None, emergency) {
        let halts = halt_hotkeys(&candidate);
        {
            let mut t = lock(&state.triggers);
            for (id, _) in &halts {
                t.bindings.insert(*id, Binding::Halt);
            }
        }
        match hk.set(halts).into_iter().find(|(id, _)| *id == HALT_ID) {
            Some((_, Ok(()))) => {
                *lock(&state.emergency) = candidate;
                return Ok(());
            }
            Some((_, Err(e))) => {
                first_err.get_or_insert(e);
            }
            None => {
                first_err.get_or_insert_with(|| "hotkey registration failed".into());
            }
        }
    }
    Err(first_err.unwrap_or_else(|| "hotkey registration failed".into()))
}

fn fail(failed: &mut Vec<TriggerFailure>, flow: &str, reason: String) {
    failed.push(TriggerFailure { flow_id: flow.to_owned(), reason });
}

/// Replaces every trigger with those of `flows`.
#[allow(clippy::too_many_lines)]
pub fn sync(app: &AppHandle, flows: &[serde_json::Value], emergency: Hotkey) -> TriggersSynced {
    let state = app.state::<AppState>();
    let mut failed: Vec<TriggerFailure> = Vec::new();
    let mut ok_flows: Vec<Flow> = Vec::new();
    for raw in flows {
        let id = raw.get("id").and_then(serde_json::Value::as_str).unwrap_or("?").to_owned();
        match parse_flow(raw) {
            Ok(f) => ok_flows.push(f),
            Err(issues) => failed.push(TriggerFailure {
                flow_id: id,
                reason: format!("invalid flow: {}", issues.first().map_or_else(String::new, ToString::to_string)),
            }),
        }
    }
    {
        let mut lib = lock(&state.library);
        for f in &ok_flows {
            lib.insert(f.id.clone(), f.clone());
        }
    }
    let previous = lock(&state.emergency).clone();
    let wanted = match check_emergency(&emergency) {
        Ok(()) => Some(emergency.clone()),
        Err(reason) => {
            fail(&mut failed, "emergency", format!("{}: {reason}", emergency.to_display_string()));
            None
        }
    };
    let candidates = emergency_candidates(wanted, previous);
    let emergency = candidates.first().cloned().unwrap_or_else(default_stop_hotkey);

    let mut table = TriggerTable::default();
    let mut hotkeys: Vec<(i32, Hotkey)> = Vec::new();
    let mut owner: HashMap<String, (String, i32)> = HashMap::new();
    owner.insert(combo(&emergency), ("emergency stop".into(), HALT_ID));
    table.bindings.insert(HALT_ID, Binding::Halt);
    let mut next_id = 100;
    let mut flow_hotkeys = Vec::new();
    let mut watched: HashSet<String> = HashSet::new();

    for f in &ok_flows {
        let mut bind = |h: &Hotkey, b: Binding, failed: &mut Vec<TriggerFailure>, table: &mut TriggerTable| {
            let c = combo(h);
            if let Some((other, _)) = owner.get(&c) {
                if other != &f.id {
                    fail(failed, &f.id, format!("{} is already used by {other}", h.to_display_string()));
                }
                return;
            }
            owner.insert(c, (f.id.clone(), next_id));
            hotkeys.push((next_id, h.clone()));
            table.bindings.insert(next_id, b);
            flow_hotkeys.push((f.id.clone(), h.clone()));
            next_id += 1;
        };
        match &f.trigger {
            Trigger::Manual => {}
            Trigger::Hotkey { hotkey, scope, app } => {
                let only = if *scope == HotkeyScope::App { app.clone() } else { None };
                bind(hotkey, Binding::Start(f.id.clone(), only), &mut failed, &mut table);
                watched.insert(f.id.clone());
            }
            Trigger::Schedule { .. } => match Schedule::from_trigger(&f.trigger, now_ms()) {
                Ok(s) => {
                    table.schedules.push((f.id.clone(), s));
                    watched.insert(f.id.clone());
                }
                Err(e) => fail(&mut failed, &f.id, format!("invalid schedule: {e}")),
            },
            Trigger::AppEvent { event, app } => {
                table.app_events.push((f.id.clone(), *event, app.clone()));
                watched.insert(f.id.clone());
            }
            Trigger::DeviceEvent { event } => match event {
                DeviceEventKind::Charging | DeviceEventKind::BatteryLow => {
                    table.device_events.push((f.id.clone(), *event));
                    watched.insert(f.id.clone());
                }
                other => fail(&mut failed, &f.id, format!("device event {other:?} is not available on Windows")),
            },
            Trigger::Location { .. } | Trigger::Notification { .. } => {
                fail(&mut failed, &f.id, format!("{} triggers are not available on Windows", f.trigger.type_name()));
            }
        }
        if let Some(h) = &f.hotkeys.start {
            if !matches!(&f.trigger, Trigger::Hotkey { hotkey, .. } if combo(hotkey) == combo(h)) {
                bind(h, Binding::Start(f.id.clone(), None), &mut failed, &mut table);
                watched.insert(f.id.clone());
            }
        }
        if let Some(h) = &f.hotkeys.pause {
            bind(h, Binding::Pause(f.id.clone()), &mut failed, &mut table);
        }
        if combo(&f.hotkeys.stop) != combo(&emergency) {
            bind(&f.hotkeys.stop, Binding::Stop(f.id.clone()), &mut failed, &mut table);
        }
    }

    // Try the requested emergency stop first; if Windows refuses it, fall back to the previous
    // one (then the default) so Halt is never lost.
    let mut results = Vec::new();
    let mut effective = emergency.clone();
    let mut halt_error: Option<String> = None;
    for (n, candidate) in candidates.iter().enumerate() {
        let halts: Vec<(i32, Hotkey)> = halt_hotkeys(candidate)
            .into_iter()
            .filter(|(id, h)| *id == HALT_ID || !owner.get(&combo(h)).is_some_and(|(_, other)| *other != HALT_ID))
            .collect();
        for (id, _) in &halts {
            table.bindings.insert(*id, Binding::Halt);
        }
        let all: Vec<(i32, Hotkey)> = halts.into_iter().chain(hotkeys.iter().cloned()).collect();
        results = match lock(&state.hotkeys).as_ref() {
            Some(hk) => hk.set(all),
            None => all.iter().map(|(id, _)| (*id, Err("global hotkeys are unavailable".to_owned()))).collect(),
        };
        effective = candidate.clone();
        match results.iter().find(|(id, _)| *id == HALT_ID) {
            Some((_, Err(reason))) if n + 1 < candidates.len() && lock(&state.hotkeys).is_some() => {
                halt_error.get_or_insert_with(|| format!("{}: {reason}", candidate.to_display_string()));
                table.bindings.retain(|id, _| !is_halt_variant(*id));
            }
            _ => break,
        }
    }
    if let Some(reason) = halt_error {
        let kept = results.iter().any(|(id, r)| *id == HALT_ID && r.is_ok());
        let note = if kept { format!("; {} stays the emergency stop", effective.to_display_string()) } else { String::new() };
        fail(&mut failed, "emergency", format!("{reason}{note}"));
    }
    *lock(&state.emergency) = effective;
    for (id, r) in results {
        if is_halt_variant(id) {
            // Extra-modifier variants are best effort.
            if r.is_err() {
                table.bindings.remove(&id);
            }
            continue;
        }
        if let Err(reason) = r {
            let flow = match table.bindings.get(&id) {
                Some(Binding::Start(f, _) | Binding::Pause(f) | Binding::Stop(f)) => f.clone(),
                _ => "emergency".into(),
            };
            table.bindings.remove(&id);
            if id == HALT_ID {
                // Keep Halt mapped even if registration failed so the tray button still works.
                table.bindings.insert(HALT_ID, Binding::Halt);
            }
            failed.push(TriggerFailure { flow_id: flow, reason });
        }
    }
    {
        let mut t = lock(&state.triggers);
        table.prev_processes = t.prev_processes.take();
        table.prev_foreground = t.prev_foreground.take();
        table.prev_power = t.prev_power.take();
        *t = table;
    }
    *lock(&state.flow_hotkeys) = flow_hotkeys;
    let failed_ids: HashSet<&str> = failed.iter().map(|f| f.flow_id.as_str()).collect();
    let mut registered: Vec<String> = watched.into_iter().filter(|id| !failed_ids.contains(id.as_str())).collect();
    registered.sort();
    TriggersSynced { registered, failed }
}

/// Handles a global hotkey press (hotkey thread).
pub fn on_hotkey(app: &AppHandle, id: i32) {
    let binding = lock(&app.state::<AppState>().triggers).bindings.get(&id).cloned();
    match binding {
        Some(Binding::Halt) => {
            runs::halt_all(app, "halt");
            emit(app, &BridgeEvent::Hotkey { action: HotkeyAction::Halt, flow_id: None });
        }
        Some(Binding::Start(flow_id, only_app)) => {
            if let Some(a) = only_app {
                if !platform::foreground().is_some_and(|(fg, _)| platform::same_app(&fg, &a)) {
                    return;
                }
            }
            runs::start_known(app, &flow_id, Origin::Attended);
            emit(app, &BridgeEvent::Hotkey { action: HotkeyAction::Start, flow_id: Some(flow_id) });
        }
        Some(Binding::Pause(flow_id)) => {
            runs::toggle_pause_flow(app, &flow_id);
            emit(app, &BridgeEvent::Hotkey { action: HotkeyAction::Pause, flow_id: Some(flow_id) });
        }
        Some(Binding::Stop(flow_id)) => {
            runs::stop_flow(app, &flow_id);
            emit(app, &BridgeEvent::Hotkey { action: HotkeyAction::Stop, flow_id: Some(flow_id) });
        }
        None => {}
    }
}

/// Collects flows whose schedule / app / device trigger fired since the last tick.
fn due_flows(table: &mut TriggerTable) -> Vec<String> {
    let mut due = Vec::new();
    let now = now_ms();
    let local = chrono::Local::now().naive_local();
    for (flow, s) in &mut table.schedules {
        if s.due(now, &local) {
            due.push(flow.clone());
        }
    }
    if !table.app_events.is_empty() {
        let procs = platform::running_processes();
        let fg = platform::foreground().map(|(a, _)| a.to_lowercase());
        if let Some(prev) = &table.prev_processes {
            for (flow, ev, app) in &table.app_events {
                let has = |set: &HashSet<String>| set.iter().any(|p| platform::same_app(p, app));
                let fired = match ev {
                    AppEventKind::Launched => has(&procs) && !has(prev),
                    AppEventKind::Closed => !has(&procs) && has(prev),
                    AppEventKind::Focused => {
                        fg.as_deref().is_some_and(|f| platform::same_app(f, app))
                            && !table.prev_foreground.as_deref().is_some_and(|p| platform::same_app(p, app))
                    }
                };
                if fired {
                    due.push(flow.clone());
                }
            }
        }
        table.prev_processes = Some(procs);
        table.prev_foreground = fg;
    }
    if !table.device_events.is_empty() {
        let power = platform::power_status();
        if let (Some((ac, pct)), Some((prev_ac, prev_pct))) = (power, table.prev_power) {
            for (flow, ev) in &table.device_events {
                let fired = match ev {
                    DeviceEventKind::Charging => ac && !prev_ac,
                    DeviceEventKind::BatteryLow => !ac && pct.is_some_and(|p| p <= 20) && prev_pct.map_or(true, |p| p > 20),
                    _ => false,
                };
                if fired {
                    due.push(flow.clone());
                }
            }
        }
        table.prev_power = power;
    }
    due
}

/// Starts the 1 Hz watcher for schedules and app/device events.
pub fn spawn_watcher(app: AppHandle) {
    let spawned = std::thread::Builder::new().name("autoflow-triggers".into()).spawn(move || loop {
        std::thread::sleep(Duration::from_secs(1));
        let due = due_flows(&mut lock(&app.state::<AppState>().triggers));
        for flow in due {
            runs::start_known(&app, &flow, Origin::Unattended);
        }
    });
    if let Err(e) = spawned {
        eprintln!("autoflow: trigger watcher unavailable: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hk(key: &str, modifiers: &[Modifier]) -> Hotkey {
        Hotkey { key: key.into(), modifiers: modifiers.to_vec() }
    }

    #[test]
    fn emergency_stop_must_be_a_real_combination() {
        assert!(check_emergency(&default_stop_hotkey()).is_ok());
        assert!(check_emergency(&hk("F12", &[Modifier::Ctrl])).is_ok());
        assert!(check_emergency(&hk("Escape", &[])).is_err());
        assert!(check_emergency(&hk("", &[Modifier::Ctrl])).is_err());
        assert!(check_emergency(&hk("Shift", &[Modifier::Ctrl])).is_err());
        assert!(check_emergency(&hk("a", &[Modifier::Shift])).is_err());
    }

    #[test]
    fn invalid_or_taken_stops_fall_back_to_the_previous_then_the_default() {
        let prev = hk("F12", &[Modifier::Ctrl, Modifier::Alt]);
        let c = emergency_candidates(Some(hk("Escape", &[Modifier::Ctrl, Modifier::Shift])), prev.clone());
        assert_eq!(c.len(), 3);
        assert_eq!(c[1], prev);
        assert_eq!(c[2], default_stop_hotkey());
        let c = emergency_candidates(None, default_stop_hotkey());
        assert_eq!(c, vec![default_stop_hotkey()]);
    }

    #[test]
    fn halt_also_fires_with_extra_modifiers_held() {
        let all = halt_hotkeys(&default_stop_hotkey());
        assert_eq!(all[0], (HALT_ID, default_stop_hotkey()));
        // Ctrl+Alt+Esc plus Shift, Win, or both.
        assert_eq!(all.len(), 4);
        assert!(all[1..].iter().all(|(id, h)| is_halt_variant(*id) && h.key == "Escape" && h.modifiers.len() > 2));
        assert!(all.iter().any(|(_, h)| h.modifiers.contains(&Modifier::Shift) && h.modifiers.contains(&Modifier::Meta)));
        // A one-modifier stop gets 7 variants, still below the flow ids.
        let all = halt_hotkeys(&hk("F12", &[Modifier::Ctrl]));
        assert_eq!(all.len(), 8);
        assert!(all.iter().all(|(id, _)| *id < 100));
    }
}
