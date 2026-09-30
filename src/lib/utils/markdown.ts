import MarkdownIt from 'markdown-it';
import { isTauri } from './platform';

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

// 任务列表（checkbox）需要 markdown-it-task-lists 插件
// 当前未安装，移除 md.enable('checkbox') 防止 Unknown rule 异常导致 500
// 如需任务列表支持，请安装: pnpm add markdown-it-task-lists

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

  let absolutePath = src;
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
    absolutePath = `${baseDirectory}${sep}${src}`;
  }

  // 规范化路径（处理 ../ 等）
  absolutePath = normalizePath(absolutePath);

  return toAssetUrl(absolutePath);
}

/**
 * 简单的路径规范化（处理 .. 和 .）
 */
function normalizePath(p: string): string {
  const isWin = /^[a-zA-Z]:/.test(p);
  const sep = p.includes('\\') ? '\\' : '/';
  const parts = p.split(/[\\\/]/).filter(Boolean);
  const resolved: string[] = [];

  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') {
      resolved.pop();
    } else {
      resolved.push(part);
    }
  }

  let result = resolved.join(sep);
  if (isWin && /^[a-zA-Z]/.test(result) && !result.includes(':')) {
    // 保留盘符
  }
  return result;
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

  // Mermaid 图表：输出占位容器，由 Preview.svelte 异步渲染
  if (lang === 'mermaid') {
    return `<div class="mermaid-container" data-mermaid="${encodeURIComponent(code)}"></div>`;
  }

  // LaTeX/数学块：输出占位容器，由 Preview.svelte 用 KaTeX 渲染
  if (lang === 'latex' || lang === 'math' || lang === 'tex') {
    return `<div class="code-block">
      <div class="code-header">
        <span class="code-language">${safeLangText}</span>
      </div>
      <div class="latex-code-block" data-latex="${encodeURIComponent(code)}"></div>
    </div>`;
  }

  return `<div class="code-block">
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
  if (hrefIndex >= 0) {
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

md.renderer.rules.heading_open = (tokens: any[], idx: number, options: any, _env: any, self: any) => {
  if (tokens[idx].map) {
    tokens[idx].attrSet('data-line', String(tokens[idx].map[0]));
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
export function renderMarkdown(content: string, filePath: string | null = null): string {
  if (!content) return '';
  return md.render(content, { filePath });
}

// 渲染内联 Markdown
export function renderInlineMarkdown(content: string): string {
  if (!content) return '';
  return md.renderInline(content);
}

// 提取标题（用于目录）
export function extractHeadings(content: string): Array<{ level: number; text: string; id: string }> {
  const headings: Array<{ level: number; text: string; id: string }> = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      const level = match[1].length;
      const text = match[2].trim();
      const id = text
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^\w-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

      headings.push({ level, text, id });
    }
  }

  return headings;
}

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
