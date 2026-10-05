<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { activeSessionId, fileContent } from '$lib/stores/document';
  import type { EditorContentEditRequest, EditorRevealRequest } from '$lib/types';
  import { searchPattern, searchMatches, replaceSearchMatch } from '$lib/utils/search';
  import { focusDocumentSurface } from '$lib/utils/document-focus';

  let { visible = $bindable(false), mode = 'search' }: { visible?: boolean; mode?: 'search' | 'replace' } = $props();
  let searchQuery = $state('');
  let replaceText = $state('');
  let caseSensitive = $state(false);
  let wholeWord = $state(false);
  let useRegex = $state(false);
  let searchError = $state('');
  let limited = $state(false);
  let currentMatch = $state(0);
  let matches = $state<Array<{ from: number; to: number }>>([]);
  let searchInput = $state<HTMLInputElement>();
  let focusTimer: ReturnType<typeof setTimeout> | null = null;
  let previousFocus: HTMLElement | null = null;
  const totalMatches = $derived(matches.length);

  function literalRegex(): RegExp | null {
    try {
      searchError = '';
      return searchPattern(searchQuery, { caseSensitive, wholeWord, useRegex });
    } catch (error) {
      searchError = error instanceof Error ? error.message : 'Invalid regular expression';
      return null;
    }
  }

  function reveal(index = currentMatch, focusSearch = false) {
    const match = matches[index - 1];
    const id = $activeSessionId;
    if (!visible || !match || !id) return;
    const detail: EditorRevealRequest = {
      sessionId: id, ...match, line: $fileContent.slice(0, match.from).split('\n').length, focus: false,
    };
    window.dispatchEvent(new CustomEvent('editor-reveal-range', { detail }));
    if (focusSearch) void tick().then(() => searchInput?.focus({ preventScroll: true }));
  }

  function doSearch() {
    const regex = literalRegex();
    const result = searchMatches(visible ? $fileContent : '', regex);
    const found = result.matches;
    limited = result.limited;
    matches = found;
    currentMatch = found.length ? Math.min(Math.max(currentMatch || 1, 1), found.length) : 0;
    if (visible && !found.length) window.dispatchEvent(new CustomEvent('preview-search-clear'));
  }

  function prevMatch() {
    if (!totalMatches) return;
    currentMatch = currentMatch <= 1 ? totalMatches : currentMatch - 1;
    reveal(currentMatch, true);
  }
  function nextMatch() {
    if (!totalMatches) return;
    currentMatch = currentMatch >= totalMatches ? 1 : currentMatch + 1;
    reveal(currentMatch, true);
  }

  function applyContent(expectedContent: string, content: string): boolean {
    const id = $activeSessionId;
    if (!id || content === expectedContent) return false;
    const detail: EditorContentEditRequest = { sessionId: id, expectedContent, content, applied: false };
    window.dispatchEvent(new CustomEvent('editor-replace-content', { detail }));
    return detail.applied;
  }

  function replaceCurrent() {
    const match = matches[currentMatch - 1];
    const content = $fileContent;
    const pattern = literalRegex();
    if (!match || !pattern) return;
    const replacement = replaceSearchMatch(content, pattern, match, replaceText, useRegex);
    if (replacement !== null && applyContent(content, replacement)) {
      void tick().then(() => { doSearch(); if (matches.length) reveal(Math.min(currentMatch, matches.length), true); });
    }
  }

  function replaceAll() {
    const regex = literalRegex();
    const content = $fileContent;
    if (regex) applyContent(content, useRegex ? content.replace(regex, replaceText) : content.replace(regex, () => replaceText));
  }

  function close() {
    visible = false;
    matches = [];
    currentMatch = 0;
    window.dispatchEvent(new CustomEvent('preview-search-clear'));
    if (focusTimer) clearTimeout(focusTimer);
    void tick().then(() => {
      if (previousFocus?.isConnected && previousFocus.getClientRects().length && getComputedStyle(previousFocus).visibility !== 'hidden') {
        previousFocus.focus({ preventScroll: true });
      } else focusDocumentSurface();
    });
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    else if (event.key === 'Enter' && event.shiftKey) { event.preventDefault(); prevMatch(); }
    else if (event.key === 'Enter') {
      event.preventDefault();
      if ((event.ctrlKey || event.metaKey) && mode === 'replace') replaceCurrent(); else nextMatch();
    }
  }

  $effect(() => {
    void searchQuery;
    void caseSensitive;
    void wholeWord;
    void useRegex;
    void visible;
    void $activeSessionId;
    untrack(() => { currentMatch = 0; doSearch(); });
    if (visible) untrack(() => reveal());
  });
  $effect(() => { void $fileContent; untrack(doSearch); });
  $effect(() => {
    if (!visible) { matches = []; return; }
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (focusTimer) clearTimeout(focusTimer);
    focusTimer = setTimeout(() => searchInput?.focus({ preventScroll: true }), 0);
    return () => { if (focusTimer) clearTimeout(focusTimer); };
  });
