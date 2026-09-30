import { EditorView, type Decoration } from '@codemirror/view';
import type { SourceRange } from '../markdown-scanner';

export interface DecorationRange extends SourceRange {
  decoration: Decoration;
}

export function revealSource(view: EditorView, position: number): void {
  const target = Math.min(position, view.state.doc.length);
  view.dispatch({
    selection: { anchor: target },
    effects: EditorView.scrollIntoView(target, { y: 'center' }),
  });
  view.focus();
}

export function makeSourceButton(
  label: string,
  view: EditorView,
  position: number,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cm-widget-source-button';
  button.textContent = label;
  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    revealSource(view, position);
  });
  return button;
}

export function isCovered(range: SourceRange, covered: SourceRange[]): boolean {
  return covered.some(item => range.from >= item.from && range.to <= item.to);
}
