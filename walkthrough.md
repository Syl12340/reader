# Reader Typora 视觉改造验收记录

更新时间：2026-10-04

## 2026-10-04：公式、图形与导出统一

本轮按渲染统一、公式/Mermaid 外观、导出治理、声明式数据图表落实。

- 公式扫描通过 Markdown block parser 排除代码，并修复未闭合围栏、多行行内代码和转义美元符的边界。
- 编辑 Widget、Preview、数学围栏及导出共用 `renderFormula`，统一 KaTeX 安全参数、缓存限额和源码降级。
- Mermaid 使用克制的亮暗色 `base` 主题，串行处理全局配置，缓存渲染并隔离复用 SVG 的 ID。
- 图形操作在悬停/聚焦时显示，支持原文、编辑、放大、拖动、窗口适配、Escape 与焦点恢复。
- 新增 `chart` JSON 围栏的本地 SVG 折线/柱状/散点渲染及 `/chart` 插入入口，没有增加依赖或脚本执行能力。
- Preview 图形通过 IntersectionObserver 延后到可视区附近渲染；编辑器不再因无关版本改变重建代码 Widget。
- 导出 HTML 模板迁移到独立模块，使用用户排版快照；HTML/PDF 静态图形不含复制等操作按钮。
- SVG 独立导出也嵌入图像；资源读取设置超时和流式大小限额；失败明确提示。
- 打印改为 A4、重复表头、标题避免孤页，并在浏览器及 WebView2 原生路径中局部缩放过长公式。
- 回归测试发现并修复模式切换直接 DOM focus 的问题，以及自动滚动误关 Slash Menu 的实际竞态。

验证：

- `corepack pnpm check`：0 errors / 0 warnings。
- `corepack pnpm test`：22 个测试文件，159 项通过。
- `corepack pnpm exec playwright test tests/e2e/figures.spec.ts tests/e2e/export.spec.ts tests/e2e/wysiwym.spec.ts --workers=2`：21 项通过。
- `cargo check --manifest-path src-tauri/Cargo.toml`：通过。
- `python scripts/build.py --no-frontend --no-bundle`：成功；Tauri 钩子执行前端构建 34.96 秒，Rust release 编译 1 分 32 秒；输出 `target/release/reader.exe`。
- 构建存在非阻断提示：既有空 `vendor-katex` chunk、Tauri API 及导出模块的静态/动态混合导入。没有新增运行所需依赖。

限制：本轮未运行全套视觉快照回归；浏览器 PDF 用例验证打印模板及调用，不等同于 Windows 原生 PDF 文件的逐页视觉验收。原生长文档与极长公式仍保留手工验收项。图表抽样可能遗漏峰值，数据表每组只展示前 1000 项，完整值保留在源码；DOCX 沿用已有降级策略。

详见 `rendering-guide.md`。没有关闭或覆盖当前运行的 `D:\Shaoyilei\Desktop\reader.exe`。

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

## 2026-09-30 稳定性收口

本轮补齐了搜索精确定位、另存为目标协调、Windows 原子覆盖写、恢复存储治理、菜单状态复位、新窗口文件载入和 PDF 页面就绪/临时文件提交。默认导出格式与 HTML CSS 开关已接入真实命令，源码模式保留 Markdown 语法高亮。

当前自动化结果：`pnpm check` 为 0 errors / 0 warnings，Vitest 为 60 passed，Rust 为 8 passed，Playwright 为 19 passed，前端与 Tauri release 构建成功。新可执行文件位于 `D:\Shaoyilei\Desktop\Workspace\code\reader\target\release\reader.exe`。上方较早的测试数量及 DOCX/EPUB 资源限制已被后续实现取代；仍需在 Windows 桌面进程中人工确认系统打印、另存为竞态和新窗口行为。

## 2026-10-01 至 10-02：Typora 页面与写作流程

本轮继续使用 CodeMirror 6 和 Markdown 文件格式，先修改代码，再集中执行回归和构建。没有提交或推送。

### 页面样式

- 侧栏贯穿工作区，标签栏置于文档区域内，移除重复文件名导航；空白页提供新建、打开文件/文件夹及快速打开入口。
- 扁平浅灰应用栏、白色正文、800px 居中版心；统一文档顶端留白，减少侧栏、标签、状态栏和滚动条的视觉重量。
- 文件树使用小型线性 SVG 图标及固定层级缩进；标签关闭按钮在悬停/聚焦/激活时显示，长标签支持定位到可见区域。
- Write 显示语义列表、引用和 Setext 标题；Source 使用主题自适应语法色，修正暗色链接低对比度。操作按钮只在悬停/聚焦时强调，保留键盘焦点指示。
- 聚焦模式按当前语义段落弱化其他内容，不再模糊文字；打字机模式默认仅输入时居中，可在设置中恢复随光标居中。

### 交互和稳定性

