import { EditorSelection, type EditorState, type SelectionRange, type TransactionSpec } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { insertNewlineAndIndent, isolateHistory } from '@codemirror/commands';
import { insertNewlineContinueMarkup } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';

type MarkdownNode = ReturnType<ReturnType<typeof syntaxTree>['resolveInner']>;
type Edit = { from: number; to: number; insert: string };
interface RangeEdit { changes: Edit[]; range: SelectionRange; offset?: { from: number; to: number } }

export interface ActiveFormatting {
  bold: boolean;
  italic: boolean;
  strikethrough: boolean;
  code: boolean;
  link: boolean;
  heading: number;
  quote: boolean;
  inCode: boolean;
}

function containingNode(state: EditorState, range: SelectionRange, names: readonly string[], includeStart = false): MarkdownNode | null {
  for (let node: MarkdownNode | null = syntaxTree(state).resolveInner(range.from, 1); node; node = node.parent) {
    if (names.includes(node.name) && node.to >= range.to
      && (!range.empty || ((includeStart ? range.from >= node.from : range.from > node.from) && range.from < node.to))) return node;
  }
  return null;
}

function formatNode(state: EditorState, range: SelectionRange, name: string): MarkdownNode | null {
  const direct = containingNode(state, range, [name]);
  if (direct) return direct;
  let node = containingNode(state, range, ['StrongEmphasis', 'Emphasis', 'Strikethrough']);
  if (!node || node.from !== range.from || node.to !== range.to) return null;
  // A wholly selected nested wrapper can lose one format without losing the other.
  while (node) {
    const inner: MarkdownNode | null = node.firstChild?.nextSibling ?? null;
    if (!inner || inner.from === node.lastChild?.from || inner.nextSibling?.from !== node.lastChild?.from
      || !['StrongEmphasis', 'Emphasis', 'Strikethrough'].includes(inner.name)) return null;
    if (inner.name === name) return inner;
    node = inner;
  }
  return null;
}

function codeNode(state: EditorState, range: SelectionRange) {
  return containingNode(state, range, ['InlineCode', 'FencedCode', 'CodeBlock'], true);
}

function escaped(text: string, index: number): boolean {
  let slashes = 0;
  for (let at = index - 1; at >= 0 && text[at] === '\\'; at--) slashes++;
  return slashes % 2 === 1;
}

function emptyWrapper(state: EditorState, range: SelectionRange, before: string, after: string): Edit[] | null {
  if (!range.empty || range.from < before.length || range.to + after.length > state.doc.length) return null;
  const from = range.from - before.length, to = range.to + after.length;
  const line = state.doc.lineAt(from);
  if (state.sliceDoc(from, range.from) !== before || state.sliceDoc(range.to, to) !== after
    || escaped(line.text, from - line.from)
    || state.sliceDoc(Math.max(0, from - 1), from) === before[0]
    || state.sliceDoc(to, Math.min(to + 1, state.doc.length)) === after.at(-1)
    || state.selection.ranges.some(other => other !== range && other.from <= to && other.to >= from)) return null;
  return [{ from, to: range.from, insert: '' }, { from: range.to, to, insert: '' }];
}

function wrapRange(range: SelectionRange, before: string, after: string): RangeEdit {
  return range.empty
    ? { changes: [{ from: range.from, to: range.to, insert: before + after }], range,
      offset: { from: before.length, to: before.length } }
    : { changes: [{ from: range.from, to: range.from, insert: before }, { from: range.to, to: range.to, insert: after }], range };
}

function editTransaction(state: EditorState, edits: RangeEdit[]): TransactionSpec {
  const unique = new Map<string, Edit>();
  for (const edit of edits) for (const change of edit.changes) unique.set(JSON.stringify(change), change);
  const changes = state.changes([...unique.values()].sort((a, b) => a.from - b.from || a.to - b.to));
  const ranges = edits.map(({ range, offset, changes: own }) => {
    if (offset) {
      const start = changes.mapPos(range.from, -1);
      return EditorSelection.range(start + offset.from, start + offset.to);
    }
    if (!own.length) return range.map(changes);
    const from = changes.mapPos(range.from, 1), to = changes.mapPos(range.to, -1);
    return range.anchor <= range.head ? EditorSelection.range(from, Math.max(from, to))
      : EditorSelection.range(Math.max(from, to), from);
  });
  return { changes, selection: EditorSelection.create(ranges, state.selection.mainIndex),
    annotations: isolateHistory.of('full'), userEvent: 'input.format', scrollIntoView: true };
}

