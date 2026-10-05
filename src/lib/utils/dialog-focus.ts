export interface DialogFocusOptions { close: () => void; initial?: string }
const dialogs: HTMLElement[] = [];

export function dialogFocus(node: HTMLElement, options: DialogFocusOptions) {
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  dialogs.push(node);
  const candidates = () => [...node.querySelectorAll<HTMLElement>(
    'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]',
  )].filter(element => element.tabIndex >= 0 && available(element));
  const available = (element: HTMLElement) => !element.matches(':disabled') && !element.closest('[inert], [aria-hidden="true"]')
    && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
  const focusFirst = () => {
    const initial = node.querySelector<HTMLElement>(options.initial || '[data-dialog-initial]');
    (initial && available(initial) ? initial : candidates()[0] ?? node).focus({ preventScroll: true });
  };
  queueMicrotask(() => { if (node.isConnected && dialogs.at(-1) === node) focusFirst(); });
  const keydown = (event: KeyboardEvent) => {
    if (event.isComposing || dialogs.at(-1) !== node) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); options.close(); }
    else if (event.key === 'Tab') {
      const items = candidates();
      const index = items.indexOf(document.activeElement as HTMLElement);
      if (!items.length) { event.preventDefault(); node.focus(); }
      else if (index < 0 || (event.shiftKey ? index === 0 : index === items.length - 1)) {
        event.preventDefault(); (event.shiftKey ? items.at(-1)! : items[0]).focus();
      }
    }
  };
  const focusin = (event: FocusEvent) => {
    if (dialogs.at(-1) === node && event.target instanceof Node && !node.contains(event.target)) focusFirst();
  };
  node.addEventListener('keydown', keydown);
  document.addEventListener('focusin', focusin);
  return {
    update(value: DialogFocusOptions) { options = value; },
    destroy() {
      const wasTop = dialogs.at(-1) === node;
      const index = dialogs.indexOf(node);
      if (index >= 0) dialogs.splice(index, 1);
      node.removeEventListener('keydown', keydown); document.removeEventListener('focusin', focusin);
      queueMicrotask(() => {
        if (!wasTop) return;
        const top = dialogs.at(-1);
        const current = document.activeElement;
        if (current instanceof HTMLElement && current !== document.body && current.isConnected && !node.contains(current)
          && available(current) && (!top || top.contains(current))) return;
        if (previous?.isConnected && available(previous) && (!top || top.contains(previous))) previous.focus({ preventScroll: true });
        else top?.focus({ preventScroll: true });
      });
    },
  };
}
