import { isTauri } from './platform';
import { createStoredZip, type ZipEntry } from './zip';
import { convertMarkdownVariant } from './markdown-variants';
import { checkExportSignal } from '$lib/services/export-job';
import { confirmAction } from '$lib/services/interaction';

export interface ExportWriteOptions { path?: string; signal?: AbortSignal; onWrite?: () => void }

type MarkdownVariant = 'gfm' | 'commonmark' | 'github';

const EXPORT_CSS = `
  body, .export-document {
    margin: 0;
    color: #2f2f2f;
    background: #fff;
    font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    font-size: 16px;
    line-height: 1.75;
  }
  h1, h2, h3, h4, h5, h6 { line-height: 1.3; margin: 1.35em 0 0.55em; }
  p { margin: 0 0 0.9em; }
  a { color: #3f6fb5; }
  blockquote { margin: 1em 0; padding-left: 1em; border-left: 3px solid #d2d2d2; color: #666; }
  pre { padding: 1em; overflow: auto; border-radius: 4px; background: #f5f5f5; }
  code { font-family: Consolas, "Cascadia Code", monospace; background: #f5f5f5; }
  table { width: 100%; border-collapse: collapse; margin: 1em 0; }
  th, td { border: 1px solid #dedede; padding: 0.45em 0.7em; text-align: left; }
  th { background: #f5f5f5; }
  img, svg { max-width: 100%; height: auto; }
  .copy-button, .code-header button { display: none !important; }
`;

function baseName(title: string): string {
  return title.replace(/\.[^/.]+$/, '') || 'untitled';
}

