import { WidgetType, type EditorView } from '@codemirror/view';
import type { TableRange } from '../markdown-scanner';

export class TableWidget extends WidgetType {
  constructor(readonly item: TableRange, readonly sessionId: string) {
    super();
  }

  eq(other: TableWidget): boolean {
    return other.item.markdown === this.item.markdown && other.sessionId === this.sessionId
      && other.item.from === this.item.from && other.item.to === this.item.to;
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('div');
    container.className = 'cm-table-widget cm-block-widget';
    const table = document.createElement('table');
    const [header, ...rows] = this.item.rows;
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    header.forEach((cell, index) => {
      const th = document.createElement('th');
      th.textContent = cell;
      th.style.textAlign = this.item.alignments[index] || 'left';
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    const tbody = document.createElement('tbody');
    rows.forEach(row => {
      const tr = document.createElement('tr');
      header.forEach((_, index) => {
        const td = document.createElement('td');
        td.textContent = row[index] || '';
        td.style.textAlign = this.item.alignments[index] || 'left';
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.append(thead, tbody);

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'cm-table-edit-button';
    edit.textContent = '编辑表格';
    edit.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('table-edit-request', {
        detail: {
          sessionId: this.sessionId,
          from: this.item.from,
          to: this.item.to,
          markdown: this.item.markdown,
        },
      }));
      view.focus();
    });
    container.append(table, edit);
    return container;
  }

  get estimatedHeight(): number {
    return 180;
  }
}
