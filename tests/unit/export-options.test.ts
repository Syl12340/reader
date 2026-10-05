import { describe, expect, it } from 'vitest';
import { normalizeSettings } from '../../src/lib/stores/settings';
import { buildExportHtml, printPageDimensions } from '../../src/lib/utils/export-html';
import { exportOptions, exportPreset, exportTypography, type ExportSource } from '../../src/lib/utils/export-options';
import { ExportHistory } from '../../src/lib/services/export-history';

const source: ExportSource = { sessionId: 'one', baseName: 'report.md', markdown: 'private body', filePath: 'D:/Course/report.md', theme: 'light' };
function memoryStorage() {
  const entries = new Map<string, string>();
  return { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); }, entries };
}

describe('export typography', () => {
  it('normalizes new settings without changing old defaults', () => {
    expect(normalizeSettings({}).exportPageNumbers).toBe(false);
    expect(normalizeSettings({}).exportBookmarks).toBe(false);
    const options = normalizeSettings({ exportOrientation: 'landscape', exportPageNumbers: true, fontSize: 24, displayZoom: 180 });
    expect(exportTypography(options).fontSize).toBe(24);
    expect(exportOptions(options)).not.toHaveProperty('fontSize');
    expect(exportOptions(options)).not.toHaveProperty('displayZoom');
    expect(exportPreset(options, true)).toMatchObject({ exportOrientation: 'portrait', exportPageNumbers: true, exportChapterBreaks: true, exportBookmarks: false });
    expect(exportPreset(options, false).exportPageNumbers).toBe(false);
  });
  it('uses correct printable dimensions for both papers and orientations', () => {
    expect(printPageDimensions({ paper: 'A4', margin: 20 })).toMatchObject({ width: 210, height: 297, contentWidth: 170, contentHeight: 257 });
    const letter = printPageDimensions({ paper: 'Letter', orientation: 'landscape', margin: 15 });
    expect(letter).toMatchObject({ width: 279.4, height: 215.9 });
    expect(letter.contentWidth).toBeCloseTo(249.4);
    expect(printPageDimensions({ margin: NaN }).margin).toBe(20);
  });
  it('preserves selected font size and applies page counters and chapter breaks', () => {
    const html = buildExportHtml('Paper', '<h1>Start</h1><h1>Chapter</h1>', 'light', '', true, {
      paper: 'A4', orientation: 'landscape', margin: 15, fontSize: 24, pageNumbers: true, chapterBreaks: true,
    });
    expect(html).toContain('size:A4 landscape; margin:15mm');
    expect(html).toContain('counter(page) " / " counter(pages)');
    expect(html).toContain('font-size:24px');
    expect(html).not.toContain('font-size:18px');
    expect(html).toContain('break-before:page');
    expect(html).toContain('content="267"');
    expect(html).toContain('max-height:172mm');
  });
  it('keeps page setup but no decorative typography in unstyled HTML', () => {
    const html = buildExportHtml('Paper', '<p>Body</p>', 'light', '', false, { pageNumbers: true, chapterBreaks: true });
    expect(html).toContain('@bottom-center');
    expect(html).toContain('break-before:page');
    expect(html).not.toContain('font-family:');
  });
});

describe('export history', () => {
  it('persists only export/typography options and restores per-path across sessions', () => {
    const storage = memoryStorage();
    const defaults = normalizeSettings({ fontSize: 24, exportMargin: 12, autoSave: true, customTextPrimary: 'private UI' });
    new ExportHistory(storage).record(source, 'html', defaults);
    const raw = [...storage.entries.values()][0];
    expect(raw).not.toContain('private body'); expect(raw).not.toContain('private UI'); expect(raw).not.toContain('autoSave');
    const restored = new ExportHistory(storage).get({ ...source, sessionId: 'new', filePath: 'd:\\course\\report.md' }, normalizeSettings({ autoSave: false }));
    expect(restored?.preferences).toMatchObject({ fontSize: 24, exportMargin: 12, autoSave: false });
    expect(restored?.format).toBe('html');
  });
  it('does not persist untitled sessions or print attempts', () => {
    const storage = memoryStorage(), history = new ExportHistory(storage), defaults = normalizeSettings({});
    const untitled = { ...source, filePath: null };
    history.record(untitled, 'pdf', defaults);
    expect(history.get(untitled, defaults)?.format).toBe('pdf');
    expect(new ExportHistory(storage).get(untitled, defaults)).toBeUndefined();
    history.record(source, 'print', defaults);
    expect(storage.entries.size).toBe(0);
  });
  it('limits records and ignores corrupt storage', () => {
    const storage = memoryStorage(), defaults = normalizeSettings({}), history = new ExportHistory(storage);
    for (let index = 0; index < 55; index++) history.record({ ...source, filePath: `D:/Course/${index}.md` }, 'html', defaults);
    expect(JSON.parse([...storage.entries.values()][0])).toHaveLength(50);
    expect(history.get({ ...source, filePath: 'D:/Course/0.md' }, defaults)).toBeUndefined();
    expect(new ExportHistory({ getItem: () => '{bad', setItem: () => {} }).get(source, defaults)).toBeUndefined();
    const malicious = JSON.stringify([{ path: source.filePath, format: 'html', preferences: { customFontContent: { malicious: true }, exportMargin: 900 } }]);
    expect(new ExportHistory({ getItem: () => malicious, setItem: () => {} }).get(source, defaults)?.preferences).toMatchObject({ customFontContent: '', exportMargin: 35 });
  });
});
