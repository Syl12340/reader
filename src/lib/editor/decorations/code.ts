import { WidgetType, type EditorView } from '@codemirror/view';
import type { FenceRange } from '../markdown-scanner';
import { makeSourceButton } from './common';
import { revealSource } from './common';
import { installFigureControls } from '../../utils/figure';
import { notify } from '../../services/interaction';

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
      && other.item.from === this.item.from && other.item.to === this.item.to;
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
      try {
        await navigator.clipboard.writeText(this.item.code);
        if (!copy.isConnected) return;
        copy.textContent = '已复制';
        setTimeout(() => { if (copy.isConnected) copy.textContent = '复制'; }, 1200);
      } catch { notify('复制失败，请检查剪贴板权限或手动选择代码。'); }
    });
    actions.append(copy, makeSourceButton('编辑', view, this.item.from));
    header.append(language, actions);
    const body = document.createElement('div');
    body.className = 'cm-code-widget-body';
    body.textContent = this.item.code;
    container.append(header, body);
    const source = view.state.doc.sliceString(this.item.from, this.item.to);
    const current = () => container.isConnected && container.dataset.destroyed !== 'true'
      && view.state.doc.sliceString(this.item.from, this.item.to) === source;

    void import('../../utils/highlight')
      .then(({ highlightCode }) => {
        return highlightCode(this.item.code, this.item.language, this.theme === 'dark' ? 'dark' : 'light');
      })
      .then(html => {
        if (!current()) return;
        body.innerHTML = html;
      })
      .catch(error => {
        if (!current()) return;
        body.textContent = this.item.code;
        body.title = error instanceof Error ? error.message : '高亮不可用，显示源码';
      });
    return container;
  }

  get estimatedHeight(): number {
    return 160;
  }

  destroy(dom: HTMLElement): void { dom.dataset.destroyed = 'true'; }
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
      && other.item.from === this.item.from && other.item.to === this.item.to;
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('div');
    container.className = 'cm-mermaid-widget cm-block-widget';
    const body = document.createElement('div');
    body.className = 'cm-mermaid-widget-body';
    body.textContent = '正在渲染 Mermaid…';
    container.append(body);
    const source = view.state.doc.sliceString(this.item.from, this.item.to);
    const current = () => container.isConnected && container.dataset.destroyed !== 'true'
      && view.state.doc.sliceString(this.item.from, this.item.to) === source;

    void import('../../utils/mermaid')
      .then(({ renderMermaid }) => renderMermaid(
        this.item.code,
        this.theme === 'dark' ? 'dark' : 'light',
      ))
      .then(svg => {
        if (!current()) return;
        container.innerHTML = svg;
        installFigureControls(container, { title: 'Mermaid 图表', source: this.item.code,
          edit: () => revealSource(view, this.item.from) });
        if (svg.includes('mermaid-error')) {
          container.querySelector('.mermaid-error')?.classList.add('cm-widget-error');
        }
      })
      .catch(error => {
        if (!current()) return;
        body.className += ' cm-widget-error';
        body.textContent = error instanceof Error ? error.message : 'Mermaid 渲染失败';
        container.append(makeSourceButton('编辑图表', view, this.item.from));
      });
    return container;
  }

  get estimatedHeight(): number {
    return 220;
  }

  destroy(dom: HTMLElement): void { dom.dataset.destroyed = 'true'; }
}

export class ChartWidget extends WidgetType {
  constructor(readonly item: FenceRange, readonly theme: 'light' | 'dark') { super(); }

  eq(other: ChartWidget): boolean {
    return other.item.code === this.item.code && other.theme === this.theme
      && other.item.from === this.item.from && other.item.to === this.item.to;
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('div');
    container.className = 'cm-chart-widget cm-block-widget';
    container.textContent = '图表正在渲染';
    const source = view.state.doc.sliceString(this.item.from, this.item.to);
    const current = () => container.isConnected && container.dataset.destroyed !== 'true'
      && view.state.doc.sliceString(this.item.from, this.item.to) === source;
    void import('../../utils/data-chart').then(({ renderDataChart, renderChartTable, renderChartError, parseDataChart }) => {
      if (!current()) return;
      let title = '数据图表';
      let valid = false;
      try { title = parseDataChart(this.item.code).title; container.innerHTML = renderDataChart(this.item.code, this.theme); valid = true; }
      catch (error) { container.innerHTML = renderChartError(this.item.code, error); }
      installFigureControls(container, { title, source: this.item.code,
        edit: () => revealSource(view, this.item.from), table: valid ? () => renderChartTable(this.item.code) : undefined });
    }).catch(() => {
      if (!current()) return;
      container.textContent = '图表加载失败';
      container.append(makeSourceButton('编辑图表', view, this.item.from));
    });
    return container;
  }

  destroy(dom: HTMLElement): void { dom.dataset.destroyed = 'true'; }
  get estimatedHeight(): number { return 420; }
}
