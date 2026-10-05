<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { get } from 'svelte/store';
  import { fileTree, toggleNode, loadNodeChildren, currentDirectory, currentDirectoryHandle, directoryName, refreshDirectory } from '$lib/stores/file';
  import {
    currentFile,
    activeSessionId,
  } from '$lib/stores/document';
  import { isFileSystemAccessSupported, renameItem, deleteItem } from '$lib/utils/native-fs';
  import { isTauri } from '$lib/utils/platform';
  import FileTree from './FileTree.svelte';
  import Outline from './Outline.svelte';
  import GlobalFileSearch from './GlobalFileSearch.svelte';

  import { WorkspaceService } from '$lib/services/workspace';
  import { renameSessionPaths } from '$lib/stores/document';
  import { DocumentService } from '$lib/services/document';
  import { joinPath, parentPath } from '$lib/utils/path';
  import { filterFileTree } from '$lib/utils/file-tree-filter';
  import { notify } from '$lib/services/interaction';
  import { WorkspaceIndex } from '$lib/services/workspace-index';

  let searchQuery = $state('');
  let showFileSearch = $state(false);
  let isRefreshing = $state(false);
  let filterInput: HTMLInputElement | undefined = $state();
  let collapsedMatches = $state<Set<string>>(new Set());
  const filteredTree = $derived(filterFileTree($fileTree, searchQuery, collapsedMatches));
  $effect(() => { void searchQuery; collapsedMatches = new Set(); });
  let openRevision = 0;
  onDestroy(() => { openRevision++; });
  $effect(() => { void $currentDirectory; void $currentDirectoryHandle; searchQuery = ''; openRevision++; });

  // 侧边栏选项卡
  type SidebarTab = 'files' | 'outline' | 'search';
  let { activeTab = $bindable('files') }: { activeTab?: SidebarTab } = $props();

  function switchTab(tab: SidebarTab) {
    activeTab = tab;
  }
  function navigateTabs(event: KeyboardEvent) {
    const tabs: SidebarTab[] = ['files', 'outline', 'search'];
    const index = tabs.indexOf(activeTab);
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
    if (next < 0 || !(event.target instanceof Element) || event.target.getAttribute('role') !== 'tab') return;
    event.preventDefault(); switchTab(tabs[next]);
    document.getElementById(`sidebar-tab-${tabs[next]}`)?.focus();
  }
  function toggleFilter() {
    if (showFileSearch) { searchQuery = ''; showFileSearch = false; }
    else { showFileSearch = true; void tick().then(() => filterInput?.focus()); }
  }
  async function refreshFiles() {
    if (isRefreshing) return;
    isRefreshing = true;
    try { await refreshDirectory(); WorkspaceIndex.invalidate(); } finally { isRefreshing = false; }
  }
  function toggleFilteredNode(node: Parameters<typeof toggleNode>[0]) {
    if (!searchQuery.trim()) { toggleNode(node); return; }
    const next = new Set(collapsedMatches);
    if (next.has(node.path)) next.delete(node.path); else next.add(node.path);
    collapsedMatches = next;
  }

  // 大纲点击跳转
  function handleHeadingClick(line: number) {
    // 通知父组件滚动到对应行
    // 这里可以通过 dispatch 或 store 来实现
    const event = new CustomEvent('heading-click', { detail: { line } });
    window.dispatchEvent(event);
  }

  // 打开文件夹
  async function openFolder() {
    if (!isTauri() && !isFileSystemAccessSupported()) {
      notify('您的浏览器不支持打开文件夹，请使用 Chrome/Edge 或拖放文件到编辑器。');
      return;
    }

    await WorkspaceService.openFolder();
  }

  // 打开文件
  async function openFile(path: string, line?: number) {
    const request = ++openRevision;
    const root = get(currentDirectory);
    const handle = get(currentDirectoryHandle);
    const origin = get(activeSessionId);
    const stillCurrent = () => request === openRevision && root === get(currentDirectory)
      && handle === get(currentDirectoryHandle) && origin === get(activeSessionId);
    const fullPath = isTauri() && root && !/^[a-zA-Z]:[\\/]|^[\\/]/.test(path) ? joinPath(root, path) : path;
    const id = await DocumentService.openPath(fullPath, stillCurrent);
    if (!id || request !== openRevision || id !== get(activeSessionId) || !line) return;
    await tick();
    if (request === openRevision && id === get(activeSessionId)) {
      window.dispatchEvent(new CustomEvent('heading-click', { detail: { sessionId: id, line } }));
    }
  }

  async function findDirectoryHandle(path: string): Promise<FileSystemDirectoryHandle | null> {
    let current = $currentDirectoryHandle;
    if (!current || !path) return current;
    for (const part of path.replace(/\\/g, '/').split('/').filter(Boolean)) {
      try {
        current = await current.getDirectoryHandle(part);
      } catch {
        return null;
      }
    }
    return current;
  }

  // 重命名文件/目录
  async function handleRename(oldPath: string, newName: string, isDirectory: boolean) {
    try {
      const oldName = oldPath.split(/[/\\]/).pop() || oldPath;
      const parentDir = parentPath(oldPath);
      const newPath = parentDir ? joinPath(parentDir, newName) : newName;

      if (isTauri()) {
        await renameItem(parentDir, oldName, newName);
      } else {
        if (isDirectory) {
          throw new Error('浏览器模式暂不支持重命名文件夹，请使用桌面版完成此操作');
        }
        const parentHandle = await findDirectoryHandle(parentDir);
        if (!parentHandle) throw new Error(`找不到父目录: ${parentDir}`);
        await renameItem(parentHandle, oldName, newName);
      }
      renameSessionPaths(oldPath, newPath);
      await refreshDirectory();
      WorkspaceIndex.invalidate();
    } catch (error: any) {
      console.error('Failed to rename:', error);
      notify('重命名失败: ' + error.message);
    }
  }

  // 删除文件/目录
  async function handleDelete(path: string, permanent: boolean, isDirectory: boolean) {
    try {
      const filename = path.split(/[/\\]/).pop() || path;
      const parentDir = parentPath(path);
      const deleted = await DocumentService.deleteEntry(path, permanent, isDirectory, async () => {
        if (isTauri()) {
          await deleteItem(parentDir, filename, permanent);
        } else {
          const parentHandle = await findDirectoryHandle(parentDir);
          if (!parentHandle) throw new Error(`找不到父目录: ${parentDir}`);
          await deleteItem(parentHandle, filename, permanent);
        }
      });
      if (!deleted) return;
      await refreshDirectory();
      WorkspaceIndex.invalidate();
    } catch (error: any) {
      console.error('Failed to delete:', error);
      notify('删除失败: ' + error.message);
    }
  }

  // 清除搜索
  function clearSearch() {
    searchQuery = '';
    showFileSearch = false;
    document.querySelector<HTMLElement>('[aria-label="筛选文件名"]')?.focus();
  }

  // 键盘快捷键
  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      clearSearch();
    }
  }

