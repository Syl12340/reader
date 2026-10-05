import { EditorView } from '@codemirror/view';

export function focusDocumentSurface(): void {
  if (typeof document === 'undefined') return;
  const available = (node: HTMLElement) => node.isConnected && !node.closest('[inert], [aria-hidden="true"]')
    && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
  if ([...document.querySelectorAll<HTMLElement>('dialog[open], [aria-modal="true"]')].some(available)) return;
  const target = [...document.querySelectorAll<HTMLElement>('.cm-content, .preview-container')]
    .find(available);
  if (!target) return;
  const editor = target.matches('.cm-content') ? EditorView.findFromDOM(target) : null;
  if (editor) editor.focus();
  else target.focus({ preventScroll: true });
}
