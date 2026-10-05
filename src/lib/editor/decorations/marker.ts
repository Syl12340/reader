import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import { Decoration, WidgetType } from '@codemirror/view';
import type { SourceRange } from '../markdown-scanner';
import { isCovered, type DecorationRange } from './common';

const headingClasses = [
  'cm-heading-1',
  'cm-heading-2',
  'cm-heading-3',
  'cm-heading-4',
  'cm-heading-5',
  'cm-heading-6',
];

class ListMarkerWidget extends WidgetType {
  constructor(readonly marker: string) { super(); }
  eq(other: ListMarkerWidget) { return other.marker === this.marker; }
  toDOM() {
    const marker = document.createElement('span');
    marker.className = 'cm-list-bullet';
    marker.textContent = /^\d/.test(this.marker) ? this.marker : '\u2022';
    marker.setAttribute('aria-hidden', 'true');
    return marker;
  }
}

export function collectMarkerDecorations(
  state: EditorState,
  visibleRanges: readonly SourceRange[],
  covered: SourceRange[],
  active: (range: SourceRange) => boolean,
): DecorationRange[] {
  const ranges: DecorationRange[] = [];
  const lines = new Map<number, { heading?: number; quote: number; list: number; delimiter?: boolean }>();
  for (const visible of visibleRanges) {
    const last = state.doc.lineAt(visible.to).number;
    for (let number = state.doc.lineAt(visible.from).number; number <= last; number++) {
      const line = state.doc.line(number);
      let node = syntaxTree(state).resolveInner(line.from);
      let inCode = false;
      for (let parent: typeof node | null = node; parent; parent = parent.parent) {
        if (/^(FencedCode|CodeBlock|InlineCode)$/.test(parent.name)) { inCode = true; break; }
      }
      if (!line.text && !inCode && !active({ from: line.from, to: line.to }) && !isCovered({ from: line.from, to: line.to }, covered)) {
        ranges.push({ from: line.from, to: line.from, decoration: Decoration.line({ class: 'cm-prose-gap' }) });
      }
    }
    syntaxTree(state).iterate({
      from: visible.from,
      to: visible.to,
      enter(node) {
        const range = { from: node.from, to: node.to };
        if (isCovered(range, covered)) return;
        const parent = node.node.parent;
        const parentRange = parent ? { from: parent.from, to: parent.to } : range;
        const nodeActive = active(parentRange);

        const headingMatch = node.name.match(/^(?:ATX|Setext)Heading(\d)$/);
        if (headingMatch) {
          const line = state.doc.lineAt(node.from);
          const style = lines.get(line.from) ?? { quote: 0, list: 0 };
          style.heading = Number(headingMatch[1]);
          lines.set(line.from, style);
          if (node.name.startsWith('Setext') && !active(range)) {
            const delimiter = state.doc.lineAt(node.to - 1);
            if (delimiter.number > line.number) lines.set(delimiter.from, { quote: 0, list: 0, delimiter: true });
          }
          ranges.push({
            ...range,
            decoration: Decoration.mark({
              class: `cm-heading ${headingClasses[Number(headingMatch[1]) - 1]}`,
            }),
          });
        } else if (node.name === 'Blockquote' || node.name === 'ListItem') {
          let depth = 1;
          for (let ancestor = parent; ancestor; ancestor = ancestor.parent) if (ancestor.name === node.name) depth++;
          const first = state.doc.lineAt(Math.max(node.from, visible.from));
          const last = state.doc.lineAt(Math.min(Math.max(node.from, node.to - 1), visible.to));
          for (let number = first.number; number <= last.number; number++) {
            const line = state.doc.line(number);
            if (isCovered({ from: line.from, to: line.to }, covered)) continue;
            const style = lines.get(line.from) ?? { quote: 0, list: 0 };
            if (node.name === 'Blockquote') style.quote = Math.max(style.quote, depth);
            else style.list = Math.max(style.list, depth);
            lines.set(line.from, style);
          }
        } else if (node.name === 'ListMark' && !nodeActive) {
          ranges.push({ ...range, decoration: Decoration.replace({ widget: new ListMarkerWidget(state.sliceDoc(node.from, node.to)) }) });
        } else if (node.name === 'StrongEmphasis') {
          ranges.push({ ...range, decoration: Decoration.mark({ class: 'cm-bold' }) });
        } else if (node.name === 'Emphasis') {
          ranges.push({ ...range, decoration: Decoration.mark({ class: 'cm-italic' }) });
        } else if (node.name === 'Strikethrough') {
          ranges.push({ ...range, decoration: Decoration.mark({ class: 'cm-strikethrough' }) });
        } else if (node.name === 'InlineCode') {
          ranges.push({
            ...range,
            decoration: Decoration.mark({
              class: nodeActive ? 'cm-inline-code-active' : 'cm-inline-code',
            }),
          });
        } else if (node.name === 'LinkText' && parent?.name === 'Link') {
          ranges.push({
            ...range,
            decoration: Decoration.mark({
              class: nodeActive ? 'cm-link-text-active' : 'cm-link-text',
            }),
          });
        }

        const marker = node.name === 'HeaderMark'
          || node.name === 'QuoteMark'
          || node.name === 'EmphasisMark'
          || node.name === 'StrikethroughMark'
          || node.name === 'LinkMark'
          || (node.name === 'URL' && (parent?.name === 'Link' || parent?.name === 'Image'));
        if (marker && !nodeActive) {
          ranges.push({
            ...range,
            decoration: Decoration.mark({ class: 'cm-hidden-marker' }),
          });
        }
      },
    });
  }
  for (const [from, style] of lines) ranges.push({ from, to: from, decoration: Decoration.line({
    class: `${style.heading ? `cm-heading-line cm-h${style.heading}-line` : ''}${style.quote ? ' cm-quote-line' : ''}${style.list ? ' cm-list-line' : ''}${style.delimiter ? ' cm-setext-delimiter' : ''}`,
    attributes: { style: `--quote-depth:${style.quote};--list-depth:${style.list};` },
  }) });
  return ranges;
}
