<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { get } from 'svelte/store';
  import { fileTree, currentDirectory } from '$lib/stores/file';
  import { sessions, activeSessionId } from '$lib/stores/document';
  import { DocumentService } from '$lib/services/document';
  import type { FileNode } from '$lib/types';
  import { dialogFocus } from '$lib/utils/dialog-focus';
  import { normalizePathKey, pathContains } from '$lib/utils/path';
  import { focusDocumentSurface } from '$lib/utils/document-focus';
  import { WorkspaceIndex, workspaceIndex } from '$lib/services/workspace-index';
  import { quickOpenScore } from '$lib/utils/quick-open';
  import { notify } from '$lib/services/interaction';
  let { visible = $bindable(false), recentFiles = [] }: { visible?: boolean; recentFiles?: string[] } = $props();
  let query = $state('');
  let selectedKey = $state<string | null>(null);
  let input: HTMLInputElement | undefined = $state();
  let resultList: HTMLDivElement | undefined = $state();
  let openingPath = $state<string | null>(null);
  let revision = 0;
  let focusRevision = 0;
  let disposed = false;
  onMount(() => WorkspaceIndex.start());
  function flatten(nodes: FileNode[]): string[] {
    return nodes.flatMap(node => node.isDirectory ? flatten(node.children ?? []) : [node.path]);
  }
  const treePaths = $derived(flatten($fileTree));
  const filePaths = $derived([...new Map([...$workspaceIndex.paths, ...treePaths, ...recentFiles]
    .map(path => [normalizePathKey(path), path])).values()]);
  const recentRanks = $derived(new Map(recentFiles.map((path, index) => [normalizePathKey(path), index])));
  const candidates = $derived.by(() => {
    if (!visible) return [];
    const openedPaths = new Set($sessions.flatMap(tab => tab.path ? [normalizePathKey(tab.path)] : []));
    const tabs = $sessions.map(tab => ({ key: `tab:${tab.id}`, path: tab.path || tab.name,
      name: tab.name, sessionId: tab.id, isDirty: tab.isDirty }));
    return [...tabs, ...filePaths.filter(path => !openedPaths.has(normalizePathKey(path)))
      .map(path => ({ key: `file:${normalizePathKey(path)}`, path, name: path.split(/[/\\]/).pop()!, sessionId: '', isDirty: false }))];
  });
  const matches = $derived(candidates
      .map(item => ({ ...item, recentRank: recentRanks.get(normalizePathKey(item.path)) ?? 100000,
        score: quickOpenScore(item.path, query) })).filter(item => item.score >= 0)
      .sort((a, b) => b.score - a.score || (Number(!!b.sessionId) - Number(!!a.sessionId))
        || a.recentRank - b.recentRank));
  const results = $derived(matches.slice(0, 60));
  const selected = $derived(Math.max(0, results.findIndex(item => item.key === selectedKey)));
  $effect(() => {
    revision++; openingPath = null;
    if (!visible) return;
    focusRevision++; query = ''; selectedKey = null;
  });
  $effect(() => { void query; selectedKey = null; revision++; openingPath = null; });
  $effect(() => {
    const index = selected, key = results[index]?.key;
    if (!visible || !key) return;
    void tick().then(() => {
      if (!disposed && visible && results[selected]?.key === key) {
        resultList?.querySelector<HTMLElement>(`#quick-open-${selected}`)?.scrollIntoView({ block: 'nearest' });
      }
    });
  });
  onDestroy(() => { disposed = true; revision++; focusRevision++; });
  function close(focusDocument = false) {
    const focusRequest = ++focusRevision, sessionId = get(activeSessionId);
    revision++; openingPath = null; visible = false;
    if (focusDocument) void tick().then(() => {
      if (!disposed && !visible && focusRequest === focusRevision && sessionId === get(activeSessionId)) focusDocumentSurface();
    });
  }
  async function open(index: number) {
    const item = results[index];
    if (!item || openingPath) return;
    if (item.sessionId) {
      if (get(sessions).some(session => session.id === item.sessionId)) { activeSessionId.set(item.sessionId); close(true); }
      return;
    }
    const request = ++revision;
    const origin = get(activeSessionId);
    const queryAtOpen = query;
    openingPath = item.path;
    const stillCurrent = () => visible && request === revision && query === queryAtOpen && get(activeSessionId) === origin;
    try {
      const id = await DocumentService.openPath(item.path, stillCurrent);
      if (visible && request === revision && id) close(true);
    } catch (error) {
      if (stillCurrent()) notify(`打开失败：${error instanceof Error ? error.message : String(error)}`);
    } finally { if (request === revision) openingPath = null; }
  }
  function keydown(event: KeyboardEvent) {
    if (event.defaultPrevented || event.isComposing || event.target !== input) return;
    if (event.key === 'Enter') { event.preventDefault(); void open(selected); }
    else if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp'].includes(event.key)) {
      event.preventDefault();
      if (!results.length) return;
      const page = Math.max(1, Math.floor((resultList?.clientHeight ?? 300) / 54) - 1);
      const offset = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : event.key === 'PageDown' ? page : -page;
      const next = event.key.startsWith('Arrow') ? (selected + offset + results.length) % results.length
        : Math.max(0, Math.min(results.length - 1, selected + offset));
      selectedKey = results[next].key;
    }
  }
  function relativePath(path: string): string {
    return $currentDirectory && pathContains($currentDirectory, path)
      ? path.slice($currentDirectory.length).replace(/^[/\\]/, '') || path : path;
  }
