<script lang="ts">
  import type { FileNode } from '$lib/stores/file';
  import Self from './FileTree.svelte';
  import { isTauri } from '$lib/utils/platform';

  let { nodes, onFileClick, onToggle, onLoadChildren, onRename, onDelete, activePath = null, level = 0 }: {
    nodes: FileNode[];
    onFileClick: (path: string) => void;
    onToggle: (node: FileNode) => void;
    onLoadChildren: (node: FileNode) => void;
    onRename?: (oldPath: string, newName: string, isDirectory: boolean) => void;
    onDelete?: (path: string, permanent: boolean, isDirectory: boolean) => void;
    activePath?: string | null;
    level?: number;
  } = $props();

  let contextMenu = $state<{ x: number; y: number; node: FileNode } | null>(null);
  let renamingNode = $state<{ path: string; name: string } | null>(null);
  let renameInput = $state('');

  function handleClick(node: FileNode) {
    if (renamingNode) return;
    if (node.isDirectory) {
      if (!node.children) {
        onLoadChildren(node);
      } else {
        onToggle(node);
      }
    } else {
      onFileClick(node.path);
    }
  }

  function handleContextMenu(event: MouseEvent, node: FileNode) {
    event.preventDefault();
    event.stopPropagation();
    contextMenu = { x: event.clientX, y: event.clientY, node };
  }

  function closeContextMenu() {
    contextMenu = null;
  }

  function startRename(node: FileNode) {
    renamingNode = { path: node.path, name: node.name };
    renameInput = node.name;
    closeContextMenu();
  }

  function confirmRename() {
    if (!renamingNode || !renameInput.trim()) {
      renamingNode = null;
      return;
    }
    if (renameInput.trim() !== renamingNode.name) {
      const node = nodes.find(item => item.path === renamingNode?.path);
      onRename?.(renamingNode.path, renameInput.trim(), node?.isDirectory ?? false);
    }
    renamingNode = null;
  }

  function cancelRename() {
    renamingNode = null;
  }

  function handleRenameKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      confirmRename();
    } else if (event.key === 'Escape') {
      cancelRename();
    }
  }

  function handleDelete(node: FileNode, permanent = false) {
    closeContextMenu();
    onDelete?.(node.path, permanent, node.isDirectory);
  }

  function getFileIcon(node: FileNode): string {
    if (node.isDirectory) {
      return node.isExpanded ? 'v' : '>';
    }
    return '';
  }

  function isActiveNode(node: FileNode): boolean {
    if (node.isDirectory || !activePath) return false;
    return node.path === activePath || activePath.endsWith(node.path);
  }
</script>

<svelte:window onclick={closeContextMenu} />

<div class="file-tree" style="padding-left: {level * 16}px">
  {#each nodes as node (node.path)}
    <div>
      <button
        class="file-tree-item w-full"
        class:active={isActiveNode(node)}
        onclick={() => handleClick(node)}
        oncontextmenu={(e) => handleContextMenu(e, node)}
      >
        <span class="file-tree-icon">
          {getFileIcon(node)}
        </span>
        {#if renamingNode?.path === node.path}
          <input
            class="rename-input"
            bind:value={renameInput}
            onblur={confirmRename}
            onkeydown={handleRenameKeydown}
            onclick={(e) => e.stopPropagation()}
          />
        {:else}
          <span class="file-tree-name">
            {node.name}
          </span>
        {/if}
        {#if node.isDirectory}
          <span class="file-tree-chevron" aria-hidden="true">
            {node.isExpanded ? 'v' : '>'}
          </span>
        {/if}
      </button>

      {#if node.isDirectory && node.isExpanded && node.children}
        <Self
          nodes={node.children}
          {onFileClick}
          {onToggle}
          {onLoadChildren}
          {onRename}
          {onDelete}
          {activePath}
          level={level + 1}
        />
      {/if}
    </div>
  {/each}
</div>

<!-- 右键菜单 -->
{#if contextMenu}
  <div
    class="context-menu"
    style="left: {contextMenu.x}px; top: {contextMenu.y}px"
    role="menu"
    tabindex="-1"
  >
    <button class="context-menu-item" onclick={() => { const cm = contextMenu; if (cm) startRename(cm.node); }}>
      重命名
    </button>
    {#if isTauri()}
    <button class="context-menu-item" onclick={() => { const cm = contextMenu; if (cm) handleDelete(cm.node); }}>
      移入回收站
    </button>
    {/if}
    <button class="context-menu-item context-menu-danger" onclick={() => { const cm = contextMenu; if (cm) handleDelete(cm.node, true); }}>
      永久删除...
    </button>
  </div>
{/if}

<style>
  .rename-input {
    flex: 1;
    padding: 1px 4px;
    border: 1px solid var(--accent-color);
    border-radius: 3px;
    background: var(--bg-primary);
    color: var(--text-primary);
    font-size: 13px;
    font-family: inherit;
    outline: none;
  }

  .file-tree {
    font-size: 13px;
  }

  .file-tree-item {
    min-height: 27px;
    padding: 3px 7px;
    border-radius: 4px;
    color: var(--ui-text);
    text-align: left;
  }

  .file-tree-item:hover {
    background: color-mix(in srgb, var(--ui-panel-hover) 72%, transparent);
  }

  .file-tree-item.active {
    background: color-mix(in srgb, var(--ui-panel-active) 88%, var(--ui-panel-hover));
    color: var(--ui-text);
  }

  .file-tree-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    margin-right: 5px;
    color: var(--ui-text-muted);
    font-size: 10px;
  }

  .file-tree-name {
    flex: 1;
    color: inherit;
    font-weight: 400;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-tree-chevron {
    margin-left: 6px;
    color: var(--ui-text-muted);
    font-size: 10px;
    opacity: 0.55;
  }

  .context-menu {
    position: fixed;
    z-index: 200;
    min-width: 120px;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    padding: 4px 0;
  }

  .context-menu-item {
    display: block;
    width: 100%;
    padding: 6px 16px;
    border: none;
    background: transparent;
    color: var(--text-primary);
    font-size: 13px;
    text-align: left;
    cursor: pointer;
  }

  .context-menu-item:hover {
    background: var(--bg-secondary);
  }

  .context-menu-danger:hover {
    background: #dc2626;
    color: white;
  }
</style>
