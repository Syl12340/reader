# Reader - 轻量级 Markdown/LaTeX 阅读器

一个轻量、美观、高性能的 Markdown 和 LaTeX 阅读器，基于 Tauri v2 + Svelte 构建。

## ✨ 特性

### 核心功能

- 📝 **Markdown 渲染** - 完整支持 CommonMark 和 GFM 规范
- 📐 **LaTeX 数学公式** - 支持行内和块级数学公式渲染（KaTeX），占位符保护法避免语义冲突
- 🎨 **代码高亮** - 支持 30+ 编程语言的语法高亮（Shiki），异步渲染，明暗主题自适应
- 📁 **文件树浏览** - 侧边栏显示目录结构，支持递归展开（Rust walkdir 高性能扫描）
- ✏️ **轻量编辑** - 支持基础文本编辑和快捷键操作
- 🌙 **主题切换** - 支持亮色和暗色主题，代码高亮同步切换
- ⚡ **极速性能** - 启动快，内存占用低
- 📦 **轻量打包** - 安装包仅 ~14MB（比 Electron 小 50 倍）
- 🖥️ **跨平台** - 支持 Windows、macOS、Linux

### 编辑器增强

- 🔤 **Markdown 快捷键** - Ctrl+B 粗体、Ctrl+I 斜体、Ctrl+K 链接、Ctrl+Shift+K 代码块
- 📋 **列表自动补全** - Enter 自动继续列表，空行 Enter 退出列表
- 🔢 **标题快捷键** - Ctrl+Shift+1-6 快速插入 H1-H6 标题
- ↔️ **智能缩进** - Tab/Shift+Tab 增加/减少缩进，Enter 保持缩进
- ✨ **当前行高亮** - 光标所在行背景高亮，行号同步高亮
- 📊 **大纲视图 (TOC)** - 侧边栏显示 H1-H6 目录树，点击快速跳转

### 文件管理

- 💾 **未保存检测** - 关闭窗口或切换文件时，自动提示保存
- ⏱️ **自动保存** - 可选 30 秒自动保存，防止意外丢失
- 📂 **最近文件列表** - 文件菜单显示最近打开的文件，快速访问
- 🖼️ **本地图片支持** - Tauri asset 协议，支持显示本地绝对/相对路径图片

### 界面体验

- ↔️ **可伸缩侧边栏** - 拖拽调整侧边栏宽度，自动持久化
- 🔄 **双向滚动同步** - 编辑器和预览区滚动位置实时同步
- 📄 **PDF 导出** - 优化的打印样式，隐藏 UI，仅保留内容
- 🎯 **原生菜单** - clickOutside 关闭菜单，避免 blur 竞争
- 📁 **原生保存对话框** - 另存为使用系统原生对话框

---

## 🚀 快速开始

### 环境要求

- **Node.js** >= 18
- **pnpm** >= 8（或 npm）
- **Rust** >= 1.70（构建原生应用需要）

### 安装依赖

```bash
# 使用 pnpm（推荐）
pnpm install

# 或使用 npm
npm install
```

### 运行方式

#### 方式 1: 浏览器模式（开发/调试）

```bash
python reader.py dev
```

然后在浏览器中打开 http://localhost:5173

#### 方式 2: Tauri 原生应用（推荐）

```bash
python reader.py dev --tauri
```

这将启动一个原生桌面窗口，无需浏览器。

---

## 📦 构建

### 构建原生可执行文件

```bash
python reader.py build --tauri
```

构建完成后，可执行文件位于：
- **Windows**: `src-tauri/target/release/reader.exe`
- **安装包**: `src-tauri/target/release/bundle/nsis/`

### 仅构建前端

```bash
python reader.py build
```

输出目录: `build/`

---

## 🛠️ CLI 工具

项目使用统一的 Python CLI 工具 `reader.py` 管理所有操作。

### 命令列表

```bash
# 开发
python reader.py dev              # 启动 Vite 开发服务器
python reader.py dev --tauri      # 启动 Tauri 开发模式
python reader.py dev --port 3000  # 指定端口

# 构建
python reader.py build            # 构建前端
python reader.py build --tauri    # 构建 Tauri exe
python reader.py build --clean    # 清理后构建

# 检查
python reader.py check            # 检查环境状态
python reader.py check --server   # 检查服务器状态

# 工具
python reader.py open             # 打开浏览器
python reader.py open --port 3000 # 指定端口打开
python reader.py clean            # 清理构建缓存
python reader.py clean --all      # 清理所有缓存（包括 node_modules）
python reader.py install          # 安装依赖
python reader.py install --force  # 强制重新安装
python reader.py icon             # 生成应用图标
```

