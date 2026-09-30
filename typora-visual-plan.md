# Reader Typora 化视觉改造计划

更新时间：2026-06-15

## 1. 目标

本轮只改造 Reader 的外观、信息层级和显示风格，使其更接近 Typora 的核心体验：

- 文档是视觉中心，应用控件主动退居次要位置。
- 界面扁平、安静、克制，减少渐变、阴影、边框和重复工具栏。
- 沉浸、源码、预览三种模式共享统一的文档宽度、滚动节奏和主题语义。
- 保留 Reader 已完成的多标签、侧边栏、WYSIWYM Widget 和编辑辅助能力。
- 建立可持续扩展的“应用外壳主题 + 文档排版主题”双层主题系统。

本计划是“Typora 风格借鉴”，不是对 Typora 的像素级复制。

## 2. 当前界面问题

### 2.1 应用层级过多

当前页面依次存在：

1. 菜单栏。
2. 快捷工具栏。
3. 标签栏。
4. 独立的沉浸/源码/预览切换栏。
5. 主内容区。
6. 状态栏。

多个横向区域持续占用垂直空间，文档区不够突出。模式切换与状态栏还重复表达当前模式。

### 2.2 视觉语言偏重

- `body` 使用多层径向渐变和线性渐变。
- 暖色纸张背景、圆角、阴影和强调色同时存在，视觉焦点分散。
- 全局给多个大型容器添加 `0.3s` 主题过渡，切换时显得拖沓，也可能增加重绘。
- 当前组件分别维护样式，尺寸、圆角、边框和状态色缺少统一尺度。

### 2.3 文档排版不够统一

- WYSIWYM、源码和预览模式的字体、宽度、顶部留白及行高差异较大。
- 默认标题沿用 GitHub 风格底边框，不符合 Typora 默认主题的克制排版。
- 引用、代码、表格和 Widget 偏卡片化，文档容易呈现“组件集合”而不是连续文章。
- UI 字体依赖 Google Fonts，Tauri 离线环境存在加载不稳定和首屏字体跳变风险。

### 2.4 主题边界混乱

现有 `default`、`github`、`newsprint`、`night` 同时影响文档和应用外壳。后续若继续扩展主题，容易出现：

- 文档主题修改侧边栏或菜单颜色。
- 暗色应用外壳搭配错误的文档前景色。
- CodeMirror、Preview 和导出 HTML 的排版规则逐渐分叉。

## 3. 视觉原则

### 3.1 内容优先

- 主文档区域始终拥有最高对比度。
- 非活动控件降低对比度，悬停或聚焦时再增强。
- 非必要操作不常驻显示，优先放入菜单、右键菜单、命令入口或悬停操作。

### 3.2 扁平且有层级

- 常规分区使用背景色差和 `1px` 分隔线，不使用大面积阴影。
- 阴影只用于浮层、菜单、对话框和拖拽反馈。
- 普通控件圆角统一为 `4px`，浮层统一为 `6px`，不使用大胶囊造型。

### 3.3 稳定的阅读几何

- 文档推荐最大宽度：`780px`，允许设置范围 `680px` 至 `960px`。
- 左右安全边距：窄窗口 `24px`，普通窗口 `48px`。
- 顶部阅读留白：`56px`，窄窗口降为 `32px`。
- 三种模式切换不得造成文档整体左右跳动或滚动位置明显变化。

### 3.4 动效克制

- 颜色、背景和边框过渡控制在 `120ms` 至 `160ms`。
- 不对整个页面树设置统一 transition。
- 尊重 `prefers-reduced-motion`。
- 模式切换不使用缩放、弹跳或大面积淡入淡出。

## 4. 目标界面结构

### 4.1 顶部区域

将当前菜单栏和快捷工具栏收敛为一个紧凑顶栏：

- 高度控制在 `34px` 至 `38px`。
- 左侧保留菜单和侧边栏开关。
- 中间显示当前文件名及未保存状态。
- 右侧仅保留高频操作：搜索、分栏预览、主题、设置。
- 新建、打开、保存、导出等完整操作继续保留在菜单和快捷键中。
- 图标按钮默认无底色，悬停时出现轻微背景。

若 Windows 原生标题栏无法与菜单栏合并，则保留原生标题栏，但删除第二层大尺寸快捷栏。

