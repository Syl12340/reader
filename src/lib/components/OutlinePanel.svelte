<script module lang="ts">
  export interface HeadingItem {
    level: number;
    text: string;
    line: number;
  }
</script>

<script lang="ts">
  import { derived } from 'svelte/store';
  import { sessions, activeSessionId } from '$lib/stores/document';
  import { cursorPosition } from '$lib/stores/editor-ui';

  // 从当前活跃 session 内容中解析大纲
  const activeContent = derived([sessions, activeSessionId], ([list, id]) =>
    list.find(s => s.id === id)?.content ?? ''
  );

  function parseHeadings(content: string): HeadingItem[] {
    const items: HeadingItem[] = [];
    const lines = content.split('\n');
    let inFence = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^(`{3,}|~{3,})/.test(line)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;

      const m = line.match(/^(#{1,6})\s+(.+)$/);
      if (m) {
        items.push({
          level: m[1].length,
          text: m[2].trim(),
          line: i + 1,
        });
      }
    }
    return items;
  }

  let headings = $derived(parseHeadings($activeContent));

  let activeHeadingLine = $derived.by(() => {
    const cursorLine = $cursorPosition.line;
    let active = 0;
    for (const h of headings) {
      if (h.line <= cursorLine) active = h.line;
      else break;
    }
    return active;
  });

  function jumpTo(line: number) {
    window.dispatchEvent(new CustomEvent('heading-click', { detail: { line } }));
  }
</script>

<div class="outline-panel">
  <div class="outline-panel-header">
    <span>大纲</span>
  </div>
  <div class="outline-list" role="list">
    {#if headings.length === 0}
      <p class="outline-empty">暂无标题</p>
    {:else}
      {#each headings as heading (heading.line)}
        <button
          class="outline-item"
          class:active={heading.line === activeHeadingLine}
          data-level={heading.level}
          title={heading.text}
          onclick={() => jumpTo(heading.line)}
        >
          {heading.text}
        </button>
      {/each}
    {/if}
  </div>
</div>
