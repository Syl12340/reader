use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use tauri::{command, AppHandle, Emitter, State};
use walkdir::WalkDir;

#[derive(Default)]
pub struct DirectoryWatcherState {
    watcher: Mutex<Option<notify::RecommendedWatcher>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchPathRequest {
    pub path: String,
    pub recursive: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub children: Option<Vec<FileNode>>,
    pub is_expanded: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileInfo {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub is_directory: bool,
    pub modified: Option<String>,
    pub created: Option<String>,
    pub extension: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchResult {
    pub name: String,
    pub path: String,
    pub file_type: String,
    pub matches: Option<Vec<SearchMatch>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchMatch {
    pub line: usize,
    pub column: usize,
    pub text: String,
}

// 读取文件内容
#[command]
pub fn read_file(path: String) -> Result<String, crate::file_io::FileError> {
    fs::read_to_string(&path).map_err(Into::into)
}

// 写入文件内容
#[command]
pub fn write_file(path: String, content: String, expected_content: Option<String>) -> Result<(), crate::file_io::FileError> {
    crate::file_io::write_text(Path::new(&path), &content, expected_content.as_deref())
}

// 读取目录结构
#[command]
pub fn read_directory(path: String) -> Result<Vec<FileNode>, String> {
    let entries = fs::read_dir(&path).map_err(|e| format!("Failed to read directory: {}", e))?;
    let mut nodes = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let metadata = entry.metadata().map_err(|e| format!("Failed to read metadata: {}", e))?;
        let file_name = entry.file_name().to_string_lossy().to_string();
        let file_path = entry.path().to_string_lossy().to_string();

        // 跳过隐藏文件
        if file_name.starts_with('.') {
            continue;
        }

        let node = FileNode {
            name: file_name,
            path: file_path,
            is_directory: metadata.is_dir(),
            children: None,
            is_expanded: Some(false),
        };

        nodes.push(node);
    }

    // 排序：文件夹在前，文件在后，按名称排序
    nodes.sort_by(|a, b| {
        if a.is_directory && !b.is_directory {
            std::cmp::Ordering::Less
        } else if !a.is_directory && b.is_directory {
            std::cmp::Ordering::Greater
        } else {
            a.name.cmp(&b.name)
        }
    });

    Ok(nodes)
}

// 打开文件对话框
#[command]
pub async fn open_file_dialog(app: AppHandle) -> Result<Option<FileNode>, String> {
    use tauri_plugin_dialog::DialogExt;

    let file_path = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown", "txt"])
        .add_filter("All Files", &["*"])
        .blocking_pick_file();

    match file_path {
        Some(path) => {
            let path_str = path.to_string();
            let name = Path::new(&path_str)
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();

            Ok(Some(FileNode {
                name,
                path: path_str,
                is_directory: false,
                children: None,
                is_expanded: None,
            }))
        }
        None => Ok(None),
    }
}

// 打开文件夹对话框
#[command]
pub async fn open_folder_dialog(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let folder_path = app
        .dialog()
        .file()
        .blocking_pick_folder();

    match folder_path {
        Some(path) => Ok(Some(path.to_string())),
        None => Ok(None),
    }
}

// 新建文件对话框
#[command]
pub async fn new_file_dialog(app: AppHandle) -> Result<Option<FileNode>, String> {
    use tauri_plugin_dialog::DialogExt;

    let file_path = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md"])
        .add_filter("Text", &["txt"])
        .blocking_save_file();

    match file_path {
        Some(path) => {
            let path_str = path.to_string();
            let name = Path::new(&path_str)
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();

            // 创建空文件
            fs::write(&path_str, "")
                .map_err(|e| format!("Failed to create file: {}", e))?;

            Ok(Some(FileNode {
                name,
                path: path_str,
                is_directory: false,
                children: None,
                is_expanded: None,
            }))
        }
        None => Ok(None),
    }
}

// 保存文件对话框
#[command]
pub async fn save_file_dialog(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let file_path = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md"])
        .add_filter("Text", &["txt"])
        .blocking_save_file();

    match file_path {
        Some(path) => Ok(Some(path.to_string())),
        None => Ok(None),
    }
}

// 保存 HTML 对话框
#[command]
pub async fn save_html_dialog(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let file_path = app
        .dialog()
        .file()
        .add_filter("HTML", &["html", "htm"])
        .add_filter("All Files", &["*"])
        .blocking_save_file();

    match file_path {
        Some(path) => Ok(Some(path.to_string())),
        None => Ok(None),
    }
}

// 通用导出保存对话框
#[command]
pub async fn save_export_dialog(
    app: AppHandle,
    default_name: String,
    extension: String,
    description: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let extension = extension.trim_start_matches('.').to_string();
    let file_path = app
        .dialog()
        .file()
        .set_file_name(default_name)
        .add_filter(description, &[extension.as_str()])
        .blocking_save_file();

    match file_path {
        Some(path) => Ok(Some(path.to_string())),
        None => Ok(None),
    }
}

// 搜索文件
#[command]
pub fn search_files(directory: String, query: String) -> Result<Vec<SearchResult>, String> {
    let mut results = Vec::new();
    let query_lower = query.to_lowercase();

    for entry in WalkDir::new(&directory)
        .into_iter()
        .filter_map(|e| e.ok())
        .take(1000) // 限制搜索数量
    {
        let file_name = entry.file_name().to_string_lossy().to_string();
        let file_path = entry.path().to_string_lossy().to_string();

        // 跳过隐藏文件和目录
        if file_name.starts_with('.') {
            continue;
        }

        // 按文件名搜索
        if file_name.to_lowercase().contains(&query_lower) {
            results.push(SearchResult {
                name: file_name,
                path: file_path,
                file_type: if entry.file_type().is_dir() {
                    "directory".to_string()
                } else {
                    "file".to_string()
                },
                matches: None,
            });
        }

        // 限制结果数量
        if results.len() >= 100 {
            break;
        }
    }

    Ok(results)
}

// 获取文件信息
#[command]
pub fn get_file_info(path: String) -> Result<FileInfo, String> {
    let metadata = fs::metadata(&path).map_err(|e| format!("Failed to get file info: {}", e))?;
    let file_name = Path::new(&path)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let extension = Path::new(&path)
        .extension()
        .map(|e| e.to_string_lossy().to_string());

    let modified = metadata
        .modified()
        .ok()
        .and_then(|t| {
            t.duration_since(std::time::UNIX_EPOCH)
                .ok()
                .map(|d| d.as_secs().to_string())
        });

    let created = metadata
        .created()
        .ok()
        .and_then(|t| {
            t.duration_since(std::time::UNIX_EPOCH)
                .ok()
                .map(|d| d.as_secs().to_string())
        });

    Ok(FileInfo {
        name: file_name,
        path,
        size: metadata.len(),
        is_directory: metadata.is_dir(),
        modified,
        created,
        extension,
    })
}

// 创建文件
#[command]
pub fn create_file(path: String, content: Option<String>) -> Result<(), String> {
    if Path::new(&path).exists() {
        return Err(format!("File already exists: {}", path));
    }
    let content = content.unwrap_or_default();
    fs::write(&path, content).map_err(|e| format!("Failed to create file: {}", e))
}

// 创建目录
#[command]
pub fn create_directory(path: String) -> Result<(), String> {
    fs::create_dir_all(&path).map_err(|e| format!("Failed to create directory: {}", e))
}

// 删除文件或目录
#[command]
pub fn delete_file(path: String, permanent: Option<bool>) -> Result<(), String> {
    let target = Path::new(&path);
    if !target.is_absolute() || target.parent().is_none() || target.file_name().is_none() {
        return Err("Refusing to delete a filesystem root or relative path".into());
    }
    if !permanent.unwrap_or(false) {
        return trash::delete(target).map_err(|e| format!("Failed to move to trash (no permanent deletion attempted): {}", e));
    }
    let metadata = fs::metadata(&path).map_err(|e| format!("Failed to get metadata: {}", e))?;

    if metadata.is_dir() {
        fs::remove_dir_all(&path).map_err(|e| format!("Failed to delete directory: {}", e))
    } else {
        fs::remove_file(&path).map_err(|e| format!("Failed to delete file: {}", e))
    }
}

// 重命名文件或目录
#[command]
pub fn rename_file(old_path: String, new_path: String) -> Result<(), String> {
    fs::rename(&old_path, &new_path).map_err(|e| format!("Failed to rename: {}", e))
}

// 逐层读取目录树，避免在每一级递归中重复遍历完整子树。
#[command]
pub fn read_directory_tree(path: String, max_depth: Option<usize>, exclude_dirs: Option<Vec<String>>) -> Result<Vec<FileNode>, String> {
    let depth = max_depth.unwrap_or(10);
    read_tree_level(Path::new(&path), depth, exclude_dirs.as_ref())
}

fn read_tree_level(
    path: &Path,
    remaining_depth: usize,
    exclude_dirs: Option<&Vec<String>>,
) -> Result<Vec<FileNode>, String> {
    if remaining_depth == 0 {
        return Ok(Vec::new());
    }

    let mut nodes = Vec::new();
    let entries = fs::read_dir(path)
        .map_err(|error| format!("Failed to read directory {}: {}", path.display(), error))?;

    for entry in entries.filter_map(Result::ok) {
        let file_name = entry.file_name().to_string_lossy().to_string();
        if file_name.starts_with('.') { continue; }

        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };
        let is_directory = file_type.is_dir();
        if is_directory && should_skip_dir(&file_name, exclude_dirs) { continue; }

        let entry_path = entry.path();
        let file_path = entry_path.to_string_lossy().to_string();

        let mut node = FileNode {
            name: file_name,
            path: file_path,
            is_directory,
            children: None,
            is_expanded: Some(false),
        };

        if is_directory && remaining_depth > 1 {
            node.children = Some(
                read_tree_level(&entry_path, remaining_depth - 1, exclude_dirs)
                    .unwrap_or_default(),
            );
        }
        nodes.push(node);
    }

    nodes.sort_by(|a, b| {
        if a.is_directory && !b.is_directory {
            std::cmp::Ordering::Less
        } else if !a.is_directory && b.is_directory {
            std::cmp::Ordering::Greater
        } else {
            a.name.cmp(&b.name)
        }
    });

    Ok(nodes)
}

/// 判断是否应跳过的目录（性能优化：避免扫描 node_modules 等大目录）
fn should_skip_dir(name: &str, custom_excludes: Option<&Vec<String>>) -> bool {
    if let Some(excludes) = custom_excludes {
        if excludes.iter().any(|ext| ext == name) {
            return true;
        }
    }
    matches!(
        name,
        "node_modules" | ".git" | ".svn" | ".hg"
        | "target" | "dist" | "build" | "__pycache__"
        | ".next" | ".nuxt" | ".cache" | "vendor"
    )
}

// 监听目录变化
#[command]
pub fn watch_directory(
    app: AppHandle,
    path: String,
    state: State<'_, DirectoryWatcherState>,
) -> Result<(), String> {
    replace_watched_paths(app, vec![WatchPathRequest { path, recursive: true }], state)
}

#[command]
pub fn watch_paths(
    app: AppHandle,
    paths: Vec<WatchPathRequest>,
    state: State<'_, DirectoryWatcherState>,
) -> Result<(), String> {
    replace_watched_paths(app, paths, state)
}

fn replace_watched_paths(
    app: AppHandle,
    paths: Vec<WatchPathRequest>,
    state: State<'_, DirectoryWatcherState>,
) -> Result<(), String> {
    use notify::{RecommendedWatcher, RecursiveMode, Watcher};
    use std::collections::HashMap;

    let mut watcher = RecommendedWatcher::new(
        move |res: Result<notify::Event, notify::Error>| {
            if let Ok(event) = res {
                let paths: Vec<String> = event
                    .paths
                    .iter()
                    .map(|path| path.to_string_lossy().to_string())
                    .collect();
                let kind = format!("{:?}", event.kind);
                let rename = if matches!(event.kind, notify::EventKind::Modify(
                    notify::event::ModifyKind::Name(notify::event::RenameMode::Both)
                )) && paths.len() == 2 {
                    Some(serde_json::json!({ "from": paths[0], "to": paths[1] }))
                } else { None };
                let _ = app.emit("fs-change", serde_json::json!({
                    "kind": kind,
                    "paths": paths,
                    "rename": rename,
                }));
            }
        },
        notify::Config::default(),
    )
    .map_err(|e| format!("Failed to create watcher: {}", e))?;

    let mut watched = HashMap::new();
    for request in paths {
        watched
            .entry(request.path)
            .and_modify(|recursive| *recursive = *recursive || request.recursive)
            .or_insert(request.recursive);
    }
    let mut watched_count = 0usize;
    for (path, recursive) in watched {
        let target = Path::new(&path);
        if !target.exists() { continue; }
        let mode = if target.is_dir() && recursive {
            RecursiveMode::Recursive
        } else {
            RecursiveMode::NonRecursive
        };
        watcher
            .watch(target, mode)
            .map_err(|error| format!("Failed to watch {}: {}", path, error))?;
        watched_count += 1;
    }

    if watched_count == 0 {
        return Err("No valid paths were provided to the directory watcher".to_string());
    }

    let mut active = state
        .watcher
        .lock()
        .map_err(|_| "Directory watcher state is unavailable".to_string())?;
    *active = Some(watcher);

    Ok(())
}

#[command]
pub fn unwatch_directory(state: State<'_, DirectoryWatcherState>) -> Result<(), String> {
    let mut active = state
        .watcher
        .lock()
        .map_err(|_| "Directory watcher state is unavailable".to_string())?;
    active.take();
    Ok(())
}

// 保存图片（接收 base64 编码数据）
#[command]
pub fn save_image(path: String, data: String) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;
    crate::file_io::write_bytes(Path::new(&path), &bytes, None).map_err(|e| e.message)
}

// 保存任意二进制导出文件（base64 编码）
#[command]
pub fn write_binary_file(path: String, data: String) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;
    crate::file_io::write_bytes(Path::new(&path), &bytes, None).map_err(|e| e.message)
}

