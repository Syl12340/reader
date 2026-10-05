export interface ReadingAnchor { line: number; offset: number }

export function captureReadingAnchor(container: HTMLElement): ReadingAnchor | undefined {
  const top = container.getBoundingClientRect().top;
  let chosen: HTMLElement | undefined;
  for (const node of container.querySelectorAll<HTMLElement>('[data-line]')) {
    if (!chosen) chosen = node;
    if (node.getBoundingClientRect().top > top) break;
    chosen = node;
  }
  return chosen ? { line: Number(chosen.dataset.line), offset: top - chosen.getBoundingClientRect().top } : undefined;
}

export function restoreReadingAnchor(container: HTMLElement, anchor: ReadingAnchor | undefined, fallback: number): void {
  let chosen: HTMLElement | undefined;
  if (anchor) for (const node of container.querySelectorAll<HTMLElement>('[data-line]')) {
    const line = Number(node.dataset.line);
    if (line > anchor.line) break;
    chosen = node;
  }
  const position = chosen && anchor ? container.scrollTop
    + chosen.getBoundingClientRect().top - container.getBoundingClientRect().top + anchor.offset : fallback;
  container.scrollTop = Math.max(0, Math.min(position, container.scrollHeight - container.clientHeight));
}
