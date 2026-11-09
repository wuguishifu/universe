//! The top-level windows a user might want to record, for picking one by hand.

use serde::{Deserialize, Serialize};
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM};
use windows::Win32::Graphics::Dwm::{DWMWA_CLOAKED, DwmGetWindowAttribute};
use windows::Win32::System::Threading::{
    GetCurrentProcessId, OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    QueryFullProcessImageNameW,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GW_OWNER, GWL_EXSTYLE, GetWindow, GetWindowLongPtrW, GetWindowTextLengthW,
    GetWindowTextW, GetWindowThreadProcessId, IsWindow, IsWindowVisible, WS_EX_TOOLWINDOW,
};
use windows::core::{BOOL, PWSTR};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowInfo {
    /// The window's handle. Handles are 32-bit values even on 64-bit Windows, so this is exact
    /// as a JS number.
    pub hwnd: u64,
    pub title: String,
    /// The executable's file name, e.g. `VALORANT-Win64-Shipping.exe`. Empty when the process
    /// can't be opened.
    pub exe: String,
    pub pid: u32,
}

fn hwnd(value: u64) -> HWND {
    HWND(value as usize as *mut _)
}

/// Whether the window still exists.
pub fn window_exists(handle: u64) -> bool {
    unsafe { IsWindow(Some(hwnd(handle))).as_bool() }
}

pub(crate) fn exe_name(pid: u32) -> String {
    unsafe {
        let Ok(process) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
            return String::new();
        };
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            PWSTR(buf.as_mut_ptr()),
            &mut len,
        )
        .is_ok();
        let _ = CloseHandle(process);
        if !ok {
            return String::new();
        }
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        path.rsplit('\\').next().unwrap_or_default().to_owned()
    }
}

/// Visible, unowned, titled windows that aren't tool windows, cloaked (hidden UWP frames,
/// windows on other virtual desktops) or Clipper's own: roughly what Alt+Tab shows.
fn is_candidate(window: HWND) -> bool {
    unsafe {
        if !IsWindowVisible(window).as_bool() || GetWindowTextLengthW(window) == 0 {
            return false;
        }
        if GetWindow(window, GW_OWNER).is_ok_and(|owner| !owner.is_invalid()) {
            return false;
        }
        if GetWindowLongPtrW(window, GWL_EXSTYLE) as u32 & WS_EX_TOOLWINDOW.0 != 0 {
            return false;
        }
        let mut cloaked = 0u32;
        let _ = DwmGetWindowAttribute(
            window,
            DWMWA_CLOAKED,
            (&raw mut cloaked).cast(),
            size_of::<u32>() as u32,
        );
        cloaked == 0
    }
}

unsafe extern "system" fn collect(window: HWND, list: LPARAM) -> BOOL {
    let list = unsafe { &mut *(list.0 as *mut Vec<HWND>) };
    if is_candidate(window) {
        list.push(window);
    }
    BOOL(1)
}

/// The windows that can be recorded, in Z order (front first).
pub fn list_windows() -> Vec<WindowInfo> {
    let mut handles: Vec<HWND> = Vec::new();
    unsafe {
        let _ = EnumWindows(Some(collect), LPARAM(&raw mut handles as isize));
    }
    let own_pid = unsafe { GetCurrentProcessId() };
    handles
        .into_iter()
        .filter_map(|window| unsafe {
            let mut pid = 0u32;
            GetWindowThreadProcessId(window, Some(&mut pid));
            if pid == own_pid {
                return None;
            }
            let mut buf = vec![0u16; GetWindowTextLengthW(window) as usize + 1];
            let len = GetWindowTextW(window, &mut buf);
            Some(WindowInfo {
                hwnd: window.0 as usize as u64,
                title: String::from_utf16_lossy(&buf[..len as usize]),
                exe: exe_name(pid),
                pid,
            })
        })
        .collect()
}
