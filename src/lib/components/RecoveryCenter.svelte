<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { get } from 'svelte/store';
  import { sessions } from '$lib/stores/document';
  import { RecoveryService, recoveryStorageError, type RecoverySnapshot } from '$lib/services/recovery';
  import { DocumentService } from '$lib/services/document';
  import { changePreview } from '$lib/utils/change-preview';

  let { visible = $bindable(false) }: { visible?: boolean } = $props();
  let dialog = $state<HTMLDialogElement>();
  let items = $state<RecoverySnapshot[]>([]);
  let selectedId = $state('');
  let message = $state('');
  let storageBytes = $state(0);
  let checkpointCount = $state(0);
  const selected = $derived(items.find(item => `${item.kind}:${item.id}` === selectedId));
  const comparison = $derived(selected ? changePreview(selected.savedContent, selected.content) : null);
  const activeDraft = $derived(selected?.kind === 'draft' && $sessions.some(s => s.id === selected?.id));

  function refresh() {
    for (const session of get(sessions)) {
      if (session.isDirty) RecoveryService.saveSnapshot(session);
    }
    items = RecoveryService.getRecoveryItems();
    const usage = RecoveryService.getStorageUsage();
    storageBytes = usage.bytes;
    checkpointCount = usage.checkpoints;
    if (!items.some(item => `${item.kind}:${item.id}` === selectedId)) {
      selectedId = items[0] ? `${items[0].kind}:${items[0].id}` : '';
    }
  }

  $effect(() => {
    const panel = dialog;
    if (!visible || !panel) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    untrack(refresh);
    message = '';
    panel.showModal();
    return () => { panel.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  });

  async function restore() {
    if (!selected) return;
    const snapshot = selected;
    visible = false;
    await tick();
    DocumentService.restoreSnapshotAsCopy(snapshot);
  }

  async function copy() {
    if (!selected) return;
    try { await navigator.clipboard.writeText(selected.content); message = '已复制完整内容'; }
    catch { message = '无法访问剪贴板，请恢复为副本后复制。'; }
  }

  function remove() {
    if (!selected || activeDraft || !confirm(`永久删除恢复记录 ${selected.name}？不会删除磁盘原文件。`)) return;
    message = RecoveryService.removeRecoveryItem(selected) ? '恢复记录已删除' : '删除失败，记录已保留';
    refresh();
  }

  function clearCheckpoints() {
    if (!checkpointCount || !confirm(`永久删除全部 ${checkpointCount} 个替换前恢复点？未保存草稿不会被删除。`)) return;
    const removed = RecoveryService.clearCheckpoints();
    message = removed ? `已删除 ${removed} 个替换前恢复点` : '没有删除任何恢复点';
    refresh();
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
  }
</script>

<dialog bind:this={dialog} aria-labelledby="recovery-title" oncancel={() => visible = false} onclose={() => { if (!dialog?.open) visible = false; }}>
  <header><h2 id="recovery-title">恢复中心</h2><button type="button" onclick={() => visible = false}>关闭</button></header>
  <p>草稿与替换前版本保存在本机。恢复始终新建副本，不覆盖原文件；恢复记录不等同于文件备份。</p>
  {#if $recoveryStorageError}<p role="alert">{$recoveryStorageError}</p>
    <button type="button" onclick={() => recoveryStorageError.set(null)}>已知晓，关闭此提示</button>
  {/if}
  <div class="storage-actions">
    <span>恢复存储约 {formatBytes(storageBytes)}，共 {items.length} 条</span>
    <button type="button" onclick={refresh}>刷新记录</button>
    <button type="button" disabled={!checkpointCount} onclick={clearCheckpoints}>清理替换前恢复点</button>
  </div>
  <div class="recovery-layout">
    <nav aria-label="恢复记录">
      {#each items as item (`${item.kind}:${item.id}`)}
        <button type="button" class:active={selected === item} aria-pressed={selected === item}
          onclick={() => { selectedId = `${item.kind}:${item.id}`; message = ''; }}>
          <strong>{item.name}</strong><span>{item.kind === 'checkpoint' ? '替换前版本' : '未保存草稿'}</span>
          <span>{item.savedAt ? new Date(item.savedAt).toLocaleString() : '旧版记录，时间未知'}</span>
        </button>
      {:else}<p>没有可用的恢复记录。</p>{/each}
    </nav>
    <section aria-label="恢复内容预览">
      {#if selected}
        <p class="path">{selected.path || '尚无文件路径'}</p>
        <pre>{selected.content.slice(0, 32000)}</pre>
        {#if selected.content.length > 32000}<p>仅预览前 32000 字符，复制与恢复使用完整内容。</p>{/if}
        {#if selected.kind === 'draft' && comparison && selected.content !== selected.savedContent}
          <details><summary>对照最后保存版本（从第 {comparison.line} 行起）</summary>
            <h3>最后保存内容</h3><pre>{comparison.before}</pre>
            <h3>恢复内容</h3><pre>{comparison.after}</pre>
            {#if comparison.truncated}<p>仅显示首处变化附近的片段，不是完整差异。</p>{/if}
          </details>
        {/if}
        <footer>
          <button type="button" onclick={restore}>恢复为副本</button>
          <button type="button" onclick={copy}>复制完整内容</button>
          <button type="button" disabled={activeDraft} title={activeDraft ? '当前标签仍使用此草稿，请先处理该标签' : '只删除恢复记录'} onclick={remove}>删除记录</button>
        </footer>
      {/if}
    </section>
  </div>
  <p role="status">{message}</p>
</dialog>

<style>
  dialog { width: min(960px, calc(100vw - 32px)); max-height: 85vh; padding: 20px; border: 1px solid var(--ui-border); border-radius: 8px; background: var(--bg-primary); color: var(--text-primary); }
  dialog::backdrop { background: rgb(0 0 0 / 30%); }
  header, footer { display: flex; gap: 12px; align-items: center; justify-content: space-between; }
  h2 { font-size: 18px; margin: 0; }
  p { font-size: 13px; margin: 10px 0; }
  .recovery-layout { display: grid; grid-template-columns: minmax(150px, 28%) minmax(0, 1fr); gap: 16px; margin-top: 12px; }
  nav, section { max-height: 55vh; overflow: auto; }
  nav button { display: grid; width: 100%; text-align: left; margin-bottom: 6px; }
  nav span { font-size: 12px; }
  button { padding: 8px; border: 1px solid var(--ui-border); border-radius: 4px; }
  button:hover, button.active { background: var(--bg-secondary); }
  button:focus-visible { outline: 2px solid var(--accent-color); }
  button:disabled { opacity: .5; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; background: var(--bg-secondary); padding: 10px; font: 12px/1.6 var(--font-mono); }
  .path { overflow-wrap: anywhere; }
  footer { justify-content: flex-start; flex-wrap: wrap; }
  .storage-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  @media (max-width: 600px) { .recovery-layout { grid-template-columns: 1fr; } nav { max-height: 18vh; } }
</style>
