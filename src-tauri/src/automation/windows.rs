use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::thread;
use std::time::Duration;

use uiautomation::patterns::{UIInvokePattern, UITogglePattern, UIValuePattern};
use uiautomation::types::{ControlType, ToggleState};
use uiautomation::{UIAutomation, UIElement};

use super::BrowserAutomationBackend;

const DEVELOPER_MODE_NAMES: &[&str] = &["Developer mode", "Modo de programador"];
const LOAD_UNPACKED_NAMES: &[&str] = &[
    "Load unpacked",
    "Carregar expandida",
    "Carregar descompactada",
    "Carregar sem compactação",
];
const RELOAD_NAMES: &[&str] = &["Reload", "Recarregar"];
const REMOVE_NAMES: &[&str] = &["Remove", "Remover"];
const SELECT_FOLDER_NAMES: &[&str] = &[
    "Select Folder",
    "Select folder",
    "Selecionar pasta",
    "Selecionar Pasta",
    "Open",
    "Abrir",
];

pub struct WindowsChromeAutomation;

impl WindowsChromeAutomation {
    pub fn new() -> Self {
        Self
    }

    fn chrome_path() -> Result<PathBuf, String> {
        let mut candidates = vec![
            PathBuf::from(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
            PathBuf::from(r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"),
        ];
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            candidates.push(
                PathBuf::from(local).join(r"Google\Chrome\Application\chrome.exe"),
            );
        }
        candidates
            .into_iter()
            .find(|path| path.is_file())
            .ok_or_else(|| "Google Chrome Stable was not found in a standard location".into())
    }

    fn open_extensions_page(&self) -> Result<(UIAutomation, UIElement), String> {
        let chrome = Self::chrome_path()?;
        Command::new(chrome)
            .args(["--force-renderer-accessibility", "chrome://extensions"])
            .spawn()
            .map_err(|error| format!("Could not open Google Chrome: {error}"))?;

        let automation = UIAutomation::new()
            .map_err(|error| format!("Could not initialize Windows UI Automation: {error}"))?;
        let window = automation
            .create_matcher()
            .control_type(ControlType::Window)
            .filter_fn(Box::new(|element: &UIElement| {
                Ok(element.get_classname()?.starts_with("Chrome_WidgetWin"))
            }))
            .depth(3)
            .timeout(12_000)
            .find_first()
            .map_err(|_| {
                "Chrome opened, but its accessible window could not be found. Ensure the desktop is unlocked."
                    .to_string()
            })?;
        window
            .set_focus()
            .map_err(|error| format!("Chrome could not receive focus: {error}"))?;
        thread::sleep(Duration::from_millis(500));
        Ok((automation, window))
    }

    fn ensure_developer_mode(
        automation: &UIAutomation,
        window: &UIElement,
    ) -> Result<(), String> {
        let toggle = find_named(automation, window, DEVELOPER_MODE_NAMES, None, 25, 8_000)
            .map_err(|_| {
                "Developer Mode was not exposed by Chrome in English or pt-PT".to_string()
            })?;
        if let Ok(pattern) = toggle.get_pattern::<UITogglePattern>() {
            if pattern
                .get_toggle_state()
                .map_err(|error| format!("Developer Mode state could not be read: {error}"))?
                == ToggleState::Off
            {
                pattern
                    .toggle()
                    .map_err(|error| format!("Developer Mode could not be enabled: {error}"))?;
                thread::sleep(Duration::from_millis(500));
            }
            return Ok(());
        }
        invoke(&toggle, "Developer Mode")
    }

    fn choose_extension_folder(
        automation: &UIAutomation,
        extension_path: &Path,
    ) -> Result<(), String> {
        let dialog = automation
            .create_matcher()
            .control_type(ControlType::Window)
            .filter_fn(Box::new(|element: &UIElement| {
                let class = element.get_classname()?;
                Ok(class == "#32770" || class == "DirectUIHWND")
            }))
            .depth(4)
            .timeout(8_000)
            .find_first()
            .map_err(|_| "The Windows folder picker did not appear".to_string())?;

        let path_text = extension_path.to_string_lossy().to_string();
        let edit = automation
            .create_matcher()
            .from(dialog.clone())
            .control_type(ControlType::Edit)
            .filter_fn(Box::new(|element: &UIElement| {
                let id = element.get_automation_id()?;
                Ok(id == "1148" || id == "1001" || id == "41477")
            }))
            .depth(12)
            .timeout(2_000)
            .find_first()
            .or_else(|_| {
                automation
                    .create_matcher()
                    .from(dialog.clone())
                    .control_type(ControlType::Edit)
                    .depth(12)
                    .timeout(2_000)
                    .find_first()
            })
            .map_err(|_| "The folder path field was not exposed by Windows".to_string())?;
        edit.get_pattern::<UIValuePattern>()
            .and_then(|pattern| pattern.set_value(&path_text))
            .map_err(|error| format!("The extension folder path could not be entered: {error}"))?;

        let confirm = find_named(
            automation,
            &dialog,
            SELECT_FOLDER_NAMES,
            Some(ControlType::Button),
            12,
            4_000,
        )
        .map_err(|_| "The Select Folder button was not exposed by Windows".to_string())?;
        invoke(&confirm, "Select Folder")
    }

    fn extension_ids(automation: &UIAutomation, window: &UIElement) -> BTreeSet<String> {
        automation
            .create_matcher()
            .from(window.clone())
            .filter_fn(Box::new(|element: &UIElement| {
                Ok(is_chrome_extension_id(&element.get_name()?))
            }))
            .depth(30)
            .timeout(0)
            .find_all()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|element| element.get_name().ok())
            .collect()
    }

