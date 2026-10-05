#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    let parsed = tauri::Url::parse(&url).map_err(|error| error.to_string())?;
    if !matches!(parsed.scheme(), "http" | "https" | "mailto") || url.contains('\0') {
        return Err("Only web and mail links may be opened externally".into());
    }
    #[cfg(windows)]
    {
        use windows::core::{w, HSTRING, PCWSTR};
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        let address = HSTRING::from(url);
        let result = unsafe { ShellExecuteW(None, w!("open"), &address, PCWSTR::null(), PCWSTR::null(), SW_SHOWNORMAL) };
        if result.0 as isize <= 32 { return Err("The system could not open this link".into()); }
    }
    #[cfg(not(windows))]
    {
        let program = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
        std::process::Command::new(program).arg(url).spawn().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn open_document_path(path: String, reveal: bool) -> Result<(), String> {
    let target = std::fs::canonicalize(&path).map_err(|error| error.to_string())?;
    if !reveal {
        let extension = target.extension().and_then(|value| value.to_str()).unwrap_or("").to_lowercase();
        if !target.is_file() || !matches!(extension.as_str(), "pdf" | "html" | "htm" | "docx" | "epub" | "md" | "tex" | "svg" | "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "avif") {
            return Err("Only document and image files may be opened".into());
        }
    }
    #[cfg(windows)]
    {
        let raw = target.to_string_lossy();
        let shell_path = if let Some(unc) = raw.strip_prefix(r"\\?\UNC\") {
            format!(r"\\{}", unc)
        } else { raw.strip_prefix(r"\\?\").unwrap_or(&raw).to_string() };
        if reveal {
            let mut command = std::process::Command::new("explorer.exe");
            if target.is_file() { command.arg(format!("/select,{}", shell_path)); }
            else { command.arg(&shell_path); }
            command.spawn().map_err(|error| error.to_string())?;
        } else {
            use windows::core::{w, HSTRING, PCWSTR};
            use windows::Win32::UI::Shell::ShellExecuteW;
            use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
            let address = HSTRING::from(shell_path);
            let result = unsafe { ShellExecuteW(None, w!("open"), &address, PCWSTR::null(), PCWSTR::null(), SW_SHOWNORMAL) };
            if result.0 as isize <= 32 { return Err("The system could not open this document".into()); }
        }
    }
    #[cfg(not(windows))]
    {
        let target = if reveal && target.is_file() { target.parent().ok_or("Missing parent directory")? } else { &target };
        let program = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
        std::process::Command::new(program).arg(target).spawn().map_err(|error| error.to_string())?;
    }
    Ok(())
}
