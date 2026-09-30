# Reader 第二阶段 Gemini 交接计划

更新时间：2026-06-12

## 1. 当前状态

第二阶段主要功能代码已经落地，但尚不能标记为全部完成。最后一次明确通过的当前代码检查是：

```text
svelte-check found 0 errors and 0 warnings
```

完整 Vitest 在启动时被中断；模块拆分和新增测试后的 Playwright、前端构建、Rust 检查及整合构建尚未重新执行。

## 2. 已完成实现

### 编辑器模式与状态

- 新增 `EditorMode = 'wysiwym' | 'source' | 'preview'`。
- 默认模式为 `wysiwym`。
- 源码模式关闭 WYSIWYM 装饰并显示行号。
- 预览模式保留 CodeMirror 实例，通过隐藏编辑区展示现有 Preview。
- 使用 CodeMirror `Compartment` 重配置，不主动重建当前 `EditorState`。
- 标签切换保存 `EditorState`、光标偏移和滚动位置。
- Preview 已改为读取活动 `DocumentSession` 内容，避免旧 `fileContent` store 导致预览滞后。

### 装饰架构

装饰入口：

```text
src/lib/utils/markdown-decorations.ts
```

职责模块：

```text
src/lib/editor/decorations/common.ts
src/lib/editor/decorations/marker.ts
src/lib/editor/decorations/image.ts
src/lib/editor/decorations/math.ts
src/lib/editor/decorations/task.ts
src/lib/editor/decorations/code.ts
src/lib/editor/decorations/table.ts
```

- 块级装饰已从 `ViewPlugin` 改为 `StateField` 提供，修复 CodeMirror 的
  `Block decorations may not be specified via plugins` 崩溃。
- `ViewPlugin` 只负责同步视口范围。
- 装饰统一使用 `Decoration.set(..., true)` 排序。
- 扫描器按视口加 10,000 字符边界扫描，并按 `Text` 文档对象缓存。

### Widget

- 图片：块级/行内判定、本地路径解析、错误路径展示、点击或键盘进入源码。
- 公式：KaTeX、`trust: false`、错误提示、源码入口。
- 任务框：支持 `[ ]`、`[x]`、`[X]` 和嵌套列表，通过 transaction 修改原文。
- 代码块：语言标签、Shiki 按语言动态加载、复制和源码入口。
- Mermaid：异步渲染、DOM 生命周期检查、错误摘要和源码入口。
- 表格：GFM 可视化 Widget，点击打开 `TableEditor`，单 transaction 替换。

### 编辑辅助与无障碍

- Slash Menu 使用 `coordsAtPos()` 定位，支持方向键、Enter、Escape。
- 浮动工具栏根据真实选区坐标定位，已加入表格入口。
- 表格选择器支持鼠标、方向键、Enter、Space、Escape。
- 设置和表格对话框包含焦点锁定、Escape 关闭、焦点恢复。
- 浏览器模式不再注册 Tauri 窗口关闭监听。
- 当前 `svelte-check` 为 0 errors、0 warnings。

## 3. 测试现状

现有测试：

```text
tests/unit/markdown-scanner.test.ts
tests/unit/markdown-image.test.ts
tests/e2e/wysiwym.spec.ts
tests/fixtures/wysiwym.md
```

已知历史结果：

- 早期扫描器单测 4/4 通过，但之后新增了图片和 500KB 测试，必须重跑。
- 修复块级装饰后，早期 Playwright 3 条中 2 条通过，剩余 1 条只是按钮选择器不够精确。
- 该选择器已修复，并新增到 9 条左右的 E2E 场景，但尚未完整重跑。

## 4. Gemini 首要任务

### 第一步：运行检查并只修真实失败

```bash
pnpm check
pnpm test
pnpm test:e2e
```

不要先扩展功能。逐项修复类型、测试时序、选择器和真实运行时错误。

### 第二步：重点审查以下风险

1. 视口扫描边界

当前扫描只取可视范围前后 10,000 字符。超长 fenced block、`$$` 公式或表格如果跨越扫描边界，可能无法识别。建议将扫描窗口扩展到可靠的块边界，或对受影响语法使用语法树/增量索引。

2. 异步 Widget 版本检查

代码和 Mermaid 当前检查 `container.isConnected`，但还应确认文档版本变化后旧异步结果不会写入仍连接但已过期的 DOM。可为 Widget 注入版本读取函数或取消令牌。

3. 500KB E2E

`keyboard.insertText()` 写入 500KB 可能导致测试本身超时。可通过应用暴露的测试辅助接口或单个 CodeMirror transaction 注入大文档，但不要绕过真实输入、滚动和模式切换的最终断言。

4. 标签状态

编辑模式 store 当前是全局的。需要根据产品预期确认“标签切换恢复编辑模式”是全局模式保持，还是每个 `DocumentSession` 单独保存模式。

5. 预览隐藏布局

预览模式通过 `visibility: hidden` 保留编辑器尺寸。请在 Playwright 中断言光标、撤销历史和滚动位置切回后不丢失。

### 第三步：补齐 E2E 验收

至少确保以下场景通过：

- 标记显隐及跨节点选择。
- 块级和行内图片。
- 公式、任务框、普通代码块、Mermaid、表格。
- checkbox 修改、撤销、重做。
- Slash Menu 和表格选择器键盘操作。
- 表格编辑确认与取消。
- 模式切换和标签切换。
- 浏览器模式无 Tauri API 错误。
- 图片、公式、Mermaid 错误后仍能进入源码。
- 500KB 文档可输入、滚动、切换标签和模式。

### 第四步：完整构建

```bash
pnpm build
cargo check --manifest-path src-tauri/Cargo.toml
python scripts/build.py --no-bundle
```

注意：拆分前这些命令曾通过，但不能作为当前代码的最终结果。

## 5. 完成标准

只有以下全部满足后才可将第二阶段标记完成：

- `pnpm check` 为 0 errors、0 warnings。
- Vitest 全部通过。
- Playwright 全部通过。
- 前端、Rust 和整合构建全部通过。
- 500KB 场景通过。
- 渲染错误不会白屏或阻止进入源码。
- 不修改 `build/`、`target/`、`.svelte-kit/`。
- 根目录 `task.md` 更新为完成。
- 根目录创建 `walkthrough.md`，记录实际命令、结果、限制和可执行文件位置。
