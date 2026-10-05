<script lang="ts">
  import { derived } from 'svelte/store';
  import { sessions, activeSessionId } from '$lib/stores/document';
  import { cursorPosition, readingLine } from '$lib/stores/editor-ui';
  import { editorMode } from '$lib/stores/ui';
  import { extractHeadings } from '$lib/utils/headings';
  import { tick } from 'svelte';
  let container: HTMLDivElement | undefined = $state();
  let query = $state('');

  let { onHeadingClick = () => {} }: {
    onHeadingClick?: (line: number) => void;
  } = $props();

  interface Heading {
    level: number;
    text: string;
    id: string;
    line: number;
    hasChildren: boolean;
  }

  // 从活跃 session 读取内容（比旧的 fileContent store 更准确）
  const activeContent = derived([sessions, activeSessionId], ([list, id]) =>
    list.find(s => s.id === id)?.content ?? ''
  );

  let collapsedLevels = $state<Set<string>>(new Set());
  const collapsedBySession = new Map<string, Set<string>>();
  $effect(() => { collapsedLevels = new Set(collapsedBySession.get($activeSessionId || '') ?? []); });

  let headings: Heading[] = $derived.by(() => {
    return extractHeadings($activeContent);
  });

  // 当前光标所在的最近标题行号
  let activeHeadingLine = $derived.by(() => {
    const cursorLine = $editorMode === 'preview' ? $readingLine : $cursorPosition.line;
    let active = 0;
    for (const h of headings) {
      if (h.line <= cursorLine) active = h.line;
      else break;
    }
    return active;
  });


  // 计算可见的标题（考虑折叠状态）
  let visibleHeadings = $derived.by(() => {
    if (query.trim()) return headings.filter(heading => heading.text.normalize('NFKC').toLowerCase().includes(query.normalize('NFKC').trim().toLowerCase()))
      .map(heading => ({ ...heading, collapsed: false }));
    const visible: (Heading & { collapsed: boolean })[] = [];
    let skipUntilLevel = 0;
    let isSkipping = false;

    for (const heading of headings) {
      if (isSkipping && heading.level > skipUntilLevel) {
        continue;
      }
      isSkipping = false;

      const collapsed = collapsedLevels.has(heading.id);
      visible.push({ ...heading, collapsed });

      if (collapsed) {
        isSkipping = true;
        skipUntilLevel = heading.level;
      }
    }

    return visible;
  });

  function toggleCollapse(id: string) {
    if (collapsedLevels.has(id)) {
      collapsedLevels.delete(id);
    } else {
      collapsedLevels.add(id);
    }
    collapsedLevels = new Set(collapsedLevels);
    collapsedBySession.set($activeSessionId || '', collapsedLevels);
  }

  function getIndent(level: number): string {
    return `padding-left: ${(level - 1) * 14 + 8}px`;
  }

  async function locateCurrent() {
    query = '';
    const current = headings.find(heading => heading.line === activeHeadingLine);
    if (!current) return;
    const collapsed = new Set(collapsedLevels);
    for (const heading of headings) if (heading.line < current.line && heading.level < current.level) collapsed.delete(heading.id);
    collapsedLevels = collapsed;
    collapsedBySession.set($activeSessionId || '', collapsed);
    await tick();
    container?.querySelector<HTMLElement>('[aria-current="location"]')?.scrollIntoView({ block: 'nearest' });
  }

</script>

<div class="outline-container" bind:this={container}>
  <div class="outline-tools">
    <input aria-label="筛选大纲标题" placeholder="筛选标题…" bind:value={query} />
    <button type="button" title="定位当前章节，不改变正文位置" onclick={() => void locateCurrent()}>定位</button>
  </div>
  {#if headings.length === 0}
    <div class="outline-empty">
      <p class="text-sm text-[var(--text-tertiary)]">暂无标题</p>
      <p class="text-xs text-[var(--text-tertiary)] mt-1">在文档中添加 # 标题</p>
    </div>
  {:else}
    <div class="outline-list">
      {#each visibleHeadings as heading (heading.line)}
        <div class="outline-row" class:active-row={heading.line === activeHeadingLine} style={getIndent(heading.level)}>
          {#if heading.hasChildren}
            <button
              class="collapse-btn"
              onclick={() => toggleCollapse(heading.id)}
              aria-expanded={!heading.collapsed}
              aria-label={`${heading.collapsed ? '展开' : '折叠'} ${heading.text}`}
              title={heading.collapsed ? '展开' : '折叠'}
            >
              {heading.collapsed ? '▶' : '▼'}
            </button>
          {:else}
            <span class="collapse-spacer"></span>
          {/if}
          <button
            class="outline-item"
            class:active={heading.line === activeHeadingLine}
            onclick={() => onHeadingClick(heading.line)}
            title={heading.text}
            aria-current={heading.line === activeHeadingLine ? 'location' : undefined}
          >
            <span class="outline-text">{heading.text}</span>
          </button>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .outline-tools { display: flex; gap: 6px; align-items: center; padding: 4px 8px 8px; position: sticky; top: 0; z-index: 1; background: var(--ui-panel); }
  .outline-tools input { min-width: 0; width: 100%; border: 0; border-bottom: 1px solid var(--ui-border); background: transparent; color: var(--ui-text); padding: 5px 2px; font-size: 12px; }
  .outline-tools button { flex-shrink: 0; padding: 5px; border: 0; border-radius: 3px; background: transparent; color: var(--ui-text-muted); cursor: pointer; font-size: 12px; }
  .outline-tools button:hover { background: var(--ui-panel-hover); }
  .outline-tools button:focus-visible, .outline-tools input:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 1px; }
  .outline-container {
    height: 100%;
    overflow-y: auto;
    padding: 4px 0;
  }

  .outline-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 16px;
    text-align: center;
  }

  .outline-list {
    display: flex;
    flex-direction: column;
  }

  .outline-row {
    display: flex;
    align-items: center;
    border-radius: 4px;
    margin: 0 6px;
    min-height: 28px;
  }

  .outline-row.active-row {
    background: var(--ui-panel-hover);
  }

  .collapse-btn {
    width: 16px;
    height: 16px;
    border: none;
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    font-size: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border-radius: 3px;
    padding: 0;
  }

  .collapse-btn:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .collapse-spacer {
    width: 16px;
    flex-shrink: 0;
  }

  .outline-item {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    border: none;
    background: transparent;
    color: var(--ui-text-muted);
    cursor: pointer;
    text-align: left;
    transition: color 0.12s;
    font-size: 13px;
    line-height: 1.4;
    min-width: 0;
    border-radius: 4px;
  }

  .outline-item:hover {
    color: var(--text-primary);
  }

  .outline-item.active {
    color: var(--ui-text);
    font-weight: 600;
  }

  .outline-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
</style>