- 文档查找支持大小写、全字、正则和错误提示；Read 中跨格式文字精确高亮，语法/公式无法映射时采用块级提示，重新打开查找正确恢复结果。
- 表格单元格可直接编辑，Enter 确认、Tab 移动、Ctrl+Enter 增行、Escape 取消，支持多行 TSV 粘贴；原文修改进入一个 CodeMirror transaction 和撤销记录。完整表格编辑器继续可用。
- 图片粘贴/拖放绑定原标签和映射后的源码区间；原生模式保存到文档旁 assets，未保存文档先询问保存；浏览器使用 data URL，不调用 Tauri API。
- 标题提取与锚点规则统一到 Markdown parser，覆盖中文、重复标题、Setext、frontmatter 和代码排除；大纲读取当前阅读位置，公式占位保留源码行数。
- 本地文档链接和中文锚点留在 Reader 内，原生 HTTP/HTTPS/mailto 使用系统打开；增加前进/后退、快速打开、切换/关闭/重开标签的菜单与快捷键入口。
- 桌面工作区恢复目录、文件、布局、光标及两种滚动位置，内容重新读取磁盘；持久化不包含文档正文、EditorState 或浏览器授权句柄。关闭确认过程中保留元数据，取消后更新为实际剩余标签。
- 首次普通保存同样校验目标占用及覆盖；路径统一保留驱动器/UNC 根并处理点段。PDF 在渲染前记录目标基线，等待字体及图片，隐藏 WebView 不依赖无限等待动画帧，失败清理临时文件。

### 实际验收

| 项目 | 结果 |
| --- | --- |
| `pnpm check` | 0 errors / 0 warnings |
| `pnpm test` | 15 files / 77 passed |
| `pnpm test:e2e` | 25 passed，包括两张视觉快照 |
| `cargo check --manifest-path src-tauri/Cargo.toml` | 通过 |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | 8 passed |
| 完整 `cargo test --manifest-path src-tauri/Cargo.toml` | 库测试通过；主程序测试入口执行被 Windows 拒绝，os error 5 |
| `python scripts/build.py --no-bundle` | 前端及 Tauri release 构建成功 |
| `git diff --check` | 通过 |

浏览器回归覆盖：Read 精确搜索及重新打开、语义列表/引用、表格行内格式与公式、原位编辑/TSV/撤销、异步图片切换标签、中文锚点、快速打开/键盘标签/模式记忆，以及既有渲染异常、导出、滚动和 500KB 文档用例。工作区恢复与取消关闭使用单元测试模拟原生环境，不冒充桌面进程人工验证。

已检查亮色 Write 和暗色 Source 截图，按本轮设计更新 Windows Chromium 基线。`@lezer/highlight` 显式声明为现有版本 1.2.3，未升级其它依赖；冻结锁文件安装使用 npm 官方注册源并通过 pnpm 供应链策略检查。

### 生产文件

```text
D:\Shaoyilei\Desktop\Workspace\code\reader\target\release\reader.exe
Last write: 2026-10-01 23:59:48
Size: 13,494,784 bytes
SHA256: E43D94D3374DA52F29FEC843AD96A860CA38EB4903831CF35A1F0C3AD120A979
```

### 待验收与边界

- Windows 原生 PDF 的真实分页、字体和图片输出、系统外链、图片落盘与退出重启仍待实机验收；浏览器打印测试不能替代 WebView2 PrintToPdf 验收。
- 完整 Rust 测试的主程序入口仍无法执行；库测试和 release 编译成功，不代表该执行限制已解决。
- 快速打开仅检索已载入文件树、当前标签和最近文件。浏览器不自动恢复目录授权，关闭后重开不恢复旧撤销历史；目录/文档搜索的 Rust/JavaScript 正则仍存在差异。
- 路径点段规范化不等于文件系统真实路径 canonicalization，符号链接别名仍可能绕过前端目标协调；原生写入仍做基线冲突检查。
- 视觉快照覆盖 1366x768 Windows Chromium 的亮色 Write / 暗色 Source，未覆盖高 DPI 和全部主题组合。Vite 仍有空 vendor-katex chunk、静态/动态导入和 CJS API 提示，没有掩盖这些非阻断构建提示。

## 2026-10-02：侧栏、查找与焦点修补

### 实际修改

- 文件名筛选使用当前树的派生视图，不改写共享数据，保留目录层级；刷新文件树不清除筛选，匹配目录可独立折叠。侧栏打开文件统一走文档服务，丢弃慢读取的过期结果和错误，搜索跳转不再依赖固定延时。
- 快速打开增加加载状态、Escape 取消、请求版本保护和路径去重。成功打开后聚焦实际可见的文档区域，避免 Read 模式误聚焦隐藏的 CodeMirror。对话框统一焦点锁定和恢复，未保存关闭确认默认聚焦取消。
- 查找面板统一视觉令牌并适配窄窗口；编辑正文时不抢焦点、不强制移动选区。单次正则替换支持捕获组、上下文和零宽匹配，使用完整原文定位并校验待替换范围。
- 修正重复标题锚点与人工后缀碰撞；大纲按标题 ID 保存折叠，提供键盘侧栏切换。非活动 Setext 标题隐藏多余分隔行，进入编辑时显示源码。
- 文件树重命名输入框移出按钮，F2 自动聚焦并选中文件名，Escape 返回文件行且不打开文件；菜单约束在视口内，收敛重复入口和侧栏文字间距。
- Read 恢复普通列表标记，并从 Markdown token 生成禁用的只读任务框，支持嵌套及大小写标记，排除转义和代码，不修改 Markdown 原文。最后移除 Preview 旧负边距，将 checkbox 放入列表标记位置。

