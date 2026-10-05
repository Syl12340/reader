import { tick } from 'svelte';

function annotateButton(button: HTMLButtonElement): void {
  if (!button.getAttribute('role')?.startsWith('menuitem')) button.setAttribute('role', 'menuitem');
  if (button.closest('[role="menu"]')) button.tabIndex = -1;
}

function menuButtons(menu: HTMLElement): HTMLButtonElement[] {
  return [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
    .filter(button => button.closest('[role="menu"]') === menu && !button.closest('[hidden], [inert], [aria-hidden="true"]'));
}

export function popupNavigation(node: HTMLElement, close: () => void) {
  const previous = document.activeElement as HTMLElement | null;
  let disposed = false;
  node.setAttribute('role', 'menu');
  const buttons = () => menuButtons(node);
  node.querySelectorAll<HTMLButtonElement>('button').forEach(annotateButton);
  queueMicrotask(() => { if (!disposed && node.isConnected) buttons()[0]?.focus(); });
  const keydown = (event: KeyboardEvent) => {
    if (event.isComposing || event.defaultPrevented) return;
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); }
      close();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = buttons();
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[index]?.focus();
  };
  node.addEventListener('keydown', keydown);
  return { destroy() { disposed = true; node.removeEventListener('keydown', keydown); } };
}

/** Keyboard navigation for a menubar with nested popup menus. */
export function menuNavigation(node: HTMLElement, close: () => void) {
  let disposed = false;
  let focusRevision = 0;
  const topButtons = () => Array.from(node.querySelectorAll<HTMLButtonElement>(':scope > div > button'));
  const items = menuButtons;
  const topTrigger = (target: HTMLElement) => topButtons().find(button => button.parentElement?.contains(target));
  const focusMenu = async (trigger: HTMLButtonElement, last = false) => {
    const revision = ++focusRevision;
    await tick();
    if (disposed || revision !== focusRevision || !trigger.isConnected || trigger.getAttribute('aria-expanded') !== 'true') return;
    const menu = trigger.parentElement?.querySelector<HTMLElement>(':scope > [role="menu"]');
    if (menu) {
      const buttons = items(menu);
      buttons[last ? buttons.length - 1 : 0]?.focus();
    }
  };
  const keydown = (event: KeyboardEvent) => {
    if (event.isComposing || event.defaultPrevented || !(event.target instanceof HTMLElement)) return;
    focusRevision++;
    const target = event.target;
    const button = target.closest('button');
    const menu = target.closest<HTMLElement>('[role="menu"]');
    const trigger = topTrigger(target);
    if (!button || !trigger) return;
    if (event.key === 'Tab') { close(); return; }
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      const parentTrigger = menu?.previousElementSibling;
      if (menu?.parentElement?.closest('[role="menu"]') && parentTrigger instanceof HTMLButtonElement) {
        if (parentTrigger.getAttribute('aria-expanded') === 'true') parentTrigger.click();
        parentTrigger.focus();
      } else { close(); trigger.focus(); }
      return;
    }
    if (event.key === 'ArrowRight' && button.getAttribute('aria-haspopup') === 'menu' && menu) {
      event.preventDefault();
      if (button.getAttribute('aria-expanded') !== 'true') button.click();
      void focusMenu(button);
      return;
    }
    if (event.key === 'ArrowLeft' && menu?.parentElement?.closest('[role="menu"]')) {
      event.preventDefault();
      const parent = menu.previousElementSibling as HTMLButtonElement;
      if (parent.getAttribute('aria-expanded') === 'true') parent.click();
      parent.focus();
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const buttons = topButtons();
      if (!buttons.length) return;
      const next = buttons[(buttons.indexOf(trigger) + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length];
      close(); next.focus();
      if (menu) { next.click(); void focusMenu(next); }
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (!menu) {
        if (button.getAttribute('aria-expanded') !== 'true') button.click();
        void focusMenu(button, event.key === 'ArrowUp' || event.key === 'End');
      } else {
        const buttons = items(menu);
        if (!buttons.length) return;
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
          : (buttons.indexOf(button) + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
        buttons[index]?.focus();
      }
    } else if ((event.key === 'Enter' || event.key === ' ') && button.getAttribute('aria-haspopup') === 'menu') {
      event.preventDefault(); button.click(); void focusMenu(button);
    }
  };
  const annotate = () => node.querySelectorAll<HTMLButtonElement>('button').forEach(annotateButton);
  const observer = new MutationObserver(annotate);
  observer.observe(node, { childList: true, subtree: true });
  annotate();
  node.addEventListener('keydown', keydown);
  return { destroy() { disposed = true; observer.disconnect(); node.removeEventListener('keydown', keydown); } };
}
