import katexCssSource from 'katex/dist/katex.min.css?raw';
import { RenderService } from './render';
import { sanitizeExportHtml } from '$lib/utils/export-formats';
import { renderFormula } from '$lib/utils/latex';
import { FIGURE_EXPORT_CSS } from '$lib/utils/export-html';
import { checkExportSignal, waitForExport } from './export-job';

const katexFontUrls = import.meta.glob('../../../node_modules/katex/dist/fonts/*.woff2', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

let inlinedKatexCssPromise: Promise<string> | null = null;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Unable to encode export resource'));
    reader.readAsDataURL(blob);
  });
}

async function fetchAsDataUrl(url: string, signal?: AbortSignal): Promise<string> {
  checkExportSignal(signal);
  if (url.startsWith('data:')) return url;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Unable to load export resource: ${response.status}`);
    const limit = 30_000_000;
    if (Number(response.headers.get('content-length')) > limit) throw new Error('单个导出资源超过 30MB');
    let blob: Blob;
    if (response.body) {
      const reader = response.body.getReader();
      const chunks: ArrayBuffer[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > limit) { await reader.cancel(); throw new Error('单个导出资源超过 30MB'); }
          chunks.push(new Uint8Array(value).buffer);
        }
      } finally { reader.releaseLock(); }
      blob = new Blob(chunks, { type: response.headers.get('content-type') || 'application/octet-stream' });
    } else blob = await response.blob();
    if (blob.size > 30_000_000) throw new Error('单个导出资源超过 30MB');
    return await blobToDataUrl(blob);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

async function forEachResource<T>(items: T[], action: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await action(item);
    }
  }));
}

async function inlineKatexCss(): Promise<string> {
  if (inlinedKatexCssPromise) return inlinedKatexCssPromise;
  inlinedKatexCssPromise = (async () => {
    const fontByName = new Map(
      Object.entries(katexFontUrls).map(([path, url]) => [path.split('/').pop() || path, url]),
    );
    const dataByName = new Map<string, string>();
    const fontNames = [...katexCssSource.matchAll(/url\((?:['"])?fonts\/([^)'"?#]+\.woff2)(?:['"])?\)/g)]
      .map(match => match[1]);

    await forEachResource([...new Set(fontNames)], async name => {
      const url = fontByName.get(name);
      if (!url) throw new Error(`Missing KaTeX font: ${name}`);
      dataByName.set(name, await fetchAsDataUrl(url));
    });

    return katexCssSource
      .replace(/@font-face\{([^{}]*?)src:url\((?:['"])?fonts\/([^)'"?#]+\.woff2)(?:['"])?\)[^{}]*\}/g, (_match, prefix: string, name: string) => {
        const dataUrl = dataByName.get(name)!;
        const source = `url("${dataUrl}") format("woff2")`;
        return `@font-face{${prefix}src:${source}}`;
      })
      .replace(/url\((?:['"])?fonts\/([^)'"?#]+)(?:['"])?\)/g, 'local("serif")');
  })().catch(error => {
    inlinedKatexCssPromise = null;
    throw error;
  });
  return inlinedKatexCssPromise;
}

async function renderMermaidElements(root: HTMLElement, theme: 'light' | 'dark'): Promise<void> {
  const elements = Array.from(root.querySelectorAll<HTMLElement>('.mermaid-container'));
  if (elements.length === 0) return;
  const { renderMermaid } = await import('$lib/utils/mermaid');
  for (const element of elements) {
    const encoded = element.dataset.mermaid;
    if (encoded === undefined) continue;
    let source = encoded;
    try {
      source = decodeURIComponent(encoded);
      element.innerHTML = await renderMermaid(source, theme);
      element.removeAttribute('data-mermaid');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      element.innerHTML = `<div class="mermaid-error"><p>${escapeHtml(message)}</p><pre><code>${escapeHtml(source)}</code></pre></div>`;
    }
  }
}

async function renderChartElements(root: HTMLElement, theme: 'light' | 'dark'): Promise<void> {
  const elements = [...root.querySelectorAll<HTMLElement>('[data-chart]')];
  if (!elements.length) return;
  const { renderDataChart, renderChartError } = await import('$lib/utils/data-chart');
  for (const element of elements) {
    let source = element.dataset.chart ?? '';
    try { source = decodeURIComponent(source); element.innerHTML = renderDataChart(source, theme); }
    catch (error) { element.innerHTML = renderChartError(source, error); }
    element.removeAttribute('data-chart');
  }
}

async function renderLatexElements(root: HTMLElement): Promise<void> {
  const elements = Array.from(root.querySelectorAll<HTMLElement>('.latex-code-block'));
  if (elements.length === 0) return;
  for (const element of elements) {
    const encoded = element.dataset.latex;
    if (!encoded) continue;
    let source = encoded;
    try {
      source = decodeURIComponent(encoded);
      element.innerHTML = renderFormula(source, true);
    } catch (error) {
      element.innerHTML = `<span class="katex-error">${escapeHtml(source)}</span>`;
    }
    element.removeAttribute('data-latex');
  }
}

async function highlightCodeElements(root: HTMLElement, theme: 'light' | 'dark'): Promise<void> {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('.code-block-pre'));
  if (blocks.length === 0) return;
  const { highlightCode } = await import('$lib/utils/highlight');
  for (const block of blocks) {
    const code = block.querySelector('code');
    if (!code) continue;
    try {
      const template = document.createElement('template');
      template.innerHTML = await highlightCode(code.textContent || '', block.dataset.lang || 'text', theme);
      const highlighted = template.content.firstElementChild;
      if (highlighted) block.replaceWith(highlighted);
    } catch (error) {
      console.warn('Failed to highlight exported code block:', error);
    }
  }
}

export async function embedDocumentImages(root: Element, warnings: string[], signal?: AbortSignal): Promise<void> {
  const resources = new Map<string, Promise<string>>();
  root.querySelectorAll('picture source').forEach(source => source.remove());
  await forEachResource(Array.from(root.querySelectorAll<HTMLElement>('img, svg image')), async image => {
    checkExportSignal(signal);
    const attribute = image.localName === 'img' ? 'src' : image.hasAttribute('href') ? 'href' : 'xlink:href';
    const source = image.getAttribute(attribute);
    image.removeAttribute('srcset');
    image.removeAttribute('sizes');
    image.removeAttribute('loading');
    if (!source || source.startsWith('data:')) return;
    try {
      let pending = resources.get(source);
      if (!pending) {
        pending = fetchAsDataUrl(source, signal);
        resources.set(source, pending);
      }
      image.setAttribute(attribute, await pending);
    } catch (error) {
      checkExportSignal(signal);
      console.warn(`Failed to inline image ${source}:`, error);
      const alt = image.getAttribute('alt') || source;
      warnings.push(`图片无法嵌入：${alt}`);
      if (image.localName === 'img') image.replaceWith(document.createTextNode(`[Image unavailable: ${alt}]`));
      else image.remove();
    }
  });
}

export interface PreparedExportDocument {
  bodyHtml: string;
  embeddedCss: string;
  warnings?: string[];
}

export async function prepareExportDocument(
  markdown: string,
  filePath: string | null,
  theme: 'light' | 'dark',
  options: { signal?: AbortSignal; onResources?: () => void } = {},
): Promise<PreparedExportDocument> {
  checkExportSignal(options.signal);
  const container = document.createElement('div');
  const warnings: string[] = [];
  container.innerHTML = RenderService.render(markdown, { filePath });

  await renderLatexElements(container);
  const [mathCss] = await waitForExport(Promise.all([
    container.querySelector('.katex') ? inlineKatexCss() : Promise.resolve(''),
    renderMermaidElements(container, theme), renderChartElements(container, theme), highlightCodeElements(container, theme),
  ]), options.signal);
  checkExportSignal(options.signal);
  options.onResources?.();
  await embedDocumentImages(container, warnings, options.signal);
  checkExportSignal(options.signal);
  if (container.querySelector('.katex-error, .mermaid-error, .reader-chart-error')) {
    warnings.push('部分公式或图表渲染失败，将保留错误提示或源码。');
  }
  container.querySelectorAll('button, .reader-figure-actions, [data-export-hidden]').forEach(node => node.remove());
  container.querySelectorAll<HTMLElement>('[data-preview-key]')
    .forEach(node => node.removeAttribute('data-preview-key'));

  return {
    bodyHtml: sanitizeExportHtml(container.innerHTML),
    embeddedCss: mathCss + '\n' + FIGURE_EXPORT_CSS,
    warnings: [...new Set(warnings)],
  };
}