### 验证与暂停

用户要求暂停测试之前，已完成 `pnpm check`（0 errors / 0 warnings）、Vitest（16 files / 90 passed）以及完整 Playwright（37 passed）。浏览器覆盖筛选/刷新、慢读取取消、查找/替换和撤销、对话框焦点、Read 焦点、大纲折叠、Setext、重命名及只读任务列表。视觉场景增加 Read + 大纲（1366x768）和窄屏 Source + 查找（420x800），已查看截图。

最后的任务列表对齐样式在上述测试之后收尾，尚未重新验证；Read 截图基线也尚未按这次对齐修改更新。暂停时按用户“暂不测试”要求没有继续运行测试或编译，不声明最终验收完成；当时的 `target/release/reader.exe` 未包含本轮源码修改。之后用户授权的生产编译已包含这些修改，见下节最终构建记录。

后续恢复验收时，应先检查任务列表对齐及 Read 视觉基线，再执行检查、单测、完整浏览器回归和 release 构建。Windows 原生人工验收及完整 Rust 测试入口的系统执行限制仍按上一节记录保留；本轮未提交或推送。

## 2026-10-02：八项建议集中落实

本轮实现多选区格式切换、CodeMirror 标准 Markdown 换行、合法零位置恢复和最小源码更新映射，增加编辑/阅读块内滚动锚点及旧工作区兼容。共享正文统计保留链接文字，排除代码、公式、frontmatter 和图片，以 180ms 防抖避免输入时重复扫描。

统一异步确认和错误重试提示，外部修改弹窗提供首处变化附近的有限对照、保留当前、载入磁盘、另存副本，以及保存冲突时的显式覆盖。审阅期间文档变化或载入前磁盘再次变化会中止；载入当前草稿/覆盖外部版本前分别保存独立恢复点，写入校验审阅的磁盘基线。

单文档默认不显示标签栏，多文档减少重复文件名；侧栏大纲与浮动大纲互斥，统一中文状态和模式文案，提升底部字号。新增清爽、衬线、技术排版预设，写作/阅读共享字体、版心及标题比例，源码维持等宽字体；设置同步主题状态，字体调整不再回退为亮色。

快速打开增加可取消/刷新的工作区文件名索引、相对路径及最近使用排序。索引只遍历文件名，不读取正文；跳过隐藏、node_modules、target、build、dist 等目录，限制 10000 目录、50000 文档、100000 目录项、64 层及约 30 秒遍历预算。单次文件系统调用不能强制取消，但过期结果不会发布；权限或限额导致的不完整索引明确提示。

构建注入版本、北京时间显示的构建时间、Git 标识及未提交状态。关于窗口读取真实桌面程序路径和原生版本，可复制诊断信息；浏览器只显示浏览器环境。未提交构建不能只用提交 ID 区分，应结合构建时间及最终 exe 哈希。

按用户要求，没有执行类型检查、单元测试、浏览器测试或独立 Rust 检查。旧测试文案/控件定位已同步但未运行，视觉基线未更新；此前 90/37 的结果不适用于本轮代码。不将编译成功等同于行为验收。没有提交或推送。

### 最终生产编译

`python scripts/build.py --no-bundle` 最终退出码为 0，日志包含 `Finished release profile`、`Built application at` 及 `All done. Build succeeded.`。前端静态资源与 Rust 原生程序均已重新生成，最终原生编译耗时 35.77 秒。

首次编译因 Toolbar 导出代码中的字面 `<style>` 正则被 Svelte 预处理器误识别而失败，已改为分段构造正则。随后修正新弹窗的非交互 section/dialog 角色警告，并补上格式切换的语法节点边界识别；最终完整构建在这些源码修正后完成。Vite 仍提示空 vendor-katex chunk 和 Tauri API 同时静态/动态导入，这些非阻断提示未消除；没有运行 svelte-check，不能据此声称类型检查为零警告。

```text
D:\Shaoyilei\Desktop\Workspace\code\reader\target\release\reader.exe
Last write (Asia/Shanghai): 2026-10-02 02:42:12
Size: 13,523,968 bytes
SHA256: EE02649A0E8120E8B8DC0BD86413E61E0168D4E57F52B31AB3CF9C01A18E9C97
```

八项建议的代码已落盘，但多光标及嵌套格式、中文输入法、外部修改竞态、滚动锚点、索引限额、排版预设和原生 PDF 仍需后续验收。本轮仅编译并读取产物元数据，没有运行测试；未将这些未验证行为标记为通过。

按用户“成功与否都在结束后关机”的指示，收尾后安排隐藏进程等待约 60 秒执行 `shutdown.exe /s /t 0`，不使用强制关闭参数。已安排关机不等于已确认机器断电；未保存应用可能阻止非强制关机。

## 2026-10-02：编辑浮层与响应式修补

本节为后续新一轮源码变更；前述编译和关机属于上一轮。本轮不测试、不编译，也没有再次安排关机。

### 修复内容

