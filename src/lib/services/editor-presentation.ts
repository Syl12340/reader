import { tick } from 'svelte';
import { get } from 'svelte/store';
import { activeSessionId } from '$lib/stores/document';
import { editorMode, setEditorMode } from '$lib/stores/ui';
import type { EditorMode } from '$lib/types';
import { focusDocumentSurface } from '$lib/utils/document-focus';

export async function selectDocumentMode(mode: EditorMode, focus = true): Promise<void> {
  const id = get(activeSessionId);
  if (!id) return;
  setEditorMode(mode);
  await tick();
  if (focus && get(activeSessionId) === id && get(editorMode) === mode) focusDocumentSurface();
}
