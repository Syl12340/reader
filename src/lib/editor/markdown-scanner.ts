import MarkdownIt from 'markdown-it';

const blockParser = new MarkdownIt({ html: false });

export interface SourceRange {
  from: number;
  to: number;
}

export interface MathRange extends SourceRange {
  source: string;
  display: boolean;
}

export interface TaskRange extends SourceRange {
  checked: boolean;
}

export interface FenceRange extends SourceRange {
  language: string;
  code: string;
  closed?: boolean;
}

export interface TableRange extends SourceRange {
  markdown: string;
  rows: string[][];
  alignments: Array<'left' | 'center' | 'right'>;
  dividerCells: string[];
}

function isEscaped(text: string, index: number): boolean {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) slashes++;
  return slashes % 2 === 1;
}

function overlaps(range: SourceRange, excluded: SourceRange[]): boolean {
  return excluded.some(item => range.from < item.to && range.to > item.from);
}

export function scanCodeRegions(text: string): SourceRange[] {
  const offsets = [0];
  for (let index = 0; index < text.length; index++) if (text[index] === '\n') offsets.push(index + 1);
  const ranges: SourceRange[] = [];
  for (const token of blockParser.parse(text, {})) {
    if ((token.type === 'fence' || token.type === 'code_block') && token.map) {
      ranges.push({ from: offsets[token.map[0]] ?? text.length, to: offsets[token.map[1]] ?? text.length });
    }
  }
  return ranges;
}

export function scanFencedBlocks(text: string): FenceRange[] {
  const results: FenceRange[] = [];
  let open: { from: number; body: number; marker: string; language: string } | null = null;
  const lines = /^[^\n]*(?:\n|$)/gm;
  for (const match of text.matchAll(lines)) {
    if (!match[0]) continue;
    const line = match[0].replace(/\r?\n$/, '');
    const fence = /^[ \t]*(`{3,}|~{3,})(.*)$/.exec(line);
    if (!fence) continue;
    if (!open) {
      if (fence[1][0] === '`' && fence[2].includes('`')) continue;
      open = { from: match.index!, body: match.index! + match[0].length, marker: fence[1],
        language: fence[2].trim().split(/\s+/)[0]?.toLowerCase() || 'text' };
    } else if (fence[1][0] === open.marker[0] && fence[1].length >= open.marker.length && !fence[2].trim()) {
      results.push({ from: open.from, to: match.index! + line.length, language: open.language,
        code: text.slice(open.body, match.index).replace(/\r?\n$/, ''), closed: true });
      open = null;
    }
  }
  if (open) results.push({ from: open.from, to: text.length, language: open.language,
    code: text.slice(open.body), closed: false });
  return results;
}

export function scanInlineCode(text: string, excluded: SourceRange[] = []): SourceRange[] {
  const results: SourceRange[] = [];
  const markers = [...text.matchAll(/`+/g)];
  for (let index = 0; index < markers.length; index++) {
    const start = markers[index];
    if (isEscaped(text, start.index!) || overlaps({ from: start.index!, to: start.index! + start[0].length }, excluded)) continue;
    for (let end = index + 1; end < markers.length; end++) {
      const close = markers[end];
      if (close[0].length !== start[0].length) continue;
      const range = { from: start.index!, to: close.index! + close[0].length };
      if (overlaps(range, excluded) || /\n\s*\n/.test(text.slice(range.from, range.to))) break;
      results.push(range);
      index = end;
      break;
    }
  }
  return results;
}

