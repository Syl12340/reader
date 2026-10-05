import { describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { menuNavigation, popupNavigation } from '../../src/lib/utils/menu-navigation';
import { placeMenu } from '../../src/lib/utils/menu-position';

describe('menu keyboard navigation', () => {
  it('preserves checked item roles and does not focus a popup after it is destroyed', async () => {
    const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus();
    const panel = document.createElement('div');
    panel.innerHTML = '<button role="menuitemradio" aria-checked="true">Write</button><button role="menuitemcheckbox" aria-checked="false">Focus</button>';
    document.body.append(panel);
    const action = popupNavigation(panel, vi.fn());
    try {
      expect(panel.querySelector('button')?.getAttribute('role')).toBe('menuitemradio');
      expect(panel.querySelectorAll('button')[1].getAttribute('role')).toBe('menuitemcheckbox');
      action.destroy(); panel.remove();
      await Promise.resolve();
      expect(document.activeElement).toBe(trigger);
    } finally { trigger.remove(); panel.remove(); }
  });

  it('ignores composition and consumes Escape while restoring the trigger', async () => {
    const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus();
    const panel = document.createElement('div'); panel.innerHTML = '<button>Close</button>'; document.body.append(panel);
    const close = vi.fn(); const action = popupNavigation(panel, close);
    try {
      await Promise.resolve();
      const button = panel.querySelector('button')!;
      button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true, cancelable: true }));
      expect(close).not.toHaveBeenCalled();
      const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      button.dispatchEvent(escape);
      expect(escape.defaultPrevented).toBe(true);
      expect(close).toHaveBeenCalledOnce();
      expect(document.activeElement).toBe(trigger);
    } finally { action.destroy(); panel.remove(); trigger.remove(); }
  });

  it('cancels queued menu focus when Escape closes before the next tick', async () => {
    const bar = document.createElement('div');
    bar.innerHTML = '<div><button aria-haspopup="menu" aria-expanded="false">View</button></div>';
    document.body.append(bar);
    const trigger = bar.querySelector('button')!;
    const close = () => { bar.querySelector('[role="menu"]')?.remove(); trigger.setAttribute('aria-expanded', 'false'); };
    trigger.onclick = () => {
      trigger.setAttribute('aria-expanded', 'true');
      const menu = document.createElement('div'); menu.setAttribute('role', 'menu');
      menu.innerHTML = '<button role="menuitemradio" aria-checked="true">Write</button>';
      trigger.parentElement!.append(menu);
    };
    const action = menuNavigation(bar, close);
    try {
      trigger.focus();
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await tick();
      expect(document.activeElement).toBe(trigger);
      expect(bar.querySelector('[role="menu"]')).toBeNull();
    } finally { action.destroy(); bar.remove(); }
  });

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

describe('viewport-aware menu placement', () => {
  it('opens a submenu to the left when the right edge cannot fit it', () => {
    expect(placeMenu({ left: 780, right: 920, top: 100, bottom: 130 }, { width: 240, height: 200 },
      { left: 0, top: 0, width: 1000, height: 600 }, true)).toEqual({ left: 536, top: 100 });
  });
  it('opens a root menu above the trigger without covering it', () => {
    expect(placeMenu({ left: 20, right: 70, top: 500, bottom: 530 }, { width: 240, height: 300 },
      { left: 0, top: 0, width: 1000, height: 600 })).toEqual({ left: 20, top: 196 });
  });
  it('clamps submenus inside an offset visual viewport', () => {
    expect(placeMenu({ left: 220, right: 320, top: 420, bottom: 450 }, { width: 180, height: 120 },
      { left: 100, top: 200, width: 240, height: 300 }, true)).toEqual({ left: 108, top: 372 });
  });
});
