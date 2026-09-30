<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { activeSessionId, fileContent } from '$lib/stores/document';
  import type { EditorContentEditRequest, EditorRevealRequest } from '$lib/types';

  let { visible = $bindable(false), mode = 'search' }: { visible?: boolean; mode?: 'search' | 'replace' } = $props();
  let searchQuery = $state('');
  let replaceText = $state('');
  let caseSensitive = $state(false);
  let currentMatch = $state(0);
  let matches = $state<Array<{ from: number; to: number }>>([]);
  let searchInput = $state<HTMLInputElement>();
  let focusTimer: ReturnType<typeof setTimeout> | null = null;
  const totalMatches = $derived(matches.length);

  function literalRegex(): RegExp | null {
    if (!searchQuery) return null;
    return new RegExp(searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'g' : 'gi');
  }

  function reveal(index = currentMatch) {
    const match = matches[index - 1];
    const id = $activeSessionId;
    if (!visible || !match || !id) return;
    const detail: EditorRevealRequest = {
      sessionId: id, ...match, line: $fileContent.slice(0, match.from).split('\n').length, focus: false,
    };
    window.dispatchEvent(new CustomEvent('editor-reveal-range', { detail }));
    void tick().then(() => searchInput?.focus({ preventScroll: true }));
  }

  function doSearch() {
    const regex = literalRegex();
    const found: Array<{ from: number; to: number }> = [];
    if (visible && regex && $fileContent) {
      for (const match of $fileContent.matchAll(regex)) {
        const from = match.index ?? 0;
        found.push({ from, to: from + match[0].length });
        if (found.length >= 10_000) break;
      }
    }
    matches = found;
    currentMatch = found.length ? Math.min(Math.max(currentMatch || 1, 1), found.length) : 0;
  }

  function prevMatch() {
    if (!totalMatches) return;
    currentMatch = currentMatch <= 1 ? totalMatches : currentMatch - 1;
    reveal();
  }
  function nextMatch() {
    if (!totalMatches) return;
    currentMatch = currentMatch >= totalMatches ? 1 : currentMatch + 1;
    reveal();
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
    if (!match) return;
    if (applyContent(content, content.slice(0, match.from) + replaceText + content.slice(match.to))) {
      void tick().then(() => { doSearch(); if (matches.length) reveal(Math.min(currentMatch, matches.length)); });
    }
  }

  function replaceAll() {
    const regex = literalRegex();
    const content = $fileContent;
    if (regex) applyContent(content, content.replace(regex, () => replaceText));
  }

  function close() {
    visible = false;
    matches = [];
    currentMatch = 0;
    if (focusTimer) clearTimeout(focusTimer);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.isComposing) return;
    if (event.key === 'Escape') close();
    else if (event.key === 'Enter' && event.shiftKey) { event.preventDefault(); prevMatch(); }
    else if (event.key === 'Enter') {
      event.preventDefault();
      if ((event.ctrlKey || event.metaKey) && mode === 'replace') replaceCurrent(); else nextMatch();
    }
  }

  $effect(() => {
    void searchQuery;
    void caseSensitive;
    void $fileContent;
    void $activeSessionId;
    untrack(doSearch);
  });
  $effect(() => {
    if (!visible) { matches = []; return; }
    if (focusTimer) clearTimeout(focusTimer);
    focusTimer = setTimeout(() => searchInput?.focus({ preventScroll: true }), 0);
    return () => { if (focusTimer) clearTimeout(focusTimer); };
  });
</script>

{#if visible}
  <div class="search-replace-panel" role="dialog" aria-label="搜索替换" tabindex="-1" onkeydown={handleKeydown}>
    <!-- 关闭按钮 -->
    <button class="close-btn" onclick={close} title="关闭 (Esc)">✕</button>

    <!-- 搜索行 -->
    <div class="search-row">
      <div class="input-group">
        <input
          bind:this={searchInput}
          type="text"
          class="search-input"
          placeholder="搜索"
          bind:value={searchQuery}
        />
        <span class="match-count">
          {#if totalMatches > 0}
            {currentMatch}/{totalMatches}
          {:else if searchQuery}
            无结果
          {/if}
        </span>
      </div>
      <div class="search-actions">
        <button class="action-btn" onclick={prevMatch} title="上一个 (Shift+Enter)" disabled={totalMatches === 0}>▲</button>
        <button class="action-btn" onclick={nextMatch} title="下一个 (Enter)" disabled={totalMatches === 0}>▼</button>
        <button class="action-btn" class:active={caseSensitive} onclick={() => caseSensitive = !caseSensitive} title="区分大小写">Aa</button>
      </div>
    </div>

    <!-- 替换行 -->
    {#if mode === 'replace'}
      <div class="replace-row">
        <div class="input-group">
          <input
            type="text"
            class="search-input"
            placeholder="替换"
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
    top: 0;
    right: 20px;
    z-index: 50;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-top: none;
    border-radius: 0 0 8px 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    padding: 8px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 360px;
  }

  .close-btn {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 20px;
    height: 20px;
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
    position: relative;
    display: flex;
    align-items: center;
  }

  .search-input {
    width: 100%;
    padding: 5px 8px;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 13px;
    font-family: var(--font-mono);
    outline: none;
    transition: border-color 0.15s;
  }

  .search-input:focus {
    border-color: var(--accent-color);
  }

  .match-count {
    position: absolute;
    right: 8px;
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
    border: 1px solid var(--border-color);
    border-radius: 4px;
    background: var(--bg-secondary);
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 11px;
    transition: all 0.1s;
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
    background: var(--accent-color);
    color: white;
    border-color: var(--accent-color);
  }

  .replace-btn {
    padding: 4px 8px;
    font-size: 11px;
  }
</style>
