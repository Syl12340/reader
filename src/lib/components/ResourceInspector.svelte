<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { activeSession, activeSessionId } from '$lib/stores/document';
  import { editorMode } from '$lib/stores/ui';
  import { dialogFocus } from '$lib/utils/dialog-focus';
  import { replaceResource, type ResourceEditRequest } from '$lib/utils/resource-edit';
  import { NavigationService, resolveDocumentLink } from '$lib/services/navigation';
  import { notify } from '$lib/services/interaction';
  import { isTauri } from '$lib/utils/platform';

  let request: ResourceEditRequest | null = $state(null);
  let source = $state(''), label = $state(''), error = $state('');
  function close() { request = null; }
  $effect(() => { if (request && ($activeSessionId !== request.sessionId || $editorMode === 'preview')) close(); });
  onMount(() => {
    const inspect = (event: Event) => {
      const detail = (event as CustomEvent<ResourceEditRequest>).detail;
      const session = get(activeSession);
      if (!detail || detail.sessionId !== session?.id || session.content.slice(detail.from, detail.to) !== detail.markdown) return;
      request = detail; source = detail.source; label = detail.label; error = '';
    };
    window.addEventListener('reader-inspect-resource', inspect);
    return () => window.removeEventListener('reader-inspect-resource', inspect);
  });
  function save() {
    const session = get(activeSession);
    if (!request || session?.id !== request.sessionId || session.content.slice(request.from, request.to) !== request.markdown) {
      error = '文档已发生变化，请关闭后重新打开属性。'; return;
    }
    try {
      const text = replaceResource(request, source, label);
      window.dispatchEvent(new CustomEvent('editor-replace-range', { detail: {
        from: request.from, to: request.to, text, sessionId: request.sessionId, expectedContent: session.content,
      } }));
      close();
    } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
  }
  async function locate() {
    try {
      const path = resolveDocumentLink(source, get(activeSession)?.path ?? null).path;
      if (!path) throw new Error('无法确定本地资源位置。');
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('open_document_path', { path, reveal: true });
    } catch (cause) { notify(`定位失败：${cause instanceof Error ? cause.message : String(cause)}`); }
  }
</script>

{#if request}
  <div class="resource-backdrop" role="presentation" onmousedown={event => { if (event.target === event.currentTarget) close(); }}>
    <div class="resource-panel" role="dialog" aria-modal="true" aria-labelledby="resource-title" tabindex="-1" use:dialogFocus={{ close, initial: 'input' }}>
      <header><h2 id="resource-title">{request.kind === 'image' ? '图片属性' : '链接属性'}</h2><button type="button" onclick={close} aria-label="关闭资源属性">Esc</button></header>
      <label>目标路径 / 地址<input bind:value={source} spellcheck="false" /></label>
      <label>{request.kind === 'image' ? '替代文字（alt）' : '链接文字'}<input bind:value={label} /></label>
      <p>仅修改 Markdown 引用，不移动或删除磁盘文件。</p>
      {#if error}<p role="alert" class="error">{error}</p>{/if}
      <footer>
        {#if request.kind === 'link'}<button type="button" onclick={() => void NavigationService.open(source)}>打开目标</button>{/if}
        {#if isTauri() && !/^(https?:|data:|mailto:)/i.test(source)}<button type="button" onclick={() => void locate()}>所在文件夹</button>{/if}
        <button type="button" onclick={close}>取消</button><button type="button" class="confirm" onclick={save}>应用</button>
      </footer>
    </div>
  </div>
{/if}

<style>
  .resource-backdrop { position: fixed; inset: 0; z-index: 410; background: #0003; display: grid; place-items: center; }
  .resource-panel { width: min(480px, calc(100vw - 24px)); max-height: 85dvh; overflow: auto; padding: 20px; background: var(--ui-panel-active); color: var(--ui-text); border: 1px solid var(--ui-border); border-radius: 6px; box-shadow: var(--ui-shadow-popover); }
  header, footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  h2 { margin: 0; font-size: 16px; font-weight: 600; }
  label { display: grid; gap: 6px; margin-top: 16px; font-size: 12px; color: var(--ui-text-muted); }
  input { width: 100%; border: 1px solid var(--ui-border); border-radius: 3px; padding: 8px; background: var(--ui-bg); color: var(--ui-text); font-size: 13px; }
  button { border: 0; border-radius: 3px; padding: 7px 10px; background: var(--ui-panel); color: var(--ui-text); font-size: 12px; cursor: pointer; }
  .confirm { margin-left: auto; background: var(--ui-panel-hover); font-weight: 600; }
  p { font-size: 12px; margin: 14px 0; color: var(--ui-text-muted); }
  .error { color: var(--syntax-error); }
  button:hover { background: var(--ui-panel-hover); }
  input:focus-visible, button:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 1px; }
</style>