- CodeMirror 原先使用未定义的 `--accent-rgb` 生成选区颜色，导致该颜色声明无效；现改用有效主题令牌，连同设置/搜索高亮修正，并为写作/源码编辑区提供可访问名称。
- 浮动栏复用粗体、斜体、删除线、代码、链接、标题及引用的共享命令。链接保留 URL 编辑选区；Alt+. 从编辑区进入工具栏，方向键/Home/End 导航，Escape 返回正文。失焦到其它控件时关闭浮层而不抢回焦点，新增格式命令不截获普通输入框的本地编辑快捷键。
- 斜杠菜单只在空块及列表/引用前缀内触发，不在路径、普通行内文本、代码、转义或多选区中弹出；输入法和其它对话框的按键不被捕获。多行模板保留列表/引用的续行缩进。
- 表格选择器不再打开即删除 `/`。原会话、源码区间及 CodeMirror 文档快照保留到确认；取消不修改正文，确认校验快照后用单次 transaction 替换，提供独立撤销。切换标签/模式时清理旧请求。
- 新增共享浮层定位 action，按照面板真实尺寸与可视视口边界夹紧位置，必要时上下翻转。工具栏、斜杠菜单和表格网格采用统一背景/边框，网格支持焦点锁定、键盘、取消及尺寸说明。
- 阅读定位不再尝试聚焦隐藏 CodeMirror；异步会话跳转按目标 ID 校验。滚动状态按帧合并，拖选或已有待处理滚动时不恢复旧锚点；阅读任务框保持只读，移除旧的点击改源码路径。复制失败通过共享提示反馈。
- 快速打开的模糊匹配不再因路径超过 100 字符而得到负分；全角、大小写及 Windows 分隔符统一匹配，标签去重避免逐路径扫描所有会话。打开失败释放忙状态，空结果/索引中状态分开显示，短窗口面板可滚动。浏览器重命名和删除后刷新索引。
- 分屏新增方向键比例调整、Enter/双击居中、指针/触屏操作和取消/失焦清理。窄窗口侧栏不挤压正文，状态栏保留关键状态与模式操作；暗色表单、触屏 Widget 操作和减少动画偏好得到一致处理。
- 对话框初始焦点只由最上层管理；下层卸载不抢焦点，关闭时尊重已主动聚焦的有效控件。提示宿主卸载取消当前及排队请求，避免幽灵确认和等待未结束。正文统计不再丢弃普通段落/引用中的字面 `[X]`。

### 验证状态

新增 `tests/unit/writing-ui.test.ts`，包含 10 个斜杠上下文、浮层边界、长路径匹配、任务统计、提示队列取消及嵌套焦点用例，尚未运行。没有执行 `pnpm check`、Vitest、Playwright、任何 Rust 检查或生产编译，也没有更新视觉快照。代码仅作源文件阅读与实现，不能声称通过验收。

下一轮仍需覆盖真实 CodeMirror 的浮动栏键盘/IME、表格取消及一次撤销、跨会话过期请求、阅读拖选与异步布局、窄屏侧栏/状态栏、触屏分隔条和 DPI 125%/150%。此前原生 PDF 与 Rust 主程序测试入口执行限制继续保留。`target/release/reader.exe` 仍是上一轮 02:42:12 的构建，不包含本节修改；未提交或推送。

## 2026-10-02：标签状态与菜单收敛

本轮继续源码修复和 UI 优化，不执行测试、类型检查或编译，也不安排关机。

### 状态与交互

原切换回调在设置切换保护前写回缓冲光标/滚动，此时 activeSessionId 已指向新标签，而视图仍承载旧标签。store 内容同步可能先把新标签正文写入旧视图，继而把错误状态缓存到旧标签。现在明确记录视图所属 ID，提前保护写回过程并过滤不匹配的内容同步；更新监听器使用所属 ID，卸载先解除订阅再保存缓存。

缓存 EditorState 原先包含组件私有 Compartment 和监听闭包。新增 `src/lib/editor/session-state.ts`，在恢复时重绑当前组件扩展，保留共享历史字段、正文及方向性选区。恢复标签也统一重新应用当前编辑设置，避免非活动标签维持旧换行/Tab/括号配置。初次挂载补齐状态栏光标及滚动恢复；文件路径改变时更新 Widget 资源上下文。

编辑器展示恢复增加视图、状态、会话和版本限制；编辑、滚轮、触摸或显式大纲/搜索跳转取消过期恢复。阅读区域在 DOM 替换及卸载前处理最后一帧滚动，使用事件采样的像素位置；节点已脱离 DOM 时，通过原锚点与滚动增量保留位置，不用无效矩形覆盖锚点。阅读恢复帧可取消，用户导航优先。

标签关闭按钮的键盘事件不再被父标签行抢先处理，增加 Shift+F10/菜单键、同名文件父目录提示及触屏关闭入口。右键操作先捕获会话/路径并关闭菜单，确认后校验目标仍存在且路径未变，避免打开其它文件或关闭后来显示的菜单。浏览器禁用不能继承目录文件授权的新窗口操作。

### 界面收敛

