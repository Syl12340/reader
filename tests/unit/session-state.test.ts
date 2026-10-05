import { describe, expect, it, vi } from 'vitest';
import { Compartment, EditorSelection, EditorState, type Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, redo, redoDepth, undo, undoDepth } from '@codemirror/commands';
import { restoreEditorState } from '../../src/lib/editor/session-state';

describe('cached editor state restoration', () => {
  it('keeps document, directional selections and undo history while applying current extensions', () => {
    const old = EditorState.create({ doc: 'note', extensions: [history(), EditorState.allowMultipleSelections.of(true)] });
    const cached = old.update({ changes: { from: 4, insert: '!' },
      selection: EditorSelection.create([EditorSelection.range(3, 1), EditorSelection.cursor(5)], 1), userEvent: 'input.type' }).state;
    const restored = restoreEditorState('note!', cached,
      [history(), EditorState.allowMultipleSelections.of(true), EditorState.tabSize.of(2)]);
    expect(restored.doc).toBe(cached.doc);
    expect(restored.selection.toJSON()).toEqual(cached.selection.toJSON());
    expect(undoDepth(restored)).toBe(1);
    expect(restored.tabSize).toBe(2);
    expect(cached.tabSize).toBe(4);
  });

  it('retains redo after rebinding a second time', () => {
    let state = EditorState.create({ doc: 'first', extensions: [history()] });
    state = state.update({ changes: { from: 5, insert: ' edit' }, userEvent: 'input.type' }).state;
    const commandTarget = () => ({ state, dispatch: (transaction: Transaction) => { state = transaction.state; } }) as EditorView;
    expect(undo(commandTarget())).toBe(true);
    state = restoreEditorState('first', state, [history()]);
    expect(redoDepth(state)).toBe(1);
    expect(redo(commandTarget())).toBe(true);
    expect(state.doc.toString()).toBe('first edit');
  });

  it('drops old component listeners and compartments, without changing the cached state', () => {
    const oldListener = vi.fn(), newListener = vi.fn();
    const oldCompartment = new Compartment(), currentCompartment = new Compartment();
    const cached = EditorState.create({ doc: 'content', extensions: [history(),
      oldCompartment.of(EditorState.tabSize.of(8)), EditorView.updateListener.of(oldListener)] });
    const restored = restoreEditorState('content', cached, [history(),
      currentCompartment.of(EditorState.tabSize.of(2)), EditorView.updateListener.of(newListener)]);
    expect(restored.facet(EditorView.updateListener)).toEqual([newListener]);
    expect(cached.facet(EditorView.updateListener)).toEqual([oldListener]);
    expect(oldCompartment.get(restored)).toBeUndefined();
    expect(currentCompartment.get(restored)).toBeDefined();
    expect(restored.update({ effects: currentCompartment.reconfigure(EditorState.tabSize.of(6)) }).state.tabSize).toBe(6);
  });

  it('restores position zero and bounds stale or invalid cursor offsets for uncached documents', () => {
    expect(restoreEditorState('text', undefined, [], 0).selection.main.head).toBe(0);
    expect(restoreEditorState('text', undefined, [], 100).selection.main.head).toBe(4);
    expect(restoreEditorState('text', undefined, [], -10).selection.main.head).toBe(0);
    expect(restoreEditorState('text', undefined, [], Infinity).selection.main.head).toBe(0);
    expect(restoreEditorState('text', undefined, [], 1.5).selection.main.head).toBe(1);
  });
});
