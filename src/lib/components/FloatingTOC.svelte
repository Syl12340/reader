<script lang="ts">
  import { fileContent } from '$lib/stores/document';

  let isOpen = $state(false);

  interface Heading {
    level: number;
    text: string;
    line: number;
  }

  let headings = $derived(extractHeadings($fileContent));

  function extractHeadings(content: string): Heading[] {
    if (!content) return [];
    const result: Heading[] = [];
    const lines = content.split('\n');
    let inCodeBlock = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        continue;
      }
      if (inCodeBlock) continue;

      const match = line.match(/^(#{1,6})\s+(.+)$/);
      if (match) {
        result.push({
          level: match[1].length,
          text: match[2].trim(),
          line: i + 1,
        });
      }
    }

    return result;
  }

  function handleClick(line: number) {
    const event = new CustomEvent('heading-click', { detail: { line } });
    window.dispatchEvent(event);
    isOpen = false;
  }

  function toggleOpen() {
    isOpen = !isOpen;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      isOpen = false;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if headings.length > 0}
  <div class="floating-toc">
    <button
      class="toc-toggle"
      onclick={toggleOpen}
      title="文档大纲"
    >
      ☰
    </button>

    {#if isOpen}
      <div class="toc-panel">
        <div class="toc-header">文档大纲</div>
        <div class="toc-list">
          {#each headings as heading}
            <button
              class="toc-item"
              style="padding-left: {(heading.level - 1) * 12 + 8}px"
              onclick={() => handleClick(heading.line)}
            >
              {heading.text}
            </button>
          {/each}
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .floating-toc {
    position: absolute;
    top: 12px;
    right: 12px;
    z-index: 10;
  }

  .toc-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    background: var(--bg-primary);
    color: var(--text-secondary);
    font-size: 16px;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
  }

  .toc-toggle:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .toc-panel {
    position: absolute;
    top: 40px;
    right: 0;
    width: 240px;
    max-height: 400px;
    overflow-y: auto;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
    animation: toc-in 0.15s ease-out;
  }

  @keyframes toc-in {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .toc-header {
    padding: 10px 12px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-tertiary);
    border-bottom: 1px solid var(--border-color);
  }

  .toc-list {
    padding: 4px;
  }

  .toc-item {
    display: block;
    width: 100%;
    padding: 6px 8px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text-primary);
    font-size: 13px;
    text-align: left;
    cursor: pointer;
    transition: background 0.1s;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .toc-item:hover {
    background: var(--bg-tertiary);
  }
</style>
