import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const chart = JSON.stringify({ type: 'line', title: 'Progress', labels: ['A', 'B', 'C'], series: [{ name: 'Tasks', data: [1, 3, 2] }] });
const markdown = '# Figures\n\nInline \\(x^2\\).\n\n```math\nx^2\n```\n\n```chart\n' + chart
  + '\n```\n\n```mermaid\ngraph LR\n  A --> B\n```\n\nEnd\n';

async function createDocument(page: Page, text = markdown) {
  await page.goto('/');
  await page.getByTestId('file-menu-trigger').click();
  await page.getByRole('menuitem', { name: '新建', exact: false }).click();
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.evaluate(text => window.dispatchEvent(new CustomEvent('editor-replace-range', {
    detail: { from: 0, to: 0, text },
  })), text);
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
}

test('renders formulas/charts, switches data/source, and opens an accessible zoom view', async ({ page }) => {
  await createDocument(page);
  const widget = page.locator('.cm-chart-widget');
  await expect(widget.locator('svg')).toBeVisible();
  await expect(page.locator('.cm-mermaid-widget svg')).toBeVisible();
  await expect(page.locator('.cm-math-widget .katex')).toHaveCount(2);
  await widget.hover();
  await widget.getByRole('button', { name: '数据', exact: true }).click();
  await expect(widget.locator('table')).toContainText('Tasks');
  await widget.getByRole('button', { name: '查看源码', exact: true }).click();
  await expect(widget.locator('pre')).toHaveText(chart);
  await widget.getByRole('button', { name: '图形', exact: true }).click();
  const enlarge = widget.getByRole('button', { name: '放大', exact: true });
  await enlarge.click();
  const dialog = page.getByRole('dialog', { name: 'Progress' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '放大', exact: true }).click();
  await expect(dialog.locator('output')).toHaveText('125%');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(enlarge).toBeFocused();

  await page.getByRole('button', { name: '阅读', exact: true }).click();
  const preview = page.locator('.preview-container');
  await expect(preview.locator('.reader-chart-container svg')).toBeVisible();
  await expect(preview.locator('.mermaid-container svg')).toBeVisible();
  await expect(preview.locator('.katex')).toHaveCount(2);
  const figure = preview.locator('.reader-chart-container');
  await figure.hover();
  await figure.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.locator('[data-editor-mode="source"]')).toBeVisible();
  await expect(page.locator('.cm-content')).toContainText('"type":"line"');
});

test('downloads SVG and exports static self-contained HTML with no UI controls', async ({ page }) => {
  await createDocument(page);
  const widget = page.locator('.cm-chart-widget');
  await expect(widget.locator('svg')).toBeVisible();
  await widget.hover();
  const svgDownload = page.waitForEvent('download');
  await widget.getByRole('button', { name: '导出 SVG', exact: true }).click();
  const svg = await svgDownload;
  expect(svg.suggestedFilename()).toBe('Progress.svg');
  expect((await readFile((await svg.path())!, 'utf8'))).toContain('<svg');
  await page.getByTestId('file-menu-trigger').click();
  await page.getByTestId('export-menu-trigger').hover();
  const htmlDownload = page.waitForEvent('download');
  await page.getByTestId('export-submenu').getByRole('menuitem', { name: 'HTML', exact: true }).click();
  const download = await htmlDownload;
  const html = await readFile((await download.path())!, 'utf8');
  const exported = await page.context().newPage();
  await exported.setContent(html);
  await expect(exported.locator('svg')).toHaveCount(2);
  await expect(exported.locator('.katex')).toHaveCount(2);
  await expect(exported.locator('button')).toHaveCount(0);
  await expect(exported.locator('[data-chart], [data-mermaid]')).toHaveCount(0);
  expect(html).toContain('data:font/');
  expect(html).toContain('table-header-group');
  await exported.close();
});

test('keeps failed chart/formula sources editable', async ({ page }) => {
  await createDocument(page, '# Broken\n\n$\\unknownReader{x}$\n\n```chart\n{"type":"bad"}\n```\n\nEnd\n');
  await expect(page.locator('.cm-chart-widget .reader-chart-error')).toBeVisible();
  await expect(page.locator('.cm-math-widget .reader-math-error')).toContainText('unknownReader');
  await page.getByRole('button', { name: '阅读', exact: true }).click();
  const error = page.locator('.preview-container .reader-math-error');
  await error.getByRole('button', { name: '编辑公式', exact: true }).click();
  await expect(page.locator('[data-editor-mode="source"]')).toBeVisible();
  await expect(page.locator('.cm-content')).toContainText('unknownReader');
});

test('inserts a chart from the slash menu through the editor transaction', async ({ page }) => {
  await createDocument(page, '');
  await page.keyboard.insertText('/chart');
  await expect(page.getByRole('listbox', { name: '插入内容' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('.cm-chart-widget svg')).toBeVisible();
  await page.getByRole('button', { name: '源码', exact: true }).click();
  await expect(page.locator('.cm-content')).toContainText('"type": "line"');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.cm-content')).toContainText('/chart');
});
