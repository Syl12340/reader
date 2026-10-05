use tauri::{webview::PageLoadEvent, AppHandle, WebviewUrl, WebviewWindowBuilder};

#[cfg(windows)]
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2Environment6, ICoreWebView2_2, ICoreWebView2_7,
};
#[cfg(windows)]
use webview2_com::{
    CallDevToolsProtocolMethodCompletedHandler, ExecuteScriptCompletedHandler,
    PrintToPdfCompletedHandler,
};
#[cfg(windows)]
use windows::core::PCWSTR;

#[cfg(windows)]
async fn devtools(
    window: &tauri::WebviewWindow,
    method: &str,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    use std::sync::{Arc, Mutex};
    use tokio::sync::oneshot;
    use windows::core::HSTRING;
    let method = HSTRING::from(method);
    let params = HSTRING::from(params.to_string());
    let (tx, rx) = oneshot::channel();
    let tx = Arc::new(Mutex::new(Some(tx)));
    window
        .with_webview(move |webview| {
            let callback_tx = Arc::clone(&tx);
            let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                move |status, json| {
                    let result = if status.is_ok() {
                        Ok(json)
                    } else {
                        Err(format!("PDF engine protocol failed: {:?}", status))
                    };
                    if let Ok(mut guard) = callback_tx.lock() {
                        if let Some(sender) = guard.take() {
                            let _ = sender.send(result);
                        }
                    }
                    Ok(())
                },
            ));
            let result = unsafe {
                webview
                    .controller()
                    .CoreWebView2()
                    .and_then(|core| core.CallDevToolsProtocolMethod(&method, &params, &handler))
            };
            if let Err(error) = result {
                if let Ok(mut guard) = tx.lock() {
                    if let Some(sender) = guard.take() {
                        let _ = sender.send(Err(error.to_string()));
                    }
                }
            }
        })
        .map_err(|error| error.to_string())?;
    let json = tokio::time::timeout(std::time::Duration::from_secs(45), rx)
        .await
        .map_err(|_| "PDF engine protocol timed out".to_string())?
        .map_err(|_| "PDF engine protocol listener closed".to_string())??;
    if json.len() > 180_000_000 {
        return Err("PDF engine response exceeds 180MB".into());
    }
    let value: serde_json::Value =
        serde_json::from_str(&json).map_err(|error| error.to_string())?;
    if let Some(error) = value.get("error") {
        return Err(format!("PDF engine protocol: {}", error));
    }
    Ok(value)
}

#[cfg(windows)]
async fn prepare_print_media(window: &tauri::WebviewWindow, extended: bool) -> Result<(), String> {
    if extended {
        let version = devtools(window, "Browser.getVersion", serde_json::json!({})).await?;
        let major = version
            .get("product")
            .and_then(|value| value.as_str())
            .and_then(|product| product.rsplit('/').next())
            .and_then(|number| number.split('.').next())
            .and_then(|major| major.parse::<u32>().ok());
        if major.map_or(true, |major| major < 131) {
            return Err("PDF page numbers/bookmarks require WebView2 131+. Update the runtime or disable these options.".into());
        }
    }
    devtools(
        window,
        "Emulation.setEmulatedMedia",
        serde_json::json!({ "media": "print" }),
    )
    .await?;
    Ok(())
}

#[cfg(windows)]
async fn print_with_bookmarks(
    window: &tauri::WebviewWindow,
    width: f64,
    height: f64,
    path: &std::path::Path,
) -> Result<(), String> {
    use base64::Engine;
    let result = devtools(
        window,
        "Page.printToPDF",
        serde_json::json!({
            "paperWidth": width, "paperHeight": height, "printBackground": true,
            "marginTop": 0, "marginBottom": 0, "marginLeft": 0, "marginRight": 0,
            "displayHeaderFooter": false, "preferCSSPageSize": true, "scale": 1,
            "generateTaggedPDF": true, "generateDocumentOutline": true,
            "transferMode": "ReturnAsBase64",
        }),
    )
    .await
    .map_err(|error| {
        format!(
            "PDF bookmarks are unavailable: {}. Disable bookmarks to use standard export.",
            error
        )
    })?;
    let data = result
        .get("data")
        .and_then(|value| value.as_str())
        .ok_or("PDF engine returned no document")?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|error| error.to_string())?;
    if !bytes.starts_with(b"%PDF-") {
        return Err("PDF engine returned an invalid document".into());
    }
    std::fs::write(path, bytes).map_err(|error| format!("Failed to write temporary PDF: {}", error))
}

