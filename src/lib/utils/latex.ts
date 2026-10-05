import katex from 'katex';
import {
  scanCodeRegions,
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

const formulaCache = new Map<string, string>();
let formulaCacheSize = 0;

export function renderFormula(source: string, display: boolean, original = source): string {
  source = source.trim();
  const key = JSON.stringify([source, display, original]);
  const cached = formulaCache.get(key);
  if (cached) return cached;
  let result: string;
  try {
    if (source.length > 50_000) throw new Error('公式超过 50000 字符，请拆分后渲染');
    result = katex.renderToString(source, {
      displayMode: display,
      throwOnError: true,
      trust: false,
      strict: 'warn',
      maxExpand: 1000,
      maxSize: 20,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    result = `<span class="katex-error reader-math-error" title="${escapeHtml(errorMsg)}"><span role="status">公式渲染失败</span><code>${escapeHtml(original)}</code></span>`;
  }
  formulaCache.set(key, result);
  formulaCacheSize += key.length + result.length;
  while (formulaCache.size > 128 || formulaCacheSize > 2_000_000) {
    const oldest = formulaCache.keys().next().value;
    if (oldest === undefined) break;
    formulaCacheSize -= oldest.length + formulaCache.get(oldest)!.length;
    formulaCache.delete(oldest);
  }
  return result;
}

export function prepareLatex(content: string): { cleaned: string; map: Map<string, string> } {
  const map = new Map<string, string>();
  const fences = scanCodeRegions(content);
  const math = scanMath(content, fences);

  let salt = '';
  while (content.includes(`${BLOCK_PREFIX}${salt}`) || content.includes(`${INLINE_PREFIX}${salt}`)) salt += 'X';
  const replacements = math.map((item, index) => {
    const id = makePlaceholder((item.display ? BLOCK_PREFIX : INLINE_PREFIX) + salt, index);
    map.set(id, renderFormula(item.source, item.display, content.slice(item.from, item.to)));
    const newlines = content.slice(item.from, item.to).match(/\n/g)?.length ?? 0;
    return { from: item.from, to: item.to, replacement: id + '\n'.repeat(newlines) };
  });

  return { cleaned: replaceRanges(content, replacements), map };
}

export function restoreLatex(html: string, map: Map<string, string>): string {
  let result = html;

  map.forEach((value, id) => {
    // A standalone display formula must not inject a block into a paragraph.
    if (value.includes('katex-display')) {
      result = result.replace(new RegExp(`<p([^>]*)>\\s*${id}\\s*</p>`, 'g'),
        (_match, attributes: string) => `<div class="reader-math-block"${attributes}>${value}</div>`);
    }
    result = result.split(id).join(value);
    const escapedId = escapeHtml(id);
    if (escapedId !== id) {
      result = result.split(escapedId).join(value);
    }
  });

  return result;
}

export function renderLatex(content: string): string {
  if (!content) return '';
  const { cleaned, map } = prepareLatex(content);
  return restoreLatex(cleaned, map);
}

export function hasLatex(content: string): boolean {
  if (!content) return false;
  return scanMath(content, scanCodeRegions(content)).length > 0;
}

export function extractLatex(content: string): Array<{ type: 'inline' | 'block'; formula: string; position: number }> {
  return scanMath(content, scanCodeRegions(content)).map(item => ({
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
