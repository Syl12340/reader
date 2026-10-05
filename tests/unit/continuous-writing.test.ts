import { afterEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import type { EditorView } from '@codemirror/view';
import { CommandService } from '../../src/lib/services/command';
import { exportJob, cancelExport, withExportJob, waitForExport } from '../../src/lib/services/export-job';
import { notices } from '../../src/lib/services/interaction';
import { normalizeSettings, normalizeImageDirectory } from '../../src/lib/stores/settings';
import { activeSessionId } from '../../src/lib/stores/document';
import { inspectResource } from '../../src/lib/editor/resource-request';
import { replaceResource, type ResourceEditRequest } from '../../src/lib/utils/resource-edit';
import { buildExportHtml } from '../../src/lib/utils/export-html';
import { placePopover } from '../../src/lib/utils/popover-position';

afterEach(() => { activeSessionId.set(null); notices.set([]); });

describe('command availability', () => {
  it('checks availability and checked state at execution time', async () => {
    let enabled = false, calls = 0;
    const dispose = CommandService.register('test-availability', () => { calls++; }, {
      label: 'Test', enabled: () => enabled, checked: () => enabled, unavailable: 'Unavailable',
    });
    await CommandService.execute('test-availability');
    expect(calls).toBe(0);
    expect(get(notices).at(-1)?.message).toBe('Unavailable');
    enabled = true;
    expect(CommandService.describe('test-availability').checked).toBe(true);
    await CommandService.execute('test-availability');
    expect(calls).toBe(1);
    dispose();
    expect(CommandService.describe('test-availability').enabled).toBe(false);
  });

  it('an old registration cannot unregister its replacement', async () => {
    const old = CommandService.register('test-replacement', () => {});
    let calls = 0;
    const current = CommandService.register('test-replacement', () => { calls++; });
    old(); await CommandService.execute('test-replacement');
    expect(calls).toBe(1); current();
  });
});

describe('export jobs', () => {
  it('cancels preparation without allowing a write and clears state', async () => {
    let resolve!: () => void, writes = 0;
    const pending = new Promise<void>(done => { resolve = done; });
    const job = withExportJob('HTML', async (signal, stage) => {
      stage('render'); await waitForExport(pending, signal);
      stage('write'); writes++;
    });
    cancelExport();
    await expect(job).rejects.toMatchObject({ name: 'AbortError' });
    resolve();
    expect(writes).toBe(0); expect(get(exportJob)).toBeNull();
  });

  it('does not cancel a commit or start a concurrent job', async () => {
    await withExportJob('PDF', async (signal, stage) => {
      stage('write'); cancelExport();
      expect(signal.aborted).toBe(false);
      expect(await withExportJob('HTML', async () => { throw new Error('should not start'); })).toBe(false);
    });
    expect(get(exportJob)).toBeNull();
  });
});

describe('view preferences and resources', () => {
  it('normalizes display settings separately from document typography', () => {
    const settings = normalizeSettings({ fontSize: 18, displayZoom: 900, contentWidth: 0, exportMargin: -1 });
    expect(settings.fontSize).toBe(18); expect(settings.displayZoom).toBe(200);
    expect(settings.contentWidth).toBe(560); expect(settings.exportMargin).toBe(10);
    expect(normalizeImageDirectory('../other')).toBe('assets');
    expect(normalizeImageDirectory('D:/other')).toBe('assets');
    expect(normalizeImageDirectory('images/course')).toBe('images/course');
    expect(normalizeSettings({ typographyPreset: 'serif' }).contentWidth).toBe(740);
  });

  it('aligns document lists to their right edge without overflowing', () => {
    expect(placePopover({ x: 500, y: 50, align: 'end' }, { width: 200, height: 100 }, { left: 0, top: 0, width: 600, height: 400 }).left).toBe(300);
  });

  it.each(['![old](old.png "title")', '[old](#heading "title")'])('edits %s using syntax ranges without dropping its title', source => {
    activeSessionId.set('test');
    const state = EditorState.create({ doc: source, extensions: [markdown()] });
    let request: ResourceEditRequest | undefined;
    const handler = (event: Event) => { request = (event as CustomEvent<ResourceEditRequest>).detail; };
    window.addEventListener('reader-inspect-resource', handler);
    try {
      expect(inspectResource({ state } as EditorView, 3)).toBe(true);
      expect(request?.label).toBe('old');
      const output = replaceResource(request!, 'new path.png', 'new [label]');
      expect(output).toContain('<new path.png> "title"');
      expect(output).toContain('new \\[label\\]');
      expect(() => replaceResource(request!, 'javascript:alert(1)', 'label')).toThrow();
    } finally { window.removeEventListener('reader-inspect-resource', handler); }
  });

  it('uses print settings and creates collision-free HTML outline targets', () => {
    const html = buildExportHtml('Report', '<h1 id="reader-export-heading-0">Existing</h1><h2>New</h2>', 'light', '', true, {
      paper: 'Letter', margin: 15, outline: true, fontSize: 18, fontFamily: 'Georgia, serif',
    });
    const root = new DOMParser().parseFromString(html, 'text/html');
    expect(root.querySelector('style')?.textContent).toContain('size:Letter; margin:15mm');
    expect(root.querySelector('style')?.textContent).toContain('font-family:Georgia, serif');
    expect(root.querySelectorAll('nav a')).toHaveLength(2);
    expect(new Set([...root.querySelectorAll('[id]')].map(element => element.id)).size).toBe(2);
  });
});
