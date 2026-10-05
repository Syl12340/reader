import { expect, test, type Page } from '@playwright/test';

async function newDocument(page: Page, source: string) {
  await page.getByRole('menubar').getByRole('menuitem', { name: '文件', exact: true }).click();
  await page.getByRole('menuitem', { name: '新建', exact: false }).click();
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.evaluate(text => window.dispatchEvent(new CustomEvent('editor-replace-range', { detail: { from: 0, to: 0, text } })), source);
  await page.keyboard.press('Control+Home');
}

test.beforeEach(async ({ page }) => { await page.goto('/'); });

test('manual formatting toolbar only appears on demand and restores selection', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('floatingToolbar', 'manual'));
  await page.reload();
  await newDocument(page, 'selected text');
  await page.locator('.cm-content').focus();
  await page.keyboard.press('Control+a');
  await expect(page.locator('.floating-toolbar')).toHaveCount(0);
  await page.keyboard.press('Alt+.');
  await expect(page.locator('.floating-toolbar')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.floating-toolbar')).toHaveCount(0);
  await expect(page.locator('.cm-content')).toBeFocused();
});

test('resource properties preserve link title and participate in undo', async ({ page }) => {
  await newDocument(page, '[old](#heading "title")\n\n# heading');
  await page.locator('.cm-content').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Alt+Enter');
  const dialog = page.getByRole('dialog', { name: '链接属性' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('链接文字').fill('new label');
  await dialog.getByRole('button', { name: '应用', exact: true }).click();
  await page.getByRole('button', { name: '源码', exact: true }).click();
  await expect(page.locator('.cm-content')).toContainText('[new label](<#heading> "title")');
  await page.locator('.cm-content').focus();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.cm-content')).toContainText('[old](#heading "title")');
});

test('focus preference persists and display zoom leaves document font setting unchanged', async ({ page }) => {
  await newDocument(page, '# Zoom\n\nparagraph');
  await page.getByRole('menubar').getByRole('menuitem', { name: '视图', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: '专注模式', exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem('focusMode'))).toBe('true');
  await page.getByRole('menubar').getByRole('menuitem', { name: '视图', exact: true }).click();
  await page.getByRole('menuitem', { name: '放大显示', exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem('fontSize'))).toBe('16');
  expect(await page.evaluate(() => localStorage.getItem('displayZoom'))).toBe('110');
  await expect(page.getByRole('button', { name: '110%', exact: true })).toBeVisible();
});

test('outline filters and locates without changing document selection', async ({ page }) => {
  await newDocument(page, '# First\n\nparagraph\n\n## Second\n\nend');
  await page.getByRole('button', { name: '显示侧栏', exact: true }).click();
  await page.getByRole('tab', { name: '大纲', exact: true }).click();
  await page.getByLabel('筛选大纲标题').fill('Second');
  await expect(page.locator('.outline-item')).toHaveCount(1);
  await page.getByRole('button', { name: '定位', exact: true }).click();
  await expect(page.getByLabel('筛选大纲标题')).toHaveValue('');
  await expect(page.locator('.outline-item')).toHaveCount(2);
});

test('composition keeps inactive markers stable until completion', async ({ page }) => {
  await newDocument(page, 'start\n\n**bold**\n\nend');
  await page.locator('.cm-content').focus();
  const before = await page.locator('.cm-hidden-marker').count();
  await page.locator('.cm-content').dispatchEvent('compositionstart', { data: '' });
  await page.keyboard.press('Control+End');
  await expect(page.locator('.cm-hidden-marker')).toHaveCount(before);
  await page.locator('.cm-content').dispatchEvent('compositionend', { data: '' });
  await expect(page.locator('.cm-content')).toBeVisible();
});

test('dragging selection does not rebuild hidden markers before pointer release', async ({ page }) => {
  await newDocument(page, 'start **bold** end\n\nother');
  const line = page.locator('.cm-line').first();
  const points = await line.evaluate(element => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, { acceptNode: node =>
      node.parentElement?.closest('.cm-hidden-marker') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    const nodes: Text[] = []; while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    const range = document.createRange(); range.selectNodeContents(nodes[0]); const first = range.getBoundingClientRect();
    range.selectNodeContents(nodes.at(-1)!); const last = range.getBoundingClientRect();
    return { from: first.left + 1, to: last.right - 1, y: first.top + first.height / 2 };
  });
  const before = await page.locator('.cm-hidden-marker').count();
  await page.mouse.move(points.from, points.y);
  await page.mouse.down();
  await page.mouse.move(points.to, points.y, { steps: 6 });
  await expect(page.locator('.cm-hidden-marker')).toHaveCount(before);
  await expect(page.locator('.floating-toolbar')).toHaveCount(0);
  await page.mouse.up();
  await expect(page.locator('.floating-toolbar')).toBeVisible();
});

test('keyboard tab sorting preserves the active document', async ({ page }) => {
  await newDocument(page, 'first'); await newDocument(page, 'second');
  const active = page.locator('.tab-item.active');
  const id = await active.getAttribute('data-session-id');
  await active.focus(); await active.press('Alt+Shift+ArrowLeft');
  await expect(page.locator('.tab-item').first()).toHaveAttribute('data-session-id', id!);
  await expect(page.locator('.cm-content')).toContainText('second');
});

test('cancels image preparation without downloading a partial document', async ({ page }) => {
  await page.route('https://reader-test.invalid/slow.png', async route => {
    await new Promise(resolve => setTimeout(resolve, 2000));
    await route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('not an image') }).catch(() => {});
  });
  await newDocument(page, 'start\n\n![slow](https://reader-test.invalid/slow.png)\n\nend');
  const downloads: string[] = []; page.on('download', download => downloads.push(download.suggestedFilename()));
  await page.getByTestId('file-menu-trigger').click();
  await page.getByTestId('export-menu-trigger').hover();
  await page.getByTestId('export-submenu').locator('[data-export-format="html"]').click();
  await page.getByRole('button', { name: '取消导出', exact: true }).click();
  await expect(page.getByRole('button', { name: '取消导出', exact: true })).toHaveCount(0);
  expect(downloads).toHaveLength(0);
  await expect(page.locator('.cm-content')).toContainText('start');
});
