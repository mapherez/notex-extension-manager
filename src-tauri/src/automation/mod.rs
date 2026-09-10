use std::path::Path;

pub trait BrowserAutomationBackend: Send + Sync {
    fn preflight(&self) -> Result<(), String>;
    fn install(&self, extension_path: &Path, expected_version: &str) -> Result<String, String>;
    fn reload(&self, chrome_extension_id: &str, expected_version: &str) -> Result<(), String>;
    fn remove(&self, chrome_extension_id: &str) -> Result<(), String>;
}

#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "windows")]
pub use windows::WindowsChromeAutomation;

#[cfg(target_os = "macos")]
mod macos;

#[cfg(target_os = "macos")]
pub use macos::MacOsChromeAutomation;

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
pub struct UnsupportedAutomation;

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
impl BrowserAutomationBackend for UnsupportedAutomation {
    fn preflight(&self) -> Result<(), String> {
        Err("Chrome automation is available only on Windows and macOS".into())
    }

    fn install(&self, _: &Path, _: &str) -> Result<String, String> {
        self.preflight()?;
        unreachable!()
    }

    fn reload(&self, _: &str, _: &str) -> Result<(), String> {
        self.preflight()
    }

    fn remove(&self, _: &str) -> Result<(), String> {
        self.preflight()
    }
}
