<script lang="ts">
  import { dialogFocus } from '$lib/utils/dialog-focus';
  import { onMount, tick } from 'svelte';
  import { get } from 'svelte/store';
  import { theme, toggleTheme } from '$lib/stores/theme';
  import { initThemePreset } from '$lib/themes';
  import { currentFile, fileContent, isEditing, cycleSession } from '$lib/stores/document';
  import QuickOpen from '$lib/components/QuickOpen.svelte';
  import { WorkspaceSessionService } from '$lib/services/workspace-session';
  import { NavigationService } from '$lib/services/navigation';
  import { setCurrentFileDir } from '$lib/utils/markdown';
  import { isTauri } from '$lib/utils/platform';
  import { pathContains, normalizePathKey, replacePathPrefix } from '$lib/utils/path';
  import { asFileError } from '$lib/utils/file-error';
  import { sessions, activeSessionId, createSession, refreshSessionFromDisk, markSessionExternalModified, renameSessionPaths } from '$lib/stores/document';
  import { currentDirectory, refreshDirectory } from '$lib/stores/file';
  import { readFile as readNativeFile, watchPaths, unwatchDirectory, onFsChange, type WatchPath } from '$lib/utils/native-fs';
  import { DocumentService, closeConfirmDialog } from '$lib/services/document';
  import { settings, updateSettings } from '$lib/stores/settings';
  import { ShortcutService } from '$lib/services/shortcut';
  import { RecoveryService } from '$lib/services/recovery';
  import { RenderService } from '$lib/services/render';
  import { CommandService } from '$lib/services/command';
  import { editorMode, splitPreviewVisible, toggleReadMode, toggleSplitPreview, focusMode, typewriterMode } from '$lib/stores/ui';
  import { selectDocumentMode } from '$lib/services/editor-presentation';
  import Toolbar from '$lib/components/Toolbar.svelte';
  import TabBar from '$lib/components/TabBar.svelte';
  import Sidebar from '$lib/components/Sidebar.svelte';
  import Editor from '$lib/components/Editor.svelte';
  import Preview from '$lib/components/Preview.svelte';
  import StatusBar from '$lib/components/StatusBar.svelte';
  import SearchReplace from '$lib/components/SearchReplace.svelte';
  import { WorkspaceService } from '$lib/services/workspace';
  import SettingsComponent from '$lib/components/Settings.svelte';
  import CommandPalette from '$lib/components/CommandPalette.svelte';
  import RecoveryCenter from '$lib/components/RecoveryCenter.svelte';
  import InteractionHost from '$lib/components/InteractionHost.svelte';
  import ResourceInspector from '$lib/components/ResourceInspector.svelte';
  import { TYPOGRAPHY_PRESETS } from '$lib/styles/typography';
  import { WorkspaceIndex } from '$lib/services/workspace-index';
  import '../app.css';

  let showSidebar = $state(false);
  let sidebarTab = $state<'files' | 'outline' | 'search'>('files');
  const typography = $derived(TYPOGRAPHY_PRESETS[$settings.typographyPreset]);
  let showSearchReplace = $state(false);
  let showSettings = $state(false);
  let showCommandPalette = $state(false);
  let showRecoveryCenter = $state(false);
  let showQuickOpen = $state(false);
  let workspaceCleanup = () => {};
  const paletteCommands = $derived([
    { id: 'newFile', label: '新建文档' },
    { id: 'openFile', label: '打开文件' },
    { id: 'quickOpen', label: '快速打开文件' },
    { id: 'reopenTab', label: '重新打开关闭的标签' },
    { id: 'navigateBack', label: '返回上一位置' },
    { id: 'navigateForward', label: '前往下一位置' },
    { id: 'recoveryCenter', label: '恢复中心：草稿与替换前版本' },
    { id: 'saveFile', label: '保存文档', disabled: !$activeSessionId },
    { id: 'saveAs', label: '另存为', disabled: !$activeSessionId },
    { id: 'print', label: '打印文档', disabled: !$activeSessionId },
    { id: 'find', label: '查找', disabled: !$activeSessionId },
    { id: 'replace', label: '替换', disabled: !$activeSessionId },
    { id: 'toggleSidebar', label: '切换文件侧栏' },
    { id: 'togglePreview', label: '切换分屏预览', disabled: !$activeSessionId },
    { id: 'toggleRead', label: '切换阅读模式', disabled: !$activeSessionId },
    { id: 'toggleTheme', label: '切换明暗主题' },
    { id: 'fullscreen', label: '切换全屏' },
    { id: 'focusMode', label: '专注模式' },
    { id: 'typewriterMode', label: '打字机模式' },
    { id: 'zoomIn', label: '放大显示' },
    { id: 'zoomOut', label: '缩小显示' },
    { id: 'zoomReset', label: '恢复 100% 显示' },
    { id: 'exportPdf', label: '导出 PDF', disabled: !$activeSessionId },
    { id: 'exportDefault', label: '快速导出', disabled: !$activeSessionId },
    { id: 'exportPrevious', label: '使用上次配置导出', disabled: !$activeSessionId },
    { id: 'exportPreview', label: '导出预览与设置', disabled: !$activeSessionId },
  ]);
  let searchMode = $state<'search' | 'replace'>('search');

  let splitRatio = $state(0.5);
  let isSplitResizing = $state(false);
  let stopSplitResize = () => {};
  let splitContainer: HTMLElement | null = $state(null);
  const MIN_SPLIT_RATIO = 0.2;
  const MAX_SPLIT_RATIO = 0.8;

  // 侧边栏宽度
  let sidebarWidth = $state(256); // 默认 16rem = 256px

  // 自动保存定时器
  let autoSaveTimer: ReturnType<typeof setInterval> | null = null;

  // 当文件路径变化时，设置图片解析目录
  $effect(() => {
    const file = $currentFile;
    if (file) {
      const sep = file.includes('\\') ? '\\' : '/';
      const parts = file.split(sep);
      parts.pop(); // 移除文件名
      setCurrentFileDir(parts.join(sep));
    }
  });

  let renderedContent = $state('');
  let renderedSessionId: string | null = null;

  $effect(() => {
    const source = $fileContent;
    const filePath = $currentFile;
    const sessionId = $activeSessionId;
    const previewVisible = $splitPreviewVisible || $editorMode === 'preview';
    if (!previewVisible) {
      renderedContent = '';
      renderedSessionId = null;
      return;
    }
    if (sessionId !== renderedSessionId) {
      renderedSessionId = sessionId;
      renderedContent = RenderService.render(source, { filePath });
      return;
    }

    const timer = window.setTimeout(() => {
      renderedContent = RenderService.render(source, { filePath });
    }, 70);
    return () => window.clearTimeout(timer);
  });

  let editorBasis = $derived($splitPreviewVisible ? `${(splitRatio * 100).toFixed(2)}%` : '100%');
  let previewBasis = $derived($isEditing ? `${((1 - splitRatio) * 100).toFixed(2)}%` : '100%');

  // 未保存检测：关闭窗口/刷新页面时提示
  function handleBeforeUnload(event: BeforeUnloadEvent) {
    const dirty = get(sessions).some(s => s.isDirty);
    if (dirty) {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  // Tauri 原生窗口关闭事件处理
  let closeHandlerCleanup: (() => void) | null = null;
  let closeInProgress = false;
  let fsChangeCleanup: (() => void) | null = null;
  let fsRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let watchedPathsKey = '';
  let watcherRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let watcherDirectory: string | null = null;
  let watcherSessionDirectories: string[] = [];
  let watcherUpdateInFlight = false;
  let fsSyncInFlight = false;
  let fsSyncDisposed = false;
  const pendingFsPaths = new Set<string>();

  async function setupTauriCloseHandler() {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const appWindow = getCurrentWindow();

      const unlisten = await appWindow.onCloseRequested(async (event) => {
        if (closeInProgress) {
          event.preventDefault();
          return;
        }
        const dirty = get(sessions).some(s => s.isDirty);

        // 没有未保存内容：不拦截，让原生窗口关闭流程继续执行。
        if (!dirty && !DocumentService.hasPendingOperations()) {
          WorkspaceSessionService.flush();
          if (unlisten) unlisten();
          return;
        }

        // 有未保存内容 → 拦截关闭，使用模态框确认
        event.preventDefault();

        closeInProgress = true;
        WorkspaceSessionService.pauseForClose();
        let destroyed = false;
        try {
          const closedAll = await DocumentService.closeAllSessionsWithPrompt();
          if (closedAll && get(sessions).length === 0) {
            WorkspaceSessionService.flush();
            await appWindow.destroy();
            destroyed = true;
            unlisten();
          }
        } finally {
          closeInProgress = false;
          WorkspaceSessionService.resume(destroyed);
        }
      });

      closeHandlerCleanup = unlisten;
    } catch (err) {
      console.error('Tauri Close Handler Error:', err);
    }
  }

  function normalizePath(path: string): string {
    const normalized = path.replace(/\\/g, '/');
    return /^[a-zA-Z]:\//.test(normalized) ? normalized.toLowerCase() : normalized;
  }

  function pathsAffectCurrentDirectory(paths: string[]): boolean {
    const directory = get(currentDirectory);
    if (!directory || paths.length === 0) return false;
    const directoryPath = normalizePath(directory).replace(/\/$/, '');
    return paths.some(path => {
      const changedPath = normalizePath(path);
      return pathContains(directoryPath, changedPath) || pathContains(changedPath, directoryPath);
    });
  }

  function scheduleDirectoryRefresh(paths: string[] = []) {
    if (fsSyncDisposed) return;
    paths.forEach(path => pendingFsPaths.add(path));
    if (fsRefreshTimer) clearTimeout(fsRefreshTimer);
    fsRefreshTimer = setTimeout(() => {
      fsRefreshTimer = null;
      void flushFileSystemChanges();
    }, 180);
  }

  async function flushFileSystemChanges() {
    if (fsSyncInFlight || fsSyncDisposed) return;
    fsSyncInFlight = true;
    try {
      do {
        const paths = [...pendingFsPaths];
        pendingFsPaths.clear();
        await Promise.all([
          pathsAffectCurrentDirectory(paths) ? refreshDirectory() : Promise.resolve(),
          paths.length > 0 ? syncExternallyChangedFiles(paths) : Promise.resolve(),
        ]);
        if (pathsAffectCurrentDirectory(paths)) WorkspaceIndex.invalidate();
      } while (pendingFsPaths.size > 0 && !fsSyncDisposed);
    } finally {
      fsSyncInFlight = false;
    }
  }

  async function syncExternallyChangedFiles(paths: string[]) {
    const normalizedChanges = paths.map(normalizePath);
    const list = get(sessions);

    for (const session of list) {
      if (!session.path) continue;
      const sessionPath = normalizePath(session.path);
      const affected = normalizedChanges.some(path => pathContains(path, sessionPath));
      if (!affected) continue;

      try {
        await DocumentService.waitForSessionOperations(session.id);
        const beforeRead = get(sessions).find(item => item.id === session.id);
        if (fsSyncDisposed || !beforeRead?.path) continue;
        const nextContent = await readNativeFile(beforeRead.fileHandle || beforeRead.path);
        await DocumentService.waitForSessionOperations(session.id);
        if (fsSyncDisposed) return;
        const latest = get(sessions).find(item => item.id === session.id);
        if (!latest) continue;
        if (latest.path !== beforeRead.path || latest.savedContent !== beforeRead.savedContent) {
          if (latest.path) pendingFsPaths.add(latest.path);
          continue;
        }
        if (latest.content === nextContent) {
          if (latest.isDirty || latest.externalModified) {
            refreshSessionFromDisk(latest.id, nextContent);
          }
          continue;
        }

        if (latest.isDirty) {
          markSessionExternalModified(latest.id, nextContent, false);
        } else {
          refreshSessionFromDisk(latest.id, nextContent);
        }
      } catch (err) {
        console.warn('Failed to sync externally changed file:', err);
        const latest = get(sessions).find(item => item.id === session.id);
        if (!fsSyncDisposed && latest?.path === session.path) {
          const failure = asFileError(err);
          markSessionExternalModified(session.id, undefined, failure.code === 'not_found',
            failure.code === 'not_found' ? undefined : failure.message);
        }
      }
    }
  }

  function parentDirectory(path: string): string {
    const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    return index > 0 ? path.slice(0, index) : '';
  }

  function queueWatcherRefresh() {
    if (!isTauri() || fsSyncDisposed) return;
    if (watcherRefreshTimer) clearTimeout(watcherRefreshTimer);
    watcherRefreshTimer = setTimeout(() => {
      watcherRefreshTimer = null;
      void applyWatcherPaths();
    }, 80);
  }

  async function applyWatcherPaths() {
    if (fsSyncDisposed) return;
    if (watcherUpdateInFlight) {
      queueWatcherRefresh();
      return;
    }
    watcherUpdateInFlight = true;
    const unique = new Map<string, WatchPath>();
    if (watcherDirectory) {
      unique.set(normalizePath(watcherDirectory), { path: watcherDirectory, recursive: true });
    }
    watcherSessionDirectories.forEach(path => {
      const normalized = normalizePath(path);
      const existing = unique.get(normalized);
      unique.set(normalized, { path, recursive: existing?.recursive ?? false });
    });
    const directoryKey = watcherDirectory ? normalizePath(watcherDirectory) : null;
    const paths = [...unique.entries()]
      .filter(([normalized]) => !directoryKey
        || normalized === directoryKey
        || !normalized.startsWith(`${directoryKey}/`))
      .map(([, target]) => target);
    const key = paths
      .map(target => `${normalizePath(target.path)}:${target.recursive ? 'r' : 'n'}`)
      .sort()
      .join('|');
    if (key === watchedPathsKey) {
      watcherUpdateInFlight = false;
      return;
    }

    try {
      if (paths.length === 0) {
        await unwatchDirectory();
        if (fsSyncDisposed) return;
        watchedPathsKey = '';
        return;
      }
      await watchPaths(paths);
      if (fsSyncDisposed) {
        await unwatchDirectory();
        return;
      }
      watchedPathsKey = key;
    } catch (err) {
      console.warn('Failed to update watched paths:', err);
    } finally {
      watcherUpdateInFlight = false;
    }
  }

  // 自动保存
  function startAutoSave() {
    if (autoSaveTimer) clearInterval(autoSaveTimer);
    const interval = Math.max(5, Number(get(settings).autoSaveInterval) || 30) * 1000;
    autoSaveTimer = setInterval(async () => {
      const activeId = get(activeSessionId);
      if (activeId) {
        const session = get(sessions).find(s => s.id === activeId);
        if (session && session.isDirty && (session.path || session.fileHandle) && !session.externalModified) {
          try {
            const saved = await DocumentService.autoSaveSession(activeId);
            if (saved && session.path) addRecentFile(session.path);
          } catch (err) {
            console.warn('Auto-save failed:', err);
          }
        }
      }
    }, interval);
  }

  function stopAutoSave() {
    if (autoSaveTimer) {
      clearInterval(autoSaveTimer);
      autoSaveTimer = null;
    }
  }

  // 最近文件列表
  const MAX_RECENT_FILES = 10;
  let recentFiles: string[] = $state([]);

  function loadRecentFiles() {
    try {
      const saved = localStorage.getItem('recentFiles');
      if (saved) recentFiles = JSON.parse(saved);
    } catch {}
  }

  function addRecentFile(path: string) {
    recentFiles = [path, ...recentFiles.filter(f => f !== path)].slice(0, MAX_RECENT_FILES);
    localStorage.setItem('recentFiles', JSON.stringify(recentFiles));
  }

  function persistSplitRatio() {
    try { localStorage.setItem('splitRatio', String(splitRatio)); }
    catch (error) { console.warn('Could not persist split ratio:', error); }
  }

  function adjustSplit(event: KeyboardEvent) {
    if (event.defaultPrevented || event.isComposing) return;
    const delta = event.shiftKey ? 0.1 : 0.025;
    const next = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? splitRatio - delta
      : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? splitRatio + delta
      : event.key === 'Home' ? MIN_SPLIT_RATIO : event.key === 'End' ? MAX_SPLIT_RATIO : event.key === 'Enter' ? 0.5 : null;
    if (next === null) return;
    event.preventDefault(); event.stopPropagation();
    splitRatio = Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, next)); persistSplitRatio();
  }

  function startSplitResize(event: PointerEvent) {
    if (!splitContainer || event.button !== 0) return;
    event.preventDefault(); stopSplitResize();
    if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus({ preventScroll: true });
    isSplitResizing = true;
    const rect = splitContainer.getBoundingClientRect();
    const startX = event.clientX;
    const startRatio = splitRatio;
    const pointerId = event.pointerId;
    if (!rect.width) { isSplitResizing = false; return; }

    function onMouseMove(e: PointerEvent) {
      if (e.pointerId !== pointerId) return;
      const delta = e.clientX - startX;
      const next = (startRatio * rect.width + delta) / rect.width;
      splitRatio = Math.max(MIN_SPLIT_RATIO, Math.min(MAX_SPLIT_RATIO, next));
    }

    function onMouseUp(event?: Event) {
      if (event instanceof PointerEvent && event.pointerId !== pointerId) return;
      isSplitResizing = false;
      persistSplitRatio();
      window.removeEventListener('pointermove', onMouseMove);
      window.removeEventListener('pointerup', onMouseUp);
      window.removeEventListener('pointercancel', onMouseUp);
      window.removeEventListener('blur', onMouseUp);
      stopSplitResize = () => {};
    }

    stopSplitResize = onMouseUp;
    window.addEventListener('pointermove', onMouseMove);
    window.addEventListener('pointerup', onMouseUp);
    window.addEventListener('pointercancel', onMouseUp);
    window.addEventListener('blur', onMouseUp);
  }

  // 初始化
  onMount(() => {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    theme.set(savedTheme as 'light' | 'dark');

    // 初始化主题预设
    initThemePreset();

    // 加载自定义颜色
    const root = document.documentElement;
    const customAccent = localStorage.getItem('customAccentColor');
    if (customAccent) root.style.setProperty('--accent-color', customAccent);
    const customBg = localStorage.getItem('customBgPrimary');
    if (customBg) root.style.setProperty('--bg-primary', customBg);
    const customBg2 = localStorage.getItem('customBgSecondary');
    if (customBg2) root.style.setProperty('--bg-secondary', customBg2);
    const customText = localStorage.getItem('customTextPrimary');
    if (customText) root.style.setProperty('--text-primary', customText);
    const customFont = localStorage.getItem('customFontContent');
    if (customFont) root.style.setProperty('--font-content', customFont);

    // 加载侧边栏宽度
    const savedWidth = localStorage.getItem('sidebarWidth');
    if (savedWidth) {
      const width = Number(savedWidth);
      if (Number.isFinite(width)) sidebarWidth = Math.min(560, Math.max(180, width));
    }

    const savedSplit = localStorage.getItem('splitRatio');
    if (savedSplit) {
      const ratio = Number(savedSplit);
      if (Number.isFinite(ratio)) splitRatio = Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, ratio));
    }

    // 加载自动保存设置
    const unsubscribeAutoSave = settings.subscribe(($settings) => {
      if ($settings.autoSave) {
        startAutoSave();
      } else {
        stopAutoSave();
      }
    });

    // 加载最近文件
    loadRecentFiles();

    const initialFile = new URL(window.location.href).searchParams.get('file');
    if (initialFile) void DocumentService.openPath(initialFile);
    void WorkspaceSessionService.start(!!initialFile).then(cleanup => {
      if (fsSyncDisposed) cleanup(); else workspaceCleanup = cleanup;
    }).catch(error => console.warn('Workspace startup failed:', error));

    // 未保存检测（浏览器 beforeunload）
    if (!isTauri()) {
      window.addEventListener('beforeunload', handleBeforeUnload);
    }

    // Tauri 原生窗口关闭事件
    if (isTauri()) {
      setupTauriCloseHandler();
      onFsChange((event) => {
        if (event.rename) {
          const { from, to } = event.rename;
          const directory = get(currentDirectory);
          renameSessionPaths(from, to);
          if (directory && pathContains(from, directory)) currentDirectory.set(replacePathPrefix(directory, from, to));
        }
        scheduleDirectoryRefresh(event.paths || []);
      }).then((unlisten) => {
        if (fsSyncDisposed) unlisten();
        else fsChangeCleanup = unlisten;
      }).catch((err) => {
        console.warn('Failed to listen for file system changes:', err);
      });
    }

    let lastFocusSync = 0;
    const syncOnFocus = () => {
      if (!isTauri() || fsSyncDisposed || document.visibilityState === 'hidden'
        || Date.now() - lastFocusSync < 1000) return;
      lastFocusSync = Date.now();
      scheduleDirectoryRefresh([
        ...get(sessions).flatMap(session => session.path ? [session.path] : []),
        ...(get(currentDirectory) ? [get(currentDirectory)!] : []),
      ]);
    };
    window.addEventListener('focus', syncOnFocus);
    document.addEventListener('visibilitychange', syncOnFocus);

    const unsubscribeDirectory = currentDirectory.subscribe((path) => {
      watcherDirectory = path;
      queueWatcherRefresh();
    });
    const unsubscribeWatcherSessions = sessions.subscribe((list) => {
      const directories = list
        .map(session => session.path ? parentDirectory(session.path) : '')
        .filter(Boolean);
      const nextKey = directories.map(normalizePath).sort().join('|');
      const currentKey = watcherSessionDirectories.map(normalizePath).sort().join('|');
      if (nextKey === currentKey) return;
      watcherSessionDirectories = directories;
      queueWatcherRefresh();
    });

    // 处理文件拖放
    document.addEventListener('drop', handleDrop);
    document.addEventListener('dragover', handleDragOver);

    // 注册快捷键服务回调
    const commandCleanups: Array<() => void> = [];
    const registerCommand = (id: string, handler: () => void | Promise<void>) => {
      const needsDocument = ['saveFile', 'saveAs', 'print', 'find', 'replace', 'togglePreview', 'toggleRead', 'closeTab'];
      commandCleanups.push(CommandService.register(id, handler, {
        label: paletteCommands.find(command => command.id === id)?.label,
        enabled: () => !needsDocument.includes(id) || !!get(activeSessionId),
        checked: id === 'toggleSidebar' ? () => showSidebar : id === 'togglePreview' ? () => get(splitPreviewVisible)
          : id === 'toggleRead' ? () => get(editorMode) === 'preview' : id === 'focusMode' ? () => get(focusMode)
          : id === 'typewriterMode' ? () => get(typewriterMode) : undefined,
        unavailable: '请先打开或新建文档。',
      }));
      commandCleanups.push(ShortcutService.register(id, () => CommandService.execute(id)));
    };
    registerCommand('newFile', () => {
      DocumentService.createNewSession('未命名.md');
    });
    registerCommand('quickOpen', () => { showQuickOpen = true; });
    registerCommand('nextTab', () => cycleSession(1));
    registerCommand('previousTab', () => cycleSession(-1));
    registerCommand('reopenTab', () => DocumentService.reopenClosedSession());
    registerCommand('closeTab', async () => { const id = get(activeSessionId); if (id) await DocumentService.closeSessionWithPrompt(id); });
    registerCommand('navigateBack', () => NavigationService.travel('back'));
    registerCommand('navigateForward', () => NavigationService.travel('forward'));
    registerCommand('openFile', async () => {
      const id = await DocumentService.openFile();
      if (id) {
        const s = get(sessions).find(x => x.id === id);
        if (s && s.path) addRecentFile(s.path);
      }
    });
    registerCommand('saveFile', async () => {
      const activeId = get(activeSessionId);
      if (activeId) {
        const saved = await DocumentService.saveSession(activeId);
        const s = get(sessions).find(x => x.id === activeId);
        if (saved && s && s.path) addRecentFile(s.path);
      }
    });
    registerCommand('saveAs', async () => {
      const activeId = get(activeSessionId);
      if (activeId) {
        const saved = await DocumentService.saveSessionAs(activeId);
        const s = get(sessions).find(x => x.id === activeId);
        if (saved && s && s.path) addRecentFile(s.path);
      }
    });
    registerCommand('toggleSidebar', toggleSidebar);
    registerCommand('openFolder', async () => { await WorkspaceService.openFolder(); });
    registerCommand('focusMode', () => focusMode.update(value => !value));
    registerCommand('typewriterMode', () => typewriterMode.update(value => !value));
    for (const [id, mode] of [['modeWrite', 'wysiwym'], ['modeSource', 'source'], ['modeRead', 'preview']] as const) {
      commandCleanups.push(CommandService.register(id, () => selectDocumentMode(mode), {
        enabled: () => !!get(activeSessionId), checked: () => get(editorMode) === mode,
      }));
    }
    registerCommand('zoomIn', () => updateSettings({ displayZoom: get(settings).displayZoom + 10 }));
    registerCommand('zoomOut', () => updateSettings({ displayZoom: get(settings).displayZoom - 10 }));
    registerCommand('zoomReset', () => updateSettings({ displayZoom: 100 }));
    registerCommand('togglePreview', () => {
      toggleSplitPreview();
    });
    registerCommand('toggleRead', () => {
      toggleReadMode();
    });
    registerCommand('fullscreen', async () => {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    });
    registerCommand('print', () => CommandService.execute('printDocument'));
    registerCommand('toggleTheme', () => {
      toggleTheme();
    });
    registerCommand('exit', async () => {
      if (isTauri()) {
        try {
          const { getCurrentWindow } = await import('@tauri-apps/api/window');
          const appWindow = getCurrentWindow();
          await appWindow.close(); // 这将触发 setupTauriCloseHandler
        } catch (err) {
          console.warn('Failed to close window via keyboard shortcut:', err);
        }
      } else {
        const closedAll = await DocumentService.closeAllSessionsWithPrompt();
        if (closedAll) window.close();
      }
    });
    registerCommand('find', () => {
      searchMode = 'search';
      showSearchReplace = true;
    });
    registerCommand('replace', () => {
      searchMode = 'replace';
      showSearchReplace = true;
    });
    registerCommand('commandPalette', () => {
      showCommandPalette = true;
    });
    registerCommand('settings', () => {
      showSettings = true;
    });
    registerCommand('recoveryCenter', () => {
      showRecoveryCenter = true;
    });

    // 检查是否有异常退出的恢复快照
    const snapshots = RecoveryService.getSnapshots();
    let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
    if (snapshots.length > 0) {
      recoveryTimer = setTimeout(() => {
        if (fsSyncDisposed) return;
        showRecoveryCenter = true;
      }, 500);
    }

    return () => {
      WorkspaceSessionService.dispose();
      workspaceCleanup();
      commandCleanups.forEach(cleanup => cleanup());
      if (recoveryTimer) clearTimeout(recoveryTimer);
      window.removeEventListener('focus', syncOnFocus);
      document.removeEventListener('visibilitychange', syncOnFocus);
      document.removeEventListener('drop', handleDrop);
      document.removeEventListener('dragover', handleDragOver);
      if (!isTauri()) {
        window.removeEventListener('beforeunload', handleBeforeUnload);
      }
      stopAutoSave();
      stopSplitResize();
      unsubscribeAutoSave();
      unsubscribeDirectory();
      unsubscribeWatcherSessions();
      fsSyncDisposed = true;
      pendingFsPaths.clear();
      if (watcherRefreshTimer) {
        clearTimeout(watcherRefreshTimer);
        watcherRefreshTimer = null;
      }
      if (isTauri() && watchedPathsKey) {
        void unwatchDirectory();
        watchedPathsKey = '';
      }
      if (fsRefreshTimer) {
        clearTimeout(fsRefreshTimer);
        fsRefreshTimer = null;
      }
      if (fsChangeCleanup) {
        fsChangeCleanup();
        fsChangeCleanup = null;
      }
      // 清理 Tauri 关闭事件监听器
      if (closeHandlerCleanup) {
        closeHandlerCleanup();
        closeHandlerCleanup = null;
      }
    };
  });

  // 切换侧边栏
  function toggleSidebar() {
    const restore = showSidebar && document.activeElement instanceof Element && !!document.activeElement.closest('.sidebar-drawer');
    showSidebar = !showSidebar;
    if (restore) void tick().then(() => document.querySelector<HTMLButtonElement>('[aria-label="显示侧栏"]')?.focus());
  }

  // 切换预览
  function togglePreview() {
    toggleSplitPreview();
  }

  // 切换自动保存
  function toggleAutoSave() {
    const currentAutoSave = get(settings).autoSave;
    settings.update(s => ({ ...s, autoSave: !currentAutoSave }));
    localStorage.setItem('autoSave', String(!currentAutoSave));
  }

  // 处理文件拖放
  async function handleDrop(event: DragEvent) {
    event.preventDefault();

    const items = event.dataTransfer?.items;
    if (!items) return;

    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file && (file.name.endsWith('.md') || file.name.endsWith('.txt') || file.name.endsWith('.markdown'))) {
          const content = await file.text();
          // Web drag data does not prove a durable filesystem identity. Import a dirty copy.
          createSession(file.name, null, content, '');
          break;
        }
      }
    }
  }

  function handleDragOver(event: DragEvent) {
    event.preventDefault();
  }
