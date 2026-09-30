<script lang="ts">
  import { tick } from 'svelte';
  import { CommandService } from '$lib/services/command';

  let { visible = $bindable(false), commands }: {
    visible?: boolean;
    commands: Array<{ id: string; label: string; disabled?: boolean }>;
  } = $props();
  let dialog = $state<HTMLDialogElement>();
  let input = $state<HTMLInputElement>();
  let query = $state('');
  let selected = $state(0);
  const matches = $derived(commands.filter(command => !command.disabled
    && command.label.toLowerCase().includes(query.toLowerCase())));

  $effect(() => {
    const panel = dialog;
    if (!visible || !panel) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    query = '';
    selected = 0;
    panel.showModal();
    void tick().then(() => { if (panel.open) input?.focus(); });
    return () => {
      panel.close();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  });

  async function execute(id: string) {
    visible = false;
    await tick();
    try { await CommandService.execute(id); }
    catch (error) { alert(`操作失败：${error instanceof Error ? error.message : String(error)}`); }
  }

  function keydown(event: KeyboardEvent) {
    if (event.isComposing) return;
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && matches.length) {
      event.preventDefault();
      selected = (selected + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
      dialog?.querySelector<HTMLButtonElement>(`[data-command-index="${selected}"]`)?.focus();
    } else if (event.key === 'Enter' && event.target === input && matches[selected]) {
      event.preventDefault();
      void execute(matches[selected].id);
    }
  }
</script>

<dialog bind:this={dialog} aria-labelledby="command-palette-title" onkeydown={keydown}
  oncancel={() => visible = false} onclose={() => visible = false}>
  <header><h2 id="command-palette-title">命令面板</h2><button type="button" onclick={() => visible = false}>关闭</button></header>
  <input bind:this={input} bind:value={query} oninput={() => selected = 0} aria-label="搜索命令" placeholder="搜索命令..." />
  <div class="commands">
    {#each matches as command, index (command.id)}
      <button type="button" data-command-index={index} class:active={index === selected}
        onfocus={() => selected = index} onclick={() => void execute(command.id)}>{command.label}</button>
    {:else}<p role="status">没有可用的匹配命令</p>{/each}
  </div>
</dialog>

<style>
  dialog { width: min(480px, calc(100vw - 48px)); max-height: 70vh; padding: 20px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-primary); color: var(--text-primary); }
  dialog::backdrop { background: rgb(0 0 0 / 25%); }
  header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  h2 { margin: 0; font-size: 16px; }
  input { width: 100%; box-sizing: border-box; padding: 8px; background: var(--bg-secondary); border: 1px solid var(--border-color); color: inherit; }
  .commands { display: grid; gap: 4px; margin-top: 12px; overflow: auto; max-height: 45vh; }
  button { padding: 8px; text-align: left; color: inherit; }
  button:hover, button.active { background: var(--bg-secondary); }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--accent-color); outline-offset: 1px; }
</style>
