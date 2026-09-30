# 项目缺陷检查报告

**项目名称**: Reader（Tauri + SvelteKit Markdown 编辑器）  
**检查时间**: 2026-06-12  
**检查范围**: 全项目源代码（Rust 后端 + TypeScript/Svelte 前端）  
**缺陷总数**: 21 项（严重 5 · 高危 7 · 中危 6 · 低危 3）

---

## 缺陷汇总

| ID | 严重程度 | 文件 | 缺陷简述 |
|----|----------|------|---------|
| BUG-01 | 🔴 严重 | `commands.rs:338` | `read_directory_tree` 忽略 `max_depth` 参数，硬编码为 1 |
| BUG-02 | 🔴 严重 | `commands.rs:454` | `watch_directory` 的 Watcher 立即被销毁，目录监听完全失效 |
| BUG-03 | 🔴 严重 | `commands.rs:575` | `search_content` 对非 ASCII（中文）内容的字节切片会 panic |
| BUG-04 | 🔴 严重 | `tabs.ts:38` | `openTab` 对已存在的标签设置了错误的 `activeTabId` |
| BUG-05 | 🔴 严重 | `Sidebar.svelte:167` | `handleRename` 参数传递错误，导致重命名路径拼接完全错误 |
| BUG-06 | 🟠 高危 | `editor.ts:73` | `flushContent` 实际未刷新内容，保存前可能丢失最后一次输入 |
| BUG-07 | 🟠 高危 | `Sidebar.svelte:187` | `handleDelete` 使用目录basename而非全路径，删除操作指向错误路径 |
| BUG-08 | 🟠 高危 | `Sidebar.svelte:246` | 搜索后清除仅在浏览器模式有效，Tauri 模式下文件树无法恢复 |
| BUG-09 | 🟠 高危 | `markdown.ts:38` | `toAssetUrl` 将路径转为反斜杠后再编码，生成错误的 asset URL |
| BUG-10 | 🟠 高危 | `+page.svelte:345` | Ctrl+Q 快捷键强制关闭，跳过未保存检测，可能导致数据丢失 |
| BUG-11 | 🟠 高危 | `native-fs.ts:75` | `TauriFileSystem.readFile` 对句柄型 FileRef 只用 `file.name`（无路径）|
| BUG-12 | 🟠 高危 | `browser-fs.ts:310` | `exportAsHTML` / `printContent` 未对内容做 XSS 防护 |
| BUG-13 | 🟡 中危 | `commands.rs:111` | `open_file_dialog` 读取文件内容后立即丢弃，浪费 IO |
| BUG-14 | 🟡 中危 | `file.ts:19` | `directoryName` 派生 store 路径分隔符检测逻辑错误 |
| BUG-15 | 🟡 中危 | `SearchReplace.svelte:94` | 替换时按字符长度而非字节偏移量计算末尾，大小写不敏感时出错 |
| BUG-16 | 🟡 中危 | `image-handler.ts:113` | 浏览器粘贴图片返回的 Markdown 路径在实际环境中无法解析 |
| BUG-17 | 🟡 中危 | `latex.ts:41` | `prepareLatex` 与 `markdown.ts` fence 渲染器冲突，部分代码块双重处理 |
| BUG-18 | 🟡 中危 | `native-fs.ts:220` | `BrowserFileSystem.saveFile` 的 `exportAsMarkdown` 调用未加 `await` |
| BUG-19 | 🟢 低危 | `commands.rs:306` | `create_file` 静默覆盖已存在文件，无保护机制 |
| BUG-20 | 🟢 低危 | `TabBar.svelte:67` | 标签项缺少 `onkeydown` 事件，键盘导航无法访问（无障碍缺陷）|
| BUG-21 | 🟢 低危 | 多文件 | `getFileIcon` / `getFileExtension` 函数在 3 处重复实现 |

---

## 详细缺陷说明

---

### BUG-01 🔴 `read_directory_tree` 忽略 `max_depth` 参数

