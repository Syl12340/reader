import { expect, test, type Page } from '@playwright/test';

async function newDocument(page: Page, source: string) {
  await page.getByRole('menubar').getByRole('menuitem', { name: '文件', exact: true }).click();
  await page.getByRole('menuitem', { name: '新建', exact: false }).click();
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.evaluate(text => window.dispatchEvent(new CustomEvent('editor-replace-range', { detail: { from: 0, to: 0, text } })), source);
  await page.keyboard.press('Control+Home');
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('showSingleTab', 'true'));
  await page.goto('/');
});

test('reopens find and highlights repeated words precisely in Read', async ({ page }) => {
  await newDocument(page, '# Title\n\nneedle **needle** needle');
  await page.getByRole('button', { name: '阅读', exact: true }).click();
  await page.keyboard.press('Control+f');
  const search = page.getByPlaceholder('搜索', { exact: true });
  await search.fill('needle');
  await expect(page.locator('.match-count')).toHaveText('1/3');
  await expect(page.locator('.preview-search-match')).toHaveText('needle');
  await search.press('Enter');
  await expect(page.locator('.match-count')).toHaveText('2/3');
  await expect(page.locator('strong .preview-search-match')).toHaveText('needle');
  await search.press('Escape');
  await expect(page.locator('.preview-search-match')).toHaveCount(0);
  await page.keyboard.press('Control+f');
  await expect(page.locator('.match-count')).toHaveText('1/3');
  await expect(page.locator('.preview-search-match')).toHaveText('needle');
});

test('shows semantic lists and quotes only in Write', async ({ page }) => {
  await newDocument(page, 'Title\n=====\n\n> quote\n\n- item\n  - nested\n\nend');
  await expect(page.locator('.cm-quote-line')).toBeVisible();
  await expect(page.locator('.cm-list-bullet')).toHaveCount(2);
  await expect(page.locator('.cm-heading-1').first()).toBeVisible();
  await page.getByRole('button', { name: '源码', exact: true }).click();
  await expect(page.locator('.cm-list-bullet')).toHaveCount(0);
  await expect(page.locator('.cm-content')).toContainText('> quote');
  await expect(page.locator('.cm-content')).toContainText('- nested');
});

test('edits tables in place, pastes TSV, and undoes the entire edit', async ({ page }) => {
  await newDocument(page, '# Table\n\n| Name | Value |\n| --- | --- |\n| **alpha** | $x^2$ |\n\nend');
  await expect(page.locator('.cm-table-widget strong')).toHaveText('alpha');
  await expect(page.locator('.cm-table-widget .katex')).toBeVisible();
  await page.locator('.cm-table-widget [data-cell="1:0"]').click();
  const input = page.locator('.cm-table-cell-input');
  await input.fill('beta');
  await input.press('Tab');
  await expect(page.locator('.cm-table-widget [data-cell="1:0"]')).toHaveText('beta');
  await expect(page.locator('.cm-table-widget [data-cell="1:1"]')).toBeFocused();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.cm-table-widget strong')).toHaveText('alpha');
  await page.locator('.cm-table-widget [data-cell="1:0"]').click();
  await input.evaluate(element => {
    const transfer = new DataTransfer(); transfer.setData('text/plain', 'first\t1\nsecond\t2');
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('.cm-table-widget [data-cell="2:0"]')).toHaveText('second');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.cm-table-widget strong')).toHaveText('alpha');
});

test('keeps asynchronous image paste attached to its original tab', async ({ page }) => {
  await newDocument(page, 'original');
  await page.locator('.cm-content').click();
  await page.evaluate(() => {
    const read = FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL = function(blob) { setTimeout(() => read.call(this, blob), 600); };
    const transfer = new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), c => c.charCodeAt(0))], 'pixel.gif', { type: 'image/gif' }));
    document.querySelector('.cm-content')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  });
  await page.keyboard.press('Control+n');
  await expect(page.locator('.tab-item')).toHaveCount(2);
  await page.waitForTimeout(800);
  await expect(page.locator('.cm-image-widget')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+Tab');
  await page.getByRole('button', { name: '源码', exact: true }).click();
  await expect(page.locator('.cm-content')).toContainText('data:image/gif;base64,');
});

test('opens Unicode document anchors without leaving Reader', async ({ page }) => {
  await newDocument(page, '# 中文标题\n\n[jump](#中文标题)\n\n# 中文标题\n\nend');
  await page.getByRole('button', { name: '阅读', exact: true }).click();
  await expect(page.locator('.preview-container h1')).toHaveCount(2);
  await expect(page.locator('[id="中文标题-1"]')).toBeVisible();
  await page.getByRole('link', { name: 'jump' }).click();
  await expect(page.locator('.tab-item')).toHaveCount(1);
  expect(page.url()).not.toContain('#');
});

test('quick open and keyboard tabs preserve each document mode', async ({ page }) => {
  await newDocument(page, 'first document');
  await page.getByRole('button', { name: '源码', exact: true }).click();
  await newDocument(page, 'second document');
  await page.keyboard.press('Control+Shift+Tab');
  await expect(page.locator('[data-editor-mode="source"]')).toBeVisible();
  await page.keyboard.press('Control+Shift+o');
  await expect(page.getByRole('dialog', { name: '快速打开文件' })).toBeVisible();
  await page.getByRole('dialog', { name: '快速打开文件' }).getByRole('combobox').press('ArrowDown');
  await page.getByRole('dialog', { name: '快速打开文件' }).getByRole('combobox').press('Enter');
  await expect(page.getByRole('dialog', { name: '快速打开文件' })).toHaveCount(0);
  await expect(page.locator('.cm-content')).toContainText('second document');
  await expect(page.locator('[data-editor-mode="wysiwym"]')).toBeVisible();
});
