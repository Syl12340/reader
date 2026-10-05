import { writable } from 'svelte/store';

export function parseKeyboardEvent(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');

  // 忽略单独的修饰键
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
    return '';
  }

  let key = e.key;
  if (key === ' ') {
    key = 'Space';
  } else if (key === '`') {
    key = '`';
  } else if (key.length === 1) {
    key = key.toUpperCase();
  } else if (key.startsWith('Arrow')) {
    key = key.replace('Arrow', '');
  } else if (key === 'Escape') {
    key = 'Esc';
  } else if (key === '\\') {
    key = '\\';
  }

  parts.push(key);
  return parts.join('+');
}

type ShortcutHandler = () => void | Promise<void>;
type ShortcutDefinition = { id: string; key: string };

const DEFAULT_SHORTCUTS: ShortcutDefinition[] = [
  { id: 'newFile', key: 'Ctrl+N' },
  { id: 'openFile', key: 'Ctrl+O' },
  { id: 'saveFile', key: 'Ctrl+S' },
  { id: 'saveAs', key: 'Ctrl+Shift+S' },
  { id: 'print', key: 'Ctrl+P' },
  { id: 'undo', key: 'Ctrl+Z' },
  { id: 'redo', key: 'Ctrl+Y' },
  { id: 'find', key: 'Ctrl+F' },
  { id: 'replace', key: 'Ctrl+H' },
  { id: 'bold', key: 'Ctrl+B' },
  { id: 'italic', key: 'Ctrl+I' },
  { id: 'link', key: 'Ctrl+K' },
  { id: 'code', key: 'Ctrl+`' },
  { id: 'toggleSidebar', key: 'Ctrl+\\' },
  { id: 'togglePreview', key: 'Ctrl+Shift+V' },
  { id: 'toggleRead', key: 'Ctrl+E' },
  { id: 'fullscreen', key: 'F11' },
  { id: 'commandPalette', key: 'Ctrl+Shift+P' },
  { id: 'settings', key: 'Ctrl+,' },
  { id: 'exit', key: 'Ctrl+Q' },
  { id: 'quickOpen', key: 'Ctrl+Shift+O' },
  { id: 'nextTab', key: 'Ctrl+Tab' },
  { id: 'previousTab', key: 'Ctrl+Shift+Tab' },
  { id: 'reopenTab', key: 'Ctrl+Shift+T' },
  { id: 'closeTab', key: 'Ctrl+W' },
  { id: 'navigateBack', key: 'Alt+Left' },
  { id: 'navigateForward', key: 'Alt+Right' },
  { id: 'focusMode', key: 'F8' },
  { id: 'typewriterMode', key: 'F9' },
  { id: 'zoomIn', key: 'Ctrl+=' },
  { id: 'zoomOut', key: 'Ctrl+-' },
  { id: 'zoomReset', key: 'Ctrl+0' },
];
export const shortcutBindings = writable<ShortcutDefinition[]>(DEFAULT_SHORTCUTS.map(s => ({ ...s })));

class ShortcutManager {
  private handlers: Record<string, ShortcutHandler> = {};
  private shortcuts: Array<{ id: string; key: string }> = [];

  constructor() {
    this.loadShortcuts();
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.handleKeyDown.bind(this), true); // 使用 capture 阶段优先拦截
    }
  }

  loadShortcuts() {
    if (typeof window === 'undefined') return;
    try {
      const saved = localStorage.getItem('customShortcuts');
      if (saved) {
        const savedShortcuts = JSON.parse(saved) as ShortcutDefinition[];
        const savedById = new Map(savedShortcuts.map(shortcut => [shortcut.id, shortcut]));
        this.shortcuts = DEFAULT_SHORTCUTS.map(shortcut => ({
          ...shortcut,
          key: savedById.get(shortcut.id)?.key ?? shortcut.key,
        }));
        savedShortcuts.forEach(shortcut => {
          if (!this.shortcuts.some(item => item.id === shortcut.id)) {
            this.shortcuts.push(shortcut);
          }
        });
      } else {
        this.shortcuts = DEFAULT_SHORTCUTS.map(shortcut => ({ ...shortcut }));
      }
    } catch {
      this.shortcuts = DEFAULT_SHORTCUTS.map(shortcut => ({ ...shortcut }));
    }
    shortcutBindings.set(this.shortcuts.map(s => ({ ...s })));
  }

  register(id: string, handler: ShortcutHandler) {
    this.handlers[id] = handler;
    return () => {
      if (this.handlers[id] === handler) delete this.handlers[id];
    };
  }

  unregister(id: string) {
    delete this.handlers[id];
  }

  getShortcutKey(id: string): string {
    return this.shortcuts.find(s => s.id === id)?.key || '';
  }

  getAllShortcuts() {
    return this.shortcuts;
  }

  updateShortcutKey(id: string, newKey: string): boolean {
    // 检测冲突
    const conflict = this.shortcuts.find(s => s.id !== id && s.key === newKey && newKey !== '');
    if (conflict) {
      return false; // 有冲突
    }

    const shortcut = this.shortcuts.find(s => s.id === id);
    if (shortcut) {
      shortcut.key = newKey;
    } else {
      this.shortcuts.push({ id, key: newKey });
    }

    shortcutBindings.set(this.shortcuts.map(s => ({ ...s })));
    if (typeof window !== 'undefined') {
      localStorage.setItem('customShortcuts', JSON.stringify(this.shortcuts));
    }
    return true;
  }

  private handleKeyDown(e: KeyboardEvent) {
    if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest('dialog[open], [aria-modal="true"]')) return;
    const keyStr = parseKeyboardEvent(e);
    if (!keyStr) return;

    const matched = this.shortcuts.find(s => s.key === keyStr);
    // Keep native text-field editing and CodeMirror history handling local.
    if (matched && ['undo', 'redo', 'bold', 'italic', 'strikethrough', 'link', 'code', 'h1', 'h2', 'quote'].includes(matched.id)
      && target?.closest('input, textarea, [contenteditable="true"]:not(.cm-content)')) return;
    if (matched && this.handlers[matched.id]) {
      e.preventDefault();
      e.stopPropagation();
      void Promise.resolve().then(() => this.handlers[matched.id]?.()).catch(error => {
        console.error(`Shortcut failed: ${matched.id}`, error);
      });
    }
  }
}

export const ShortcutService = new ShortcutManager();