// 全局内容搜索
#[derive(Debug, Serialize, Deserialize)]
pub struct ContentSearchResult {
    pub file: String,
    pub line: usize,
    pub column: usize,
    pub context: String,
}

#[command]
pub fn search_content(
    directory: String, 
    query: String, 
    max_results: Option<usize>,
    extensions: Option<Vec<String>>,
    exclude_dirs: Option<Vec<String>>,
    case_sensitive: Option<bool>,
    use_regex: Option<bool>,
    whole_word: Option<bool>,
) -> Result<Vec<ContentSearchResult>, String> {
    use regex::RegexBuilder;

    let max = max_results.unwrap_or(200);
    if query.is_empty() || max == 0 {
        return Ok(Vec::new());
    }
    let mut pattern = if use_regex.unwrap_or(false) {
        query.clone()
    } else {
        regex::escape(&query)
    };
    if whole_word.unwrap_or(false) {
        pattern = format!(r"\b(?:{})\b", pattern);
    }
    let matcher = RegexBuilder::new(&pattern)
        .case_insensitive(!case_sensitive.unwrap_or(false))
        .build()
        .map_err(|error| format!("Invalid search expression: {}", error))?;
    let mut results = Vec::new();

    let default_extensions = vec!["md", "txt", "markdown", "json", "js", "ts", "jsx", "tsx",
        "py", "rs", "go", "java", "c", "cpp", "h", "hpp", "html", "css", "scss",
        "yaml", "yml", "toml", "xml", "sh", "bash", "sql", "svelte", "vue"];
    let default_exts_vec: Vec<String> = default_extensions.iter().map(|value| value.to_string()).collect();
    let exts = extensions.as_ref().unwrap_or(&default_exts_vec);

    for entry in WalkDir::new(&directory)
        .into_iter()
        .filter_entry(|entry| {
            if entry.depth() == 0 { return true; }
            let name = entry.file_name().to_string_lossy();
            !name.starts_with('.') && !should_skip_dir(name.as_ref(), exclude_dirs.as_ref())
        })
        .filter_map(|e| e.ok())
        .take(5000)
    {
        if results.len() >= max {
            break;
        }

        // 只搜索文本文件
        if !entry.file_type().is_file() {
            continue;
        }

        let ext = entry.path().extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();

        if !exts.iter().any(|e| e.to_lowercase() == ext) {
            continue;
        }

        // 读取文件内容
        let content = match fs::read_to_string(entry.path()) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let file_path = entry.path().to_string_lossy().to_string();

        // 逐行搜索
        for (line_idx, line) in content.lines().enumerate() {
            if results.len() >= max {
                break;
            }

            for found in matcher.find_iter(line) {
                if results.len() >= max {
                    break;
                }
                let col = found.start();
                // 截取上下文（匹配位置前后各 40 字符）
                let mut start = col.saturating_sub(40);
                while start > 0 && !line.is_char_boundary(start) {
                    start -= 1;
                }
                let mut end = (found.end() + 40).min(line.len());
                while end < line.len() && !line.is_char_boundary(end) {
                    end += 1;
                }
                let context = line[start..end].to_string();

                results.push(ContentSearchResult {
                    file: file_path.clone(),
                    line: line_idx + 1,
                    column: col + 1,
                    context,
                });
            }
        }
    }

    Ok(results)
}
