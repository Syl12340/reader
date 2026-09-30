<script lang="ts">
  import { untrack } from 'svelte';
  import { changePreview, type FileReplacementPreview } from '$lib/utils/change-preview';

  let { items, warnings = [], onConfirm, onCancel }: {
    items: FileReplacementPreview[];
    warnings?: string[];
    onConfirm: (items: FileReplacementPreview[]) => void;
    onCancel: () => void;
  } = $props();
  let dialog = $state<HTMLDialogElement>();
  let selected = $state<Set<string>>(new Set());
  let activePath = $state('');
  const active = $derived(items.find(item => item.path === activePath));
  const preview = $derived(active ? changePreview(active.expected, active.content) : null);

  $effect(() => {
    const panel = dialog;
    if (!panel) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    selected = new Set(untrack(() => items.map(item => item.path)));
    activePath = untrack(() => items[0]?.path ?? '');
    panel.showModal();
    return () => { panel.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  });
  function toggle(path: string, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(path); else next.delete(path);
    selected = next;
  }
</script>

<dialog bind:this={dialog} aria-labelledby="replace-preview-title" oncancel={(event) => { event.preventDefault(); onCancel(); }}>
  <header><h2 id="replace-preview-title">审阅跨文件替换</h2><button type="button" onclick={onCancel}>取消</button></header>
  <p>仅处理当前结果涉及的文件。修改前保存恢复点；文件发生变化时跳过，不强行覆盖。</p>
  {#if warnings.length}<details><summary>部分文件无法预览，已排除（最多列出 20 项）</summary>
    {#each warnings as warning}<p class="path">{warning}</p>{/each}
  </details>{/if}
  <div class="review-layout">
    <nav aria-label="选择替换文件">
      <button type="button" onclick={() => selected = new Set(items.map(item => item.path))}>全选</button>
      <button type="button" onclick={() => selected = new Set()}>全不选</button>
      {#each items as item (item.path)}
        <div class="file">
          <input type="checkbox" aria-label={`替换 ${item.path}`} checked={selected.has(item.path)} onchange={event => toggle(item.path, event.currentTarget.checked)} />
          <button type="button" class:active={activePath === item.path} aria-pressed={activePath === item.path} title={item.path}
            onclick={() => activePath = item.path}>{item.path.split(/[/\\]/).pop()} ({item.count})</button>
        </div>
      {/each}
    </nav>
    <section aria-label="替换前后对照">
      {#if active && preview}
        <p class="path">{active.path}</p>
        <p>从第 {preview.line} 行起的内容片段</p>
        <h3>替换前</h3><pre>{preview.before}</pre>
        <h3>替换后</h3><pre>{preview.after}</pre>
        {#if preview.truncated}<p>片段已截断，并非完整差异。确认将替换该文件内的所有匹配。</p>{/if}
      {/if}
    </section>
  </div>
  <footer><span>已选择 {selected.size} / {items.length} 个文件</span>
    <button type="button" disabled={selected.size === 0} onclick={() => onConfirm(items.filter(item => selected.has(item.path)))}>确认替换所选文件</button>
  </footer>
</dialog>

<style>
  dialog { width: min(1000px, calc(100vw - 32px)); max-height: 85vh; padding: 20px; border: 1px solid var(--ui-border); border-radius: 8px; background: var(--bg-primary); color: var(--text-primary); }
  dialog::backdrop { background: rgb(0 0 0 / 30%); }
  header, footer { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
  h2 { margin: 0; font-size: 18px; }
  p { margin: 12px 0; font-size: 13px; }
  .review-layout { display: grid; grid-template-columns: minmax(140px, 26%) minmax(0, 1fr); gap: 16px; }
  nav, section { max-height: 55vh; overflow: auto; }
  button { padding: 8px; border: 1px solid var(--ui-border); border-radius: 4px; }
  button:hover, button.active { background: var(--bg-secondary); }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--accent-color); }
  button:disabled { opacity: .5; }
  .file { display: flex; align-items: center; gap: 6px; margin: 6px 0; }
  .file button { flex: 1; text-align: left; overflow-wrap: anywhere; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; background: var(--bg-secondary); padding: 10px; font: 12px/1.6 var(--font-mono); }
  .path { overflow-wrap: anywhere; }
  footer { margin-top: 16px; }
  @media (max-width: 600px) { .review-layout { grid-template-columns: 1fr; } nav { max-height: 18vh; } }
</style>