应用菜单改用统一面板、轻量阴影、30px 最小行高、稳定快捷键列和清晰的键盘聚焦背景。模式/主题以当前勾选表示，主题描述独立换行，分屏操作使用中文文案。菜单保留 menuitemradio/menuitemcheckbox 语义，处理 IME、Escape 和过期异步焦点；无文档操作禁用，欢迎页不再显示虚构文件名。

新增 `src/lib/utils/menu-position.ts`，按触发器真实矩形与可视视口定位，子菜单靠右时向左展开，面板支持受限高度滚动及缩放/窗口变化重定位；取消下拉位移动画，避免固定定位子菜单受到变换祖先影响。标签右键菜单沿用共享浮层定位。菜单模式切换完成后聚焦实际可见的正文区域。

### 未验证范围

新增 `tests/unit/session-state.test.ts` 的 4 个缓存/历史/扩展/光标用例，为菜单测试补写 6 个键盘、生命周期、角色及边界用例；为 `tests/e2e/ui-refinements.spec.ts` 补写 4 个真实编辑器回归。没有运行任何用例，也没有更新视觉快照，不能声称历史保留、菜单边界或阅读滚动已经验收通过。

后续仍需运行类型检查、新增与既有测试，检查标签状态/设置隔离、Widget 生命周期、最后一帧滚动、中文 IME、键盘菜单、窄窗口及 DPI/缩放，并人工审阅视觉基线。此前原生 PDF 和完整 Rust 测试执行限制仍未闭环。`target/release/reader.exe` 仍是 02:42:12 的旧构建，不包含最近两轮源码变更；本轮没有提交或推送。

## 2026-10-02：格式命令与编辑控件

本轮继续落盘修复与轻量 UI 优化，没有运行测试、检查或编译。

### 编辑命令

`src/lib/editor/commands.ts` 统一格式 transaction 构造和选区映射。粗斜体/删除线根据实际语法节点删除对应标记，不用指定星号拼写判断已格式化文本，覆盖下划线和整段嵌套格式；多光标共享同一节点时去重删除，保留主选区和反向选择。修改独立进入历史，未改变文档或选区时不派发空 transaction。

代码命令按每个选区分别处理行内与多行，不再由主选区决定全部光标的分隔符。反引号长度动态选取，code-span 边缘反引号/空格增加保护性填充，取消时移除规范化填充。闭合带语言围栏可取消并保留正文，未闭合围栏及缩进代码不作破坏性改写。快捷键及浮动栏采用相同命令。

链接命令在已有链接中选择原地址，保留文字、标题及尖括号；空地址进入输入位置，不生成外层新链接。新标签转义方括号与结尾反斜杠，并将换行归并为空格，避免破坏目标语法。引用链接没有本地 URL 时保留原文，不伪造嵌套链接。

多行标题/引用统一应用或取消，标题保留已有引用/列表前缀，跳过识别出的代码行。两行 Setext 标题可取消或转换到 ATX，不留下下划分隔线；多行 Setext 保留原文，不直接拆成多个标题。

### 控件与焦点

CodeMirror 选区通知携带当前格式状态，浮动栏显示选中格式、快捷键和分组线；代码中禁用不适用的格式，方向键和 Alt+. 跳过禁用项。引用与表格使用一致的细线 SVG，焦点边框与弱化状态使用现有主题令牌。

新增 `src/lib/services/editor-presentation.ts`，菜单及底部模式按钮共用切换入口，并校验延迟执行时的会话和模式。底部按钮支持方向键/Home/End，只有当前模式加入 Tab 顺序；方向键操作保留按钮焦点，确认后返回可见正文。正文聚焦 helper 在可见模态窗存在时不抢焦点，也不聚焦隐藏或 inert 区域。

### 未验证与限制

补写 21 个单测和 3 个 E2E 用例，但均未运行；没有执行 svelte-check、任何 Rust 检查或生产编译，视觉快照也未更新。此前通过结果不覆盖本轮修改。

格式取消当前以语法节点为单位：局部选区取消整个所处格式节点，不实现富文本式子串拆分。引用式链接的定义跳转/编辑、多行 Setext 转换、缩进代码和复杂列表/引用容器的代码转换仍需专门设计与验收，不能宣称覆盖所有 Markdown 边界。

后续需要检查新命令类型、嵌套格式、多光标、选区方向、反引号/空格、链接标题、两行 Setext、撤销分组及 IME；实测浮动栏状态、底部键盘模式切换、弹窗焦点和窄窗口布局。原生 PDF 及此前其它未闭环验收仍保留。`target/release/reader.exe` 仍未更新，本轮没有提交、推送或再次安排关机。

## 2026-10-02：快速打开与窗口生命周期

本轮继续落盘修复与 UI 优化，并按用户授权生产编译，不执行测试套件或其它检查。

### 交互与界面

快速打开的选择以稳定的会话/文件键维护，索引刷新改变排序时仍指向原文件；查询改变回到首项，文件移出前 60 项时安全回到首项。文件树展开、路径去重与最近文件排序元数据分离，输入查询不重复递归文件树。分页键按结果可视高度移动，异步 DOM 更新后才滚动选中行，IME 不触发导航。

