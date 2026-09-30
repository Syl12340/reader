import katex from 'katex';
import {
  scanFencedBlocks,
  scanMath,
  type MathRange,
  type SourceRange,
} from '../editor/markdown-scanner';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const BLOCK_PREFIX = 'XREDRLATEXBLOCK';
const INLINE_PREFIX = 'XREDRLATEXINLINE';
const SUFFIX = 'RDX';

function makePlaceholder(prefix: string, index: number): string {
  return `${prefix}${index}${SUFFIX}`;
}

function replaceRanges(
  content: string,
  ranges: Array<SourceRange & { replacement: string }>,
): string {
  if (ranges.length === 0) return content;

  let result = '';
  let cursor = 0;
  for (const range of ranges.sort((a, b) => a.from - b.from)) {
    if (range.from < cursor) continue;
    result += content.slice(cursor, range.from);
    result += range.replacement;
    cursor = range.to;
  }
  return result + content.slice(cursor);
}

function renderMathRange(item: MathRange, original: string): string {
  try {
    const html = katex.renderToString(item.source, {
      displayMode: item.display,
      throwOnError: false,
      trust: false,
    });
    return item.display
      ? `<div class="katex-display">${html}</div>`
      : html;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const tag = item.display ? 'div' : 'span';
    return `<${tag} class="katex-error" title="${escapeHtml(errorMsg)}">${escapeHtml(original)}</${tag}>`;
  }
}

export function prepareLatex(content: string): { cleaned: string; map: Map<string, string> } {
  const map = new Map<string, string>();
  const fences = scanFencedBlocks(content);
  const math = scanMath(content, fences);

  const replacements = math.map((item, index) => {
    const id = makePlaceholder(item.display ? BLOCK_PREFIX : INLINE_PREFIX, index);
    map.set(id, renderMathRange(item, content.slice(item.from, item.to)));
    return { from: item.from, to: item.to, replacement: id };
  });

  return { cleaned: replaceRanges(content, replacements), map };
}

export function restoreLatex(html: string, map: Map<string, string>): string {
  let result = html;

  map.forEach((value, id) => {
    result = result.split(id).join(value);
    const escapedId = escapeHtml(id);
    if (escapedId !== id) {
      result = result.split(escapedId).join(value);
    }
  });

  return result.replace(/<p>\s*(<div class="katex-display">[\s\S]*?<\/div>)\s*<\/p>/g, '$1');
}

export function renderLatex(content: string): string {
  if (!content) return '';
  const { cleaned, map } = prepareLatex(content);
  return restoreLatex(cleaned, map);
}

export function hasLatex(content: string): boolean {
  if (!content) return false;
  return scanMath(content, scanFencedBlocks(content)).length > 0;
}

export function extractLatex(content: string): Array<{ type: 'inline' | 'block'; formula: string; position: number }> {
  return scanMath(content, scanFencedBlocks(content)).map(item => ({
    type: item.display ? 'block' : 'inline',
    formula: item.source,
    position: item.from,
  }));
}

export function validateLatex(formula: string): { valid: boolean; error?: string } {
  try {
    katex.renderToString(formula, {
      throwOnError: true,
      trust: false,
    });
    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