**文件**: [`commands.rs:337-342`](file:///d:/Shaoyilei/Desktop/Workspace/code/reader/src-tauri/src/commands.rs#L337-L342)

**问题描述**: 函数接受 `max_depth: Option<usize>` 参数，但在 WalkDir 调用中硬编码了 `max_depth(1)`，导致参数完全无效。前端调用 `readDirectoryTree(path, 5)` 时实际只读取一层目录。

```diff
- let depth = max_depth.unwrap_or(10);  // 计算了但从不使用
  for entry in WalkDir::new(&path)
-     .max_depth(1)   // ← 硬编码！
+     .max_depth(1)   // 应改为 .max_depth(depth)
```

**影响**: 文件树永远只展示一层，子目录内容不可见，`read_subtree` 递归函数被调用但 WalkDir 根本不会进入子目录。

**修复方案**:
```rust
for entry in WalkDir::new(&path)
    .max_depth(depth)  // 使用传入参数
```

---

### BUG-02 🔴 `watch_directory` 的 Watcher 立即被销毁

**文件**: [`commands.rs:454-490`](file:///d:/Shaoyilei/Desktop/Workspace/code/reader/src-tauri/src/commands.rs#L454-L490)

**问题描述**: `RecommendedWatcher` 实例 `watcher` 是函数的局部变量，没有被移入后台线程（线程只拿到了 `rx` 和 `app`）。当函数执行 `Ok(())` 返回时，`watcher` 随即被析构，文件系统监听立即停止。

```rust
let mut watcher = RecommendedWatcher::new(...)...;  // 创建
watcher.watch(...)...;

std::thread::spawn(move || {        // watcher 未被移入！
    for event in rx { ... }         // rx 和 app 被移入
});
// ← 函数返回，watcher 析构，监听停止
Ok(())
```

**影响**: `watch_directory` 命令调用后立即失效，前端永远无法收到 `fs-change` 事件，文件树无法自动刷新。

**修复方案**: 将 `watcher` 移入后台线程中保持其生命周期：
```rust
std::thread::spawn(move || {
    let _watcher = watcher; // 持有 watcher，使其在线程中存活
    for event in rx { ... }
});
```

---

### BUG-03 🔴 `search_content` 对非 ASCII 内容的字节切片会 panic

**文件**: [`commands.rs:573-577`](file:///d:/Shaoyilei/Desktop/Workspace/code/reader/src-tauri/src/commands.rs#L573-L577)

**问题描述**: `col` 是字节偏移量，`line[start..end]` 是按字节索引切片。对于含中文的文本行，当 `start` 或 `end` 落在多字节字符中间时，Rust 会 panic（thread 'tokio-runtime-worker' panicked at 'byte index N is not a char boundary'）。

```rust
let col = line.to_lowercase().find(&query_lower).unwrap_or(0);
let start = col.saturating_sub(40);
let end = (col + query.len() + 40).min(line.len());
let context = line[start..end].to_string();  // ← 非字符边界时 panic！
```

**修复方案**: 使用安全的字符边界搜索：
```rust
fn safe_slice(s: &str, start: usize, end: usize) -> &str {
    let start = s.char_indices().map(|(i,_)|i).filter(|&i|i>=start).next().unwrap_or(s.len());
    let end = s.char_indices().map(|(i,_)|i).filter(|&i|i>=end).next().unwrap_or(s.len());
    &s[start..end]
}
```

---

### BUG-04 🔴 `openTab` 对已存在的标签设置错误的 `activeTabId`

**文件**: [`tabs.ts:38-65`](file:///d:/Shaoyilei/Desktop/Workspace/code/reader/src/lib/stores/tabs.ts#L38-L65)

**问题描述**: 当检测到同路径标签已存在时，`update` 回调内部调用 `activeTabId.set(existing.id)` 切换到正确标签，但回调结束后第 64 行的 `activeTabId.set(id)` 仍然执行，将 `activeTabId` 覆盖为一个从未被创建的新 ID，导致没有任何标签处于激活状态。

```typescript
const id = `tab-${nextTabId++}`; // 始终递增，即使不使用

openedTabs.update(tabs => {
  const existing = tabs.find(t => t.path === path);
  if (existing) {
    activeTabId.set(existing.id); // 设置正确的 ID
    return tabs; // 未添加新标签
  }
  // ...
});

activeTabId.set(id); // ← 覆盖上面的设置！id 对应不存在的标签
return id;
```

**修复方案**:
```typescript
export function openTab(name: string, path: string | null, content = ''): string {
  let resolvedId: string | null = null;
  openedTabs.update(tabs => {
    if (path) {
      const existing = tabs.find(t => t.path === path);
      if (existing) { resolvedId = existing.id; return tabs; }
    }
    const id = `tab-${nextTabId++}`;
    resolvedId = id;
    return [...tabs, { id, name, path, content, isDirty: false,
      cursorPosition: { line: 1, column: 1 }, scrollPercentage: 0 }];
  });
  activeTabId.set(resolvedId!);
  return resolvedId!;
}
```

---

### BUG-05 🔴 `handleRename` 参数传递错误

**文件**: [`Sidebar.svelte:167`](file:///d:/Shaoyilei/Desktop/Workspace/code/reader/src/lib/components/Sidebar.svelte#L167)

**问题描述**: `renameItem(dir, oldName, newName)` 的第一个参数应为**父目录路径**，第二个为**旧文件名**，但调用时将 `oldPath`（完整文件路径）同时作为 `dir` 和 `oldName` 传入。`TauriFileSystem.renameItem` 会拼接 `${dirPath}/${oldName}`，结果为 `${oldPath}/${oldPath}`，完全错误。

```typescript
// 错误调用
await renameItem(oldPath, oldPath, newName);
// TauriFileSystem 内部执行：
// await this.tauriFs.renameFile(`${oldPath}/${oldPath}`, `${oldPath}/${newName}`)
```

**修复方案**:
```typescript
const sep = oldPath.includes('\\') ? '\\' : '/';
const parts = oldPath.split(sep);
const oldName = parts.pop()!;
const dirPath = parts.join(sep);
await renameItem(dirPath, oldName, newName);
```

---

### BUG-06 🟠 `flushContent` 实际未刷新内容

**文件**: [`editor.ts:73-80`](file:///d:/Shaoyilei/Desktop/Workspace/code/reader/src/lib/stores/editor.ts#L73-L80)

**问题描述**: 防抖机制的最后一次输入内容被 `updateContent` 的闭包捕获，`flushContent` 只是取消了计时器，但**并未将捕获的最新内容 set 到 store**。代码注释自身已承认此问题。`saveFile()` → `flushContent()` → `isDirty.set(false)` 这条调用链会在用户最后一次输入后 150ms 内执行保存时，丢失最后的输入内容。

```typescript
export function flushContent() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  // ← 注释：这里拿不到最新内容！但 saveFile 直接调用了这里
}
```

**修复方案**: 在 `updateContent` 中保存最新内容引用：
```typescript
let _pendingContent: string | null = null;

export function updateContent(content: string) {
  isDirty.set(true);
  _pendingContent = content;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    fileContent.set(content);
    _pendingContent = null;
    debounceTimer = null;
  }, DEBOUNCE_DELAY);
}

export function flushContent() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
    if (_pendingContent !== null) {
      fileContent.set(_pendingContent);
      _pendingContent = null;
    }
  }
}
```

---

### BUG-07 🟠 `handleDelete` 使用目录 basename 而非全路径

**文件**: [`Sidebar.svelte:190-192`](file:///d:/Shaoyilei/Desktop/Workspace/code/reader/src/lib/components/Sidebar.svelte#L190-L192)

**问题描述**: `$currentDirectory` 在 `openFolder()` 中（第 61 行）被设置为目录名的最后一段（basename），而非完整路径。`deleteItem` 和随后的 `readDirectoryTree` 均以此 basename 作为路径，导致操作指向错误位置。

```typescript
// Sidebar.svelte:61 - openFolder() 中
currentDirectory.set(dirPath!.split(/[/\\]/).pop() || dirPath!);
//  ↑ 只存 basename，如 "my-docs"

// Sidebar.svelte:191 - handleDelete() 中
const dir = $currentDirectory; // 得到 "my-docs"，而非 "C:\Users\...\my-docs"
await deleteItem(dir || '', ...); // 路径错误
```

**修复方案**: 使用单独变量 `dirFullPath` 存储完整路径，区别于显示用的 `currentDirectory`；或在 store 中同时保存 basename 和 fullpath。

---

### BUG-08 🟠 搜索后清除在 Tauri 模式下文件树无法恢复

**文件**: [`Sidebar.svelte:217-252`](file:///d:/Shaoyilei/Desktop/Workspace/code/reader/src/lib/components/Sidebar.svelte#L217-L252)

**问题描述**: `searchInTree` 的结果直接调用 `fileTree.set(results)` 覆盖原始文件树。`clearSearch` 函数只在浏览器模式（`dirHandle` 存在）才调用 `openFolder()` 恢复，在 Tauri 模式下不做任何恢复操作，用户只能关闭重开应用。

```typescript
function searchInTree(...) { ... }

async function searchFiles() {
  const results = searchInTree($fileTree, searchQuery.toLowerCase());
  fileTree.set(results); // ← 原始树被覆盖，无法恢复
}

function clearSearch() {
  searchQuery = '';
  if (dirHandle) { openFolder(); } // 只有浏览器模式才恢复
  // Tauri 模式：什么都不做
}
```

**修复方案**: 搜索时用局部过滤变量，不覆盖 store；或在进行搜索前备份原始树。

---

### BUG-09 🟠 `toAssetUrl` 生成错误的 asset:// URL

**文件**: [`markdown.ts:38-42`](file:///d:/Shaoyilei/Desktop/Workspace/code/reader/src/lib/utils/markdown.ts#L38-L42)

**问题描述**: 函数将路径中的正斜杠替换为反斜杠，再进行 URL 编码。Tauri v2 的 `asset://` 协议需要**正斜杠**分隔的路径，且路径本身不应整体编码（仅特殊字符需编码）。

```typescript
function toAssetUrl(filePath: string): string {
  const normalized = filePath.replace(/\//g, '\\'); // ← 错误：应保留正斜杠
  return `asset://localhost/${encodeURIComponent(normalized)}`; // ← 整体编码会转义路径分隔符
}
```

对于路径 `C:\Users\docs\image.png`，生成的 URL 为：  
`asset://localhost/C%3A%5CUsers%5Cdocs%5Cimage.png`（反斜杠被编码，路径无效）

**修复方案**:
```typescript
function toAssetUrl(filePath: string): string {
  // 统一使用正斜杠，仅对非路径字符进行编码
  const normalized = filePath.replace(/\\/g, '/');
  const encoded = normalized.split('/').map(segment => encodeURIComponent(segment)).join('/');
  return `asset://localhost/${encoded}`;
}
```

---

### BUG-10 🟠 Ctrl+Q 强制关闭跳过未保存文件检测

**文件**: [`+page.svelte:344-363`](file:///d:/Shaoyilei/Desktop/Workspace/code/reader/src/routes/+page.svelte#L344-L363)

**问题描述**: Ctrl+Q 快捷键处理先清除了 `closeHandlerCleanup`（即注销了 `onCloseRequested` 监听），再调用 `appWindow.destroy()`，绕过了正常关闭流程中的未保存检测弹窗，可能导致用户数据丢失。

```typescript
if ((e.ctrlKey || e.metaKey) && e.key === 'q') {
  if (isTauri()) {
    if (closeHandlerCleanup) {
      closeHandlerCleanup(); // 注销保护性监听
      closeHandlerCleanup = null;
    }
    await appWindow.destroy(); // 直接销毁，不问用户
  }
}
```

**修复方案**: Ctrl+Q 应复用 `setupTauriCloseHandler` 的逻辑，而非绕过它：
```typescript
// 直接触发正常关闭流程，由 onCloseRequested 处理未保存检测
await appWindow.close(); // 而非 destroy()
```

---

### BUG-11 🟠 `TauriFileSystem.readFile` 对句柄型 FileRef 仅用文件名

**文件**: [`native-fs.ts:75-77`](file:///d:/Shaoyilei/Desktop/Workspace/code/reader/src/lib/utils/native-fs.ts#L75-L77)

**问题描述**: 当 `file` 为 `FileSystemFileHandle` 时，代码使用 `file.name`（仅文件名，无目录路径）调用 Tauri 的 `read_file` 命令，在 Tauri 模式下这是无效路径，必然失败。

```typescript
async readFile(file: FileRef): Promise<string> {
  return await this.tauriFs.readFile(isPathRef(file) ? file : file.name); // file.name = "test.md"，无路径
}
```

---

### BUG-12 🟠 导出 HTML 和打印内容未做 XSS 防护

**文件**: [`browser-fs.ts:321-374`](file:///d:/Shaoyilei/Desktop/Workspace/code/reader/src/lib/utils/browser-fs.ts#L321-L374)

**问题描述**: `exportAsHTML` 中 `filename` 变量直接插入 `<title>` 标签未转义；`printContent` 中 `htmlContent` 直接写入新窗口文档，无任何 XSS 过滤。若文档内容或文件名中包含恶意脚本，会在打印/导出时执行。

```typescript
// exportAsHTML: filename 未转义
const fullHTML = `...
<title>${filename}</title>   // ← XSS 风险
...${htmlContent}            // ← 同上
`;

// printContent: 直接写入
printWindow.document.write(`...${htmlContent}...`); // ← XSS 风险
```

---

### BUG-13 🟡 `open_file_dialog` 读取文件内容后立即丢弃

**文件**: [`commands.rs:111-112`](file:///d:/Shaoyilei/Desktop/Workspace/code/reader/src-tauri/src/commands.rs#L111-L112)

**问题描述**: 函数读取文件内容赋给 `_content`（下划线前缀表示故意忽略），但 `FileNode` 返回结构中并不包含 `content` 字段，这次 IO 操作完全多余，对大文件影响尤为明显。

```rust
let _content = fs::read_to_string(&path_str)  // 读取文件内容
    .map_err(|e| format!("Failed to read file: {}", e))?;
// _content 从未使用，直接丢弃
```

**修复方案**: 删除这两行代码即可。

---

### BUG-14 🟡 `directoryName` 路径分隔符检测逻辑错误

**文件**: [`file.ts:19-22`](file:///d:/Shaoyilei/Desktop/Workspace/code/reader/src/lib/stores/file.ts#L19-L22)

**问题描述**: 在 Windows 路径 `C:\Users\docs` 上，先用 `/` 分割得到 `["C:\\Users\\docs"]`，`pop()` 返回整个字符串（非 null），短路运算符阻止了正确的 `\\` 分割，最终返回整个路径而非 `docs`。

```typescript
return $currentDirectory.split('/').pop() || $currentDirectory.split('\\').pop() || null;
//     ↑ Windows 路径按 '/' 分割只有一个元素，pop() 返回整个字符串，触发短路
```

**修复方案**:
```typescript
const sep = $currentDirectory.includes('\\') ? '\\' : '/';
return $currentDirectory.split(sep).pop() || null;
```

---

### BUG-15 🟡 搜索替换在大小写不敏感时替换末尾位置计算错误

**文件**: [`SearchReplace.svelte:94`](file:///d:/Shaoyilei/Desktop/Workspace/code/reader/src/lib/components/SearchReplace.svelte#L94)

**问题描述**: 替换当前匹配时，截取末尾使用 `idx + searchQuery.length`，但 `idx` 是在 `content.toLowerCase()` 上找到的字节偏移，当原文与搜索词大小写不同时（如搜索 `hello` 匹配到 `Hello`），`searchQuery.length` 仍为正确值，但对于含多字节 Unicode 的内容，字节长度与字符数不等，可能截断错误。

```typescript
const newContent = content.slice(0, idx) + replaceText + content.slice(idx + searchQuery.length);
```

**修复方案**: 使用 `RegExp.exec` 直接获取匹配项的长度，避免依赖 `searchQuery.length`。

---

### BUG-16 🟡 浏览器粘贴图片返回的 Markdown 路径无效

**文件**: [`image-handler.ts:113-125`](file:///d:/Shaoyilei/Desktop/Workspace/code/reader/src/lib/utils/image-handler.ts#L113-L125)

**问题描述**: 浏览器模式下，图片被下载到用户的下载文件夹，但返回的 Markdown 为 `![image](./assets/image-xxx.png)`，这个相对路径在浏览器上下文中指向的位置与实际下载位置完全不同，图片无法显示。

**修复方案**: 浏览器模式应使用 `data:` base64 URI 嵌入图片，而非相对路径：
```typescript
async function handleBrowserImagePaste(blob: Blob, imageName: string): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(`![image](${reader.result})`);
    reader.readAsDataURL(blob);
  });
}
```

---

### BUG-17 🟡 `prepareLatex` 与 `markdown.ts` fence 渲染器冲突

**文件**: [`latex.ts:41-57`](file:///d:/Shaoyilei/Desktop/Workspace/code/reader/src/lib/utils/latex.ts#L41-L57) / [`markdown.ts:106`](file:///d:/Shaoyilei/Desktop/Workspace/code/reader/src/lib/utils/markdown.ts#L106)

**问题描述**: `prepareLatex` 用正则匹配并替换 ` ```lang\n...\n``` ` 代码围栏块，将其转换为 `<pre>` HTML；随后 markdown-it 解析剩余内容时，它自身的 `fence` 渲染规则（含 mermaid、copy 按钮等特性）已无法触发。若正则匹配失败（如围栏末尾有多余空格），该代码块会被 markdown-it 再次处理，造成双重渲染。

---

### BUG-18 🟡 `BrowserFileSystem.saveFile` 遗漏 `await`

**文件**: [`native-fs.ts:220`](file:///d:/Shaoyilei/Desktop/Workspace/code/reader/src/lib/utils/native-fs.ts#L220)

**问题描述**: `exportAsMarkdown` 调用缺少 `await`，虽然当前实现是同步的，但违背异步接口约定，若实现变更为异步（如加入文件保存对话框），会造成静默失败。

```typescript
} else {
  this.browserFs.exportAsMarkdown(filename, content); // 缺少 await
}
```

---

### BUG-19 🟢 `create_file` 静默覆盖已存在文件

**文件**: [`commands.rs:306-309`](file:///d:/Shaoyilei/Desktop/Workspace/code/reader/src-tauri/src/commands.rs#L306-L309)

**问题描述**: 使用 `fs::write` 直接写入，若文件已存在则静默覆盖，未提供任何保护或警告机制。

**修复方案**: 添加文件存在性检查，或在调用方确认后再执行。

---

### BUG-20 🟢 标签项缺少键盘事件处理（无障碍缺陷）

**文件**: [`TabBar.svelte:66-86`](file:///d:/Shaoyilei/Desktop/Workspace/code/reader/src/lib/components/TabBar.svelte#L66-L86)

**问题描述**: 标签项设置了 `role="tab"` 和 `tabindex="0"`，表明其需要支持键盘访问，但缺少 `onkeydown` 处理，用户无法通过 Enter/Space 键切换标签，违反 WAI-ARIA 规范。

**修复方案**:
```svelte
onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && handleTabClick(tab.id)}
```

---

### BUG-21 🟢 `getFileIcon` / `getFileExtension` 在多文件中重复实现

**文件**: `tauri-fs.ts:175-189` / `browser-fs.ts:277-289` / `native-fs.ts:302-313`

**问题描述**: 两个工具函数在 3 个文件中完全重复实现，维护成本高，若逻辑需要修改必须同步三处。

**修复方案**: 将这两个函数提取到独立的工具文件（如 `src/lib/utils/file-utils.ts`），三处均从该文件导入。

---

## 优先修复建议

```
立即修复（影响核心功能）：
  BUG-01 → 目录树加载失效
  BUG-02 → 文件监听完全失效
  BUG-03 → 中文内容搜索崩溃
  BUG-04 → 标签切换状态错误
  BUG-05 → 重命名功能完全无效

近期修复（影响数据安全）：
  BUG-06 → 保存可能丢失内容
  BUG-07 → 删除操作路径错误
  BUG-10 → Ctrl+Q 丢失未保存数据

计划修复（提升稳定性）：
  BUG-08、09、11、12、14、15、16、17、18
```
