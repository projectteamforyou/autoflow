//! OS version and input-device inventory for `device_info`.

use crate::bridge::{InputDevice, InputDeviceKind};
use ::windows::Wdk::System::SystemServices::RtlGetVersion;
use ::windows::Win32::Foundation::HANDLE;
use ::windows::Win32::System::SystemInformation::OSVERSIONINFOW;
use ::windows::Win32::UI::Input::{
    GetRawInputDeviceInfoW, GetRawInputDeviceList, RAWINPUTDEVICELIST, RIDI_DEVICEINFO, RIDI_DEVICENAME, RID_DEVICE_INFO, RIM_TYPEHID,
    RIM_TYPEKEYBOARD, RIM_TYPEMOUSE,
};

/// `(product name, "major.minor.build", build)`.
pub fn os_version() -> (String, String, u32) {
    let mut v =
        OSVERSIONINFOW { dwOSVersionInfoSize: u32::try_from(std::mem::size_of::<OSVERSIONINFOW>()).unwrap_or(276), ..Default::default() };
    // SAFETY: `v` is a properly sized OSVERSIONINFOW.
    let status = unsafe { RtlGetVersion(&mut v) };
    if status.is_err() {
        return ("Windows".into(), "unknown".into(), 0);
    }
    let name = if v.dwMajorVersion == 10 && v.dwBuildNumber >= 22_000 { "Windows 11" } else { "Windows" };
    (name.into(), format!("{}.{}.{}", v.dwMajorVersion, v.dwMinorVersion, v.dwBuildNumber), v.dwBuildNumber)
}

fn hex_after(path: &str, tag: &str) -> Option<u32> {
    let upper = path.to_ascii_uppercase();
    let i = upper.find(tag)? + tag.len();
    u32::from_str_radix(upper.get(i..i + 4)?, 16).ok()
}

/// Keyboards, mice, touch screens and game controllers known to Raw Input.
pub fn input_devices() -> Vec<InputDevice> {
    let mut out = Vec::new();
    let size = u32::try_from(std::mem::size_of::<RAWINPUTDEVICELIST>()).unwrap_or(16);
    let mut n = 0u32;
    // SAFETY: first call only queries the count; the second fills a buffer of that size.
    let list = unsafe {
        if GetRawInputDeviceList(None, &mut n, size) == u32::MAX || n == 0 {
            return out;
        }
        let mut list = vec![RAWINPUTDEVICELIST::default(); usize::try_from(n).unwrap_or(0)];
        let got = GetRawInputDeviceList(Some(list.as_mut_ptr()), &mut n, size);
        if got == u32::MAX {
            return out;
        }
        list.truncate(usize::try_from(got).unwrap_or(0));
        list
    };
    for d in list {
        let h = Some(HANDLE(d.hDevice.0));
        let mut name_buf = [0u16; 512];
        let mut len = u32::try_from(name_buf.len()).unwrap_or(512);
        // SAFETY: buffers are valid and sized as declared.
        let path = unsafe {
            let n = GetRawInputDeviceInfoW(h, RIDI_DEVICENAME, Some(name_buf.as_mut_ptr().cast()), &mut len);
            if n == u32::MAX {
                continue;
            }
            super::from_wide(&name_buf)
        };
        let mut info =
            RID_DEVICE_INFO { cbSize: u32::try_from(std::mem::size_of::<RID_DEVICE_INFO>()).unwrap_or(32), ..Default::default() };
        let mut isize_ = info.cbSize;
        // SAFETY: `info` is sized via cbSize.
        let have_info =
            unsafe { GetRawInputDeviceInfoW(h, RIDI_DEVICEINFO, Some(std::ptr::addr_of_mut!(info).cast()), &mut isize_) } != u32::MAX;
        let (kind, vendor, product) = if d.dwType == RIM_TYPEKEYBOARD {
            (InputDeviceKind::Keyboard, hex_after(&path, "VID_"), hex_after(&path, "PID_"))
        } else if d.dwType == RIM_TYPEMOUSE {
            (InputDeviceKind::Mouse, hex_after(&path, "VID_"), hex_after(&path, "PID_"))
        } else if d.dwType == RIM_TYPEHID && have_info {
            // SAFETY: dwType is HID, so the `hid` union member is active.
            let hid = unsafe { info.Anonymous.hid };
            let kind = match (hid.usUsagePage, hid.usUsage) {
                (0x01, 0x04 | 0x05) => InputDeviceKind::Gamepad,
                (0x0D, _) => InputDeviceKind::Touch,
                _ => continue,
            };
            (kind, Some(hid.dwVendorId), Some(hid.dwProductId))
        } else {
            continue;
        };
        let label = match kind {
            InputDeviceKind::Keyboard => "Keyboard",
            InputDeviceKind::Mouse => "Mouse",
            InputDeviceKind::Touch => "Touch screen",
            InputDeviceKind::Gamepad => "Game controller",
            InputDeviceKind::Other => "Input device",
        };
        let name = match (vendor, product) {
            (Some(v), Some(p)) => format!("{label} {v:04X}:{p:04X}"),
            _ => label.to_owned(),
        };
        out.push(InputDevice { id: path, name, kind, vendor_id: vendor, product_id: product });
    }
    out
}
