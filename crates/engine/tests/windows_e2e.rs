//! End-to-end check of the real input path: the test opens its own window (an edit box plus a
//! click target), runs a flow through `WindowsBackend` (SendInput click + Unicode typing) and
//! verifies what the window received. A recorder runs at the same time and must see none of
//! AutoFlow's own injected events.
//!
//! Ignored by default because it moves the real pointer and keyboard focus. Run it on a test
//! machine, a CI runner or Wine + Xvfb:
//! `cargo test -p autoflow_engine --test windows_e2e -- --ignored`
#![cfg(windows)]
#![allow(clippy::unwrap_used, clippy::expect_used)]

use autoflow_engine::record::RecordedEvent;
use autoflow_engine::windows::recorder::Recorder;
use autoflow_engine::windows::{Host, WindowsBackend};
use autoflow_engine::{parse_flow, BackendError, FlowRun, RunOptions, RunStatus};
use serde_json::json;
use std::path::PathBuf;
use std::sync::atomic::{AtomicI32, AtomicIsize, Ordering};
use std::sync::{mpsc, Arc};
use std::time::Duration;
use windows::core::PCWSTR;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::ClientToScreen;
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Input::KeyboardAndMouse::SetFocus;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetClientRect, GetMessageW, GetWindowTextW, PostMessageW, PostQuitMessage,
    RegisterClassExW, SetForegroundWindow, TranslateMessage, ES_MULTILINE, MSG, WINDOW_STYLE, WM_CLOSE, WM_DESTROY, WM_LBUTTONDOWN,
    WNDCLASSEXW, WS_CHILD, WS_EX_TOPMOST, WS_OVERLAPPEDWINDOW, WS_VISIBLE,
};

static CLICKS: AtomicI32 = AtomicI32::new(0);
/// The tests share the desktop, so they take turns.
static SERIAL: std::sync::Mutex<()> = std::sync::Mutex::new(());
static LAST_CLICK: AtomicIsize = AtomicIsize::new(-1);

struct NoHost;
impl Host for NoHost {
    fn notify(&self, _: &str, _: &str) -> Result<(), BackendError> {
        Ok(())
    }
    fn switch_profile(&self, _: &str) -> Result<(), BackendError> {
        Ok(())
    }
    fn image_path(&self, _: &str) -> Option<PathBuf> {
        None
    }
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

unsafe extern "system" fn target_proc(hwnd: HWND, msg: u32, w: WPARAM, l: LPARAM) -> LRESULT {
    match msg {
        WM_LBUTTONDOWN => {
            CLICKS.fetch_add(1, Ordering::SeqCst);
            LAST_CLICK.store(l.0, Ordering::SeqCst);
            LRESULT(0)
        }
        WM_DESTROY => {
            unsafe { PostQuitMessage(0) };
            LRESULT(0)
        }
        _ => unsafe { DefWindowProcW(hwnd, msg, w, l) },
    }
}

struct Ui {
    main: isize,
    edit: isize,
    target_screen: (i32, i32),
}

fn spawn_ui() -> (Ui, std::thread::JoinHandle<()>) {
    let (tx, rx) = mpsc::channel();
    let join = std::thread::spawn(move || unsafe {
        let module = GetModuleHandleW(PCWSTR::null()).unwrap();
        let class = wide("AutoFlowE2E");
        let wc = WNDCLASSEXW {
            cbSize: u32::try_from(std::mem::size_of::<WNDCLASSEXW>()).unwrap(),
            lpfnWndProc: Some(target_proc),
            hInstance: module.into(),
            lpszClassName: PCWSTR(class.as_ptr()),
            ..Default::default()
        };
        RegisterClassExW(&wc);
        let title = wide("AutoFlow E2E");
        let main = CreateWindowExW(
            WS_EX_TOPMOST,
            PCWSTR(class.as_ptr()),
            PCWSTR(title.as_ptr()),
            WS_OVERLAPPEDWINDOW | WS_VISIBLE,
            100,
            100,
            600,
            400,
            None,
            None,
            Some(module.into()),
            None,
        )
        .unwrap();
        let edit_class = wide("EDIT");
        let edit = CreateWindowExW(
            Default::default(),
            PCWSTR(edit_class.as_ptr()),
            PCWSTR::null(),
            WS_CHILD | WS_VISIBLE | WINDOW_STYLE(u32::try_from(ES_MULTILINE).unwrap()),
            10,
            10,
            300,
            100,
            Some(main),
            None,
            Some(module.into()),
            None,
        )
        .unwrap();
        let _ = SetForegroundWindow(main);
        let _ = SetFocus(Some(edit));
        let mut rc = RECT::default();
        GetClientRect(main, &mut rc).unwrap();
        // Click target: an empty area of the main window's client rectangle.
        let mut p = POINT { x: 450, y: 250 };
        let _ = ClientToScreen(main, &mut p);
        tx.send(Ui { main: main.0 as isize, edit: edit.0 as isize, target_screen: (p.x, p.y) }).unwrap();
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).0 > 0 {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    });
    (rx.recv_timeout(Duration::from_secs(10)).unwrap(), join)
}

fn foreign_key(vk: u16) {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VIRTUAL_KEY,
    };
    let key = |flags| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VIRTUAL_KEY(vk), wScan: 0, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
    };
    let inputs = [key(KEYBD_EVENT_FLAGS(0)), key(KEYEVENTF_KEYUP)];
    unsafe { SendInput(&inputs, i32::try_from(std::mem::size_of::<INPUT>()).unwrap()) };
}

