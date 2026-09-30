<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { theme, setThemePreset } from '$lib/stores/theme';
  import { isDirty, currentFile, fileName, fileContent, createSession } from '$lib/stores/document';
  import { editorMode, typewriterMode, focusMode, setEditorMode } from '$lib/stores/ui';
  import { exportAsHTML } from '$lib/utils/native-fs';
  import { isTauri } from '$lib/utils/platform';
  import { THEME_PRESETS, type ThemePreset } from '$lib/themes';
  import { exportAsDocx, exportAsEpub, exportAsLatex, exportAsMarkdownVariant, exportAsImage } from '$lib/utils/export-formats';
  import { activeSessionId } from '$lib/stores/document';
  import { DocumentService } from '$lib/services/document';
  import { WorkspaceService } from '$lib/services/workspace';
  import { CommandService } from '$lib/services/command';
  import { prepareExportDocument } from '$lib/services/export-document';
  import { shortcutBindings } from '$lib/services/shortcut';
  import { menuNavigation } from '$lib/utils/menu-navigation';

  const shortcut = (id: string) => $shortcutBindings.find(item => item.id === id)?.key ?? '';
  function runMenuCommand(id: string) {
    closeAllMenus();
    void CommandService.execute(id);
  }

  let { showSidebar, showPreview, recentFiles = [], autoSaveEnabled = false, onToggleSidebar, onTogglePreview, onToggleTheme, onToggleAutoSave, onOpenSettings }: {
    showSidebar: boolean;
    showPreview: boolean;
    recentFiles?: string[];
    autoSaveEnabled?: boolean;
    onToggleSidebar: () => void;
    onTogglePreview: () => void;
    onToggleTheme: () => void;
    onToggleAutoSave: () => void;
    onOpenSettings?: () => void;
  } = $props();

  const useNativeTitlebar = true;
  let showFileMenu = $state(false);
  let showEditMenu = $state(false);
  let showViewMenu = $state(false);
  let showHelpMenu = $state(false);
  let showThemeSubmenu = $state(false);
  let showExportSubmenu = $state(false);
  let showAboutDialog = $state(false);
  let menuHoverEnabled = $state(false);
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  type TauriWindowControls = {
    minimize: () => Promise<void>;
    toggleMaximize: () => Promise<void>;
    close: () => Promise<void>;
  };

  let appWindow: TauriWindowControls | null = $state(null);
  let showWindowControls = $state(false);

  // clickOutside action：点击菜单外部时关闭菜单
  function clickOutside(node: HTMLElement, callback: () => void) {
    const handleClick = (event: MouseEvent) => {
      if (!node.contains(event.target as Node)) callback();
    };
    document.addEventListener('click', handleClick, true);
    return {
      destroy() { document.removeEventListener('click', handleClick, true); }
    };
  }

  // 延迟关闭菜单（给鼠标移动到下拉区域留出时间）
  function scheduleClose() {
    if (document.activeElement?.closest('.menu-group')) return;
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      showFileMenu = false;
      showEditMenu = false;
      showViewMenu = false;
      showHelpMenu = false;
      showThemeSubmenu = false;
      showExportSubmenu = false;
      menuHoverEnabled = false;
    }, 150);
  }

  function cancelClose() {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
  }

  // 悬浮打开菜单
  function openMenu(menu: 'file' | 'edit' | 'view' | 'help') {
    cancelClose();
    showFileMenu = menu === 'file';
    showEditMenu = menu === 'edit';
    showViewMenu = menu === 'view';
    showHelpMenu = menu === 'help';
    showExportSubmenu = false;
    showThemeSubmenu = false;
    menuHoverEnabled = true;
  }

  function closeAllMenus() {
    cancelClose();
    showFileMenu = false;
    showEditMenu = false;
    showViewMenu = false;
    showHelpMenu = false;
    showThemeSubmenu = false;
    showExportSubmenu = false;
    menuHoverEnabled = false;
  }

  function handleMenuHover(menu: 'file' | 'edit' | 'view' | 'help') {
    if (menuHoverEnabled) {
      openMenu(menu);
    }
  }

  async function getAppWindow(): Promise<TauriWindowControls | null> {
    if (!isTauri() || useNativeTitlebar) return null;
    if (appWindow) return appWindow;

    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      appWindow = getCurrentWindow();
      showWindowControls = true;
      return appWindow;
    } catch (error) {
      console.error('Failed to initialize Tauri window controls:', error);
      return null;
    }
  }

  onMount(() => {
    if (isTauri() && !useNativeTitlebar) {
      showWindowControls = true;
      void getAppWindow();
    }
    const unregister = CommandService.register('printDocument', printDocument);
    return () => { cancelClose(); unregister(); };
  });

  // 新建文件
  function newFile() {
    void CommandService.execute('newFile');
  }

  function escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function sanitizeStaticExportHtml(html: string): string {
    if (typeof DOMParser === 'undefined') {
      return html
        .replace(/<button\b[^>]*class=(["'])[^"']*\bcopy-button\b[^"']*\1[^>]*>.*?<\/button>/gis, '')
        .replace(/<script\b[^>]*>.*?<\/script>/gis, '')
        .replace(/\s+on[a-z]+\s*=\s*(["']).*?\1/gi, '')
        .replace(/\s+on[a-z]+\s*=\s*[^\s>]+/gi, '');
    }

    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
    doc.querySelectorAll('button, .copy-button, [data-export-hidden], script').forEach((node) => {
      node.remove();
    });
    doc.querySelectorAll<HTMLElement>('*').forEach((node) => {
      for (const attr of Array.from(node.attributes)) {
        if (/^on/i.test(attr.name)) {
          node.removeAttribute(attr.name);
        }
      }
    });
    return doc.body.innerHTML;
  }

  function buildExportHtml(title: string, bodyHtml: string, mode: 'light' | 'dark', embeddedCss = '') {
    const safeTitle = escapeHtml(title || 'untitled');
    const safeBodyHtml = sanitizeStaticExportHtml(bodyHtml);
    const styleOpen = '<' + 'style>';
    const styleClose = '<' + '/style>';
    return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="${mode}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle}</title>
  ${styleOpen}
    ${embeddedCss}
    :root {
      --font-ui: 'Space Grotesk', 'Noto Sans', sans-serif;
      --font-content: 'Source Serif 4', 'Noto Serif SC', serif;
      --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
      --bg-primary: #f8f6f1;
      --bg-secondary: #f1eee7;
      --bg-tertiary: #e6e2da;
      --text-primary: #22211f;
      --text-secondary: #6a665f;
      --text-tertiary: #9a948a;
      --border-color: #e0dbd1;
      --accent-color: #3a6ff7;
      --code-bg: #f3efe7;
      --code-text: #b84c6b;
      --link-color: #2f65e8;
      --blockquote-border: #c7b79c;
      --blockquote-bg: #f5f1e8;
    }

    [data-theme="dark"] {
      --bg-primary: #1e1c1a;
      --bg-secondary: #262421;
      --bg-tertiary: #2f2c28;
      --text-primary: #f2efe8;
      --text-secondary: #b1aaa0;
      --text-tertiary: #7d756b;
      --border-color: #3a3530;
      --accent-color: #7aa2ff;
      --code-bg: #2a2723;
      --code-text: #f19fb5;
      --link-color: #8db0ff;
      --blockquote-border: #5d5241;
      --blockquote-bg: #26231f;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      padding: 32px 24px 64px;
      background: var(--bg-primary);
      color: var(--text-primary);
      font-family: var(--font-content);
      line-height: 1.85;
    }

    .markdown-body {
      max-width: 860px;
      margin: 0 auto;
      font-size: 16.5px;
      letter-spacing: 0.01em;
    }

    .markdown-body h1,
    .markdown-body h2,
    .markdown-body h3,
    .markdown-body h4,
    .markdown-body h5,
    .markdown-body h6 {
      margin-top: 24px;
      margin-bottom: 16px;
      font-weight: 600;
      line-height: 1.25;
    }

    .markdown-body h1 {
      font-size: 2em;
      border-bottom: 1px solid var(--border-color);
      padding-bottom: 0.3em;
    }

    .markdown-body h2 {
      font-size: 1.5em;
      border-bottom: 1px solid var(--border-color);
      padding-bottom: 0.3em;
    }

    .markdown-body h3 { font-size: 1.25em; }

    .markdown-body p { margin-bottom: 16px; }

    .markdown-body a { color: var(--link-color); text-decoration: none; }
    .markdown-body a:hover { text-decoration: underline; }

    .markdown-body strong { font-weight: 600; }
    .markdown-body em { font-style: italic; }

    .markdown-body code {
      background: var(--code-bg);
      color: var(--code-text);
      padding: 0.2em 0.4em;
      border-radius: 3px;
      font-family: var(--font-mono);
      font-size: 0.9em;
    }

    .markdown-body pre {
      background: var(--code-bg);
      border-radius: 6px;
      padding: 16px;
      overflow-x: auto;
      margin-bottom: 16px;
    }

    .markdown-body pre code {
      background: transparent;
      color: inherit;
      padding: 0;
      font-size: 0.9em;
      line-height: 1.5;
    }

    .markdown-body blockquote {
      border-left: 4px solid var(--blockquote-border);
      background: var(--blockquote-bg);
      padding: 16px;
      margin: 0 0 16px 0;
      border-radius: 0 6px 6px 0;
    }

    .markdown-body blockquote p { margin-bottom: 0; }

    .markdown-body ul,
    .markdown-body ol {
      padding-left: 2em;
      margin-bottom: 16px;
    }

    .markdown-body li { margin-bottom: 0.25em; }

    .markdown-body img {
      max-width: 100%;
      height: auto;
      border-radius: 6px;
    }

    .markdown-body table {
      border-collapse: collapse;
      width: 100%;
      margin-bottom: 16px;
    }

    .markdown-body th,
    .markdown-body td {
      border: 1px solid var(--border-color);
      padding: 8px 12px;
      text-align: left;
    }

    .markdown-body th {
      background: var(--bg-secondary);
      font-weight: 600;
    }

    .markdown-body tr:nth-child(even) {
      background: var(--bg-secondary);
    }

    .markdown-body hr {
      border: none;
      border-top: 1px solid var(--border-color);
      margin: 24px 0;
    }

    .katex-display {
      overflow-x: auto;
      overflow-y: hidden;
      padding: 16px 0;
    }

    .katex { font-size: 1.1em; }

    .code-block {
      margin: 1.1em 0;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .code-header {
      display: block;
      font-size: 12px;
      color: var(--text-tertiary);
      padding: 0 0 6px;
    }

    .code-language {
      font-family: var(--font-mono);
      letter-spacing: 0.02em;
    }

    .code-block-pre {
      margin-top: 0;
      margin-bottom: 0;
    }

    .markdown-body button,
    .markdown-body .copy-button,
    .markdown-body [data-export-hidden] {
      display: none !important;
    }

    @media print {
      @page {
        margin: 20mm 15mm;
      }
      body {
        padding: 0;
        background: #ffffff !important;
        color: #333333 !important;
      }
      .markdown-body {
        max-width: 100%;
      }
      .markdown-body tr {
        break-inside: avoid;
        page-break-inside: avoid;
      }
      .code-block, .markdown-body pre, .markdown-body table {
        break-inside: auto;
        page-break-inside: auto;
      }
      .markdown-body pre { white-space: pre-wrap; overflow: visible; overflow-wrap: anywhere; }
      .markdown-body pre code { white-space: inherit; }
      .markdown-body thead { display: table-header-group; }
      .markdown-body h1, .markdown-body h2, .markdown-body h3, .code-header { break-after: avoid; }
      .markdown-body p { orphans: 3; widows: 3; }
      .katex-display { overflow: visible; max-width: 100%; }
      a {
        color: #333333 !important;
        text-decoration: none !important;
      }
      * {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
    }
  ${styleClose}
</head>
<body>
  <div class="markdown-body">
    ${safeBodyHtml}
  </div>
</body>
</html>`;
  }

  // 打开文件
  async function handleOpenFile() {
    await CommandService.execute('openFile');
  }

  // 打开文件夹
  async function handleOpenFolder() {
    await WorkspaceService.openFolder();
  }

  // 保存文件
  async function saveFile() {
    await CommandService.execute('saveFile');
  }

  // 另存为（使用原生系统对话框，不用 prompt）
  async function saveFileAs() {
    await CommandService.execute('saveAs');
  }

  type ExportSnapshot = {
    baseName: string;
    title: string;
    markdown: string;
    filePath: string | null;
    theme: 'light' | 'dark';
  };
  let exportInProgress = $state(false);

  async function runExport(label: string, action: (snapshot: ExportSnapshot) => Promise<void>) {
    if (exportInProgress || !get(activeSessionId)) return;
    const baseName = $fileName || 'untitled.md';
    const snapshot: ExportSnapshot = {
      baseName,
      title: baseName.replace(/\.[^/.]+$/, '') || 'untitled',
      markdown: $fileContent,
      filePath: $currentFile,
      theme: $theme,
    };
    exportInProgress = true;
    try {
      await action(snapshot);
    } catch (error) {
      console.error(`${label} export failed:`, error);
      alert(`${label} 导出失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      exportInProgress = false;
    }
  }

  async function runPreparedExport(
    label: string,
    mode: 'light' | 'current',
    action: (snapshot: ExportSnapshot, prepared: Awaited<ReturnType<typeof prepareExportDocument>>) => Promise<void>,
  ) {
    await runExport(label, async snapshot => {
      if (mode === 'light') snapshot.theme = 'light';
      const prepared = await prepareExportDocument(snapshot.markdown, snapshot.filePath, snapshot.theme);
      if (prepared.warnings?.length && !confirm(`导出存在以下问题：\n${prepared.warnings.join('\n')}\n\n是否仍然继续？`)) return;
      await action(snapshot, prepared);
    });
  }

  async function exportHTML() {
    await runPreparedExport('HTML', 'current', (snapshot, prepared) =>
      exportAsHTML(snapshot.baseName, buildExportHtml(snapshot.title, prepared.bodyHtml, snapshot.theme, prepared.embeddedCss)),
    );
  }

  // 打印当前页面
  async function printDocument() {
    await runPreparedExport('打印', 'light', (snapshot, prepared) =>
      printHtmlInBrowser(buildExportHtml(snapshot.title, prepared.bodyHtml, snapshot.theme, prepared.embeddedCss)),
    );
  }

  async function printHtmlInBrowser(htmlContent: string): Promise<void> {
    window.dispatchEvent(new CustomEvent('reader-pdf-print', {
      detail: { html: htmlContent },
    }));

    const frame = document.createElement('iframe');
    frame.title = 'PDF export print frame';
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;';
    document.body.appendChild(frame);
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (cleanupTimer) clearTimeout(cleanupTimer);
      frame.contentWindow?.removeEventListener('afterprint', cleanup);
      frame.remove();
    };

    try {
      const frameWindow = frame.contentWindow;
      const frameDocument = frame.contentDocument || frameWindow?.document;
      if (!frameWindow || !frameDocument) {
        throw new Error('无法创建打印文档');
      }

      let readyTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          new Promise<void>((resolve, reject) => {
            frame.onload = () => {
              const images = Array.from(frameDocument.images).map(image => image.decode());
              void Promise.all([frameDocument.fonts.ready, ...images]).then(() => resolve(), reject);
            };
            frameDocument.open();
            frameDocument.write(htmlContent);
            frameDocument.close();
          }),
          new Promise<never>((_, reject) => {
            readyTimer = setTimeout(() => reject(new Error('打印资源加载超时，请重试')), 15_000);
          }),
        ]);
      } finally {
        if (readyTimer) clearTimeout(readyTimer);
        frame.onload = null;
      }

      frameWindow.focus();
      frameWindow.addEventListener('afterprint', cleanup, { once: true });
      cleanupTimer = setTimeout(cleanup, 120_000);
      frameWindow.print();
    } catch (error) {
      cleanup();
      throw error;
    }
  }


  // 导出为 PDF（使用 Typora 风格的原生静默打印引擎）
  async function exportPDF() {
    await runPreparedExport('PDF', 'light', async (snapshot, prepared) => {
      const htmlContent = buildExportHtml(snapshot.title, prepared.bodyHtml, snapshot.theme, prepared.embeddedCss);
      if (isTauri()) {
        const { invoke } = await import('@tauri-apps/api/core');
        const { saveExportDialog } = await import('$lib/utils/tauri-fs');
        const selectedPath = await saveExportDialog(snapshot.title, 'pdf', 'PDF Document');
        if (!selectedPath) return; // User cancelled
        
        await invoke('export_pdf_native', { path: selectedPath, htmlContent });
      } else {
        await printHtmlInBrowser(htmlContent);
      }
    });
  }

  // 导出为 DOCX
  async function exportDOCX() {
    await runPreparedExport('DOCX', 'light', (snapshot, prepared) => exportAsDocx(snapshot.title, prepared.bodyHtml));
  }

  // 导出为 EPUB
  async function exportEPUB() {
    await runPreparedExport('EPUB', 'light', (snapshot, prepared) => exportAsEpub(snapshot.title, prepared.bodyHtml, undefined, prepared.embeddedCss));
  }

  // 导出为 LaTeX
  async function exportLaTeX() {
    await runExport('LaTeX', snapshot => exportAsLatex(snapshot.title, snapshot.markdown));
  }

  // 导出为 Markdown 变体
  async function exportMarkdownVariant(variant: 'gfm' | 'commonmark' | 'github') {
    await runExport('Markdown', snapshot => exportAsMarkdownVariant(snapshot.title, snapshot.markdown, variant));
  }

  // 导出为图片
  async function exportImage(format: 'png' | 'jpg' = 'png') {
    await runPreparedExport('图片', 'light', (snapshot, prepared) => exportAsImage(snapshot.title, prepared.bodyHtml, format, prepared.embeddedCss));
  }

  async function handleWindowControl(event: MouseEvent, action: 'minimize' | 'maximize' | 'close') {
    event.preventDefault();
    event.stopPropagation();

    const currentWindow = await getAppWindow();
    if (!currentWindow) return;

    try {
      if (action === 'minimize') {
        await currentWindow.minimize();
      } else if (action === 'maximize') {
        await currentWindow.toggleMaximize();
      } else {
        await currentWindow.close();
      }
    } catch (error) {
      console.error(`Failed to ${action} window:`, error);
    }
  }

  // 全屏切换
  function toggleFullscreen() {
    void CommandService.execute('fullscreen');
  }

  // 打开最近文件
  async function openRecentFile(path: string) {
    if (!isTauri()) return;
    await DocumentService.openPath(path);
  }

  // 处理文件拖放
  async function handleDrop(event: DragEvent) {
    event.preventDefault();

    const items = event.dataTransfer?.items;
    if (!items) return;

    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          const content = await file.text();
          createSession(file.name, file.name, content);
          break;
        }
      }
    }
  }

  function handleDragOver(event: DragEvent) {
    event.preventDefault();
  }
