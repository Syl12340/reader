import { afterEach, describe, expect, it, vi } from 'vitest';
import { filterFileTree } from '../../src/lib/utils/file-tree-filter';
import type { FileNode } from '../../src/lib/stores/file';
import { replaceSearchMatch, searchMatches, searchPattern } from '../../src/lib/utils/search';
import { extractHeadings } from '../../src/lib/utils/headings';
import { RenderService } from '../../src/lib/services/render';
import { dialogFocus } from '../../src/lib/utils/dialog-focus';
import { collectMarkerDecorations } from '../../src/lib/editor/decorations/marker';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

describe('live file-tree filtering', () => {
  const tree: FileNode[] = [{ name: 'notes', path: 'notes', isDirectory: true, isExpanded: false, children: [
    { name: 'alpha.md', path: 'notes/alpha.md', isDirectory: false },
    { name: 'beta.md', path: 'notes/beta.md', isDirectory: false },
  ] }];
  it('preserves hierarchy and does not change the shared tree or expansion state', () => {
    expect(filterFileTree(tree, 'alpha')).toMatchObject([{ name: 'notes', isExpanded: true, children: [{ name: 'alpha.md' }] }]);
    expect(tree[0].isExpanded).toBe(false);
    expect(tree[0].children).toHaveLength(2);
    expect(filterFileTree(tree, 'alpha', new Set(['notes']))[0].isExpanded).toBe(false);
    expect(filterFileTree(tree, '')).toBe(tree);
  });
  it('uses fresh entries after refresh rather than resurrecting a saved tree', () => {
    const fresh: FileNode[] = [{ name: 'gamma.md', path: 'gamma.md', isDirectory: false }];
    expect(filterFileTree(fresh, 'alpha')).toHaveLength(0);
    expect(filterFileTree(fresh, '')).toBe(fresh);
  });
  it('keeps descendants when a directory name matches and handles Unicode normalization', () => {
    expect(filterFileTree(tree, 'notes')[0].children).toHaveLength(2);
    expect(filterFileTree([{ name: 'Ａlpha.md', path: 'a.md', isDirectory: false }], 'alpha')).toHaveLength(1);
  });
});

describe('single-match replacements', () => {
  it('expands numeric and named captures like replace-all', () => {
    const pattern = searchPattern('(?<word>[a-z]+)-(\\d+)', { useRegex: true })!;
    const source = 'alpha-1 beta-2';
    const second = searchMatches(source, pattern).matches[1];
    expect(replaceSearchMatch(source, pattern, second, '$<word>:$2', true)).toBe('alpha-1 beta:2');
  });
  it('preserves lookbehind and native prefix/suffix expansion', () => {
    const pattern = searchPattern('(?<=prefix )word', { useRegex: true })!;
    const source = 'prefix word suffix';
    expect(replaceSearchMatch(source, pattern, { from: 7, to: 11 }, "$`<$&>$'", true)).toBe('prefix prefix <word> suffix suffix');
  });
  it('keeps replacement dollars literal outside regex mode and rejects stale ranges', () => {
    const pattern = searchPattern('word')!;
    expect(replaceSearchMatch('word', pattern, { from: 0, to: 4 }, '$1-$&', false)).toBe('$1-$&');
    expect(replaceSearchMatch('changed', pattern, { from: 0, to: 4 }, 'new', false)).toBeNull();
  });
  it('replaces zero-length matches without replacing subsequent matches', () => {
    const pattern = searchPattern('(?=.)', { useRegex: true })!;
    expect(replaceSearchMatch('ab', pattern, { from: 1, to: 1 }, '|', true)).toBe('a|b');
  });
});

it('generates unique heading IDs even when text collides with an automatic suffix', () => {
  const source = '# a\n# a\n# a-1\n# a\n# a-1';
  const ids = extractHeadings(source).map(heading => heading.id);
  expect(ids).toEqual(['a', 'a-1', 'a-1-1', 'a-2', 'a-1-2']);
  const node = document.createElement('div'); node.innerHTML = RenderService.render(source);
  expect([...node.querySelectorAll('h1')].map(heading => heading.id)).toEqual(ids);
});

describe('read-only preview task lists', () => {
  it('renders nested, ordered and upper-case tasks while preserving inline formatting', () => {
    const node = document.createElement('div');
    node.innerHTML = RenderService.render('- [ ] **pending**\n  - [X] nested\n\n1. [x] ordered');
    const inputs = [...node.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(inputs.map(input => input.checked)).toEqual([false, true, true]);
    expect(inputs.every(input => input.disabled)).toBe(true);
    expect(node.querySelector('strong')?.textContent).toBe('pending');
    expect(node.querySelectorAll('li.task-list-item')).toHaveLength(3);
  });
  it('does not treat escaped markers, inline code, ordinary paragraphs or fences as tasks', () => {
    const node = document.createElement('div');
    node.innerHTML = RenderService.render('- \\[ ] escaped\n- `[x] code`\n\n[x] paragraph\n\n```md\n- [ ] code\n```');
    expect(node.querySelectorAll('input')).toHaveLength(0);
    expect(node.textContent).toContain('[ ] escaped');
  });
});

it('collapses only an inactive Setext delimiter and always retains source text', () => {
  const source = 'Title\n=====\n\nparagraph';
  const state = EditorState.create({ doc: source, extensions: [markdown()] });
  const inactive = collectMarkerDecorations(state, [{ from: 0, to: source.length }], [], () => false);
  const active = collectMarkerDecorations(state, [{ from: 0, to: source.length }], [], () => true);
  expect(inactive.some(range => range.decoration.spec.class?.includes('cm-setext-delimiter'))).toBe(true);
  expect(active.some(range => range.decoration.spec.class?.includes('cm-setext-delimiter'))).toBe(false);
  expect(state.doc.toString()).toBe(source);
});

it('traps dialog keyboard focus, closes on Escape and restores the previous control', async () => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([new DOMRect(0, 0, 100, 20)] as unknown as DOMRectList);
  const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus();
  const dialog = document.createElement('div'); dialog.tabIndex = -1;
  dialog.innerHTML = '<button>Cancel</button><button>Save</button>'; document.body.append(dialog);
  const close = vi.fn(); const action = dialogFocus(dialog, { close });
  try {
    await Promise.resolve();
    const [first, last] = [...dialog.querySelectorAll('button')];
    expect(document.activeElement).toBe(first);
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(last);
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(first);
    trigger.focus(); expect(document.activeElement).toBe(first);
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); expect(close).toHaveBeenCalledOnce();
  } finally { action.destroy(); dialog.remove(); }
  await Promise.resolve(); expect(document.activeElement).toBe(trigger);
});