function ensureExtension(filePath: string, extension: string): string {
  const suffix = `.${extension.replace(/^\./, '')}`;
  return filePath.toLowerCase().endsWith(suffix.toLowerCase()) ? filePath : `${filePath}${suffix}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function readDataResource(uri: string): { bytes: Uint8Array; mediaType: string; extension: string } {
  const match = /^data:([^;,]+)((?:;[^,]*)?),(.*)$/s.exec(uri);
  if (!match) throw new Error('导出资源未嵌入文档，请重新准备资源后导出');
  const bytes = /;base64(?:;|$)/i.test(match[2])
    ? Uint8Array.from(atob(match[3]), character => character.charCodeAt(0))
    : new TextEncoder().encode(decodeURIComponent(match[3]));
  let mediaType = match[1].toLowerCase();
  if (mediaType === 'application/octet-stream') {
    const magic = String.fromCharCode(...bytes.subarray(0, 4));
    if (magic === 'wOF2') mediaType = 'font/woff2';
    else if (magic === 'wOFF') mediaType = 'font/woff';
    else if (bytes[0] === 137 && magic.slice(1) === 'PNG') mediaType = 'image/png';
    else if (bytes[0] === 255 && bytes[1] === 216) mediaType = 'image/jpeg';
  }
  const extensions: Record<string, string> = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/svg+xml': 'svg',
    'image/webp': 'webp', 'image/bmp': 'bmp', 'font/woff2': 'woff2', 'font/woff': 'woff',
    'application/font-woff': 'woff', 'font/ttf': 'ttf', 'font/otf': 'otf',
    'application/x-font-ttf': 'ttf', 'application/vnd.ms-opentype': 'otf',
  };
  const extension = extensions[mediaType];
  if (!extension) throw new Error(`导出资源类型不受支持: ${mediaType}`);
  return { bytes, mediaType, extension };
}

function packageEpubResources(html: string, css: string) {
  const root = new DOMParser().parseFromString(sanitizeExportHtml(html), 'text/html');
  const resources = new Map<string, { id: string; href: string; mediaType: string; bytes: Uint8Array }>();
  const register = (uri: string): string => {
    const existing = resources.get(uri);
    if (existing) return existing.href;
    const resource = readDataResource(uri);
    const id = `resource-${resources.size + 1}`;
    const href = `resources/${id}.${resource.extension}`;
    resources.set(uri, { ...resource, id, href });
    return href;
  };
  const rewriteCss = (source: string) => source.replace(
    /url\(\s*(["']?)(data:[^)"']+)\1\s*\)/gi,
    (_match, _quote: string, uri: string) => `url("${register(uri)}")`,
  );
  root.querySelectorAll('img, image').forEach(element => {
    const attribute = element.localName === 'img' ? 'src' : element.hasAttribute('href') ? 'href' : 'xlink:href';
    const uri = element.getAttribute(attribute);
    if (uri) element.setAttribute(attribute, register(uri));
    element.removeAttribute('srcset');
  });
  root.querySelectorAll('style').forEach(style => { style.textContent = rewriteCss(style.textContent || ''); });
  root.querySelectorAll('[style]').forEach(element => {
    element.setAttribute('style', rewriteCss(element.getAttribute('style') || ''));
  });
  const rewrittenCss = rewriteCss(css);
  const properties = [root.querySelector('svg') ? 'svg' : '', root.querySelector('math') ? 'mathml' : ''].filter(Boolean).join(' ');
  return { html: root.body.innerHTML, css: rewrittenCss, properties, resources: [...resources.values()] };
}

export async function saveExportFile(
  filename: string,
  content: string | Uint8Array | Blob,
  mimeType: string,
  description: string,
  options: ExportWriteOptions = {},
): Promise<void> {
  checkExportSignal(options.signal);
  const extension = filename.split('.').pop() || '';
  if (isTauri()) {
    const { saveExportDialog, writeBinaryFile } = await import('./tauri-fs');
    const selectedPath = options.path ?? await saveExportDialog(filename, extension, description);
    if (!selectedPath) throw new DOMException('Export canceled', 'AbortError');

    const bytes = typeof content === 'string'
      ? new TextEncoder().encode(content)
      : content instanceof Blob
        ? new Uint8Array(await content.arrayBuffer())
        : content;
    checkExportSignal(options.signal);
    options.onWrite?.();
    await writeBinaryFile(ensureExtension(selectedPath, extension), bytesToBase64(bytes));
    return;
  }

  const blobPart = typeof content === 'string' || content instanceof Blob
    ? content
    : new Uint8Array(content).buffer;
  const blob = blobPart instanceof Blob ? blobPart : new Blob([blobPart], { type: mimeType });
  const url = URL.createObjectURL(blob);
  checkExportSignal(options.signal);
  options.onWrite?.();
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // The browser may not have consumed the download URL when click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function sanitizeExportHtml(html: string): string {
  if (typeof DOMParser === 'undefined') {
    return html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/\s+on\w+\s*=\s*(["']).*?\1/gi, '')
      .replace(/\s+on\w+\s*=\s*[^\s>]+/gi, '')
      .replace(/(href|src)\s*=\s*(["'])javascript:.*?\2/gi, '$1="#"');
  }

  const documentNode = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  documentNode.querySelectorAll('script, iframe, object, embed, button, .reader-figure-actions, [data-export-hidden]').forEach(node => node.remove());
  documentNode.querySelectorAll<HTMLElement>('*').forEach(element => {
    for (const attribute of Array.from(element.attributes)) {
      if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name);
      if (/^(href|src)$/i.test(attribute.name) && /^\s*javascript:/i.test(attribute.value)) {
        element.setAttribute(attribute.name, '#');
      }
    }
  });
  return documentNode.body.innerHTML;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

interface RunStyle {
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

interface WordContext {
  entries: ZipEntry[];
  relationships: string[];
  contentTypes: Map<string, string>;
  drawingId: number;
}

function imageSize(bytes: Uint8Array, extension: string): [number, number] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (extension === 'png' && bytes.length >= 24) return [view.getUint32(16), view.getUint32(20)];
  if (extension === 'gif' && bytes.length >= 10) return [view.getUint16(6, true), view.getUint16(8, true)];
  if (extension === 'bmp' && bytes.length >= 26) return [Math.abs(view.getInt32(18, true)), Math.abs(view.getInt32(22, true))];
  if (extension === 'jpg') {
    let offset = 2;
    while (offset + 4 <= bytes.length && bytes[offset] === 255) {
      const marker = bytes[offset + 1];
      if (marker === 255) { offset++; continue; }
      if (marker === 217 || marker === 218) break;
      const length = view.getUint16(offset + 2);
      if (length < 2 || offset + 2 + length > bytes.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 7) {
        return [view.getUint16(offset + 7), view.getUint16(offset + 5)];
      }
      offset += length + 2;
    }
  }
  throw new Error('无法读取 DOCX 图片尺寸，请改用 PNG 或 JPEG');
}

function imageToWord(element: Element, context: WordContext): string {
  const resource = readDataResource(element.getAttribute('src') || '');
  const [width, height] = imageSize(resource.bytes, resource.extension);
  if (!width || !height) throw new Error('DOCX 图片尺寸无效');
  const scale = Math.min(1, 600 / width, 850 / height);
  const cx = Math.round(width * scale * 9525), cy = Math.round(height * scale * 9525);
  const id = ++context.drawingId;
  const target = `media/image-${id}.${resource.extension}`;
  const relation = `image${id}`;
  context.entries.push({ name: `word/${target}`, data: resource.bytes });
  context.contentTypes.set(resource.extension, resource.mediaType);
  context.relationships.push(`<Relationship Id="${relation}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${target}"/>`);
  const alt = escapeXml(element.getAttribute('alt') || `Image ${id}`);
  return `<w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
    <wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Image ${id}" descr="${alt}"/>
    <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
      <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
        <pic:nvPicPr><pic:cNvPr id="${id}" name="Image ${id}"/><pic:cNvPicPr/></pic:nvPicPr>
        <pic:blipFill><a:blip r:embed="${relation}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
        <pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
      </pic:pic>
    </a:graphicData></a:graphic>
  </wp:inline></w:drawing></w:r>`;
}

function wordRun(text: string, style: RunStyle = {}): string {
  if (!text) return '';
  const properties = [
    style.bold ? '<w:b/>' : '',
    style.italic ? '<w:i/>' : '',
    style.code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:shd w:fill="F3F3F3"/>' : '',
  ].join('');
  const content = text.split(/(\r\n|\r|\n|\t)/).map(part => part === '\t' ? '<w:tab/>'
    : /^(\r\n|\r|\n)$/.test(part) ? '<w:br/>' : `<w:t xml:space="preserve">${escapeXml(part)}</w:t>`).join('');
  return `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ''}${content}</w:r>`;
}

function inlineToWord(node: Node, style: RunStyle = {}, context?: WordContext): string {
  if (node.nodeType === Node.TEXT_NODE) return wordRun(node.textContent || '', style);
  if (!(node instanceof HTMLElement)) return '';

  const tag = node.tagName.toLowerCase();
  if (tag === 'br') return '<w:r><w:br/></w:r>';
  if (tag === 'img' && context) return imageToWord(node, context);
  if (node.classList.contains('katex')) {
    return wordRun(`$${node.querySelector('annotation[encoding="application/x-tex"]')?.textContent || node.textContent || ''}$`, { ...style, code: true });
  }
  if (tag === 'input' && (node as HTMLInputElement).type === 'checkbox') {
    return wordRun((node as HTMLInputElement).checked ? '☒ ' : '☐ ', style);
  }

  const nextStyle: RunStyle = {
    bold: style.bold || tag === 'strong' || tag === 'b',
    italic: style.italic || tag === 'em' || tag === 'i',
    code: style.code || tag === 'code',
  };
  let content = Array.from(node.childNodes).map(child => inlineToWord(child, nextStyle, context)).join('');
  if (tag === 'a') {
    const href = node.getAttribute('href');
    if (href) content += wordRun(` (${href})`, { ...style, italic: true });
  }
  return content;
}

function wordParagraph(
  content: string,
  options: { style?: string; indent?: number; quote?: boolean } = {},
): string {
  const properties = [
    options.style ? `<w:pStyle w:val="${options.style}"/>` : '',
    options.indent ? `<w:ind w:left="${options.indent}"/>` : '',
    options.quote ? '<w:pBdr><w:left w:val="single" w:sz="8" w:space="8" w:color="BFBFBF"/></w:pBdr>' : '',
  ].join('');
  return `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ''}${content || wordRun('')}</w:p>`;
}

function elementChildren(element: Element, selector: string): Element[] {
  return Array.from(element.children).filter(child => child.matches(selector));
}

function tableToWord(table: Element, context: WordContext): string {
  const rows = Array.from(table.querySelectorAll('tr')).map(row => {
    const cells = Array.from(row.children)
      .filter(cell => /^(TH|TD)$/.test(cell.tagName))
      .map(cell => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${wordParagraph(
        Array.from(cell.childNodes).map(node => inlineToWord(node, { bold: cell.tagName === 'TH' }, context)).join(''),
      )}</w:tc>`)
      .join('');
    return `<w:tr>${cells}</w:tr>`;
  }).join('');
  return `<w:tbl><w:tblPr><w:tblBorders>
    <w:top w:val="single" w:sz="4" w:color="D9D9D9"/>
    <w:left w:val="single" w:sz="4" w:color="D9D9D9"/>
    <w:bottom w:val="single" w:sz="4" w:color="D9D9D9"/>
    <w:right w:val="single" w:sz="4" w:color="D9D9D9"/>
    <w:insideH w:val="single" w:sz="4" w:color="D9D9D9"/>
    <w:insideV w:val="single" w:sz="4" w:color="D9D9D9"/>
  </w:tblBorders></w:tblPr>${rows}</w:tbl>`;
}

