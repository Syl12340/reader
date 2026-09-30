import { tick } from 'svelte';

/** Keyboard navigation for a menubar with nested popup menus. */
export function menuNavigation(node: HTMLElement, close: () => void) {
  let disposed = false;
  const topButtons = () => Array.from(node.querySelectorAll<HTMLButtonElement>(':scope > div > button'));
  const items = (menu: HTMLElement) => Array.from(menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
    .filter(button => button.closest('[role="menu"]') === menu);
  const topTrigger = (target: HTMLElement) => topButtons().find(button => button.parentElement?.contains(target));
  const focusMenu = async (trigger: HTMLButtonElement, last = false) => {
    await tick();
    if (disposed || !trigger.isConnected) return;
    const menu = trigger.parentElement?.querySelector<HTMLElement>(':scope > [role="menu"]');
    if (menu) {
      const buttons = items(menu);
      buttons[last ? buttons.length - 1 : 0]?.focus();
    }
  };
  const keydown = (event: KeyboardEvent) => {
    if (event.isComposing || !(event.target instanceof HTMLElement)) return;
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
        parentTrigger.click(); parentTrigger.focus();
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
      parent.click(); parent.focus();
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const buttons = topButtons();
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
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
          : (buttons.indexOf(button) + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
        buttons[index]?.focus();
      }
    } else if ((event.key === 'Enter' || event.key === ' ') && button.getAttribute('aria-haspopup') === 'menu') {
      event.preventDefault(); button.click(); void focusMenu(button);
    }
  };
  const annotate = () => node.querySelectorAll('button').forEach(button => button.setAttribute('role', 'menuitem'));
  const observer = new MutationObserver(annotate);
  observer.observe(node, { childList: true, subtree: true });
  annotate();
  node.addEventListener('keydown', keydown);
  return { destroy() { disposed = true; observer.disconnect(); node.removeEventListener('keydown', keydown); } };
}
