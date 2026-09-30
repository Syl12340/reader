import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import { Decoration } from '@codemirror/view';
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

export function collectMarkerDecorations(
  state: EditorState,
  visibleRanges: readonly SourceRange[],
  covered: SourceRange[],
  active: (range: SourceRange) => boolean,
): DecorationRange[] {
  const ranges: DecorationRange[] = [];
  for (const visible of visibleRanges) {
    syntaxTree(state).iterate({
      from: visible.from,
      to: visible.to,
      enter(node) {
        const range = { from: node.from, to: node.to };
        if (isCovered(range, covered)) return;
        const parent = node.node.parent;
        const parentRange = parent ? { from: parent.from, to: parent.to } : range;
        const nodeActive = active(parentRange);

        const headingMatch = node.name.match(/^ATXHeading(\d)$/);
        if (headingMatch) {
          ranges.push({
            ...range,
            decoration: Decoration.mark({
              class: `cm-heading ${headingClasses[Number(headingMatch[1]) - 1]}`,
            }),
          });
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
  return ranges;
}
