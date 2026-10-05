import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { parseDataChart, renderDataChart, renderChartTable } from '../../src/lib/utils/data-chart';
import { uniqueSvg } from '../../src/lib/utils/svg';
import { RenderService } from '../../src/lib/services/render';
import { renderFormula } from '../../src/lib/utils/latex';
import { MathWidget } from '../../src/lib/editor/decorations/math';
import { CodeWidget, MermaidWidget } from '../../src/lib/editor/decorations/code';
import { buildExportHtml, fitPrintFormulas } from '../../src/lib/utils/export-html';
import { prepareExportDocument } from '../../src/lib/services/export-document';
import { scanFencedBlocks, scanMath } from '../../src/lib/editor/markdown-scanner';
import { installFigureControls } from '../../src/lib/utils/figure';

const source = JSON.stringify({ type: 'line', title: '进度', labels: ['一', '二', '三'],
  series: [{ name: '任务', data: [1, 4, 2] }] });

describe('declarative charts', () => {
  it.each(['line', 'bar', 'scatter'] as const)('renders %s as local accessible SVG', type => {
    const config = JSON.stringify({ type, series: [{ name: 'test', data: type === 'scatter' ? [[1, 2], [3, 4]] : [-2, 4] }] });
    const root = new DOMParser().parseFromString(renderDataChart(config), 'image/svg+xml');
    expect(root.querySelector('parsererror')).toBeNull();
    expect(root.documentElement.getAttribute('role')).toBe('img');
    expect(root.querySelector(type === 'line' ? 'polyline' : type === 'bar' ? 'rect' : 'circle')).not.toBeNull();
    expect(renderDataChart(config, 'dark')).not.toBe(renderDataChart(config, 'light'));
  });

  it('validates data shape, size, numbers and label counts without evaluating input', () => {
    for (const config of ['alert(1)', '{"type":"pie"}', '{"type":"line","series":[]}',
      '{"type":"scatter","series":[{"data":[1,2]}]}',
      '{"type":"bar","labels":["one"],"series":[{"data":[1,2]}]}',
      '{"type":"line","series":[{"data":["()=>evil()"]}]}',
      '{"type":"line","series":[{"data":[1e999]}]}']) expect(() => parseDataChart(config)).toThrow();
    expect(() => parseDataChart(' '.repeat(1_000_001))).toThrow('1MB');
  });

  it('escapes titles, labels and data table content', () => {
    const text = JSON.stringify({ type: 'bar', title: '"><script>evil()</script>', labels: ['<img onerror="evil()">'],
      series: [{ name: '<b>x</b>', data: [1] }] });
    const html = renderDataChart(text) + renderChartTable(text);
    const root = new DOMParser().parseFromString(html, 'text/html');
    expect(root.querySelector('script,img,b')).toBeNull();
    expect(root.querySelector('table caption')?.textContent).toContain('<script>');
  });

  it('bounds SVG complexity and exposes sampling without losing source data', () => {
    const text = JSON.stringify({ type: 'line', series: [{ data: Array.from({ length: 10_000 }, (_, index) => index) }] });
    const root = new DOMParser().parseFromString(renderDataChart(text), 'image/svg+xml');
    expect(root.querySelectorAll('circle')).toHaveLength(600);
    expect(root.documentElement.textContent).toContain('已抽样');
    expect(parseDataChart(text).series[0].data).toHaveLength(10_000);
    expect(renderChartTable(text)).toContain('前 1000 项');
  });

  it('switches graphic, table and source without duplicating SVGs', () => {
    const container = document.createElement('div'); container.innerHTML = renderDataChart(source);
    installFigureControls(container, { title: '进度', source, edit() {}, table: () => renderChartTable(source) });
    const click = (label: string) => [...container.querySelectorAll('button')].find(button => button.textContent === label)!.click();
    click('数据'); expect(container.querySelector('table')).not.toBeNull();
    click('查看源码'); expect(container.querySelector('pre')?.textContent).toBe(source);
    click('图形'); click('图形'); expect(container.querySelectorAll('svg')).toHaveLength(1);
  });
});

