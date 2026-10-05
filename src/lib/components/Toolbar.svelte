<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { get } from 'svelte/store';
  import { theme, themePreset, setThemePreset } from '$lib/stores/theme';
  import { isDirty, currentFile, fileName, fileContent } from '$lib/stores/document';
  import { editorMode, typewriterMode, focusMode } from '$lib/stores/ui';
  import { isTauri } from '$lib/utils/platform';
  import { THEME_PRESETS, type ThemePreset } from '$lib/themes';
  import { exportAsDocx, exportAsEpub, exportAsLatex, exportAsMarkdownVariant, exportAsImage, saveExportFile, type ExportWriteOptions } from '$lib/utils/export-formats';
  import { activeSessionId, sessions } from '$lib/stores/document';
  import { DocumentService } from '$lib/services/document';
  import { CommandService } from '$lib/services/command';
  import { prepareExportDocument } from '$lib/services/export-document';
  import ExportPreview from './ExportPreview.svelte';
  import { exportTypography, type ExportSource } from '$lib/utils/export-options';
  import { ExportHistory, type ExportFormat } from '$lib/services/export-history';
  import { buildExportHtml as createExportHtml, fitPrintFormulas, type ExportTypography } from '$lib/utils/export-html';
  import { shortcutBindings } from '$lib/services/shortcut';
  import { menuNavigation } from '$lib/utils/menu-navigation';
  import { settings, type Settings } from '$lib/stores/settings';
  import { exportJob, cancelExport, checkExportSignal, withExportJob, type ExportStage } from '$lib/services/export-job';
  import { dialogFocus } from '$lib/utils/dialog-focus';
  import { buildInfo, buildTimeLabel, runtimeDiagnostics, diagnosticText } from '$lib/utils/build-info';
  import { notify, confirmAction, ask } from '$lib/services/interaction';
  import { anchoredMenu } from '$lib/utils/menu-position';
  import type { EditorMode } from '$lib/types';

  const shortcut = (id: string) => $shortcutBindings.find(item => item.id === id)?.key ?? '';
  function runMenuCommand(id: string) {
    closeAllMenus();
    void CommandService.execute(id);
  }
  function selectMode(mode: EditorMode) {
    closeAllMenus();
    void CommandService.execute(mode === 'wysiwym' ? 'modeWrite' : mode === 'source' ? 'modeSource' : 'modeRead');
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
  let diagnostics = $state({ executable: '正在读取…', platform: isTauri() ? 'Tauri 桌面' : '浏览器', nativeVersion: '' });
  $effect(() => {
    if (!showAboutDialog) return;
    let cancelled = false;
    void runtimeDiagnostics().then(value => { if (!cancelled) diagnostics = { ...value, nativeVersion: value.nativeVersion ?? '' }; })
      .catch(error => { if (!cancelled) diagnostics = { executable: `读取失败：${String(error)}`, platform: isTauri() ? 'Tauri 桌面' : '浏览器', nativeVersion: '' }; });
    return () => { cancelled = true; };
  });
  async function copyDiagnostics() {
    try { await navigator.clipboard.writeText(diagnosticText(diagnostics)); notify('诊断信息已复制，不包含文档内容。', undefined, false); }
    catch (error) { notify(`复制诊断信息失败：${String(error)}`); }
  }
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

  function closeMenuIfOpen(menu: 'file' | 'edit' | 'view' | 'help') {
    if ((menu === 'file' && showFileMenu) || (menu === 'edit' && showEditMenu)
      || (menu === 'view' && showViewMenu) || (menu === 'help' && showHelpMenu)) {
      closeAllMenus();
    }
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
    const registrations = [
      ['printDocument', printDocument], ['exportPdf', exportPDF], ['exportDefault', exportDefault],
      ['exportHTML', exportHTML], ['exportDOCX', exportDOCX], ['exportEPUB', exportEPUB],
      ['exportLaTeX', exportLaTeX], ['exportImage', () => exportImage()],
      ['exportGfm', () => exportMarkdownVariant('gfm')], ['exportCommonMark', () => exportMarkdownVariant('commonmark')],
      ['exportPrevious', exportPrevious],
      ['exportPreview', openExportPreview],
    ] as const;
    const cleanups = registrations.map(([id, handler]) => CommandService.register(id, handler, {
      enabled: () => !!get(activeSessionId) && !get(exportJob) && !previewSource && (id !== 'exportPrevious' || !!previousExports.get(captureExportSource(), get(settings))),
      unavailable: id === 'exportPrevious' ? '当前文档尚无成功的导出记录，或正在导出。' : '请先打开文档，并等待当前导出结束。',
    }));
    return () => { cancelClose(); cancelExport(); cleanups.forEach(cleanup => cleanup()); };
  });

  // 新建文件
  function newFile() {
    void CommandService.execute('newFile');
  }


  // 打开文件
  async function handleOpenFile() {
    await CommandService.execute('openFile');
  }

  // 打开文件夹
  async function handleOpenFolder() {
    await CommandService.execute('openFolder');
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
    typography: ExportTypography;
    sessionId: string;
    preferences: Settings;
    write: ExportWriteOptions;
    signal: AbortSignal;
    stage: (value: ExportStage) => void;
  };
  const exportInProgress = $derived($exportJob !== null);
  let previewSource = $state<ExportSource | null>(null);
  let previewPreferences = $state<Settings>(get(settings));
  function captureExportSource(): ExportSource | null {
    const sessionId = get(activeSessionId);
    return sessionId ? { sessionId, baseName: get(fileName) || 'untitled.md', markdown: get(fileContent),
      filePath: get(currentFile), theme: get(theme) } : null;
  }
  function openExportPreview() {
    previewSource = captureExportSource(); previewPreferences = { ...get(settings) };
  }
  function closeExportPreview() {
    previewSource = null;
    void tick().then(() => {
      if (previewSource || get(exportJob) || document.querySelector('[aria-modal="true"]')) return;
      document.querySelector<HTMLElement>('[data-testid="file-menu-trigger"]')?.focus({ preventScroll: true });
    });
  }
  function confirmExportPreview(format: 'html' | 'pdf', preferences: Settings, prepared: Awaited<ReturnType<typeof prepareExportDocument>>) {
    const source = previewSource ? { ...previewSource, theme: 'light' as const } : null;
    previewSource = null;
    if (!source) return;
    if (format === 'pdf') void exportPDF(preferences, source, prepared);
    else void exportHTML(preferences, source, prepared);
  }
  const previousExports = new ExportHistory();
  const exportStages = { destination: '选择保存位置', render: '渲染文档', resources: '嵌入资源', write: '生成并写入文件' };

  async function runExport(label: string, action: (snapshot: ExportSnapshot) => Promise<void>, format: ExportFormat = 'print', preferences?: Settings, source?: ExportSource) {
    const capturedSource = source ?? captureExportSource();
    if (exportInProgress || !capturedSource) return;
    const { sessionId, baseName } = capturedSource;
    const captured = { ...(preferences ?? get(settings)) };
    const capturedContent = capturedSource.markdown, capturedPath = capturedSource.filePath, capturedTheme = capturedSource.theme;
    let savedPath: string | undefined;
    try {
      const completed = await withExportJob(label, async (signal, stage) => {
      const extension = ({ latex: 'tex', gfm: 'gfm.md', commonmark: 'cm.md', github: 'github.md', print: '' } as Record<string, string>)[format] ?? format;
      const title = baseName.replace(/\.[^/.]+$/, '') || 'untitled';
      let path: string | undefined;
      if (isTauri() && format !== 'print') {
        const { saveExportDialog } = await import('$lib/utils/tauri-fs');
        const selected = await saveExportDialog(`${title}.${extension}`, extension.split('.').pop()!, label);
        if (!selected) throw new DOMException('Export canceled', 'AbortError');
        path = selected.toLowerCase().endsWith(`.${extension}`) ? selected : `${selected}.${extension}`;
        if (get(sessions).some(session => session.path && path!.replace(/\\/g, '/').toLowerCase() === session.path.replace(/\\/g, '/').toLowerCase())) {
          throw new Error('导出目标不能覆盖已打开的源文件。');
        }
      }
      checkExportSignal(signal);
      const snapshot: ExportSnapshot = {
      baseName,
      title,
      markdown: capturedContent,
      filePath: capturedPath,
      theme: capturedTheme,
      typography: exportTypography(captured),
      sessionId, preferences: captured, signal, stage,
      write: { path, signal, onWrite: () => stage('write') },
    };
      stage('render');
      await action(snapshot);
      checkExportSignal(signal);
      if (format !== 'print' && !(format === 'pdf' && !isTauri())) previousExports.record(capturedSource, format, captured);
      savedPath = path;
      });
      const completionMessage = !isTauri() && format === 'pdf'
        ? '已打开打印对话框，请在其中选择保存为 PDF；Reader 无法确认是否保存成功。'
        : `${label} 导出完成${isTauri() ? '' : '，已提交浏览器下载'}。`;
      if (completed && format !== 'print') notify(completionMessage, savedPath ? {
        label: '打开 / 定位', run: async () => {
          const choice = await ask({ title: '导出完成', message: savedPath!, actions: [
            { id: 'cancel', label: '关闭' }, { id: 'reveal', label: '所在文件夹' }, { id: 'open', label: '打开文件' },
          ] });
          if (choice === 'cancel') return;
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('open_document_path', { path: savedPath, reveal: choice === 'reveal' });
        },
      } : undefined, false);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') { notify('已取消导出，未提交新的文件写入。', undefined, false); return; }
      console.error(`${label} export failed:`, error);
      notify(`${label} 导出失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function buildExportHtml(snapshot: ExportSnapshot, html: string, css = '', styled = true) {
    return createExportHtml(snapshot.title, html, snapshot.theme, css, styled, snapshot.typography);
  }

  async function runPreparedExport(
    label: string,
    mode: 'light' | 'current',
    action: (snapshot: ExportSnapshot, prepared: Awaited<ReturnType<typeof prepareExportDocument>>) => Promise<void>,
    format: ExportFormat = 'print', preferences?: Settings,
    source?: ExportSource, preparedSnapshot?: Awaited<ReturnType<typeof prepareExportDocument>>,
  ) {
    await runExport(label, async snapshot => {
      if (mode === 'light') snapshot.theme = 'light';
      const prepared = preparedSnapshot ?? await prepareExportDocument(snapshot.markdown, snapshot.filePath, snapshot.theme, {
        signal: snapshot.signal, onResources: () => snapshot.stage('resources'),
      });
      if (prepared.warnings?.length && !await confirmAction('导出资源异常', `导出存在以下问题：\n${prepared.warnings.join('\n')}\n\n是否仍然继续？`, '仍然导出')) throw new DOMException('Export canceled', 'AbortError');
      checkExportSignal(snapshot.signal);
      await action(snapshot, prepared);
    }, format, preferences, source);
  }

  async function exportHTML(preferences?: Settings, source?: ExportSource, prepared?: Awaited<ReturnType<typeof prepareExportDocument>>) {
    await runPreparedExport('HTML', 'current', (snapshot, prepared) =>
      saveExportFile(`${snapshot.title}.html`, buildExportHtml(snapshot, prepared.bodyHtml, prepared.embeddedCss, snapshot.preferences.exportIncludeCss), 'text/html', 'HTML Document', snapshot.write),
      'html', preferences, source, prepared,
    );
  }

  async function exportDefault() {
    switch ($settings.exportDefaultFormat) {
      case 'pdf': await exportPDF(); break;
      case 'docx': await exportDOCX(); break;
      case 'epub': await exportEPUB(); break;
      default: await exportHTML();
    }
  }

  async function exportPrevious() {
    const previous = previousExports.get(captureExportSource(), get(settings));
    if (!previous) return;
    const { format, preferences } = previous;
    if (format === 'html') await exportHTML(preferences);
    else if (format === 'pdf') await exportPDF(preferences);
    else if (format === 'docx') await exportDOCX(preferences);
    else if (format === 'epub') await exportEPUB(preferences);
    else if (format === 'latex') await exportLaTeX(preferences);
    else if (format === 'png' || format === 'jpg') await exportImage(format, preferences);
    else if (format === 'gfm' || format === 'commonmark' || format === 'github') await exportMarkdownVariant(format, preferences);
  }

  const exportFormatLabel = $derived(({ html: 'HTML', pdf: 'PDF', docx: 'Word', epub: 'EPUB' } as Record<string, string>)[$settings.exportDefaultFormat] ?? 'HTML');

  // 打印当前页面
  async function printDocument() {
    await runPreparedExport('打印', 'light', async (snapshot, prepared) => {
      snapshot.stage('write');
      await printHtmlInBrowser(buildExportHtml(snapshot, prepared.bodyHtml, prepared.embeddedCss));
    },
    );
  }

  async function printHtmlInBrowser(htmlContent: string): Promise<void> {
    window.dispatchEvent(new CustomEvent('reader-pdf-print', {
      detail: { html: htmlContent },
    }));

    const frame = document.createElement('iframe');
    frame.title = 'PDF export print frame';
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:1px;border:0;opacity:0;pointer-events:none;';
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
      const main = frameDocument.querySelector<HTMLElement>('.markdown-body');
      const width = Number(frameDocument.querySelector('meta[name="reader-print-width"]')?.getAttribute('content')) || 170;
      frame.style.width = `${width * 96 / 25.4}px`;
      const measureStyle = frameDocument.createElement('style');
      measureStyle.textContent = '@media screen { body { padding:0 !important; } .markdown-body { max-width:100% !important; } }';
      frameDocument.head.append(measureStyle);
      if (main) void main.offsetWidth;
      fitPrintFormulas(frameDocument);
      frameWindow.addEventListener('afterprint', cleanup, { once: true });
      cleanupTimer = setTimeout(cleanup, 120_000);
      frameWindow.print();
    } catch (error) {
      cleanup();
      throw error;
    }
  }


  // 导出为 PDF（使用 Typora 风格的原生静默打印引擎）
  async function exportPDF(preferences?: Settings, source?: ExportSource, prepared?: Awaited<ReturnType<typeof prepareExportDocument>>) {
    await runPreparedExport('PDF', 'light', async (snapshot, prepared) => {
      if (!isTauri() && snapshot.preferences.exportBookmarks) throw new Error('浏览器打印不支持自动生成 PDF 书签，请关闭该选项或使用桌面版。');
      const htmlContent = buildExportHtml(snapshot, prepared.bodyHtml, prepared.embeddedCss);
      snapshot.stage('write');
      if (isTauri()) {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('export_pdf_native', { path: snapshot.write.path, htmlContent, paper: snapshot.preferences.exportPaper,
          marginMm: snapshot.preferences.exportMargin, landscape: snapshot.preferences.exportOrientation === 'landscape',
          bookmarks: snapshot.preferences.exportBookmarks, pageNumbers: snapshot.preferences.exportPageNumbers });
      } else {
        await printHtmlInBrowser(htmlContent);
      }
    }, 'pdf', preferences, source, prepared);
  }

  // 导出为 DOCX
  async function exportDOCX(preferences?: Settings) {
    await runPreparedExport('DOCX', 'light', (snapshot, prepared) => exportAsDocx(snapshot.title, prepared.bodyHtml, snapshot.write), 'docx', preferences);
  }

  // 导出为 EPUB
  async function exportEPUB(preferences?: Settings) {
    await runPreparedExport('EPUB', 'light', (snapshot, prepared) => exportAsEpub(snapshot.title, prepared.bodyHtml, undefined, prepared.embeddedCss, snapshot.write), 'epub', preferences);
  }

  // 导出为 LaTeX
  async function exportLaTeX(preferences?: Settings) {
    await runExport('LaTeX', snapshot => exportAsLatex(snapshot.title, snapshot.markdown, snapshot.write), 'latex', preferences);
  }

  // 导出为 Markdown 变体
  async function exportMarkdownVariant(variant: 'gfm' | 'commonmark' | 'github', preferences?: Settings) {
    await runExport('Markdown', snapshot => exportAsMarkdownVariant(snapshot.title, snapshot.markdown, variant, snapshot.write), variant, preferences);
  }

  // 导出为图片
  async function exportImage(format: 'png' | 'jpg' = 'png', preferences?: Settings) {
    await runPreparedExport('图片', 'light', (snapshot, prepared) => exportAsImage(snapshot.title, prepared.bodyHtml, format, prepared.embeddedCss, snapshot.write), format, preferences);
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

</script>

<div class="toolbar">
  <div class="menubar" data-tauri-drag-region>
    <div class="menubar-left">
      <!-- 侧边栏切换 -->
      <button class="menu-button" onclick={() => { void CommandService.execute('toggleSidebar'); }} aria-label={showSidebar ? '隐藏侧栏' : '显示侧栏'} title={`${showSidebar ? '隐藏' : '显示'}侧边栏 (${shortcut('toggleSidebar')})`}>
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
          <line x1="9" y1="3" x2="9" y2="21"></line>
        </svg>
      </button>

      <div class="menu-group" use:menuNavigation={closeAllMenus} role="menubar" aria-label="应用菜单" tabindex="-1" data-tauri-drag-region="false" onmouseenter={cancelClose} onmouseleave={scheduleClose}>
        <!-- 文件菜单 -->
        <div class="relative" use:clickOutside={() => closeMenuIfOpen('file')}>
          <button
            class="menu-button"
            data-testid="file-menu-trigger"
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
              use:anchoredMenu
              data-testid="file-menu"
              tabindex="-1"
            >
              <button class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)]" onclick={() => { newFile(); closeAllMenus(); }}>
                新建 <span class="float-right text-[var(--text-tertiary)]">{shortcut('newFile')}</span>
              </button>
              <button class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)]" onclick={() => { handleOpenFile(); closeAllMenus(); }}>
                打开 <span class="float-right text-[var(--text-tertiary)]">{shortcut('openFile')}</span>
              </button>
              <button class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)]" onclick={() => { handleOpenFolder(); closeAllMenus(); }}>
                打开文件夹
              </button>
              <button class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)]" onclick={() => runMenuCommand('quickOpen')}>
                快速打开 <span class="float-right text-[var(--text-tertiary)]">{shortcut('quickOpen')}</span>
              </button>
              <button class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)]" onclick={() => runMenuCommand('reopenTab')}>
                重新打开关闭的标签 <span class="float-right text-[var(--text-tertiary)]">{shortcut('reopenTab')}</span>
              </button>
              <div class="border-t border-[var(--border-color)]"></div>
              <button
                class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)] disabled:opacity-50"
                disabled={!$activeSessionId}
                onclick={() => { saveFile(); closeAllMenus(); }}
              >
                保存 <span class="float-right text-[var(--text-tertiary)]">{shortcut('saveFile')}</span>
              </button>
              <button
                class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)]"
                disabled={!$activeSessionId}
                onclick={() => { saveFileAs(); closeAllMenus(); }}
              >
                另存为... <span class="float-right text-[var(--text-tertiary)]">{shortcut('saveAs')}</span>
              </button>
              <div class="border-t border-[var(--border-color)]"></div>
              <!-- 导出子菜单 -->
              <div class="relative">
                <button
                  class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)] flex items-center justify-between"
                  data-testid="export-menu-trigger"
                  disabled={!$activeSessionId || exportInProgress}
                  onmouseenter={() => { if ($activeSessionId && !exportInProgress) showExportSubmenu = true; }}
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
                    use:anchoredMenu={true}
                    data-testid="export-submenu"
                    tabindex="-1"
                  >
                    <button data-export-format="default" class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)] text-sm" onclick={() => runMenuCommand('exportDefault')}>
                      快速导出为 {exportFormatLabel}
                    </button>
                    <button data-export-format="previous" class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)] text-sm" onclick={() => runMenuCommand('exportPrevious')}>使用上次配置导出…</button>
                    <button data-export-format="preview" class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)] text-sm" onclick={() => runMenuCommand('exportPreview')}>导出预览与设置…</button>
                    <div class="border-t border-[var(--border-color)]"></div>
                    <button data-export-format="html" class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)] text-sm" onclick={() => runMenuCommand('exportHTML')}>
                      HTML
                    </button>
                    <button data-export-format="pdf" class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)] text-sm" onclick={() => runMenuCommand('exportPdf')}>
                      PDF
                    </button>
                    <button data-export-format="docx" class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)] text-sm" onclick={() => runMenuCommand('exportDOCX')}>
                      Word (DOCX)
                    </button>
                    <button data-export-format="epub" class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)] text-sm" onclick={() => runMenuCommand('exportEPUB')}>
                      电子书 (EPUB)
                    </button>
                    <div class="border-t border-[var(--border-color)]"></div>
                    <button data-export-format="latex" class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)] text-sm" onclick={() => runMenuCommand('exportLaTeX')}>
                      LaTeX (.tex)
                    </button>
                    <button data-export-format="png" class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)] text-sm" onclick={() => runMenuCommand('exportImage')}>
                      图片 (PNG)
                    </button>
                    <div class="border-t border-[var(--border-color)]"></div>
                    <button data-export-format="gfm" class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)] text-sm" onclick={() => runMenuCommand('exportGfm')}>
                      GFM Markdown
                    </button>
                    <button data-export-format="commonmark" class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)] text-sm" onclick={() => runMenuCommand('exportCommonMark')}>
                      CommonMark
                    </button>
                  </div>
                {/if}
              </div>
              <div class="border-t border-[var(--border-color)]"></div>
              <button
                class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)]"
                disabled={!$activeSessionId || exportInProgress}
                onclick={() => { void CommandService.execute('printDocument'); closeAllMenus(); }}
              >
                打印 <span class="float-right text-[var(--text-tertiary)]">{shortcut('print')}</span>
              </button>
              <div class="border-t border-[var(--border-color)]"></div>
              <button
                class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)] flex items-center"
                role="menuitemcheckbox" aria-checked={autoSaveEnabled}
                onclick={() => { onToggleAutoSave(); closeAllMenus(); }}
              >
                自动保存
              </button>
              {#if isTauri() && recentFiles.length > 0}
                <div class="border-t border-[var(--border-color)]"></div>
                <div class="px-4 py-1 text-xs text-[var(--text-tertiary)]">最近文件</div>
                {#each recentFiles.slice(0, 5) as recentPath}
                  <button
                    class="w-full px-4 py-1.5 text-left hover:bg-[var(--bg-secondary)] text-sm truncate"
                    title={recentPath}
                    onclick={() => { openRecentFile(recentPath); closeAllMenus(); }}
                  >
                    {recentPath.split(/[/\\]/).pop()}
                  </button>
                {/each}
              {/if}
            </div>
          {/if}
        </div>

        <!-- 编辑菜单 -->
        <div class="relative" use:clickOutside={() => closeMenuIfOpen('edit')}>
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
              use:anchoredMenu
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
              <button class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)]" disabled={!$activeSessionId} onclick={() => runMenuCommand('toggleRead')}>
                {$editorMode === 'preview' ? '返回编辑视图' : '阅读视图'} <span class="float-right text-[var(--text-tertiary)]">{shortcut('toggleRead')}</span>
              </button>
            </div>
          {/if}
        </div>

        <!-- 视图菜单 -->
        <div class="relative" use:clickOutside={() => closeMenuIfOpen('view')}>
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
              use:anchoredMenu
              tabindex="-1"
            >
              <button class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)]" role="menuitemcheckbox" aria-checked={showSidebar} onclick={() => runMenuCommand('toggleSidebar')}>
                {showSidebar ? '隐藏' : '显示'}侧边栏 <span class="float-right text-[var(--text-tertiary)]">{shortcut('toggleSidebar')}</span>
              </button>
              <button class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)]" disabled={!$activeSessionId}
                role="menuitemcheckbox" aria-checked={showPreview} onclick={() => runMenuCommand('togglePreview')}>
                分屏预览 <span class="float-right text-[var(--text-tertiary)]">{shortcut('togglePreview')}</span>
              </button>
              <div class="border-t border-[var(--border-color)]"></div>
              <button class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)] flex items-center" disabled={!$activeSessionId}
                role="menuitemradio" aria-label="写作" aria-checked={$editorMode === 'wysiwym'} onclick={() => selectMode('wysiwym')}>
                写作
              </button>
              <button class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)] flex items-center" disabled={!$activeSessionId}
                role="menuitemradio" aria-label="源码" aria-checked={$editorMode === 'source'} onclick={() => selectMode('source')}>
                源码
              </button>
              <button class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)] flex items-center" disabled={!$activeSessionId}
                role="menuitemradio" aria-label="阅读" aria-checked={$editorMode === 'preview'} onclick={() => selectMode('preview')}>
                阅读
              </button>
              <div class="border-t border-[var(--border-color)]"></div>
              <button class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)] flex items-center"
                role="menuitemcheckbox" aria-label="打字机模式" aria-checked={$typewriterMode} onclick={() => runMenuCommand('typewriterMode')}>
                打字机模式
              </button>
              <button class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)] flex items-center"
                role="menuitemcheckbox" aria-label="专注模式" aria-checked={$focusMode} onclick={() => runMenuCommand('focusMode')}>
                专注模式
              </button>
              <button class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)]" onclick={() => runMenuCommand('zoomIn')}>放大显示</button>
              <button class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)]" onclick={() => runMenuCommand('zoomOut')}>缩小显示</button>
              <button class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)]" onclick={() => runMenuCommand('zoomReset')}>恢复 100% 显示</button>
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
                    use:anchoredMenu={true}
                    tabindex="-1"
                  >
                    {#each THEME_PRESETS as preset}
                      <button class="theme-menu-item w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)] text-sm"
                        role="menuitemradio" aria-checked={$themePreset === preset.id}
                        onclick={() => { setThemePreset(preset.id); closeAllMenus(); }}
                      >
                        <span>{preset.name}</span>
                        <span class="theme-menu-description">{preset.description}</span>
                      </button>
                    {/each}
                  </div>
                {/if}
              </div>
              <div class="border-t border-[var(--border-color)]"></div>
              <button class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)]" onclick={() => { toggleFullscreen(); closeAllMenus(); }}>
                全屏 <span class="float-right text-[var(--text-tertiary)]">{shortcut('fullscreen')}</span>
              </button>
            </div>
          {/if}
        </div>

        <!-- 帮助菜单 -->
        <div class="relative" use:clickOutside={() => closeMenuIfOpen('help')}>
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
              use:anchoredMenu
              tabindex="-1"
            >
              <button class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)]" onclick={() => runMenuCommand('settings')}>
                设置 <span class="float-right text-[var(--text-tertiary)]">{shortcut('settings')}</span>
              </button>
              <button class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)]" onclick={() => runMenuCommand('commandPalette')}>
                命令面板 <span class="float-right text-[var(--text-tertiary)]">{shortcut('commandPalette')}</span>
              </button>
              <button class="w-full px-4 py-2 text-left hover:bg-[var(--bg-secondary)]" onclick={() => runMenuCommand('recoveryCenter')}>
                恢复中心...
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
      {#if $activeSessionId && $sessions.length < 2 && !$settings.showSingleTab}
      <span class="menubar-filename" title={$currentFile || $fileName || '未命名'}>
        {$fileName || $currentFile || '未命名'}
      </span>
      {#if $isDirty}
        <span class="menubar-dirty">●</span>
      {/if}
      {/if}
      {#if exportInProgress}
        <span role="status" class="text-xs text-[var(--text-secondary)]">{$exportJob?.label} · {$exportJob ? exportStages[$exportJob.stage] : ''}</span>
        {#if $exportJob?.cancellable}<button type="button" class="menu-button" onclick={cancelExport}>取消导出</button>{/if}
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
{#if previewSource}
  <ExportPreview source={previewSource} initialPreferences={previewPreferences} close={closeExportPreview} confirm={confirmExportPreview} />
{/if}

{#if showAboutDialog}
  <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-[200]" onclick={() => showAboutDialog = false} role="button" tabindex="-1" onkeydown={(e) => e.key === 'Escape' && (showAboutDialog = false)}>
    <div class="about-panel" use:dialogFocus={{ close: () => showAboutDialog = false }} onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="关于 Reader" tabindex="-1" onkeydown={(e) => {}}>
      <div class="text-center mb-4">
        <h2 class="text-xl font-semibold text-[var(--text-primary)]">Reader</h2>
        <p class="text-sm text-[var(--text-secondary)]">轻量级 Markdown / LaTeX 阅读器</p>
      </div>
      <div class="text-sm text-[var(--text-secondary)] space-y-1 mb-4">
        <p>版本：{buildInfo.version}</p>
        <p>构建：{buildTimeLabel()}（北京时间）</p>
        <p>源码：{buildInfo.revision}{buildInfo.dirty ? ' · 含未提交修改' : ''}</p>
        <p>环境：{diagnostics.platform}</p>
        <p class="program-path">程序：{diagnostics.executable}</p>
        <p>基于 Tauri v2 + SvelteKit</p>
        <p>支持 Markdown、LaTeX、Mermaid、代码高亮</p>
      </div>
      <div class="border-t border-[var(--border-color)] pt-3">
        <p class="text-xs text-[var(--text-tertiary)] text-center">
          © {new Date().getFullYear()} Shaoyilei · MIT License
        </p>
      </div>
      <button class="diagnostic-copy" onclick={copyDiagnostics}>复制诊断信息</button>
      <button
        class="w-full mt-4 px-4 py-2 bg-[var(--accent-color)] text-white rounded-md hover:bg-[var(--accent-hover)] transition-colors"
        onclick={() => showAboutDialog = false}
      >
        确定
      </button>
    </div>
  </div>
{/if}

<style>
  .menu-group :global([role="menu"]) {
    width: 260px;
    min-width: min(220px, calc(100vw - 16px));
    padding: 5px;
    overflow: auto;
    background: var(--ui-panel);
    color: var(--ui-text);
    border: 1px solid var(--ui-border);
    border-radius: 6px;
    box-shadow: var(--ui-shadow-popover);
    animation: none;
  }
  .menu-group :global([role="menu"] button) {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    min-height: 30px;
    padding: 6px 10px 6px 24px;
    border-radius: 3px;
    font-size: 13px;
    line-height: 1.4;
  }
  .menu-group :global([role="menu"] button:hover:not(:disabled)),
  .menu-group :global([role="menu"] button:focus-visible) { background: var(--ui-panel-hover); outline: none; }
  .menu-group :global([role="menu"] button:disabled) { opacity: .4; cursor: default; }
  .menu-group :global([role="menu"] button[aria-checked="true"]::before) {
    content: '\2713'; position: absolute; left: 7px; top: 50%; transform: translateY(-50%); font-size: 12px;
  }
  .menu-group :global([role="menu"] .float-right) { flex-shrink: 0; font-size: 11px; color: var(--ui-text-muted); }
  .menu-group :global([role="menu"] .border-t) { margin: 5px 6px; border-color: var(--ui-border); }
  .menu-group :global([role="menu"] .theme-menu-item) { display: block; }
  .theme-menu-description { display: block; margin-top: 2px; color: var(--ui-text-muted); font-size: 11px; white-space: normal; }
  .about-panel { width: min(480px, calc(100vw - 32px)); max-height: 85vh; overflow: auto; padding: 24px; background: var(--ui-panel-active); color: var(--ui-text); border: 1px solid var(--ui-border); border-radius: 6px; box-shadow: var(--ui-shadow-popover); }
  .program-path { overflow-wrap: anywhere; font-size: 12px; }
  .diagnostic-copy { width: 100%; padding: 7px 12px; margin-top: 12px; border: 1px solid var(--ui-border); border-radius: 4px; background: var(--ui-panel); font-size: 13px; }
</style>
