<script lang="ts">
  import { untrack } from 'svelte';
  import { prepareExportDocument } from '$lib/services/export-document';
  import { normalizeSettings, updateSettings, type Settings } from '$lib/stores/settings';
  import { buildExportHtml, fitPrintFormulas, printPageDimensions } from '$lib/utils/export-html';
  import { exportOptions, exportPreset, exportTypography, type ExportSource } from '$lib/utils/export-options';
  import { dialogFocus } from '$lib/utils/dialog-focus';
  import { isTauri } from '$lib/utils/platform';

  let { source, initialPreferences, close, confirm }: {
    source: ExportSource;
    initialPreferences: Settings;
    close: () => void;
    confirm: (format: 'html' | 'pdf', preferences: Settings, prepared: Awaited<ReturnType<typeof prepareExportDocument>>) => void;
  } = $props();
  let preferences = $state(untrack(() => normalizeSettings({ ...initialPreferences,
    exportBookmarks: isTauri() && initialPreferences.exportBookmarks })));
  let format = $state<'html' | 'pdf'>(untrack(() => initialPreferences.exportDefaultFormat === 'html' ? 'html' : 'pdf'));
  let remember = $state(false), error = $state(''), loading = $state(true), retry = $state(0);
  let prepared = $state<Awaited<ReturnType<typeof prepareExportDocument>> | null>(null);
  let panel: HTMLDivElement;
  const page = $derived(printPageDimensions(exportTypography(preferences)));
  $effect(() => {
    const captured = source;
    void retry;
    const controller = new AbortController();
    loading = true; error = ''; prepared = null;
    void prepareExportDocument(captured.markdown, captured.filePath, 'light', { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) { prepared = value; loading = false; } })
      .catch(cause => { if (!controller.signal.aborted) { error = cause instanceof Error ? cause.message : String(cause); loading = false; } });
    return () => controller.abort();
  });
  const previewHtml = $derived.by(() => {
    if (!prepared) return '';
    const options = normalizeSettings(preferences);
    const title = source.baseName.replace(/\.[^/.]+$/, '') || 'untitled';
    const root = new DOMParser().parseFromString(buildExportHtml(title, prepared.bodyHtml, 'light', prepared.embeddedCss,
      format === 'pdf' || options.exportIncludeCss, exportTypography(options)), 'text/html');
    // Isolate the paper preview from application CSS and forbid navigation/forms/scripts.
    const policy = root.createElement('meta'); policy.httpEquiv = 'Content-Security-Policy';
    policy.content = "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
    root.head.prepend(policy);
    for (const link of root.querySelectorAll('a')) { link.removeAttribute('href'); link.removeAttribute('target'); }
    const style = root.createElement('style');
    style.textContent = `body { box-sizing:border-box; width:${page.width}mm; min-height:${page.height}mm; padding:${page.margin}mm; margin:0; background:white; color:#2b2b2b; }
      .markdown-body { max-width:${page.contentWidth}mm; } pre { white-space:pre-wrap; overflow-wrap:anywhere; overflow:visible; }
      pre code { white-space:inherit; }`;
    root.head.append(style);
    return `<!DOCTYPE html>${root.documentElement.outerHTML}`;
  });
  function ready(event: Event) {
    const frame = event.currentTarget as HTMLIFrameElement;
    const root = frame.contentDocument;
    if (!root) return;
    root.addEventListener('keydown', event => {
      if (event.isComposing) return;
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key === 'Tab') {
        event.preventDefault();
        const target = panel.querySelector<HTMLElement>(event.shiftKey ? '[data-preview-before-frame]' : '[data-preview-confirm]');
        target?.focus();
      }
    });
    void root.fonts.ready.then(() => { if (frame.isConnected && frame.contentDocument === root) fitPrintFormulas(root); });
  }
  function submit() {
    if (!prepared || loading || error) return;
    const captured = normalizeSettings(preferences);
    if (!isTauri()) captured.exportBookmarks = false;
    if (remember) updateSettings({ ...exportOptions(captured), exportDefaultFormat: format });
    confirm(format, captured, prepared);
  }
</script>

