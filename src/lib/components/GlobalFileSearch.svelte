<script lang="ts">
  import { searchExtensions, searchPattern } from '$lib/utils/search';
  import { onDestroy, untrack } from 'svelte';
  import { get } from 'svelte/store';
  import { activeSessionId, currentFile, fileContent, sessions } from '$lib/stores/document';
  import type { EditorContentEditRequest } from '$lib/types';
  import { currentDirectory } from '$lib/stores/file';
  import { isTauri } from '$lib/utils/platform';
  import { DocumentService } from '$lib/services/document';
  import { notify } from '$lib/services/interaction';
  import { normalizePathKey, pathContains } from '$lib/utils/path';
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
  let criteriaRevision = 0;
  let searchTask: Promise<void> | null = null;
  let composing = $state(false);
  let searchStatus = $state('');
  let expansionKey = '';
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
  const directory = $derived($currentDirectory || extractDir($currentFile || ''));
  const filter = $derived.by(() => {
    try { return { extensions: searchExtensions(fileGlob), error: '' }; }
    catch (error) { return { extensions: undefined, error: error instanceof Error ? error.message : String(error) }; }
  });
  const searchKey = $derived(JSON.stringify([query, caseSensitive, useRegex, wholeWord, fileGlob, directory]));

  $effect(() => {
    void searchKey;
    const shouldSchedule = !composing;
    untrack(() => handleSearch(shouldSchedule));
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

  function handleSearch(shouldSchedule = true) {
    resolveReview(null);
    criteriaRevision++;
    searchSequence++;
    resultKey = '';
    results = [];
    resultLimitReached = false;
    replaceStatus = '';
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = null;
    searchStatus = filter.error || (!isTauri() ? '目录内容搜索仅在桌面版可用；浏览器可替换当前文档。'
      : !directory ? '打开文件夹或已保存文档后搜索目录内容。' : '');
    isSearching = shouldSchedule && !!query && !searchStatus;
    if (isSearching) searchTimer = setTimeout(() => { void search(); }, 300);
  }

  function buildRegex(): RegExp | null {
    const q = query;
    if (!q) return null;

    try {
      return searchPattern(q, { useRegex, wholeWord, caseSensitive });
    } catch {
      return null;
    }
  }

  async function search() {
    if (disposed || composing) return;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = null;
    const sequence = ++searchSequence;
    const key = searchKey;
    const searchQuery = query;
    const dir = directory;
    const options = { caseSensitive, useRegex, wholeWord, extensions: filter.extensions };
    const valid = () => !disposed && sequence === searchSequence && key === searchKey;
    resultKey = '';
    results = [];
    resultLimitReached = false;
    isSearching = false;
    if (!isReplacing) replaceStatus = '';
    searchStatus = filter.error || (!isTauri() ? '目录内容搜索仅在桌面版可用；浏览器可替换当前文档。'
      : !dir ? '打开文件夹或已保存文档后搜索目录内容。' : '');
    if (!searchQuery || searchStatus) return;

    isSearching = true;
    const previous = searchTask;
    const task = (async () => {
      try {
        // Let an in-flight native scan finish, then skip superseded queued searches.
        await previous;
        if (!valid()) return;
        const { searchContent } = await import('$lib/utils/tauri-fs');
        if (!valid()) return;
        const found = await searchContent(dir, searchQuery, 1001, options);
        if (!valid()) return;
        resultLimitReached = found.length > 1000;
        results = found.slice(0, 1000);
        resultKey = key;
        const files = [...new Set(results.map(result => result.file))];
        expandedFiles = new Set(expansionKey === key ? files.filter(file => expandedFiles.has(file)) : files.slice(0, 5));
        expansionKey = key;
      } catch (err) {
        if (!valid()) return;
        console.warn('Search failed:', err);
        results = [];
        searchStatus = `搜索失败：${err instanceof Error ? err.message : String(err)}`;
      } finally { if (valid()) isSearching = false; }
    })();
    searchTask = task;
    try { await task; } finally { if (searchTask === task) searchTask = null; }
  }

  // 跨文件替换
  async function replaceAllInFiles() {
    if (!query || !isTauri() || isReplacing || isSearching || resultKey !== searchKey) return;
    const replacement = replaceText;
    const key = searchKey;
    const searchQuery = query;
    const criteria = criteriaRevision;
    const valid = () => !disposed && criteria === criteriaRevision && key === searchKey && replacement === replaceText;
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
        if (!valid()) return;
        const open = get(sessions).find(s => s.path && normalizePathKey(s.path) === normalizePathKey(path));
        if (open?.isDirty || open?.externalModified) { skipped++; continue; }
        try {
          const expected = await readFile(path);
          if (!valid()) return;
          const { content, count } = await previewReplacement(expected, searchQuery, replacement, options);
          if (!valid()) return;
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
          if (!valid()) return;
          failed++;
          if (previewWarnings.length < 20) previewWarnings = [...previewWarnings, `${path}: ${String(error)}`];
        }
      }
      if (!valid()) return;
      if (!preview.length) {
        replaceStatus = `没有可替换文件；跳过 ${skipped}，读取或表达式失败 ${failed}`;
        return;
      }
      replaceStatus = `等待审阅；跳过 ${skipped}，预览失败 ${failed}`;
      const selected = await new Promise<FileReplacementPreview[] | null>(resolve => {
        finishReview = resolve;
        replacementPreview = preview;
      });
      if (!selected || !valid()) {
        if (valid()) replaceStatus = '已取消，文件未修改';
        return;
      }
      skipped += preview.length - selected.length;
      replaceStatus = '正在保存恢复点并替换...';
      for (const item of selected) {
        if (!valid()) break;
        try {
          const result = await DocumentService.replaceDiskContent(item.path, item.expected, item.content);
          if (result === 'saved') { saved++; matches += item.count; }
          else skipped++;
        } catch (error) {
          if (asFileError(error).code === 'conflict') conflicts++;
          else failed++;
        }
      }
      if (!valid() && saved > 0) notify(`批量替换已停止，已保存 ${saved} 个文件；可在恢复中心查看替换前版本。`, undefined, false);
      if (valid()) {
        await search();
        if (valid()) replaceStatus = `成功 ${saved} 文件 / ${matches} 处；跳过 ${skipped}，冲突 ${conflicts}，失败 ${failed}`;
      }
    } catch (err) {
      if (valid()) replaceStatus = `替换失败: ${err}`;
    } finally {
      isReplacing = false;
    }
  }

  // 替换当前文件中的匹配
  async function replaceInCurrentFile() {
    if (!query || !$activeSessionId || isReplacing) return;
    const id = $activeSessionId;
    const expected = $fileContent;
    const key = searchKey;
    const replacement = replaceText;
    const options = { caseSensitive, useRegex, wholeWord };
    const searchQuery = query;
    const criteria = criteriaRevision;
    const valid = () => !disposed && id === $activeSessionId && criteria === criteriaRevision && key === searchKey && replacement === replaceText;
    isReplacing = true;
    replaceStatus = '正在替换当前文档…';

    try {
      let newContent: string;
      if (isTauri()) {
        const { previewReplacement } = await import('$lib/utils/tauri-fs');
        if (!valid()) return;
        newContent = (await previewReplacement(expected, searchQuery, replacement, options)).content;
      } else {
        const regex = buildRegex();
        if (!regex) throw new Error('无效的浏览器正则表达式');
        newContent = useRegex ? expected.replace(regex, replacement) : expected.replace(regex, () => replacement);
      }
      if (!valid()) return;
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
        if (valid()) replaceStatus = '已替换当前文件，可撤销';
      } else replaceStatus = '当前文档没有需要替换的内容';
    } catch (err) {
      if (valid()) replaceStatus = `替换失败: ${err}`;
    } finally {
      isReplacing = false;
    }
  }

  function extractDir(filePath: string): string {
    const index = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
    return index < 0 ? '' : filePath.slice(0, index + 1);
  }

  function relativePath(path: string): string {
    return directory && pathContains(directory, path)
      ? path.slice(directory.replace(/[/\\]+$/, '').length).replace(/^[/\\]+/, '') : path;
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
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || composing) return;
    if (event.key === 'Enter') {
      event.preventDefault(); void search();
    } else if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      query = '';
    }
  }
