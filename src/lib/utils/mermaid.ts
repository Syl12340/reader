/**
 * Mermaid 图表渲染工具
 * 延迟加载 mermaid 库，支持主题跟随
 */

import type mermaid from 'mermaid';

let mermaidInstance: typeof mermaid | null = null;
let initPromise: Promise<void> | null = null;
let activeTheme: 'light' | 'dark' | null = null;
let renderQueue: Promise<void> = Promise.resolve();

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
      theme: requestedTheme === 'dark' ? 'dark' : 'default',
      securityLevel: 'strict',
      fontFamily: 'var(--font-content)',
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
  const result = renderQueue.then(() => renderDiagram(code, requestedTheme));
  renderQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function renderDiagram(code: string, theme: 'light' | 'dark'): Promise<string> {
  const id = `mermaid-${++idCounter}-${Date.now()}`;
  try {
    const m = await getMermaid(theme);
    const { svg } = await m.render(id, code.trim());
    return svg;
  } catch (err) {
    document.getElementById(`d${id}`)?.remove();
    console.warn('Mermaid render error:', err);
    return `<div class="mermaid-error" style="color: var(--code-text); padding: 12px; border: 1px solid var(--border-color); border-radius: 6px; font-size: 13px;">
      <strong>Mermaid 渲染错误</strong><br/>
      <pre style="margin-top: 8px; white-space: pre-wrap; font-size: 12px;">${escapeHtml(code)}</pre>
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
