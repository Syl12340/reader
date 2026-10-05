import { expect, test, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';

const markdown = '# Export Snapshot\n\n中文报告，公式 $E=mc^2$。\n\n```cpp\nint main() { return 0; }\n```\n\n# Second Chapter\n\n| 项目 | 结果 |\n| --- | --- |\n| 内容 | 完整 |\n\n# Third Chapter\n\n最后一页。';
async function createDocument(page: Page) {
  await page.goto('/');
  await page.getByRole('menubar').getByRole('menuitem', { name: '文件', exact: true }).click();
  await page.getByRole('menuitem', { name: '新建', exact: false }).click();
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.evaluate(text => window.dispatchEvent(new CustomEvent('editor-replace-range', { detail: { from: 0, to: 0, text } })), markdown);
}
async function preview(page: Page) {
  await page.getByTestId('file-menu-trigger').click();
  await page.getByTestId('export-menu-trigger').hover();
  await page.getByTestId('export-submenu').getByText('导出预览与设置…', { exact: true }).click();
  const panel = page.getByRole('dialog', { name: '导出预览与设置' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('button', { name: /^导出 (HTML|PDF)/ })).toBeEnabled();
  return panel;
}

test('previews isolated math/code and exports captured content with selected paper settings', async ({ page }, testInfo) => {
  await createDocument(page);
  const panel = await preview(page);
  const frame = page.frameLocator('iframe[title="导出文档排版预览"]');
  await expect(frame.locator('h1').first()).toHaveText('Export Snapshot');
  await expect(frame.locator('.katex')).toBeVisible();
  await expect(frame.getByRole('button')).toHaveCount(0);
  await panel.getByLabel('纸张', { exact: true }).selectOption('Letter');
  await panel.getByLabel('方向', { exact: true }).selectOption('landscape');
  await panel.getByLabel('页边距（毫米）', { exact: true }).fill('15');
  await panel.getByLabel('包含文档目录', { exact: true }).check();
  await panel.getByLabel('打印页码', { exact: true }).check();
  await panel.getByLabel('保存为默认导出设置', { exact: true }).check();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('editor-replace-range', { detail: { from: 0, to: 0, text: 'Changed after preview\n\n' } })));
  const downloadPromise = page.waitForEvent('download');
  await panel.getByRole('button', { name: '导出 HTML…', exact: true }).click();
  const download = await downloadPromise;
  const file = await download.path();
  expect(file).toBeTruthy();
  const html = await readFile(file!, 'utf8');
  expect(html).toContain('Export Snapshot');
  expect(html).not.toContain('Changed after preview');
  expect(html).toContain('size:Letter landscape; margin:15mm');
  expect(html).toContain('counter(pages)');
  expect(html).toContain('aria-label="目录"');
  await writeFile(testInfo.outputPath('export-landscape.html'), html, 'utf8');
  expect(await page.evaluate(() => localStorage.getItem('exportOrientation'))).toBe('landscape');
  expect(await page.evaluate(() => localStorage.getItem('fontSize'))).toBe('16');
});

test('preview cancel restores focus and does not change saved export preferences', async ({ page }) => {
  await createDocument(page);
  const downloads: string[] = [];
  page.on('download', item => downloads.push(item.suggestedFilename()));
  const panel = await preview(page);
  await panel.getByLabel('方向', { exact: true }).selectOption('landscape');
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  expect(downloads).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('exportOrientation'))).toBeNull();
  await expect(page.getByTestId('file-menu-trigger')).toBeFocused();
  await page.keyboard.press('Control+Shift+p');
  await page.getByRole('combobox').fill('导出预览');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: '导出预览与设置' })).toBeVisible();
});

test('Escape inside the preview iframe closes the dialog', async ({ page }) => {
  await createDocument(page);
  const panel = await preview(page);
  await page.frameLocator('iframe[title="导出文档排版预览"]').locator('h1').first().click();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
});

test('generated Chromium PDF includes page counters and heading bookmarks', async ({ page, context }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem('exportPageNumbers', 'true');
    localStorage.setItem('exportChapterBreaks', 'true');
    localStorage.setItem('fontSize', '24');
  });
  await createDocument(page);
  await page.evaluate(() => {
    (window as any).__printHtml = '';
    window.addEventListener('reader-pdf-print', ((event: CustomEvent<{ html: string }>) => { (window as any).__printHtml = event.detail.html; }) as EventListener);
  });
  await page.getByTestId('file-menu-trigger').click();
  await page.getByTestId('export-menu-trigger').hover();
  await page.locator('[data-export-format="pdf"]').click();
  await expect.poll(() => page.evaluate(() => (window as any).__printHtml.length)).toBeGreaterThan(0);
  const html = await page.evaluate(() => (window as any).__printHtml as string);
  await writeFile(testInfo.outputPath('export-pagination.html'), html, 'utf8');
  const printPage = await context.newPage();
  await printPage.setContent(html);
  await printPage.emulateMedia({ media: 'print' });
  await printPage.evaluate(() => document.fonts.ready);
  expect(await printPage.locator('body').evaluate(element => getComputedStyle(element).fontSize)).toBe('24px');
  await expect(printPage.getByRole('button')).toHaveCount(0);
  const file = testInfo.outputPath('export-pagination.pdf');
  const bytes = await printPage.pdf({ path: file, preferCSSPageSize: true, printBackground: true,
    outline: true, tagged: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  expect(bytes.includes(Buffer.from('/Outlines'))).toBe(true);
  await testInfo.attach('generated-pagination-pdf', { path: file, contentType: 'application/pdf' });
  await printPage.close();
});
