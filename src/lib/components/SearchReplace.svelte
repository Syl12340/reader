<script lang="ts">
  import { fileContent } from '$lib/stores/document';

  let { visible = $bindable(false), mode = 'search' }: {
    visible?: boolean;
    mode?: 'search' | 'replace';
  } = $props();

  let searchQuery = $state('');
  let replaceText = $state('');
  let caseSensitive = $state(false);
  let currentMatch = $state(0);
  let totalMatches = $state(0);
  let matches: number[] = $state([]); // 字符偏移量数组
  let searchInput: HTMLInputElement | undefined = $state();

  // 搜索
  function doSearch() {
    const q = searchQuery;
    if (!q) {
      matches = [];
      totalMatches = 0;
      currentMatch = 0;
      return;
    }

    const content = $fileContent;
    if (!content) {
      matches = [];
      totalMatches = 0;
      currentMatch = 0;
      return;
    }

    const found: number[] = [];
    const flags = caseSensitive ? 'g' : 'gi';
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, flags);
    let m: RegExpExecArray | null;

    while ((m = regex.exec(content)) !== null) {
      found.push(m.index);
      if (found.length > 10000) break; // 安全限制
    }

    matches = found;
    totalMatches = found.length;

    if (totalMatches > 0) {
      // 如果当前匹配超出范围，重置到第一个
      if (currentMatch === 0 || currentMatch > totalMatches) {
        currentMatch = 1;
      }
      jumpToMatch();
    } else {
      currentMatch = 0;
    }
  }

  // 跳转到当前匹配
  function jumpToMatch() {
    if (matches.length === 0 || currentMatch < 1) return;
    const idx = matches[currentMatch - 1];
    const content = $fileContent;
    if (!content) return;

    // 通过 heading-click 事件通知编辑器跳转
    const before = content.slice(0, idx);
    const line = before.split('\n').length;
    window.dispatchEvent(new CustomEvent('heading-click', { detail: { line } }));
  }

  // 上一个匹配
  function prevMatch() {
    if (totalMatches === 0) return;
    currentMatch = currentMatch <= 1 ? totalMatches : currentMatch - 1;
    jumpToMatch();
  }

  // 下一个匹配
  function nextMatch() {
    if (totalMatches === 0) return;
    currentMatch = currentMatch >= totalMatches ? 1 : currentMatch + 1;
    jumpToMatch();
  }

  // 替换当前匹配
  function replaceCurrent() {
    if (totalMatches === 0 || currentMatch < 1) return;
    const idx = matches[currentMatch - 1];
    const content = $fileContent;
    if (!content) return;

    const flags = caseSensitive ? '' : 'i';
    const escaped = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp('^' + escaped, flags);
    const match = regex.exec(content.slice(idx));
    const matchLength = match ? match[0].length : searchQuery.length;

    window.dispatchEvent(new CustomEvent('editor-replace-range', {
      detail: { from: idx, to: idx + matchLength, text: replaceText },
    }));

    // 重新搜索
    setTimeout(doSearch, 50);
  }

  // 全部替换
  function replaceAll() {
    if (totalMatches === 0) return;
    const content = $fileContent;
    if (!content) return;

    const flags = caseSensitive ? 'g' : 'gi';
    const escaped = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, flags);
    const newContent = content.replace(regex, replaceText);
    window.dispatchEvent(new CustomEvent('editor-replace-range', {
      detail: { from: 0, to: content.length, text: newContent },
    }));

    // 重新搜索
    setTimeout(doSearch, 50);
  }

  // 关闭
  function close() {
    visible = false;
    matches = [];
    totalMatches = 0;
    currentMatch = 0;
  }

  // 键盘事件
  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      close();
    } else if (event.key === 'Enter' && !event.shiftKey) {
      if (event.ctrlKey || event.metaKey) {
        // Ctrl+Enter = 替换当前
        if (mode === 'replace') replaceCurrent();
      } else {
        nextMatch();
      }
    } else if (event.key === 'Enter' && event.shiftKey) {
      prevMatch();
    }
  }

  // 当 visible 变化时聚焦搜索框
  $effect(() => {
    if (visible && searchInput) {
      setTimeout(() => searchInput?.focus(), 50);
    }
  });

  // 搜索内容变化时重新搜索
  $effect(() => {
    const _ = searchQuery;
    const __ = caseSensitive;
    if (searchQuery) doSearch();
    else { matches = []; totalMatches = 0; currentMatch = 0; }
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