    fn find_extension_card(
        automation: &UIAutomation,
        window: &UIElement,
        chrome_extension_id: &str,
    ) -> Result<UIElement, String> {
        let id_node = automation
            .create_matcher()
            .from(window.clone())
            .match_name(chrome_extension_id)
            .depth(30)
            .timeout(6_000)
            .find_first()
            .map_err(|_| {
                format!("Chrome extension {chrome_extension_id} was not found on the Extensions page")
            })?;
        let walker = automation
            .get_control_view_walker()
            .map_err(|error| format!("Could not navigate the Chrome accessibility tree: {error}"))?;
        let mut current = id_node;
        for _ in 0..10 {
            if find_named(automation, &current, RELOAD_NAMES, Some(ControlType::Button), 8, 0)
                .is_ok()
                || find_named(
                    automation,
                    &current,
                    REMOVE_NAMES,
                    Some(ControlType::Button),
                    8,
                    0,
                )
                .is_ok()
            {
                return Ok(current);
            }
            current = walker
                .get_parent(&current)
                .map_err(|_| format!("Could not locate the card for {chrome_extension_id}"))?;
        }
        Err(format!("Could not locate the card for {chrome_extension_id}"))
    }
}

impl BrowserAutomationBackend for WindowsChromeAutomation {
    fn preflight(&self) -> Result<(), String> {
        Self::chrome_path().map(|_| ())
    }

    fn install(&self, extension_path: &Path, expected_version: &str) -> Result<String, String> {
        self.preflight()?;
        if !extension_path.join("manifest.json").is_file() {
            return Err("The prepared extension does not contain manifest.json".into());
        }
        let (automation, window) = self.open_extensions_page()?;
        Self::ensure_developer_mode(&automation, &window)?;
        let before = Self::extension_ids(&automation, &window);
        let load = find_named(
            &automation,
            &window,
            LOAD_UNPACKED_NAMES,
            Some(ControlType::Button),
            25,
            8_000,
        )
        .map_err(|_| "Load unpacked was not exposed by Chrome in English or pt-PT".to_string())?;
        invoke(&load, "Load unpacked")?;
        Self::choose_extension_folder(&automation, extension_path)?;
        thread::sleep(Duration::from_millis(900));
        let after = Self::extension_ids(&automation, &window);
        let chrome_id = after
            .difference(&before)
            .next()
            .cloned()
            .ok_or_else(|| {
                "Chrome did not expose a newly installed extension. Check the extension manifest for errors."
                    .to_string()
            })?;
        self.verify_with_window(&automation, &window, &chrome_id, expected_version)?;
        Ok(chrome_id)
    }

