<script lang="ts">
  export interface SlashItem {
    id: string;
    label: string;
    description: string;
    icon: string;
  }

  let {
    visible = false,
    x = 0,
    y = 0,
    query = '',
    onSelect,
    onClose,
  }: {
    visible?: boolean;
    x?: number;
    y?: number;
    query?: string;
    onSelect?: (item: SlashItem) => void;
    onClose?: () => void;
  } = $props();

  const items: SlashItem[] = [
    { id: 'h1', label: '一级标题', description: '大标题', icon: 'H1' },
    { id: 'h2', label: '二级标题', description: '中标题', icon: 'H2' },
    { id: 'h3', label: '三级标题', description: '小标题', icon: 'H3' },
    { id: 'code', label: '代码块', description: '插入 fenced code', icon: '</>' },
    { id: 'latex', label: '数学公式', description: '插入 LaTeX 公式块', icon: 'Σ' },
    { id: 'mermaid', label: 'Mermaid 图表', description: '插入流程图', icon: '◇' },
    { id: 'table', label: '表格', description: '选择行列并插入表格', icon: '▦' },
    { id: 'quote', label: '引用', description: '引用文本', icon: '❝' },
    { id: 'hr', label: '分割线', description: '水平分割线', icon: '—' },
    { id: 'image', label: '图片', description: '插入图片语法', icon: '▧' },
    { id: 'ul', label: '无序列表', description: '项目列表', icon: '•' },
    { id: 'ol', label: '有序列表', description: '编号列表', icon: '1.' },
    { id: 'task', label: '任务列表', description: '待办事项', icon: '☐' },
  ];

  let selectedIndex = $state(0);
  let filteredItems = $derived(items.filter(item => {
    const normalized = query.trim().toLowerCase();
    return !normalized
      || item.id.includes(normalized)
      || item.label.toLowerCase().includes(normalized)
      || item.description.toLowerCase().includes(normalized);
  }));

  $effect(() => {
    query;
    selectedIndex = 0;
  });

  function select(item: SlashItem): void {
    onSelect?.(item);
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (!visible) return;
    if (event.key === 'Escape') {
      event.stopPropagation();
      event.preventDefault();
      onClose?.();
    } else if (event.key === 'ArrowDown' && filteredItems.length) {
      event.stopPropagation();
      event.preventDefault();
      selectedIndex = (selectedIndex + 1) % filteredItems.length;
    } else if (event.key === 'ArrowUp' && filteredItems.length) {
      event.stopPropagation();
      event.preventDefault();
      selectedIndex = (selectedIndex - 1 + filteredItems.length) % filteredItems.length;
    } else if (event.key === 'Enter' && filteredItems[selectedIndex]) {
      event.stopPropagation();
      event.preventDefault();
      select(filteredItems[selectedIndex]);
    }
  }
</script>

<svelte:window onkeydowncapture={handleKeydown} />

{#if visible && filteredItems.length > 0}
  <div
    class="slash-menu"
    style="left: {x}px; top: {y}px;"
    role="listbox"
    aria-label="插入内容"
  >
    {#each filteredItems as item, index}
      <button
        type="button"
        class="slash-menu-item"
        class:selected={index === selectedIndex}
        role="option"
        aria-selected={index === selectedIndex}
        onmousedown={(event) => {
          event.preventDefault();
          select(item);
        }}
      >
        <span class="slash-menu-icon">{item.icon}</span>
        <span class="slash-menu-label">{item.label}</span>
        <span class="slash-menu-desc">{item.description}</span>
      </button>
    {/each}
  </div>
{/if}

<style>
  .slash-menu {
    position: fixed;
    z-index: 200;
    width: 260px;
    max-height: 340px;
    overflow-y: auto;
    padding: 6px;
    background: var(--ui-panel);
    border: 1px solid var(--ui-border);
    border-radius: 6px;
    box-shadow: var(--ui-shadow-popover);
  }
  .slash-menu-item {
    display: grid;
    grid-template-columns: 28px 1fr;
    gap: 0 10px;
    width: 100%;
    padding: 6px 10px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--ui-text);
    text-align: left;
    cursor: pointer;
  }
  .slash-menu-item:hover,
  .slash-menu-item.selected {
    background: var(--ui-panel-hover);
  }
  .slash-menu-icon {
    grid-row: 1 / 3;
    display: grid;
    place-items: center;
    min-height: 28px;
    border-radius: 4px;
    background: var(--ui-bg);
    color: var(--ui-text-muted);
    font-size: 12px;
  }
  .slash-menu-label { font-size: 13px; font-weight: 500; }
  .slash-menu-desc { font-size: 11px; color: var(--ui-text-muted); }
</style>
