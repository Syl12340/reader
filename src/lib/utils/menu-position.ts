import { placePopover } from './popover-position';

interface MenuRect { left: number; right: number; top: number; bottom: number }
interface Viewport { left: number; top: number; width: number; height: number }

export function placeMenu(rect: MenuRect, size: { width: number; height: number }, area: Viewport, submenu = false) {
  if (!submenu) {
    const below = rect.bottom + 4 + size.height <= area.top + area.height - 8;
    return placePopover({ x: rect.left, y: below ? rect.bottom : rect.top, placement: below ? 'below' : 'above', gap: 4 }, size, area);
  }
  const left = area.left + 8, top = area.top + 8;
  const right = area.left + area.width - 8, bottom = area.top + area.height - 8;
  const preferred = rect.right + 4 + size.width <= right ? rect.right + 4 : rect.left - size.width - 4;
  return { left: Math.max(left, Math.min(preferred, Math.max(left, right - size.width))),
    top: Math.max(top, Math.min(rect.top, Math.max(top, bottom - size.height))) };
}

export function anchoredMenu(node: HTMLElement, submenu = false) {
  const trigger = node.previousElementSibling;
  let frame = 0;
  const viewport = window.visualViewport;
  const position = () => {
    frame = 0;
    if (!(trigger instanceof HTMLElement) || !node.isConnected || !trigger.isConnected) return;
    const area = { left: viewport?.offsetLeft ?? 0, top: viewport?.offsetTop ?? 0,
      width: viewport?.width ?? window.innerWidth, height: viewport?.height ?? window.innerHeight };
    node.style.position = 'fixed';
    node.style.margin = '0';
    node.style.maxWidth = `${Math.max(0, area.width - 16)}px`;
    node.style.maxHeight = `${Math.max(0, area.height - 16)}px`;
    node.style.minWidth = `${Math.max(0, Math.min(220, area.width - 16))}px`;
    const point = placeMenu(trigger.getBoundingClientRect(), node.getBoundingClientRect(), area, submenu);
    node.style.left = `${point.left}px`; node.style.top = `${point.top}px`;
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(position); };
  const observer = new ResizeObserver(schedule);
  observer.observe(node);
  if (trigger instanceof HTMLElement) observer.observe(trigger);
  window.addEventListener('resize', schedule);
  window.addEventListener('scroll', schedule, true);
  viewport?.addEventListener('resize', schedule);
  viewport?.addEventListener('scroll', schedule);
  position();
  return { destroy() {
    if (frame) cancelAnimationFrame(frame);
    observer.disconnect();
    window.removeEventListener('resize', schedule); window.removeEventListener('scroll', schedule, true);
    viewport?.removeEventListener('resize', schedule); viewport?.removeEventListener('scroll', schedule);
  } };
}
