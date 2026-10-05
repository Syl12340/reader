import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { EditorSelection, EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { slashTrigger } from '../../src/lib/editor/slash';
import { placePopover } from '../../src/lib/utils/popover-position';
import { quickOpenScore } from '../../src/lib/utils/quick-open';
import { documentStats } from '../../src/lib/utils/document-stats';
import { activePrompt, ask, attachInteractionHost, cancelActivePrompt } from '../../src/lib/services/interaction';
import { dialogFocus } from '../../src/lib/utils/dialog-focus';

afterEach(() => { cancelActivePrompt(); vi.restoreAllMocks(); document.body.replaceChildren(); });

function stateAt(source: string, head = source.length) {
  return EditorState.create({ doc: source, selection: { anchor: head }, extensions: [markdown()] });
}

describe('block-only slash insertion', () => {
  it('recognizes an empty block and list or quote prefixes', () => {
    expect(slashTrigger(stateAt('/code'))).toEqual({ from: 0, to: 5, query: 'code' });
    expect(slashTrigger(stateAt('> - /table'))).toEqual({ from: 4, to: 10, query: 'table' });
    expect(slashTrigger(stateAt('- [ ] /task'))?.query).toBe('task');
  });
  it('does not open for prose, paths, escapes or existing trailing text', () => {
    for (const source of ['read /code', 'https://example.com', '/notes/part', '\\/code', '`/code`']) {
      expect(slashTrigger(stateAt(source))).toBeNull();
    }
    expect(slashTrigger(stateAt('/code trailing', 5))).toBeNull();
  });
  it('excludes fenced and indented code and nonempty or multiple selections', () => {
    const source = '```md\n/code\n```';
    expect(slashTrigger(stateAt(source, source.indexOf('/code') + 5))).toBeNull();
    expect(slashTrigger(stateAt('    /code'))).toBeNull();
    expect(slashTrigger(stateAt('/code').update({ selection: { anchor: 0, head: 5 } }).state)).toBeNull();
    const multiple = EditorState.create({ doc: '/code', extensions: [markdown(), EditorState.allowMultipleSelections.of(true)],
      selection: EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(5)]) });
    expect(slashTrigger(multiple)).toBeNull();
  });
});

describe('popover bounds', () => {
  const viewport = { left: 0, top: 0, width: 300, height: 200 };
  it('flips above and clamps the right edge', () => {
    expect(placePopover({ x: 295, y: 190 }, { width: 100, height: 40 }, viewport)).toEqual({ left: 192, top: 144 });
  });
  it('flips a centered toolbar below the top edge', () => {
    expect(placePopover({ x: 5, y: 12, placement: 'above', align: 'center' }, { width: 100, height: 40 }, viewport))
      .toEqual({ left: 8, top: 18 });
  });
  it('respects zoom viewport offsets even when a panel exceeds its bounds', () => {
    expect(placePopover({ x: 0, y: 0 }, { width: 500, height: 500 }, { left: 40, top: 20, width: 200, height: 160 }))
      .toEqual({ left: 48, top: 28 });
  });
});

it('keeps fuzzy matches in long paths and normalizes full-width text and separators', () => {
  expect(quickOpenScore(`${'directory/'.repeat(20)}deep/note.md`, 'dpn')).toBeGreaterThan(0);
  expect(quickOpenScore('folder/Ａlpha.md', 'alpha')).toBeGreaterThan(500);
  expect(quickOpenScore('folder\\note.md', 'folder/note')).toBeGreaterThan(0);
  expect(quickOpenScore('folder/note.md', 'xyz')).toBe(-1);
});

it('strips actual task markers without dropping literal X from ordinary prose', () => {
  expect(documentStats('[X] literal').words).toBe(2);
  expect(documentStats('- [X] literal').words).toBe(1);
  expect(documentStats('- > [X] literal').words).toBe(2);
});

it('cancels active and queued prompts when their host unmounts', async () => {
  const detach = attachInteractionHost();
  const options = { title: 'First', message: 'Confirm', actions: [{ id: 'cancel', label: 'Cancel' }] };
  const first = ask(options), second = ask({ ...options, title: 'Second' });
  try { await vi.waitFor(() => expect(get(activePrompt)?.title).toBe('First')); }
  finally { detach(); }
  expect(await Promise.all([first, second])).toEqual(['cancel', 'cancel']);
  expect(await ask(options)).toBe('cancel');
});

it('does not steal focus from the top dialog when an underlying dialog is removed', async () => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([new DOMRect(0, 0, 100, 20)] as unknown as DOMRectList);
  const parent = document.createElement('div'), child = document.createElement('div');
  parent.tabIndex = child.tabIndex = -1;
  parent.innerHTML = '<button>Parent</button>'; child.innerHTML = '<button>Child</button>';
  document.body.append(parent, child);
  const first = dialogFocus(parent, { close: vi.fn() }); await Promise.resolve();
  const top = dialogFocus(child, { close: vi.fn() }); await Promise.resolve();
  try {
    first.destroy(); parent.remove(); await Promise.resolve();
    expect(document.activeElement).toBe(child.querySelector('button'));
  } finally { top.destroy(); child.remove(); }
});
