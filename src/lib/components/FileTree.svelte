<script lang="ts">
  import { tick } from 'svelte';
  import type { FileNode } from '$lib/stores/file';
  import Self from './FileTree.svelte';
  import { isTauri } from '$lib/utils/platform';
  import { normalizePathKey } from '$lib/utils/path';
  import { popupNavigation } from '$lib/utils/menu-navigation';

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
    contextMenu = { x: Math.max(8, Math.min(event.clientX, window.innerWidth - 190)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 180)), node };
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
    if (event.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault(); event.stopPropagation();
      confirmRename();
    } else if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      const row = (event.target as HTMLElement).closest('.file-tree-row');
      cancelRename();
      void tick().then(() => row?.querySelector<HTMLButtonElement>('button')?.focus());
    }
  }
  function focusRename(input: HTMLInputElement) {
    queueMicrotask(() => {
      if (!input.isConnected) return;
      input.focus();
      const dot = input.value.lastIndexOf('.');
      input.setSelectionRange(0, dot > 0 ? dot : input.value.length);
    });
  }

  function handleDelete(node: FileNode, permanent = false) {
    closeContextMenu();
    onDelete?.(node.path, permanent, node.isDirectory);
  }

  function isActiveNode(node: FileNode): boolean {
    if (node.isDirectory || !activePath) return false;
    return normalizePathKey(node.path) === normalizePathKey(activePath);
  }
</script>

<svelte:window onclick={closeContextMenu} onkeydown={event => { if (event.key === 'Escape') closeContextMenu(); }} />

<div class="file-tree" style="padding-left: {level ? 16 : 0}px">
  {#each nodes as node (node.path)}
    <div class="file-tree-row">
      {#if renamingNode?.path === node.path}
        <div class="file-tree-rename">
          <input class="rename-input" aria-label={`重命名 ${node.name}`} use:focusRename bind:value={renameInput}
            onblur={confirmRename} onkeydown={handleRenameKeydown} />
        </div>
      {:else}
      <button
        class="file-tree-item w-full"
        class:active={isActiveNode(node)}
        title={node.path}
        aria-expanded={node.isDirectory ? !!node.isExpanded : undefined}
        aria-current={isActiveNode(node) ? 'page' : undefined}
        onclick={() => handleClick(node)}
        oncontextmenu={(e) => handleContextMenu(e, node)}
        onkeydown={event => { if (event.key === 'F2' && onRename) { event.preventDefault(); startRename(node); } }}
      >
        <span class="file-tree-icon" aria-hidden="true">
          {#if node.isDirectory}
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" style="transform: rotate({node.isExpanded ? 90 : 0}deg)"><path d="m6 3 5 5-5 5" /></svg>
          {:else}
            <svg width="13" height="15" viewBox="0 0 16 18" fill="none" stroke="currentColor"><path d="M3 1h6l4 4v12H3z M9 1v4h4" /></svg>
          {/if}
        </span>
          <span class="file-tree-name">
            {node.name}
          </span>
      </button>
      {/if}

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
    use:popupNavigation={closeContextMenu}
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
  .file-tree-rename { display: flex; align-items: center; min-height: 27px; padding: 2px 6px 2px 23px; }
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
    min-width: 0;
    width: 100%;
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

  .context-menu {
    position: fixed;
    z-index: 200;
    min-width: 120px;
    background: var(--ui-panel-active);
    border: 1px solid var(--ui-border);
    border-radius: 6px;
    box-shadow: var(--ui-shadow-popover);
    padding: 4px 0;
    max-width: calc(100vw - 16px);
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