### 4.2 标签栏

- 高度由 `36px` 收敛至 `30px` 至 `32px`。
- 仅一个标签时可隐藏标签栏；该行为做成设置项，默认隐藏。
- 活动标签使用背景差或细顶部/底部指示，不同时使用多种强调。
- 关闭按钮默认隐藏，在标签悬停、聚焦或存在未保存状态时显示。
- 未保存状态使用小圆点，不使用动画。
- 标签宽度建议 `120px` 至 `200px`，过长文件名省略。

### 4.3 模式切换

- 删除主内容上方独立的模式切换栏。
- 将“沉浸 / 源码 / 预览”移动到状态栏右侧，使用紧凑分段按钮或可展开菜单。
- 状态栏已有当前模式文本，应与切换控件合并，避免重复。
- 保留原有 store 和切换逻辑，只调整入口位置和样式。

### 4.4 侧边栏

- 默认宽度 `240px`，可调整范围保持现有能力。
- 使用比文档区略深或略灰的纯色背景。
- 文件、目录、大纲和搜索共享统一的行高、缩进和选中态。
- 顶部使用紧凑的“文件 / 大纲 / 搜索”切换，不保留大块标题区。
- 搜索框按需展开，不长期占用高度。
- 文件树行高建议 `28px`，目录层级缩进建议 `14px`。
- 当前文件只使用单一选中背景，不再叠加粗体、边框和高饱和强调色。

### 4.5 状态栏

- 高度控制在 `22px` 至 `24px`。
- 左侧仅显示光标位置、字数和保存状态。
- 右侧显示模式切换、编码及文档类型。
- 低频统计信息放入点击后弹出的详情，不全部常驻。
- 去掉未保存状态的脉冲动画。

## 5. 主题与设计令牌

### 5.1 拆分主题职责

新增两组独立令牌。

应用外壳令牌：

```css
--ui-bg;
--ui-panel;
--ui-panel-hover;
--ui-panel-active;
--ui-border;
--ui-text;
--ui-text-muted;
--ui-accent;
--ui-focus-ring;
--ui-shadow-popover;
```

文档令牌：

```css
--doc-bg;
--doc-text;
--doc-text-muted;
--doc-link;
--doc-selection;
--doc-code-bg;
--doc-code-text;
--doc-quote-border;
--doc-table-border;
--doc-content-width;
--doc-font-size;
--doc-line-height;
```

建议使用以下属性表达主题：

```html
<html
  data-ui-theme="light"
  data-doc-theme="typora"
  data-density="comfortable"
>
```

现有 `data-theme-preset` 可继续作为文档主题兼容入口，但不得再直接控制菜单、侧边栏和状态栏。

### 5.2 Typora Light

```css
--ui-bg: #f7f7f7;
--ui-panel: #f2f2f2;
--ui-panel-hover: #e9e9e9;
--ui-panel-active: #ffffff;
--ui-border: #e2e2e2;
--ui-text: #333333;
--ui-text-muted: #858585;
--ui-accent: #4f78c4;

--doc-bg: #ffffff;
--doc-text: #2f2f2f;
--doc-text-muted: #7a7a7a;
--doc-link: #3f6fb5;
--doc-code-bg: #f5f5f5;
--doc-quote-border: #d2d2d2;
--doc-table-border: #dedede;
```

### 5.3 Typora Dark

```css
--ui-bg: #202020;
--ui-panel: #252525;
--ui-panel-hover: #303030;
--ui-panel-active: #1e1e1e;
--ui-border: #363636;
--ui-text: #d8d8d8;
--ui-text-muted: #8f8f8f;
--ui-accent: #6e9eea;

--doc-bg: #1e1e1e;
--doc-text: #d6d6d6;
--doc-text-muted: #929292;
--doc-link: #7da6df;
--doc-code-bg: #282828;
--doc-quote-border: #505050;
--doc-table-border: #424242;
```

纯色背景替换现有 `body` 多层渐变。高亮色只用于焦点、链接、活动控件和关键状态。

### 5.4 字体

应用 UI 优先使用系统字体，避免桌面端依赖网络字体：

```css
--font-ui:
  Inter, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
--font-content:
  "Source Serif 4", "Noto Serif SC", "Source Han Serif SC",
  "Songti SC", serif;
--font-mono:
  "JetBrains Mono", "Cascadia Code", "SFMono-Regular", Consolas, monospace;
```

