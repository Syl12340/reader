mod commands;
mod file_io;
mod pdf;
mod search;
mod navigation;
mod diagnostics;

use commands::*;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(DirectoryWatcherState::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            read_directory,
            read_directory_tree,
            open_file_dialog,
            open_folder_dialog,
            new_file_dialog,
            save_file_dialog,
            save_html_dialog,
            save_export_dialog,
            search_files,
            get_file_info,
            create_file,
            create_directory,
            delete_file,
            rename_file,
            watch_directory,
            watch_paths,
            unwatch_directory,
            save_image,
            write_binary_file,
            search_content,
            search::preview_replacement,
            pdf::export_pdf_native,
            navigation::open_external_url,
            navigation::open_document_path,
            diagnostics::runtime_diagnostics,
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                #[cfg(target_os = "windows")]
                {
                    use window_vibrancy::apply_mica;
                    let _ = apply_mica(&window, None);
                }

                #[cfg(target_os = "macos")]
                {
                    use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
                    let _ = apply_vibrancy(&window, NSVisualEffectMaterial::UnderWindowBackground, None, None);
                }
            } else {
                eprintln!("Warning: main window not found during setup");
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
