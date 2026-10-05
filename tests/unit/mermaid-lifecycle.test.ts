import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

const engine = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }));
vi.mock('mermaid', () => ({ default: engine }));
import { renderMermaid } from '../../src/lib/utils/mermaid';
import { MermaidWidget } from '../../src/lib/editor/decorations/code';

afterEach(() => { document.body.replaceChildren(); });

describe('Mermaid rendering lifecycle', () => {
  it('shares expensive rendering but assigns unique SVG IDs to repeated diagrams', async () => {
    engine.render.mockImplementation(async (id: string) => ({ svg: `<svg xmlns="http://www.w3.org/2000/svg" id="${id}"><text>cached diagram</text></svg>` }));
    const count = engine.render.mock.calls.length;
    const [first, second] = await Promise.all([renderMermaid('cached', 'light'), renderMermaid('cached', 'light')]);
    expect(engine.render.mock.calls.length - count).toBe(1);
    expect(first).not.toBe(second);
    expect(first).toContain('cached diagram');
    expect(second).toContain('cached diagram');
  });

  it('serializes theme changes with rendering and keeps failed source escaped', async () => {
    const themes: string[] = [];
    engine.initialize.mockImplementation(options => { themes.push(options.themeVariables.darkMode ? 'dark' : 'light'); });
    engine.render.mockImplementation(async (id: string, code: string) => {
      if (code.includes('broken')) throw new Error('parse failed');
      return { svg: `<svg xmlns="http://www.w3.org/2000/svg" id="${id}"/>` };
    });
    await Promise.all([renderMermaid('theme-dark', 'dark'), renderMermaid('theme-light', 'light')]);
    expect(themes.slice(-2)).toEqual(['dark', 'light']);
    const html = await renderMermaid('broken <script>evil()</script>', 'light');
    expect(html).toContain('mermaid-error'); expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it.each(['changed', 'destroyed'] as const)('does not apply asynchronous results after a widget is %s', async kind => {
    let finish: ((result: { svg: string }) => void) | undefined;
    engine.render.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const code = `lifecycle-${kind}`;
    const document = '```mermaid\n' + code + '\n```';
    const view = { state: EditorState.create({ doc: document }), dispatch: vi.fn(), focus: vi.fn() } as unknown as EditorView;
    const widget = new MermaidWidget({ from: 0, to: document.length, language: 'mermaid', code }, 'light', '0');
    const container = widget.toDOM(view); globalThis.document.body.append(container);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    if (kind === 'changed') Object.assign(view, { state: EditorState.create({ doc: 'new document' }) });
    else widget.destroy(container);
    finish!({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>stale</text></svg>' });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(container.querySelector('svg')).toBeNull();
    expect(container.textContent).not.toContain('stale');
  });
});
