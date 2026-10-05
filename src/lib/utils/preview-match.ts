export function clearPreviewMatch(container: HTMLElement): void {
  container.querySelectorAll('mark.preview-search-match').forEach(mark => {
    const parent = mark.parentNode;
    mark.replaceWith(document.createTextNode(mark.textContent || ''));
    parent?.normalize();
  });
  container.querySelectorAll('.preview-source-match').forEach(node => node.classList.remove('preview-source-match'));
}

function textNodes(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: node => (node as Text).parentElement?.closest('button, input, .katex-mathml, .code-header')
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const result: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) result.push(node as Text);
  return result;
}

// Render only the mapped block with sentinels to locate a source match across inline elements.
export function highlightPreviewMatch(container: HTMLElement, source: string, from: number, to: number,
  render: (source: string) => string): HTMLElement | null {
  clearPreviewMatch(container);
  const lines = source.split('\n');
  const line = source.slice(0, from).split('\n').length - 1;
  const blocks = [...container.querySelectorAll<HTMLElement>('[data-line][data-line-end]')]
    .filter(block => Number(block.dataset.line) <= line && Number(block.dataset.lineEnd) > line)
    .sort((a, b) => Number(b.dataset.line) - Number(a.dataset.line)
      || Number(a.dataset.lineEnd) - Number(b.dataset.lineEnd));
  const block = blocks[0];
  if (!block) return null;
  const start = Number(block.dataset.line);
  const end = Number(block.dataset.lineEnd);
  const offset = lines.slice(0, start).reduce((sum, text) => sum + text.length + 1, 0);
  const fragment = lines.slice(start, end).join('\n');
  const left = 'READERMATCHSTARTTOKEN';
  const right = 'READERMATCHENDTOKEN';
  const marked = fragment.slice(0, from - offset) + left + fragment.slice(from - offset, to - offset)
    + right + fragment.slice(to - offset);
  const template = document.createElement('div');
  template.innerHTML = render(marked);
  const renderedBlock = template.querySelector<HTMLElement>(block.tagName.toLowerCase()) ?? template;
  const rendered = textNodes(renderedBlock).map(node => node.data).join('');
  const a = rendered.indexOf(left);
  const b = rendered.indexOf(right);
  const actualNodes = textNodes(block);
  const actual = actualNodes.map(node => node.data).join('');
  if (a < 0 || b < a || actual !== rendered.replace(left, '').replace(right, '')) {
    block.classList.add('preview-source-match');
    return block;
  }
  let position = 0;
  let first: HTMLElement | null = null;
  for (const node of actualNodes) {
    const next = position + node.length;
    const localStart = Math.max(a - position, 0);
    const localEnd = Math.min(b - left.length - position, node.length);
    if (localStart < localEnd) {
      const range = document.createRange();
      range.setStart(node, localStart);
      range.setEnd(node, localEnd);
      const mark = document.createElement('mark');
      mark.className = 'preview-search-match';
      range.surroundContents(mark);
      first ??= mark;
    }
    position = next;
  }
  return first ?? block;
}
