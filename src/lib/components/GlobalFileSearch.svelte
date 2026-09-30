<script lang="ts">
  import { onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { activeSessionId, currentFile, fileContent, sessions } from '$lib/stores/document';
  import type { EditorContentEditRequest } from '$lib/types';
  import { currentDirectory } from '$lib/stores/file';
  import { isTauri } from '$lib/utils/platform';
  import { DocumentService } from '$lib/services/document';
  import { normalizePathKey } from '$lib/utils/path';
  import { asFileError } from '$lib/utils/file-error';
  import ReplacePreview from './ReplacePreview.svelte';
  import type { FileReplacementPreview } from '$lib/utils/change-preview';
  import type { ContentSearchResult } from '$lib/utils/tauri-fs';

  let { onFileSelect }: {
    onFileSelect?: (path: string, line: number) => void;
  } = $props();

  // 搜索状态
  let query = $state('');
  let replaceText = $state('');
  let caseSensitive = $state(false);
  let useRegex = $state(false);
  let wholeWord = $state(false);
  let fileGlob = $state('*.md');
  let showReplace = $state(false);

  // 结果状态
  let results = $state<ContentSearchResult[]>([]);
  let isSearching = $state(false);
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let expandedFiles = $state<Set<string>>(new Set());
  let replaceStatus = $state('');
  let isReplacing = $state(false);
  let resultLimitReached = $state(false);
  let resultKey = $state('');
  let searchSequence = 0;
  let disposed = false;
  let replacementPreview = $state<FileReplacementPreview[] | null>(null);
  let previewWarnings = $state<string[]>([]);
  let finishReview: ((items: FileReplacementPreview[] | null) => void) | null = null;

  function resolveReview(items: FileReplacementPreview[] | null) {
    const resolve = finishReview;
    finishReview = null;
    replacementPreview = null;
    resolve?.(items);
  }
  const searchKey = $derived(JSON.stringify([query, caseSensitive, useRegex, wholeWord, fileGlob,
    $currentDirectory || extractDir($currentFile || '')]));

  $effect(() => {
    void searchKey;
    handleSearch();
  });
  onDestroy(() => {
    disposed = true;
    searchSequence++;
    if (searchTimer) clearTimeout(searchTimer);
    resolveReview(null);
  });

  // 按文件分组的结果
  let groupedResults = $derived.by(() => {
    const groups = new Map<string, typeof results>();
    for (const r of results) {
      const existing = groups.get(r.file) || [];
      existing.push(r);
      groups.set(r.file, existing);
    }
    return Array.from(groups.entries()).map(([file, matches]) => ({
      file,
      fileName: file.split(/[/\\]/).pop() || file,
      matches,
      expanded: expandedFiles.has(file)
    }));
  });

  let totalMatches = $derived(results.length);
  let totalFiles = $derived(groupedResults.length);

  function handleSearch() {
    resolveReview(null);
    searchSequence++;
    resultKey = '';
    results = [];
    replaceStatus = '';
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(search, 300);
  }

  function buildRegex(): RegExp | null {
    const q = query.trim();
    if (!q) return null;

    try {
      const pattern = useRegex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(wholeWord ? `\\b(?:${pattern})\\b` : pattern, caseSensitive ? 'g' : 'gi');
    } catch {
      return null;
    }
  }

  function selectedExtensions(): string[] | undefined {
    const value = fileGlob.trim();
    if (!value || value === '*') return undefined;
    const extensions = [...value.matchAll(/\.([a-zA-Z0-9_-]+)/g)]
      .map(match => match[1].toLowerCase());
    return extensions.length > 0 ? [...new Set(extensions)] : undefined;
  }

  async function search() {
    if (disposed) return;
    if (searchTimer) clearTimeout(searchTimer);
    const sequence = ++searchSequence;
    const key = searchKey;
    const searchQuery = query.trim();
    const options = { caseSensitive, useRegex, wholeWord, extensions: selectedExtensions() };
    resultKey = '';
    isSearching = false;
    if (!searchQuery) {
      results = [];
      return;
    }

    const dir = $currentDirectory || extractDir($currentFile || '');
    if (!dir) {
      results = [];
      return;
    }

    isSearching = true;
    try {
      if (isTauri()) {
        const { searchContent } = await import('$lib/utils/tauri-fs');
        const found = await searchContent(dir, searchQuery, 1001, options);
        if (disposed || sequence !== searchSequence || key !== searchKey) return;
        resultLimitReached = found.length > 1000;
        results = found.slice(0, 1000);
        resultKey = key;
      } else {
        results = [];
        replaceStatus = '浏览器模式暂不支持目录内容搜索';
      }
    } catch (err) {
      if (disposed || sequence !== searchSequence || key !== searchKey) return;
      console.warn('Search failed:', err);
      results = [];
      replaceStatus = `搜索失败: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      if (!disposed && sequence === searchSequence) isSearching = false;
    }
  }

  // 跨文件替换
  async function replaceAllInFiles() {
    if (!query.trim() || !isTauri() || isReplacing || isSearching || resultKey !== searchKey) return;
    const replacement = replaceText;
    const key = searchKey;
    const searchQuery = query.trim();
    const options = { caseSensitive, useRegex, wholeWord };
    const paths = groupedResults.map(group => group.file);
    if (!paths.length) return;
    isReplacing = true;
    replaceStatus = '读取替换预览...';
    previewWarnings = [];
    let saved = 0, matches = 0, skipped = 0, conflicts = 0, failed = 0;
    try {
      const { readFile, previewReplacement } = await import('$lib/utils/tauri-fs');
      const preview: FileReplacementPreview[] = [];
      let previewSize = 0;
      for (const path of paths) {
        if (disposed || key !== searchKey || replacement !== replaceText) return;
        const open = get(sessions).find(s => s.path && normalizePathKey(s.path) === normalizePathKey(path));
        if (open?.isDirty || open?.externalModified) { skipped++; continue; }
        try {
          const expected = await readFile(path);
          const { content, count } = await previewReplacement(expected, searchQuery, replacement, options);
          if (content !== expected) {
            previewSize += expected.length + content.length;
            if (preview.length >= 100 || previewSize > 4 * 1024 * 1024) {
              replaceStatus = '预览超过 100 文件或 4M 字符上限，请缩小搜索范围。文件未修改。';
              return;
            }
            preview.push({ path, expected, content, count });
          }
          else skipped++;
        } catch (error) {
          failed++;
          if (previewWarnings.length < 20) previewWarnings = [...previewWarnings, `${path}: ${String(error)}`];
        }
      }
      if (disposed || key !== searchKey || replacement !== replaceText) return;
      if (!preview.length) {
        replaceStatus = `没有可替换文件；跳过 ${skipped}，读取或表达式失败 ${failed}`;
        return;
      }
      replaceStatus = `等待审阅；跳过 ${skipped}，预览失败 ${failed}`;
      const selected = await new Promise<FileReplacementPreview[] | null>(resolve => {
        finishReview = resolve;
        replacementPreview = preview;
      });
      if (!selected || disposed || key !== searchKey || replacement !== replaceText) {
        replaceStatus = '已取消或搜索条件已改变，文件未修改';
        return;
      }
      skipped += preview.length - selected.length;
      replaceStatus = '正在保存恢复点并替换...';
      for (const item of selected) {
        if (disposed) break;
        try {
          const result = await DocumentService.replaceDiskContent(item.path, item.expected, item.content);
          if (result === 'saved') { saved++; matches += item.count; }
          else skipped++;
        } catch (error) {
          if (asFileError(error).code === 'conflict') conflicts++;
          else failed++;
        }
      }
      await search();
      replaceStatus = `成功 ${saved} 文件 / ${matches} 处；跳过 ${skipped}，冲突 ${conflicts}，失败 ${failed}`;
    } catch (err) {
      replaceStatus = `替换失败: ${err}`;
    } finally {
      isReplacing = false;
    }
  }

  // 替换当前文件中的匹配
  async function replaceInCurrentFile() {
    if (!query.trim() || !$activeSessionId || isReplacing) return;
    const id = $activeSessionId;
    const expected = $fileContent;
    const key = searchKey;
    const replacement = replaceText;
    const options = { caseSensitive, useRegex, wholeWord };
    const searchQuery = query.trim();
    isReplacing = true;

    try {
      let newContent: string;
      if (isTauri()) {
        const { previewReplacement } = await import('$lib/utils/tauri-fs');
        newContent = (await previewReplacement(expected, searchQuery, replacement, options)).content;
      } else {
        const regex = buildRegex();
        if (!regex) throw new Error('无效的浏览器正则表达式');
        newContent = useRegex ? expected.replace(regex, replacement) : expected.replace(regex, () => replacement);
      }
      if (disposed || id !== $activeSessionId || key !== searchKey || replacement !== replaceText) return;
      if (newContent !== expected) {
        const detail: EditorContentEditRequest = {
          sessionId: id,
          expectedContent: expected,
          content: newContent,
          applied: false,
        };
        window.dispatchEvent(new CustomEvent('editor-replace-content', { detail }));
        if (!detail.applied) {
          replaceStatus = '文档已变化或编辑器未就绪，请重试';
          return;
        }
        replaceStatus = '已替换当前文件';
        await search();
        replaceStatus = '已替换当前文件，可撤销';
      }
    } catch (err) {
      replaceStatus = `替换失败: ${err}`;
    } finally {
      isReplacing = false;
    }
  }

  function extractDir(filePath: string): string {
    const sep = filePath.includes('\\') ? '\\' : '/';
    const parts = filePath.split(sep);
    parts.pop();
    return parts.join(sep);
  }

  function toggleFile(file: string) {
    if (expandedFiles.has(file)) {
      expandedFiles.delete(file);
    } else {
      expandedFiles.add(file);
    }
    expandedFiles = new Set(expandedFiles);
  }

  function expandAll() {
    expandedFiles = new Set(groupedResults.map(g => g.file));
  }

  function collapseAll() {
    expandedFiles = new Set();
  }

  function highlightMatch(text: string, q: string, from?: number, to?: number): string {
    if (!q) return escapeHtml(text);
    if (isTauri()) {
      if (from === undefined || to === undefined || from < 0 || to < from || to > text.length) return escapeHtml(text);
      return `${escapeHtml(text.slice(0, from))}<mark class="search-highlight">${escapeHtml(text.slice(from, to))}</mark>${escapeHtml(text.slice(to))}`;
    }
    try {
      const regex = buildRegex();
      if (!regex) return escapeHtml(text);
      let output = '', previous = 0;
      for (const match of text.matchAll(regex)) {
        const index = match.index ?? 0;
        output += escapeHtml(text.slice(previous, index));
        output += `<mark class="search-highlight">${escapeHtml(match[0])}</mark>`;
        previous = index + match[0].length;
      }
      return output + escapeHtml(text.slice(previous));
    } catch {
      return escapeHtml(text);
    }
  }

  function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      search();
    } else if (event.key === 'Escape') {
      query = '';
      results = [];
    }
  }
</script>

<div class="global-file-search">
  <!-- 搜索选项 -->
  <div class="search-options">
    <label class="search-option" title="区分大小写">
      <input type="checkbox" bind:checked={caseSensitive} onchange={search} />
      <span>Aa</span>
    </label>
    <label class="search-option" title="全字匹配">
      <input type="checkbox" bind:checked={wholeWord} onchange={search} />
      <span>Ab</span>
    </label>
    <label class="search-option" title="正则表达式">
      <input type="checkbox" bind:checked={useRegex} onchange={search} />
      <span>.*</span>
    </label>
    <button class="search-option-btn" onclick={() => showReplace = !showReplace} title="切换替换">
      {showReplace ? '▼' : '▶'} 替换
    </button>
  </div>

  <!-- 搜索框 -->
  <div class="search-input-wrapper">
    <input
      type="text"
      class="search-input"
      placeholder={useRegex ? "正则表达式搜索..." : "搜索所有文件..."}
      bind:value={query}
      oninput={handleSearch}
      onkeydown={handleKeydown}
    />
  </div>

  <!-- 文件过滤 -->
  <div class="search-filter">
    <input
      type="text"
      class="filter-input"
      placeholder="文件过滤 (如 *.md)"
      bind:value={fileGlob}
      oninput={handleSearch}
    />
  </div>

  <!-- 替换框 -->
  {#if showReplace}
    <div class="replace-wrapper">
      <input
        type="text"
        class="search-input"
        placeholder="替换为..."
        bind:value={replaceText}
      />
      <div class="replace-actions">
        <button class="replace-btn" disabled={isReplacing || !$activeSessionId} onclick={replaceInCurrentFile} title="替换当前文件">
          替换
        </button>
        <button class="replace-btn replace-all" disabled={isReplacing || isSearching || resultKey !== searchKey || totalFiles === 0} onclick={replaceAllInFiles} title="预览并替换当前搜索结果涉及的文件，不代表整个目录">
          {isReplacing ? '替换中...' : '替换结果文件'}
        </button>
      </div>
      <p class="search-scope">{isTauri() ? '桌面端按行匹配；正则替换支持 $1、${name}、$$，普通搜索按字面替换。' : '浏览器当前文件替换使用 JavaScript 正则，目录搜索不可用。'}</p>
    </div>
  {/if}

  <!-- 状态栏 -->
  <p class="search-scope" role="status">{resultLimitReached ? '结果超过 1000 条，仅显示前 1000 条。' : ''}目录扫描上限 5000 项；批量替换仅覆盖结果文件。</p>
  <div class="search-status">
    {#if isSearching}
      <span>搜索中...</span>
    {:else if replaceStatus}
      <span>{replaceStatus}</span>
    {:else if totalMatches > 0}
      <span>{totalMatches} 个结果 · {totalFiles} 个文件</span>
      <div class="status-actions">
        <button onclick={expandAll} title="全部展开">展开</button>
        <button onclick={collapseAll} title="全部折叠">折叠</button>
      </div>
    {:else if query.trim()}
      <span>未找到结果</span>
    {/if}
  </div>

  <!-- 搜索结果 -->
  {#if groupedResults.length > 0}
    <div class="search-results">
      {#each groupedResults as group}
        <div class="file-group">
          <button class="file-header" onclick={() => toggleFile(group.file)}>
            <span class="file-expand">{group.expanded ? '▼' : '▶'}</span>
            <span class="file-name">{group.fileName}</span>
            <span class="file-count">{group.matches.length}</span>
          </button>
          {#if group.expanded}
            <div class="file-matches">
              {#each group.matches as match}
                <button
                  class="match-item"
                  onclick={() => onFileSelect?.(match.file, match.line)}
                >
                  <span class="match-line">行 {match.line}</span>
                  <span class="match-context">
                    {@html highlightMatch(match.context, query, match.matchStart, match.matchEnd)}
                  </span>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {:else if !query.trim()}
    <div class="search-hint">
      <p>输入关键词搜索项目中所有文件</p>
      <p class="hint-tips">支持正则表达式、全字匹配、文件过滤</p>
    </div>
  {/if}
</div>

{#if replacementPreview}
  <ReplacePreview items={replacementPreview} warnings={previewWarnings} onConfirm={resolveReview} onCancel={() => resolveReview(null)} />
{/if}

<style>
  .global-file-search {
    padding: 8px;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .search-options {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .search-option {
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: 11px;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
    border: 1px solid transparent;
  }

  .search-option:hover {
    background: var(--bg-secondary);
  }

  .search-option:has(input:checked) {
    background: var(--bg-tertiary);
    border-color: var(--border-color);
    color: var(--accent-color);
  }

  .search-option input[type="checkbox"] {
    width: 12px;
    height: 12px;
    accent-color: var(--accent-color);
  }

  .search-option-btn {
    font-size: 11px;
    color: var(--text-secondary);
    background: none;
    border: none;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
    margin-left: auto;
  }

  .search-option-btn:hover {
    background: var(--bg-secondary);
  }

  .search-input-wrapper {
    position: relative;
  }

  .search-input,
  .filter-input {
    width: 100%;
    padding: 6px 10px;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    background: var(--bg-primary);
    color: var(--text-primary);
    font-size: 12px;
    font-family: var(--font-mono);
    outline: none;
    transition: border-color 0.15s;
  }

  .search-input:focus,
  .filter-input:focus {
    border-color: var(--accent-color);
  }

  .filter-input {
    font-size: 11px;
    padding: 4px 8px;
  }

  .search-filter {
    margin-bottom: 2px;
  }

  .replace-wrapper {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .replace-actions {
    display: flex;
    gap: 4px;
  }

  .replace-btn {
    padding: 4px 8px;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 11px;
    cursor: pointer;
  }

  .replace-btn:hover {
    background: var(--bg-tertiary);
  }

  .replace-btn.replace-all {
    background: var(--accent-color);
    color: white;
    border-color: var(--accent-color);
  }

  .replace-btn.replace-all:hover {
    opacity: 0.9;
  }

  .search-status {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 11px;
    color: var(--text-tertiary);
    padding: 0 2px;
  }

  .status-actions {
    display: flex;
    gap: 8px;
  }

  .status-actions button {
    background: none;
    border: none;
    color: var(--text-secondary);
    font-size: 11px;
    cursor: pointer;
    padding: 0;
  }

  .status-actions button:hover {
    color: var(--accent-color);
  }

  .search-results {
    flex: 1;
    overflow-y: auto;
  }

  .file-group {
    margin-bottom: 2px;
  }

  .file-header {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 5px 6px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text-primary);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    text-align: left;
  }

  .file-header:hover {
    background: var(--bg-secondary);
  }

  .file-expand {
    font-size: 8px;
    color: var(--text-tertiary);
    width: 10px;
  }

  .file-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-count {
    font-size: 10px;
    color: var(--text-tertiary);
    background: var(--bg-tertiary);
    padding: 1px 5px;
    border-radius: 8px;
  }

  .file-matches {
    padding-left: 16px;
  }

  .match-item {
    display: flex;
    align-items: baseline;
    gap: 6px;
    width: 100%;
    padding: 3px 6px;
    border: none;
    border-radius: 3px;
    background: transparent;
    color: var(--text-secondary);
    font-size: 11px;
    cursor: pointer;
    text-align: left;
  }

  .match-item:hover {
    background: var(--bg-tertiary);
  }

  .match-line {
    font-size: 10px;
    font-weight: 600;
    color: var(--accent-color);
    white-space: nowrap;
    min-width: 32px;
  }

  .match-context {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: 10px;
  }

  :global(.search-highlight) {
    background: rgba(var(--accent-rgb), 0.25);
    color: var(--accent-color);
    padding: 0 1px;
    border-radius: 2px;
  }

  .search-hint {
    text-align: center;
    padding: 24px 16px;
    color: var(--text-tertiary);
    font-size: 12px;
  }

  .hint-tips {
    font-size: 11px;
    margin-top: 8px;
    opacity: 0.7;
  }
</style>
