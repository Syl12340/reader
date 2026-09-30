import { describe, expect, it } from 'vitest';
import { patchPreviewHtml } from '../../src/lib/utils/dom-patch';

describe('preview DOM patching', () => {
  it('reuses unchanged blocks and refreshes their source line metadata', () => {
    const container = document.createElement('div');
    patchPreviewHtml(
      container,
      '<h1 data-line="1"><span data-line="1">Title</span></h1><p data-line="3">Body</p>',
      true,
    );

    const heading = container.querySelector('h1');
    const paragraph = container.querySelector('p');
    const result = patchPreviewHtml(
      container,
      '<h1 data-line="2"><span data-line="2">Title</span></h1><p data-line="4">Body</p>',
    );

    expect(container.querySelector('h1')).toBe(heading);
    expect(container.querySelector('p')).toBe(paragraph);
    expect(heading?.dataset.line).toBe('2');
    expect(heading?.querySelector('span')?.getAttribute('data-line')).toBe('2');
    expect(result.changedRoots).toEqual([]);
  });

  it('replaces only changed top-level blocks', () => {
    const container = document.createElement('div');
    patchPreviewHtml(container, '<h1>Title</h1><p>Before</p><hr>', true);

    const heading = container.querySelector('h1');
    const paragraph = container.querySelector('p');
    const separator = container.querySelector('hr');
    const result = patchPreviewHtml(container, '<h1>Title</h1><p>After</p><hr>');

    expect(container.querySelector('h1')).toBe(heading);
    expect(container.querySelector('p')).not.toBe(paragraph);
    expect(container.querySelector('p')?.textContent).toBe('After');
    expect(container.querySelector('hr')).toBe(separator);
    expect(result.changedRoots).toHaveLength(1);
    expect(result.changedRoots[0].tagName).toBe('P');
  });
});
