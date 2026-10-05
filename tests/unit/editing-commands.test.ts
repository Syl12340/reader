import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorSelection, EditorState, type Transaction } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { history, undo } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { activeFormatting, codeTransaction, formatTransaction, linkTransaction, toggleLinePrefix } from '../../src/lib/editor/commands';
import { focusDocumentSurface } from '../../src/lib/utils/document-focus';
import { selectDocumentMode } from '../../src/lib/services/editor-presentation';
import { activeSessionId, createSession, sessions } from '../../src/lib/stores/document';

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); activeSessionId.set(null); sessions.set([]); });

function selected(source: string, from = 0, to = source.length) {
  return EditorState.create({ doc: source, selection: { anchor: from, head: to },
    extensions: [markdown({ base: markdownLanguage }), history(), EditorState.allowMultipleSelections.of(true)] });
}

function commandTarget(initial: EditorState) {
  let state = initial;
  return { view: { get state() { return state; }, composing: false,
    dispatch: (transaction: Transaction) => { state = transaction.state; } } as EditorView, state: () => state };
}

describe('syntax-aware format toggles', () => {
  it('recognizes underscore emphasis instead of nesting a different delimiter', () => {
    const italic = selected('_word_');
    expect(italic.update(formatTransaction(italic, '*', '*')).state.doc.toString()).toBe('word');
    const bold = selected('__word__');
    expect(bold.update(formatTransaction(bold, '**', '**')).state.doc.toString()).toBe('word');
  });
  it('removes only the requested format from a wholly selected nested wrapper', () => {
    const state = selected('***word***');
    expect(state.update(formatTransaction(state, '**', '**')).state.doc.toString()).toBe('*word*');
    expect(state.update(formatTransaction(state, '*', '*')).state.doc.toString()).toBe('**word**');
  });
  it('toggles the enclosing format when the caret is inside its content', () => {
    const state = selected('**word**', 4, 4);
    const result = state.update(formatTransaction(state, '**', '**')).state;
    expect(result.doc.toString()).toBe('word');
    expect(result.selection.main.head).toBe(2);
  });
  it('preserves reversed selections while excluding newly inserted markers', () => {
    const state = selected('word', 4, 0);
    const result = state.update(formatTransaction(state, '**', '**')).state;
    expect(result.doc.toString()).toBe('**word**');
    expect(result.selection.main.anchor).toBe(6);
    expect(result.selection.main.head).toBe(2);
  });
  it('deduplicates marker deletions shared by two cursors', () => {
    const state = selected('**one two**').update({ selection: EditorSelection.create([
      EditorSelection.cursor(3), EditorSelection.cursor(7),
    ], 1) }).state;
    const result = state.update(formatTransaction(state, '**', '**')).state;
    expect(result.doc.toString()).toBe('one two');
    expect(result.selection.ranges.map(range => range.head)).toEqual([1, 5]);
    expect(result.selection.mainIndex).toBe(1);
  });
  it('keeps escaped markers literal and does not format code content', () => {
    const source = '\\*literal\\*'; const plain = selected(source);
    expect(plain.update(formatTransaction(plain, '*', '*')).state.doc.toString()).toBe(`*${source}*`);
    const code = selected('`word`', 1, 5);
    expect(code.update(formatTransaction(code, '**', '**')).state.doc.toString()).toBe('`word`');
    expect(activeFormatting(code)).toMatchObject({ code: true, inCode: true, bold: false });
  });
});

describe('code formatting', () => {
  it('uses a longer delimiter when the selected text contains backticks', () => {
    const state = selected('before `value` after');
    expect(state.update(codeTransaction(state)).state.doc.toString()).toBe('``before `value` after``');
  });
  it('round-trips edge backticks and significant spaces using code-span padding', () => {
    for (const source of ['`literal', ' word ', ' \u00a0 ']) {
      const state = selected(source);
      const wrapped = state.update(codeTransaction(state)).state;
      expect(wrapped.update(codeTransaction(wrapped)).state.doc.toString()).toBe(source);
    }
  });
  it('chooses a safe fence for multiline content with an existing fence run', () => {
    const state = selected('one\n```\ntwo');
    expect(state.update(codeTransaction(state)).state.doc.toString()).toBe('````\none\n```\ntwo\n````');
  });
  it('handles single-line and multiline selections independently', () => {
    const source = 'one\n\na\nb';
    const state = selected(source).update({ selection: EditorSelection.create([
      EditorSelection.range(0, 3), EditorSelection.range(5, source.length),
    ]) }).state;
    expect(state.update(codeTransaction(state)).state.doc.toString()).toBe('`one`\n\n```\na\nb\n```');
  });
  it('unwraps closed language fences but preserves an unterminated fence', () => {
    const closed = selected('```js\nconst n = 1;\n```');
    expect(closed.update(codeTransaction(closed)).state.doc.toString()).toBe('const n = 1;');
    const open = selected('```js\nconst n = 1;', 8, 12);
    expect(open.update(codeTransaction(open)).state.doc.toString()).toBe('```js\nconst n = 1;');
  });
});

