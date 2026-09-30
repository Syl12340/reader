import { WidgetType, type EditorView } from '@codemirror/view';
import type { FenceRange } from '../markdown-scanner';
import { makeSourceButton } from './common';

export class CodeWidget extends WidgetType {
  constructor(
    readonly item: FenceRange,
    readonly theme: string,
    readonly version: string,
  ) {
    super();
  }

  eq(other: CodeWidget): boolean {
    return other.item.code === this.item.code
      && other.item.language === this.item.language
      && other.theme === this.theme
      && other.version === this.version;
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('div');
    container.className = 'cm-code-widget cm-block-widget';
    const header = document.createElement('div');
    header.className = 'cm-code-widget-header';
    const language = document.createElement('span');
    language.textContent = this.item.language || 'text';
    const actions = document.createElement('span');
    actions.className = 'cm-code-widget-actions';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = '复制';
    copy.addEventListener('click', async () => {
      await navigator.clipboard?.writeText(this.item.code);
      copy.textContent = '已复制';
      setTimeout(() => { copy.textContent = '复制'; }, 1200);
    });
    actions.append(copy, makeSourceButton('编辑', view, this.item.from));
    header.append(language, actions);
    const body = document.createElement('div');
    body.className = 'cm-code-widget-body';
    body.textContent = this.item.code;
    container.append(header, body);

    void import('../../utils/highlight')
      .then(({ highlightCode }) => {
        return highlightCode(this.item.code, this.item.language, this.theme === 'dark' ? 'dark' : 'light');
      })
      .then(html => {
        if (!container.isConnected) return;
        body.innerHTML = html;
      })
      .catch(error => {
        if (!container.isConnected) return;
        body.textContent = error instanceof Error ? error.message : this.item.code;
        body.classList.add('cm-widget-error');
      });
    return container;
  }

  get estimatedHeight(): number {
    return 160;
  }
}

export class MermaidWidget extends WidgetType {
  constructor(
    readonly item: FenceRange,
    readonly theme: string,
    readonly version: string,
  ) {
    super();
  }

  eq(other: MermaidWidget): boolean {
    return other.item.code === this.item.code
      && other.theme === this.theme
      && other.version === this.version;
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('div');
    container.className = 'cm-mermaid-widget cm-block-widget';
    const body = document.createElement('div');
    body.className = 'cm-mermaid-widget-body';
    body.textContent = '正在渲染 Mermaid…';
    container.append(body, makeSourceButton('编辑图表', view, this.item.from));

    void import('../../utils/mermaid')
      .then(({ renderMermaid }) => renderMermaid(
        this.item.code,
        this.theme === 'dark' ? 'dark' : 'light',
      ))
      .then(svg => {
        if (!container.isConnected) return;
        body.innerHTML = svg;
        if (svg.includes('mermaid-error')) {
          body.className += ' cm-widget-error';
        }
      })
      .catch(error => {
        if (!container.isConnected) return;
        body.className += ' cm-widget-error';
        body.textContent = error instanceof Error ? error.message : 'Mermaid 渲染失败';
      });
    return container;
  }

  get estimatedHeight(): number {
    return 220;
  }
}
