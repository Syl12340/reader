import { sanitizeExportHtml } from './export-formats';
import { TYPOGRAPHY_PRESETS, type TypographyPreset } from '../styles/typography';

export interface ExportTypography {
  typographyPreset?: TypographyPreset;
  fontSize?: number;
  lineHeight?: number;
  fontFamily?: string;
  paper?: 'A4' | 'Letter';
  margin?: number;
  outline?: boolean;
  orientation?: 'portrait' | 'landscape';
  pageNumbers?: boolean;
  chapterBreaks?: boolean;
}

export function printPageDimensions(typography: ExportTypography) {
  const paper = typography.paper === 'Letter' ? 'Letter' : 'A4';
  const portrait = paper === 'Letter' ? [215.9, 279.4] : [210, 297];
  const landscape = typography.orientation === 'landscape';
  const [width, height] = landscape ? [portrait[1], portrait[0]] : portrait;
  const margin = Number.isFinite(typography.margin) ? Math.min(35, Math.max(10, typography.margin!)) : 20;
  return { paper, width, height, margin, contentWidth: width - margin * 2, contentHeight: height - margin * 2 };
}

export const FIGURE_EXPORT_CSS = `
  .reader-figure, .mermaid-container, .reader-chart-container { margin: 1.25em 0; text-align: center; }
  .reader-figure svg, .mermaid-container svg, .reader-chart-container svg { display: block; max-width: 100%; height: auto; margin: auto; }
  .reader-figure-actions, [data-export-hidden], .copy-button { display: none !important; }
  .katex-display { margin: 1em 0; padding: .25em 0; overflow-x: auto; overflow-y: hidden; }
  .katex { font-size: 1.1em; }
  .reader-math-error code { display: block; white-space: pre-wrap; overflow-wrap: anywhere; }
  .reader-chart-error, .mermaid-error { text-align: left; }
  @media print {
    .reader-figure, .mermaid-container, .reader-chart-container, .reader-math-block { break-inside: avoid; }
    .katex-display { overflow: visible; }
    .reader-figure svg, .mermaid-container svg, .reader-chart-container svg { max-height: 240mm; }
  }
`;