describe('link editing', () => {
  it('selects the existing URL without changing labels or titles', () => {
    for (const source of ['[label](https://example.org "title")', '[label](<https://example.org/a b>)']) {
      const state = selected(source, 2, 4);
      const result = state.update(linkTransaction(state)).state;
      expect(result.doc.toString()).toBe(source);
      expect(result.sliceDoc(result.selection.main.from, result.selection.main.to)).toMatch(/^https:\/\/example\.org/);
      expect(result.sliceDoc(result.selection.main.from, result.selection.main.to)).not.toContain('<');
    }
  });
  it('enters an empty link destination and preserves reference syntax', () => {
    const empty = selected('[label]()', 2, 2);
    const result = empty.update(linkTransaction(empty)).state;
    expect(result.doc.toString()).toBe('[label]()');
    expect(result.selection.main.head).toBe(8);
    const ref = selected('[label][ref]\n\n[ref]: https://example.org', 2, 4);
    expect(ref.update(linkTransaction(ref)).state.doc.toString()).toBe(ref.doc.toString());
  });
  it('escapes label brackets, flattens newlines and selects the new destination', () => {
    const state = selected('part [one]\nnext\\');
    const result = state.update(linkTransaction(state)).state;
    expect(result.doc.toString()).toBe('[part \\[one\\] next\\\\](url)');
    expect(result.sliceDoc(result.selection.main.from, result.selection.main.to)).toBe('url');
  });
});

describe('line format direction', () => {
  it('applies one heading level to a mixed selection, then removes it uniformly', () => {
    const target = commandTarget(selected('# first\nsecond\n## third'));
    toggleLinePrefix(target.view, '# ');
    expect(target.state().doc.toString()).toBe('# first\n# second\n# third');
    toggleLinePrefix(target.view, '# ');
    expect(target.state().doc.toString()).toBe('first\nsecond\nthird');
  });
  it('keeps quote and list prefixes while leaving selected fenced code unchanged', () => {
    const target = commandTarget(selected('> - entry\n\n```js\ncode\n```'));
    toggleLinePrefix(target.view, '# ');
    expect(target.state().doc.toString()).toBe('> - # entry\n# \n```js\ncode\n```');
  });
  it('removes or converts a two-line Setext heading without leaving the underline', () => {
    const heading = commandTarget(selected('Title\n====='));
    toggleLinePrefix(heading.view, '# ');
    expect(heading.state().doc.toString()).toBe('Title');
    const converted = commandTarget(selected('Title\n====='));
    toggleLinePrefix(converted.view, '## ');
    expect(converted.state().doc.toString()).toBe('## Title');
  });
  it('makes each format change independently undoable', () => {
    const target = commandTarget(selected('first'));
    target.view.dispatch(target.state().update({ changes: { from: 5, insert: ' edit' }, userEvent: 'input.type' }));
    const state = target.state().update({ selection: { anchor: 0, head: 10 } }).state;
    const formatted = state.update(formatTransaction(state, '**', '**')).state;
    const historyTarget = commandTarget(formatted);
    expect(undo(historyTarget.view)).toBe(true);
    expect(historyTarget.state().doc.toString()).toBe('first edit');
    expect(undo(historyTarget.view)).toBe(true);
    expect(historyTarget.state().doc.toString()).toBe('first');
  });
});

describe('document focus', () => {
  function surface() {
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([new DOMRect(0, 0, 100, 20)] as unknown as DOMRectList);
    const node = document.createElement('div'); node.className = 'cm-content'; node.tabIndex = -1; document.body.append(node); return node;
  }
  it('does not steal focus while a visible modal is open', () => {
    surface();
    const modal = document.createElement('div'); modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = '<button>Keep focus</button>'; document.body.append(modal);
    const button = modal.querySelector('button')!; button.focus();
    focusDocumentSurface(); expect(document.activeElement).toBe(button);
  });
  it('ignores hidden and inert document surfaces', () => {
    const hidden = surface(); hidden.setAttribute('aria-hidden', 'true');
    const inert = surface(); inert.setAttribute('inert', '');
    const visible = surface(); focusDocumentSurface(); expect(document.activeElement).toBe(visible);
  });
  it('discards delayed focus when the active session changes during mode selection', async () => {
    surface();
    const control = document.createElement('button'); document.body.append(control); control.focus();
    createSession('first.md', null, 'first');
    const pending = selectDocumentMode('source');
    createSession('second.md', null, 'second');
    await pending; expect(document.activeElement).toBe(control);
  });
});