---

## 📖 使用说明

### 快捷键

#### 文件操作

| 操作 | 快捷键 |
|------|--------|
| 新建文件 | `Ctrl+N` |
| 打开文件 | `Ctrl+O` |
| 保存文件 | `Ctrl+S` |
| 切换编辑/预览 | `Ctrl+E` |
| 切换侧边栏 | `Ctrl+B` |
| 切换预览面板 | `Ctrl+P` |
| 全屏切换 | `F11` |

#### Markdown 格式

| 操作 | 快捷键 |
|------|--------|
| **粗体** | `Ctrl+B` |
| *斜体* | `Ctrl+I` |
| [链接]() | `Ctrl+K` |
| ~~删除线~~ | `Ctrl+Shift+X` |
| `行内代码` / 代码块 | `Ctrl+Shift+K` |
| H1-H6 标题 | `Ctrl+Shift+1-6` |
| 增加缩进 | `Tab` |
| 减少缩进 | `Shift+Tab` |

#### 编辑辅助

| 操作 | 说明 |
|------|------|
| 列表自动补全 | Enter 自动继续 `- ` 或 `1. ` |
| 退出列表 | 空行按 Enter |
| 保持缩进 | Enter 自动保持当前缩进 |
| 括号包裹 | 选中文本后输入 `(`, `[`, `{`, `"`, `'`, `` ` `` |
| Tab 缩进 | 4 空格 |

### Markdown 语法

支持标准 Markdown 语法和 GFM 扩展：

```markdown
# 标题

**粗体** *斜体* ~~删除线~~

- 无序列表
1. 有序列表

> 引用块

`行内代码`

[链接](https://example.com)

![图片](image.png)

| 表格 | 列1 | 列2 |
|------|-----|-----|
| 行1  | 数据 | 数据 |
```

### LaTeX 数学公式

```markdown
行内公式：$E = mc^2$

块级公式：
$$
\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}
$$
```

### 代码高亮

````markdown
```javascript
function hello() {
  console.log('Hello, World!');
}
```

```python
def hello():
    print('Hello, World!')
```

```rust
fn hello() {
    println!("Hello, World!");
}
```
````

### 本地图片

支持在 Markdown 中引用本地图片：

```markdown
![相对路径](./images/photo.png)
![绝对路径](D:\photos\image.jpg)
```

Tauri 模式下自动转换为 asset 协议加载。

---

## 📁 项目结构

```
reader/
├── reader.py               # 统一 CLI 工具
├── src/                    # Svelte 前端
│   ├── lib/
│   │   ├── components/     # UI 组件
│   │   │   ├── Editor.svelte      # 编辑器（快捷键、行高亮、滚动同步）
│   │   │   ├── Preview.svelte     # 预览区（Shiki 高亮、图片处理）
│   │   │   ├── Sidebar.svelte     # 侧边栏（文件树 + 大纲视图）
│   │   │   ├── Outline.svelte     # 大纲/目录视图
│   │   │   ├── FileTree.svelte    # 文件树组件
│   │   │   ├── Toolbar.svelte     # 工具栏（菜单、快捷键、窗口控制）
│   │   │   └── StatusBar.svelte   # 状态栏
│   │   ├── stores/         # 状态管理
│   │   │   ├── editor.ts          # 编辑器状态（防抖、滚动同步）
│   │   │   ├── file.ts            # 文件状态
│   │   │   └── theme.ts           # 主题状态
│   │   └── utils/          # 工具函数
│   │       ├── markdown.ts        # Markdown 渲染（图片路径解析）
│   │       ├── latex.ts           # LaTeX 渲染（占位符保护法）
│   │       ├── highlight.ts       # Shiki 代码高亮（异步、主题切换）
│   │       ├── browser-fs.ts      # 浏览器文件系统
│   │       ├── tauri-fs.ts        # Tauri 文件系统（IPC）
│   │       ├── native-fs.ts       # 统一文件系统门面
│   │       └── platform.ts        # 平台检测
│   ├── routes/
│   │   └── +page.svelte    # 主页面（渲染流水线、自动保存、最近文件）
│   ├── app.html            # HTML 模板
│   └── app.css             # 全局样式（含打印/PDF 导出样式）
├── src-tauri/              # Rust 后端 (Tauri)
│   ├── src/
│   │   ├── main.rs         # 应用入口
│   │   ├── lib.rs          # 库函数（注册命令）
│   │   └── commands.rs     # Tauri 命令（文件操作、目录树扫描）
│   ├── icons/              # 应用图标
│   ├── capabilities/       # 权限配置
│   ├── Cargo.toml          # Rust 依赖（walkdir、notify）
│   ├── build.rs            # 构建脚本
│   └── tauri.conf.json     # Tauri 配置
├── scripts/                # 辅助脚本
│   └── generate-icons.cjs
├── static/                 # 静态资源
├── package.json
├── svelte.config.js
├── vite.config.ts
├── tailwind.config.js
├── postcss.config.js
├── tsconfig.json
└── README.md
```

---

## 🏗️ 技术栈

### 前端

| 技术 | 用途 |
|------|------|
| **Svelte 4** | UI 框架 |
| **SvelteKit** | 应用框架（adapter-static SPA 模式） |
| **TypeScript** | 类型安全 |
| **Tailwind CSS 3** | 样式框架 |
| **Vite 5** | 构建工具 |
| **markdown-it** | Markdown 解析 |
| **KaTeX** | LaTeX 渲染（占位符保护法） |
| **Shiki** | 代码高亮（30+ 语言，明暗主题） |

### 后端（Tauri）

| 技术 | 用途 |
|------|------|
| **Rust** | 系统语言 |
| **Tauri v2** | 桌面应用框架 |
| **walkdir** | 高性能目录递归扫描 |
| **notify** | 文件系统监听 |
| **WebView2** (Windows) | 系统 WebView |
| **WebKit** (macOS/Linux) | 系统 WebView |

---

## 🎨 主题定制

主题颜色在 `src/app.css` 中定义：

```css
:root {
  --bg-primary: #f8f6f1;
  --bg-secondary: #f1eee7;
  --text-primary: #22211f;
  --accent-color: #3a6ff7;
  --font-content: 'Source Serif 4', 'Noto Serif SC', serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
}

