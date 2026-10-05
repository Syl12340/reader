/**
 * Mermaid 图表渲染工具
 * 延迟加载 mermaid 库，支持主题跟随
 */

import type mermaid from 'mermaid';
import { uniqueSvg } from './svg';

let mermaidInstance: typeof mermaid | null = null;
let initPromise: Promise<void> | null = null;
let activeTheme: 'light' | 'dark' | null = null;
let renderQueue: Promise<void> = Promise.resolve();
const svgCache = new Map<string, Promise<string>>();

async function getMermaid(theme?: 'light' | 'dark'): Promise<typeof mermaid> {
  const requestedTheme = theme
    ?? (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
  if (mermaidInstance && activeTheme === requestedTheme) return mermaidInstance;
  if (!initPromise) {
    initPromise = (async () => {
      const mod = await import('mermaid');
      mermaidInstance = mod.default;
    })().catch(error => {
      initPromise = null;
      throw error;
    });
  }
  await initPromise;
  if (activeTheme !== requestedTheme) {
    mermaidInstance!.initialize({
      startOnLoad: false,
      theme: 'base',
      securityLevel: 'strict',
      fontFamily: 'system-ui, "Microsoft YaHei", sans-serif',
      themeVariables: {
        darkMode: requestedTheme === 'dark',
        background: requestedTheme === 'dark' ? '#1f1f1f' : '#ffffff',
        primaryColor: requestedTheme === 'dark' ? '#2b3037' : '#f1f4f7',
        primaryTextColor: requestedTheme === 'dark' ? '#d7d4ce' : '#2b2b2b',
        primaryBorderColor: requestedTheme === 'dark' ? '#697582' : '#8c99a6',
        secondaryColor: requestedTheme === 'dark' ? '#303732' : '#f1f5f1',
        tertiaryColor: requestedTheme === 'dark' ? '#34312d' : '#f7f5f1',
        lineColor: requestedTheme === 'dark' ? '#a6b1be' : '#667686',
        textColor: requestedTheme === 'dark' ? '#d7d4ce' : '#2b2b2b',
        fontSize: '16px',
      },
    });
    activeTheme = requestedTheme;
  }
  return mermaidInstance!;
}

let idCounter = 0;

/**
 * 渲染 mermaid 代码为 SVG HTML
 */
export async function renderMermaid(code: string, theme?: 'light' | 'dark'): Promise<string> {
  const requestedTheme = theme
    ?? (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
  // Mermaid configuration is global: initialize and render under the same queue.
  const key = JSON.stringify([requestedTheme, code]);
  let result = svgCache.get(key);
  if (!result) {
    result = renderQueue.then(() => renderDiagram(code, requestedTheme));
    renderQueue = result.then(() => undefined, () => undefined);
    svgCache.set(key, result);
    if (svgCache.size > 24) svgCache.delete(svgCache.keys().next().value!);
    void result.then(svg => { if (svg.includes('mermaid-error')) svgCache.delete(key); }, () => svgCache.delete(key));
  }
  const rendered = await result;
  if (!rendered.includes('<svg')) return rendered;
  return uniqueSvg(rendered, `reader-mermaid-${++idCounter}-`);
}

async function renderDiagram(code: string, theme: 'light' | 'dark'): Promise<string> {
  const id = `mermaid-${++idCounter}-${Date.now()}`;
  try {
    const m = await getMermaid(theme);
    if (code.length > 100_000) throw new Error('Mermaid 图表超过 100000 字符，请拆分后渲染');
    const { svg } = await m.render(id, code.trim());
    if (typeof svg !== 'string' || !svg.includes('<svg')) throw new Error('Mermaid 未返回有效 SVG');
    return svg;
  } catch (err) {
    document.getElementById(`d${id}`)?.remove();
    console.warn('Mermaid render error:', err);
    return `<div class="mermaid-error" role="status">
      <strong>Mermaid 渲染错误</strong><p>${escapeHtml(err instanceof Error ? err.message.slice(0, 300) : '无法解析图表')}</p>
      <pre><code>${escapeHtml(code)}</code></pre>
    </div>`;
  }
}

/**
 * 重新初始化 mermaid（主题切换时调用）
 */
export async function reinitMermaid(): Promise<void> {
  const reset = renderQueue.then(() => { activeTheme = null; });
  renderQueue = reset;
  await reset;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
