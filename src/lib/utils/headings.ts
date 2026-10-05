import MarkdownIt from 'markdown-it';
import { parseFrontmatter } from './frontmatter';

export interface Heading { level: number; text: string; id: string; line: number; hasChildren: boolean }
const parser = new MarkdownIt({ html: false });
const cache = new Map<string, Heading[]>();

export function headingSlug(text: string): string {
  return text.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]/gu, '').replace(/-+/g, '-') || 'section';
}

export function extractHeadings(content: string): Heading[] {
  const cached = cache.get(content);
  if (cached) return cached;
  const { body } = parseFrontmatter(content);
  const lineOffset = content.slice(0, content.length - body.length).split('\n').length - 1;
  const tokens = parser.parse(body, {});
  const counts = new Map<string, number>();
  const used = new Set<string>();
  const result: Heading[] = [];
  tokens.forEach((token, index) => {
    if (token.type !== 'heading_open') return;
    const inline = tokens[index + 1];
    const text = inline.children?.map(child => child.type === 'image' ? child.content
      : ['text', 'code_inline'].includes(child.type) ? child.content : '').join('') || inline.content;
    const base = headingSlug(text);
    let count = counts.get(base) ?? 0;
    let id = count ? `${base}-${count}` : base;
    while (used.has(id)) { count++; id = `${base}-${count}`; }
    counts.set(base, count + 1);
    used.add(id);
    result.push({ level: Number(token.tag.slice(1)), text, id,
      line: (token.map?.[0] ?? 0) + lineOffset + 1, hasChildren: false });
  });
  result.forEach((heading, index) => { heading.hasChildren = (result[index + 1]?.level ?? 0) > heading.level; });
  cache.set(content, result);
  if (cache.size > 8) cache.delete(cache.keys().next().value!);
  return result;
}
