<script lang="ts">
  import { onMount } from 'svelte';
  import { fileTree, toggleNode, loadNodeChildren, currentDirectory, currentDirectoryHandle, directoryName, refreshDirectory } from '$lib/stores/file';
  import {
    currentFile,
    fileContent,
    createSession,
    updateActiveSessionFileHandle,
  } from '$lib/stores/document';
  import { readFile, isFileSystemAccessSupported, renameItem, deleteItem } from '$lib/utils/native-fs';
  import { isTauri } from '$lib/utils/platform';
  import { setCurrentFileDir } from '$lib/utils/markdown';
  import FileTree from './FileTree.svelte';
  import Outline from './Outline.svelte';
  import GlobalSearch from './GlobalSearch.svelte';
  import GlobalFileSearch from './GlobalFileSearch.svelte';

  import { WorkspaceService } from '$lib/services/workspace';
  import { renameSessionPaths } from '$lib/stores/document';
  import { DocumentService } from '$lib/services/document';
  import { joinPath, parentPath } from '$lib/utils/path';

  let searchQuery = $state('');
  let isSearching = $state(false);
  let originalTree: any[] = [];
  let isSearchActive = $state(false);
  let showFileSearch = $state(false);

  // 侧边栏选项卡
  type SidebarTab = 'files' | 'outline' | 'search';
  let activeTab: SidebarTab = $state('files');

  function switchTab(tab: SidebarTab) {
    activeTab = tab;
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
      alert('您的浏览器不支持打开文件夹功能。\n\n请使用 Chrome/Edge 86+ 浏览器，或直接拖放文件到编辑器中。');
      return;
    }

    if (await WorkspaceService.openFolder()) {
      originalTree = [];
      isSearchActive = false;
    }
  }

  // 打开文件
  async function openFile(path: string) {
    try {
      if (isTauri()) {
        // Tauri 模式：直接使用路径读取
        const rootPath = $currentDirectory;
        if (!rootPath) {
          alert('请先打开文件夹');
          return;
        }
        const fullPath = path.startsWith('/') || path.includes(':') ? path : `${rootPath}/${path}`;
        const content = await readFile(fullPath);
        createSession(path.split(/[/\\]/).pop() || path, fullPath, content);
        
        // 同步图片目录上下文
        const sep = fullPath.includes('\\') ? '\\' : '/';
        const dir = fullPath.split(sep);
        dir.pop();
        setCurrentFileDir(dir.join(sep));
      } else {
        // 浏览器模式：使用文件句柄
        if (!$currentDirectoryHandle) {
          alert('请先打开文件夹');
          return;
        }
        const handle = await findFileHandle(path);
        if (!handle) {
          alert('找不到文件: ' + path);
          return;
        }
        const content = await readFile(handle);
        createSession(path.split(/[/\\]/).pop() || path, path, content, content, handle);
        updateActiveSessionFileHandle(handle);
      }
    } catch (error: any) {
      console.error('Failed to open file:', error);
      alert('打开文件失败: ' + error.message);
    }
  }

  // 查找文件句柄（浏览器模式）
  async function findFileHandle(path: string): Promise<FileSystemFileHandle | null> {
    const parts = path.split('/').filter(p => p);
    let current: FileSystemDirectoryHandle | null = $currentDirectoryHandle;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;

      try {
        if (isLast) {
          if (!current?.getFileHandle) return null;
          return await current.getFileHandle(part);
        }
        if (!current?.getDirectoryHandle) return null;
        current = await current.getDirectoryHandle(part);
      } catch (error) {
        return null;
      }
    }

    return null;
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
    } catch (error: any) {
      console.error('Failed to rename:', error);
      alert('重命名失败: ' + error.message);
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
    } catch (error: any) {
      console.error('Failed to delete:', error);
      alert('删除失败: ' + error.message);
    }
  }

  // 搜索文件
  async function searchFiles() {
    if (!searchQuery.trim() || !$currentDirectory) return;

    if (!isSearchActive) {
      originalTree = $fileTree;
      isSearchActive = true;
    }

    isSearching = true;
    try {
      // 在当前文件树中搜索
      const results = searchInTree(originalTree, searchQuery.toLowerCase());
      fileTree.set(results);
    } catch (error) {
      console.error('Failed to search files:', error);
    } finally {
      isSearching = false;
    }
  }

  // 在文件树中搜索
  function searchInTree(tree: any[], query: string): any[] {
    const results: any[] = [];

    for (const node of tree) {
      if (node.name.toLowerCase().includes(query)) {
        results.push(node);
      }

      if (node.children) {
        const childResults = searchInTree(node.children, query);
        results.push(...childResults);
      }
    }

    return results;
  }

  // 清除搜索
  function clearSearch() {
    searchQuery = '';
    showFileSearch = false;
    if (isSearchActive) {
      fileTree.set(originalTree);
      originalTree = [];
      isSearchActive = false;
    }
  }

  // 键盘快捷键
  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      searchFiles();
    }
    if (event.key === 'Escape') {
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
  <div class="sidebar-drawer-tabs">
    <button
      class="sidebar-tab"
      class:active={activeTab === 'files'}
      onclick={() => switchTab('files')}
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
      </svg>
      Files
    </button>
    <button
      class="sidebar-tab"
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
      Outline
    </button>
    <button
      class="sidebar-tab"
      class:active={activeTab === 'search'}
      onclick={() => switchTab('search')}
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"></circle>
        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
      </svg>
      Search
    </button>
    <div class="flex-1"></div>
    {#if activeTab === 'files'}
      <button
        class="toolbar-button"
        onclick={openFolder}
        title="打开文件夹"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
      </button>
    {/if}
  </div>

  {#if activeTab === 'files'}
    <div class="file-panel-bar">
      <button
        type="button"
        class="folder-label"
        onclick={openFolder}
        title={$currentDirectory || 'Open folder'}
      >
        <span class="folder-marker" aria-hidden="true"></span>
        <span>{$directoryName || $currentDirectory || 'Open folder'}</span>
      </button>
      <button
        type="button"
        class="panel-icon-button"
        class:active={showFileSearch}
        onclick={() => (showFileSearch = !showFileSearch)}
        aria-label="Find in library"
        title="Find in library"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
      </button>
    </div>

    {#if showFileSearch || searchQuery || isSearchActive}
    <!-- 搜索框 -->
    <div class="p-2 border-b border-[var(--border-color)]">
      <div class="search-box">
        <input
          type="text"
          class="search-input"
          placeholder="搜索文件..."
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
          <button class="toolbar-button" onclick={searchFiles} title="搜索">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
          </button>
        {/if}
      </div>
    </div>

    <!-- 文件树 -->
    {/if}

    <div class="flex-1 overflow-auto">
      {#if $currentDirectory}
        <div class="p-2">
          <div class="text-xs text-[var(--text-tertiary)] mb-2 px-2">
            {$directoryName || $currentDirectory}
          </div>
          <FileTree
            nodes={$fileTree}
            onFileClick={openFile}
            onToggle={toggleNode}
            onLoadChildren={loadNodeChildren}
            onRename={handleRename}
            onDelete={handleDelete}
            activePath={$currentFile}
          />
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
      <GlobalFileSearch onFileSelect={(path, line) => {
        openFile(path);
        setTimeout(() => {
          const event = new CustomEvent('heading-click', { detail: { line } });
          window.dispatchEvent(event);
        }, 100);
      }} />
    </div>
  {/if}
</div>

<style>
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
    font-size: 11px;
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

  .sidebar-tab {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 7px;
    margin: 3px 1px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--ui-text-muted);
    cursor: pointer;
    font-size: 11px;
    font-weight: 400;
    transition: all 0.15s;
  }

  .sidebar-drawer-tabs {
    display: flex;
    align-items: center;
    min-height: 34px;
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
