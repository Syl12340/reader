import MarkdownIt from 'markdown-it';
import { isTauri } from './platform';
import { extractHeadings } from './headings';
import { resolvePath } from './path';
import { renderFormula } from './latex';
export { extractHeadings } from './headings';

// 创建 markdown-it 实例
const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: false,
  highlight: function (str: string, lang: string) {
    // 返回带 data 属性的占位符，Shiki 会在 DOM 更新后异步替换
    const escaped = str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<pre class="code-block-pre" data-lang="${escapeAttributeValue(lang || 'text')}"><code>${escaped}</code></pre>`;
  }
});

function escapeAttributeValue(value: string): string {
  return md.utils.escapeHtml(value).replace(/"/g, '&quot;');
}

function safeLanguageClass(value: string): string {
  return (value || 'text').replace(/[^\w-]/g, '-').replace(/-+/g, '-') || 'text';
}

md.core.ruler.after('inline', 'reader_tasks', state => {
  for (let index = 2; index < state.tokens.length; index++) {
    const inline = state.tokens[index];
    if (inline.type !== 'inline' || state.tokens[index - 1].type !== 'paragraph_open'
      || state.tokens[index - 2].type !== 'list_item_open') continue;
    const marker = inline.content.match(/^\[([ xX])\][ \t]+/);
    const first = inline.children?.[0];
    if (!marker || first?.type !== 'text' || !first.content.startsWith(marker[0])) continue;
    first.content = first.content.slice(marker[0].length);
    const checkbox = new state.Token('reader_task_checkbox', 'input', 0);
    checkbox.meta = { checked: marker[1].toLowerCase() === 'x' };
    inline.children!.unshift(checkbox);
    state.tokens[index - 2].attrJoin('class', 'task-list-item');
  }
});
md.renderer.rules.reader_task_checkbox = (tokens, index) => {
  const checked = tokens[index].meta.checked;
  return `<input type="checkbox" class="task-list-checkbox" disabled${checked ? ' checked' : ''} aria-label="${checked ? '已完成' : '未完成'}的任务（只读）" /> `;
};

// 当前文件所在目录（用于解析相对路径图片）
let currentFileDir = '';

/**
 * 设置当前文件目录，用于解析相对路径图片
 */
export function setCurrentFileDir(dirPath: string) {
  currentFileDir = dirPath;
}

/**
 * 将本地文件路径转为 Tauri asset:// URL
 * Tauri v2 的 asset 协议格式: asset://localhost/<encoded-path>
 */
function toAssetUrl(filePath: string): string {
  // 统一使用正斜杠，仅对非路径字符进行编码
  const normalized = filePath.replace(/\\/g, '/');
  const encoded = normalized.split('/').map(segment => encodeURIComponent(segment)).join('/');
  return `asset://localhost/${encoded}`;
}

/**
 * 解析图片路径：
 * - http/https/data: → 直接返回
 * - 绝对路径 (C:\... 或 /...) → 转 asset://
 * - 相对路径 → 基于 currentFileDir 拼接后转 asset://
 */
export function resolveImageSrc(src: string, filePath: string | null = null): string {
  if (!src) return src;

  // 网络图片或 data URI 直接返回
  if (/^(https?:|data:|blob:)/.test(src)) {
    return src;
  }

  // 浏览器模式下直接返回
  if (!isTauri()) {
    return src;
  }

  let absolutePath: string;
  try { absolutePath = decodeURIComponent(src); } catch { absolutePath = src; }
  const separatorIndex = filePath
    ? Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
    : -1;
  const explicitDirectory = separatorIndex >= 0 ? filePath!.slice(0, separatorIndex) : '';
  const baseDirectory = explicitDirectory || currentFileDir;

  // 判断是否为绝对路径
  const isAbsolute = /^[a-zA-Z]:[\\\/]/.test(src) || src.startsWith('/');

  if (!isAbsolute && baseDirectory) {
    // 相对路径 → 拼接为绝对路径
    const sep = baseDirectory.includes('\\') ? '\\' : '/';
    absolutePath = `${baseDirectory}${sep}${absolutePath}`;
  }

  // 规范化路径（处理 ../ 等）
  absolutePath = resolvePath(absolutePath);

  return toAssetUrl(absolutePath);
}

// 自定义渲染规则
md.renderer.rules.fence = function (tokens: any[], idx: number) {
  const token = tokens[idx];
  const info = token.info.trim();
  const rawLang = info.split(/\s+/)[0] || 'text';
  const lang = rawLang.toLowerCase();
  const safeLangText = md.utils.escapeHtml(rawLang);
  const safeLangAttr = escapeAttributeValue(rawLang);
  const safeLangClass = safeLanguageClass(rawLang);
  const code = token.content;
  const location = token.map ? ` data-line="${token.map[0]}" data-line-end="${token.map[1]}"` : '';

  // Mermaid 图表：输出占位容器，由 Preview.svelte 异步渲染
  if (lang === 'mermaid') {
    return `<div class="mermaid-container reader-figure"${location} data-mermaid="${encodeURIComponent(code)}"><span role="status">图表等待渲染</span></div>`;
  }
  if (lang === 'chart') {
    return `<div class="reader-chart-container reader-figure"${location} data-chart="${encodeURIComponent(code)}"><span role="status">图表等待渲染</span></div>`;
  }

  // LaTeX/数学块：输出占位容器，由 Preview.svelte 用 KaTeX 渲染
  if (lang === 'latex' || lang === 'math' || lang === 'tex') {
    return `<div class="reader-math-block latex-code-block"${location}>${renderFormula(code, true)}</div>`;
  }

  return `<div class="code-block"${location}>
    <div class="code-header">
      <span class="code-language">${safeLangText}</span>
      <button class="copy-button" type="button">复制</button>
    </div>
    <pre class="code-block-pre" data-lang="${safeLangAttr}"><code class="language-${safeLangClass}">${md.utils.escapeHtml(code)}</code></pre>
  </div>`;
};