function dispatchEdit(view: EditorView, spec: TransactionSpec): void {
  const transaction = view.state.update(spec);
  if (transaction.docChanged || !transaction.newSelection.eq(view.state.selection)) view.dispatch(transaction);
}

export function formatTransaction(state: EditorState, before: string, after: string): TransactionSpec {
  const name = before === '**' ? 'StrongEmphasis' : before === '*' ? 'Emphasis'
    : before === '~~' ? 'Strikethrough' : null;
  return editTransaction(state, state.selection.ranges.map(range => {
    if (codeNode(state, range)) return { changes: [], range };
    const node = name ? formatNode(state, range, name) : null;
    const first = node?.firstChild, last = node?.lastChild;
    if (first && last && first.from !== last.from) return { changes: [
      { from: first.from, to: first.to, insert: '' }, { from: last.from, to: last.to, insert: '' },
    ], range };
    const empty = emptyWrapper(state, range, before, after);
    return empty ? { changes: empty, range } : wrapRange(range, before, after);
  }));
}

export function toggleFormat(view: EditorView, before: string, after: string): void {
  if (view.composing) return;
  if (before === '`' || before === '```\n') { toggleCode(view, before === '```\n'); return; }
  dispatchEdit(view, formatTransaction(view.state, before, after));
}