面板简化为轻量搜索入口和文件图标，文件名、相对路径、未保存/已打开/最近使用状态分列；支持清除搜索并保留输入焦点，显示结果数及前 60 项截断提示。打开中以忙状态阻止重复操作，Escape 或修改查询仍可使旧请求失效。返回文档焦点前复核会话、组件和关闭请求，避免关闭后的异步焦点抢占新标签或重新打开的面板。

新增 `src/lib/utils/window-creation.ts` 处理窗口创建事件，成功、失败、注册错误和超时统一清理计时器及监听；迟到注册立即解绑，过期事件不产生第二次失败通知。新窗口流程使用应用内提示，浏览器不再打开没有文件授权的新标签。超时只结束等待，不销毁可能已创建的窗口，提示用户先确认是否已有窗口，避免盲目重试造成重复窗口。

读取本地 Tauri ACL 后发现 `core:default` 未包含窗口创建权限，补充 `core:webview:allow-create-webview-window`，只应用于已有 main/reader-* 本地窗口，未添加远程来源或其它 API 权限。构建报告的两个分屏条无障碍警告通过原生 range 输入修正，补充比例读屏说明、上下方向键和拖动后焦点，保留视觉上的细分隔线。

### 验证记录

新增 7 个窗口生命周期单测和 2 个快速打开 E2E，用例均未运行。首轮 `python scripts/build.py --no-bundle` 成功，随后修正分屏警告及原生权限，最终 `python scripts/build.py --no-frontend --no-bundle` 返回 0、输出 `All done. Build succeeded.`；Tauri beforeBuildCommand 完整执行 pnpm build，该参数只避免脚本再重复打包一次前端。最终前端构建没有输出 Svelte 无障碍警告，Rust release 编译成功，耗时 1m 08s。保留 KaTeX 空分块及 Tauri API 静态/动态混合导入的非阻断提示。

最终产物 `D:/Shaoyilei/Desktop/Workspace/code/reader/target/release/reader.exe`：北京时间 2026-10-02 21:01:32，13,535,744 bytes，SHA256 `E4A6218799A9E34ED5D95885A2483188587C1801EE9044F40E2A25BEA581E300`。读取构建生成的 capability 确认新增窗口创建权限已纳入，local=true，窗口范围仍为 main/reader-*。本次产物包含前面三轮未编译源码及本轮修正；旧产物时间不再代表当前版本。

没有执行 pnpm check、Vitest、Playwright、cargo check/test 或更新视觉基线，不将构建成功等同于类型、行为、浏览器或原生验收通过。此前未闭环的 Markdown 边界、原生 PDF、高 DPI 和 Rust 主程序测试入口限制继续保留。没有提交、推送或安排关机。

## 2026-10-03：命令面板与目录搜索

### 实现

命令面板原先在方向键导航时直接聚焦候选按钮，导致继续打字无法筛选。现在保持 combobox 输入焦点，通过 aria-activedescendant 表示选择，复用共享弹窗焦点管理；候选 ID、当前会话、可用性和生命周期均在延迟执行前复核。面板采用与快速打开相近的轻量布局，显示真实快捷键、结果数和清晰的键盘提示，错误通过应用内通知反馈。

目录搜索原先由 oninput/onchange 与响应式 effect 重复触发，且 trim 会改变空白关键词，扩展名提取会把路径通配符静默降级。现在只保留响应式防抖，中文组合输入结束后才搜索；同一组件内每次扫描等待上次完成，再跳过已过期的排队请求。搜索条件变化立即使旧结果和审阅失效，清空过期的截断标记和状态。原始关键词用于搜索和替换，扩展名格式校验失败时不发目录请求，留空和 * 明确表示后端常见文本类型。

批量替换在读取、预览、审阅及逐次保存前检查条件版本，切换目录或卸载后停止处理后续文件；已保存部分给出恢复中心提示，单个已经开始的写入不会被回滚。当前文档替换继续通过 CodeMirror transaction 应用，并报告无变化结果。目录结果增加相对路径、默认展开前五组、折叠状态和行上下文，输入改为 UI 字体并提高字号，结果行更易读，范围说明收于可展开提示。

Rust 的 search_content 通过 spawn_blocking 执行原有同步扫描，保持请求参数和返回类型；前端不再等待主线程同步扫描。搜索仍只读取磁盘，仍有 5000 项扫描和 1000 条展示上限，未保存内容不包含在目录结果中。正在执行的原生扫描不会被硬取消；组件取消仅丢弃结果，下一条有效请求等待它结束。

### 构建与待验收

生产构建 `python scripts/build.py --no-frontend --no-bundle` 返回 0，输出 `All done. Build succeeded.`。Tauri beforeBuildCommand 执行完整 pnpm build，前端耗时 27.68s，Rust release 耗时 40.73s。没有 Svelte 编译警告，仍有 KaTeX 空分块及 Tauri API 静态/动态混合导入的非阻断提示。

最新产物 `D:/Shaoyilei/Desktop/Workspace/code/reader/target/release/reader.exe`：北京时间 2026-10-03 14:33:25，13,594,624 bytes，SHA256 `19506E6289982E6AD201857F6E96AE933132162A65C12AAC85BA3261EF646701`，包含本轮全部源码。

