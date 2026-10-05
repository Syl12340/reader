#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDiagnostics {
    executable: String,
    platform: String,
    native_version: String,
}

#[tauri::command]
pub fn runtime_diagnostics() -> RuntimeDiagnostics {
    RuntimeDiagnostics {
        executable: std::env::current_exe()
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_else(|_| "unavailable".into()),
        platform: format!("{} / {} / Tauri desktop", std::env::consts::OS, std::env::consts::ARCH),
        native_version: env!("CARGO_PKG_VERSION").into(),
    }
}