#[cfg(windows)]
async fn wait_for_resources(window: &tauri::WebviewWindow) -> Result<(), String> {
    use std::sync::{Arc, Mutex};
    use tokio::sync::oneshot;
    use windows::core::HSTRING;
    let script = r#"(() => {
      if (!window.__readerResourceJob) {
        window.__readerResourceJob = true;
        for (const image of document.images) image.loading = 'eager';
        const main = document.querySelector('.markdown-body');
        const printWidth = Number(document.querySelector('meta[name="reader-print-width"]')?.content) || 170;
        if (main) main.style.maxWidth = printWidth + 'mm';
        void document.body.offsetHeight;
        Promise.all([document.fonts.ready, ...Array.from(document.images, image => image.decode())])
          .then(() => {
            for (const display of document.querySelectorAll('.katex-display')) {
              const formula = display.querySelector('.katex');
              if (!formula) continue;
              const available = display.parentElement?.clientWidth || display.clientWidth;
              const width = formula.getBoundingClientRect().width;
              if (available > 0 && width > available) {
                formula.style.fontSize = (parseFloat(getComputedStyle(formula).fontSize) * available / width) + 'px';
              }
            }
          })
          .then(() => new Promise(resolve => {
            // Hidden WebViews may suspend animation frames; never depend on them alone.
            const timer = setTimeout(resolve, 150);
            requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); resolve(); }));
          }))
          .then(() => { window.__readerResourceReady = true; })
          .catch(() => { window.__readerResourceError = true; });
      }
      return window.__readerResourceError ? 'error' : window.__readerResourceReady === true;
    })()"#;
    for _ in 0..100 {
        let (tx, rx) = oneshot::channel();
        let tx = Arc::new(Mutex::new(Some(tx)));
        window
            .with_webview(move |webview| {
                let callback_tx = Arc::clone(&tx);
                let handler =
                    ExecuteScriptCompletedHandler::create(Box::new(move |status, json| {
                        let result = if status.is_ok() {
                            Ok(json)
                        } else {
                            Err("PDF resource check failed".to_string())
                        };
                        if let Ok(mut guard) = callback_tx.lock() {
                            if let Some(sender) = guard.take() {
                                let _ = sender.send(result);
                            }
                        }
                        Ok(())
                    }));
                let result = unsafe {
                    webview
                        .controller()
                        .CoreWebView2()
                        .and_then(|core| core.ExecuteScript(&HSTRING::from(script), &handler))
                };
                if let Err(error) = result {
                    if let Ok(mut guard) = tx.lock() {
                        if let Some(sender) = guard.take() {
                            let _ = sender.send(Err(error.to_string()));
                        }
                    }
                }
            })
            .map_err(|error| error.to_string())?;
        let json = tokio::time::timeout(std::time::Duration::from_secs(2), rx)
            .await
            .map_err(|_| "PDF resource check timed out".to_string())?
            .map_err(|_| "PDF resource listener closed".to_string())??;
        if json == "true" {
            return Ok(());
        }
        if json == "\"error\"" {
            return Err("PDF contains an image that could not be decoded".into());
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    Err("PDF fonts or images did not become ready within 10 seconds".into())
}

#[tauri::command]
pub async fn export_pdf_native(
    app: AppHandle,
    path: String,
    html_content: String,
    paper: Option<String>,
    margin_mm: Option<f64>,
    landscape: Option<bool>,
    bookmarks: Option<bool>,
    page_numbers: Option<bool>,
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
        use windows::core::{Interface, HSTRING};
        let (mut page_width, mut page_height) = match paper.as_deref().unwrap_or("A4") {
            "A4" => (210.0 / 25.4, 297.0 / 25.4),
            "Letter" => (8.5, 11.0),
            _ => return Err("Unsupported PDF paper size".into()),
        };
        if landscape.unwrap_or(false) {
            std::mem::swap(&mut page_width, &mut page_height);
        }
        let margin = margin_mm.unwrap_or(20.0);
        if !margin.is_finite() || !(10.0..=35.0).contains(&margin) {
            return Err("PDF margins must be between 10 and 35 mm".into());
        }

        static EXPORT_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let label = format!(
            "pdf_export_{}_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis(),
            EXPORT_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        );

        // Capture the destination before rendering, not just before committing.
        let output_path = PathBuf::from(&path);
        let (expected, expected_missing) = match std::fs::read(&output_path) {
            Ok(content) => (Some(content), false),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (None, true),
            Err(error) => return Err(format!("Failed to inspect PDF destination: {}", error)),
        };
        let temp_path = std::env::temp_dir().join(format!("{}.html", label));
        std::fs::write(&temp_path, html_content.as_bytes())
            .map_err(|e| format!("Failed to write temporary PDF HTML: {}", e))?;

        let output_parent = output_path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .unwrap_or_else(|| std::path::Path::new("."));
        let temp_pdf_path =
            output_parent.join(format!(".reader-{}-{}.tmp.pdf", std::process::id(), label));
        let _ = std::fs::remove_file(&temp_pdf_path);

        let file_url = tauri::Url::from_file_path(&temp_path)
            .map_err(|_| format!("Failed to create file URL for {}", temp_path.display()))?;

        let (load_tx, load_rx) = oneshot::channel();
        let load_tx = Arc::new(Mutex::new(Some(load_tx)));
        let page_load_tx = Arc::clone(&load_tx);
        let window = match WebviewWindowBuilder::new(&app, label, WebviewUrl::External(file_url))
            .inner_size((page_width - margin * 2.0 / 25.4) * 96.0, 700.0)
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
        let ready = async {
            prepare_print_media(
                &window,
                bookmarks.unwrap_or(false) || page_numbers.unwrap_or(false),
            )
            .await?;
            wait_for_resources(&window).await
        }
        .await;
        if let Err(error) = ready {
            let _ = window.close();
            let _ = std::fs::remove_file(&temp_path);
            let _ = std::fs::remove_file(&temp_pdf_path);
            return Err(error);
        }

        let res = if bookmarks.unwrap_or(false) {
            print_with_bookmarks(&window, page_width, page_height, &temp_pdf_path).await
        } else {
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
                    let core7: ICoreWebView2_7 = core_webview2.cast().map_err(|error| {
                        format!("WebView2 PDF interface is unavailable: {}", error)
                    })?;
                    let print_settings = unsafe {
                        let core2: ICoreWebView2_2 =
                            core_webview2.cast().map_err(|error| error.to_string())?;
                        let environment: ICoreWebView2Environment6 = core2
                            .Environment()
                            .and_then(|environment| environment.cast())
                            .map_err(|error| error.to_string())?;
                        let settings = environment
                            .CreatePrintSettings()
                            .map_err(|error| error.to_string())?;
                        settings
                            .SetPageWidth(page_width)
                            .map_err(|error| error.to_string())?;
                        settings
                            .SetPageHeight(page_height)
                            .map_err(|error| error.to_string())?;
                        // CSS @page owns margins; avoid adding printer margins a second time.
                        settings
                            .SetMarginTop(0.0)
                            .map_err(|error| error.to_string())?;
                        settings
                            .SetMarginBottom(0.0)
                            .map_err(|error| error.to_string())?;
                        settings
                            .SetMarginLeft(0.0)
                            .map_err(|error| error.to_string())?;
                        settings
                            .SetMarginRight(0.0)
                            .map_err(|error| error.to_string())?;
                        settings
                            .SetShouldPrintBackgrounds(true)
                            .map_err(|error| error.to_string())?;
                        settings
                            .SetShouldPrintHeaderAndFooter(false)
                            .map_err(|error| error.to_string())?;
                        settings
                    };

                    let tx = Arc::clone(&tx);
                    let handler = PrintToPdfCompletedHandler::create(Box::new(
                        move |error_code, is_successful| {
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
                        },
                    ));

                    let path_hstr = HSTRING::from(print_pdf_path.to_string_lossy().as_ref());
                    unsafe {
                        core7
                            .PrintToPdf(PCWSTR(path_hstr.as_ptr()), &print_settings, &handler)
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
                let _ = std::fs::remove_file(&temp_pdf_path);
                return Err(format!("Webview operation failed: {}", error));
            }

            match tokio::time::timeout(std::time::Duration::from_secs(45), rx).await {
                Ok(Ok(result)) => result,
                Ok(Err(_)) => Err("Print callback channel closed unexpectedly".to_string()),
                Err(_) => Err("PDF export timed out after 45 seconds".to_string()),
            }
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
        crate::file_io::write_bytes_guarded(
            &output_path,
            &pdf,
            expected.as_deref(),
            expected_missing,
        )
        .map_err(|error| format!("Failed to commit PDF: {}", error.message))
    }
}