<div class="export-backdrop" role="presentation" onmousedown={event => { if (event.target === event.currentTarget) close(); }}>
  <div class="export-panel" bind:this={panel} role="dialog" aria-modal="true" aria-labelledby="export-preview-title" tabindex="-1" use:dialogFocus={{ close, initial: '[data-preview-format]' }}>
    <header><div><h2 id="export-preview-title">导出预览与设置</h2><p>{source.baseName} · 打开预览时的文档快照 · 浅色排版</p></div><button type="button" onclick={close} aria-label="关闭导出预览">Esc</button></header>
    <div class="export-content">
      <aside aria-label="导出选项">
        <label>格式<select aria-label="格式" data-preview-format bind:value={format}><option value="pdf">PDF</option><option value="html">HTML</option></select></label>
        <div class="presets"><button type="button" onclick={() => preferences = exportPreset(preferences, true)}>课程报告</button><button type="button" onclick={() => preferences = exportPreset(preferences, false)}>普通文档</button></div>
        <label>纸张<select aria-label="纸张" bind:value={preferences.exportPaper}><option>A4</option><option>Letter</option></select></label>
        <label>方向<select aria-label="方向" bind:value={preferences.exportOrientation}><option value="portrait">纵向</option><option value="landscape">横向</option></select></label>
        <label>页边距（毫米）<input type="number" min="10" max="35" bind:value={preferences.exportMargin} /></label>
        <label class="check"><input type="checkbox" bind:checked={preferences.exportOutline} />包含文档目录</label>
        <label class="check"><input type="checkbox" bind:checked={preferences.exportChapterBreaks} />一级标题另起页</label>
        <label class="check"><input type="checkbox" bind:checked={preferences.exportPageNumbers} />打印页码</label>
        <p>页码需要 Chromium / WebView2 131 或更新版本。</p>
        {#if format === 'pdf'}
          <label class="check"><input type="checkbox" disabled={!isTauri()} bind:checked={preferences.exportBookmarks} />PDF 标题书签（实验性）</label>
          <p>{isTauri() ? '依据标题生成阅读器书签；不支持的运行时会提示失败。' : '浏览器降级使用打印对话框，不提供 PDF 书签。'}</p>
        {:else}
          <label class="check"><input type="checkbox" bind:checked={preferences.exportIncludeCss} />包含排版 CSS</label>
        {/if}
        <label class="check"><input data-preview-before-frame type="checkbox" bind:checked={remember} />保存为默认导出设置</label>
      </aside>
      <section class="preview" aria-label="导出排版预览" aria-busy={loading}>
        <p class="preview-note">连续排版预览，不模拟最终分页；实际页码和分页以 PDF / 打印结果为准。</p>
        {#if loading}<p role="status">正在渲染并嵌入资源…</p>
        {:else if error}<div role="alert"><p>{error}</p><button type="button" onclick={() => retry++}>重新加载预览</button></div>
        {:else}<iframe title="导出文档排版预览" sandbox="allow-same-origin" srcdoc={previewHtml} onload={ready}></iframe>{/if}
      </section>
    </div>
    <footer>
      {#if prepared?.warnings?.length}<details><summary>资源警告（{prepared.warnings.length}）</summary>{#each prepared.warnings as warning}<p>{warning}</p>{/each}</details>{/if}
      <button type="button" onclick={close}>取消</button>
      <button type="button" class="confirm" data-preview-confirm disabled={!prepared || loading || !!error} onclick={submit}>导出 {format.toUpperCase()}…</button>
    </footer>
  </div>
</div>

<style>
  .export-backdrop { position:fixed; inset:0; z-index:420; display:grid; place-items:center; background:#0003; }
  .export-panel { width:min(1150px, calc(100vw - 24px)); height:min(850px, calc(100dvh - 24px)); display:flex; flex-direction:column; background:var(--ui-panel-active); color:var(--ui-text); border:1px solid var(--ui-border); border-radius:6px; box-shadow:var(--ui-shadow-popover); overflow:hidden; }
  header { display:flex; justify-content:space-between; align-items:center; padding:14px 18px; border-bottom:1px solid var(--ui-border); }
  h2 { font-size:16px; font-weight:600; margin:0; } p { font-size:12px; color:var(--ui-text-muted); margin:6px 0; }
  .export-content { min-height:0; flex:1; display:grid; grid-template-columns:240px minmax(0, 1fr); }
  aside { overflow:auto; padding:16px; border-right:1px solid var(--ui-border); }
  label { display:grid; gap:5px; margin-bottom:12px; font-size:12px; }
  input:not([type=checkbox]),select { width:100%; padding:6px; border:1px solid var(--ui-border); border-radius:3px; color:var(--ui-text); background:var(--ui-bg); }
  .check { display:flex; align-items:center; gap:7px; }
  .presets { display:flex; gap:6px; margin-bottom:12px; }
  button { padding:7px 10px; border:0; border-radius:3px; background:var(--ui-panel); color:var(--ui-text); cursor:pointer; font-size:12px; }
  button:hover { background:var(--ui-panel-hover); } button:disabled { opacity:.5; cursor:default; }
  .preview { display:flex; flex-direction:column; min-height:0; padding:12px; background:var(--ui-panel); }
  .preview-note { margin:0 0 10px; }
  iframe { border:1px solid var(--ui-border); width:100%; flex:1; min-height:150px; background:white; }
  footer { display:flex; justify-content:flex-end; gap:8px; padding:12px 18px; border-top:1px solid var(--ui-border); }
  details { margin-right:auto; max-width:65%; max-height:100px; overflow:auto; font-size:12px; }
  .confirm { background:var(--ui-panel-hover); font-weight:600; }
  button:focus-visible,input:focus-visible,select:focus-visible { outline:2px solid var(--ui-accent); outline-offset:1px; }
  @media (max-width:650px) { .export-content { grid-template-columns:180px minmax(0, 1fr); } aside { padding:10px; } }
</style>
