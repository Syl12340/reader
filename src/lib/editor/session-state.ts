import { EditorState, StateEffect, type Extension } from '@codemirror/state';

export function restoreEditorState(content: string, cached: unknown, extensions: Extension[], cursorOffset = 0): EditorState {
  if (cached instanceof EditorState) {
    // Rebind component-owned listeners and compartments, retaining shared history fields.
    return cached.update({ effects: StateEffect.reconfigure.of(extensions) }).state;
  }
  return EditorState.create({
    doc: content,
    extensions,
    selection: { anchor: Number.isFinite(cursorOffset) ? Math.max(0, Math.min(Math.trunc(cursorOffset), content.length)) : 0 },
  });
}
