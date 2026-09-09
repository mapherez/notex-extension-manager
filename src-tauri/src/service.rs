use std::fs;
use std::sync::Arc;

use chrono::Utc;

use crate::automation::BrowserAutomationBackend;
use crate::model::{ChromeInstallRecord, ExtensionActionResult, ManagerSnapshot, RepositoryConfig};
use crate::repository::{build_snapshot, hash_directory, RepositoryClient};
use crate::storage::StoragePaths;

pub struct ManagerService {
    paths: StoragePaths,
    repository: RepositoryClient,
    automation: Arc<dyn BrowserAutomationBackend>,
}

impl ManagerService {
    pub fn new(automation: Arc<dyn BrowserAutomationBackend>) -> Result<Self, String> {
        let config: RepositoryConfig = serde_json::from_str(include_str!("../resources/repository.json"))
            .map_err(|error| format!("Embedded repository configuration is invalid: {error}"))?;
        let paths = StoragePaths::discover()?;
        paths.ensure()?;
        let repository = RepositoryClient::new(config)?;
        Ok(Self { paths, repository, automation })
    }

    pub fn snapshot(&self) -> Result<ManagerSnapshot, String> {
        let repository = self.paths.load_repository_state()?;
        let chrome = self.paths.load_chrome_state()?;
        Ok(build_snapshot(&self.paths, &repository, &chrome, self.repository.repository_url()))
    }

    pub async fn sync(&mut self) -> Result<ManagerSnapshot, String> {
        let mut repository = self.paths.load_repository_state()?;
        let chrome = self.paths.load_chrome_state()?;
        self.paths.log("Extension synchronization started");
        self.repository.sync(&self.paths, &mut repository, &chrome).await.map_err(|error| {
            self.paths.log(&format!("Extension synchronization failed: {error}"));
            error
        })?;
        self.paths.log("Extension synchronization completed");
        Ok(build_snapshot(&self.paths, &repository, &chrome, self.repository.repository_url()))
    }

    pub async fn install(&mut self, id: &str) -> Result<ExtensionActionResult, String> {
        let repository = self.paths.load_repository_state()?;
        let mut chrome = self.paths.load_chrome_state()?;
        if chrome.extensions.contains_key(id) {
            return Err(format!("{id} is already registered as installed"));
        }
        let extension = repository.extensions.get(id).ok_or_else(|| format!("Unknown extension: {id}"))?;
        ensure_actionable(extension.problem.as_deref())?;
        let version = extension.active_version.clone().ok_or_else(|| format!("{id} has not been downloaded yet"))?;
        let path = self.paths.extension_dir(id);
        let automation = Arc::clone(&self.automation);
        let action_version = version.clone();
        let chrome_id = tauri::async_runtime::spawn_blocking(move || automation.install(&path, &action_version))
            .await
            .map_err(|error| format!("Chrome automation task failed: {error}"))??;
        chrome.extensions.insert(id.to_string(), ChromeInstallRecord {
            chrome_extension_id: chrome_id,
            version,
            installed_at: Utc::now().to_rfc3339(),
        });
        self.paths.save_chrome_state(&chrome)?;
        self.paths.log(&format!("Installed extension {id}"));
        self.result("Extension installed successfully", &repository, &chrome)
    }

