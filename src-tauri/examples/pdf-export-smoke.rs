// Isolated desktop runtime check. Does not expose a production IPC command.
#[allow(dead_code)]
#[path = "../src/file_io.rs"]
mod file_io;
#[path = "../src/pdf.rs"]
mod pdf;

#[cfg(windows)]
fn main() {
    let args: Vec<String> = std::env::args().collect();
    if !matches!(args.len(), 4 | 7) || !matches!(args[3].as_str(), "standard" | "bookmarks") {
        eprintln!("Usage: pdf-export-smoke INPUT.html OUTPUT.pdf standard|bookmarks [A4|Letter MARGIN_MM portrait|landscape]");
        std::process::exit(2);
    }
    let html = std::fs::read_to_string(&args[1]).expect("Could not read HTML fixture");
    let output = args[2].clone();
    let report = format!("{}.result.json", output);
    std::fs::write(&report, "{\"status\":\"starting\"}").expect("Could not write smoke report");
    let panic_report = report.clone();
    std::panic::set_hook(Box::new(move |info| {
        let _ = std::fs::write(&panic_report, serde_json::json!({ "status": "panic", "error": info.to_string() }).to_string());
    }));
    let bookmarks = args[3] == "bookmarks";
    let paper = args.get(4).cloned().unwrap_or_else(|| "A4".into());
    let margin = args.get(5).map(|value| value.parse::<f64>().expect("Invalid margin")).unwrap_or(20.0);
    let landscape = args.get(6).is_some_and(|value| value == "landscape");
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().identifier = "com.reader.pdf-smoke".into();
    tauri::Builder::default()
        .setup(move |app| {
            std::fs::write(&report, "{\"status\":\"exporting\"}")?;
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let result = tokio::time::timeout(std::time::Duration::from_secs(90), pdf::export_pdf_native(
                    handle.clone(), output.clone(), html, Some(paper), Some(margin),
                    Some(landscape), Some(bookmarks), Some(true),
                )).await;
                let exit = match result {
                    Ok(Ok(())) => {
                        let _ = std::fs::write(&report, "{\"status\":\"passed\"}");
                        println!("Native PDF smoke passed: {}", output); 0
                    }
                    Ok(Err(error)) => {
                        let _ = std::fs::write(&report, serde_json::json!({ "status": "failed", "error": error }).to_string());
                        eprintln!("Native PDF smoke failed: {}", error); 1
                    }
                    Err(_) => {
                        let _ = std::fs::write(&report, "{\"status\":\"timeout\"}");
                        eprintln!("Native PDF smoke exceeded 90 seconds"); 1
                    }
                };
                handle.exit(exit);
            });
            Ok(())
        })
        .build(context)
        .expect("Could not build isolated PDF runtime")
        .run(|_, event| {
            if let tauri::RunEvent::ExitRequested { code: None, api, .. } = event {
                api.prevent_exit();
            }
        });
}

#[cfg(not(windows))]
fn main() {
    eprintln!("This smoke check requires Windows WebView2");
    std::process::exit(2);
}
