import { describe, expect, it } from 'vitest';
import { RenderService } from '../../src/lib/services/render';
import { prepareLatex } from '../../src/lib/utils/latex';
import { renderMarkdown } from '../../src/lib/utils/markdown';

describe('markdown and latex rendering', () => {
  it('does not treat escaped dollar signs as formulas', () => {
    const { cleaned, map } = prepareLatex('\\$escaped$ and $x$');

    expect(map.size).toBe(1);
    expect(cleaned).toContain('\\$escaped$');
    expect(cleaned).not.toContain('$x$');
  });

  it('excludes tilde fenced code from formula scanning', () => {
    const { cleaned, map } = prepareLatex('~~~js\n$no$\n~~~\n\n$yes$');

    expect(map.size).toBe(1);
    expect(cleaned).toContain('$no$');
    expect(cleaned).not.toContain('$yes$');
  });

  it('renders inline and block formulas through RenderService', () => {
    const html = RenderService.render('Inline $E = mc^2$.\n\n$$\n\\int_0^1 x^2 dx\n$$');

    expect(html).toContain('class="katex"');
    expect(html).toContain('katex-display');
    expect(html).not.toContain('$E = mc^2$');
  });

  it('renders slash-delimited formulas before markdown-it can escape brackets', () => {
    const html = RenderService.render([
      '\\[ A\\times B=C\\times D\\iff A=C \\]',
      '',
      'Because \\(B\\ne\\varnothing\\), choose \\(b_0\\in B\\).',
    ].join('\n'));

    expect(html).toContain('katex-display');
    expect(html).toContain('class="katex"');
    expect(html).not.toContain('[ A\\times');
    expect(html).not.toContain('\\(B\\ne');
  });

  it('escapes renderer-owned attributes for code fences and images', () => {
    const html = renderMarkdown([
      '```js" onclick="evil',
      'console.log(1)',
      '```',
      '',
      '![a" b](x" onerror="evil)',
    ].join('\n'));

    expect(html).toContain('data-lang="js&quot;');
    expect(html).toContain('class="language-js-"');
    expect(html).not.toContain('onclick="evil"');
    expect(html).not.toContain('onerror="evil"');
  });
});
