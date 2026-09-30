import { afterEach, describe, expect, it } from 'vitest';
import { resolveImageSrc } from '../../src/lib/utils/markdown';

afterEach(() => {
  delete (window as typeof window & { __TAURI__?: unknown }).__TAURI__;
});

describe('resolveImageSrc', () => {
  it('keeps browser and remote image sources unchanged', () => {
    expect(resolveImageSrc('images/photo.png', 'D:\\notes\\entry.md')).toBe('images/photo.png');
    expect(resolveImageSrc('https://example.com/photo.png')).toBe('https://example.com/photo.png');
  });

  it('uses the active file directory in Tauri mode', () => {
    (window as typeof window & { __TAURI__?: unknown }).__TAURI__ = {};
    expect(resolveImageSrc('images/photo one.png', 'D:\\notes\\entry.md'))
      .toBe('asset://localhost/D%3A/notes/images/photo%20one.png');
  });
});