    fn reload(&self, chrome_extension_id: &str, expected_version: &str) -> Result<(), String> {
        let (automation, window) = self.open_extensions_page()?;
        Self::ensure_developer_mode(&automation, &window)?;
        let card = Self::find_extension_card(&automation, &window, chrome_extension_id)?;
        let reload = find_named(
            &automation,
            &card,
            RELOAD_NAMES,
            Some(ControlType::Button),
            8,
            3_000,
        )
        .map_err(|_| format!("Reload was not found for {chrome_extension_id}"))?;
        invoke(&reload, "Reload")?;
        thread::sleep(Duration::from_millis(700));
        self.verify_with_window(&automation, &window, chrome_extension_id, expected_version)
    }

    fn remove(&self, chrome_extension_id: &str) -> Result<(), String> {
        let (automation, window) = self.open_extensions_page()?;
        Self::ensure_developer_mode(&automation, &window)?;
        let card = Self::find_extension_card(&automation, &window, chrome_extension_id)?;
        let remove = find_named(
            &automation,
            &card,
            REMOVE_NAMES,
            Some(ControlType::Button),
            8,
            3_000,
        )
        .map_err(|_| format!("Remove was not found for {chrome_extension_id}"))?;
        let original_runtime_id = remove.get_runtime_id().unwrap_or_default();
        invoke(&remove, "Remove")?;
        thread::sleep(Duration::from_millis(500));
        let buttons = automation
            .create_matcher()
            .from(window.clone())
            .control_type(ControlType::Button)
            .filter_fn(Box::new(|element: &UIElement| {
                let name = element.get_name()?;
                Ok(name_matches(&name, REMOVE_NAMES))
            }))
            .depth(30)
            .timeout(5_000)
            .find_all()
            .map_err(|_| "Chrome's removal confirmation did not appear".to_string())?;
        let confirm = buttons
            .into_iter()
            .find(|button| button.get_runtime_id().unwrap_or_default() != original_runtime_id)
            .ok_or_else(|| "Chrome's removal confirmation button was not found".to_string())?;
        invoke(&confirm, "Confirm Remove")?;
        thread::sleep(Duration::from_millis(500));
        if Self::extension_ids(&automation, &window).contains(chrome_extension_id) {
            return Err("Chrome still reports the extension after Remove".into());
        }
        Ok(())
    }

    fn verify(&self, chrome_extension_id: &str, expected_version: &str) -> Result<(), String> {
        let (automation, window) = self.open_extensions_page()?;
        self.verify_with_window(&automation, &window, chrome_extension_id, expected_version)
    }
}

impl WindowsChromeAutomation {
    fn verify_with_window(
        &self,
        automation: &UIAutomation,
        window: &UIElement,
        chrome_extension_id: &str,
        expected_version: &str,
    ) -> Result<(), String> {
        let card = Self::find_extension_card(automation, window, chrome_extension_id)?;
        let expected = expected_version.to_string();
        automation
            .create_matcher()
            .from(card)
            .filter_fn(Box::new(move |element: &UIElement| {
                let name = element.get_name()?;
                Ok(name == expected
                    || name.contains(&format!("Version {expected}"))
                    || name.contains(&format!("Versão {expected}")))
            }))
            .depth(12)
            .timeout(5_000)
            .find_first()
            .map_err(|_| {
                format!(
                    "Chrome found {chrome_extension_id}, but did not confirm version {expected_version}"
                )
            })?;
        Ok(())
    }
}

fn find_named(
    automation: &UIAutomation,
    root: &UIElement,
    names: &'static [&'static str],
    control_type: Option<ControlType>,
    depth: u32,
    timeout: u64,
) -> uiautomation::Result<UIElement> {
    let matcher = automation
        .create_matcher()
        .from(root.clone())
        .filter_fn(Box::new(move |element: &UIElement| {
            Ok(name_matches(&element.get_name()?, names))
        }))
        .depth(depth)
        .timeout(timeout);
    match control_type {
        Some(kind) => matcher.control_type(kind).find_first(),
        None => matcher.find_first(),
    }
}

fn name_matches(value: &str, names: &[&str]) -> bool {
    names.iter().any(|candidate| value.eq_ignore_ascii_case(candidate))
}

fn invoke(element: &UIElement, label: &str) -> Result<(), String> {
    element
        .get_pattern::<UIInvokePattern>()
        .and_then(|pattern| pattern.invoke())
        .map_err(|error| format!("{label} could not be invoked through UI Automation: {error}"))
}

fn is_chrome_extension_id(value: &str) -> bool {
    value.len() == 32 && value.chars().all(|character| ('a'..='p').contains(&character))
}
