import { writable } from 'svelte/store';

export const cursorPosition = writable({ line: 1, column: 1 });
export const selectionText = writable('');
export const selectionSource = writable<'editor' | 'preview' | null>(null);
