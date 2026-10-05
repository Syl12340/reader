import type { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';

export function slashTrigger(state: EditorState): { from: number; to: number; query: string } | null {
  if (state.selection.ranges.length !== 1 || !state.selection.main.empty) return null;
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  if (state.sliceDoc(head, line.to).trim()) return null;
  const match = state.sliceDoc(line.from, head).match(
    /^\s*(?:(?:>\s*|(?:[-+*]|\d+[.)])\s+|\[[ xX]\]\s+))*\/([\p{L}\p{N}-]*)$/u,
  );
  if (!match) return null;
  let node = syntaxTree(state).resolveInner(Math.max(line.from, head - 1), 1);
  while (true) {
    if (/^(FencedCode|CodeBlock|InlineCode|Link|Image|HTMLBlock|HTMLTag)$/.test(node.name)) return null;
    if (!node.parent) break;
    node = node.parent;
  }
  return { from: head - match[1].length - 1, to: head, query: match[1] };
}
