import { describe, expect, it } from 'vitest';
import {
  formatMarkdownTable,
  intersectsSelection,
  scanFencedBlocks,
  scanMath,
  scanTables,
  scanTasks,
} from '../../src/lib/editor/markdown-scanner';

describe('markdown scanner', () => {
  it('excludes code fences and inline code from math', () => {
    const text = '$ok$ ` $no$ `\n```js\n$nope$\n```\n\\$escaped$';
    const fences = scanFencedBlocks(text);
    expect(scanMath(text, fences).map(item => item.source)).toEqual(['ok']);
  });

  it('recognizes slash-delimited LaTeX blocks and inline formulas', () => {
    const text = [
      '\\[ A\\times B=C\\times D\\iff A=C \\]',
      'Text \\(B\\ne\\varnothing\\) and \\(f(x)=x^2\\).',
    ].join('\n\n');

    expect(scanMath(text).map(item => ({ source: item.source, display: item.display }))).toEqual([
      { source: 'A\\times B=C\\times D\\iff A=C', display: true },
      { source: 'B\\ne\\varnothing', display: false },
      { source: 'f(x)=x^2', display: false },
    ]);
  });

  it('finds nested task markers and preserves checked state', () => {
    const tasks = scanTasks('- [ ] one\n  - [X] two\n1. [x] three');
    expect(tasks.map(task => task.checked)).toEqual([false, true, true]);
  });

  it('round trips a GFM table', () => {
    const source = '| A | B |\n| :--- | ---: |\n| x | y |';
    const [table] = scanTables(source);
    expect(formatMarkdownTable(table.rows, table.alignments, table.dividerCells)).toBe(source);
  });

  it('treats touching selections as active', () => {
    expect(intersectsSelection({ from: 4, to: 8 }, [{ from: 8, to: 8 }])).toBe(true);
  });

  it('handles escaped table separators and tilde fences', () => {
    const text = [
      '~~~ts',
      '- [ ] ignored',
      '~~~',
      '',
      '| A | B |',
      '| --- | --- |',
      '| left\\|right | value |',
    ].join('\n');
    const fences = scanFencedBlocks(text);
    expect(fences[0].language).toBe('ts');
    expect(scanTasks(text, fences)).toEqual([]);
    expect(scanTables(text, fences)[0].rows[1]).toEqual(['left|right', 'value']);
  });

  it('scans a 500KB document without changing range semantics', () => {
    const text = `${'plain text line\n'.repeat(36_000)}- [x] final task`;
    expect(text.length).toBeGreaterThan(500_000);
    const tasks = scanTasks(text);
    expect(tasks).toHaveLength(1);
    expect(text.slice(tasks[0].from, tasks[0].to)).toBe('[x]');
  });
});
