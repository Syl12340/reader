use tauri::{webview::PageLoadEvent, AppHandle, WebviewUrl, WebviewWindowBuilder};

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
        use std::path::PathBuf;
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

        let output_path = PathBuf::from(&path);
        let output_parent = output_path.parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .unwrap_or_else(|| std::path::Path::new("."));
        let temp_pdf_path = output_parent.join(format!(".reader-{}-{}.tmp.pdf", std::process::id(), label));
        let _ = std::fs::remove_file(&temp_pdf_path);

        let file_url = tauri::Url::from_file_path(&temp_path)
            .map_err(|_| format!("Failed to create file URL for {}", temp_path.display()))?;

        let (load_tx, load_rx) = oneshot::channel();
        let load_tx = Arc::new(Mutex::new(Some(load_tx)));
        let page_load_tx = Arc::clone(&load_tx);
        let window = match WebviewWindowBuilder::new(&app, label, WebviewUrl::External(file_url))
            .visible(false)
            .on_page_load(move |_window, payload| {
                if payload.event() == PageLoadEvent::Finished {
                    if let Ok(mut guard) = page_load_tx.lock() {
                        if let Some(sender) = guard.take() {
                            let _ = sender.send(());
                        }
                    }
                }
            })
            .build()
        {
            Ok(window) => window,
            Err(e) => {
                let _ = std::fs::remove_file(&temp_path);
                return Err(format!("Failed to create hidden window: {}", e));
            }
        };

        let loaded = tokio::time::timeout(std::time::Duration::from_secs(15), load_rx).await;
        if !matches!(loaded, Ok(Ok(()))) {
            let _ = window.close();
            let _ = std::fs::remove_file(&temp_path);
            let _ = std::fs::remove_file(&temp_pdf_path);
            return Err(match loaded {
                Err(_) => "PDF page did not finish loading within 15 seconds".to_string(),
                _ => "PDF page load listener closed unexpectedly".to_string(),
            });
        }
        // The load event includes styles and images. Yield once so WebView2 can flush its final layout.
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;

        let (tx, rx) = oneshot::channel();
        let tx = Arc::new(Mutex::new(Some(tx)));
        let print_pdf_path = temp_pdf_path.clone();

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

                let path_hstr = HSTRING::from(print_pdf_path.to_string_lossy().as_ref());
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
        if let Err(error) = res {
            let _ = std::fs::remove_file(&temp_pdf_path);
            return Err(error);
        }

        let pdf = std::fs::read(&temp_pdf_path)
            .map_err(|error| format!("Failed to read generated PDF: {}", error));
        let _ = std::fs::remove_file(&temp_pdf_path);
        let pdf = pdf?;
        let (expected, expected_missing) = match std::fs::read(&output_path) {
            Ok(content) => (Some(content), false),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (None, true),
            Err(error) => return Err(format!("Failed to inspect PDF destination: {}", error)),
        };
        crate::file_io::write_bytes_guarded(&output_path, &pdf, expected.as_deref(), expected_missing)
            .map_err(|error| format!("Failed to commit PDF: {}", error.message))
    }
}
