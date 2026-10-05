<script lang="ts">
  import { anchoredPopover } from '$lib/utils/popover-position';
  import type { ActiveFormatting } from '$lib/editor/commands';
  import { shortcutBindings } from '$lib/services/shortcut';
  let {
    visible = false,
    x = 0,
    y = 0,
    formatting,
    onAction,
    onClose,
  }: {
    visible?: boolean;
    x?: number;
    y?: number;
    formatting?: ActiveFormatting;
    onAction?: (action: string) => void;
    onClose?: (restoreFocus?: boolean) => void;
  } = $props();

  const buttons = [
    { action: 'bold', icon: 'B', title: '粗体' },
    { action: 'italic', icon: 'I', title: '斜体' },
    { action: 'strikethrough', icon: 'S', title: '删除线' },
    { action: 'code', icon: '</>', title: '代码' },
    { action: 'link', icon: '', title: '编辑链接' },
    { action: 'h1', icon: 'H1', title: '一级标题' },
    { action: 'h2', icon: 'H2', title: '二级标题' },
    { action: 'quote', icon: '', title: '引用' },
    { action: 'table', icon: '', title: '插入表格' },
  ];
  let selected = $state(0);
  $effect(() => { void visible; selected = formatting?.inCode ? 3 : 0; });
  function pressed(action: string): boolean | undefined {
    if (!formatting || action === 'table') return undefined;
    if (action === 'h1' || action === 'h2') return formatting.heading === Number(action[1]);
    if (action === 'bold' || action === 'italic' || action === 'strikethrough' || action === 'code' || action === 'link' || action === 'quote') return formatting[action];
    return undefined;
  }
  function title(action: string, label: string): string {
    const shortcut = $shortcutBindings.find(item => item.id === action)?.key;
    return shortcut ? `${label} (${shortcut})` : label;
  }
  function navigate(event: KeyboardEvent) {
    if (event.isComposing || event.defaultPrevented) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose?.(); return; }
    if (!(event.currentTarget instanceof HTMLElement)) return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    if (!controls.length) return;
    const index = controls.indexOf(event.target as HTMLButtonElement);
    const next = event.key === 'ArrowRight' ? (index + 1) % controls.length
      : event.key === 'ArrowLeft' ? (index + controls.length - 1) % controls.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault(); controls[next]?.focus();
  }
</script>

{#if visible}
  <div
    class="floating-toolbar"
    use:anchoredPopover={{ x, y, placement: 'above', align: 'center' }}
    role="toolbar"
    aria-label="Markdown 格式"
    tabindex="-1"
    onkeydown={navigate}
    onfocusout={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) onClose?.(false); }}
  >
    {#each buttons as button, index}
      <button
        type="button"
        class="floating-toolbar-button"
        class:active={pressed(button.action) === true}
        class:group-start={button.action === 'link' || button.action === 'h1'}
        title={title(button.action, button.title)}
        aria-label={button.title}
        aria-pressed={pressed(button.action)}
        disabled={!!formatting?.inCode && button.action !== 'code'}
        tabindex={index === selected ? 0 : -1}
        onfocus={() => selected = index}
        onmousedown={(event) => event.preventDefault()}
        onclick={() => onAction?.(button.action)}
      >
        {#if button.action === 'link'}
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2" /></svg>
        {:else if button.action === 'quote'}
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5v14M9 7h11M9 12h9M9 17h11" /></svg>
        {:else if button.action === 'table'}
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="1" /><path d="M3 9h18M3 14h18M9 4v16M15 4v16" /></svg>
        {:else}<span aria-hidden="true" class:italic={button.action === 'italic'} class:strike={button.action === 'strikethrough'}>{button.icon}</span>{/if}
      </button>
    {/each}
  </div>
{/if}

<style>
  .floating-toolbar {
    position: fixed;
    z-index: 200;
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    padding: 6px;
    background: var(--ui-panel-active);
    border: 1px solid var(--ui-border);
    border-radius: 6px;
    box-shadow: var(--ui-shadow-popover);
    overflow: auto;
  }
  .floating-toolbar-button {
    position: relative;
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
  .floating-toolbar-button:hover:not(:disabled),
  .floating-toolbar-button:focus-visible {
    background: var(--ui-panel-hover);
  }
  .italic { font-style: italic; }
  .floating-toolbar-button.active { background: var(--ui-panel-hover); color: var(--ui-accent); }
  .floating-toolbar-button:disabled { opacity: .35; cursor: default; }
  .floating-toolbar-button:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: -2px; }
  .floating-toolbar-button.group-start { margin-left: 5px; }
  .floating-toolbar-button.group-start::before { content: ''; position: absolute; left: -4px; top: 7px; bottom: 7px; width: 1px; background: var(--ui-border); }
  .strike { text-decoration: line-through; }
</style>
