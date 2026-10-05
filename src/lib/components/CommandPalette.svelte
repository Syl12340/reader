<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { get } from 'svelte/store';
  import { CommandService, commandRevision } from '$lib/services/command';
  import { shortcutBindings } from '$lib/services/shortcut';
  import { activeSessionId } from '$lib/stores/document';
  import { dialogFocus } from '$lib/utils/dialog-focus';
  import { notify } from '$lib/services/interaction';
  import { settings } from '$lib/stores/settings';
  import { editorMode } from '$lib/stores/ui';
  import { exportJob } from '$lib/services/export-job';

  let { visible = $bindable(false), commands }: {
    visible?: boolean;
    commands: Array<{ id: string; label: string; disabled?: boolean }>;
  } = $props();
  let panel = $state<HTMLDivElement>();
  let input = $state<HTMLInputElement>();
  let query = $state('');
  let selectedId = $state<string | null>(null);
  let executing = false;
  let disposed = false;
  let revision = 0;
  const normalize = (text: string) => text.normalize('NFKC').toLowerCase();
  const matches = $derived.by(() => {
    void $commandRevision;
    void $settings; void $editorMode; void $exportJob;
    return commands.map(command => {
      const descriptor = CommandService.describe(command.id);
      return { ...command, label: descriptor.label === command.id ? command.label : descriptor.label,
        disabled: command.disabled || !descriptor.enabled, checked: descriptor.checked };
    }).filter(command => normalize(command.label).includes(normalize(query.trim())));
  });
  const selected = $derived(Math.max(0, selectedId ? matches.findIndex(command => command.id === selectedId) : matches.findIndex(command => !command.disabled)));
  const shortcuts = $derived(new Map($shortcutBindings.map(binding => [binding.id, binding.key])));

  $effect(() => {
    if (!visible) return;
    revision++; query = ''; selectedId = null;
  });
  $effect(() => { void query; selectedId = null; });
  $effect(() => {
    const id = matches[selected]?.id;
    if (!visible || !id) return;
    void tick().then(() => {
      if (!disposed && visible && matches[selected]?.id === id) {
        panel?.querySelector<HTMLElement>(`[data-command-index="${selected}"]`)?.scrollIntoView({ block: 'nearest' });
      }
    });
  });
  onDestroy(() => { disposed = true; revision++; });
  function close() { revision++; visible = false; }

  async function execute(id: string) {
    if (!visible || executing || !commands.some(command => command.id === id && !command.disabled)) return;
    const sessionId = get(activeSessionId), request = ++revision;
    executing = true;
    visible = false;
    await tick();
    try {
      if (disposed || request !== revision || visible || get(activeSessionId) !== sessionId
        || !commands.some(command => command.id === id && !command.disabled)) return;
      await CommandService.execute(id);
    } catch (error) { notify(`操作失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { executing = false; }
  }

  function keydown(event: KeyboardEvent) {
    if (event.defaultPrevented || event.isComposing || event.target !== input) return;
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && matches.length) {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      for (let step = 1; step <= matches.length; step++) {
        const index = (selected + step * direction + matches.length) % matches.length;
        if (!matches[index].disabled) { selectedId = matches[index].id; break; }
      }
    } else if (event.key === 'Enter' && matches[selected]) {
      event.preventDefault();
      if (!matches[selected].disabled) void execute(matches[selected].id);
    }
  }
</script>

{#if visible}
  <div class="palette-backdrop" role="presentation" onmousedown={event => { if (event.target === event.currentTarget) close(); }}>
    <div bind:this={panel} class="command-palette" role="dialog" aria-modal="true" aria-labelledby="command-palette-title"
      tabindex="-1" use:dialogFocus={{ close, initial: 'input' }} onkeydown={keydown}>
      <header><h2 id="command-palette-title">命令面板</h2><button type="button" class="close" aria-label="关闭命令面板" onclick={close}>Esc</button></header>
      <div class="search-field">
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m6 6 6 6-6 6M14 18h5"/></svg>
        <input bind:this={input} bind:value={query} role="combobox" aria-expanded="true" aria-controls="command-results" aria-autocomplete="list"
          aria-activedescendant={matches.length ? `command-option-${selected}` : undefined} autocomplete="off" spellcheck="false" aria-label="搜索命令" placeholder="搜索命令…" />
      </div>
      <div class="commands" id="command-results" role="listbox" aria-label="可用命令">
        {#each matches as command, index (command.id)}
          <button type="button" role="option" tabindex="-1" aria-selected={index === selected} id={`command-option-${index}`}
            data-command-index={index} class:active={index === selected} onmousedown={event => event.preventDefault()}
            disabled={command.disabled} title={command.disabled ? CommandService.describe(command.id).unavailable : undefined}
            onclick={() => void execute(command.id)}><span>{command.checked ? '✓ ' : ''}{command.label}</span><kbd>{shortcuts.get(command.id) || ''}</kbd></button>
        {:else}<p role="status">没有匹配的命令，试试其它关键词。</p>{/each}
      </div>
      <footer><span>↑ ↓ 选择　Enter 执行</span><span role="status">{matches.length} 个命令</span></footer>
    </div>
  </div>
{/if}

<style>
  .palette-backdrop { position: fixed; inset: 0; z-index: 450; background: #0003; padding-top: 14vh; display: flex; align-items: flex-start; justify-content: center; }
  .command-palette { width: min(560px, calc(100vw - 24px)); max-height: calc(86dvh - 16px); display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--ui-border); border-radius: 6px; background: var(--ui-panel-active); color: var(--ui-text); box-shadow: var(--ui-shadow-popover); }
  header, footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-shrink: 0; padding: 10px 16px; color: var(--ui-text-muted); }
  h2 { margin: 0; font-size: 12px; font-weight: 500; }
  button { border: 0; border-radius: 3px; background: transparent; color: inherit; cursor: pointer; }
  .close { padding: 3px 6px; font-size: 11px; }
  .search-field { display: flex; align-items: center; gap: 10px; padding: 0 16px 12px; border-bottom: 1px solid var(--ui-border); }
  .search-field > svg { flex-shrink: 0; color: var(--ui-text-muted); }
  .search-field:focus-within { box-shadow: inset 0 -1px var(--ui-accent); }
  input { min-width: 0; width: 100%; padding: 4px 0; border: 0; outline: none; background: transparent; color: inherit; font-size: 16px; }
  input::placeholder { color: var(--ui-text-muted); }
  .commands { overflow: auto; min-height: 0; padding: 6px; overscroll-behavior: contain; }
  .commands button { display: flex; align-items: center; justify-content: space-between; gap: 16px; width: 100%; min-height: 36px; padding: 8px 10px; text-align: left; font-size: 13px; }
  .commands button > span { min-width: 0; overflow-wrap: anywhere; }
  kbd { flex-shrink: 0; color: var(--ui-text-muted); font: 11px var(--font-ui); white-space: nowrap; }
  button:hover, button.active { background: var(--ui-panel-hover); }
  button:disabled { opacity: .45; cursor: not-allowed; }
  button:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: -2px; }
  p { padding: 16px 10px; color: var(--ui-text-muted); font-size: 13px; }
  footer { border-top: 1px solid var(--ui-border); font-size: 11px; }
  @media (max-height: 500px) { .palette-backdrop { padding-top: 16px; } .command-palette { max-height: calc(100dvh - 32px); } }
</style>
