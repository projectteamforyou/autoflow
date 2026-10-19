//! Raw recorded input events — mirrors `RecordedEvent` in `packages/core/src/record.ts`.
//!
//! Native recorders (Windows low-level hooks) stream these to the web app, which turns them
//! into editable steps with `eventsToSteps`. Keys typed into sensitive fields carry
//! `sensitive: true` and a placeholder key, so the real characters never leave the device.

use crate::schema::{Modifier, MouseButton};
use serde::{Deserialize, Serialize};

/// Placeholder printable key used for masked sensitive keystrokes.
pub const MASKED_KEY: &str = "*";

/// One raw input event. `t` is milliseconds since recording started.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
#[allow(missing_docs)]
pub enum RecordedEvent {
    MouseDown {
        t: u64,
        x: i32,
        y: i32,
        button: MouseButton,
        /// Monitor the event happened on (recorders fill it in so steps become display-relative).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        display_id: Option<String>,
    },
    MouseUp {
        t: u64,
        x: i32,
        y: i32,
        button: MouseButton,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        display_id: Option<String>,
    },
    Wheel {
        t: u64,
        dx: i32,
        dy: i32,
        x: i32,
        y: i32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        display_id: Option<String>,
    },
    KeyDown {
        t: u64,
        key: String,
        modifiers: Vec<Modifier>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        sensitive: Option<bool>,
    },
    KeyUp {
        t: u64,
        key: String,
        modifiers: Vec<Modifier>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        sensitive: Option<bool>,
    },
}

impl RecordedEvent {
    /// Timestamp.
    pub fn t(&self) -> u64 {
        match self {
            RecordedEvent::MouseDown { t, .. }
            | RecordedEvent::MouseUp { t, .. }
            | RecordedEvent::Wheel { t, .. }
            | RecordedEvent::KeyDown { t, .. }
            | RecordedEvent::KeyUp { t, .. } => *t,
        }
    }

    /// Replaces the key of a sensitive key event by [`MASKED_KEY`] (printable keys only, so the
    /// web app still sees "typing happened here" and stores a `{{secret:…}}` placeholder).
    #[must_use]
    pub fn masked(self) -> Self {
        match self {
            RecordedEvent::KeyDown { t, key, modifiers, sensitive: Some(true) } => {
                RecordedEvent::KeyDown { t, key: mask_key(key), modifiers, sensitive: Some(true) }
            }
            RecordedEvent::KeyUp { t, key, modifiers, sensitive: Some(true) } => {
                RecordedEvent::KeyUp { t, key: mask_key(key), modifiers, sensitive: Some(true) }
            }
            other => other,
        }
    }
}

fn mask_key(key: String) -> String {
    if key.chars().count() == 1 {
        MASKED_KEY.to_owned()
    } else {
        key
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_shape_matches_typescript() {
        let e = RecordedEvent::KeyDown { t: 5, key: "a".into(), modifiers: vec![Modifier::Shift], sensitive: Some(true) }.masked();
        assert_eq!(
            serde_json::to_value(&e).expect("serializes"),
            serde_json::json!({"kind":"keyDown","t":5,"key":"*","modifiers":["shift"],"sensitive":true})
        );
        let m = RecordedEvent::MouseUp { t: 1, x: 2, y: 3, button: MouseButton::X1, display_id: None };
        assert_eq!(serde_json::to_value(&m).expect("serializes"), serde_json::json!({"kind":"mouseUp","t":1,"x":2,"y":3,"button":"x1"}));
    }
}
