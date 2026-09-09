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
    let data = powershell_quote(&local_data_dir.to_string_lossy());
    let exe = powershell_quote(&current_exe.to_string_lossy());
    let script = format!(
        "$ErrorActionPreference='SilentlyContinue'; Wait-Process -Id {} -Timeout 45; Start-Sleep -Milliseconds 350; Remove-Item -LiteralPath {} -Recurse -Force; New-Item -ItemType Directory -Force -Path {} | Out-Null; Start-Process -FilePath {} -WindowStyle Hidden;",
        std::process::id(), data, data, exe
    );
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