function htmlToWordBody(html: string, context: WordContext): string {
  const parsed = new DOMParser().parseFromString(`<body>${sanitizeExportHtml(html)}</body>`, 'text/html');

  function convert(element: Element, depth = 0): string {
    const tag = element.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      return wordParagraph(
        Array.from(element.childNodes).map(node => inlineToWord(node, {}, context)).join(''),
        { style: `Heading${tag.slice(1)}` },
      );
    }
    if (tag === 'p') {
      return wordParagraph(Array.from(element.childNodes).map(node => inlineToWord(node, {}, context)).join(''));
    }
    if (tag === 'pre') return wordParagraph(wordRun(element.textContent || '', { code: true }));
    if (tag === 'blockquote') {
      return wordParagraph(
        Array.from(element.childNodes).map(node => inlineToWord(node, { italic: true }, context)).join(''),
        { indent: 480, quote: true },
      );
    }
    if (tag === 'table') return tableToWord(element, context);
    if (element.classList.contains('katex')) return wordParagraph(inlineToWord(element, {}, context));
    if (tag === 'ul' || tag === 'ol') {
      return elementChildren(element, 'li').map((item, index) => wordParagraph(
        wordRun(tag === 'ol' ? `${(Number(element.getAttribute('start')) || 1) + index}. ` : '• ') +
          Array.from(item.childNodes)
            .filter(node => !(node instanceof Element && /^(UL|OL)$/.test(node.tagName)))
            .map(node => inlineToWord(node, {}, context))
            .join(''),
        { indent: 360 * (depth + 1) },
      ) + Array.from(item.children).filter(child => /^(UL|OL)$/.test(child.tagName)).map(child => convert(child, depth + 1)).join('')).join('');
    }
    if (tag === 'hr') return wordParagraph(wordRun('────────────────'));
    if (tag === 'img') return wordParagraph(inlineToWord(element, {}, context));

    const blocks = Array.from(element.children).map(child => convert(child, depth)).join('');
    if (blocks) return blocks;
    return element.textContent?.trim() ? wordParagraph(inlineToWord(element, {}, context)) : '';
  }

  return Array.from(parsed.body.children).map(child => convert(child)).join('');
}