</script>

<div class="global-file-search">
  <div class="scope-heading"><span>文件夹搜索</span><small title={directory}>{directory ? directory.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || directory : '未选择目录'}</small></div>
  <!-- 搜索选项 -->
  <div class="search-options">
    <label class="search-option" title="区分大小写">
      <input type="checkbox" aria-label="区分大小写" bind:checked={caseSensitive} disabled={isReplacing} />
      <span>Aa</span>
    </label>
    <label class="search-option" title="全字匹配">
      <input type="checkbox" aria-label="全字匹配" bind:checked={wholeWord} disabled={isReplacing} />
      <span>Ab</span>
    </label>
    <label class="search-option" title="正则表达式">
      <input type="checkbox" aria-label="正则表达式" bind:checked={useRegex} disabled={isReplacing} />
      <span>.*</span>
    </label>
    <button class="search-option-btn" aria-expanded={showReplace} aria-controls="directory-replace" onclick={() => showReplace = !showReplace} title="切换替换">
      <svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" class:expanded={showReplace}><path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg> 替换
    </button>
  </div>

  <!-- 搜索框 -->
  <div class="search-input-wrapper">
    <input
      type="text"
      class="search-input"
      aria-label="搜索目录内容"
      placeholder={useRegex ? "正则表达式…" : "搜索目录内容…"}
      bind:value={query}
      disabled={isReplacing}
      oncompositionstart={() => composing = true}
      oncompositionend={() => composing = false}
      onkeydown={handleKeydown}
    />
  </div>

  <!-- 文件过滤 -->
  <div class="search-filter">
    <input
      type="text"
      class="filter-input"
      aria-label="扩展名筛选"
      aria-invalid={!!filter.error}
      aria-describedby="directory-filter-help"
      placeholder="扩展名，如 *.md, *.txt"
      bind:value={fileGlob}
      disabled={isReplacing}
    />
    <p id="directory-filter-help" class="search-scope" class:filter-error={!!filter.error}>{filter.error || '扩展名以逗号分隔；留空或 * 搜索常见文本类型。'}</p>
  </div>

  <!-- 替换框 -->
  {#if showReplace}
    <div class="replace-wrapper" id="directory-replace">
      <input
        type="text"
        class="search-input"
        aria-label="目录搜索替换内容"
        placeholder="替换为…"
        bind:value={replaceText}
        disabled={isReplacing}
      />
      <div class="replace-actions">
        <button class="replace-btn" disabled={isReplacing || !$activeSessionId || !query || composing} onclick={replaceInCurrentFile} title="替换当前文档，不受目录扩展名筛选影响">
          替换当前文档
        </button>
        <button class="replace-btn replace-all" disabled={!isTauri() || isReplacing || isSearching || resultKey !== searchKey || totalFiles === 0} onclick={replaceAllInFiles} title="审阅后替换结果文件，不代表整个目录">
          {isReplacing ? '处理中…' : '审阅并替换…'}
        </button>
      </div>
      <p class="search-scope">{isTauri() ? '普通搜索按字面替换；正则支持 $1、${name}、$$。批量修改前可逐项审阅。' : '浏览器仅支持替换当前文档；可用 Ctrl+F 查找正文。'}</p>
    </div>
  {/if}

  <!-- 状态栏 -->
  <details class="search-help"><summary>搜索范围与限制</summary><p>仅搜索磁盘文件，未保存修改不会出现在目录结果中。最多扫描 5000 项并跳过隐藏目录和构建缓存；大目录结果可能不完整。批量替换只处理结果涉及的文件。</p></details>
  {#if resultLimitReached}<p class="search-scope" role="status">结果超过 1000 条，仅显示前 1000 条，请缩小搜索范围。</p>{/if}
  <div class="search-status">
    <span role="status">{isSearching ? '正在搜索…' : totalMatches > 0 ? `${totalMatches} 个结果 · ${totalFiles} 个文件` : resultKey === searchKey ? '未找到结果' : ''}</span>
    {#if totalFiles > 0 && !isSearching}
      <div class="status-actions">
        <button onclick={expandAll} title="全部展开">展开</button>
        <button onclick={collapseAll} title="全部折叠">折叠</button>
      </div>
    {/if}
  </div>
  {#if searchStatus && !filter.error}<p class="search-scope" role="status">{searchStatus}</p>{/if}
  {#if replaceStatus}<p class="search-scope" role="status">{replaceStatus}</p>{/if}

  <!-- 搜索结果 -->
  {#if groupedResults.length > 0}
    <div class="search-results">
      {#each groupedResults as group, index (group.file)}
        <div class="file-group">
          <button class="file-header" aria-expanded={group.expanded} aria-controls={`directory-matches-${index}`} title={group.file} onclick={() => toggleFile(group.file)}>
            <svg class="file-expand" class:expanded={group.expanded} aria-hidden="true" width="12" height="12" viewBox="0 0 16 16"><path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>
            <span class="file-label"><span class="file-name">{group.fileName}</span><small>{relativePath(group.file)}</small></span>
            <span class="file-count">{group.matches.length}</span>
          </button>
          {#if group.expanded}
            <div class="file-matches" id={`directory-matches-${index}`}>
              {#each group.matches as match}
                <button
                  class="match-item"
                  title={`第 ${match.line} 行：${match.context}`}
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
  {:else if !query && !searchStatus}
    <div class="search-hint">
      <p>搜索当前目录的文本内容</p>
      <p class="hint-tips">输入关键词，结果按文件分组</p>
    </div>
  {/if}
</div>

{#if replacementPreview}
  <ReplacePreview items={replacementPreview} warnings={previewWarnings} onConfirm={resolveReview} onCancel={() => resolveReview(null)} />
{/if}

<style>
  .global-file-search {
    padding: 10px;
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .global-file-search > :not(.search-results) { flex-shrink: 0; }
  .scope-heading { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 2px 2px 4px; font-size: 12px; color: var(--ui-text); }
  .scope-heading small { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--ui-text-muted); font-size: 11px; }
  .search-scope, .search-help { margin: 4px 0 0; color: var(--ui-text-muted); font-size: 11px; line-height: 1.6; overflow-wrap: anywhere; }
  .search-help summary { cursor: pointer; }
  .search-help p { margin-top: 6px; }
  .filter-error { color: var(--syntax-error); }
  input[aria-invalid="true"] { border-color: var(--syntax-error); }
  button:disabled, input:disabled { opacity: .5; cursor: default; }
  button:focus-visible, summary:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: -2px; }

  .search-options {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
  }

  .search-option {
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: 12px;
    color: var(--ui-text-muted);
    cursor: pointer;
    padding: 4px 5px;
    border-radius: 4px;
    border: 1px solid transparent;
  }

  .search-option:hover {
    background: var(--ui-panel-hover);
  }

  .search-option:has(input:checked) {
    background: var(--ui-panel-hover);
    color: var(--ui-text);
  }

  .search-option input[type="checkbox"] {
    width: 12px;
    height: 12px;
    accent-color: var(--ui-accent);
  }

  .search-option-btn {
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: 12px;
    color: var(--ui-text-muted);
    background: none;
    border: none;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
    margin-left: auto;
  }

  .search-option-btn:hover {
    background: var(--ui-panel-hover);
  }

  svg.expanded { transform: rotate(90deg); }

  .search-input-wrapper {
    position: relative;
  }

  .search-input,
  .filter-input {
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--ui-border);
    border-radius: 4px;
    background: var(--ui-panel-active);
    color: var(--ui-text);
    font-size: 13px;
    font-family: var(--font-ui);
    outline: none;
  }

  .search-input:focus,
  .filter-input:focus {
    border-color: var(--ui-accent);
  }

  .filter-input {
    font-size: 12px;
    padding: 6px 10px;
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
    flex-wrap: wrap;
  }

  .replace-btn {
    padding: 5px 8px;
    border: 1px solid var(--ui-border);
    border-radius: 4px;
    background: var(--ui-panel-active);
    color: var(--ui-text);
    font-size: 12px;
    cursor: pointer;
  }

  .replace-btn:hover:not(:disabled) {
    background: var(--ui-panel-hover);
  }

  .replace-btn.replace-all {
    color: var(--ui-accent);
  }

  .search-status {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 12px;
    color: var(--ui-text-muted);
    gap: 8px;
    flex-wrap: wrap;
    padding: 0 2px;
  }

  .status-actions {
    display: flex;
    gap: 8px;
  }

  .status-actions button {
    background: none;
    border: none;
    color: var(--ui-text-muted);
    font-size: 11px;
    cursor: pointer;
    padding: 3px 0;
  }

  .status-actions button:hover {
    color: var(--ui-text);
  }

  .search-results {
    flex: 1;
    min-height: 80px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .file-group {
    margin-bottom: 4px;
  }

  .file-header {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 7px 6px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--ui-text);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    text-align: left;
  }

  .file-header:hover {
    background: var(--ui-panel-hover);
  }

  .file-expand {
    color: var(--ui-text-muted);
    flex-shrink: 0;
  }

  .file-label { flex: 1; min-width: 0; }
  .file-label small { display: block; color: var(--ui-text-muted); font-size: 11px; font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .file-name {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-count {
    font-size: 11px;
    color: var(--ui-text-muted);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
    padding: 1px 5px;
  }

  .file-matches {
    padding-left: 16px;
  }

  .match-item {
    display: flex;
    align-items: baseline;
    gap: 6px;
    width: 100%;
    padding: 5px 6px;
    border: none;
    border-radius: 3px;
    background: transparent;
    color: var(--ui-text);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
  }

  .match-item:hover {
    background: var(--ui-panel-hover);
  }

  .match-line {
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: var(--ui-text-muted);
    white-space: nowrap;
    min-width: 32px;
    flex-shrink: 0;
  }

  .match-context {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: 12px;
  }

  .match-context :global(.search-highlight) {
    background: color-mix(in srgb, var(--ui-accent) 25%, transparent);
    color: inherit;
    padding: 0 1px;
    border-radius: 2px;
  }

  .search-hint {
    text-align: center;
    padding: 24px 16px;
    color: var(--ui-text-muted);
    font-size: 13px;
  }

  .hint-tips {
    font-size: 12px;
    margin-top: 8px;
  }
</style>
