import { describe, expect, it } from 'vitest';
import { extractHeadings } from '../../src/lib/utils/headings';
import { resolveDocumentLink } from '../../src/lib/services/navigation';
import { RenderService } from '../../src/lib/services/render';
import { clearPreviewMatch, highlightPreviewMatch } from '../../src/lib/utils/preview-match';
import { searchMatches, searchPattern } from '../../src/lib/utils/search';
import { parseWorkspaceSnapshot, workspaceSnapshot } from '../../src/lib/services/workspace-session';
import { generateImageName } from '../../src/lib/utils/image-handler';
import { resolvePath, normalizePathKey } from '../../src/lib/utils/path';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { collectMarkerDecorations } from '../../src/lib/editor/decorations/marker';

describe('Typora writing workflows', () => {
  it('shares Unicode, duplicate and Setext headings while excluding fenced code', () => {
    const source = '# 中文标题\n\n# 中文标题\n\nSetext\n======\n\n~~~~\n# not a heading\n~~~~';
    const headings = extractHeadings(source);
    expect(headings.map(heading => heading.id)).toEqual(['中文标题', '中文标题-1', 'setext']);
    expect(headings.map(heading => heading.line)).toEqual([1, 3, 5]);
    const dom = document.createElement('div'); dom.innerHTML = RenderService.render(source);
    expect([...dom.querySelectorAll('h1')].map(node => node.id)).toEqual(headings.map(heading => heading.id));
  });

  it('preserves source line mapping after frontmatter and multiline math', () => {
    const source = '---\ntitle: note\n---\n\n$$\nx^2\n$$\n\n# After';
    const dom = document.createElement('div'); dom.innerHTML = RenderService.render(source);
    expect(dom.querySelector('h1')?.getAttribute('data-line')).toBe('8');
    expect(dom.querySelector('h1')?.id).toBe('after');
  });

  it('highlights the exact repeated match across inline formatting', () => {
    const source = 'needle **needle** needle';
    const dom = document.createElement('div'); dom.innerHTML = RenderService.render(source);
    const from = source.indexOf('needle', 1);
    const mark = highlightPreviewMatch(dom, source, from, from + 6, text => RenderService.render(text));
    expect(mark?.textContent).toBe('needle');
    expect(mark?.parentElement?.tagName).toBe('STRONG');
    clearPreviewMatch(dom);
    expect(dom.querySelector('mark')).toBeNull();
    expect(dom.textContent?.trim()).toBe('needle needle needle');
  });

  it('highlights a match spanning multiple DOM text nodes', () => {
    const source = 'one **two** three';
    const dom = document.createElement('div'); dom.innerHTML = RenderService.render(source);
    highlightPreviewMatch(dom, source, 0, source.length, text => RenderService.render(text));
    expect([...dom.querySelectorAll('mark')].map(node => node.textContent).join('')).toBe('one two three');
  });

  it('falls back to block emphasis for syntax that has no visible text', () => {
    const source = '[label](https://example.org)';
    const dom = document.createElement('div'); dom.innerHTML = RenderService.render(source);
    const from = source.indexOf('https');
    expect(highlightPreviewMatch(dom, source, from, from + 5, text => RenderService.render(text))?.classList.contains('preview-source-match')).toBe(true);
    expect(dom.querySelector('a')?.textContent).toBe('label');
  });

  it('supports Unicode whole words, literal punctuation and bounded zero-length regexes', () => {
    expect(searchMatches('a.b aXb', searchPattern('a.b')).matches).toHaveLength(1);
    expect(searchMatches('章节 章节一', searchPattern('章节', { wholeWord: true })).matches).toHaveLength(1);
    expect(searchMatches('abc', searchPattern('(?=.)', { useRegex: true })).matches).toHaveLength(3);
    expect(() => searchPattern('[', { useRegex: true })).toThrow();
  });

  it('resolves local links without losing roots or Unicode anchors', () => {
    expect(resolveDocumentLink('../notes.md#%E4%B8%AD%E6%96%87', 'C:/docs/sub/file.md')).toEqual({ path: 'C:/docs/notes.md', anchor: '中文' });
    expect(resolvePath('/docs/../note.md')).toBe('/note.md');
    expect(normalizePathKey('\\\\Server\\Share\\dir\\..\\Note.md')).toBe('//server/share/note.md');
    expect(() => resolveDocumentLink('javascript:alert(1)', null)).toThrow();
  });

  it('creates unique image names matching the real MIME type', () => {
    const first = generateImageName('image/jpeg');
    expect(first.endsWith('.jpg')).toBe(true);
    expect(first).not.toBe(generateImageName('image/jpeg'));
    expect(() => generateImageName('text/plain')).toThrow();
  });

  it('does not serialize document contents or editor internals into workspace metadata', () => {
    const snapshot = workspaceSnapshot([{ id: 'one', name: 'note.md', path: 'C:/note.md', content: 'private draft', savedContent: '',
      isDirty: true, cursorOffset: 2, scrollTop: 30, workspaceLayout: 'source', editorState: { secret: true } }], 'one', 'C:/');
    expect(JSON.stringify(snapshot)).not.toContain('private draft');
    expect(JSON.stringify(snapshot)).not.toContain('secret');
    expect(parseWorkspaceSnapshot(JSON.stringify(snapshot))?.tabs[0].workspaceLayout).toBe('source');
    expect(parseWorkspaceSnapshot('{broken')).toBeNull();
    expect(parseWorkspaceSnapshot(JSON.stringify({ ...snapshot, tabs: [null, {}, ...snapshot.tabs] }))?.tabs).toHaveLength(1);
  });

  it('decorates lists, quotes and Setext headings without affecting source text', () => {
    const source = '> quote\n\n- item\n  - nested\n\nTitle\n=====';
    const state = EditorState.create({ doc: source, extensions: [markdown()] });
    const ranges = collectMarkerDecorations(state, [{ from: 0, to: source.length }], [], () => false);
    expect(ranges.some(range => range.decoration.spec.class?.includes('cm-quote-line'))).toBe(true);
    expect(ranges.some(range => range.decoration.spec.class?.includes('cm-list-line'))).toBe(true);
    expect(ranges.some(range => range.decoration.spec.class?.includes('cm-heading-1'))).toBe(true);
    expect(state.doc.toString()).toBe(source);
  });
});