export function buildDocx(title: string, htmlContent: string, date = new Date()): Uint8Array {
  const context: WordContext = { entries: [], relationships: [], contentTypes: new Map(), drawingId: 0 };
  const body = htmlToWordBody(htmlContent, context);
  const safeTitle = escapeXml(title);
  const isoDate = date.toISOString();
  const entries: ZipEntry[] = [
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  ${[...context.contentTypes].map(([extension, mediaType]) => `<Default Extension="${extension}" ContentType="${mediaType}"/>`).join('')}
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`,
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`,
    },
    {
      name: 'docProps/core.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
 xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"
 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${safeTitle}</dc:title><dc:creator>Reader</dc:creator>
  <dcterms:created xsi:type="dcterms:W3CDTF">${isoDate}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${isoDate}</dcterms:modified>
</cp:coreProperties>`,
    },
    {
      name: 'docProps/app.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Application>Reader</Application>
</Properties>`,
    },
    {
      name: 'word/document.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>${body}
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>`,
    },
    {
      name: 'word/styles.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="24"/></w:rPr></w:style>
  ${Array.from({ length: 6 }, (_, index) => {
    const level = index + 1;
    const size = Math.max(24, 40 - index * 4);
    return `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr></w:style>`;
  }).join('')}
</w:styles>`,
    },
    { name: 'word/_rels/document.xml.rels', data: `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
${context.relationships.join('')}
</Relationships>` },
    ...context.entries,
  ];
  return createStoredZip(entries, date);
}