export function codeTransaction(state: EditorState, forceBlock = false): TransactionSpec {
  return editTransaction(state, state.selection.ranges.map(range => {
    const node = codeNode(state, range);
    if (node?.name === 'CodeBlock') return { changes: [], range };
    if (node?.name === 'InlineCode' && node.firstChild && node.lastChild) {
      const body = state.sliceDoc(node.firstChild.to, node.lastChild.from);
      const padding = body.startsWith(' ') && body.endsWith(' ') && /[^ ]/.test(body) ? 1 : 0;
      return { changes: [
        { from: node.firstChild.from, to: node.firstChild.to + padding, insert: '' },
        { from: node.lastChild.from - padding, to: node.lastChild.to, insert: '' },
      ], range };
    }
    if (node?.name === 'FencedCode') {
      const first = node.firstChild, last = node.lastChild;
      if (first?.name !== 'CodeMark' || last?.name !== 'CodeMark' || first.from === last.from) return { changes: [], range };
      const opening = state.doc.lineAt(first.from), closing = state.doc.lineAt(last.from);
      return { changes: [
        { from: opening.from, to: Math.min(opening.to + 1, state.doc.length), insert: '' },
        { from: Math.max(opening.to + 1, closing.from - 1), to: closing.to, insert: '' },
      ], range };
    }
    const text = state.sliceDoc(range.from, range.to);
    let run = 0;
    for (const match of text.matchAll(/`+/g)) run = Math.max(run, match[0].length);
    if (forceBlock || text.includes('\n')) {
      const fence = '`'.repeat(Math.max(3, run + 1));
      const before = state.sliceDoc(state.doc.lineAt(range.from).from, range.from).trim() ? '\n\n' : '';
      const after = state.sliceDoc(range.to, state.doc.lineAt(range.to).to).trim() ? '\n\n' : '';
      return wrapRange(range, `${before}${fence}\n`, `\n${fence}${after}`);
    }
    const empty = emptyWrapper(state, range, '`', '`');
    if (empty) return { changes: empty, range };
    const marker = '`'.repeat(run + 1);
    const pad = text.startsWith('`') || text.endsWith('`') || (/^ .+ $/.test(text) && /[^ ]/.test(text)) ? ' ' : '';
    return wrapRange(range, marker + pad, pad + marker);
  }));
}

export function toggleCode(view: EditorView, forceBlock = false): void {
  if (!view.composing) dispatchEdit(view, codeTransaction(view.state, forceBlock));
}

export function toggleLinePrefix(view: EditorView, prefix: string): void {
  if (view.composing) return;
  const state = view.state;
  if (state.selection.ranges.some(range => codeNode(state, range))) return;
  const numbers = new Set<number>();
  for (const range of state.selection.ranges) {
    const last = state.doc.lineAt(range.to > range.from ? range.to - 1 : range.to).number;
    for (let line = state.doc.lineAt(range.from).number; line <= last; line++) numbers.add(line);
  }
  const delimiterChanges = new Map<number, Edit>();
  const lines = [...numbers].sort((a, b) => a - b).map(number => {
    const line = state.doc.line(number);
    const indent = line.text.match(/^[ \t]*/)?.[0] ?? '';
    let from = line.from + indent.length;
    if (prefix.startsWith('#')) syntaxTree(state).iterate({ from: line.from, to: line.to, enter(node) {
      if ((node.name === 'QuoteMark' || node.name === 'ListMark') && node.from === from) {
        from = node.to;
        while (from < line.to && /[ \t]/.test(state.sliceDoc(from, from + 1))) from++;
      }
    } });
    if (codeNode(state, EditorSelection.cursor(from))) return null;
    if (prefix.startsWith('#')) {
      const setext = containingNode(state, EditorSelection.cursor(from), ['SetextHeading1', 'SetextHeading2'], true);
      if (setext) {
        const first = state.doc.lineAt(setext.from), delimiter = state.doc.lineAt(setext.to - 1);
        // Do not split a multiline Setext title into several unrelated headings.
        if (delimiter.number !== first.number + 1) return null;
        delimiterChanges.set(delimiter.from, { from: delimiter.from - 1, to: delimiter.to, insert: '' });
        return { from: setext.from, to: setext.from, existing: '#'.repeat(Number(setext.name.at(-1))) + ' ' };
      }
    }
    const body = state.sliceDoc(from, line.to);
    const existing = prefix.startsWith('#') ? body.match(/^#{1,6}(?:[ \t]+|$)/)?.[0] ?? ''
      : body.startsWith(prefix) ? prefix : '';
    return { from, to: from + existing.length, existing };
  });
  const eligible = [...new Map(lines.filter((line): line is { from: number; to: number; existing: string } => line !== null)
    .map(line => [line.from, line])).values()];
  if (!eligible.length) return;
  const remove = eligible.every(line => prefix.startsWith('#') ? line.existing.trimEnd() === prefix.trimEnd() : line.existing === prefix);
  const changes = state.changes([...eligible.map(line => ({ from: line.from, to: line.to, insert: remove ? '' : prefix })),
    ...delimiterChanges.values()].sort((a, b) => a.from - b.from));
  dispatchEdit(view, { changes, selection: state.selection.map(changes), annotations: isolateHistory.of('full'),
    userEvent: 'input.format', scrollIntoView: true });
}

export function linkTransaction(state: EditorState): TransactionSpec {
  return editTransaction(state, state.selection.ranges.map(range => {
    if (codeNode(state, range)) return { changes: [], range };
    const node = containingNode(state, range, ['Link']);
    if (node) {
      const url = node.getChild('URL');
      if (url) {
        const angle = state.sliceDoc(url.from, url.to).startsWith('<');
        return { changes: [], range: EditorSelection.range(url.from + (angle ? 1 : 0), url.to - (angle ? 1 : 0)) };
      }
      const open = node.getChildren('LinkMark').find(mark => state.sliceDoc(mark.from, mark.to) === '(');
      if (open) return { changes: [], range: EditorSelection.cursor(open.to) };
      // Reference links have no local URL; preserve them rather than create a nested link.
      return { changes: [], range };
    }
    const text = (state.sliceDoc(range.from, range.to) || '文字').replace(/\r?\n/g, ' ');
    let label = '';
    for (let index = 0; index < text.length; index++) {
      if ('[]'.includes(text[index]) && !escaped(text, index)) label += '\\';
      label += text[index];
    }
    if (escaped(label, label.length)) label += '\\';
    return { changes: [{ from: range.from, to: range.to, insert: `[${label}](url)` }], range,
      offset: { from: label.length + 3, to: label.length + 6 } };
  }));
}

export function insertLink(view: EditorView): void {
  if (!view.composing) dispatchEdit(view, linkTransaction(view.state));
}

export function activeFormatting(state: EditorState): ActiveFormatting {
  const ranges = state.selection.ranges;
  const every = (name: string) => ranges.every(range => !!formatNode(state, range, name));
  const heading = ranges.map(range => {
    const node = containingNode(state, range, ['ATXHeading1', 'ATXHeading2', 'ATXHeading3', 'ATXHeading4', 'ATXHeading5', 'ATXHeading6',
      'SetextHeading1', 'SetextHeading2']);
    return node ? Number(node.name.at(-1)) : 0;
  });
  return { bold: every('StrongEmphasis'), italic: every('Emphasis'), strikethrough: every('Strikethrough'),
    code: ranges.every(range => !!codeNode(state, range)), inCode: ranges.some(range => !!codeNode(state, range)),
    link: ranges.every(range => !!containingNode(state, range, ['Link'])),
    heading: heading.every(level => level === heading[0]) ? heading[0] : 0,
    quote: ranges.every(range => !!containingNode(state, range, ['Blockquote'])) };
}

export function markdownEnter(view: EditorView): boolean {
  if (view.composing) return false;
  return insertNewlineContinueMarkup(view) || insertNewlineAndIndent(view);
}