    pub async fn update(&mut self, id: &str) -> Result<ExtensionActionResult, String> {
        let mut repository = self.paths.load_repository_state()?;
        let mut chrome = self.paths.load_chrome_state()?;
        let installed = chrome.extensions.get(id).cloned().ok_or_else(|| format!("{id} is not registered as installed"))?;
        let extension = repository.extensions.get_mut(id).ok_or_else(|| format!("Unknown extension: {id}"))?;
        ensure_actionable(extension.problem.as_deref())?;
        if hash_directory(&self.paths.extension_dir(id))? != extension.active_hashes {
            return Err("Local files have changed; update is blocked".into());
        }
        let pending_version = extension.pending_version.clone().ok_or_else(|| format!("No prepared update exists for {id}"))?;
        let pending = self.paths.pending_dir(id, &pending_version);
        let active = self.paths.extension_dir(id);
        if !pending.is_dir() {
            return Err("The prepared update directory is missing; sync again".into());
        }

        let backup = self.paths.backups.join(format!("{id}-{}", Utc::now().timestamp_millis()));
        fs::rename(&active, &backup).map_err(|error| format!("Could not back up the active extension: {error}"))?;
        if let Err(error) = fs::rename(&pending, &active) {
            let _ = fs::rename(&backup, &active);
            return Err(format!("Could not activate the prepared update: {error}"));
        }

        let automation = Arc::clone(&self.automation);
        let chrome_id = installed.chrome_extension_id.clone();
        let action_version = pending_version.clone();
        let action = tauri::async_runtime::spawn_blocking(move || automation.reload(&chrome_id, &action_version))
            .await
            .map_err(|error| format!("Chrome automation task failed: {error}"))?;
        if let Err(error) = action {
            if let Some(parent) = pending.parent() { let _ = fs::create_dir_all(parent); }
            let _ = fs::rename(&active, &pending);
            let _ = fs::rename(&backup, &active);
            let automation = Arc::clone(&self.automation);
            let chrome_id = installed.chrome_extension_id.clone();
            let previous_version = installed.version.clone();
            let _ = tauri::async_runtime::spawn_blocking(move || automation.reload(&chrome_id, &previous_version)).await;
            self.paths.log(&format!("Update rollback completed for {id}: {error}"));
            return Err(format!("Chrome could not apply the update, so the previous version was restored: {error}"));
        }

        extension.active_version = Some(pending_version.clone());
        extension.active_hashes = std::mem::take(&mut extension.pending_hashes);
        extension.pending_version = None;
        chrome.extensions.insert(id.to_string(), ChromeInstallRecord {
            chrome_extension_id: installed.chrome_extension_id,
            version: pending_version,
            installed_at: Utc::now().to_rfc3339(),
        });
        self.paths.save_repository_state(&repository)?;
        self.paths.save_chrome_state(&chrome)?;
        if backup.exists() {
            fs::remove_dir_all(&backup).map_err(|error| format!("Update succeeded but backup cleanup failed: {error}"))?;
        }
        self.paths.log(&format!("Updated extension {id}"));
        self.result("Extension updated successfully", &repository, &chrome)
    }

    pub async fn remove(&mut self, id: &str) -> Result<ExtensionActionResult, String> {
        let repository = self.paths.load_repository_state()?;
        let mut chrome = self.paths.load_chrome_state()?;
        let installed = chrome.extensions.get(id).cloned().ok_or_else(|| format!("{id} is not registered as installed"))?;
        let automation = Arc::clone(&self.automation);
        tauri::async_runtime::spawn_blocking(move || automation.remove(&installed.chrome_extension_id))
            .await
            .map_err(|error| format!("Chrome automation task failed: {error}"))??;
        chrome.extensions.remove(id);
        self.paths.save_chrome_state(&chrome)?;
        self.paths.log(&format!("Removed extension {id} from Chrome"));
        self.result("Extension removed from Chrome; local files were kept", &repository, &chrome)
    }

    pub async fn repair(&mut self, id: &str) -> Result<ExtensionActionResult, String> {
        let repository = self.paths.load_repository_state()?;
        let mut chrome = self.paths.load_chrome_state()?;
        let extension = repository.extensions.get(id).ok_or_else(|| format!("Unknown extension: {id}"))?;
        ensure_actionable(extension.problem.as_deref())?;
        let version = extension.active_version.clone().ok_or_else(|| "No local version is ready to repair".to_string())?;
        let path = self.paths.extension_dir(id);
        let automation = Arc::clone(&self.automation);
        let action_version = version.clone();
        let chrome_id = tauri::async_runtime::spawn_blocking(move || automation.install(&path, &action_version))
            .await
            .map_err(|error| format!("Chrome automation task failed: {error}"))??;
        chrome.extensions.insert(id.to_string(), ChromeInstallRecord {
            chrome_extension_id: chrome_id,
            version,
            installed_at: Utc::now().to_rfc3339(),
        });
        self.paths.save_chrome_state(&chrome)?;
        self.result("Chrome installation repaired", &repository, &chrome)
    }

    fn result(&self, message: &str, repository: &crate::model::RepositoryState, chrome: &crate::model::ChromeState) -> Result<ExtensionActionResult, String> {
        Ok(ExtensionActionResult {
            message: message.into(),
            snapshot: build_snapshot(&self.paths, repository, chrome, self.repository.repository_url()),
        })
    }
}

fn ensure_actionable(problem: Option<&str>) -> Result<(), String> {
    problem.map_or(Ok(()), |problem| Err(problem.to_string()))
}