没有运行 pnpm check、Vitest、Playwright 或 cargo check/test，也没有更新视觉基线。命令面板键盘/焦点、原生目录搜索与批量替换、高 DPI 仍需后续行为验收；此前 PDF、编辑命令及其它未闭环项目继续保留。没有提交、推送或安排关机。

## 2026-10-05：Typora 风格与编辑、导出连续性

### 本轮实现

延续现有平面化侧栏和文档优先布局，进一步减轻界面底色及常驻状态信息。状态栏统计按需展开，标签提供拖动/键盘排序和溢出列表，大纲支持筛选及定位当前章节。标签排序不重建会话，编辑历史和定位继续由各自会话维护。

编辑器在鼠标拖选和 IME 组合输入期间暂缓装饰显隐，仅映射已有范围，结束后刷新，避免选择过程发生 DOM 替换。浮动格式栏支持自动、手动和关闭；Alt+. 调出手动格式栏，Alt+Enter 或资源右键打开属性。延迟操作复核编辑器生命周期和会话，失效后不抢占焦点。显示缩放和文档字体分离，编辑/阅读共用版心设置，导出仍使用未缩放的文档字号。焦点/打字机偏好接入持久化设置。

共享命令注册增加 enabled/checked/不可用说明，菜单、模式按钮和命令面板使用相同入口；命令面板保留输入焦点、跳过禁用项并显示原因。新增 F8/F9 和 Ctrl+=/-/0 默认快捷键，用户自定义绑定仍优先。

图片目录支持相对嵌套路径并拒绝越级和绝对目录。图片/内联链接属性对目标及描述进行源码范围替换，保留可选 title，拒绝危险协议；提交前复核源片段，使用 CodeMirror transaction，因此支持撤销。图片 Widget 增加属性按钮和加载后的重新测量，不直接修改 document store。

导出任务先选择目标，随后使用已捕获的文档、资源路径、主题和偏好快照；阶段包括选择位置、渲染、资源和写入。准备阶段可取消，资源请求响应 AbortSignal，取消不会进入写入；已经开始的写入不可取消。共享渲染/字体任务可能在后台继续完成，但失效结果不能提交。导出目标不能覆盖当前窗口中已打开的源文件，成功后可打开或定位，当前窗口按文档记住上次成功配置，再次导出仍询问目标。

新增报告/普通文档预设、A4/Letter、页边距和 HTML 目录，使用文档字体而非界面缩放。Windows 原生 PrintToPdf 显式设置纸张，页边距由 CSS 控制，避免与原生边距叠加。浏览器 PDF 保留打印降级，提示用户在打印对话框中保存，不能把调起对话框当作文件已经保存。

### 验证

- `pnpm check`：最终代码 0 errors、0 warnings。
- `pnpm test`：23 个测试文件、168 tests passed，包含本轮新增的 9 个单测。
- `cargo check --manifest-path src-tauri/Cargo.toml`：通过。
- `pnpm exec playwright test tests/e2e/continuous-writing.spec.ts tests/e2e/wysiwym.spec.ts tests/e2e/typora-workflows.spec.ts tests/e2e/figures.spec.ts tests/e2e/export.spec.ts tests/e2e/ui-refinements.spec.ts --workers=2`：54 passed，包含本轮新增的 8 个连续编辑用例。
- 最后修正 PDF 提示并增加断言后，`pnpm exec playwright test tests/e2e/export.spec.ts --workers=2`：5 passed；这是上述 54 项中的重复回归，不累加为 59 项独立测试。
- Playwright 启动前完整生产前端构建成功；`git diff --check` 返回 0。没有运行视觉快照或修改本轮视觉基线。

### 尚未闭环

真实 Windows 中文输入法、原生 PDF 页面/字体/边距，以及深色、窄窗口和高 DPI 仍需原生/视觉验收。组合输入事件与浏览器拖选测试通过不代表真实输入法完全验收。PDF 书签、页码、完整导出预览，最近工作区/跨重启固定文件和表格边缘/上下文行列操作尚未实现，不将长期方案标记为 100% 完成。

资源属性暂覆盖内联链接和图片，不编辑引用式链接定义，也不批量移动/删除图片文件；上次导出偏好仅为窗口内记录，未跨重启保存；自定义字体仍依赖接收机器，没有嵌入字体文件。原有表格原位编辑、Tab 导航及 TSV 粘贴未重复重写。

### 桌面构建

最终 `python scripts/build.py --no-frontend --no-bundle` 返回 0，输出 `All done. Build succeeded.`。该参数仅避免脚本重复构建前端，Tauri beforeBuildCommand 仍执行完整 pnpm build（25.14s）；Rust release 耗时 36.58s。没有 Svelte 编译警告，保留 KaTeX 空分块及静态/动态混合导入的非阻断提示。

产物 `D:/Shaoyilei/Desktop/Workspace/code/reader/target/release/reader.exe`：北京时间 2026-10-05 01:02:40，13,547,008 bytes，SHA256 `45CAEA53C23A6ED457C8B8347491A547FCC6F5F43FFAB7479F589851F13E1C1A`，包含最后 PDF 提示修正。构建成功不替代上述原生及视觉待验收项。