若继续使用 Source Serif 4 和 JetBrains Mono，应将字体文件打包到 `static/fonts/`，通过本地 `@font-face` 加载。

## 6. 文档排版规范

### 6.1 正文

- 默认字号 `16px`。
- 默认行高 `1.75`。
- 中文字距保持默认，不全局设置额外 `letter-spacing`。
- 段落下间距 `0.9em`，连续列表和引用内部适当收紧。
- 文档背景保持纯色，不模拟明显纸张纹理。

### 6.2 标题

- `h1`: `2em / 1.25`。
- `h2`: `1.55em / 1.3`。
- `h3`: `1.3em / 1.35`。
- `h4` 至 `h6` 通过字号和字重区分。
- Typora 默认主题下移除 `h1`、`h2` 底边框。
- 标题顶部间距随层级递减，避免每级都使用固定 `24px`。
- 活动标题的 Markdown 标记使用低对比度，不抢正文焦点。

### 6.3 链接和行内代码

- 链接默认使用主题链接色，不常驻下划线；悬停或键盘聚焦时显示下划线。
- 行内代码使用轻微背景和 `3px` 圆角。
- 行内代码前景色不使用高饱和粉色，避免正文出现过多彩色碎片。

### 6.4 引用

- 使用 `2px` 或 `3px` 左边线。
- 默认不添加整块背景和大圆角。
- 引用文字使用稍低对比度。
- 嵌套引用只增强缩进，不层层增加卡片。

### 6.5 代码块

- 代码块使用平坦的浅灰/深灰背景，圆角不超过 `4px`。
- 语言标签和复制按钮默认弱化，悬停或聚焦时增强。
- 不使用厚边框和明显投影。
- 源码状态与 Widget 状态使用一致的代码字体和行高。

### 6.6 表格

- 使用细边框和紧凑单元格间距。
- 表头只增加轻微背景及字重。
- 不给整个表格增加卡片阴影。
- 超宽表格允许局部横向滚动，不扩大文档画布。
- 表格 Widget 与 Preview 表格必须共享同一组文档令牌。

### 6.7 图片、公式和 Mermaid

- 块级图片默认居中，最大宽度为文档宽度。
- 默认圆角 `2px` 至 `4px`，不使用投影。
- 图片说明文字使用 `--doc-text-muted`。
- 公式保持足够上下留白，但不包裹成卡片。
- Mermaid 背景跟随文档背景，避免生成白色孤岛。
- 加载失败和渲染错误使用轻量内联提示，并保留清晰的“编辑源码”入口。

### 6.8 任务列表

- checkbox 尺寸与正文 x-height 协调。
- 使用主题强调色表达勾选状态。
- 已完成文字可降低透明度，但不能低于可读性要求。
- 键盘焦点必须有明显 focus ring。

## 7. 三种模式的显示统一

### 7.1 沉浸模式

- 作为默认视觉基线。
- 文档标记在非活动状态隐藏，活动状态使用低对比度显示。
- Widget 不能改变正常段落的左右基线。
- 光标所在块可有非常轻微的局部强调，但默认不增加背景卡片。

### 7.2 源码模式

- 保持与沉浸模式相同的内容宽度和顶部留白。
- 字体切换为等宽字体，行高建议 `1.65`。
- 行号区只占必要宽度，背景与文档区保持接近。
- 当前行高亮透明度要低，不能形成横贯整屏的强色条。
- 切换到源码后，原文当前位置仍应落在相近的屏幕区域。

### 7.3 预览模式

- Preview 使用与 WYSIWYM 相同的 `--doc-*` 令牌和内容宽度。
- 不再让 Preview 看起来像嵌入的独立网页。
- WYSIWYM Widget、Markdown Preview 和导出 HTML 的基础排版尽量共用规则。
- 预览滚动条、选择色和链接焦点保持应用主题一致。

## 8. 实施阶段

### 阶段 0：视觉基线

- 准备一份包含标题、长段落、列表、任务、引用、代码、图片、公式、Mermaid 和表格的视觉测试文档。
- 固定截图尺寸：`1366x768`、`1920x1080`。
- 分别记录亮色/暗色、侧边栏开关、三种编辑模式和分栏预览。
- 保存当前截图作为 before 基线。
- 将已知显示异常记录到 `task.md`，视觉改造不掩盖功能缺陷。

