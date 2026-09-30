import { expect, test, type Download, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const markdown = [
  '# Export Heading',
  '',
  'Paragraph with **bold**, `code`, and $E = mc^2$.',
  '',
  '- [X] completed',
  '- [ ] pending',
  '',
  '| Name | Value |',
  '| --- | ---: |',
  '| alpha | 1 |',
].join('\n');

async function createDocument(page: Page) {
  await page.goto('/');
  await page.getByRole('menubar').getByRole('menuitem', { name: '文件', exact: true }).click();
  await page.getByRole('menuitem', { name: '新建', exact: false }).click();
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.evaluate((text) => {
    window.dispatchEvent(new CustomEvent('editor-replace-range', {
      detail: { from: 0, to: 0, text },
    }));
  }, markdown);
}

async function exportDownload(page: Page, label: string): Promise<Download> {
  await page.getByTestId('file-menu-trigger').click();
  await page.getByTestId('export-menu-trigger').hover();
  const item = page.getByTestId('export-submenu').getByRole('menuitem', { name: label, exact: true });
  await expect(item).toBeVisible();
  const download = page.waitForEvent('download');
  await item.click();
  return await download;
}

async function downloadBytes(download: Download): Promise<Buffer> {
  const filePath = await download.path();
  if (!filePath) throw new Error('Download did not produce a temporary file');
  return await readFile(filePath);
}

test.beforeEach(async ({ page }) => {
  await createDocument(page);
});

test('exports a standalone sanitized HTML document', async ({ page }) => {
  const download = await exportDownload(page, 'HTML');
  const content = (await downloadBytes(download)).toString('utf8');
  expect(download.suggestedFilename()).toBe('未命名.html');
  expect(content).toContain('<!DOCTYPE html>');
  expect(content).toContain('Export Heading');
  expect(content).toContain('katex');
  expect(content).not.toContain('onclick=');
});

test('exports real DOCX and EPUB ZIP containers', async ({ page }) => {
  page.once('dialog', dialog => dialog.accept());
  const docx = await exportDownload(page, 'Word (DOCX)');
  const docxBytes = await downloadBytes(docx);
  expect(docx.suggestedFilename()).toBe('未命名.docx');
  expect(Array.from(docxBytes.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
  expect(docxBytes.includes(Buffer.from('word/document.xml'))).toBe(true);

  const epub = await exportDownload(page, '电子书 (EPUB)');
  const epubBytes = await downloadBytes(epub);
  expect(epub.suggestedFilename()).toBe('未命名.epub');
  expect(Array.from(epubBytes.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
  expect(epubBytes.includes(Buffer.from('application/epub+zip'))).toBe(true);
  expect(epubBytes.includes(Buffer.from('OEBPS/content.opf'))).toBe(true);
});

test('exports LaTeX and Markdown variants from current content', async ({ page }) => {
  const latex = await exportDownload(page, 'LaTeX (.tex)');
  const latexContent = (await downloadBytes(latex)).toString('utf8');
  expect(latex.suggestedFilename()).toBe('未命名.tex');
  expect(latexContent).toContain('\\section{Export Heading}');
  expect(latexContent).toContain('$E = mc^2$');

  const gfm = await exportDownload(page, 'GFM Markdown');
  expect((await downloadBytes(gfm)).toString('utf8')).toContain('- [x] completed');

  const commonMark = await exportDownload(page, 'CommonMark');
  const commonMarkContent = (await downloadBytes(commonMark)).toString('utf8');
  expect(commonMarkContent).toContain('- completed');
  expect(commonMarkContent).not.toContain('- -');
});

test('exports a rendered PNG instead of a blank placeholder canvas', async ({ page }) => {
  page.once('dialog', dialog => dialog.accept());
  const download = await exportDownload(page, '图片 (PNG)');
  const bytes = await downloadBytes(download);
  expect(download.suggestedFilename()).toBe('未命名.png');
  expect(Array.from(bytes.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(bytes.length).toBeGreaterThan(1000);
});

test('builds printable PDF content and invokes the print flow', async ({ page }) => {
  const dialogs: string[] = [];
  page.on('dialog', async dialog => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });
  await page.evaluate(() => {
    const state = { html: '', printed: false };
    (window as any).__readerPdfTest = state;
    (window as any).open = () => null;
    window.addEventListener('reader-pdf-print', ((event: CustomEvent<{ html: string }>) => {
      state.html = event.detail.html;
      state.printed = true;
    }) as EventListener);
  });

  await page.getByTestId('file-menu-trigger').click();
  await page.getByTestId('export-menu-trigger').hover();
  await page.locator('[data-export-format="pdf"]').click();
  await expect.poll(() => page.evaluate(() => (window as any).__readerPdfTest.printed)).toBe(true);
  const html = await page.evaluate(() => (window as any).__readerPdfTest.html);
  expect(html).toContain('<!DOCTYPE html>');
  expect(html).toContain('Export Heading');
  expect(dialogs).toEqual([]);
});
