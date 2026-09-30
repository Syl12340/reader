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

export function scanFencedBlocks(text: string): FenceRange[] {
  const results: FenceRange[] = [];
  const pattern = /^([ \t]*)(`{3,}|~{3,})([^\n]*)\r?\n([\s\S]*?)^\1\2[ \t]*$/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const start = match.index;
    results.push({
      from: start,
      to: start + match[0].length,
      language: match[3].trim().split(/\s+/)[0]?.toLowerCase() || 'text',
      code: match[4].replace(/\r?\n$/, ''),
    });
  }
  return results;
}

export function scanInlineCode(text: string, excluded: SourceRange[] = []): SourceRange[] {
  const results: SourceRange[] = [];
  const pattern = /(`+)([^`\n]*?)\1/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const range = { from: match.index, to: match.index + match[0].length };
    if (!overlaps(range, excluded)) results.push(range);
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

  const blockPattern = /\$\$([\s\S]*?)\$\$/g;
  while ((match = blockPattern.exec(text))) {
    const range = { from: match.index, to: match.index + match[0].length };
    addRange(range, match[1].trim(), true);
  }

  const bracketBlockPattern = /\\\[([\s\S]*?)\\\]/g;
  while ((match = bracketBlockPattern.exec(text))) {
    const range = { from: match.index, to: match.index + match[0].length };
    addRange(range, match[1].trim(), true);
  }

  const environmentPattern = /\\begin\{(equation\*?|align\*?|aligned|gather\*?|multline\*?|split)\}([\s\S]*?)\\end\{\1\}/g;
  while ((match = environmentPattern.exec(text))) {
    const range = { from: match.index, to: match.index + match[0].length };
    addRange(range, match[0].trim(), true);
  }

  const inlinePattern = /(?<!\$)\$(?!\s)([^\$\n]+?)(?<!\s)\$(?!\$)/g;
  while ((match = inlinePattern.exec(text))) {
    const range = { from: match.index, to: match.index + match[0].length };
    addRange(range, match[1], false);
  }

  const parenInlinePattern = /\\\(([^\n]*?)\\\)/g;
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