交付：

- `tests/fixtures/visual-showcase.md`
- `tests/e2e/visual-regression.spec.ts`
- before 截图基线

### 阶段 1：设计令牌和字体

- 新建应用外壳和文档令牌。
- 用纯色背景替换全局渐变。
- 移除大范围 `0.3s` transition。
- 将 UI 字体改为系统字体栈。
- 如需保留第三方字体，将字体资源本地化。
- 保持旧变量到新变量的临时映射，避免一次性破坏全部组件。

建议文件：

```text
src/lib/styles/tokens.css
src/lib/styles/document.css
src/lib/styles/components.css
src/app.css
```

验收：

- 应用外壳和文档主题可独立切换。
- Tauri 离线启动不发起 Google Fonts 请求。
- 亮色和暗色下无不可读文本。

### 阶段 2：应用框架瘦身

- 合并菜单栏与快捷操作区，删除第二层大快捷栏。
- 压缩标签栏高度和标签状态表达。
- 将模式切换移动到状态栏右侧。
- 精简状态栏常驻信息。
- 侧边栏改为扁平纯色结构。
- 统一分隔线、拖拽手柄和可点击区域。

重点文件：

```text
src/routes/+page.svelte
src/lib/components/Toolbar.svelte
src/lib/components/TabBar.svelte
src/lib/components/Sidebar.svelte
src/lib/components/StatusBar.svelte
```

约束：

- 不改变菜单命令、快捷键、标签 store、编辑模式 store 和文件操作行为。
- 只移动入口和调整展示，不删除功能。

验收：

- 顶部常驻区域显著缩短。
- 所有原有操作仍可通过菜单、快捷键或紧凑图标到达。
- 窗口宽度小于 `900px` 时不存在横向溢出。

### 阶段 3：文档画布统一

- 统一 WYSIWYM、源码和 Preview 的内容宽度、顶部留白和滚动容器。
- 落实正文、标题、链接、引用、代码、表格和图片规范。
- 移除默认标题底边框和重卡片效果。
- 统一文本选择色、焦点色和滚动条。
- 保持现有 CodeMirror State、Decoration 和 Widget 实现不变。

重点文件：

```text
src/app.css
src/lib/components/CodeMirrorEditor.svelte
src/lib/components/Preview.svelte
src/lib/editor/decorations/*.ts
src/lib/themes/*.css
```

约束：

- Decoration 文件仅允许调整 class 或样式挂载，不改扫描、范围和 transaction 逻辑。
- Preview 与编辑器必须消费同一套 `--doc-*` 令牌。

验收：

- 三种模式切换时正文左右位置稳定。
- 文档中的所有元素都能在亮色和暗色主题下正确显示。
- 超宽代码和表格只在自身区域横向滚动。

### 阶段 4：浮层和编辑辅助

- 统一菜单、右键菜单、Slash Menu、浮动工具栏、表格选择器和对话框视觉。
- 浮层使用相同的边框、圆角、阴影、间距和焦点状态。
- 悬浮工具栏减少常驻文字，使用图标和 tooltip。
- 错误提示改为低干扰内联样式。
- Settings 使用与主界面相同的令牌和密度。

重点文件：

```text
src/lib/components/FloatingToolbar.svelte
src/lib/components/SlashMenu.svelte
src/lib/components/TablePicker.svelte
src/lib/components/TableEditor.svelte
src/lib/components/Settings.svelte
src/lib/components/SearchReplace.svelte
```

验收：

- 所有浮层具有一致视觉语言。
- 鼠标悬停、键盘焦点、禁用和危险操作状态可明确区分。
- 不降低现有无障碍能力。

### 阶段 5：主题整理和视觉回归

- 新增 `typora` 文档主题并作为默认主题。
- 保留 `github`、`newsprint`、`night`，将它们限制在文档区域。
- 清理旧变量、重复 CSS 和失效选择器。
- 增加 Playwright 截图断言。
- 验证 DPI、窗口缩放、窄窗口和长文档。

建议主题结构：