</script>

{#if visible}
  <div class="quick-open-backdrop" role="presentation" onmousedown={event => { if (event.target === event.currentTarget) close(); }}>
    <div class="quick-open" role="dialog" aria-modal="true" aria-label="快速打开文件" aria-busy={!!openingPath}
      use:dialogFocus={{ close, initial: 'input' }} tabindex="-1" onkeydown={keydown}>
      <div class="search-field">
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>
        <input bind:this={input} bind:value={query} role="combobox" aria-expanded="true" aria-controls="quick-open-results"
          aria-autocomplete="list" autocomplete="off" spellcheck="false"
          aria-activedescendant={results.length ? `quick-open-${selected}` : undefined} aria-label="搜索文件名" placeholder="搜索文件名或路径…" />
        {#if query}<button class="clear-query" aria-label="清除文件搜索" title="清除搜索" onclick={() => { query = ''; input?.focus(); }}>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m6 6 12 12M6 18 18 6"/></svg>
        </button>{/if}
      </div>
      <div bind:this={resultList} id="quick-open-results" role="listbox" aria-label="文件" class="quick-open-results">
        {#each results as item, index (item.key)}
          <button id={`quick-open-${index}`} role="option" aria-selected={index === selected} tabindex="-1"
            aria-disabled={!!openingPath} class="result" class:active={index === selected} class:opening={openingPath === item.path}
            onmousedown={event => event.preventDefault()} onclick={() => open(index)}>
            <svg class="file-icon" aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6"/></svg>
            <span class="result-text"><span class="result-name">{item.name}</span><small title={item.path}>{relativePath(item.path)}</small></span>
            <span class="result-kind" class:dirty={item.isDirty}>{openingPath === item.path ? '正在打开' : item.isDirty ? '未保存' : item.sessionId ? '已打开' : item.recentRank < 100000 ? '最近使用' : ''}</span>
          </button>
        {/each}
        {#if !results.length}<p role="status">{$workspaceIndex.status === 'indexing' ? '正在查找工作区文件…' : query.trim() ? '没有匹配的文件，试试文件名或路径片段。' : '可先打开文件或文件夹。'}</p>{/if}
      </div>
      <footer><span class="key-hints"><kbd>↑ ↓</kbd> 选择 <kbd>Enter</kbd> 打开 <kbd>Esc</kbd> {openingPath ? '取消' : '关闭'}</span>
        <span class="result-summary" role="status">{openingPath ? '正在打开…' : matches.length > results.length ? `前 ${results.length} / ${matches.length} 项` : `${results.length} 项`}</span>
      </footer>
      {#if $workspaceIndex.root}<div class="index-status">
        <span role="status">{$workspaceIndex.detail || '准备工作区索引…'}</span>
        <button class="index-action" onclick={() => $workspaceIndex.status === 'indexing' ? WorkspaceIndex.cancel() : WorkspaceIndex.refresh()}>
          {$workspaceIndex.status === 'indexing' ? '取消索引' : '刷新索引'}
        </button>
      </div>{/if}
    </div>
  </div>
{/if}

<style>
  .quick-open-backdrop { position: fixed; inset: 0; z-index: 450; background: #0003; padding-top: 14vh; display: flex; justify-content: center; align-items: flex-start; }
  .quick-open { width: min(600px, calc(100vw - 24px)); max-height: calc(86dvh - 16px); display: flex; flex-direction: column; background: var(--ui-panel-active); color: var(--ui-text); border: 1px solid var(--ui-border); border-radius: 6px; box-shadow: var(--ui-shadow-popover); overflow: hidden; }
  .search-field { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--ui-border); }
  .search-field > svg { flex-shrink: 0; color: var(--ui-text-muted); }
  .search-field:focus-within { box-shadow: inset 0 -1px var(--ui-accent); }
  input { width: 100%; min-width: 0; padding: 4px 0; background: transparent; border: 0; outline: none; font-size: 16px; color: var(--ui-text); }
  input::placeholder { color: var(--ui-text-muted); }
  .quick-open-results { max-height: 45vh; min-height: 0; overflow: auto; padding: 6px; overscroll-behavior: contain; }
  button { display: block; text-align: left; width: 100%; border: 0; border-radius: 3px; background: transparent; padding: 8px 12px; cursor: pointer; min-width: 0; }
  button.result { display: flex; align-items: center; gap: 12px; min-height: 54px; }
  .file-icon { flex-shrink: 0; color: var(--ui-text-muted); }
  .result-text { flex: 1; min-width: 0; }
  .result-name, small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .result-name { font-size: 14px; line-height: 1.5; }
  .result-kind { flex-shrink: 0; color: var(--ui-text-muted); font-size: 11px; }
  .result-kind.dirty::before { content: ''; display: inline-block; width: 5px; height: 5px; margin-right: 5px; border-radius: 50%; background: currentColor; vertical-align: middle; }
  button.active, button:hover:not([aria-disabled="true"]) { background: var(--ui-panel-hover); }
  button[aria-disabled="true"] { cursor: progress; }
  button.opening { background: var(--ui-panel-hover); }
  button.clear-query { flex-shrink: 0; width: 26px; height: 26px; padding: 6px; color: var(--ui-text-muted); }
  small { color: var(--ui-text-muted); font-size: 11px; line-height: 1.5; }
  footer, p { padding: 10px 18px; color: var(--ui-text-muted); font-size: 12px; }
  footer { display: flex; justify-content: space-between; align-items: center; gap: 12px; border-top: 1px solid var(--ui-border); }
  footer, .search-field, .index-status { flex-shrink: 0; }
  .key-hints { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
  kbd { font: inherit; padding: 0 3px; color: var(--ui-text); }
  .result-summary { flex-shrink: 0; font-size: 11px; }
  .index-status { display: flex; align-items: center; gap: 8px; padding: 6px 18px 10px; border-top: 1px solid var(--ui-border); font-size: 11px; color: var(--ui-text-muted); }
  .index-status > span { min-width: 0; overflow-wrap: anywhere; }
  button.index-action { flex-shrink: 0; width: auto; padding: 4px 6px; font-size: 12px; }
  @media (max-height: 500px) { .quick-open-backdrop { padding-top: 16px; } .quick-open { max-height: calc(100dvh - 32px); } }
</style>
