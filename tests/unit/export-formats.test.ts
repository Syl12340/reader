import { describe, expect, it } from 'vitest';
import {
  buildDocx,
  buildEpub,
  convertMarkdownToLatex,
  convertToCommonMark,
  convertToGFM,
  sanitizeExportHtml,
} from '../../src/lib/utils/export-formats';

const decoder = new TextDecoder();

function readStoredZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength));
    files.set(name, bytes.slice(dataStart, dataStart + compressedSize));
    offset = dataStart + compressedSize;
  }
  return files;
}

describe('export formats', () => {
  const imageData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCfkAAAAASUVORK5CYII=';

  it('packages EPUB resources once and references manifest assets instead of data URLs', () => {
    const files = readStoredZip(buildEpub('Resources', `<img src="${imageData}"/><img src="${imageData}"/>`,
      'Reader', new Date('2026-09-30T00:00:00Z'), '@font-face{font-family:Test;src:url("data:font/woff2;base64,d09GMg==")}'));
    const content = decoder.decode(files.get('OEBPS/content.xhtml'));
    const manifest = decoder.decode(files.get('OEBPS/content.opf'));
    expect(content).not.toContain('data:image');
    expect(content.match(/resources\/resource-1.png/g)).toHaveLength(2);
    expect(manifest).toContain('media-type="image/png"');
    expect(manifest).toContain('media-type="font/woff2"');
    expect(files.has('OEBPS/resources/resource-1.png')).toBe(true);
    expect(decoder.decode(files.get('OEBPS/style.css'))).toContain('resources/resource-2.woff2');
  });

  it('embeds DOCX image relationships and preserves nested list indentation and code breaks', () => {
    const files = readStoredZip(buildDocx('Image', `<p><img src="${imageData}" alt="pixel"/></p><ul><li>one<ul><li>two</li></ul></li></ul><pre>a\nb\tc</pre>`));
    const xml = decoder.decode(files.get('word/document.xml'));
    expect(xml).toContain('<w:drawing>');
    expect(xml).toContain('w:left="720"');
    expect(xml).toContain('<w:br/>');
    expect(xml).toContain('<w:tab/>');
    expect(files.has('word/media/image-1.png')).toBe(true);
    expect(decoder.decode(files.get('word/_rels/document.xml.rels'))).toContain('Target="media/image-1.png"');
    expect(decoder.decode(files.get('word/_rels/document.xml.rels'))).toContain('Target="styles.xml"');
  });

  it('preserves a formula source once instead of duplicating KaTeX visual and accessibility text', () => {
    const files = readStoredZip(buildDocx('Math', '<p><span class="katex"><span class="katex-mathml"><math><semantics><annotation encoding="application/x-tex">x^2</annotation></semantics></math></span><span class="katex-html">visual duplicate</span></span></p>'));
    const xml = decoder.decode(files.get('word/document.xml'));
    expect(xml).toContain('$x^2$');
    expect(xml).not.toContain('visual duplicate');
  });

  it('builds a real OOXML DOCX package', () => {
    const bytes = buildDocx(
      'Export Test',
      '<h1>Heading</h1><p>Hello <strong>Reader</strong>.</p><table><tr><th>A</th></tr><tr><td>1</td></tr></table>',
      new Date('2026-06-15T00:00:00Z'),
    );
    const files = readStoredZip(bytes);

    expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(files.has('[Content_Types].xml')).toBe(true);
    expect(files.has('_rels/.rels')).toBe(true);
    expect(files.has('word/document.xml')).toBe(true);
    expect(files.has('word/styles.xml')).toBe(true);

    const documentXml = decoder.decode(files.get('word/document.xml'));
    expect(documentXml).toContain('Heading1');
    expect(documentXml).toContain('Hello ');
    expect(documentXml).toContain('<w:b/>');
    expect(documentXml).toContain('<w:tbl>');
    expect(documentXml).not.toContain('<html');
  });

  it('builds a valid EPUB container with mimetype first', () => {
    const bytes = buildEpub(
      'EPUB Test',
      '<h1>Chapter</h1><p>Body</p>',
      'Reader',
      new Date('2026-06-15T00:00:00Z'),
    );
    const files = readStoredZip(bytes);
    const firstNameLength = new DataView(bytes.buffer).getUint16(26, true);
    const firstName = decoder.decode(bytes.subarray(30, 30 + firstNameLength));

    expect(firstName).toBe('mimetype');
    expect(decoder.decode(files.get('mimetype'))).toBe('application/epub+zip');
    expect(files.has('META-INF/container.xml')).toBe(true);
    expect(files.has('OEBPS/content.opf')).toBe(true);
    expect(files.has('OEBPS/toc.xhtml')).toBe(true);
    expect(decoder.decode(files.get('OEBPS/content.xhtml'))).toContain('<h1');
  });

  it('sanitizes active content from exported HTML', () => {
    const clean = sanitizeExportHtml(
      '<p onclick="alert(1)">safe</p><script>alert(1)</script><a href="javascript:alert(1)">bad</a>',
    );
    expect(clean).toContain('safe');
    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('onclick');
    expect(clean).not.toContain('javascript:');
  });

  it('preserves formulas and groups lists in LaTeX', () => {
    const latex = convertMarkdownToLatex(
      'Title & Notes',
      '# Heading\n\n- one\n- [x] done\n\nInline $E = mc^2$.\n\n$$\n\\int_0^1 x^2 dx\n$$',
    );
    expect(latex).toContain('\\title{Title \\& Notes}');
    expect(latex.match(/\\begin\{itemize\}/g)).toHaveLength(1);
    expect(latex.match(/\\end\{itemize\}/g)).toHaveLength(1);
    expect(latex).toContain('$E = mc^2$');
    expect(latex).toContain('\\int_0^1 x^2 dx');
  });

  it('converts Markdown variants without duplicating task bullets', () => {
    expect(convertToGFM('- [X] done')).toBe('- [x] done');
    const commonMark = convertToCommonMark('- [ ] pending\n- [x] done\n~~removed~~');
    expect(commonMark).toBe('- pending\n- done\nremoved');
    expect(commonMark).not.toContain('- -');
  });
});
