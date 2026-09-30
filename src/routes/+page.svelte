<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { theme, toggleTheme } from '$lib/stores/theme';
  import { initThemePreset } from '$lib/themes';
  import { currentFile, fileContent, isEditing } from '$lib/stores/document';
  import { setCurrentFileDir } from '$lib/utils/markdown';
  import { isTauri } from '$lib/utils/platform';
  import { pathContains, normalizePathKey, replacePathPrefix } from '$lib/utils/path';
  import { asFileError } from '$lib/utils/file-error';
  import { sessions, activeSessionId, createSession, refreshSessionFromDisk, markSessionExternalModified, renameSessionPaths } from '$lib/stores/document';
  import { currentDirectory, refreshDirectory } from '$lib/stores/file';
  import { readFile as readNativeFile, watchPaths, unwatchDirectory, onFsChange, type WatchPath } from '$lib/utils/native-fs';
  import { DocumentService, closeConfirmDialog } from '$lib/services/document';
  import { settings } from '$lib/stores/settings';
  import { ShortcutService } from '$lib/services/shortcut';
  import { RecoveryService } from '$lib/services/recovery';
  import { RenderService } from '$lib/services/render';
  import { CommandService } from '$lib/services/command';
  import { editorMode, splitPreviewVisible, toggleReadMode, toggleSplitPreview } from '$lib/stores/ui';
  import Toolbar from '$lib/components/Toolbar.svelte';
  import TabBar from '$lib/components/TabBar.svelte';
  import Sidebar from '$lib/components/Sidebar.svelte';
  import Editor from '$lib/components/Editor.svelte';
  import Preview from '$lib/components/Preview.svelte';
  import StatusBar from '$lib/components/StatusBar.svelte';
  import SearchReplace from '$lib/components/SearchReplace.svelte';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import SettingsComponent from '$lib/components/Settings.svelte';
  import CommandPalette from '$lib/components/CommandPalette.svelte';
  import '../app.css';

  let showSidebar = $state(false);
  let showSearchReplace = $state(false);
  let showSettings = $state(false);
  let showCommandPalette = $state(false);
  const paletteCommands = $derived([
    { id: 'newFile', label: '新建文档' },
    { id: 'openFile', label: '打开文件' },
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
  ]);
  let searchMode = $state<'search' | 'replace'>('search');

  let splitRatio = $state(0.5);
  let isSplitResizing = $state(false);
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
          if (unlisten) unlisten();
          return;
        }

        // 有未保存内容 → 拦截关闭，使用模态框确认
        event.preventDefault();

        closeInProgress = true;
        try {
          const closedAll = await DocumentService.closeAllSessionsWithPrompt();
          if (closedAll && get(sessions).length === 0) {
            await appWindow.destroy();
            unlisten();
          }
        } finally {
          closeInProgress = false;
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

  function startSplitResize(event: MouseEvent) {
    if (!splitContainer) return;
    isSplitResizing = true;
    const rect = splitContainer.getBoundingClientRect();
    const startX = event.clientX;
    const startRatio = splitRatio;

    function onMouseMove(e: MouseEvent) {
      const delta = e.clientX - startX;
      const next = (startRatio * rect.width + delta) / rect.width;
      splitRatio = Math.max(MIN_SPLIT_RATIO, Math.min(MAX_SPLIT_RATIO, next));
    }

    function onMouseUp() {
      isSplitResizing = false;
      localStorage.setItem('splitRatio', String(splitRatio));
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
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
    if (savedWidth) sidebarWidth = parseInt(savedWidth);

    const savedSplit = localStorage.getItem('splitRatio');
    if (savedSplit) splitRatio = parseFloat(savedSplit);

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
      commandCleanups.push(CommandService.register(id, handler));
      commandCleanups.push(ShortcutService.register(id, () => CommandService.execute(id)));
    };
    registerCommand('newFile', () => {
      DocumentService.createNewSession('未命名.md');
    });
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
    registerCommand('toggleSidebar', () => {
      showSidebar = !showSidebar;
    });
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

    // 检查是否有异常退出的恢复快照
    const snapshots = RecoveryService.getSnapshots();
    let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
    if (snapshots.length > 0) {
      recoveryTimer = setTimeout(async () => {
        if (fsSyncDisposed) return;
        let confirmRestore = false;
        try {
          const { ask } = await import('@tauri-apps/plugin-dialog');
          confirmRestore = await ask('检测到上次未正常关闭，是否恢复未保存的工作区内容？', {
            title: '恢复工作区',
            kind: 'info',
            okLabel: '恢复',
            cancelLabel: '忽略',
          });
        } catch {
          confirmRestore = confirm('检测到上次未正常关闭，是否恢复未保存的工作区内容？');
        }

        if (fsSyncDisposed) return;
        if (confirmRestore) {
          let failed = 0;
          snapshots.forEach(s => {
            const alreadyOpen = s.path && get(sessions).some(item => item.path
              && normalizePathKey(item.path) === normalizePathKey(s.path!));
            const sid = createSession(alreadyOpen ? `${s.name} (恢复副本)` : s.name,
              alreadyOpen ? null : s.path, s.content, s.savedContent);
            sessions.update(list => list.map(x => x.id === sid ? { ...x, cursorOffset: s.cursorOffset, scrollTop: s.scrollTop } : x));
            const restored = get(sessions).find(item => item.id === sid);
            if (restored && RecoveryService.saveSnapshot(restored)) {
              if (s.id !== sid) RecoveryService.removeSnapshot(s.id);
            } else failed++;
          });
          if (failed) alert('部分恢复内容未能重新写入恢复存储，旧快照已保留，请尽快另存文件。');
        }
        // Ignoring recovery is not an instruction to delete unsaved work.
      }, 500);
    }

    return () => {
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
    showSidebar = !showSidebar;
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


<div
  class="app-shell"
  style="--reader-font-size: {$settings.fontSize}px; --reader-line-height: {$settings.lineHeight};"
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

  <!-- 标签页栏 -->
  <TabBar />



  <!-- 主内容区 -->
  <div class="workspace-stage">
    <!-- 侧边栏抽屉 -->
    {#if showSidebar}
      <aside
        class="sidebar-drawer sidebar-dock"
        style="--drawer-width: {sidebarWidth}px"
        aria-label="Files sidebar"
      >
				<button type="button" class="sidebar-close-button" onclick={toggleSidebar} aria-label="Hide library sidebar">
          Hide
        </button>
        <div class="sidebar-drawer-body">
          <Sidebar />
        </div>
      </aside>
    {/if}

    <!-- 编辑区 -->
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
          <Breadcrumb />
          <Editor />
        </div>
      {/if}

      {#if $isEditing && $splitPreviewVisible && $editorMode !== 'preview'}
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div
          class="split-handle"
          class:active={isSplitResizing}
          onmousedown={startSplitResize}
          role="separator"
          aria-orientation="vertical"
          aria-label="调整编辑与预览比例"
        ></div>
      {/if}

      {#if $splitPreviewVisible || $editorMode === 'preview'}
        <div
          class="preview-pane overflow-auto"
          class:read-mode={$editorMode === 'preview'}
          style="flex: 1 1 {previewBasis};"
        >
          <Preview content={renderedContent} />
        </div>
      {/if}
    </main>
  </div>

  <!-- 状态栏 -->
  <StatusBar />
</div>

<!-- 设置界面 -->
<SettingsComponent bind:visible={showSettings} />
<CommandPalette bind:visible={showCommandPalette} commands={paletteCommands} />

<!-- 未保存更改确认框 -->
{#if $closeConfirmDialog}
  <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-[250]" onclick={() => $closeConfirmDialog?.onResolve('cancel')} role="button" tabindex="-1" onkeydown={(e) => e.key === 'Escape' && ($closeConfirmDialog?.onResolve('cancel'))}>
    <div class="bg-[var(--bg-primary)] rounded-lg shadow-xl p-6 w-96 border border-[var(--border-color)]" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="未保存变更" tabindex="-1" onkeydown={(e) => {}}>
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
          class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md transition-colors"
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
    height: 22px;
    border: 0;
    border-radius: 4px;
    padding: 0 6px;
    background: transparent;
    color: var(--ui-text-muted);
    font-size: 10px;
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
    width: 3px;
    cursor: col-resize;
    background: transparent;
    transition: background 0.12s;
    flex-shrink: 0;
  }

  .split-handle:hover,
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
</style>