describe('shared formulas and fenced regions', () => {
  it('uses identical safe KaTeX output for preview, widgets and fenced math', () => {
    const formula = 'x^2';
    const item = { from: 0, to: 5, source: formula, display: true };
    const view = { state: EditorState.create({ doc: '$$x$$' }) } as EditorView;
    const widget = new MathWidget(item, true, 'light').toDOM(view);
    expect(widget.innerHTML).toBe(renderFormula(formula, true));
    const html = RenderService.render('```math\nx^2\n```');
    expect(html).toContain(renderFormula(formula, true));
    expect(html).not.toContain('data-latex');
    expect(RenderService.render('\\[x^2\\]')).not.toMatch(/<p[^>]*>\s*<div/);
  });

  it('keeps invalid formula source and prevents trusted HTML injection', () => {
    const error = renderFormula('\\notAReaderCommand{x}', true);
    expect(error).toContain('reader-math-error');
    expect(error).toContain('\\notAReaderCommand{x}');
    const root = new DOMParser().parseFromString(renderFormula('\\href{javascript:alert(1)}{x}', false), 'text/html');
    expect(root.querySelector('a[href^="javascript:"]')).toBeNull();
  });

  it('excludes unclosed/longer-closing fences and multiline backtick spans', () => {
    const text = '```js\n$no$\n````\n\n``a ` $no$\nb``\n\n$yes$\n\n~~~js\n$never$';
    const fences = scanFencedBlocks(text);
    expect(fences[0].closed).toBe(true);
    expect(fences[1].closed).toBe(false);
    expect(scanMath(text, fences).map(item => item.source)).toEqual(['yes']);
    expect(scanMath('$x\\$y$')[0].source).toBe('x\\$y');
  });

  it('does not replace formulas inside indented or quoted code blocks', () => {
    const html = RenderService.render('    $indented$\n\n> ```text\n> $quoted$\n> ```\n\n$real$');
    const root = new DOMParser().parseFromString(html, 'text/html');
    expect(root.querySelectorAll('.katex')).toHaveLength(1);
    expect(root.querySelectorAll('pre code')[0].textContent).toContain('$indented$');
    expect(root.querySelectorAll('pre code')[1].textContent).toContain('$quoted$');
  });

  it('does not re-render unchanged code widgets for unrelated document versions', () => {
    const item = { from: 1, to: 20, code: 'x', language: 'js' };
    expect(new CodeWidget(item, 'light', '1').eq(new CodeWidget(item, 'light', '2'))).toBe(true);
    expect(new MermaidWidget(item, 'light', '1').eq(new MermaidWidget({ ...item, from: 2 }, 'light', '1'))).toBe(false);
  });
});

describe('static diagram exports', () => {
  it('rewrites SVG IDs/references but not visible labels', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" id="A" aria-labelledby="title"><title id="title">A</title><style>#A .x{fill:url(#marker)}</style><defs><marker id="marker"/></defs><path marker-end="url(#marker)"/><use href="#A"/></svg>';
    const result = uniqueSvg(svg, 'copy-');
    const root = new DOMParser().parseFromString(result, 'image/svg+xml');
    expect(root.querySelector('title')?.textContent).toBe('A');
    expect(root.documentElement.getAttribute('aria-labelledby')).toBe('copy-title');
    expect(root.querySelector('path')?.getAttribute('marker-end')).toBe('url(#copy-marker)');
    expect(root.querySelector('use')?.getAttribute('href')).toBe('#copy-A');
    expect(root.querySelector('style')?.textContent).toContain('#copy-A');
  });

  it('exports chart SVG without controls, network URLs or pending placeholders', async () => {
    const result = await prepareExportDocument('```chart\n' + source + '\n```\n\n```js\nx\n```', null, 'light');
    expect(result.bodyHtml).toContain('<svg');
    expect(result.bodyHtml).not.toContain('<button');
    expect(result.bodyHtml).not.toContain('data-chart');
    expect(result.bodyHtml).not.toContain('等待渲染');
    expect(result.warnings).toEqual([]);
  });

  it('keeps invalid chart source and reports incomplete exports', async () => {
    const result = await prepareExportDocument('```chart\n{"type":"invalid"}\n```', null, 'light');
    expect(result.bodyHtml).toContain('invalid');
    expect(result.warnings?.length).toBeGreaterThan(0);
  });

  it('uses current typography and repeatable table headers in sanitized exports', () => {
    const html = buildExportHtml('<Report>', '<h1>Title</h1><button>复制</button><div class="reader-figure-actions">controls</div>',
      'light', '', true, { typographyPreset: 'serif', fontSize: 19, lineHeight: 1.9 });
    expect(html).toContain('Georgia'); expect(html).toContain('font-size:19px');
    expect(html).toContain('line-height:1.9'); expect(html).toContain('table-header-group');
    expect(html).toContain('&lt;Report&gt;'); expect(html).not.toContain('<button');
    expect(html).not.toContain('>controls<');
    expect(buildExportHtml('Math', '', 'light', '@font-face{font-family:KaTeX}', false)).toContain('@font-face');
  });

  it('fits long print formulas locally rather than clipping or scaling the whole page', () => {
    const root = document.implementation.createHTMLDocument();
    root.body.innerHTML = '<div><span class="katex-display"><span class="katex" style="font-size:20px">long</span></span></div>';
    const display = root.querySelector<HTMLElement>('.katex-display')!;
    const formula = root.querySelector<HTMLElement>('.katex')!;
    Object.defineProperty(display.parentElement, 'clientWidth', { value: 400 });
    formula.getBoundingClientRect = () => ({ width: 800 } as DOMRect);
    fitPrintFormulas(root);
    expect(formula.style.fontSize).toBe('10px');
  });
});
