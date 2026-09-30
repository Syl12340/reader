import { describe, expect, it } from 'vitest';
import { tick } from 'svelte';
import { menuNavigation } from '../../src/lib/utils/menu-navigation';

describe('menu keyboard navigation', () => {
  it('opens from the keyboard, skips disabled items, and restores focus on Escape', async () => {
    const bar = document.createElement('div');
    bar.innerHTML = '<div><button aria-haspopup="menu" aria-expanded="false">Edit</button></div>';
    document.body.append(bar);
    const trigger = bar.querySelector('button')!;
    const close = () => { bar.querySelector('[role="menu"]')?.remove(); trigger.setAttribute('aria-expanded', 'false'); };
    trigger.onclick = () => {
      trigger.setAttribute('aria-expanded', 'true');
      const menu = document.createElement('div');
      menu.setAttribute('role', 'menu');
      menu.innerHTML = '<button>Undo</button><button disabled>Redo</button><button>Find</button>';
      trigger.parentElement!.append(menu);
    };
    const action = menuNavigation(bar, close);
    try {
      trigger.focus();
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      await tick();
      const undo = bar.querySelector('[role="menu"] button')!;
      expect(document.activeElement).toBe(undo);
      undo.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      expect(document.activeElement?.textContent).toBe('Find');
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      expect(document.activeElement).toBe(trigger);
      expect(bar.querySelector('[role="menu"]')).toBeNull();
    } finally { action.destroy(); bar.remove(); }
  });
});