</script>

{#if visible}
  <div class="search-replace-panel" role="dialog" aria-label="搜索替换" tabindex="-1" onkeydown={handleKeydown}>
    <div class="panel-header"><span>{mode === 'replace' ? '查找与替换' : '查找'}</span><button class="close-btn" onclick={close} aria-label="关闭查找" title="关闭 (Esc)">×</button></div>

    <!-- 搜索行 -->
    <div class="search-row">
      <div class="input-group">
        <input
          bind:this={searchInput}
          type="text"
          class="search-input"
          placeholder="搜索"
          aria-label="查找文本"
          bind:value={searchQuery}
        />
        <span class="match-count" role="status">
          {#if totalMatches > 0}
            {currentMatch}/{totalMatches}{limited ? '+' : ''}
          {:else if searchQuery}
            无结果
          {/if}
        </span>
      </div>
      <div class="search-actions">
        <button class="action-btn" onclick={prevMatch} title="上一个 (Shift+Enter)" disabled={totalMatches === 0}>▲</button>
        <button class="action-btn" onclick={nextMatch} title="下一个 (Enter)" disabled={totalMatches === 0}>▼</button>
        <button class="action-btn" class:active={caseSensitive} aria-pressed={caseSensitive} onclick={() => caseSensitive = !caseSensitive} title="区分大小写">Aa</button>
        <button class="action-btn" class:active={wholeWord} aria-pressed={wholeWord} onclick={() => wholeWord = !wholeWord} title="整词">W</button>
        <button class="action-btn" class:active={useRegex} aria-pressed={useRegex} onclick={() => useRegex = !useRegex} title="正则表达式">.*</button>
      </div>
    </div>

    {#if searchError}<p class="search-error" role="status">{searchError}</p>{/if}
    <!-- 替换行 -->
    {#if mode === 'replace'}
      <div class="replace-row">
        <div class="input-group">
          <input
            type="text"
            class="search-input"
            placeholder="替换"
            aria-label="替换为"
            bind:value={replaceText}
          />
        </div>
        <div class="search-actions">
          <button class="action-btn replace-btn" onclick={replaceCurrent} title="替换 (Ctrl+Enter)" disabled={totalMatches === 0}>替换</button>
          <button class="action-btn replace-btn" onclick={replaceAll} title="全部替换" disabled={totalMatches === 0}>全部</button>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .search-replace-panel {
    position: absolute;
    top: 8px;
    right: 12px;
    z-index: 50;
    background: var(--ui-panel-active);
    border: 1px solid var(--ui-border);
    border-radius: 6px;
    box-shadow: var(--ui-shadow-popover);
    padding: 8px 10px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: min(460px, calc(100% - 24px));
    min-width: 0;
  }
  .panel-header { display: flex; align-items: center; justify-content: space-between; min-height: 24px; font-size: 12px; color: var(--ui-text-muted); }
  .search-error { max-width: 100%; margin: 0; color: var(--syntax-error); font-size: 12px; overflow-wrap: anywhere; }

  .close-btn {
    width: 24px;
    height: 24px;
    border: none;
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 3px;
  }

  .close-btn:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .search-row,
  .replace-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .input-group {
    flex: 1;
    min-width: 0;
    position: relative;
    display: flex;
    align-items: center;
  }

  .search-input {
    width: 100%;
    padding: 6px 8px;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    background: var(--ui-panel);
    color: var(--text-primary);
    font-size: 13px;
    font-family: var(--font-ui);
    outline: none;
    transition: border-color 0.15s;
  }

  .search-input:focus {
    border-color: var(--accent-color);
  }

  .match-count {
    flex-shrink: 0;
    padding: 0 6px;
    font-size: 11px;
    color: var(--text-tertiary);
    pointer-events: none;
  }

  .search-actions {
    display: flex;
    gap: 2px;
  }

  .action-btn {
    padding: 4px 6px;
    border: 1px solid transparent;
    border-radius: 4px;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 11px;
    transition: background-color 0.1s;
    white-space: nowrap;
  }

  .action-btn:hover:not(:disabled) {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .action-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .action-btn.active {
    background: var(--ui-panel-hover);
    color: var(--ui-text);
    border-color: var(--ui-border);
  }

  .replace-btn {
    padding: 4px 8px;
    font-size: 11px;
  }
  @media (max-width: 600px) {
    .search-row, .replace-row { flex-wrap: wrap; }
    .input-group { flex-basis: 100%; }
    .search-actions { margin-left: auto; }
  }
</style>
