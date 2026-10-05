export interface PopoverAnchor {
  x: number;
  y: number;
  placement?: 'above' | 'below';
  align?: 'start' | 'center' | 'end';
  gap?: number;
}

export function placePopover(anchor: PopoverAnchor, size: { width: number; height: number },
  viewport: { left: number; top: number; width: number; height: number }) {
  const margin = 8;
  const gap = anchor.gap ?? 6;
  const left = viewport.left + margin;
  const top = viewport.top + margin;
  const right = viewport.left + viewport.width - margin;
  const bottom = viewport.top + viewport.height - margin;
  const above = anchor.y - gap - size.height;
  const below = anchor.y + gap;
  const preferAbove = anchor.placement === 'above';
  const y = preferAbove ? (above >= top ? above : below)
    : (below + size.height <= bottom ? below : above);
  const x = anchor.x - (anchor.align === 'center' ? size.width / 2 : anchor.align === 'end' ? size.width : 0);
  return { left: Math.max(left, Math.min(x, Math.max(left, right - size.width))),
    top: Math.max(top, Math.min(y, Math.max(top, bottom - size.height))) };
}

export function anchoredPopover(node: HTMLElement, anchor: PopoverAnchor) {
  let frame = 0;
  const viewport = window.visualViewport;
  const position = () => {
    frame = 0;
    if (!node.isConnected) return;
    const area = { left: viewport?.offsetLeft ?? 0, top: viewport?.offsetTop ?? 0,
      width: viewport?.width ?? window.innerWidth, height: viewport?.height ?? window.innerHeight };
    node.style.maxWidth = `${Math.max(0, area.width - 16)}px`;
    node.style.maxHeight = `${Math.max(0, area.height - 16)}px`;
    const { left, top } = placePopover(anchor, node.getBoundingClientRect(), area);
    node.style.left = `${left}px`; node.style.top = `${top}px`;
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(position); };
  const observer = new ResizeObserver(schedule);
  observer.observe(node);
  window.addEventListener('resize', schedule);
  viewport?.addEventListener('resize', schedule);
  viewport?.addEventListener('scroll', schedule);
  position();
  return {
    update(value: PopoverAnchor) { anchor = value; schedule(); },
    destroy() {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect(); window.removeEventListener('resize', schedule);
      viewport?.removeEventListener('resize', schedule); viewport?.removeEventListener('scroll', schedule);
    },
  };
}