</script>

<div class="toolbar">
  <div class="menubar" data-tauri-drag-region>
    <div class="menubar-left">
      <!-- 侧边栏切换 -->
      <button class="menu-button" onclick={() => { void CommandService.execute('toggleSidebar'); }} aria-label={showSidebar ? 'Close library drawer' : 'Open library drawer'} title={`${showSidebar ? '隐藏' : '显示'}侧边栏 (${shortcut('toggleSidebar')})`}>
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
          <line x1="9" y1="3" x2="9" y2="21"></line>
        </svg>
      </button>

      <div class="menu-group" use:menuNavigation={closeAllMenus} role="menubar" tabindex="-1" data-tauri-drag-region="false" onmouseenter={cancelClose} onmouseleave={scheduleClose}>
        <!-- 文件菜单 -->
        <div class="relative" use:clickOutside={() => showFileMenu = false}>
          <button
            class="menu-button"
            aria-haspopup="menu" aria-expanded={showFileMenu}
            onclick={() => showFileMenu ? closeAllMenus() : openMenu('file')}
            onmouseenter={() => handleMenuHover('file')}
          >
            文件
          </button>
          {#if showFileMenu}
            <div class="absolute top-full left-0 mt-1 w-48 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-md shadow-lg z-50 fade-in"
              onmouseenter={cancelClose}
              onmouseleave={scheduleClose}
              role="menu"
              tabindex="-1"
            >
              <button class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)]" onclick={() => { newFile(); showFileMenu = false; }}>
                新建 <span class="float-right text-[var(--text-tertiary)]">{shortcut('newFile')}</span>
              </button>
              <button class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)]" onclick={() => { handleOpenFile(); showFileMenu = false; }}>
                打开 <span class="float-right text-[var(--text-tertiary)]">{shortcut('openFile')}</span>
              </button>
              <button class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)]" onclick={() => { handleOpenFolder(); showFileMenu = false; }}>
                打开文件夹
              </button>
              <div class="border-t border-[var(--border-color)]"></div>
              <button
                class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)] disabled:opacity-50"
                onclick={() => { saveFile(); showFileMenu = false; }}
              >
                保存 <span class="float-right text-[var(--text-tertiary)]">{shortcut('saveFile')}</span>
              </button>
              <button
                class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)]"
                onclick={() => { saveFileAs(); showFileMenu = false; }}
              >
                另存为... <span class="float-right text-[var(--text-tertiary)]">{shortcut('saveAs')}</span>
              </button>
              <div class="border-t border-[var(--border-color)]"></div>
              <!-- 导出子菜单 -->
              <div class="relative">
                <button
                  class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)] flex items-center justify-between"
                  onmouseenter={() => showExportSubmenu = true}
                  aria-haspopup="menu" aria-expanded={showExportSubmenu}
                  onclick={() => showExportSubmenu = !showExportSubmenu}
                >
                  导出
                  <span class="text-[var(--text-tertiary)]">▶</span>
                </button>
                {#if showExportSubmenu}
                  <div class="absolute left-full top-0 mt-0 w-48 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-md shadow-lg z-50"
                    onmouseenter={() => { cancelClose(); showExportSubmenu = true; }}
                    onmouseleave={() => { showExportSubmenu = false; scheduleClose(); }}
                    role="menu"
                    tabindex="-1"
                  >
                    <button class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)] text-sm" onclick={() => { exportHTML(); closeAllMenus(); }}>
                      HTML
                    </button>
                    <button class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)] text-sm" onclick={() => { exportPDF(); closeAllMenus(); }}>
                      PDF
                    </button>
                    <button class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)] text-sm" onclick={() => { exportDOCX(); closeAllMenus(); }}>
                      Word (DOCX)
                    </button>
                    <button class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)] text-sm" onclick={() => { exportEPUB(); closeAllMenus(); }}>
                      电子书 (EPUB)
                    </button>
                    <div class="border-t border-[var(--border-color)]"></div>
                    <button class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)] text-sm" onclick={() => { exportLaTeX(); closeAllMenus(); }}>
                      LaTeX (.tex)
                    </button>
                    <button class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)] text-sm" onclick={() => { exportImage(); closeAllMenus(); }}>
                      图片 (PNG)
                    </button>
                    <div class="border-t border-[var(--border-color)]"></div>
                    <button class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)] text-sm" onclick={() => { exportMarkdownVariant('gfm'); closeAllMenus(); }}>
                      GFM Markdown
                    </button>
                    <button class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)] text-sm" onclick={() => { exportMarkdownVariant('commonmark'); closeAllMenus(); }}>
                      CommonMark
                    </button>
                  </div>
                {/if}
              </div>
              <div class="border-t border-[var(--border-color)]"></div>
              <button
                class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)]"
                onclick={() => { void CommandService.execute('printDocument'); showFileMenu = false; }}
              >
                打印 <span class="float-right text-[var(--text-tertiary)]">{shortcut('print')}</span>
              </button>
              <div class="border-t border-[var(--border-color)]"></div>
              <button
                class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)] flex items-center"
                onclick={() => { onToggleAutoSave(); showFileMenu = false; }}
              >
                <span class="mr-2">{autoSaveEnabled ? '☑' : '☐'}</span>
                自动保存
              </button>
              {#if recentFiles.length > 0}
                <div class="border-t border-[var(--border-color)]"></div>
                <div class="px-4 py-1 text-xs text-[var(--text-tertiary)]">最近文件</div>
                {#each recentFiles.slice(0, 5) as recentPath}
                  <button
                    class="w-full px-4 py-1.5 text-left hover:bg-[var(--bg-secondary)] text-sm truncate"
                    title={recentPath}
                    onclick={() => { openRecentFile(recentPath); showFileMenu = false; }}
                  >
                    {recentPath.split(/[/\\]/).pop()}
                  </button>
                {/each}
              {/if}
            </div>
          {/if}
        </div>

        <!-- 编辑菜单 -->
        <div class="relative" use:clickOutside={() => showEditMenu = false}>
          <button
            class="menu-button"
            aria-haspopup="menu" aria-expanded={showEditMenu}
            onclick={() => showEditMenu ? closeAllMenus() : openMenu('edit')}
            onmouseenter={() => handleMenuHover('edit')}
          >
            编辑
          </button>
          {#if showEditMenu}
            <div class="absolute top-full left-0 mt-1 w-48 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-md shadow-lg z-50 fade-in"
              onmouseenter={cancelClose}
              onmouseleave={scheduleClose}
              role="menu"
              tabindex="-1"
            >
              {#each [{ id: 'undo', label: '撤销' }, { id: 'redo', label: '重做' }, { id: 'find', label: '查找' }, { id: 'replace', label: '替换' }] as item}
                <button class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)] disabled:opacity-50"
                  disabled={!$activeSessionId || ($editorMode === 'preview' && item.id !== 'find')}
                  onclick={() => runMenuCommand(item.id)}>
                  {item.label} <span class="float-right text-[var(--text-tertiary)]">{shortcut(item.id)}</span>
                </button>
              {/each}
              <div class="border-t border-[var(--border-color)]"></div>
              <button class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)]" onclick={() => runMenuCommand('toggleRead')}>
                {$editorMode === 'preview' ? '返回编辑视图' : '阅读视图'} <span class="float-right text-[var(--text-tertiary)]">{shortcut('toggleRead')}</span>
              </button>
            </div>
          {/if}
        </div>

        <!-- 视图菜单 -->
        <div class="relative" use:clickOutside={() => showViewMenu = false}>
          <button
            class="menu-button"
            aria-haspopup="menu" aria-expanded={showViewMenu}
            onclick={() => showViewMenu ? closeAllMenus() : openMenu('view')}
            onmouseenter={() => handleMenuHover('view')}
          >
            视图
          </button>
          {#if showViewMenu}
            <div class="absolute top-full left-0 mt-1 w-48 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-md shadow-lg z-50 fade-in"
              onmouseenter={cancelClose}
              onmouseleave={scheduleClose}
              role="menu"
              tabindex="-1"
            >
              <button class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)]" onclick={() => runMenuCommand('toggleSidebar')}>
                {showSidebar ? '隐藏' : '显示'}侧边栏 <span class="float-right text-[var(--text-tertiary)]">{shortcut('toggleSidebar')}</span>
              </button>
              <button class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)]" onclick={() => runMenuCommand('togglePreview')}>
                {showPreview ? 'Hide' : 'Show'} Split Preview <span class="float-right text-[var(--text-tertiary)]">{shortcut('togglePreview')}</span>
              </button>
              <div class="border-t border-[var(--border-color)]"></div>
              <button class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)] flex items-center" onclick={() => { setEditorMode('wysiwym'); showViewMenu = false; }}>
                <span class="mr-2">{$editorMode === 'wysiwym' ? '●' : '○'}</span>
                Write
              </button>
              <button class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)] flex items-center" onclick={() => { setEditorMode('source'); showViewMenu = false; }}>
                <span class="mr-2">{$editorMode === 'source' ? '●' : '○'}</span>
                Source
              </button>
              <button class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)] flex items-center" onclick={() => { setEditorMode('preview'); showViewMenu = false; }}>
                <span class="mr-2">{$editorMode === 'preview' ? '●' : '○'}</span>
                Read
              </button>
              <div class="border-t border-[var(--border-color)]"></div>
              <button class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)] flex items-center" onclick={() => { typewriterMode.update(v => !v); showViewMenu = false; }}>
                <span class="mr-2">{$typewriterMode ? '☑' : '☐'}</span>
                打字机模式
              </button>
              <button class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)] flex items-center" onclick={() => { focusMode.update(v => !v); showViewMenu = false; }}>
                <span class="mr-2">{$focusMode ? '☑' : '☐'}</span>
                专注模式
              </button>
              <div class="border-t border-[var(--border-color)]"></div>
              <button class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)]" onclick={() => runMenuCommand('toggleTheme')}>
                {$theme === 'light' ? '暗色主题' : '亮色主题'}
              </button>
              <div class="relative">
                <button class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)] flex items-center justify-between"
                  onmouseenter={() => showThemeSubmenu = true}
                  aria-haspopup="menu" aria-expanded={showThemeSubmenu}
                  onclick={() => showThemeSubmenu = !showThemeSubmenu}
                >
                  排版主题
                  <span class="text-[var(--text-tertiary)]">▶</span>
                </button>
                {#if showThemeSubmenu}
                  <div class="absolute left-full top-0 mt-0 w-40 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-md shadow-lg z-50"
                    onmouseenter={() => showThemeSubmenu = true}
                    onmouseleave={() => showThemeSubmenu = false}
                    role="menu"
                    tabindex="-1"
                  >
                    {#each THEME_PRESETS as preset}
                      <button class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)] text-sm flex items-center gap-2"
                        onclick={() => { setThemePreset(preset.id); showViewMenu = false; showThemeSubmenu = false; }}
                      >
                        {preset.name}
                        <span class="text-xs text-[var(--text-tertiary)]">{preset.description}</span>
                      </button>
                    {/each}
                  </div>
                {/if}
              </div>
              <div class="border-t border-[var(--border-color)]"></div>
              <button class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)]" onclick={() => { toggleFullscreen(); showViewMenu = false; }}>
                全屏 <span class="float-right text-[var(--text-tertiary)]">{shortcut('fullscreen')}</span>
              </button>
            </div>
          {/if}
        </div>

        <!-- 帮助菜单 -->
        <div class="relative" use:clickOutside={() => showHelpMenu = false}>
          <button
            class="menu-button"
            aria-haspopup="menu" aria-expanded={showHelpMenu}
            onclick={() => showHelpMenu ? closeAllMenus() : openMenu('help')}
            onmouseenter={() => handleMenuHover('help')}
          >
            帮助
          </button>
          {#if showHelpMenu}
            <div class="absolute top-full left-0 mt-1 w-48 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-md shadow-lg z-50 fade-in"
              onmouseenter={cancelClose}
              onmouseleave={scheduleClose}
              role="menu"
              tabindex="-1"
            >
              <button class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)]" onclick={() => runMenuCommand('settings')}>
                设置 <span class="float-right text-[var(--text-tertiary)]">{shortcut('settings')}</span>
              </button>
              <button class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)]" onclick={() => runMenuCommand('commandPalette')}>
                命令面板 <span class="float-right text-[var(--text-tertiary)]">{shortcut('commandPalette')}</span>
              </button>
              <div class="border-t border-[var(--border-color)]"></div>
              <button class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)]" onclick={() => { showAboutDialog = true; closeAllMenus(); }}>
                关于 Reader
              </button>
            </div>
          {/if}
        </div>
      </div>
    </div>

    <div class="menubar-center">
      <span class="menubar-filename">
        {$fileName || $currentFile || '未命名'}
      </span>
      {#if $isDirty}
        <span class="menubar-dirty">●</span>
      {/if}
      {#if exportInProgress}
        <span role="status" class="text-xs text-[var(--text-secondary)]">正在准备导出…</span>
      {/if}
    </div>

    <div class="menubar-right" data-tauri-drag-region="false">
      <!-- 主题切换 -->
      <button class="menu-button" onclick={() => { void CommandService.execute('toggleTheme'); }} title="切换主题">
        {#if $theme === 'light'}
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
          </svg>
        {:else}
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="5"></circle>
            <line x1="12" y1="1" x2="12" y2="3"></line>
            <line x1="12" y1="21" x2="12" y2="23"></line>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
            <line x1="1" y1="12" x2="3" y2="12"></line>
            <line x1="21" y1="12" x2="23" y2="12"></line>
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
          </svg>
        {/if}
      </button>

      <!-- 设置按钮 -->
      <button class="menu-button" onclick={() => { void CommandService.execute('settings'); }} title="设置">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
        </svg>
      </button>

      {#if showWindowControls}
        <div class="window-controls" data-tauri-drag-region="false">
          <button
            class="window-control"
            onclick={(event) => handleWindowControl(event, 'minimize')}
            onmousedown={(event) => event.stopPropagation()}
            aria-label="Minimize"
            title="Minimize"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="5" y1="19" x2="19" y2="19"></line>
            </svg>
          </button>
          <button
            class="window-control"
            onclick={(event) => handleWindowControl(event, 'maximize')}
            onmousedown={(event) => event.stopPropagation()}
            aria-label="Maximize"
            title="Maximize"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="5" y="5" width="14" height="14" rx="2" ry="2"></rect>
            </svg>
          </button>
          <button
            class="window-control window-control-close"
            onclick={(event) => handleWindowControl(event, 'close')}
            onmousedown={(event) => event.stopPropagation()}
            aria-label="Close"
            title="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      {/if}
    </div>
  </div>
</div>

<!-- 关于对话框 -->
{#if showAboutDialog}
  <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-[200]" onclick={() => showAboutDialog = false} role="button" tabindex="-1" onkeydown={(e) => e.key === 'Escape' && (showAboutDialog = false)}>
    <div class="bg-[var(--bg-primary)] rounded-lg shadow-xl p-6 w-80 border border-[var(--border-color)]" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="关于 Reader" tabindex="-1" onkeydown={(e) => {}}>
      <div class="text-center mb-4">
        <div class="text-4xl mb-2">📖</div>
        <h2 class="text-xl font-semibold text-[var(--text-primary)]">Reader</h2>
        <p class="text-sm text-[var(--text-secondary)]">轻量级 Markdown / LaTeX 阅读器</p>
      </div>
      <div class="text-sm text-[var(--text-secondary)] space-y-1 mb-4">
        <p>版本：1.0.0</p>
        <p>基于 Tauri v2 + SvelteKit</p>
        <p>支持 Markdown、LaTeX、Mermaid、代码高亮</p>
      </div>
      <div class="border-t border-[var(--border-color)] pt-3">
        <p class="text-xs text-[var(--text-tertiary)] text-center">
          © 2025 Shaoyilei · MIT License
        </p>
      </div>
      <button
        class="w-full mt-4 px-4 py-2 bg-[var(--accent-color)] text-white rounded-md hover:bg-[var(--accent-hover)] transition-colors"
        onclick={() => showAboutDialog = false}
      >
        确定
      </button>
    </div>
  </div>
{/if}
