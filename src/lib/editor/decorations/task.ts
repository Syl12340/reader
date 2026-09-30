import { WidgetType, type EditorView } from '@codemirror/view';
import type { TaskRange } from '../markdown-scanner';

export class TaskWidget extends WidgetType {
  constructor(readonly item: TaskRange) {
    super();
  }

  eq(other: TaskWidget): boolean {
    return other.item.checked === this.item.checked && other.item.from === this.item.from;
  }

  toDOM(view: EditorView): HTMLElement {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'cm-task-widget';
    input.checked = this.item.checked;
    input.setAttribute(
      'aria-label',
      this.item.checked ? '标记任务为未完成' : '标记任务为完成',
    );
    input.addEventListener('mousedown', event => event.stopPropagation());
    input.addEventListener('change', () => {
      const current = view.state.sliceDoc(this.item.from, this.item.to);
      if (!/^\[[ xX]\]$/.test(current)) return;
      view.dispatch({
        changes: {
          from: this.item.from,
          to: this.item.to,
          insert: input.checked ? '[x]' : '[ ]',
        },
      });
      view.focus();
    });
    return input;
  }
}
