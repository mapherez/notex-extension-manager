use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::thread;
use std::time::{Duration, Instant};

use uiautomation::inputs::Keyboard;
use uiautomation::patterns::{UIInvokePattern, UIValuePattern, UIWindowPattern};
use uiautomation::types::{ControlType, Rect};
use uiautomation::{UIAutomation, UIElement};

use super::BrowserAutomationBackend;

const LOAD_UNPACKED_ID: &str = "loadUnpacked";
const FOLDER_PICKER_ADDRESS_BAR_ID: &str = "41477";
const FOLDER_PICKER_CONFIRM_ID: &str = "1";
const REMOVE_BUTTON_ID: &str = "removeButton";
const RELOAD_BUTTON_IDS: &[&str] = &["dev-reload-button", "terminated-reload-button"];
const RELOAD_NAMES: &[&str] = &["Reload", "Recarregar"];
const REMOVE_NAMES: &[&str] = &["Remove", "Remover"];

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
            candidates.push(PathBuf::from(local).join(r"Google\Chrome\Application\chrome.exe"));
        }
        candidates
            .into_iter()
            .find(|path| path.is_file())
            .ok_or_else(|| "Google Chrome Stable was not found in a standard location".into())
    }

    fn open_extensions_page(&self) -> Result<(UIAutomation, UIElement), String> {
        let chrome = Self::chrome_path()?;
        let automation = UIAutomation::new()
            .map_err(|error| format!("Could not initialize Windows UI Automation: {error}"))?;
        let existing_handles: BTreeSet<isize> = chrome_windows(&automation)
            .into_iter()
            .filter_map(|window| {
                window
                    .get_native_window_handle()
                    .ok()
                    .map(|handle| handle.into())
            })
            .collect();

        Command::new(chrome)
            .args(["--profile-directory=Default", "--new-window", "about:blank"])
            .spawn()
            .map_err(|error| format!("Could not open Google Chrome: {error}"))?;

        let deadline = Instant::now() + Duration::from_secs(8);
        let window = loop {
            if let Some(window) = chrome_windows(&automation).into_iter().find(|window| {
                window
                    .get_native_window_handle()
                    .ok()
                    .map(|handle| !existing_handles.contains(&handle.into()))
                    .unwrap_or(false)
            }) {
                break window;
            }
            if Instant::now() >= deadline {
                return Err("Chrome did not expose the new browser window to Windows".to_string());
            }
            thread::sleep(Duration::from_millis(200));
        };

        window
            .set_focus()
            .map_err(|error| format!("Chrome could not receive focus: {error}"))?;
        thread::sleep(Duration::from_millis(250));
        // Queue each shortcut/text sequence as a single SendInput batch so the
        // focus hand-off is brief and the URL does not appear character by character.
        let keyboard = Keyboard::new().interval(0);
        keyboard
            .send_keys("{ctrl}(l)")
            .and_then(|_| keyboard.send_text("chrome://extensions/"))
            .and_then(|_| keyboard.send_keys("{enter}"))
            .map_err(|error| {
                format!("Could not navigate Chrome to chrome://extensions: {error}")
            })?;

        let navigation_deadline = Instant::now() + Duration::from_secs(8);
        loop {
            let title = window.get_name().unwrap_or_default().to_lowercase();
            if title.starts_with("extensions") || title.starts_with("extens") {
                break;
            }
            if Instant::now() >= navigation_deadline {
                return Err(
                    "Chrome opened, but did not navigate to chrome://extensions".to_string()
                );
            }
            thread::sleep(Duration::from_millis(200));
        }

        Ok((automation, window))
    }

    fn with_extensions_page<T>(
        &self,
        action: impl FnOnce(&UIAutomation, &UIElement) -> Result<T, String>,
    ) -> Result<T, String> {
        let (automation, window) = self.open_extensions_page()?;
        let result = action(&automation, &window);
        if let Ok(pattern) = window.get_pattern::<UIWindowPattern>() {
            let _ = pattern.close();
        }
        result
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
        dialog
            .set_focus()
            .map_err(|error| format!("The folder picker could not receive focus: {error}"))?;
        let keyboard = Keyboard::new().interval(0);
        keyboard.send_keys("{ctrl}(l)").map_err(|error| {
            format!("The folder picker's address bar could not be opened: {error}")
        })?;
        thread::sleep(Duration::from_millis(100));

        let edit = automation
            .get_focused_element()
            .ok()
            .filter(|element| element.get_control_type().ok() == Some(ControlType::Edit))
            .or_else(|| {
                automation
                    .create_matcher()
                    .from(dialog.clone())
                    .control_type(ControlType::Edit)
                    .filter_fn(Box::new(|element: &UIElement| {
                        Ok(element.get_automation_id()? == FOLDER_PICKER_ADDRESS_BAR_ID)
                    }))
                    .depth(12)
                    .timeout(1_000)
                    .find_first()
                    .ok()
            })
            .ok_or_else(|| {
                "The folder picker's address field was not exposed by Windows".to_string()
            })?;
        edit.get_pattern::<UIValuePattern>()
            .and_then(|pattern| pattern.set_value(&path_text))
            .map_err(|error| format!("The extension folder path could not be entered: {error}"))?;
        keyboard
            .send_keys("{enter}")
            .map_err(|error| format!("The extension folder could not be opened: {error}"))?;
        thread::sleep(Duration::from_millis(500));

        let confirm = automation
            .create_matcher()
            .from(dialog)
            .control_type(ControlType::Button)
            .filter_fn(Box::new(|element: &UIElement| {
                Ok(element.get_automation_id()? == FOLDER_PICKER_CONFIRM_ID)
            }))
            .depth(12)
            .timeout(4_000)
            .find_first()
            .map_err(|_| {
                "The folder picker's confirm button was not exposed by Windows".to_string()
            })?;
        invoke(&confirm, "Select Folder")
    }

    fn extension_ids(automation: &UIAutomation, window: &UIElement) -> BTreeSet<String> {
        automation
            .create_matcher()
            .from(window.clone())
            .filter_fn(Box::new(|element: &UIElement| {
                Ok(extract_chrome_extension_id(&element.get_name()?).is_some())
            }))
            .depth(30)
            .timeout(0)
            .find_all()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|element| {
                element
                    .get_name()
                    .ok()
                    .and_then(|name| extract_chrome_extension_id(&name))
            })
            .collect()
    }

    fn find_extension_card(
        automation: &UIAutomation,
        window: &UIElement,
        chrome_extension_id: &str,
    ) -> Result<UIElement, String> {
        let expected_id = chrome_extension_id.to_string();
        let id_node = automation
            .create_matcher()
            .from(window.clone())
            .filter_fn(Box::new(move |element: &UIElement| {
                Ok(element
                    .get_name()
                    .ok()
                    .and_then(|name| extract_chrome_extension_id(&name))
                    .as_deref()
                    == Some(expected_id.as_str()))
            }))
            .depth(30)
            .timeout(6_000)
            .find_first()
            .map_err(|_| {
                format!(
                    "Chrome extension {chrome_extension_id} was not found on the Extensions page"
                )
            })?;
        let walker = automation.get_control_view_walker().map_err(|error| {
            format!("Could not navigate the Chrome accessibility tree: {error}")
        })?;
        let mut current = id_node;
        for _ in 0..10 {
            if find_named(
                automation,
                &current,
                RELOAD_NAMES,
                Some(ControlType::Button),
                8,
                0,
            )
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
        Err(format!(
            "Could not locate the card for {chrome_extension_id}"
        ))
    }

    fn find_extension_button(
        automation: &UIAutomation,
        window: &UIElement,
        chrome_extension_id: &str,
        automation_ids: &'static [&'static str],
        label: &str,
    ) -> Result<UIElement, String> {
        // Chromium assigns the extension ID to the <extensions-item> host. If
        // that host is present in the accessibility tree, scope the lookup to
        // it directly. Some Chrome builds flatten the host, so retain the
        // spatial lookup below as a fallback.
        let card_id = chrome_extension_id.to_string();
        if let Ok(card) = automation
            .create_matcher()
            .from(window.clone())
            .filter_fn(Box::new(move |element: &UIElement| {
                Ok(element.get_automation_id()? == card_id)
            }))
            .depth(30)
            .timeout(0)
            .find_first()
        {
            if let Ok(button) = automation
                .create_matcher()
                .from(card)
                .control_type(ControlType::Button)
                .filter_fn(Box::new(move |element: &UIElement| {
                    let automation_id = element.get_automation_id()?;
                    Ok(automation_ids.contains(&automation_id.as_str()))
                }))
                .depth(12)
                .timeout(0)
                .find_first()
            {
                return Ok(button);
            }
        }

        let expected_id = chrome_extension_id.to_string();
        let id_node = automation
            .create_matcher()
            .from(window.clone())
            .filter_fn(Box::new(move |element: &UIElement| {
                Ok(element
                    .get_name()
                    .ok()
                    .and_then(|name| extract_chrome_extension_id(&name))
                    .as_deref()
                    == Some(expected_id.as_str()))
            }))
            .depth(30)
            .timeout(6_000)
            .find_first()
            .map_err(|_| {
                format!(
                    "Chrome extension {chrome_extension_id} was not found on the Extensions page"
                )
            })?;
        let id_bounds = id_node.get_bounding_rectangle().map_err(|error| {
            format!("Could not locate extension {chrome_extension_id} on screen: {error}")
        })?;

        automation
            .create_matcher()
            .from(window.clone())
            .control_type(ControlType::Button)
            .filter_fn(Box::new(move |element: &UIElement| {
                let automation_id = element.get_automation_id()?;
                Ok(automation_ids.contains(&automation_id.as_str()))
            }))
            .depth(30)
            .timeout(3_000)
            .find_all()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|button| {
                button
                    .get_bounding_rectangle()
                    .ok()
                    .filter(usable_bounds)
                    .map(|bounds| (button, center_distance_squared(&id_bounds, &bounds)))
            })
            .min_by_key(|(_, distance)| *distance)
            .map(|(button, _)| button)
            .ok_or_else(|| format!("{label} was not found for {chrome_extension_id}"))
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
        self.with_extensions_page(|automation, window| {
            let before = Self::extension_ids(automation, window);
            let load = automation
                .create_matcher()
                .from(window.clone())
                .control_type(ControlType::Button)
                .filter_fn(Box::new(|element: &UIElement| {
                    Ok(element.get_automation_id()? == LOAD_UNPACKED_ID)
                }))
                .depth(25)
                .timeout(8_000)
                .find_first()
                .map_err(|_| format!("Chrome did not expose the #{LOAD_UNPACKED_ID} button"))?;
            invoke(&load, "Load unpacked")?;
            Self::choose_extension_folder(automation, extension_path)?;
            thread::sleep(Duration::from_millis(900));
            let after = Self::extension_ids(automation, window);
            let chrome_id = after
                .difference(&before)
                .next()
                .cloned()
                .ok_or_else(|| {
                    "Chrome did not expose a newly installed extension. Check the extension manifest for errors."
                        .to_string()
                })?;
            self.verify_with_window(automation, window, &chrome_id, expected_version)?;
            Ok(chrome_id)
        })
    }

    fn reload(&self, chrome_extension_id: &str, expected_version: &str) -> Result<(), String> {
        self.with_extensions_page(|automation, window| {
            let reload = Self::find_extension_button(
                automation,
                window,
                chrome_extension_id,
                RELOAD_BUTTON_IDS,
                "Reload",
            )
            .map_err(|_| format!("Reload was not found for {chrome_extension_id}"))?;
            invoke(&reload, "Reload")?;
            thread::sleep(Duration::from_millis(700));
            self.verify_with_window(automation, window, chrome_extension_id, expected_version)
        })
    }

    fn remove(&self, chrome_extension_id: &str) -> Result<(), String> {
        self.with_extensions_page(|automation, window| {
            let remove = Self::find_extension_button(
                automation,
                window,
                chrome_extension_id,
                &[REMOVE_BUTTON_ID],
                "Remove",
            )
            .map_err(|_| format!("Remove was not found for {chrome_extension_id}"))?;
            let existing_remove_buttons: BTreeSet<Vec<i32>> = automation
                .create_matcher()
                .from(window.clone())
                .control_type(ControlType::Button)
                .filter_fn(Box::new(|element: &UIElement| {
                    Ok(name_matches(&element.get_name()?, REMOVE_NAMES))
                }))
                .depth(30)
                .timeout(0)
                .find_all()
                .unwrap_or_default()
                .into_iter()
                .filter_map(|button| button.get_runtime_id().ok())
                .collect();
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
                .find(|button| {
                    button
                        .get_runtime_id()
                        .map(|id| !existing_remove_buttons.contains(&id))
                        .unwrap_or(false)
                })
                .ok_or_else(|| "Chrome's removal confirmation button was not found".to_string())?;
            invoke(&confirm, "Confirm Remove")?;
            let deadline = Instant::now() + Duration::from_secs(5);
            while Self::extension_ids(automation, window).contains(chrome_extension_id) {
                if Instant::now() >= deadline {
                    return Err("Chrome still reports the extension after Remove".into());
                }
                thread::sleep(Duration::from_millis(100));
            }
            Ok(())
        })
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

fn chrome_windows(automation: &UIAutomation) -> Vec<UIElement> {
    automation
        .create_matcher()
        .control_type(ControlType::Window)
        .filter_fn(Box::new(|element: &UIElement| {
            Ok(element.get_classname()?.starts_with("Chrome_WidgetWin"))
        }))
        .depth(3)
        .timeout(0)
        .find_all()
        .unwrap_or_default()
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
    names
        .iter()
        .any(|candidate| value.eq_ignore_ascii_case(candidate))
}

fn usable_bounds(bounds: &Rect) -> bool {
    bounds.get_right() > bounds.get_left() && bounds.get_bottom() > bounds.get_top()
}

fn center_distance_squared(left: &Rect, right: &Rect) -> i64 {
    // Keep coordinates doubled so calculating the centre stays integer-only.
    let left_x = i64::from(left.get_left()) + i64::from(left.get_right());
    let left_y = i64::from(left.get_top()) + i64::from(left.get_bottom());
    let right_x = i64::from(right.get_left()) + i64::from(right.get_right());
    let right_y = i64::from(right.get_top()) + i64::from(right.get_bottom());
    (left_x - right_x).pow(2) + (left_y - right_y).pow(2)
}

fn invoke(element: &UIElement, label: &str) -> Result<(), String> {
    element
        .get_pattern::<UIInvokePattern>()
        .and_then(|pattern| pattern.invoke())
        .map_err(|error| format!("{label} could not be invoked through UI Automation: {error}"))
}

fn extract_chrome_extension_id(value: &str) -> Option<String> {
    value
        .split(|character| !('a'..='p').contains(&character))
        .find(|candidate| candidate.len() == 32)
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use uiautomation::types::Rect;

    use super::{center_distance_squared, extract_chrome_extension_id, usable_bounds};

    #[test]
    fn extracts_plain_and_prefixed_chrome_ids() {
        let id = "abcdefghijklmnopabcdefghijklmnop";
        assert_eq!(extract_chrome_extension_id(id).as_deref(), Some(id));
        assert_eq!(
            extract_chrome_extension_id(&format!("ID: {id}")).as_deref(),
            Some(id)
        );
        assert_eq!(extract_chrome_extension_id("not an extension id"), None);
    }

    #[test]
    fn spatial_distance_selects_the_control_in_the_same_card() {
        let extension_id = Rect::new(420, 220, 620, 240);
        let same_card_button = Rect::new(400, 270, 500, 310);
        let other_column_button = Rect::new(900, 270, 1_000, 310);
        let other_row_button = Rect::new(400, 570, 500, 610);

        let same_card_distance = center_distance_squared(&extension_id, &same_card_button);
        assert!(same_card_distance < center_distance_squared(&extension_id, &other_column_button));
        assert!(same_card_distance < center_distance_squared(&extension_id, &other_row_button));
    }

    #[test]
    fn rejects_empty_accessibility_bounds() {
        assert!(!usable_bounds(&Rect::default()));
        assert!(usable_bounds(&Rect::new(10, 20, 30, 40)));
    }
}
