<script lang="ts">
  let {
    visible = false,
    x = 0,
    y = 0,
    onSelect,
    onClose,
  }: {
    visible?: boolean;
    x?: number;
    y?: number;
    onSelect?: (rows: number, cols: number) => void;
    onClose?: () => void;
  } = $props();

  const MAX_ROWS = 8;
  const MAX_COLS = 8;
  let picker = $state<HTMLDivElement>();
  let selectedRow = $state(0);
  let selectedCol = $state(0);

  $effect(() => {
    if (!visible) return;
    selectedRow = 0;
    selectedCol = 0;
    queueMicrotask(() => focusCell());
  });

  function focusCell(): void {
    picker?.querySelector<HTMLButtonElement>(
      `[data-row="${selectedRow}"][data-col="${selectedCol}"]`,
    )?.focus();
  }

  function select(row = selectedRow, col = selectedCol): void {
    onSelect?.(row + 1, col + 1);
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose?.();
      return;
    }

    const movement: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const delta = movement[event.key];
    if (delta) {
      event.preventDefault();
      selectedRow = Math.min(MAX_ROWS - 1, Math.max(0, selectedRow + delta[0]));
      selectedCol = Math.min(MAX_COLS - 1, Math.max(0, selectedCol + delta[1]));
      queueMicrotask(() => focusCell());
    }
  }
</script>

{#if visible}
  <div
    bind:this={picker}
    class="table-picker"
    style="left: {x}px; top: {y}px;"
    role="dialog"
    aria-label="选择表格大小"
    tabindex="-1"
    onkeydown={handleKeydown}
  >
    <div class="table-picker-header" aria-live="polite">
      {selectedRow + 1} × {selectedCol + 1}
    </div>
    <div class="table-picker-grid" role="grid" aria-label="表格行列">
      {#each Array(MAX_ROWS) as _, row}
        {#each Array(MAX_COLS) as _, col}
          <button
            type="button"
            class="table-picker-cell"
            class:active={row <= selectedRow && col <= selectedCol}
            data-row={row}
            data-col={col}
            role="gridcell"
            tabindex={row === selectedRow && col === selectedCol ? 0 : -1}
            aria-label={`${row + 1} 行 ${col + 1} 列`}
            onmouseenter={() => {
              selectedRow = row;
              selectedCol = col;
            }}
            onclick={() => select(row, col)}
          ></button>
        {/each}
      {/each}
    </div>
  </div>
{/if}

<style>
  .table-picker {
    position: fixed;
    z-index: 100;
    padding: 8px;
    background: var(--ui-panel);
    border: 1px solid var(--ui-border);
    border-radius: 6px;
    box-shadow: var(--ui-shadow-popover);
    animation: picker-in 0.12s ease-out;
  }

  @keyframes picker-in {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .table-picker-header {
    margin-bottom: 6px;
    color: var(--ui-text-muted);
    font-size: 12px;
    text-align: center;
  }

  .table-picker-grid {
    display: grid;
    grid-template-columns: repeat(8, 20px);
    grid-template-rows: repeat(8, 20px);
    gap: 2px;
  }

  .table-picker-cell {
    width: 20px;
    height: 20px;
    padding: 0;
    border: 1px solid var(--ui-border);
    border-radius: 2px;
    background: transparent;
    cursor: pointer;
    transition: background 0.05s;
  }

  .table-picker-cell.active {
    border-color: var(--ui-accent);
    background: var(--ui-accent);
    opacity: 0.6;
  }

  .table-picker-cell:focus-visible {
    outline: 2px solid var(--ui-accent);
    outline-offset: 1px;
  }
</style>
