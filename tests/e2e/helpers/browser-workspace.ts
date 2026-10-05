import { expect, type Page } from '@playwright/test';

declare global {
  interface Window {
    readerTestFs: {
      files: Record<string, string>;
      delayed: Set<string>;
      reads: string[];
      pending: Map<string, (() => void)[]>;
      finish: (path: string) => void;
    };
  }
}

export async function installBrowserWorkspace(page: Page, files: Record<string, string>) {
  await page.addInitScript(initial => {
    const state = window.readerTestFs = {
      files: { ...initial }, delayed: new Set<string>(), reads: [] as string[],
      pending: new Map<string, (() => void)[]>(),
      finish(path: string) { this.delayed.delete(path); for (const done of this.pending.get(path) ?? []) done(); this.pending.delete(path); },
    };
    const handles = new Map<string, unknown>();
    function directory(path: string): FileSystemDirectoryHandle {
      if (handles.has(path)) return handles.get(path) as FileSystemDirectoryHandle;
      const prefix = path ? path + '/' : '';
      const handle = {
        kind: 'directory', name: path.split('/').pop() || 'Library',
        queryPermission: async () => 'granted', requestPermission: async () => 'granted',
        async *entries() {
          const names = new Set(Object.keys(state.files).filter(file => file.startsWith(prefix)).map(file => file.slice(prefix.length).split('/')[0]));
          for (const name of names) {
            const key = prefix + name;
            yield [name, key in state.files ? await this.getFileHandle(name) : directory(key)];
          }
        },
        async getDirectoryHandle(name: string) { return directory(prefix + name); },
        async getFileHandle(name: string) {
          const key = prefix + name;
          if (!(key in state.files)) throw new DOMException('File missing', 'NotFoundError');
          const fileHandle = {
            kind: 'file', name, queryPermission: async () => 'granted',
            async getFile() {
              state.reads.push(key);
              if (state.delayed.has(key)) await new Promise<void>(resolve => state.pending.set(key, [...(state.pending.get(key) ?? []), resolve]));
              if (!(key in state.files)) throw new DOMException('File missing', 'NotFoundError');
              return new File([state.files[key]], name, { type: 'text/markdown', lastModified: 1 });
            },
          };
          return fileHandle;
        },
      };
      handles.set(path, handle); return handle as unknown as FileSystemDirectoryHandle;
    }
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: async () => directory('') });
    Object.defineProperty(window, 'showOpenFilePicker', { configurable: true, value: async () => [] });
  }, files);
}

export async function openBrowserWorkspace(page: Page) {
  await page.getByRole('button', { name: '显示侧栏' }).click();
  await page.locator('.folder-label').click();
  await expect(page.locator('.folder-label')).toHaveText('Library');
}
