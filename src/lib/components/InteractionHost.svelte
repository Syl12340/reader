<script lang="ts">
  import { onMount } from 'svelte';
  import { activePrompt, notices, dismissNotice, cancelActivePrompt, notify, attachInteractionHost } from '$lib/services/interaction';
  import { dialogFocus } from '$lib/utils/dialog-focus';
  let busy = $state<number | null>(null);
  async function retry(id: number, action: () => void | Promise<unknown>) {
    busy = id; dismissNotice(id);
    try { await action(); } catch (error) { notify(String(error)); } finally { busy = null; }
  }
  onMount(attachInteractionHost);
</script>

{#if $activePrompt}
  <div class="prompt-backdrop">
    <button class="backdrop-target" tabindex="-1" aria-label="取消对话框" onclick={cancelActivePrompt}></button>
    <div class="prompt-panel" role="dialog" aria-modal="true" aria-labelledby="prompt-title" tabindex="-1"
      use:dialogFocus={{ close: cancelActivePrompt, initial: '[data-cancel]' }}>
      <h2 id="prompt-title">{$activePrompt.title}</h2>
      <p class="message">{$activePrompt.message}</p>
      {#if $activePrompt.comparison}
        <p class="diff-note">首处差异附近，从第 {$activePrompt.comparison.line} 行起。{$activePrompt.comparison.truncated ? '内容已截断，不是完整差异。' : ''}</p>
        <div class="comparison">
          <div><h3>当前文档</h3><pre>{$activePrompt.comparison.before || '（空）'}</pre></div>
          <div><h3>磁盘版本</h3><pre>{$activePrompt.comparison.after || '（空）'}</pre></div>
        </div>
      {/if}
      <footer>{#each $activePrompt.actions as action}
        <button data-cancel={action.id === 'cancel' ? '' : undefined} class:danger={action.danger}
          onclick={() => $activePrompt?.resolve(action.id)}>{action.label}</button>
      {/each}</footer>
    </div>
  </div>
{/if}

<div class="notice-stack" aria-live="polite" aria-relevant="additions">
  {#each $notices as notice (notice.id)}
    <div class="notice" class:error={notice.error}>
      <p>{notice.message}</p>
      {#if notice.action}<button disabled={busy !== null} onclick={() => retry(notice.id, notice.action!.run)}>{notice.action.label}</button>{/if}
      <button aria-label="关闭提示" onclick={() => dismissNotice(notice.id)}>关闭</button>
    </div>
  {/each}
</div>

<style>
  .prompt-backdrop { position: fixed; inset: 0; z-index: 600; display: grid; place-items: center; padding: 16px; background: #0004; }
  .backdrop-target { position: absolute; inset: 0; border: 0; background: transparent; }
  .prompt-panel { position: relative; width: min(760px, 100%); max-height: 85vh; overflow: auto; padding: 24px; background: var(--ui-panel-active); color: var(--ui-text); border-radius: 6px; box-shadow: var(--ui-shadow-popover); }
  h2 { font-size: 17px; font-weight: 600; margin-bottom: 12px; }
  .message { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; }
  .diff-note { margin-top: 14px; color: var(--ui-text-muted); font-size: 12px; }
  .comparison { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 8px; }
  .comparison > div { min-width: 0; }
  h3 { font-size: 13px; margin-bottom: 6px; }
  pre { max-height: 35vh; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; background: var(--ui-panel); padding: 12px; font: 12px/1.6 var(--font-mono); }
  footer { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; margin-top: 20px; }
  button { border: 1px solid var(--ui-border); border-radius: 4px; padding: 6px 12px; background: var(--ui-panel); font: 13px var(--font-ui); }
  button.danger { color: var(--syntax-error); }
  button:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
  .notice-stack { position: fixed; right: 16px; bottom: 44px; z-index: 650; width: min(420px, calc(100vw - 32px)); display: grid; gap: 8px; pointer-events: none; }
  .notice { padding: 12px; background: var(--ui-panel-active); border: 1px solid var(--ui-border); border-radius: 6px; box-shadow: var(--ui-shadow-popover); pointer-events: auto; }
  .notice.error { border-left: 3px solid var(--syntax-error); }
  .notice p { font-size: 13px; white-space: pre-wrap; overflow-wrap: anywhere; margin-bottom: 8px; }
  .notice button { margin-right: 6px; }
  @media (max-width: 600px) { .comparison { grid-template-columns: 1fr; } }
</style>