</script>

<div
  class="flex flex-col h-full"
  role="region"
  aria-label="文件浏览器"
>
  <!-- Drawer tabs -->
  <div class="sidebar-drawer-tabs" role="tablist" aria-label="侧栏视图" tabindex="-1" onkeydown={navigateTabs}>
    <button
      class="sidebar-tab"
      role="tab" id="sidebar-tab-files" aria-selected={activeTab === 'files'} aria-controls="sidebar-panel" tabindex={activeTab === 'files' ? 0 : -1}
      class:active={activeTab === 'files'}
      onclick={() => switchTab('files')}
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
      </svg>
      文件
    </button>
    <button
      class="sidebar-tab"
      role="tab" id="sidebar-tab-outline" aria-selected={activeTab === 'outline'} aria-controls="sidebar-panel" tabindex={activeTab === 'outline' ? 0 : -1}
      class:active={activeTab === 'outline'}
      onclick={() => switchTab('outline')}
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="8" y1="6" x2="21" y2="6"></line>
        <line x1="8" y1="12" x2="21" y2="12"></line>
        <line x1="8" y1="18" x2="21" y2="18"></line>
        <line x1="3" y1="6" x2="3.01" y2="6"></line>
        <line x1="3" y1="12" x2="3.01" y2="12"></line>
        <line x1="3" y1="18" x2="3.01" y2="18"></line>
      </svg>
      大纲
    </button>
    <button
      class="sidebar-tab"
      role="tab" id="sidebar-tab-search" aria-selected={activeTab === 'search'} aria-controls="sidebar-panel" tabindex={activeTab === 'search' ? 0 : -1}
      class:active={activeTab === 'search'}
      onclick={() => switchTab('search')}
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"></circle>
        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
      </svg>
      搜索
    </button>
    <div class="flex-1"></div>
  </div>

  <div class="sidebar-panel" id="sidebar-panel" role="tabpanel" aria-labelledby={`sidebar-tab-${activeTab}`}>
  {#if activeTab === 'files'}
    <div class="file-panel-bar">
      <button
        type="button"
        class="folder-label"
        onclick={openFolder}
        title={$currentDirectory || '打开文件夹'}
      >
        <span class="folder-marker" aria-hidden="true"></span>
        <span>{$directoryName || $currentDirectory || '打开文件夹'}</span>
      </button>
      <button type="button" class="panel-icon-button" onclick={refreshFiles} disabled={!$currentDirectory || isRefreshing}
        aria-label="刷新文件树" aria-busy={isRefreshing} title="刷新文件树（保留当前筛选）">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M20 12a8 8 0 0 0-14-5M4 12a8 8 0 0 0 14 5" /></svg>
      </button>
      <button
        type="button"
        class="panel-icon-button"
        class:active={showFileSearch}
        onclick={toggleFilter}
        aria-label="筛选文件名"
        title="筛选文件名"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
      </button>
    </div>

    {#if showFileSearch}
    <!-- 搜索框 -->
    <div class="p-2 border-b border-[var(--border-color)]">
      <div class="search-box">
        <input
          bind:this={filterInput}
          type="text"
          class="search-input"
          placeholder="搜索文件..."
          aria-label="筛选文件名"
          bind:value={searchQuery}
          onkeydown={handleKeydown}
        />
        {#if searchQuery}
          <button class="toolbar-button" onclick={clearSearch} title="清除搜索">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        {:else}
          <span class="filter-icon" aria-hidden="true">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
          </span>
        {/if}
      </div>
      <p class="filter-hint">筛选已载入的目录项</p>
    </div>

    <!-- 文件树 -->
    {/if}

    <div class="flex-1 overflow-auto">
      {#if $currentDirectory}
        <div class="p-2">
          <FileTree
            nodes={filteredTree}
            onFileClick={path => { void openFile(path); }}
            onToggle={toggleFilteredNode}
            onLoadChildren={loadNodeChildren}
            onRename={handleRename}
            onDelete={handleDelete}
            activePath={$currentFile}
          />
          {#if searchQuery.trim() && !filteredTree.length}<p class="file-tree-empty" role="status">没有匹配的文件</p>{/if}
        </div>
      {:else}
        <div class="flex flex-col items-center justify-center h-full text-[var(--text-tertiary)] p-4">
          <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="mb-4 opacity-50">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
          <p class="text-sm mb-2">未打开文件夹</p>
          <button
            class="px-4 py-2 bg-[var(--accent-color)] text-white rounded-md text-sm hover:opacity-90"
            onclick={openFolder}
          >
            打开文件夹
          </button>
          <p class="text-xs mt-4 text-center">
            或拖放文件到此处
          </p>
        </div>
      {/if}
    </div>
  {:else if activeTab === 'outline'}
    <!-- 大纲视图 -->
    <div class="flex-1 overflow-auto">
      <Outline onHeadingClick={handleHeadingClick} />
    </div>
  {:else if activeTab === 'search'}
    <!-- 全局文件搜索 -->
    <div class="flex-1 overflow-auto">
      <GlobalFileSearch onFileSelect={(path, line) => { void openFile(path, line); }} />
    </div>
  {/if}
  </div>
</div>

<style>
  .sidebar-panel { display: flex; flex-direction: column; flex: 1; min-height: 0; }
  .filter-hint, .file-tree-empty { margin: 5px 4px 0; color: var(--ui-text-muted); font-size: 11px; }
  .file-tree-empty { padding: 12px 4px; }
  .filter-icon { display: inline-flex; padding: 4px; color: var(--ui-text-muted); }
  .file-panel-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 32px;
    padding: 4px 8px 3px;
    border-bottom: 1px solid color-mix(in srgb, var(--ui-border) 52%, transparent);
  }

  .folder-label {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    flex: 1;
    height: 24px;
    padding: 0 7px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--ui-text-muted);
    cursor: pointer;
    font-size: 12px;
    text-align: left;
  }

  .folder-label span:last-child {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .folder-label:hover,
  .folder-label:focus-visible {
    background: color-mix(in srgb, var(--ui-panel-hover) 66%, transparent);
    color: var(--ui-text);
  }

  .folder-marker {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--ui-text-muted) 54%, transparent);
  }

  .panel-icon-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--ui-text-muted);
    cursor: pointer;
    opacity: 0.72;
  }

  .panel-icon-button:hover,
  .panel-icon-button:focus-visible,
  .panel-icon-button.active {
    background: color-mix(in srgb, var(--ui-panel-hover) 68%, transparent);
    color: var(--ui-text);
    opacity: 1;
  }
  .panel-icon-button:disabled { opacity: 0.35; cursor: default; }

  .sidebar-tab {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 6px;
    margin: 3px 1px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--ui-text-muted);
    cursor: pointer;
    font-size: 12px;
    flex-shrink: 0;
    font-weight: 400;
    transition: color 0.12s, background-color 0.12s;
  }

  .sidebar-drawer-tabs {
    display: flex;
    align-items: center;
    min-height: 40px;
    padding: 0 34px 0 8px;
    border-bottom: 1px solid color-mix(in srgb, var(--ui-border) 66%, transparent);
  }

  .sidebar-tab:hover {
    color: var(--ui-text);
    background: var(--ui-panel-hover);
  }

  .sidebar-tab.active {
    color: var(--ui-text);
    background: color-mix(in srgb, var(--ui-panel-active) 72%, transparent);
    box-shadow: none;
  }

  .toolbar-button {
    width: 24px;
    height: 24px;
    border-radius: 4px;
    opacity: 0.58;
  }

  .toolbar-button:hover,
  .toolbar-button:focus-visible {
    opacity: 1;
  }

  .search-box {
    gap: 6px;
    padding: 4px 6px;
    border: 1px solid color-mix(in srgb, var(--ui-border) 72%, transparent);
    border-radius: 4px;
    background: color-mix(in srgb, var(--ui-panel-active) 78%, transparent);
  }

  .search-input {
    height: 24px;
    padding: 0 4px;
    border: 0;
    background: transparent;
    font-size: 12px;
  }
</style>
