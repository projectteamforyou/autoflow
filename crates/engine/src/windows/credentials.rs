//! Windows Credential Manager storage for `{{secret:name}}` values.
//!
//! Secrets are generic credentials named `AutoFlow:<name>`, persisted for the local machine and
//! the current user only (DPAPI-protected by Windows). Values are never logged or returned to
//! the web app; only names are listed.

use super::wide;
use crate::engine::{BackendError, ErrorCategory};
use ::windows::core::{PCWSTR, PWSTR};
use ::windows::Win32::Security::Credentials::{
    CredDeleteW, CredEnumerateW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_ENUMERATE_FLAGS, CRED_FLAGS,
    CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
};

/// Target-name prefix of every AutoFlow secret.
pub const PREFIX: &str = "AutoFlow:";
/// Maximum secret size accepted (Credential Manager allows 2560 bytes for generic blobs).
pub const MAX_SECRET_BYTES: usize = 2560;

fn valid_name(name: &str) -> Result<(), BackendError> {
    let ok = !name.is_empty() && name.len() <= 128 && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'));
    if ok {
        Ok(())
    } else {
        Err(BackendError::new(ErrorCategory::Validation, "secret names use 1-128 letters, digits, '_', '-' or '.'"))
    }
}

/// Stores or replaces a secret.
pub fn set(name: &str, value: &str) -> Result<(), BackendError> {
    valid_name(name)?;
    let mut blob: Vec<u8> = value.encode_utf16().flat_map(u16::to_le_bytes).collect();
    if blob.len() > MAX_SECRET_BYTES {
        return Err(BackendError::new(ErrorCategory::Validation, "secret is too long (max 1280 characters)"));
    }
    let mut target = wide(&format!("{PREFIX}{name}"));
    let mut user = wide("AutoFlow");
    let cred = CREDENTIALW {
        Flags: CRED_FLAGS(0),
        Type: CRED_TYPE_GENERIC,
        TargetName: PWSTR(target.as_mut_ptr()),
        CredentialBlobSize: u32::try_from(blob.len()).unwrap_or(0),
        CredentialBlob: blob.as_mut_ptr(),
        Persist: CRED_PERSIST_LOCAL_MACHINE,
        UserName: PWSTR(user.as_mut_ptr()),
        ..Default::default()
    };
    // SAFETY: every pointer in `cred` refers to buffers alive for the duration of the call.
    let r = unsafe { CredWriteW(&cred, 0) };
    blob.iter_mut().for_each(|b| *b = 0);
    r.map_err(|e| BackendError::new(ErrorCategory::Environment, format!("cannot save the secret: {e}")))
}

/// Reads a secret, `None` when it does not exist.
pub fn get(name: &str) -> Option<String> {
    valid_name(name).ok()?;
    let target = wide(&format!("{PREFIX}{name}"));
    let mut p: *mut CREDENTIALW = std::ptr::null_mut();
    // SAFETY: `p` receives a CredRead allocation that is freed with CredFree below.
    unsafe {
        CredReadW(PCWSTR(target.as_ptr()), CRED_TYPE_GENERIC, None, &mut p).ok()?;
        if p.is_null() {
            return None;
        }
        let c = &*p;
        let len = usize::try_from(c.CredentialBlobSize).unwrap_or(0);
        let bytes = if c.CredentialBlob.is_null() { &[][..] } else { std::slice::from_raw_parts(c.CredentialBlob, len) };
        let units: Vec<u16> = bytes.chunks_exact(2).map(|b| u16::from_le_bytes([b[0], b[1]])).collect();
        let value = String::from_utf16_lossy(&units);
        CredFree(p.cast_const().cast());
        Some(value)
    }
}

/// Deletes a secret (no error when it does not exist).
pub fn delete(name: &str) -> Result<(), BackendError> {
    valid_name(name)?;
    let target = wide(&format!("{PREFIX}{name}"));
    // SAFETY: NUL-terminated target name.
    match unsafe { CredDeleteW(PCWSTR(target.as_ptr()), CRED_TYPE_GENERIC, None) } {
        Ok(()) => Ok(()),
        // ERROR_NOT_FOUND
        Err(e) if e.code().0 == 0x8007_0490_u32 as i32 => Ok(()),
        Err(e) => Err(BackendError::new(ErrorCategory::Environment, format!("cannot delete the secret: {e}"))),
    }
}

/// Names of all stored secrets, sorted.
pub fn list() -> Vec<String> {
    let filter = wide(&format!("{PREFIX}*"));
    let mut count = 0u32;
    let mut items: *mut *mut CREDENTIALW = std::ptr::null_mut();
    let mut out = Vec::new();
    // SAFETY: CredEnumerateW allocates `items` (freed with CredFree); entries are read in bounds.
    unsafe {
        if CredEnumerateW(PCWSTR(filter.as_ptr()), Some(CRED_ENUMERATE_FLAGS(0)), &mut count, &mut items).is_err() || items.is_null() {
            return out;
        }
        for i in 0..usize::try_from(count).unwrap_or(0) {
            let c = *items.add(i);
            if c.is_null() {
                continue;
            }
            if let Ok(name) = (*c).TargetName.to_string() {
                if let Some(n) = name.strip_prefix(PREFIX) {
                    out.push(n.to_owned());
                }
            }
        }
        CredFree(items.cast_const().cast());
    }
    out.sort();
    out
}