md.renderer.rules.code_inline = function (tokens: any[], idx: number) {
  const token = tokens[idx];
  return `<code>${md.utils.escapeHtml(token.content)}</code>`;
};

md.renderer.rules.code_block = function (tokens: any[], idx: number) {
  const token = tokens[idx];
  return `<div class="code-block">
    <div class="code-header">
      <span class="code-language">text</span>
      <button class="copy-button" type="button">复制</button>
    </div>
    <pre class="code-block-pre" data-lang="text"><code>${md.utils.escapeHtml(token.content)}</code></pre>
  </div>`;
};

// 链接在新窗口打开
md.renderer.rules.link_open = function (tokens: any[], idx: number, options: any, _env: any, self: any) {
  const token = tokens[idx];
  const hrefIndex = token.attrIndex('href');
  if (hrefIndex >= 0 && /^(https?:|mailto:)/i.test(token.attrGet('href') || '')) {
    token.attrPush(['target', '_blank']);
    token.attrPush(['rel', 'noopener noreferrer']);
  }
  return self.renderToken(tokens, idx, options);
};

// 为 block 级元素添加 data-line 属性（用于双击定位）
// 直接使用 self.renderToken 避免 HMR 热更新时的递归引用
md.renderer.rules.paragraph_open = (tokens: any[], idx: number, options: any, _env: any, self: any) => {
  if (tokens[idx].map) {
    tokens[idx].attrSet('data-line', String(tokens[idx].map[0]));
  }
  return self.renderToken(tokens, idx, options);
};

md.renderer.rules.heading_open = (tokens: any[], idx: number, options: any, env: any, self: any) => {
  if (tokens[idx].map) {
    tokens[idx].attrSet('data-line', String(tokens[idx].map[0]));
    const heading = env.headings?.find((item: { line: number }) => item.line === tokens[idx].map[0] + 1);
    if (heading) tokens[idx].attrSet('id', heading.id);
  }
  return self.renderToken(tokens, idx, options);
};

// 图片渲染（关键：解析本地路径为 asset:// URL）
md.renderer.rules.image = function (tokens: any[], idx: number, _options: any, env: { filePath?: string | null } = {}) {
  const token = tokens[idx];
  const src = token.attrGet('src') || '';
  const alt = token.children?.[0]?.content || '';
  const resolvedSrc = resolveImageSrc(src, env.filePath ?? null);

  return `<img src="${escapeAttributeValue(resolvedSrc)}" alt="${escapeAttributeValue(alt)}" loading="lazy" />`;
};

// 渲染 Markdown
export function renderMarkdown(content: string, filePath: string | null = null, original = content, lineOffset = 0): string {
  if (!content) return '';
  return md.render(content, { filePath, lineOffset, headings: extractHeadings(original) });
}

// 渲染内联 Markdown
export function renderInlineMarkdown(content: string, filePath: string | null = null): string {
  if (!content) return '';
  return md.renderInline(content, { filePath });
}

// 提取标题（用于目录）
md.core.ruler.push('source_locations', state => {
  const offset = state.env.lineOffset || 0;
  for (const token of state.tokens) if (token.map) {
    token.map = [token.map[0] + offset, token.map[1] + offset];
    if (token.nesting === 1 || token.type === 'fence' || token.type === 'code_block') {
      token.attrSet('data-line', String(token.map[0]));
      token.attrSet('data-line-end', String(token.map[1]));
    }
  }
});

// 统计信息
export function getMarkdownStats(content: string) {
  if (!content) {
    return {
      words: 0,
      characters: 0,
      lines: 0,
      paragraphs: 0,
      headings: 0,
      codeBlocks: 0,
      links: 0,
      images: 0
    };
  }

  const lines = content.split('\n');
  const words = content.trim().split(/\s+/).filter(w => w.length > 0).length;
  const characters = content.length;
  const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim().length > 0).length;

  let headings = 0;
  let codeBlocks = 0;
  let links = 0;
  let images = 0;

  for (const line of lines) {
    if (/^#{1,6}\s/.test(line)) headings++;
    if (/^```/.test(line)) codeBlocks++;
    links += (line.match(/\[.*?\]\(.*?\)/g) || []).length;
    images += (line.match(/!\[.*?\]\(.*?\)/g) || []).length;
  }

  return {
    words,
    characters,
    lines: lines.length,
    paragraphs,
    headings,
    codeBlocks: Math.floor(codeBlocks / 2),
    links,
    images
  };
}

// 复制代码的全局函数已移至 Preview.svelte 的 $effect 中
// 避免 SSR/Vite 预扫描阶段访问 window 对象
