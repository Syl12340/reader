<script lang="ts">
  let {
    visible = false,
    x = 0,
    y = 0,
    onAction,
  }: {
    visible?: boolean;
    x?: number;
    y?: number;
    onAction?: (action: string) => void;
  } = $props();

  const buttons = [
    { action: 'bold', icon: 'B', title: '粗体' },
    { action: 'italic', icon: 'I', title: '斜体' },
    { action: 'strikethrough', icon: 'S', title: '删除线' },
    { action: 'code', icon: '</>', title: '行内代码' },
    { action: 'link', icon: '🔗', title: '链接' },
    { action: 'h1', icon: 'H1', title: '一级标题' },
    { action: 'h2', icon: 'H2', title: '二级标题' },
    { action: 'quote', icon: '❝', title: '引用' },
    { action: 'table', icon: '▦', title: '插入表格' },
  ];
</script>

{#if visible}
  <div
    class="floating-toolbar"
    style="left: {x}px; top: {y}px;"
    role="toolbar"
    aria-label="Markdown 格式"
  >
    {#each buttons as button}
      <button
        type="button"
        class="floating-toolbar-button"
        title={button.title}
        aria-label={button.title}
        onmousedown={(event) => event.preventDefault()}
        onclick={() => onAction?.(button.action)}
      >
        {button.icon}
      </button>
    {/each}
  </div>
{/if}

<style>
  .floating-toolbar {
    position: fixed;
    z-index: 200;
    display: flex;
    gap: 2px;
    padding: 6px;
    transform: translate(-50%, -100%);
    background: var(--ui-panel);
    border: 1px solid var(--ui-border);
    border-radius: 6px;
    box-shadow: var(--ui-shadow-popover);
  }
  .floating-toolbar-button {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--ui-text);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
  }
  .floating-toolbar-button:hover,
  .floating-toolbar-button:focus-visible {
    background: var(--ui-panel-hover);
  }
</style>