export async function exportAsDocx(title: string, htmlContent: string, options: ExportWriteOptions = {}): Promise<void> {
  const parsed = new DOMParser().parseFromString(sanitizeExportHtml(htmlContent), 'text/html');
  if (parsed.querySelector('.katex') && !await confirmAction('DOCX 公式兼容性', 'DOCX 中的公式将保留为可编辑的 LaTeX 源码，不是 Word 原生公式。是否继续？', '继续导出')) throw new DOMException('Export canceled', 'AbortError');
  for (const svg of Array.from(parsed.querySelectorAll('svg'))) {
    if (svg.closest('.katex')) continue;
    const image = parsed.createElement('img');
    image.alt = svg.querySelector('title')?.textContent || 'Diagram';
    const box = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    const width = box.length === 4 ? box[2] : Number.parseFloat(svg.getAttribute('width') || '');
    const height = box.length === 4 ? box[3] : Number.parseFloat(svg.getAttribute('height') || '');
    if (!(width > 0 && height > 0)) throw new Error('无法确定图表尺寸，DOCX 导出已停止');
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
    svg.replaceWith(image);
  }
  for (const element of Array.from(parsed.querySelectorAll('img'))) {
    const resource = readDataResource(element.getAttribute('src') || '');
    if (['png', 'jpg', 'gif', 'bmp'].includes(resource.extension)) continue;
    const image = new Image();
    image.src = element.src;
    await withTimeout(image.decode(), 15000, 'DOCX 图片解码超时');
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('DOCX 图片尺寸无效');
    const scale = Math.min(1, 4096 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.ceil(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法转换 DOCX 图片');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    element.src = canvas.toDataURL('image/png');
  }
  await saveExportFile(
    `${baseName(title)}.docx`,
    buildDocx(title, parsed.body.innerHTML),
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'Word Document',
    options,
  );
}

function toXhtmlFragment(html: string): string {
  const parsed = new DOMParser().parseFromString(`<body>${sanitizeExportHtml(html)}</body>`, 'text/html');
  parsed.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(input => {
    input.replaceWith(parsed.createTextNode(input.checked ? '☒ ' : '☐ '));
  });
  parsed.querySelectorAll('button').forEach(button => button.remove());
  const serializer = new XMLSerializer();
  return Array.from(parsed.body.childNodes).map(node => serializer.serializeToString(node)).join('');
}

export function buildEpub(
  title: string,
  htmlContent: string,
  author = 'Reader',
  date = new Date(),
  embeddedCss = '',
): Uint8Array {
  const safeTitle = escapeXml(title);
  const safeAuthor = escapeXml(author);
  const bookId = `urn:uuid:${generateUUID()}`;
  const packaged = packageEpubResources(htmlContent, `${EXPORT_CSS}\n${embeddedCss}`);
  const entries: ZipEntry[] = [
    { name: 'mimetype', data: 'application/epub+zip' },
    {
      name: 'META-INF/container.xml',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
    },
    {
      name: 'OEBPS/content.opf',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="BookId">${bookId}</dc:identifier>
    <dc:title>${safeTitle}</dc:title><dc:creator>${safeAuthor}</dc:creator><dc:language>zh-CN</dc:language>
    <meta property="dcterms:modified">${date.toISOString().replace(/\.\d{3}Z$/, 'Z')}</meta>
  </metadata>
  <manifest>
    <item id="content" href="content.xhtml" media-type="application/xhtml+xml"${packaged.properties ? ` properties="${packaged.properties}"` : ''}/>
    <item id="style" href="style.css" media-type="text/css"/>
    <item id="toc" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    ${packaged.resources.map(resource => `<item id="${resource.id}" href="${resource.href}" media-type="${resource.mediaType}"/>`).join('\n    ')}
  </manifest>
  <spine><itemref idref="content"/></spine>
</package>`,
    },
    {
      name: 'OEBPS/toc.xhtml',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>目录</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body><nav epub:type="toc"><h1>目录</h1><ol><li><a href="content.xhtml">${safeTitle}</a></li></ol></nav></body>
</html>`,
    },
    {
      name: 'OEBPS/content.xhtml',
      data: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${safeTitle}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>${toXhtmlFragment(packaged.html)}</body>
</html>`,
    },
    { name: 'OEBPS/style.css', data: packaged.css },
    ...packaged.resources.map(resource => ({ name: `OEBPS/${resource.href}`, data: resource.bytes })),
  ];
  return createStoredZip(entries, date);
}

export async function exportAsEpub(title: string, htmlContent: string, author?: string, embeddedCss = '', options: ExportWriteOptions = {}): Promise<void> {
  await saveExportFile(
    `${baseName(title)}.epub`,
    buildEpub(title, htmlContent, author, new Date(), embeddedCss),
    'application/epub+zip',
    'EPUB Book',
    options,
  );
}

function escapeLatex(value: string): string {
  return value
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/[&%$#_{}]/g, '\\$&')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}

function inlineMarkdownToLatex(value: string): string {
  const tokens: string[] = [];
  const protect = (latex: string) => {
    const marker = `\u0000${tokens.length}\u0000`;
    tokens.push(latex);
    return marker;
  };

  let text = value
    .replace(/`([^`]+)`/g, (_, code) => protect(`\\texttt{${escapeLatex(code)}}`))
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, math) => protect(`\\[${math}\\]`))
    .replace(/(?<!\$)\$(?!\s)([^\$\n]+?)(?<!\s)\$(?!\$)/g, (_, math) => protect(`$${math}$`))
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) =>
      protect(`\\textit{[Image: ${escapeLatex(alt || src)}]}`))
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) =>
      protect(`\\href{${escapeLatex(href)}}{${escapeLatex(label)}}`))
    .replace(/\*\*(.+?)\*\*/g, (_, content) => protect(`\\textbf{${escapeLatex(content)}}`))
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_, content) => protect(`\\textit{${escapeLatex(content)}}`))
    .replace(/~~(.+?)~~/g, (_, content) => protect(`\\sout{${escapeLatex(content)}}`));

  text = escapeLatex(text);
  return text.replace(/\u0000(\d+)\u0000/g, (_, index) => tokens[Number(index)]);
}

