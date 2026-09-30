use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};

#[cfg(windows)]
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2_7,
};
#[cfg(windows)]
use webview2_com::PrintToPdfCompletedHandler;
#[cfg(windows)]
use windows::core::PCWSTR;

#[tauri::command]
pub async fn export_pdf_native(
    app: AppHandle,
    path: String,
    html_content: String,
) -> Result<(), String> {
    #[cfg(not(windows))]
    {
        return Err("Silent PDF export is only supported on Windows in this version.".to_string());
    }

    #[cfg(windows)]
    {
        use std::sync::{Arc, Mutex};
        use tokio::sync::oneshot;
        use windows::core::{HSTRING, Interface};

        let label = format!(
            "pdf_export_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
        );

        let temp_path = std::env::temp_dir().join(format!("{}.html", label));
        std::fs::write(&temp_path, html_content.as_bytes())
            .map_err(|e| format!("Failed to write temporary PDF HTML: {}", e))?;

        let file_url = tauri::Url::from_file_path(&temp_path)
            .map_err(|_| format!("Failed to create file URL for {}", temp_path.display()))?;

        let window = match WebviewWindowBuilder::new(&app, label, WebviewUrl::External(file_url))
            .visible(false)
            .build()
        {
            Ok(window) => window,
            Err(e) => {
                let _ = std::fs::remove_file(&temp_path);
                return Err(format!("Failed to create hidden window: {}", e));
            }
        };

        // Wait for page to render completely (fonts, mathjax, etc)
        tokio::time::sleep(std::time::Duration::from_millis(2500)).await;

        let (tx, rx) = oneshot::channel();
        let tx = Arc::new(Mutex::new(Some(tx)));

        let setup_tx = Arc::clone(&tx);
        let setup_result = window.with_webview(move |webview| {
            let result = (|| -> Result<(), String> {
                let controller = webview.controller();
                let core_webview2 = unsafe {
                    controller
                        .CoreWebView2()
                        .map_err(|error| format!("Failed to get WebView2 core: {}", error))?
                };
                let core7: ICoreWebView2_7 = core_webview2
                    .cast()
                    .map_err(|error| format!("WebView2 PDF interface is unavailable: {}", error))?;

                let tx = Arc::clone(&tx);
                let handler = PrintToPdfCompletedHandler::create(Box::new(move |error_code, is_successful| {
                    let result = if error_code.is_ok() && is_successful {
                        Ok(())
                    } else {
                        Err(format!("PrintToPdf failed with error: {:?}", error_code))
                    };

                    if let Ok(mut guard) = tx.lock() {
                        if let Some(sender) = guard.take() {
                            let _ = sender.send(result);
                        }
                    }
                    Ok(())
                }));

                let path_hstr = HSTRING::from(&path);
                unsafe {
                    core7
                        .PrintToPdf(PCWSTR(path_hstr.as_ptr()), None, &handler)
                        .map_err(|error| format!("Failed to start PrintToPdf: {}", error))?;
                }
                Ok(())
            })();

            if let Err(error) = result {
                if let Ok(mut guard) = setup_tx.lock() {
                    if let Some(sender) = guard.take() {
                        let _ = sender.send(Err(error));
                    }
                }
            }
        });

        if let Err(error) = setup_result {
            let _ = window.close();
            let _ = std::fs::remove_file(&temp_path);
            return Err(format!("Webview operation failed: {}", error));
        }

        let res = match tokio::time::timeout(std::time::Duration::from_secs(45), rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err("Print callback channel closed unexpectedly".to_string()),
            Err(_) => Err("PDF export timed out after 45 seconds".to_string()),
        };

        // close the hidden window
        let _ = window.close();
        let _ = std::fs::remove_file(&temp_path);

        // return the inner result from PrintToPdf
        res
    }
}