```text
src/lib/themes/typora.css
src/lib/themes/github.css
src/lib/themes/newsprint.css
src/lib/themes/night.css
src/lib/themes/index.ts
```

验收：

- 文档主题切换不改变侧边栏、菜单和状态栏布局。
- UI 亮暗模式切换不破坏当前文档主题。
- 视觉回归截图通过或经过明确审核后更新。

## 9. 自动化测试

### 9.1 Playwright 行为回归

保留并继续通过现有全部 E2E，重点确认：

- 菜单、保存、打开、导出和设置入口仍可用。
- 标签新增、切换、关闭和未保存状态正常。
- 模式切换、分栏预览和侧边栏开关正常。
- Slash Menu、浮动工具栏、表格编辑和 Widget 源码入口正常。
- 键盘导航和焦点恢复未被 CSS 或 DOM 调整破坏。

### 9.2 Playwright 视觉回归

至少增加以下截图：

- 亮色空白文档。
- 亮色完整文档。
- 暗色完整文档。
- 侧边栏文件树与大纲。
- WYSIWYM、源码和预览。
- 代码、Mermaid、表格和图片错误态。
- 菜单、Slash Menu、浮动工具栏和设置对话框。
- `1366x768` 和 `1920x1080`。

对动态内容进行稳定化：

- 禁止光标闪烁。
- 禁止动画。
- 固定时间、文件名和测试数据。
- 等待字体和异步 Widget 完成后截图。

### 9.3 可访问性

- 文本与背景满足 WCAG AA。
- 所有图标按钮具有 `aria-label` 或可见 tooltip。
- 键盘焦点清晰，不依赖颜色变化之外的单一表达。
- `prefers-reduced-motion` 下关闭非必要动画。
- Windows 125%、150% 缩放下点击区域和文字不截断。

## 10. 完成标准

功能和构建：

```bash
pnpm check
pnpm test
pnpm test:e2e
pnpm build
cargo check --manifest-path src-tauri/Cargo.toml
python scripts/build.py --no-bundle
```

以上命令全部通过，并同时满足：

- `svelte-check` 为 `0 errors, 0 warnings`。
- 原有编辑、Widget、文件、标签和导出能力无回归。
- 顶部常驻操作区最多保留两层：紧凑顶栏和按需标签栏。
- 独立模式切换栏已移除，模式入口与状态栏整合。
- 应用外壳不再使用多层背景渐变。
- 应用主题与文档主题已分离。
- WYSIWYM、源码、Preview 的文档几何基本一致。
- 三种模式和亮暗主题均有视觉回归截图。
- Tauri 离线模式不依赖远程字体。
- `1366x768`、`1920x1080`、125% 和 150% DPI 下无截断和异常溢出。
- 不修改 `build/`、`target/`、`.svelte-kit/` 等生成目录。

## 11. 建议提交顺序

```text
style: add ui and document design tokens
style: simplify application chrome and mode controls
style: unify editor and preview typography
style: refine sidebar overlays and dialogs
test: add visual regression coverage
docs: record typora visual redesign results
```

每个提交都必须通过 `pnpm check` 和相关 Playwright 用例。不要将全部 CSS 改造压成一个无法审查的大提交。

## 12. 禁止事项

- 不重写 CodeMirror 编辑器。
- 不修改 WYSIWYM 语法扫描和 Decoration 范围算法。
- 不修改 Widget transaction、撤销重做和文档 store。
- 不引入 ProseMirror、TipTap 或新的文档模型。
- 不为了视觉统一删除现有功能。
- 不在组件中继续新增未经令牌管理的硬编码主题颜色。
- 不引入重型 UI 框架或新的图标框架，优先复用现有 SVG。
- 不用 `backdrop-filter` 和大面积模糊制造层级。

## 13. 参考依据

- Typora 官方主题系统允许通过 CSS 定义文档显示风格，Reader 应采用相似的“文档主题可替换”思路：
  <https://support.typora.io/Custom-Themes/>
- Typora 官方 Focus Mode 会弱化当前块之外的内容，Typewriter Mode 会维持光标的垂直位置；Reader 已有对应能力，本轮只统一视觉表达：
  <https://support.typora.io/Focus-and-Typewriter-Mode/>
- Typora 官方主题库展示了同一应用框架下多种文档主题共存的方式：
  <https://theme.typora.io/>

