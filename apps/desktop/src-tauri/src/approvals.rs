//! Remembered risk approvals for runs nobody is watching.
//!
//! A flow with steps that need approval (file writes, HTTP, …) is approved in the app's pre-run
//! sheet. That approval is remembered as `flow id → hash of the flow's steps`, so the same flow
//! can later start from a schedule, an app/device event or a hotkey without anyone to ask. Any
//! edit to the steps changes the hash and the flow has to be approved again.
//!
//! Pure logic (no Tauri types): hashing, lookup and the `approved.json` file.

use autoflow_engine::schema::Flow;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::Path;

/// Approved flows: flow id → [`steps_hash`] at approval time.
pub type Approved = HashMap<String, String>;

/// SHA-256 (lowercase hex) of what an unattended run of `flow` would do: its steps and its
/// variables, as the engine serializes them.
///
/// Renaming a flow or changing its trigger keeps the approval; any change to a step — a path, a
/// URL, a new step — or to a variable's initial value (which an approved `{{path}}` or `{{url}}`
/// resolves to when nobody supplies inputs) invalidates it. Struct fields serialize in declaration
/// order and maps keep insertion order, so the same flow always gives the same hash. `None` when
/// the flow cannot be serialized: then nothing is approved rather than everything sharing a hash.
pub fn steps_hash(flow: &Flow) -> Option<String> {
    let json = serde_json::to_string(&(&flow.steps, &flow.variables)).ok()?;
    Some(Sha256::digest(json.as_bytes()).iter().map(|b| format!("{b:02x}")).collect())
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
        steps_hash(&flow(path, initial)).expect("hash")
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