没有提交、推送、覆盖正在运行的桌面副本或安排关机。

## 2026-10-05：导出专项补完

### 实现与入口

新增文件菜单 / 命令面板“导出预览与设置”。它捕获当时的文档内容、路径与排版配置，先渲染并嵌入资源；选项改变只重建导出样式，确认时复用这份资源快照，后续编辑或标签变化不改变输出正文。预览明确采用浅色、连续排版，不冒充最终分页。页面通过带 CSP 的隔离 iframe 展示，脚本、链接导航和外部资源加载被禁用；具备加载状态、重试、资源警告、取消以及框内 Escape 处理，关闭后焦点返回文件菜单。

新增纸张方向、页码、一级标题另起页和实验性 PDF 标题书签，预览及设置页共享参数。保存默认设置包含所选 HTML / PDF 格式，但不会改动文档字号或显示缩放。打印不再将 24px 等字号强制压到 18px；纸张可打印尺寸同时用于公式测量和图像/图表高度限制，原生测量启用 print media。

默认原生导出继续使用 PrintToPdf。勾选书签时采用 WebView2 DevTools `Page.printToPDF`，请求 tagged PDF 与 document outline；失败清理临时文件，不静默改为无书签版本或覆盖目标。页码通过 CSS 页边距计数器生成，原生扩展选项检查 WebView2 至少 131。相关接口依据 [WebView2 文档](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2) 和 [Chromium 打印页边距文档](https://developer.chrome.com/blog/print-margins?hl=en)；实验性书签也已在本机实际验证。

已保存文档的上次成功导出配置现在跨窗口/重启保存，按规范化路径索引，最多 50 项，JSON 字符串长度上限 180,000。记录只含路径、格式、导出选项和排版选项，不含正文、UI 私有偏好或输出目标，重复导出仍询问保存位置；未命名文档只在内存保留，文件重命名不会迁移记录。浏览器 PDF 仍为打印降级，由于无法知道最终是否保存，不记入成功导出历史。

### 验证与修正

新增 `export-options.test.ts` 的 7 项单测和 `export-preview.spec.ts` 的 4 项 E2E。首轮发现选择控件名称包含其选项文字、预览关闭焦点无稳定恢复，以及测试的浮点/全局 document 命名问题，均已修正并重跑，不将失败首轮算作通过。

最终 `pnpm check`：0 errors、0 warnings；`pnpm test`：24 文件、175 passed；`cargo check --manifest-path src-tauri/Cargo.toml`：通过。定向命令 `pnpm exec playwright test tests/e2e/export-preview.spec.ts tests/e2e/export.spec.ts tests/e2e/continuous-writing.spec.ts tests/e2e/figures.spec.ts --workers=2`：21 passed。没有跑整个 E2E 或视觉基线套件，不叠加重复回归次数。

为原生验收增加 `src-tauri/examples/pdf-export-smoke.rs`，直接复用生产 PDF 与原子写入模块，以独立的 `com.reader.pdf-smoke` 标识运行隐藏窗口，不读取 Reader 会话或新增生产 IPC。测试入口最初在 main 前返回 0xC0000139，定位为缺少主程序的 Common Controls v6 manifest；build.rs 只为 Cargo examples 添加该 manifest，生产链接权限不变，没有改动系统 DLL 或安全设置。

本机实际执行三次原生导出：A4 标准、A4 书签、Letter 横向，全部返回 0。PyMuPDF 文件断言确认 A4 两版均为 3 页且页脚正确，书签版有 3 个标题、分别指向第 1/2/3 页，标准版没有额外书签；Letter 横向为 792×612pt、15mm 页边距参数，样例为 2 页。中文、公式、表格内容存在，没有“复制”文本。Poppler 渲染并逐页查看原生书签的 3 页和横向的 2 页，未发现乱码、裁切、重叠或按钮残留。所有样例和图像均为 test-results 中的测试中间物，不改动用户文档。

### 已知边界

应用内预览尚不提供精确 PDF 页数、逐页缩略图或最终分页；复杂长表格/超长公式、更多字体与多版本运行时，以及窄窗/高 DPI 仍需更广验收。书签为可选实验性功能，旧引擎会明确失败；浏览器打印不自动生成书签。自定义系统字体没有主动嵌入，不保证换机后 HTML 字体一致。固定文件、最近工作区和其它非导出计划本轮没有修改。

### 最终构建

`python scripts/build.py --no-frontend --no-bundle` 返回 0，输出 `All done. Build succeeded.`。Tauri beforeBuildCommand 完整执行前端构建（44.22s），Rust release 耗时 1m 08s，没有 Svelte 编译警告；保留 KaTeX 空分块及 API 静态/动态混合导入的非阻断提示。

最新产物 `D:/Shaoyilei/Desktop/Workspace/code/reader/target/release/reader.exe`：北京时间 2026-10-05 15:02:38，13,570,560 bytes，SHA256 `5396AF20D9E5E05AA6175658EFC6710C0EB813D32C44CD778D5C0334AB0A6F92`。包含本轮全部导出源码；测试入口是独立 Cargo example，不在生产版本新增 IPC。

没有提交、推送、覆盖运行中的桌面副本或安排关机。
