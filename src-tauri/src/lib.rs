mod automation;
mod model;
mod repository;
mod service;
mod storage;
mod update_cleanup;

use std::sync::Arc;

use model::{ExtensionActionResult, ManagerSnapshot};
use service::ManagerService;
use tauri::State;
use tokio::sync::Mutex;

struct AppState {
    manager: Mutex<ManagerService>,
}

#[tauri::command]
async fn get_snapshot(state: State<'_, AppState>) -> Result<ManagerSnapshot, String> {
    state.manager.lock().await.snapshot()
}

#[tauri::command]
async fn sync_extensions(state: State<'_, AppState>) -> Result<ManagerSnapshot, String> {
    state.manager.lock().await.sync().await
}

#[tauri::command]
async fn install_extension(
    id: String,
    state: State<'_, AppState>,
) -> Result<ExtensionActionResult, String> {
    state.manager.lock().await.install(&id).await
}

#[tauri::command]
async fn update_extension(
    id: String,
    state: State<'_, AppState>,
) -> Result<ExtensionActionResult, String> {
    state.manager.lock().await.update(&id).await
}

#[tauri::command]
async fn remove_extension(
    id: String,
    state: State<'_, AppState>,
) -> Result<ExtensionActionResult, String> {
    state.manager.lock().await.remove(&id).await
}

#[tauri::command]
async fn repair_extension(
    id: String,
    state: State<'_, AppState>,
) -> Result<ExtensionActionResult, String> {
    state.manager.lock().await.repair(&id).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "windows")]
    let automation: Arc<dyn automation::BrowserAutomationBackend> =
        Arc::new(automation::WindowsChromeAutomation::new());
    #[cfg(target_os = "macos")]
    let automation: Arc<dyn automation::BrowserAutomationBackend> =
        Arc::new(automation::MacOsChromeAutomation::new());
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let automation: Arc<dyn automation::BrowserAutomationBackend> =
        Arc::new(automation::UnsupportedAutomation);

    let manager = ManagerService::new(automation)
        .expect("NoX storage and repository services could not be initialized");
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState {
            manager: Mutex::new(manager),
        })
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            sync_extensions,
            install_extension,
            update_extension,
            remove_extension,
            repair_extension,
            update_cleanup::nox_prepare_update_relaunch_with_local_data_reset,
        ])
        .run(tauri::generate_context!())
        .expect("error while running NoX Extension Manager");
}