fn edit_text(edit: isize) -> String {
    let mut buf = [0u16; 512];
    let n = unsafe { GetWindowTextW(HWND(edit as *mut _), &mut buf) };
    String::from_utf16_lossy(&buf[..usize::try_from(n).unwrap_or(0)])
}

#[test]
#[ignore = "moves the real pointer and keyboard; run explicitly with --ignored"]
fn types_and_clicks_through_sendinput() {
    let _turn = SERIAL.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    let (ui, join) = spawn_ui();
    std::thread::sleep(Duration::from_millis(500));
    let recorded = Arc::new(AtomicI32::new(0));
    let r2 = Arc::clone(&recorded);
    let recorder = Recorder::start(
        true,
        Arc::new(move |_| {
            r2.fetch_add(1, Ordering::SeqCst);
        }),
    )
    .expect("hooks");

    let flow = parse_flow(&json!({
        "schemaVersion": "1.0", "id": "e2e", "name": "e2e",
        "createdAt": "2026-10-19T00:00:00.000Z", "updatedAt": "2026-10-19T00:00:00.000Z",
        "limits": { "countdownMs": 0 },
        "steps": [
            { "id": "c", "type": "click", "target": { "kind": "point", "x": ui.target_screen.0, "y": ui.target_screen.1, "space": "screen" } },
            { "id": "f", "type": "click", "target": { "kind": "point", "x": ui.target_screen.0 - 300, "y": ui.target_screen.1 - 180, "space": "screen" } },
            { "id": "t", "type": "type", "text": "Hi {{ 1 + 1 }} 세계 ✓" }
        ]
    }))
    .expect("flow");
    let result = FlowRun::new(flow, Box::new(WindowsBackend::new(Arc::new(NoHost))), RunOptions::default()).start();
    std::thread::sleep(Duration::from_millis(300));
    let ours = recorded.load(Ordering::SeqCst);
    // A keystroke injected by someone else (no AutoFlow marker) must be recorded.
    foreign_key(0x51);
    std::thread::sleep(Duration::from_millis(500));
    let (events, _) = recorder.stop();

    let text = edit_text(ui.edit);
    let clicks = CLICKS.load(Ordering::SeqCst);
    let last = LAST_CLICK.load(Ordering::SeqCst);
    unsafe {
        let _ = PostMessageW(Some(HWND(ui.main as *mut _)), WM_CLOSE, WPARAM(0), LPARAM(0));
    }
    let _ = join.join();

    assert_eq!(result.status, RunStatus::Completed, "{:?}", result.error);
    assert!(clicks >= 1, "the click target received no click");
    let (lx, ly) = (last & 0xFFFF, (last >> 16) & 0xFFFF);
    assert_eq!((lx, ly), (450, 250), "click landed at client ({lx}, {ly})");
    assert_eq!(text, "Hi 2 세계 ✓q");
    assert_eq!(ours, 0, "AutoFlow's own input was recorded");
    let keys: Vec<String> = events
        .iter()
        .filter_map(|e| match e {
            RecordedEvent::KeyDown { key, .. } => Some(key.clone()),
            _ => None,
        })
        .collect();
    assert_eq!(keys, vec!["q".to_owned()], "recorded: {events:?}");
}

struct KfHost;
impl autoflow_engine::windows::keyforge::KeyforgeHost for KfHost {
    fn profile_activated(&self, _: Option<&str>) {}
    fn start_flow(&self, _: &str) {}
}

#[test]
#[ignore = "installs global keyboard hooks; run explicitly with --ignored"]
fn keyforge_remaps_physical_keys_and_expands_text() {
    use autoflow_engine::input_profile::parse_profile;
    use autoflow_engine::windows::keyforge::Keyforge;
    let _turn = SERIAL.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    let (ui, join) = spawn_ui();
    std::thread::sleep(Duration::from_millis(500));
    let profile = parse_profile(&json!({
        "id": "test", "name": "Test", "createdAt": "2026-10-19T00:00:00.000Z", "updatedAt": "2026-10-19T00:00:00.000Z",
        "layers": [{ "id": "base", "name": "Base", "mappings": [
            { "id": "q2w", "from": { "kind": "key", "key": "q" }, "to": { "kind": "key", "key": "w" } }
        ] }],
        "textExpansions": [{ "id": "hello", "abbreviation": "zz", "text": "Hello" }]
    }))
    .expect("profile");
    let kf = Keyforge::start(Arc::new(KfHost)).expect("keyforge");
    // The test simulates "physical" keys with SendInput, so it opts into foreign injected input.
    kf.set_remap_foreign_injected(true);
    let (active, warnings) = kf.apply(vec![profile], true, &[], autoflow_engine::schema::default_stop_hotkey());
    assert_eq!(active.as_deref(), Some("test"), "{warnings:?}");
    std::thread::sleep(Duration::from_millis(1200)); // watcher installs the hooks
    foreign_key(0x51); // q -> w
    std::thread::sleep(Duration::from_millis(300));
    foreign_key(0x5A); // z
    foreign_key(0x5A); // z -> expands
    std::thread::sleep(Duration::from_millis(800));
    let text = edit_text(ui.edit);
    drop(kf);
    unsafe {
        let _ = PostMessageW(Some(HWND(ui.main as *mut _)), WM_CLOSE, WPARAM(0), LPARAM(0));
    }
    let _ = join.join();
    assert_eq!(text, "wHello");
}
