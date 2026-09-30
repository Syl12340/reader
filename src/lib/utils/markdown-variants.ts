import { markdownLanguage } from '@codemirror/lang-markdown';

export function convertMarkdownVariant(source: string, variant: 'gfm' | 'commonmark'): string {
  const changes: Array<{ from: number; to: number; insert: string }> = [];
  const tree = markdownLanguage.parser.parse(source);
  tree.iterate({
    enter(node) {
      if (['FencedCode', 'CodeBlock', 'InlineCode', 'HTMLBlock', 'HTMLTag'].includes(node.name)) return false;
      if (node.name === 'TaskMarker') {
        if (variant === 'gfm') {
          if (source.slice(node.from, node.to) === '[X]') changes.push({ from: node.from, to: node.to, insert: '[x]' });
        } else {
          let to = node.to;
          while (source[to] === ' ' || source[to] === '\t') to++;
          changes.push({ from: node.from, to, insert: '' });
        }
      } else if (variant === 'commonmark' && node.name === 'StrikethroughMark') {
        changes.push({ from: node.from, to: node.to, insert: '' });
      } else if (variant === 'commonmark' && node.name === 'TableDelimiter') {
        const parent = node.node.parent;
        if (parent?.name === 'Table' || parent?.firstChild?.from === node.from || parent?.lastChild?.to === node.to) {
          changes.push({ from: node.from, to: node.to, insert: '' });
        }
      }
    },
  });

  // Splice only parsed syntax markers, leaving all literal source bytes intact.
  changes.sort((a, b) => a.from - b.from);
  const output: string[] = [];
  let offset = 0;
  for (const change of changes) {
    if (change.from < offset) continue;
    output.push(source.slice(offset, change.from), change.insert);
    offset = change.to;
  }
  output.push(source.slice(offset));
  return output.join('');
}
