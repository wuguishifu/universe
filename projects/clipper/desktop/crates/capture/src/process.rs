//! Finding processes to capture audio from, and keeping child processes from outliving Clipper.

use std::sync::OnceLock;

use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
    SetInformationJobObject,
};
use windows::Win32::System::Threading::{
    GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
};

/// What GetExitCodeProcess reports for a process that hasn't exited.
const STILL_ACTIVE: u32 = 259;

/// Whether the process is running.
pub(crate) fn process_alive(pid: u32) -> bool {
    unsafe {
        let Ok(process) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
            return false;
        };
        let mut code = 0;
        let alive = GetExitCodeProcess(process, &mut code).is_ok() && code == STILL_ACTIVE;
        let _ = CloseHandle(process);
        alive
    }
}

struct Process {
    pid: u32,
    parent: u32,
    exe: String,
}

fn processes() -> Vec<Process> {
    let mut list = Vec::new();
    unsafe {
        let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            return list;
        };
        let mut entry = PROCESSENTRY32W {
            dwSize: size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        let mut ok = Process32FirstW(snapshot, &mut entry).is_ok();
        while ok {
            let len = entry
                .szExeFile
                .iter()
                .position(|&c| c == 0)
                .unwrap_or(entry.szExeFile.len());
            list.push(Process {
                pid: entry.th32ProcessID,
                parent: entry.th32ParentProcessID,
                exe: String::from_utf16_lossy(&entry.szExeFile[..len]),
            });
            ok = Process32NextW(snapshot, &mut entry).is_ok();
        }
        let _ = CloseHandle(snapshot);
    }
    list
}

/// The top of the process tree running one of `exes` (e.g. `Discord.exe`): a process with one of
/// those names whose parent doesn't have one. Apps like Discord run as several processes, and
/// their audio comes from a child, so the whole tree is captured from its top.
pub(crate) fn find_process_tree(exes: &[String]) -> Option<u32> {
    let all = processes();
    let matches = |p: &Process| exes.iter().any(|e| e.eq_ignore_ascii_case(&p.exe));
    all.iter()
        .filter(|p| matches(p))
        .find(|p| {
            !all.iter()
                .any(|parent| parent.pid == p.parent && matches(parent))
        })
        .map(|p| p.pid)
}

/// Makes `process` end when Clipper does, even if Clipper crashes: it's put in a job that Windows
/// kills when Clipper's handle to it closes.
pub(crate) fn kill_with_clipper(process: HANDLE) {
    struct Job(HANDLE);
    // The handle is only used to add processes, which is safe from any thread.
    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}
    static JOB: OnceLock<Option<Job>> = OnceLock::new();

    let job = JOB.get_or_init(|| unsafe {
        let job = CreateJobObjectW(None, None).ok()?;
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            (&raw const limits).cast(),
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
        .ok()?;
        Some(Job(job))
    });
    match job {
        Some(job) => unsafe {
            if let Err(e) = AssignProcessToJobObject(job.0, process) {
                tracing::warn!(error = %e, "couldn't tie a process to Clipper's lifetime");
            }
        },
        None => tracing::warn!("couldn't create the job that ends processes with Clipper"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_this_process_and_knows_its_alive() {
        assert!(process_alive(std::process::id()));
        let exe = std::env::current_exe().unwrap();
        let name = exe.file_name().unwrap().to_string_lossy().into_owned();
        // The test binary's parent is cargo, not another test binary, so it's the top.
        assert_eq!(find_process_tree(&[name]), Some(std::process::id()));
        assert_eq!(find_process_tree(&["not-a-real-process.exe".into()]), None);
    }
}
