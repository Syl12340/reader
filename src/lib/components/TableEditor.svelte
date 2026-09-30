<script lang="ts">
  import { tick } from 'svelte';
  import type { TableEditRequest } from '$lib/types';
  import { formatMarkdownTable, scanTables } from '$lib/editor/markdown-scanner';

  let {
    visible = $bindable(false),
    request = null,
    onConfirm,
    onCancel,
  }: {
    visible?: boolean;
    request?: TableEditRequest | null;
    onConfirm?: (markdown: string) => void;
    onCancel?: () => void;
  } = $props();

  let dialog: HTMLDivElement | undefined = $state();
  let headers = $state<string[]>(['列 1', '列 2', '列 3']);
  let rows = $state<string[][]>([['', '', '']]);
  let alignments = $state<Array<'left' | 'center' | 'right'>>(['left', 'left', 'left']);
  let previousFocus: HTMLElement | null = null;

  $effect(() => {
    if (!visible) return;
    previousFocus = document.activeElement as HTMLElement | null;
    if (request?.markdown) {
      const table = scanTables(request.markdown)[0];
      if (table) {
        headers = [...table.rows[0]];
        rows = table.rows.slice(1).map(row => [...row]);
        alignments = [...table.alignments];
      }
    }
    void tick().then(() => dialog?.querySelector<HTMLButtonElement>('button')?.focus());
  });

  function close(cancelled = true): void {
    visible = false;
    if (cancelled) onCancel?.();
    void tick().then(() => previousFocus?.focus());
  }

  function confirm(): void {
    onConfirm?.(formatMarkdownTable([headers, ...rows], alignments));
    close(false);
  }

  function addColumn(): void {
    headers = [...headers, `列 ${headers.length + 1}`];
    alignments = [...alignments, 'left'];
    rows = rows.map(row => [...row, '']);
  }

  function removeColumn(index: number): void {
    if (headers.length === 1) return;
    headers = headers.filter((_, itemIndex) => itemIndex !== index);
    alignments = alignments.filter((_, itemIndex) => itemIndex !== index);
    rows = rows.map(row => row.filter((_, itemIndex) => itemIndex !== index));
  }

  function addRow(): void {
    rows = [...rows, Array(headers.length).fill('')];
  }

  function removeRow(index: number): void {
    rows = rows.length === 1 ? [Array(headers.length).fill('')] : rows.filter((_, itemIndex) => itemIndex !== index);
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab' || !dialog) return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button, input, select'));
    if (!focusable.length) return;
    const current = focusable.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey
      ? (current - 1 + focusable.length) % focusable.length
      : (current + 1) % focusable.length;
    event.preventDefault();
    focusable[next].focus();
  }
</script>

{#if visible}
  <div class="table-editor-backdrop" role="presentation" onmousedown={(event) => {
    if (event.target === event.currentTarget) close();
  }}>
    <div
      bind:this={dialog}
      class="table-editor"
      role="dialog"
      aria-modal="true"
      aria-labelledby="table-editor-title"
      tabindex="-1"
      onkeydown={handleKeydown}
    >
      <header>
        <h2 id="table-editor-title">表格编辑器</h2>
        <div class="header-actions">
          <button type="button" onclick={addColumn}>添加列</button>
          <button type="button" onclick={addRow}>添加行</button>
          <button type="button" class="primary" onclick={confirm}>应用</button>
          <button type="button" onclick={() => close()}>关闭</button>
        </div>
      </header>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th aria-label="行操作"></th>
              {#each headers as header, column}
                <th>
                  <input bind:value={headers[column]} aria-label={`第 ${column + 1} 列标题`} />
                  <select bind:value={alignments[column]} aria-label={`第 ${column + 1} 列对齐方式`}>
                    <option value="left">左对齐</option>
                    <option value="center">居中</option>
                    <option value="right">右对齐</option>
                  </select>
                  <button type="button" onclick={() => removeColumn(column)} aria-label={`删除第 ${column + 1} 列`}>删除列</button>
                </th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each rows as row, rowIndex}
              <tr>
                <th>
                  <button type="button" onclick={() => removeRow(rowIndex)} aria-label={`删除第 ${rowIndex + 1} 行`}>删除行</button>
                </th>
                {#each headers as _, column}
                  <td><input bind:value={rows[rowIndex][column]} aria-label={`第 ${rowIndex + 1} 行第 ${column + 1} 列`} /></td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <pre>{formatMarkdownTable([headers, ...rows], alignments)}</pre>
    </div>
  </div>
{/if}

<style>
  .table-editor-backdrop {
    position: fixed;
    inset: 0;
    z-index: 400;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.5);
  }
  .table-editor {
    width: min(920px, 90vw);
    max-height: 85vh;
    overflow: auto;
    padding: 18px;
    border: 1px solid var(--border-color);
    border-radius: 12px;
    background: var(--bg-primary);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  }
  header,
  .header-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  h2 { margin: 0; font-size: 18px; }
  button, input, select {
    padding: 6px 8px;
    border: 1px solid var(--border-color);
    border-radius: 5px;
    background: var(--bg-secondary);
    color: var(--text-primary);
  }
  button { cursor: pointer; }
  button.primary { background: var(--accent-color); color: white; }
  .table-wrapper { overflow: auto; margin: 16px 0; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 6px; border: 1px solid var(--border-color); vertical-align: top; }
  th input, td input { width: 100%; min-width: 100px; }
  th select { display: block; width: 100%; margin: 6px 0; }
  pre { white-space: pre-wrap; background: var(--bg-secondary); padding: 12px; border-radius: 6px; }
</style>
