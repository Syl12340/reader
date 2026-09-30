<script lang="ts">
  import { derived } from 'svelte/store';
  import { sessions, activeSessionId } from '$lib/stores/document';
  import { cursorPosition } from '$lib/stores/editor-ui';

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

  let collapsedLevels = $state<Set<number>>(new Set());

  let headings: Heading[] = $derived.by(() => {
    const lines = $activeContent.split('\n');
    const result: Heading[] = [];
    let inCodeBlock = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^(`{3,}|~{3,})/.test(line.trimStart())) {
        inCodeBlock = !inCodeBlock;
        continue;
      }
      if (inCodeBlock) continue;

      const match = line.match(/^(#{1,6})\s+(.+)$/);
      if (match) {
        const level = match[1].length;
        const text = match[2].trim();
        const id = text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
        result.push({ level, text, id, line: i + 1, hasChildren: false });
      }
    }

    // 标记哪些标题有子标题
    for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        if (result[j].level > result[i].level) {
          result[i].hasChildren = true;
          break;
        }
        if (result[j].level <= result[i].level) break;
      }
    }

    return result;
  });

  // 当前光标所在的最近标题行号
  let activeHeadingLine = $derived.by(() => {
    const cursorLine = $cursorPosition.line;
    let active = 0;
    for (const h of headings) {
      if (h.line <= cursorLine) active = h.line;
      else break;
    }
    return active;
  });


  // 计算可见的标题（考虑折叠状态）
  let visibleHeadings = $derived.by(() => {
    const visible: (Heading & { collapsed: boolean })[] = [];
    let skipUntilLevel = 0;
    let isSkipping = false;

    for (const heading of headings) {
      if (isSkipping && heading.level > skipUntilLevel) {
        continue;
      }
      isSkipping = false;

      const collapsed = collapsedLevels.has(heading.line);
      visible.push({ ...heading, collapsed });

      if (collapsed) {
        isSkipping = true;
        skipUntilLevel = heading.level;
      }
    }

    return visible;
  });

  function toggleCollapse(line: number) {
    if (collapsedLevels.has(line)) {
      collapsedLevels.delete(line);
    } else {
      collapsedLevels.add(line);
    }
    collapsedLevels = new Set(collapsedLevels);
  }

  function getIndent(level: number): string {
    return `padding-left: ${(level - 1) * 14 + 8}px`;
  }

  function getLevelColor(level: number): string {
    const colors = ['', '#3a6ff7', '#7aa2ff', '#8db0ff', '#a0c0ff', '#b0d0ff', '#c0e0ff'];
    return colors[level] || 'var(--text-tertiary)';
  }
</script>

<div class="outline-container">
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
              onclick={() => toggleCollapse(heading.line)}
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
          >
            <span class="outline-level" style="color: {getLevelColor(heading.level)}">
              H{heading.level}
            </span>
            <span class="outline-text">{heading.text}</span>
          </button>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
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
    margin: 0 4px;
  }

  .outline-row.active-row {
    background: rgba(var(--accent-rgb), 0.06);
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
    color: var(--text-secondary);
    cursor: pointer;
    text-align: left;
    transition: color 0.12s;
    font-size: 12.5px;
    line-height: 1.4;
    min-width: 0;
    border-radius: 4px;
  }

  .outline-item:hover {
    color: var(--text-primary);
  }

  .outline-item.active {
    color: var(--accent-color);
    font-weight: 500;
  }

  .outline-level {
    flex-shrink: 0;
    font-size: 9px;
    font-weight: 700;
    width: 18px;
    text-align: center;
    font-family: var(--font-mono);
    opacity: 0.7;
    background: currentColor;
    color: transparent;
    -webkit-background-clip: text;
    background-clip: text;
    border: 1px solid currentColor;
    border-radius: 2px;
    line-height: 1.4;
    padding: 0 1px;
    opacity: 1;
  }

  .outline-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
</style>
