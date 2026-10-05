import { WidgetType, type EditorView } from '@codemirror/view';
import { formatMarkdownTable, type TableRange } from '../markdown-scanner';
import { RenderService } from '$lib/services/render';
import { isolateHistory } from '@codemirror/commands';

export class TableWidget extends WidgetType {
  constructor(readonly item: TableRange, readonly sessionId: string, readonly filePath: string | null = null) {
    super();
  }

  eq(other: TableWidget): boolean {
    return other.item.markdown === this.item.markdown && other.sessionId === this.sessionId
      && other.item.from === this.item.from && other.item.to === this.item.to && other.filePath === this.filePath;
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('div');
    container.className = 'cm-table-widget cm-block-widget';
    container.dataset.tableFrom = String(this.item.from);
    const table = document.createElement('table');
    table.setAttribute('role', 'grid');
    table.setAttribute('aria-label', 'Markdown 表格，Enter 编辑，Tab 切换单元格');
    const width = this.item.rows[0].length;
    const showCell = (cell: HTMLElement, value: string) => {
      cell.innerHTML = RenderService.inline(value, this.filePath) || '<span class="cm-table-empty">&nbsp;</span>';
    };
    const setupCell = (cell: HTMLElement, row: number, column: number) => {
      cell.tabIndex = 0;
      cell.dataset.cell = `${row}:${column}`;
      cell.setAttribute('role', row === 0 ? 'columnheader' : 'gridcell');
      cell.setAttribute('aria-label', `第 ${row + 1} 行第 ${column + 1} 列，Enter 编辑`);
      showCell(cell, this.item.rows[row]?.[column] || '');
      const editCell = () => {
        if (cell.querySelector('input')) return;
        const input = document.createElement('input');
        input.className = 'cm-table-cell-input';
        input.value = this.item.rows[row]?.[column] || '';
        input.setAttribute('aria-label', `编辑第 ${row + 1} 行第 ${column + 1} 列`);
        cell.replaceChildren(input);
        let finished = false;
        const commit = (rows: string[][], next?: [number, number]) => {
          if (finished) return;
          finished = true;
          const { from, to, markdown } = this.item;
          if (!input.isConnected || to > view.state.doc.length || view.state.sliceDoc(from, to) !== markdown) return;
          const replacement = formatMarkdownTable(rows, this.item.alignments, this.item.dividerCells);
          if (replacement !== markdown) view.dispatch({ changes: { from, to, insert: replacement },
            annotations: isolateHistory.of('full'), userEvent: 'input.table' });
          else showCell(cell, rows[row][column]);
          requestAnimationFrame(() => {
            if (!view.dom.isConnected) return;
            const target = next ?? [row, column];
            view.dom.querySelector<HTMLElement>(`[data-table-from="${from}"] [data-cell="${target[0]}:${target[1]}"]`)?.focus();
          });
        };
        const snapshot = () => { const rows = this.item.rows.map(row => [...row]); rows[row][column] = input.value; return rows; };
        input.addEventListener('keydown', event => {
          if (event.isComposing) return;
          if (event.key === 'Escape') {
            event.preventDefault(); event.stopPropagation(); finished = true;
            showCell(cell, this.item.rows[row][column]); cell.focus();
          } else if (event.key === 'Tab' || event.key === 'Enter') {
            event.preventDefault(); event.stopPropagation();
            const rows = snapshot();
            let index = row * width + column + (event.shiftKey ? -1 : 1);
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              rows.splice(row + 1, 0, Array(width).fill(''));
              index = (row + 1) * width + column;
            } else if (event.key === 'Enter') index = row * width + column;
            if (index >= rows.length * width) rows.push(Array(width).fill(''));
            index = Math.max(0, index);
            commit(rows, [Math.floor(index / width), index % width]);
          }
        });
        input.addEventListener('paste', event => {
          const text = event.clipboardData?.getData('text/plain') || '';
          if (!text.includes('\t') && !text.includes('\n')) return;
          event.preventDefault(); event.stopPropagation();
          const rows = snapshot();
          const pasted = text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n').map(line => line.split('\t'));
          const columns = Math.max(width, column + Math.max(...pasted.map(line => line.length)));
          while (rows.length < row + pasted.length) rows.push(Array(columns).fill(''));
          rows.forEach(line => { while (line.length < columns) line.push(''); });
          pasted.forEach((line, r) => line.forEach((value, c) => { rows[row + r][column + c] = value; }));
          commit(rows);
        });
        input.addEventListener('blur', () => commit(snapshot()));
        input.focus(); input.select();
      };
      cell.addEventListener('click', event => {
        if (!(event.target instanceof Element) || event.target.closest('a, input')) return;
        editCell();
      });
      cell.addEventListener('keydown', event => {
        if (event.target !== cell) return;
        if (event.key === 'Enter' || event.key === 'F2') { event.preventDefault(); editCell(); }
        else if (event.key === 'Tab') {
          const index = row * width + column + (event.shiftKey ? -1 : 1);
          const next = container.querySelector<HTMLElement>(`[data-cell="${Math.floor(index / width)}:${index % width}"]`);
          if (next) { event.preventDefault(); next.focus(); }
        }
      });
    };
    const [header, ...rows] = this.item.rows;
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    header.forEach((cell, index) => {
      const th = document.createElement('th');
      setupCell(th, 0, index);
      th.style.textAlign = this.item.alignments[index] || 'left';
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    const tbody = document.createElement('tbody');
    rows.forEach((row, rowIndex) => {
      const tr = document.createElement('tr');
      header.forEach((_, index) => {
        const td = document.createElement('td');
        setupCell(td, rowIndex + 1, index);
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
