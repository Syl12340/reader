<script lang="ts">
  import { get } from 'svelte/store';
  import { sessions, activeSessionId, setActiveSession } from '$lib/stores/document';
  import { DocumentService } from '$lib/services/document';
  import { openInNewWindow } from '$lib/utils/window-manager';
  import { tick } from 'svelte';
  import { popupNavigation } from '$lib/utils/menu-navigation';
  import { settings } from '$lib/stores/settings';
  import { confirmAction } from '$lib/services/interaction';
  import { anchoredPopover } from '$lib/utils/popover-position';
  import { isTauri } from '$lib/utils/platform';
  import { focusDocumentSurface } from '$lib/utils/document-focus';
  let tabBar: HTMLDivElement | undefined = $state();
  let menuElement: HTMLDivElement | undefined = $state();
  const desktop = isTauri();
  let draggingId: string | null = $state(null);
  let listVisible = $state(false);
  let listAnchor = $state({ x: 0, y: 0 });
  function moveTab(targetId: string, offset = 0) {
    const id = draggingId ?? targetId;
    sessions.update(list => {
      const from = list.findIndex(tab => tab.id === id);
      let to = list.findIndex(tab => tab.id === targetId) + offset;
      if (from < 0 || to < 0 || to >= list.length || from === to) return list;
      const next = [...list];
      const [tab] = next.splice(from, 1);
      next.splice(to, 0, tab);
      return next;
    });
  }
  const duplicateNames = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const tab of $sessions) counts.set(tab.name, (counts.get(tab.name) ?? 0) + 1);
    return new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name));
  });
  function parentLabel(path: string | null): string {
    return path?.replace(/\\/g, '/').split('/').slice(0, -1).filter(Boolean).pop() ?? '未保存';
  }
  $effect(() => {
    const id = $activeSessionId;
    void tick().then(() => {
      if (get(activeSessionId) === id) tabBar?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  });

  let contextMenu = $state<{ visible: boolean; x: number; y: number; tabId: string; tabPath: string }>({
    visible: false, x: 0, y: 0, tabId: '', tabPath: ''
  });

  function handleTabClick(tabId: string, focusDocument = false) {
    setActiveSession(tabId);
    if (focusDocument) void tick().then(() => { if (get(activeSessionId) === tabId) focusDocumentSurface(); });
  }

  async function handleCloseClick(event: MouseEvent, tabId: string) {
    event.stopPropagation();
    const restoreFocus = event.currentTarget === document.activeElement;
    if (await DocumentService.closeSessionWithPrompt(tabId) && restoreFocus) {
      await tick();
      if (document.activeElement === document.body) tabBar?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
    }
  }

  function handleContextMenu(event: MouseEvent, tabId: string) {
    event.preventDefault();
    showContextMenu(tabId, event.clientX, event.clientY);
  }

  function showContextMenu(tabId: string, x: number, y: number) {
    const tab = $sessions.find(t => t.id === tabId);
    if (!tab) return;
    contextMenu = {
      visible: true,
      x,
      y,
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
    if (get(sessions).some(session => session.id === keepId)) setActiveSession(keepId);
  }

  async function handleContextMenuAction(action: string) {
    const target = { ...contextMenu };
    closeContextMenu();
    switch (action) {
      case 'close':
        await DocumentService.closeSessionWithPrompt(target.tabId);
        break;
      case 'closeOthers':
        await closeOtherSessions(target.tabId);
        break;
      case 'closeAll':
        await DocumentService.closeAllSessionsWithPrompt();
        break;
      case 'openInNewWindow':
        if (desktop && target.tabPath) {
          const tab = get(sessions).find(item => item.id === target.tabId);
          if (!tab || tab.path !== target.tabPath) break;
          if (tab?.isDirty && !await confirmAction('在新窗口打开', '新窗口会打开磁盘版本，不包含当前未保存修改。继续？', '打开')) break;
          if (get(sessions).find(item => item.id === target.tabId)?.path === target.tabPath) await openInNewWindow(target.tabPath);
        }
        break;
    }
  }

  // 点击外部关闭右键菜单
  function handleClickOutside(event: MouseEvent) {
    if (contextMenu.visible && event.target instanceof Node && !menuElement?.contains(event.target)) {
      closeContextMenu();
    }
    if (listVisible && event.target instanceof Element && !event.target.closest('.tab-document-list, .tab-overflow')) listVisible = false;
  }
</script>

<svelte:window onclick={handleClickOutside} onkeydown={event => { if (!event.isComposing && !event.defaultPrevented && event.key === 'Escape') closeContextMenu(); }} />

{#if $sessions.length > 1 || ($sessions.length === 1 && $settings.showSingleTab)}
  <div class="tab-bar" bind:this={tabBar} role="tablist" aria-label="已打开文档">
    {#each $sessions as tab (tab.id)}
      <div
        class="tab-item"
        class:active={tab.id === $activeSessionId}
        role="tab"
        aria-selected={tab.id === $activeSessionId}
        tabindex={tab.id === $activeSessionId ? 0 : -1}
        data-session-id={tab.id}
        draggable="true"
        ondragstart={event => { draggingId = tab.id; event.dataTransfer?.setData('application/x-reader-tab', tab.id); }}
        ondragend={() => draggingId = null}
        ondragover={event => { if (draggingId) event.preventDefault(); }}
        ondrop={event => { if (draggingId) { event.preventDefault(); moveTab(tab.id); draggingId = null; } }}
        title={tab.path || tab.name}
        onclick={() => handleTabClick(tab.id, true)}
        onkeydown={(e) => {
          if (e.isComposing || e.defaultPrevented || e.target !== e.currentTarget) return;
          if (e.altKey && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
            e.preventDefault(); moveTab(tab.id, e.key === 'ArrowLeft' ? -1 : 1);
          } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
            e.preventDefault();
            const rect = e.currentTarget.getBoundingClientRect();
            showContextMenu(tab.id, rect.left, rect.bottom);
          } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleTabClick(tab.id);
          } else if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
            e.preventDefault();
            const index = $sessions.findIndex(item => item.id === tab.id);
            const next = e.key === 'Home' ? 0 : e.key === 'End' ? $sessions.length - 1
              : (index + (e.key === 'ArrowRight' ? 1 : -1) + $sessions.length) % $sessions.length;
            handleTabClick($sessions[next].id);
            void tick().then(() => tabBar?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus());
          }
        }}
        oncontextmenu={(e) => handleContextMenu(e, tab.id)}
      >
        <span class="tab-name">{tab.name}</span>
        {#if duplicateNames.has(tab.name)}<span class="tab-location">{parentLabel(tab.path)}</span>{/if}
        {#if tab.isDirty}
          <span class="tab-dirty" aria-label="有未保存修改">●</span>
        {/if}
        <button
          class="tab-close"
          tabindex={tab.id === $activeSessionId ? 0 : -1}
          aria-label={`关闭 ${tab.name}`}
          onclick={(e) => handleCloseClick(e, tab.id)}
          title="关闭"
        >
          ×
        </button>
      </div>
    {/each}
    {#if $sessions.length > 1}<button type="button" class="tab-overflow" aria-label="打开文档列表" aria-haspopup="menu" aria-expanded={listVisible}
      onclick={event => { const rect = event.currentTarget.getBoundingClientRect(); listAnchor = { x: rect.right, y: rect.bottom }; listVisible = !listVisible; }}>
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m6 9 6 6 6-6"/></svg>
    </button>{/if}
  </div>
{/if}

{#if listVisible}
  <div class="tab-document-list context-menu" role="menu" aria-label="已打开文档列表" use:popupNavigation={() => listVisible = false}
    use:anchoredPopover={{ ...listAnchor, align: 'end' }}>
    {#each $sessions as tab (tab.id)}<button type="button" class="context-menu-item" role="menuitemradio" aria-checked={tab.id === $activeSessionId}
      title={tab.path || tab.name} onclick={() => { listVisible = false; handleTabClick(tab.id, true); }}>{tab.name}{duplicateNames.has(tab.name) ? ` · ${parentLabel(tab.path)}` : ''}</button>{/each}
  </div>
{/if}

{#if contextMenu.visible}
  <div
    class="context-menu"
    bind:this={menuElement}
    aria-label="文档标签操作"
    use:popupNavigation={closeContextMenu}
    use:anchoredPopover={{ x: contextMenu.x, y: contextMenu.y, gap: 0 }}
  >
    <button class="context-menu-item" disabled={!contextMenu.tabPath || !desktop}
      title={!desktop ? '新窗口打开仅支持桌面版的已保存文件' : undefined} onclick={() => handleContextMenuAction('openInNewWindow')}>
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
  .tab-overflow { position: sticky; right: 0; display: grid; place-items: center; flex-shrink: 0; width: 28px; height: 28px; margin-left: auto; padding: 4px; border: 0; border-radius: 3px; background: var(--ui-bg); color: var(--ui-text-muted); cursor: pointer; }
  .tab-overflow:hover { background: var(--ui-panel-hover); }
  .tab-document-list { max-height: 50dvh; overflow: auto; }
  .tab-overflow:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: -2px; }
  .tab-bar {
    display: flex;
    align-items: center;
    height: 34px;
    flex-shrink: 0;
    padding: 0 12px;
    background: var(--ui-bg);
    border-bottom: 1px solid color-mix(in srgb, var(--ui-border) 56%, transparent);
    overflow-x: auto;
    scrollbar-width: none;
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
    height: 28px;
    flex-shrink: 0;
    margin-right: 4px;
    padding: 0 9px;
    border: none;
    border-radius: 3px;
    background: transparent;
    color: var(--ui-text-muted);
    font-size: 13px;
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
    max-width: 190px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tab-location { max-width: 100px; overflow: hidden; text-overflow: ellipsis; font-size: 11px; color: var(--ui-text-muted); opacity: .8; }

  .tab-dirty {
    color: var(--accent-color);
    font-size: 10px;
  }

  .tab-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--ui-text-muted);
    font-size: 16px;
    opacity: 0;
    cursor: pointer;
    transition: background 0.1s;
  }

  .tab-close:hover {
    background: var(--ui-panel-hover);
    color: var(--ui-text);
  }
  .tab-item:hover .tab-close, .tab-item:focus-within .tab-close, .tab-item.active .tab-close { opacity: 1; }
  .tab-item:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: -2px; }

  .context-menu {
    position: fixed;
    z-index: 100;
    min-width: 120px;
    padding: 6px;
    background: var(--ui-panel);
    border: 1px solid var(--ui-border);
    border-radius: 6px;
    box-shadow: var(--ui-shadow-popover);
    overflow: auto;
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

  .context-menu-item:hover:not(:disabled), .context-menu-item:focus-visible {
    background: var(--ui-panel-hover);
    outline: none;
  }
  .context-menu-item:disabled { opacity: .45; cursor: default; }
  .tab-close:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: -2px; }
  @media (hover: none) { .tab-close { opacity: 1; } }

  .context-menu-divider {
    height: 1px;
    margin: 4px 8px;
    background: var(--ui-border);
  }
</style>
