//! Remembered risk approvals for runs nobody is watching.
//!
//! A flow with steps that need approval (file writes, HTTP, …) is approved in the app's pre-run
//! sheet. That approval is remembered as `flow id → hash of the flow's steps`, so the same flow
//! can later start from a schedule, an app/device event or a hotkey without anyone to ask. Any
//! edit to the steps changes the hash and the flow has to be approved again.
//!
//! Pure logic (no Tauri types): hashing, lookup and the `approved.json` file.

use autoflow_engine::schema::{walk_steps, Flow, Step, StepKind, VariableDef};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap};
use std::path::Path;

/// Approved flows: flow id → [`steps_hash`] at approval time.
pub type Approved = HashMap<String, String>;

/// SHA-256 (lowercase hex) of what an unattended run of `flow` would do: its steps and its
/// variables, as the engine serializes them, plus those of every flow it can reach through
/// `runFlow` steps in `library` (the flows the run will resolve calls against).
///
/// Renaming a flow or changing its trigger keeps the approval; any change to a step — a path, a
/// URL, a new step — or to a variable's initial value (which an approved `{{path}}` or `{{url}}`
/// resolves to when nobody supplies inputs) invalidates it. So does any such change to a called
/// flow, directly or through further calls: a called flow runs under the caller's approval. Flows
/// the caller cannot reach do not matter. Struct fields serialize in declaration order and maps keep
/// insertion order, and called flows are hashed in id order, so the same flows always give the same
/// hash. A flow that calls nothing hashes exactly as before calls were covered. `None` when a flow
/// cannot be serialized: then nothing is approved rather than everything sharing a hash.
pub fn steps_hash(flow: &Flow, library: &HashMap<String, Flow>) -> Option<String> {
    let called = called_flows(flow, library);
    let json = if called.is_empty() {
        serde_json::to_string(&(&flow.steps, &flow.variables)).ok()?
    } else {
        let called: Vec<(&str, &[Step], &[VariableDef])> =
            called.iter().map(|(id, f)| (*id, f.steps.as_slice(), f.variables.as_slice())).collect();
        serde_json::to_string(&(&flow.steps, &flow.variables, called)).ok()?
    };
    Some(Sha256::digest(json.as_bytes()).iter().map(|b| format!("{b:02x}")).collect())
}

/// Every library flow `flow` can reach through enabled `runFlow` steps, by id. Each flow is visited
/// once, so call cycles end; the caller itself and ids missing from the library are left out (a
/// missing flow fails the run when it is called, and adding it later changes the hash). Unlike the
/// engine's risk report this has no depth limit: covering more can only ask for approval again.
fn called_flows<'a>(flow: &'a Flow, library: &'a HashMap<String, Flow>) -> BTreeMap<&'a str, &'a Flow> {
    let mut called: BTreeMap<&str, &Flow> = BTreeMap::new();
    let mut pending: Vec<&[Step]> = vec![&flow.steps];
    while let Some(steps) = pending.pop() {
        walk_steps(steps, &mut |s, _, _| {
            let StepKind::RunFlow { flow_id } = &s.kind else { return };
            if s.is_disabled() || *flow_id == flow.id || called.contains_key(flow_id.as_str()) {
                return;
            }
            if let Some((id, target)) = library.get_key_value(flow_id) {
                called.insert(id, target);
                pending.push(&target.steps);
            }
        });
    }
    called
}

/// Whether exactly these steps of `flow_id` were approved before.
pub fn is_approved(approved: &Approved, flow_id: &str, hash: &str) -> bool {
    approved.get(flow_id).is_some_and(|h| h == hash)
}

/// Remembers an approval; returns false when it was already stored (nothing to save).
pub fn remember(approved: &mut Approved, flow_id: &str, hash: &str) -> bool {
    if is_approved(approved, flow_id, hash) {
        return false;
    }
    approved.insert(flow_id.to_owned(), hash.to_owned());
    true
}

/// Reads `approved.json`. A missing or corrupt file means nothing is approved: the worst case is
/// approving a flow once more.
pub fn load(path: &Path) -> Approved {
    std::fs::read(path).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default()
}