export function scanMath(text: string, excluded: SourceRange[] = []): MathRange[] {
  const results: MathRange[] = [];
  const blocked = [...excluded, ...scanInlineCode(text, excluded)];
  let match: RegExpExecArray | null;

  const addRange = (range: SourceRange, source: string, display: boolean, delimiterIndex = range.from) => {
    if (!isEscaped(text, delimiterIndex) && !overlaps(range, blocked)) {
      results.push({ ...range, source, display });
      blocked.push(range);
    }
  };

  const blockPattern = /\$\$((?:\\[\s\S]|(?!\$\$)[^\\])*?)\$\$/g;
  while ((match = blockPattern.exec(text))) {
    const range = { from: match.index, to: match.index + match[0].length };
    addRange(range, match[1].trim(), true);
  }

  const bracketBlockPattern = /\\\[((?:\\\\|\\(?!\])[^\n]?|[^\\])*?)\\\]/g;
  while ((match = bracketBlockPattern.exec(text))) {
    const range = { from: match.index, to: match.index + match[0].length };
    addRange(range, match[1].trim(), true);
  }

  const environmentPattern = /\\begin\{(equation\*?|align\*?|aligned|gather\*?|multline\*?|split)\}([\s\S]*?)\\end\{\1\}/g;
  while ((match = environmentPattern.exec(text))) {
    const range = { from: match.index, to: match.index + match[0].length };
    addRange(range, match[0].trim(), true);
  }

  const inlinePattern = /(?<!\$)\$(?![\s$])((?:\\[^\n]|[^$\\\n])+?)(?<!\s)\$(?!\$)/g;
  while ((match = inlinePattern.exec(text))) {
    const range = { from: match.index, to: match.index + match[0].length };
    if (!isEscaped(text, range.to - 1)) addRange(range, match[1], false);
  }

  const parenInlinePattern = /\\\(((?:\\\\|\\(?!\))[^\n]?|[^\\\n])*?)\\\)/g;
  while ((match = parenInlinePattern.exec(text))) {
    const range = { from: match.index, to: match.index + match[0].length };
    addRange(range, match[1], false);
  }

  return results.sort((a, b) => a.from - b.from);
}

export function scanTasks(text: string, excluded: SourceRange[] = []): TaskRange[] {
  const results: TaskRange[] = [];
  const pattern = /^(\s*(?:[-*+]|\d+\.)\s+)\[([ xX])\]/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const markerOffset = match[0].lastIndexOf('[');
    const range = {
      from: match.index + markerOffset,
      to: match.index + markerOffset + 3,
    };
    if (!overlaps(range, excluded)) {
      results.push({ ...range, checked: match[2].toLowerCase() === 'x' });
    }
  }
  return results;
}

export function parseTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, '|'));
}

export function formatMarkdownTable(
  rows: string[][],
  alignments: Array<'left' | 'center' | 'right'>,
  dividerCells?: string[],
): string {
  if (rows.length === 0) return '';
  const width = Math.max(...rows.map(row => row.length), alignments.length);
  const normalized = rows.map(row =>
    Array.from({ length: width }, (_, index) => (row[index] || '').replace(/\|/g, '\\|')),
  );
  const divider = Array.from({ length: width }, (_, index) => {
    if (dividerCells?.[index]) return dividerCells[index];
    if (alignments[index] === 'center') return ':---:';
    if (alignments[index] === 'right') return '---:';
    return '---';
  });
  return [
    `| ${normalized[0].join(' | ')} |`,
    `| ${divider.join(' | ')} |`,
    ...normalized.slice(1).map(row => `| ${row.join(' | ')} |`),
  ].join('\n');
}

export function scanTables(text: string, excluded: SourceRange[] = []): TableRange[] {
  const lines: Array<{ text: string; from: number; to: number }> = [];
  let offset = 0;
  for (const line of text.split(/\n/)) {
    lines.push({ text: line.replace(/\r$/, ''), from: offset, to: offset + line.replace(/\r$/, '').length });
    offset += line.length + 1;
  }

  const results: TableRange[] = [];
  const dividerPattern = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;
  for (let index = 0; index < lines.length - 1; index++) {
    if (!lines[index].text.includes('|') || !dividerPattern.test(lines[index + 1].text)) continue;
    let end = index + 2;
    while (end < lines.length && lines[end].text.includes('|') && lines[end].text.trim()) end++;
    const range = { from: lines[index].from, to: lines[end - 1].to };
    if (overlaps(range, excluded)) continue;

    const tableLines = lines.slice(index, end).map(line => line.text);
    const divider = parseTableRow(tableLines[1]);
    const alignments = divider.map(cell => {
      if (cell.startsWith(':') && cell.endsWith(':')) return 'center';
      if (cell.endsWith(':')) return 'right';
      return 'left';
    });
    results.push({
      ...range,
      markdown: text.slice(range.from, range.to),
      rows: [parseTableRow(tableLines[0]), ...tableLines.slice(2).map(parseTableRow)],
      alignments,
      dividerCells: divider,
    });
    index = end - 1;
  }
  return results;
}

export function intersectsSelection(
  range: SourceRange,
  selections: Array<{ from: number; to: number }>,
): boolean {
  return selections.some(selection => selection.from <= range.to && selection.to >= range.from);
}
