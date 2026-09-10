use std::path::{Path, PathBuf};
use std::process::Command;

use tauri::{AppHandle, Manager};

#[tauri::command]
pub fn nox_prepare_update_relaunch_with_local_data_reset(app: AppHandle) -> Result<(), String> {
    let local_data_dir = app.path().app_local_data_dir().map_err(to_string)?;
    let roaming_data_dir = app.path().app_data_dir().map_err(to_string)?;
    if normalize_path_text(&local_data_dir) == normalize_path_text(&roaming_data_dir) {
        return Err(
            "Refusing to clear local WebView data because it matches persistent app data".into(),
        );
    }
    schedule_clean_relaunch(local_data_dir)
}

#[cfg(target_os = "windows")]
fn schedule_clean_relaunch(local_data_dir: PathBuf) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let current_exe = std::env::current_exe().map_err(to_string)?;
    let script = windows_cleanup_script(std::process::id(), &local_data_dir, &current_exe);
    Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-WindowStyle",
            "Hidden",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &script,
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(to_string)?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn windows_cleanup_script(process_id: u32, local_data_dir: &Path, executable: &Path) -> String {
    let data = powershell_quote(&local_data_dir.to_string_lossy());
    let exe = powershell_quote(&executable.to_string_lossy());
    format!(
        "$ErrorActionPreference='SilentlyContinue'; Wait-Process -Id {process_id} -Timeout 45; Start-Sleep -Milliseconds 350; for($attempt=0; $attempt -lt 20; $attempt++){{ Remove-Item -LiteralPath {data} -Recurse -Force; if(-not (Test-Path -LiteralPath {data})){{ break }}; Start-Sleep -Milliseconds 250 }}; New-Item -ItemType Directory -Force -Path {data} | Out-Null; Start-Process -FilePath {exe} -WindowStyle Hidden;"
    )
}

#[cfg(not(target_os = "windows"))]
fn schedule_clean_relaunch(local_data_dir: PathBuf) -> Result<(), String> {
    let current_exe = std::env::current_exe().map_err(to_string)?;
    if local_data_dir.exists() {
        std::fs::remove_dir_all(&local_data_dir).map_err(to_string)?;
    }
    std::fs::create_dir_all(&local_data_dir).map_err(to_string)?;
    Command::new(current_exe).spawn().map_err(to_string)?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn powershell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}
fn normalize_path_text(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/").to_lowercase()
}
fn to_string(error: impl ToString) -> String {
    error.to_string()
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use std::path::Path;

    use super::{powershell_quote, windows_cleanup_script};

    #[test]
    fn powershell_paths_escape_single_quotes() {
        assert_eq!(powershell_quote("C:\\NoX's data"), "'C:\\NoX''s data'");
    }

    #[test]
    fn cleanup_retries_before_relaunching() {
        let script = windows_cleanup_script(
            42,
            Path::new(r"C:\Users\Test\AppData\Local\NoX"),
            Path::new(r"C:\Program Files\NoX\nox.exe"),
        );

        assert!(script.contains("Wait-Process -Id 42 -Timeout 45"));
        assert!(script.contains("$attempt -lt 20"));
        assert!(script.contains("Test-Path -LiteralPath"));
        assert!(script.contains("Start-Sleep -Milliseconds 250"));
        assert!(script.find("for($attempt").unwrap() < script.find("Start-Process").unwrap());
    }
}
