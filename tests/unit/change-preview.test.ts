import { describe, expect, it } from 'vitest';
import { changePreview } from '../../src/lib/utils/change-preview';

describe('bounded replacement excerpts', () => {
  it('includes the first change with preceding context', () => {
    const result = changePreview('same\nold\nend', 'same\nnew\nend');
    expect(result).toEqual({ line: 1, before: 'same\nold\nend', after: 'same\nnew\nend', truncated: false });
  });
  it('labels clipped content and limits the rendered string', () => {
    const result = changePreview('x'.repeat(100000), 'y'.repeat(100000));
    expect(result.truncated).toBe(true);
    expect(result.before.length).toBe(16000);
    expect(result.after.length).toBe(16000);
  });
  it('does not manufacture changes for identical content', () => {
    expect(changePreview('same', 'same')).toEqual({ line: 1, before: '', after: '', truncated: false });
  });
});