function escape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function buildExportHtml(
  title: string, bodyHtml: string, theme: 'light' | 'dark', embeddedCss = '', includeStyles = true,
  typography: ExportTypography = {},
): string {
  const preset = TYPOGRAPHY_PRESETS[typography.typographyPreset ?? 'clean'] ?? TYPOGRAPHY_PRESETS.clean;
  const size = Number.isFinite(typography.fontSize) ? Math.max(10, Math.min(40, typography.fontSize!)) : preset.size;
  const lineHeight = Number.isFinite(typography.lineHeight) ? Math.max(1.2, Math.min(3, typography.lineHeight!)) : preset.lineHeight;
  const font = typography.fontFamily && !/[;{}<>\\\n\r]/.test(typography.fontFamily) ? typography.fontFamily : preset.font;
  const page = printPageDimensions(typography);
  const { paper, margin } = page;
  const pageCss = `@page { size:${paper}${typography.orientation === 'landscape' ? ' landscape' : ''}; margin:${margin}mm;
    ${typography.pageNumbers ? '@bottom-center { content:counter(page) " / " counter(pages); font:10px sans-serif; color:#666; }' : ''}
  }`;
  const styles = includeStyles ? `
    :root { --doc-bg:#fff; --doc-text:#2b2b2b; --doc-text-muted:#787878; --doc-code-bg:#f6f6f6;
      --border-color:#dedede; --link-color:#2f67b1; --code-text:#3f3f3f; }
    [data-theme="dark"] { --doc-bg:#1f1f1f; --doc-text:#d7d4ce; --doc-text-muted:#96928c;
      --doc-code-bg:#292929; --border-color:#46423e; --link-color:#7da6df; --code-text:#d7d4ce; }
    * { box-sizing:border-box; }
    body { margin:0; padding:32px 24px 64px; background:var(--doc-bg); color:var(--doc-text);
      font-family:${font}; font-size:${size}px; line-height:${lineHeight}; }
    .markdown-body { max-width:${preset.width}px; margin:auto; overflow-wrap:break-word; }
    h1,h2,h3,h4,h5,h6 { line-height:1.3; margin:1.35em 0 .55em; font-weight:600; }
    h1 { font-size:${preset.h1}em; } h2 { font-size:${preset.h2}em; } h3 { font-size:1.25em; }
    .markdown-body > :first-child { margin-top:0; }
    p { margin:0 0 ${preset.paragraphGap}em; } a { color:var(--link-color); }
    blockquote { margin:1em 0; padding-left:1em; border-left:3px solid var(--border-color); color:var(--doc-text-muted); }
    ul,ol { padding-left:1.75em; } li { margin:.2em 0; }
    pre { padding:1em; overflow:auto; background:var(--doc-code-bg); border-radius:4px; }
    code { font-family:Consolas,"Cascadia Code",monospace; background:var(--doc-code-bg); color:var(--code-text); font-size:.9em; }
    pre code { background:transparent; color:inherit; padding:0; line-height:1.5; }
    table { width:100%; border-collapse:collapse; margin:1em 0; }
    th,td { border:1px solid var(--border-color); padding:.4em .7em; text-align:left; overflow-wrap:anywhere; }
    th { background:var(--doc-code-bg); font-weight:600; }
    img,svg { max-width:100%; height:auto; } hr { border:0; border-top:1px solid var(--border-color); margin:2em 0; }
    .code-block { margin:1.1em 0; } .code-header { color:var(--doc-text-muted); font-size:12px; padding-bottom:4px; }
    .code-block-pre { margin:0; } button { display:none !important; }
    ${FIGURE_EXPORT_CSS}
    @media print {
      ${pageCss}
      :root,[data-theme="dark"] { --doc-bg:#fff; --doc-text:#2b2b2b; --doc-text-muted:#666; --doc-code-bg:#f6f6f6; --border-color:#dedede; --code-text:#3f3f3f; }
      body { padding:0; background:#fff !important; color:#2b2b2b !important; font-size:${size}px; }
      .markdown-body { max-width:100%; }
      h1,h2,h3,h4,h5,h6,.code-header { break-after:avoid; }
      p,li { orphans:3; widows:3; }
      table,pre,.code-block { break-inside:auto; }
      tr { break-inside:avoid; } thead { display:table-header-group; } tfoot { display:table-footer-group; }
      pre { white-space:pre-wrap; overflow:visible; overflow-wrap:anywhere; }
      pre code { white-space:inherit; } a { color:inherit; text-decoration:none; }
      ${typography.chapterBreaks ? '.markdown-body > h1:not(:first-child) { break-before:page; }' : ''}
      .reader-figure svg,.mermaid-container svg,.reader-chart-container svg { max-height:${page.contentHeight - 8}mm; }
      img { max-height:${page.contentHeight - 8}mm; object-fit:contain; }
      * { -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    }
  ` : `${FIGURE_EXPORT_CSS}\n@media print { ${pageCss} ${typography.chapterBreaks ? '.markdown-body > h1:not(:first-child) { break-before:page; }' : ''} }`;
  // Keep math fonts and accessibility CSS even when decorative styling is disabled.
  const css = `${embeddedCss}\n${styles}`.replace(/<\/style/gi, '<\\/style');
  let body = sanitizeExportHtml(bodyHtml);
  if (typography.outline && typeof DOMParser !== 'undefined') {
    const root = new DOMParser().parseFromString(body, 'text/html');
    const used = new Set([...root.querySelectorAll('[id]')].map(element => element.id));
    const links: string[] = [];
    for (const [index, heading] of [...root.querySelectorAll('h1,h2,h3,h4,h5,h6')].entries()) {
      if (!heading.id) {
        let id = `reader-export-heading-${index}`;
        while (used.has(id)) id += '-';
        heading.id = id; used.add(id);
      }
      links.push(`<li><a href="#${escape(encodeURIComponent(heading.id))}">${escape(heading.textContent || '')}</a></li>`);
    }
    if (links.length) body = `<nav aria-label="目录"><h2>目录</h2><ol>${links.join('')}</ol></nav>${root.body.innerHTML}`;
  }
  return `<!DOCTYPE html><html lang="zh-CN" data-theme="${theme}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="reader-print-width" content="${page.contentWidth}"><title>${escape(title || 'untitled')}</title><style>${css}</style></head><body><main class="markdown-body">${body}</main></body></html>`;
}

export function fitPrintFormulas(root: Document): void {
  for (const display of root.querySelectorAll<HTMLElement>('.katex-display')) {
    const formula = display.querySelector<HTMLElement>('.katex');
    if (!formula) continue;
    const available = display.parentElement?.clientWidth ?? display.clientWidth;
    const width = formula.getBoundingClientRect().width;
    if (available > 0 && width > available) {
      formula.style.fontSize = `${parseFloat(getComputedStyle(formula).fontSize) * available / width}px`;
    }
  }
}