</script>


<div
  class="app-shell"
  data-typography={$settings.typographyPreset}
  style="--reader-font-size: {$settings.fontSize * $settings.displayZoom / 100}px; --reader-line-height: {$settings.lineHeight}; --font-content: {$settings.customFontContent || typography.font}; --doc-content-width: {$settings.contentWidth * $settings.displayZoom / 100}px; --doc-h1-size: {typography.h1}em; --doc-h2-size: {typography.h2}em; --doc-paragraph-gap: {typography.paragraphGap}em;"
>
  <!-- 工具栏 -->
  <Toolbar
    {showSidebar}
    showPreview={$splitPreviewVisible}
    {recentFiles}
    autoSaveEnabled={$settings.autoSave}
    onToggleSidebar={toggleSidebar}
    onTogglePreview={togglePreview}
    onToggleTheme={toggleTheme}
    onToggleAutoSave={toggleAutoSave}
    onOpenSettings={() => showSettings = true}
  />
  <QuickOpen bind:visible={showQuickOpen} {recentFiles} />

  <!-- 主内容区 -->
  <div class="workspace-stage">
    <!-- 侧边栏抽屉 -->
    {#if showSidebar}
      <button class="sidebar-scrim" type="button" aria-label="关闭侧栏遮罩" tabindex="-1" onclick={toggleSidebar}></button>
      <aside
        class="sidebar-drawer sidebar-dock"
        style="--drawer-width: {sidebarWidth}px"
        aria-label="文档侧栏"
      >
				<button type="button" class="sidebar-close-button" onclick={toggleSidebar} aria-label="隐藏侧栏">
          ×
        </button>
        <div class="sidebar-drawer-body">
          <Sidebar bind:activeTab={sidebarTab} />
        </div>
      </aside>
    {/if}

    <!-- 编辑区 -->
    <div class="document-workspace">
    <TabBar />
    <main class="editor-stage" bind:this={splitContainer}>
      <!-- 搜索替换面板 -->
      <SearchReplace bind:visible={showSearchReplace} mode={searchMode} />

      {#if $isEditing}
        <div
          class="editor-pane"
          class:mode-hidden={$editorMode === 'preview'}
          aria-hidden={$editorMode === 'preview'}
          style="flex: 0 0 {editorBasis};"
        >
          <Editor />
        </div>
      {/if}

      {#if $isEditing && $splitPreviewVisible && $editorMode !== 'preview'}
        <input
          type="range"
          class="split-handle"
          class:active={isSplitResizing}
          onpointerdown={startSplitResize}
          onkeydown={adjustSplit}
          oninput={event => { splitRatio = event.currentTarget.valueAsNumber / 100; persistSplitRatio(); }}
          ondblclick={() => { splitRatio = 0.5; persistSplitRatio(); }}
          min={MIN_SPLIT_RATIO * 100}
          max={MAX_SPLIT_RATIO * 100}
          value={splitRatio * 100}
          step="any"
          aria-valuetext={`编辑 ${Math.round(splitRatio * 100)}%，预览 ${Math.round((1 - splitRatio) * 100)}%`}
          aria-orientation="horizontal"
          aria-label="调整编辑与预览比例"
          title="拖动或用方向键调整分屏，Enter 或双击居中"
        />
      {/if}

      {#if $splitPreviewVisible || $editorMode === 'preview'}
        <div
          class="preview-pane overflow-auto"
          class:read-mode={$editorMode === 'preview'}
          style="flex: 1 1 {previewBasis};"
        >
          <Preview content={renderedContent} showFloatingOutline={!showSidebar || sidebarTab !== 'outline'} />
        </div>
      {/if}
      {#if !$isEditing}
        <section class="welcome-page" aria-label="开始写作">
          <h1>Reader</h1>
          <p>专注内容，从一页空白开始。</p>
          <div class="welcome-actions">
            <button onclick={() => CommandService.execute('newFile')}>新建文档 <kbd>Ctrl N</kbd></button>
            <button onclick={() => CommandService.execute('openFile')}>打开文件 <kbd>Ctrl O</kbd></button>
            <button onclick={() => WorkspaceService.openFolder()}>打开文件夹</button>
            <button onclick={() => CommandService.execute('quickOpen')}>快速打开 <kbd>Ctrl Shift O</kbd></button>
          </div>
        </section>
      {/if}
    </main>
    </div>
  </div>

  <!-- 状态栏 -->
  <StatusBar />
</div>

<!-- 设置界面 -->
<SettingsComponent bind:visible={showSettings} />
<RecoveryCenter bind:visible={showRecoveryCenter} />
<CommandPalette bind:visible={showCommandPalette} commands={paletteCommands} />
<InteractionHost />
<ResourceInspector />

<!-- 未保存更改确认框 -->
{#if $closeConfirmDialog}
  <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-[250]" onclick={() => $closeConfirmDialog?.onResolve('cancel')} role="button" tabindex="-1" onkeydown={(e) => e.key === 'Escape' && ($closeConfirmDialog?.onResolve('cancel'))}>
    <div class="save-confirm-dialog" use:dialogFocus={{ close: () => $closeConfirmDialog?.onResolve('cancel') }}
      onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="未保存变更" tabindex="-1" onkeydown={(e) => {}}>
      <h3 class="text-lg font-semibold text-[var(--text-primary)] mb-2">未保存的变更</h3>
      <p class="text-sm text-[var(--text-secondary)] mb-4">
        文件 "{$closeConfirmDialog.fileName}" 已被修改，是否保存？
      </p>
      <div class="flex justify-end gap-2">
        <button
          class="px-4 py-2 bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] text-[var(--text-primary)] rounded-md transition-colors"
          onclick={() => $closeConfirmDialog?.onResolve('cancel')}
        >
          取消
        </button>
        <button
          class="px-4 py-2 bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] text-[var(--text-primary)] rounded-md transition-colors"
          onclick={() => $closeConfirmDialog?.onResolve('dontsave')}
        >
          不保存
        </button>
        <button
          class="px-4 py-2 bg-[var(--accent-color)] hover:bg-[var(--accent-hover)] text-white rounded-md transition-colors"
          onclick={() => $closeConfirmDialog?.onResolve('save')}
        >
          保存
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .save-confirm-dialog { width: min(420px, calc(100vw - 32px)); padding: 24px; background: var(--ui-panel-active); color: var(--ui-text); border: 1px solid var(--ui-border); border-radius: 6px; box-shadow: var(--ui-shadow-popover); }
  .app-shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
    background: var(--ui-bg);
  }

  .workspace-stage {
    position: relative;
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    background: var(--doc-bg);
  }
  .document-workspace { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }
  .sidebar-scrim { display: none; }
  .welcome-page { width: min(460px, 80%); margin: auto; padding-bottom: 8vh; }
  .welcome-page h1 { font-size: 34px; font-weight: 600; color: var(--doc-text); letter-spacing: -1px; }
  .welcome-page p { margin: 10px 0 28px; color: var(--ui-text-muted); }
  .welcome-actions { display: grid; gap: 4px; }
  .welcome-actions button { text-align: left; display: flex; justify-content: space-between; border: 0; background: transparent; padding: 10px 12px; border-radius: 3px; cursor: pointer; }
  .welcome-actions button:hover { background: var(--ui-panel-hover); }
  .welcome-actions kbd { color: var(--ui-text-muted); font-size: 12px; }

  .editor-stage {
    position: relative;
    display: flex;
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--doc-paper-bg, var(--doc-bg));
  }

  .sidebar-drawer {
    position: relative;
    z-index: 20;
    width: clamp(236px, var(--drawer-width), 276px);
    min-width: 236px;
    max-width: 276px;
    height: 100%;
    flex: 0 0 clamp(236px, var(--drawer-width), 276px);
    overflow: hidden;
    border-right: 1px solid color-mix(in srgb, var(--ui-border) 58%, transparent);
    background: var(--ui-panel);
  }

  .sidebar-close-button {
    position: absolute;
    z-index: 2;
    right: 8px;
    top: 6px;
    height: 28px;
    width: 28px;
    border: 0;
    border-radius: 4px;
    padding: 0 6px;
    background: transparent;
    color: var(--ui-text-muted);
    font-size: 20px;
    cursor: pointer;
    opacity: 0.52;
  }

  .sidebar-drawer:hover .sidebar-close-button,
  .sidebar-close-button:focus-visible {
    opacity: 1;
  }

  .sidebar-close-button:hover,
  .sidebar-close-button:focus-visible {
    background: color-mix(in srgb, var(--ui-panel-hover) 72%, transparent);
    color: var(--ui-text);
  }

  .sidebar-drawer-body {
    height: 100%;
    min-height: 0;
  }

  .split-handle {
    appearance: none;
    width: 6px;
    min-width: 6px;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 0;
    align-self: stretch;
    cursor: col-resize;
    touch-action: none;
    background: transparent;
    transition: background 0.12s;
    flex-shrink: 0;
  }

  .split-handle::-webkit-slider-thumb { appearance: none; width: 0; height: 0; }
  .split-handle::-moz-range-thumb { width: 0; height: 0; border: 0; }
  .split-handle::-moz-range-track { background: transparent; }

  .split-handle:hover,
  .split-handle:focus-visible,
  .split-handle.active {
    background: color-mix(in srgb, var(--ui-border) 72%, var(--ui-panel-hover));
  }



  .editor-pane.mode-hidden {
    position: absolute;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    visibility: hidden;
  }

  .editor-pane {
    display: flex;
    min-width: 0;
    min-height: 0;
    flex-direction: column;
    overflow: hidden;
    background: var(--doc-paper-bg, var(--doc-bg));
  }

  .preview-pane {
    min-width: 0;
    min-height: 0;
    border-left: 1px solid color-mix(in srgb, var(--border-color) 42%, transparent);
  }

  .preview-pane.read-mode {
    border-left: 0;
    background: var(--doc-bg);
  }
  @media (max-width: 760px) {
    .sidebar-drawer { position: absolute; inset: 0 auto 0 0; z-index: 32; width: min(276px, calc(100vw - 48px)); min-width: 0; max-width: none; box-shadow: 4px 0 18px #0002; }
    .sidebar-scrim { display: block; position: absolute; inset: 0; z-index: 31; border: 0; background: #0003; cursor: default; }
  }
</style>