export function convertMarkdownToLatex(title: string, markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const output = [
    '\\documentclass[12pt]{article}',
    '\\usepackage[utf8]{inputenc}',
    '\\usepackage[T1]{fontenc}',
    '\\usepackage{amsmath,amssymb}',
    '\\usepackage{graphicx}',
    '\\usepackage{hyperref}',
    '\\usepackage{listings}',
    '\\usepackage[normalem]{ulem}',
    '\\usepackage{geometry}',
    '\\geometry{a4paper, margin=1in}',
    `\\title{${escapeLatex(title)}}`,
    '\\author{Reader}',
    '\\date{\\today}',
    '\\begin{document}',
    '\\maketitle',
    '',
  ];

  let codeFence: string | null = null;
  let displayMath = false;
  let listType: 'itemize' | 'enumerate' | null = null;

  const closeList = () => {
    if (listType) output.push(`\\end{${listType}}`, '');
    listType = null;
  };

  for (const line of lines) {
    const fence = line.match(/^\s*```(.*)$/);
    if (fence) {
      closeList();
      if (codeFence !== null) {
        output.push('\\end{lstlisting}', '');
        codeFence = null;
      } else {
        codeFence = fence[1].trim();
        output.push(`\\begin{lstlisting}${codeFence ? `[language=${escapeLatex(codeFence)}]` : ''}`);
      }
      continue;
    }
    if (codeFence !== null) {
      output.push(line);
      continue;
    }

    if (/^\s*\$\$\s*$/.test(line)) {
      closeList();
      output.push(displayMath ? '\\]' : '\\[');
      displayMath = !displayMath;
      continue;
    }
    if (displayMath) {
      output.push(line);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      closeList();
      const commands = ['section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph', 'subparagraph'];
      output.push(`\\${commands[heading[1].length - 1]}{${inlineMarkdownToLatex(heading[2])}}`, '');
      continue;
    }

    const unordered = line.match(/^\s*[-*+]\s+(?:\[([ xX])\]\s+)?(.+)$/);
    const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (unordered || ordered) {
      const nextType = ordered ? 'enumerate' : 'itemize';
      if (listType !== nextType) {
        closeList();
        listType = nextType;
        output.push(`\\begin{${nextType}}`);
      }
      const checkbox = unordered?.[1];
      const label = checkbox === undefined ? '' : checkbox.toLowerCase() === 'x' ? '[x] ' : '[ ] ';
      output.push(`\\item ${inlineMarkdownToLatex(label + (ordered?.[1] || unordered?.[2] || ''))}`);
      continue;
    }
    closeList();

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      output.push('\\begin{quote}', inlineMarkdownToLatex(quote[1]), '\\end{quote}', '');
    } else if (/^\s*(?:---+|\*\*\*+)\s*$/.test(line)) {
      output.push('\\hrulefill', '');
    } else if (line.trim()) {
      output.push(inlineMarkdownToLatex(line), '');
    }
  }

  closeList();
  if (codeFence !== null) output.push('\\end{lstlisting}', '');
  if (displayMath) output.push('\\]');
  output.push('\\end{document}', '');
  return output.join('\n');
}

export async function exportAsLatex(title: string, markdownContent: string, options: ExportWriteOptions = {}): Promise<void> {
  await saveExportFile(
    `${baseName(title)}.tex`,
    convertMarkdownToLatex(title, markdownContent),
    'application/x-tex',
    'LaTeX Document',
    options,
  );
}

export function convertToGFM(markdown: string): string {
  return convertMarkdownVariant(markdown, 'gfm');
}

export function convertToCommonMark(markdown: string): string {
  return convertMarkdownVariant(markdown, 'commonmark');
}

export function convertToGitHub(markdown: string): string {
  const title = markdown.split('\n')[0]?.replace(/^#+\s*/, '') || 'Untitled';
  return `---\ntitle: ${title.replace(/\n/g, ' ')}\n---\n\n${convertToGFM(markdown)}`;
}

export async function exportAsMarkdownVariant(
  title: string,
  content: string,
  variant: MarkdownVariant,
  options: ExportWriteOptions = {},
): Promise<void> {
  const converted = variant === 'gfm'
    ? convertToGFM(content)
    : variant === 'commonmark'
      ? convertToCommonMark(content)
      : convertToGitHub(content);
  const suffix = variant === 'gfm' ? '.gfm.md' : variant === 'commonmark' ? '.cm.md' : '.github.md';
  await saveExportFile(`${baseName(title)}${suffix}`, converted, 'text/markdown', 'Markdown Document', options);
}

function waitForImages(container: HTMLElement): Promise<void> {
  return Promise.all(Array.from(container.querySelectorAll('img')).map(image => {
    image.loading = 'eager';
    return image.decode();
  })).then(() => undefined);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      value => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      error => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

async function encodeCanvas(
  canvas: HTMLCanvasElement,
  format: 'png' | 'jpg',
): Promise<Blob> {
  return withTimeout(new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('图片编码失败')),
      format === 'png' ? 'image/png' : 'image/jpeg',
      0.95,
    );
  }), 5000, '图片编码超时');
}

async function renderTextFallback(
  container: HTMLElement,
  width: number,
  format: 'png' | 'jpg',
): Promise<Blob> {
  const padding = 48;
  const lineHeight = 28;
  const maxTextWidth = width - padding * 2;
  const canvas = document.createElement('canvas');
  const measureContext = canvas.getContext('2d');
  if (!measureContext) throw new Error('Canvas not supported');
  measureContext.font = '18px system-ui, sans-serif';

  const lines: string[] = [];
  const paragraphs = (container.innerText || container.textContent || '')
    .split(/\r?\n/)
    .map(line => line.trimEnd());
  for (const paragraph of paragraphs) {
    if (!paragraph) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const character of paragraph) {
      const candidate = line + character;
      if (line && measureContext.measureText(candidate).width > maxTextWidth) {
        lines.push(line);
        line = character;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }

  canvas.width = width;
  canvas.height = Math.max(160, padding * 2 + Math.max(1, lines.length) * lineHeight);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas not supported');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#24292f';
  context.font = '18px system-ui, sans-serif';
  context.textBaseline = 'top';
  lines.forEach((line, index) => {
    context.fillText(line, padding, padding + index * lineHeight, maxTextWidth);
  });
  return encodeCanvas(canvas, format);
}

async function renderHtmlToImage(htmlContent: string, format: 'png' | 'jpg', embeddedCss: string): Promise<Blob> {
  const width = 800;
  const frame = document.createElement('iframe');
  frame.title = 'Image export';
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;height:1px;border:0;pointer-events:none;`;
  document.body.appendChild(frame);
  const exportDocument = frame.contentDocument;
  if (!exportDocument) {
    frame.remove();
    throw new Error('无法创建图片导出文档');
  }
  const container = exportDocument.createElement('div');
  container.className = 'export-document';
  container.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  container.style.cssText = `width:${width}px;padding:48px;box-sizing:border-box;background:#fff;`;
  const style = exportDocument.createElement('style');
  style.textContent = `${EXPORT_CSS}\n${embeddedCss}`;
  const main = exportDocument.createElement('main');
  main.innerHTML = sanitizeExportHtml(htmlContent);
  container.append(style, main);
  exportDocument.body.appendChild(container);

  try {
    // Force layout so the export document discovers the fonts its content uses.
    void container.offsetHeight;
    if (exportDocument.fonts?.ready) {
      await withTimeout(exportDocument.fonts.ready, 15000, '字体加载超时');
    }
    await withTimeout(waitForImages(container), 15000, '图片加载超时');
    const height = Math.max(1, Math.ceil(container.scrollHeight));
    const scale = Math.min(2, 16384 / Math.max(width, height));
    if (scale < 0.25) throw new Error('文档过长，无法导出为单张图片');

    const serialized = new XMLSerializer().serializeToString(container);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <foreignObject width="100%" height="100%">${serialized}</foreignObject>
    </svg>`;
    const svgUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    try {
      const image = new Image();
      image.decoding = 'sync';
      await withTimeout(new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('无法渲染导出图片'));
        image.src = svgUrl;
      }), 5000, 'HTML 图片渲染超时');

      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(width * scale);
      canvas.height = Math.ceil(height * scale);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas not supported');
      context.scale(scale, scale);
      context.fillStyle = '#fff';
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      return await encodeCanvas(canvas, format);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (!confirm(`图片排版渲染失败：${reason}\n\n是否改为纯文本图片？公式、图片和表格排版将丢失。取消则不导出。`)) {
        throw new Error('已取消图片导出，未生成简化文件');
      }
      return await renderTextFallback(main, width, format);
    } finally {
      URL.revokeObjectURL(svgUrl);
    }
  } finally {
    frame.remove();
  }
}

export async function exportAsImage(
  title: string,
  htmlContent: string,
  format: 'png' | 'jpg' = 'png',
  embeddedCss = '',
  options: ExportWriteOptions = {},
): Promise<void> {
  const blob = await renderHtmlToImage(htmlContent, format, embeddedCss);
  await saveExportFile(
    `${baseName(title)}.${format}`,
    blob,
    format === 'png' ? 'image/png' : 'image/jpeg',
    format === 'png' ? 'PNG Image' : 'JPEG Image',
    options,
  );
}

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
    const random = Math.floor(Math.random() * 16);
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}
