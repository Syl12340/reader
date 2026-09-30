import katexCssSource from 'katex/dist/katex.min.css?raw';
import { RenderService } from './render';
import { sanitizeExportHtml } from '$lib/utils/export-formats';

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

async function fetchAsDataUrl(url: string): Promise<string> {
  if (url.startsWith('data:')) return url;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Unable to load export resource: ${response.status}`);
    return await blobToDataUrl(await response.blob());
  } finally {
    clearTimeout(timeout);
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
    if (!encoded) continue;
    try {
      element.innerHTML = await renderMermaid(decodeURIComponent(encoded), theme);
      element.removeAttribute('data-mermaid');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      element.innerHTML = `<pre class="mermaid-error"><code>${escapeHtml(message)}</code></pre>`;
    }
  }
}

async function renderLatexElements(root: HTMLElement): Promise<void> {
  const elements = Array.from(root.querySelectorAll<HTMLElement>('.latex-code-block'));
  if (elements.length === 0) return;
  const katex = await import('katex');
  for (const element of elements) {
    const encoded = element.dataset.latex;
    if (!encoded) continue;
    let source = encoded;
    try {
      source = decodeURIComponent(encoded);
      element.innerHTML = katex.default.renderToString(source, {
        displayMode: true,
        throwOnError: false,
        trust: false,
      });
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

async function inlineImages(root: HTMLElement, warnings: string[]): Promise<void> {
  const resources = new Map<string, Promise<string>>();
  root.querySelectorAll('picture source').forEach(source => source.remove());
  await forEachResource(Array.from(root.querySelectorAll<HTMLImageElement>('img')), async image => {
    const source = image.getAttribute('src');
    image.removeAttribute('srcset');
    image.removeAttribute('sizes');
    image.removeAttribute('loading');
    if (!source || source.startsWith('data:')) return;
    try {
      let pending = resources.get(source);
      if (!pending) {
        pending = fetchAsDataUrl(source);
        resources.set(source, pending);
      }
      image.src = await pending;
    } catch (error) {
      console.warn(`Failed to inline image ${source}:`, error);
      warnings.push(`图片无法嵌入：${image.alt || source}`);
      image.replaceWith(document.createTextNode(`[Image unavailable: ${image.alt ? image.alt + ' - ' : ''}${source}]`));
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
): Promise<PreparedExportDocument> {
  const container = document.createElement('div');
  const warnings: string[] = [];
  container.innerHTML = RenderService.render(markdown, { filePath });

  await renderLatexElements(container);
  await renderMermaidElements(container, theme);
  await highlightCodeElements(container, theme);
  await inlineImages(container, warnings);
  if (container.querySelector('.katex-error, .mermaid-error')) {
    warnings.push('部分公式或图表渲染失败，将保留错误提示或源码。');
  }
  container.querySelectorAll('.copy-button').forEach(node => node.remove());
  container.querySelectorAll<HTMLElement>('[data-preview-key]')
    .forEach(node => node.removeAttribute('data-preview-key'));

  return {
    bodyHtml: sanitizeExportHtml(container.innerHTML),
    embeddedCss: container.querySelector('.katex') ? await inlineKatexCss() : '',
    warnings,
  };
}
