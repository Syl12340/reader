export interface TextSearchOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  useRegex?: boolean;
}

export function searchExtensions(filter: string): string[] | undefined {
  const value = filter.trim();
  if (!value || value === '*') return undefined;
  const extensions = value.split(/[\s,;，；]+/).filter(Boolean).map(part => {
    const match = /^(?:\*\.|\.)?([a-zA-Z0-9_-]+)$/.exec(part);
    if (!match) throw new Error('仅支持扩展名，如 *.md, *.txt；不支持目录或文件名通配符。');
    return match[1].toLowerCase();
  });
  if (!extensions.length) throw new Error('请输入扩展名，或留空搜索常见文本类型。');
  return [...new Set(extensions)];
}

export function searchPattern(query: string, options: TextSearchOptions = {}): RegExp | null {
  if (!query) return null;
  const source = options.useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(options.wholeWord
    ? `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])` : source,
  options.caseSensitive ? 'gu' : 'giu');
}

export function searchMatches(content: string, pattern: RegExp | null, limit = 10_000) {
  const matches: Array<{ from: number; to: number }> = [];
  if (pattern) for (const match of content.matchAll(pattern)) {
    const from = match.index ?? 0;
    matches.push({ from, to: from + match[0].length });
    if (matches.length >= limit) return { matches, limited: true };
  }
  return { matches, limited: false };
}

export function replaceSearchMatch(content: string, pattern: RegExp, match: { from: number; to: number },
  replacement: string, expandCaptures: boolean): string | null {
  // Sticky matching preserves lookbehind, anchors and replacement context in the full source.
  const current = new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, '') + 'y');
  current.lastIndex = match.from;
  const found = current.exec(content);
  if (!found || found.index !== match.from || found[0].length !== match.to - match.from) return null;
  current.lastIndex = match.from;
  return expandCaptures ? content.replace(current, replacement) : content.replace(current, () => replacement);
}
