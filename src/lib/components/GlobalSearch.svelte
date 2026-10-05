<script lang="ts">
  import { fileContent, currentFile } from '$lib/stores/document';

  let { onLineSelect }: {
    onLineSelect?: (line: number) => void;
  } = $props();

  let query = $state('');
  let caseSensitive = $state(false);
  let results = $state<Array<{ line: number; column: number; context: string }>>([]);
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  function handleSearch() {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      search();
    }, 150);
  }

  function search() {
    const q = query.trim();
    if (!q) {
      results = [];
      return;
    }

    const content = $fileContent;
    if (!content) {
      results = [];
      return;
    }

    const lines = content.split('\n');
    const found: Array<{ line: number; column: number; context: string }> = [];
    const flags = caseSensitive ? 'g' : 'gi';
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, flags);

    for (let i = 0; i < lines.length; i++) {
      const match = regex.exec(lines[i]);
      if (match) {
        // 截取上下文
        const col = match.index;
        const start = Math.max(0, col - 30);
        const end = Math.min(lines[i].length, col + q.length + 30);
        const context = (start > 0 ? '...' : '') + lines[i].slice(start, end) + (end < lines[i].length ? '...' : '');
        found.push({ line: i + 1, column: col + 1, context });
      }
      regex.lastIndex = 0;
    }

    results = found;
  }

  function highlightMatch(text: string, q: string): string {
    if (!q) return escapeHtml(text);
    const escaped = escapeHtml(text);
    const escapedQuery = escapeHtml(q);
    const flags = caseSensitive ? 'g' : 'gi';
    const regex = new RegExp(`(${escapedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, flags);
    return escaped.replace(regex, '<mark class="search-highlight">$1</mark>');
  }

  function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function handleResultClick(line: number) {
    onLineSelect?.(line);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      search();
    }
  }
</script>

<div class="global-search">
  <div class="search-input-wrapper">
    <input
      type="text"
      class="search-input"
      placeholder="搜索当前文件..."
      bind:value={query}
      oninput={handleSearch}
      onkeydown={handleKeydown}
    />
  </div>

  <div class="search-options">
    <label class="search-option">
      <input type="checkbox" bind:checked={caseSensitive} onchange={search} />
      <span>区分大小写</span>
    </label>
  </div>

  {#if results.length > 0}
    <div class="search-results">
      <div class="search-results-header">
        找到 {results.length} 个结果
      </div>
      {#each results as result}
        <button
          class="search-result-item"
          onclick={() => handleResultClick(result.line)}
        >
          <span class="search-result-line">行 {result.line}</span>
          <span class="search-result-context">
            {@html highlightMatch(result.context, query)}
          </span>
        </button>
      {/each}
    </div>
  {:else if query.trim()}
    <div class="search-empty">未找到匹配结果</div>
  {:else}
    <div class="search-hint">输入关键词搜索当前文件内容</div>
  {/if}
</div>

<style>
  .global-search {
    padding: 8px;
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .search-input-wrapper {
    position: relative;
    margin-bottom: 6px;
  }

  .search-input {
    width: 100%;
    padding: 8px 12px;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    background: var(--bg-primary);
    color: var(--text-primary);
    font-size: 13px;
    outline: none;
    transition: border-color 0.2s;
  }

  .search-input:focus {
    border-color: var(--accent-color);
  }

  .search-options {
    display: flex;
    gap: 12px;
    margin-bottom: 8px;
    padding: 0 4px;
  }

  .search-option {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .search-option input[type="checkbox"] {
    width: 14px;
    height: 14px;
    cursor: pointer;
  }

  .search-results {
    flex: 1;
    overflow-y: auto;
  }

  .search-results-header {
    font-size: 11px;
    color: var(--text-tertiary);
    padding: 4px 8px;
    margin-bottom: 4px;
  }

  .search-result-item {
    display: flex;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    border: none;
    border-radius: 6px;
    background: transparent;
    text-align: left;
    cursor: pointer;
    transition: background 0.1s;
  }

  .search-result-item:hover {
    background: var(--bg-tertiary);
  }

  .search-result-line {
    font-size: 11px;
    font-weight: 600;
    color: var(--accent-color);
    white-space: nowrap;
    min-width: 40px;
  }

  .search-result-context {
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.4;
    word-break: break-all;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.search-highlight) {
    background: color-mix(in srgb, var(--ui-accent) 20%, transparent);
    color: var(--accent-color);
    padding: 0 2px;
    border-radius: 2px;
  }

  .search-empty,
  .search-hint {
    font-size: 12px;
    color: var(--text-tertiary);
    text-align: center;
    padding: 16px 8px;
  }
</style>