/// Writes `approved.json` through a temporary file, so a crash never leaves a half-written file.
pub fn save(path: &Path, approved: &Approved) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    // Sorted keys keep the file stable between saves.
    let sorted: std::collections::BTreeMap<&String, &String> = approved.iter().collect();
    let json = serde_json::to_vec_pretty(&sorted).map_err(std::io::Error::other)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json)?;
    std::fs::rename(&tmp, path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use autoflow_engine::parse_flow;
    use serde_json::json;

    fn flow(path: &str, initial: &str) -> Flow {
        parse_flow(&json!({
            "schemaVersion": "1.0", "id": "f_test", "name": "t",
            "variables": [{ "name": "dir", "type": "string", "initial": initial }],
            "steps": [{ "id": "w", "type": "file", "op": "write", "path": path, "content": "x" }],
            "createdAt": "2026-10-19T00:00:00.000Z", "updatedAt": "2026-10-19T00:00:00.000Z"
        }))
        .expect("flow")
    }
    fn hash(path: &str, initial: &str) -> String {
        steps_hash(&flow(path, initial), &HashMap::new()).expect("hash")
    }

    fn named(id: &str, steps: serde_json::Value) -> Flow {
        parse_flow(&json!({
            "schemaVersion": "1.0", "id": id, "name": id, "steps": steps,
            "createdAt": "2026-10-19T00:00:00.000Z", "updatedAt": "2026-10-19T00:00:00.000Z"
        }))
        .expect("flow")
    }
    fn call(id: &str, target: &str) -> serde_json::Value {
        json!({ "id": id, "type": "runFlow", "flowId": target })
    }
    fn write(path: &str) -> serde_json::Value {
        json!({ "id": "w", "type": "file", "op": "write", "path": path, "content": "x" })
    }
    fn lib(flows: &[&Flow]) -> HashMap<String, Flow> {
        flows.iter().map(|f| (f.id.clone(), (*f).clone())).collect()
    }

    #[test]
    fn editing_a_called_flow_invalidates_the_callers_approval() {
        let a = named("f_a", json!([call("r", "f_b")]));
        let b = named("f_b", json!([call("r", "f_c")]));
        let c = named("f_c", json!([write("C:\\a.txt")]));
        let other = named("f_other", json!([write("C:\\o.txt")]));
        let h = steps_hash(&a, &lib(&[&a, &b, &c, &other])).expect("hash");
        // Deterministic, whatever order the library map iterates in.
        assert_eq!(h, steps_hash(&a, &lib(&[&other, &c, &b, &a])).expect("hash"));
        // A flow reached through two calls was edited: A has to be approved again.
        let c2 = named("f_c", json!([write("C:\\evil.txt")]));
        assert_ne!(h, steps_hash(&a, &lib(&[&a, &b, &c2, &other])).expect("hash"));
        // So does a change to a called flow's variables.
        let mut b2 = b.clone();
        b2.variables = flow("x", "changed").variables;
        assert_ne!(h, steps_hash(&a, &lib(&[&a, &b2, &c, &other])).expect("hash"));
        // Editing or removing a flow A cannot reach changes nothing.
        let other2 = named("f_other", json!([write("C:\\p.txt")]));
        assert_eq!(h, steps_hash(&a, &lib(&[&a, &b, &c, &other2])).expect("hash"));
        assert_eq!(h, steps_hash(&a, &lib(&[&b, &c])).expect("hash"));
        // A called flow that is not in the library yet: it appearing later asks again.
        assert_ne!(h, steps_hash(&a, &lib(&[&a, &b])).expect("hash"));
        // A disabled call does not pull the callee in.
        let off = named("f_a", json!([{ "id": "r", "type": "runFlow", "flowId": "f_b", "disabled": true }]));
        assert_eq!(steps_hash(&off, &lib(&[&b, &c])), steps_hash(&off, &HashMap::new()));
    }

    #[test]
    fn call_cycles_end_and_a_flow_without_calls_hashes_as_before() {
        let a = named("f_a", json!([call("r", "f_b"), call("self", "f_a")]));
        let b = named("f_b", json!([call("back", "f_a"), call("again", "f_b"), write("C:\\a.txt")]));
        let h = steps_hash(&a, &lib(&[&a, &b])).expect("hash");
        assert_eq!(h.len(), 64);
        let b2 = named("f_b", json!([call("back", "f_a"), call("again", "f_b"), write("C:\\b.txt")]));
        assert_ne!(h, steps_hash(&a, &lib(&[&a, &b2])).expect("hash"));
        // The caller is hashed from the copy being run, not from a stale library entry of the same id.
        let stale = named("f_a", json!([write("C:\\old.txt")]));
        assert_eq!(h, steps_hash(&a, &lib(&[&stale, &b])).expect("hash"));
        // No calls: the library is irrelevant and the hash is the one stored by earlier versions.
        let plain = flow("C:\\a.txt", "x");
        let old = serde_json::to_string(&(&plain.steps, &plain.variables)).expect("json");
        let old: String = Sha256::digest(old.as_bytes()).iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(steps_hash(&plain, &lib(&[&a, &b])).expect("hash"), old);
    }

    #[test]
    fn any_edit_to_the_steps_invalidates_the_approval() {
        let (a, b) = (hash("C:\\a.txt", "x"), hash("C:\\b.txt", "x"));
        assert_eq!(a.len(), 64);
        assert_eq!(a, hash("C:\\a.txt", "x"));
        assert_ne!(a, b);
        // A variable's initial value is what `{{dir}}` resolves to in an unattended run.
        assert_ne!(a, hash("C:\\a.txt", "y"));
        let mut approved = Approved::new();
        assert!(!is_approved(&approved, "f_test", &a));
        assert!(remember(&mut approved, "f_test", &a));
        assert!(!remember(&mut approved, "f_test", &a));
        assert!(is_approved(&approved, "f_test", &a));
        assert!(!is_approved(&approved, "f_test", &b));
        assert!(!is_approved(&approved, "f_other", &a));
        // Approving the edited flow replaces the old approval.
        assert!(remember(&mut approved, "f_test", &b));
        assert!(!is_approved(&approved, "f_test", &a));
    }

    #[test]
    fn the_file_round_trips_and_tolerates_damage() {
        let dir = std::env::temp_dir().join(format!("autoflow-approved-{}", std::process::id()));
        let path = dir.join("approved.json");
        assert!(load(&path).is_empty());
        let mut approved = Approved::new();
        remember(&mut approved, "f_a", "11");
        remember(&mut approved, "f_b", "22");
        save(&path, &approved).expect("save");
        assert_eq!(load(&path), approved);
        save(&path, &approved).expect("save over the existing file");
        std::fs::write(&path, b"{ not json").expect("write");
        assert!(load(&path).is_empty());
        let _removed = std::fs::remove_dir_all(&dir);
    }
}