[data-theme="dark"] {
  --bg-primary: #1e1c1a;
  --bg-secondary: #262421;
  --text-primary: #f2efe8;
  --accent-color: #7aa2ff;
}
```

---

## 🔧 开发指南

### 添加新组件

```bash
# 创建组件文件
touch src/lib/components/MyComponent.svelte
```

```svelte
<script lang="ts">
  export let title: string;
</script>

<div class="my-component">
  <h2>{title}</h2>
  <slot />
</div>
```

### 添加 Tauri 命令

```rust
// src-tauri/src/commands.rs
#[command]
pub fn my_command(param: String) -> Result<String, String> {
    Ok(format!("Result: {}", param))
}
```

```rust
// src-tauri/src/lib.rs
.invoke_handler(tauri::generate_handler![
    // ... 其他命令
    my_command,
])
```

```typescript
// 前端调用
import { invoke } from '@tauri-apps/api/core';
const result = await invoke('my_command', { param: 'hello' });
```

---

## 🐛 故障排除

### 问题: 端口被占用

```bash
# 使用其他端口
python reader.py dev --port 3000
```

### 问题: 依赖安装失败

```bash
# 清理后重新安装
python reader.py clean --all
python reader.py install --force
```

### 问题: Tauri 构建失败

```bash
# 确保 Rust 工具链正确安装
rustc --version
cargo --version

# 清理 Rust 缓存
cd src-tauri
cargo clean
cd ..

# 重新构建
python reader.py build --tauri --clean
```

### 问题: 跨盘符编译错误 (os error 1)

如果源代码和 target 目录在不同盘符，可能会出现此错误。解决方法：

```bash
# 设置 target 目录为项目内
set CARGO_TARGET_DIR=./src-tauri/target
python reader.py build --tauri
```

### 问题: 本地图片无法显示

确保在 Tauri 模式下运行，浏览器模式不支持本地文件访问。图片路径支持：
- 相对路径：`./images/photo.png`
- 绝对路径：`D:\photos\image.jpg`

---

## 📄 许可证

本项目采用 MIT 许可证。

---

## 🙏 致谢

- [Tauri](https://tauri.app/) - 跨平台应用框架
- [Svelte](https://svelte.dev/) - 前端框架
- [Tailwind CSS](https://tailwindcss.com/) - CSS 框架
- [markdown-it](https://github.com/markdown-it/markdown-it) - Markdown 解析器
- [KaTeX](https://katex.org/) - LaTeX 渲染器
- [Shiki](https://shiki.style/) - 代码高亮

---

## 📞 联系方式

- 作者: Shaoyilei
- GitHub: [@yourusername](https://github.com/yourusername)

---

⭐ 如果这个项目对你有帮助，请给它一个星标！
