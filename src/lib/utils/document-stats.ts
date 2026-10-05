import MarkdownIt from 'markdown-it';
import { parseFrontmatter } from './frontmatter';
import { scanFencedBlocks, scanMath } from '$lib/editor/markdown-scanner';

const parser = new MarkdownIt({ html: false });
export interface DocumentStats { words: number; chars: number; lines: number; readMin: number }
let lastSource: string | null = null;
let lastStats: DocumentStats = { words: 0, chars: 0, lines: 0, readMin: 0 };

/** Visible prose: Han characters plus other letter/number words; code and math excluded. */
export function documentStats(source: string): DocumentStats {
  if (source === lastSource) return lastStats;
  const { body } = parseFrontmatter(source);
  const math = scanMath(body, scanFencedBlocks(body));
  const parts: string[] = [];
  let cursor = 0;
  for (const range of math) {
    parts.push(body.slice(cursor, range.from), ' ', '\n'.repeat(body.slice(range.from, range.to).split('\n').length - 1));
    cursor = range.to;
  }
  parts.push(body.slice(cursor));
  const tokens = parser.parse(parts.join(''), {});
  const text = tokens.map((token, index) => {
    if (token.type !== 'inline') return '';
    let prose = (token.children ?? []).map(child => child.type === 'text' ? child.content
      : ['code_inline', 'image', 'softbreak', 'hardbreak'].includes(child.type) ? ' ' : '').join('');
    if (tokens[index - 1]?.type === 'paragraph_open' && tokens[index - 2]?.type === 'list_item_open'
      && /^\[[ xX]\]\s/.test(token.content)) prose = prose.replace(/^\[[ xX]\]\s+/, '');
    return prose;
  }).join(' ');
  const words = (text.match(/\p{Script=Han}/gu)?.length ?? 0)
    + (text.replace(/\p{Script=Han}/gu, ' ').match(/[\p{L}\p{N}]+(?:['\u2019-][\p{L}\p{N}]+)*/gu)?.length ?? 0);
  lastSource = source;
  lastStats = { words, chars: source.length, lines: source ? source.split('\n').length : 0,
    readMin: words ? Math.max(1, Math.round(words / 250)) : 0 };
  return lastStats;
}
