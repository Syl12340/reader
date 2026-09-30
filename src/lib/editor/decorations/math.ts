import katex from 'katex';
import { WidgetType, type EditorView } from '@codemirror/view';
import type { MathRange } from '../markdown-scanner';
import { makeSourceButton, revealSource } from './common';

export class MathWidget extends WidgetType {
  constructor(
    readonly item: MathRange,
    readonly block: boolean,
    readonly theme: string,
  ) {
    super();
  }

  eq(other: MathWidget): boolean {
    return other.item.source === this.item.source
      && other.item.from === this.item.from && other.item.to === this.item.to
      && other.item.display === this.item.display
      && other.block === this.block
      && other.theme === this.theme;
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement(this.block ? 'div' : 'span');
    container.className = this.block
      ? 'cm-math-widget cm-block-widget'
      : 'cm-math-widget cm-inline-widget';
    try {
      container.innerHTML = katex.renderToString(this.item.source, {
        displayMode: this.item.display,
        throwOnError: true,
        trust: false,
        strict: 'warn',
      });
      container.tabIndex = 0;
      container.setAttribute('role', 'button');
      container.setAttribute('aria-label', '编辑公式');
      container.addEventListener('click', () => revealSource(view, this.item.from));
      container.addEventListener('keydown', event => {
        const keyboardEvent = event as KeyboardEvent;
        if (keyboardEvent.key === 'Enter' || keyboardEvent.key === ' ') {
          keyboardEvent.preventDefault();
          revealSource(view, this.item.from);
        }
      });
    } catch (error) {
      container.className += ' cm-widget-error';
      container.textContent = error instanceof Error ? error.message : '公式渲染失败';
      container.appendChild(makeSourceButton('编辑公式', view, this.item.from));
    }
    return container;
  }

  get estimatedHeight(): number {
    return this.block ? 72 : -1;
  }
}
