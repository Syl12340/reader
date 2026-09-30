# Reader Typora 视觉改造验收记录

更新时间：2026-06-15

## 核验结论

最初的完成报告不能直接成立。首次审查时实际发现：

- 根目录不存在报告中提到的 `implementation_plan.md` 和 `walkthrough.md`。
- Playwright 为 `7 passed, 3 failed`。
- 视觉展示 fixture 和截图回归测试尚未创建。
- Google Fonts 仍在应用 CSS 和导出 HTML 中远程加载。
- `typora` 已注册，但默认主题仍是 `default`。
- 文档主题仍通过旧变量影响应用外壳。
- 文件菜单“新建”只创建标签，不会显示编辑器。

上述问题已在本轮补齐并重新验证。

## 实际完成项

### 主题与排版

- 新设计令牌已接入 `app.css`。
- 应用外壳使用 `--ui-*`，文档区域使用 `--doc-*`。
- GitHub、Newsprint、Night 和 Typora 主题只覆盖文档令牌。
- Typora 成为无历史设置时的默认文档主题。
- 移除两处 Google Fonts 远程引用，改用系统字体栈。
- Preview 取消额外 `max-width`，避免与动态 padding 叠加造成双重收窄。
- WYSIWYM、源码和 Preview 使用统一的 780px 阅读网格。
- 默认 Typora 标题移除粗重底边框。
- 引用、代码和表格改为更轻的平面样式。
- 增加 `prefers-reduced-motion` 降级规则。

### 应用外壳

- 独立模式栏已移除，沉浸、源码、预览入口位于状态栏。
- 模式按钮增加 `aria-label` 和 `:focus-visible`。
- 未保存圆点不再使用脉冲动画。
- 标签栏、侧边栏、浮层和设置页使用统一 UI 令牌。

### 功能修复

- 修复 Toolbar 文件菜单“新建”未设置 `isEditing` 的问题。
- E2E 新建文档改走稳定的菜单入口，移除页面初始化阶段的快捷键竞态。
- 模式切换测试改为使用可访问名称，不依赖已删除的 `.editor-mode-switcher`。
- 源码版心测试改为测量包含行内边距的真实文字起点。

### 视觉回归

新增：

```text
tests/fixtures/visual-showcase.md
tests/e2e/visual-regression.spec.ts
tests/e2e/visual-regression.spec.ts-snapshots/typora-light-win32.png
tests/e2e/visual-regression.spec.ts-snapshots/typora-dark-source-win32.png
```

覆盖：

- Windows Chromium，1366x768。
- Typora 亮色沉浸模式。
- Typora 暗色源码模式。
- 标题、正文、列表、任务框、引用、公式、代码、Mermaid、表格和图片。

### 导出功能

- 修复 DOCX 仅把 HTML 文本改扩展名的问题，现生成标准 OOXML ZIP 结构。
- 修复 EPUB 仅输出单个 XHTML 文件的问题，现生成 EPUB 容器、清单、导航和正文。
- 修复 PNG 只创建空白 Canvas 的问题，现优先渲染 HTML，并在浏览器不支持时降级为 Canvas 文本排版。
- Tauri 新增按格式设置过滤器的保存对话框，以及 Base64 二进制写入命令。
- HTML 导出统一清理脚本、事件属性和危险 URL。
- LaTeX 导出保留行内与块级公式，CommonMark 转换修复重复列表符号。
- Mermaid 在导出时使用源码块降级，避免异步图形未就绪导致内容丢失。
- 新增 5 个导出单测和 5 个导出 E2E，校验下载文件签名与关键容器条目。

## 验证结果

```text
pnpm check
svelte-check found 0 errors and 0 warnings

pnpm test
3 test files passed
13 tests passed

pnpm test:e2e
17 tests passed

pnpm build
Build succeeded

cargo check --manifest-path src-tauri/Cargo.toml
Finished dev profile successfully

python scripts/build.py --no-bundle
Production executable rebuilt
```

生产可执行文件：

```text
D:\Shaoyilei\Desktop\Workspace\code\reader\target\release\reader.exe
Size: 16,932,864 bytes
Last write: 2026-06-16 00:14:42
```

## 已知限制

- Vite 仍提示 `native-fs.ts` 和 KaTeX 同时存在静态、动态导入。
- 部分生产 chunk 大于 500KB，属于后续性能拆包工作，不阻塞本次视觉验收。
- 错误降级测试产生的缺失图片 404 是预期行为。
- 自动视觉快照尚未覆盖 1920x1080、125% 和 150% Windows DPI。
- DOCX 当前将图片转换为替代文本，尚未写入 OOXML media relationship。
- EPUB 当前不打包本地图片与字体，跨设备打开时外部资源可能不可用。
- PNG/JPG 在 SVG `foreignObject` 不可用时会降级为纯文本排版，确保不导出空白文件。
