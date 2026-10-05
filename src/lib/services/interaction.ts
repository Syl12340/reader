import { get, writable } from 'svelte/store';

export interface PromptOptions {
  title: string;
  message: string;
  actions: Array<{ id: string; label: string; danger?: boolean }>;
  comparison?: { before: string; after: string; line: number; truncated: boolean };
}
export const activePrompt = writable<(PromptOptions & { resolve: (choice: string) => void }) | null>(null);
let queue: Promise<unknown> = Promise.resolve();
let generation = 0;
let disposed = false;

export function attachInteractionHost(): () => void {
  disposed = false;
  return () => { disposed = true; generation++; cancelActivePrompt(); };
}

export function ask(options: PromptOptions): Promise<string> {
  if (disposed) return Promise.resolve('cancel');
  const request = generation;
  const next = queue.then(() => new Promise<string>(resolve => {
    if (disposed || request !== generation) { resolve('cancel'); return; }
    let done = false;
    activePrompt.set({ ...options, resolve: choice => {
      if (done) return;
      done = true; activePrompt.set(null); resolve(choice);
    } });
  }));
  queue = next.catch(() => undefined);
  return next;
}
export async function confirmAction(title: string, message: string, label = '确认'): Promise<boolean> {
  return await ask({ title, message, actions: [{ id: 'cancel', label: '取消' }, { id: 'confirm', label, danger: true }] }) === 'confirm';
}

interface Notice { id: number; message: string; action?: { label: string; run: () => void | Promise<unknown> }; error: boolean }
export const notices = writable<Notice[]>([]);
let nextId = 0;
export function dismissNotice(id: number): void { notices.update(list => list.filter(item => item.id !== id)); }
export function notify(message: string, action?: Notice['action'], error = true): void {
  const id = ++nextId;
  notices.update(list => [...list.slice(-4), { id, message, action, error }]);
  if (!error && typeof window !== 'undefined') window.setTimeout(() => dismissNotice(id), 7000);
}
export function cancelActivePrompt(): void { get(activePrompt)?.resolve('cancel'); }
