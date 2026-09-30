<script lang="ts">
  import { get } from 'svelte/store';
  import { sessions, activeSessionId, setActiveSession } from '$lib/stores/document';
  import { DocumentService } from '$lib/services/document';
  import { openInNewWindow } from '$lib/utils/window-manager';

  let contextMenu = $state<{ visible: boolean; x: number; y: number; tabId: string; tabPath: string }>({
    visible: false, x: 0, y: 0, tabId: '', tabPath: ''
  });

  function handleTabClick(tabId: string) {
    setActiveSession(tabId);
  }

  function handleCloseClick(event: MouseEvent, tabId: string) {
    event.stopPropagation();
    void DocumentService.closeSessionWithPrompt(tabId);
  }

  function handleContextMenu(event: MouseEvent, tabId: string) {
    event.preventDefault();
    const tab = $sessions.find(t => t.id === tabId);
    contextMenu = {
      visible: true,
      x: event.clientX,
      y: event.clientY,
      tabId,
      tabPath: tab?.path || '',
    };
  }

  function closeContextMenu() {
    contextMenu.visible = false;
  }

  async function closeOtherSessions(keepId: string): Promise<void> {
    for (const session of [...get(sessions)]) {
      if (session.id !== keepId && !await DocumentService.closeSessionWithPrompt(session.id)) return;
    }
    setActiveSession(keepId);
  }

  async function handleContextMenuAction(action: string) {
    switch (action) {
      case 'close':
        await DocumentService.closeSessionWithPrompt(contextMenu.tabId);
        break;
      case 'closeOthers':
        await closeOtherSessions(contextMenu.tabId);
        break;
      case 'closeAll':
        await DocumentService.closeAllSessionsWithPrompt();
        break;
      case 'openInNewWindow':
        if (contextMenu.tabPath) {
          await openInNewWindow(contextMenu.tabPath);
        }
        break;
    }
    closeContextMenu();
  }

  // 点击外部关闭右键菜单
  function handleClickOutside(event: MouseEvent) {
    if (contextMenu.visible) {
      closeContextMenu();
    }
  }
</script>

<svelte:window onclick={handleClickOutside} />

{#if $sessions.length > 0}
  <div class="tab-bar">
    {#each $sessions as tab (tab.id)}
      <div
        class="tab-item"
        class:active={tab.id === $activeSessionId}
        role="tab"
        tabindex="0"
        onclick={() => handleTabClick(tab.id)}
        onkeydown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleTabClick(tab.id);
          }
        }}
        oncontextmenu={(e) => handleContextMenu(e, tab.id)}
      >
        <span class="tab-name">{tab.name}</span>
        {#if tab.isDirty}
          <span class="tab-dirty">●</span>
        {/if}
        <button
          class="tab-close"
          onclick={(e) => handleCloseClick(e, tab.id)}
          title="关闭"
        >
          ×
        </button>
      </div>
    {/each}
  </div>
{/if}

{#if contextMenu.visible}
  <div
    class="context-menu"
    style="left: {contextMenu.x}px; top: {contextMenu.y}px;"
  >
    <button class="context-menu-item" onclick={() => handleContextMenuAction('openInNewWindow')}>
      在新窗口打开
    </button>
    <div class="context-menu-divider"></div>
    <button class="context-menu-item" onclick={() => handleContextMenuAction('close')}>
      关闭
    </button>
    <button class="context-menu-item" onclick={() => handleContextMenuAction('closeOthers')}>
      关闭其他
    </button>
    <button class="context-menu-item" onclick={() => handleContextMenuAction('closeAll')}>
      关闭所有
    </button>
  </div>
{/if}

<style>
  .tab-bar {
    display: flex;
    align-items: center;
    height: 24px;
    padding: 0 10px;
    background: color-mix(in srgb, var(--ui-bg) 88%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--ui-border) 56%, transparent);
    overflow-x: auto;
    scrollbar-width: none;
    opacity: 0.72;
  }

  .tab-bar:hover,
  .tab-bar:focus-within {
    opacity: 1;
  }

  .tab-bar::-webkit-scrollbar {
    display: none;
  }

  .tab-item {
    display: flex;
    align-items: center;
    gap: 5px;
    height: 18px;
    margin-right: 4px;
    padding: 0 9px;
    border: none;
    border-radius: 999px;
    background: transparent;
    color: var(--ui-text-muted);
    font-size: 11px;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.1s, color 0.1s;
  }

  .tab-item:hover {
    background: var(--ui-panel-hover);
  }

  .tab-item.active {
    background: color-mix(in srgb, var(--ui-panel-active) 86%, transparent);
    color: var(--ui-text);
  }

  .tab-name {
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tab-dirty {
    color: var(--accent-color);
    font-size: 10px;
  }

  .tab-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--ui-text-muted);
    font-size: 12px;
    cursor: pointer;
    transition: background 0.1s;
  }

  .tab-close:hover {
    background: var(--ui-panel-hover);
    color: var(--ui-text);
  }

  .context-menu {
    position: fixed;
    z-index: 100;
    min-width: 120px;
    padding: 6px;
    background: var(--ui-panel);
    border: 1px solid var(--ui-border);
    border-radius: 6px;
    box-shadow: var(--ui-shadow-popover);
  }

  .context-menu-item {
    display: block;
    width: 100%;
    padding: 6px 12px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--ui-text);
    font-size: 12px;
    text-align: left;
    cursor: pointer;
    transition: background 0.1s;
  }

  .context-menu-item:hover {
    background: var(--ui-panel-hover);
  }

  .context-menu-divider {
    height: 1px;
    margin: 4px 8px;
    background: var(--ui-border);
  }
</style>
