import { expect, test, type Page } from '@playwright/test';
import { installBrowserWorkspace, openBrowserWorkspace } from './helpers/browser-workspace';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('showSingleTab', 'true'));
});

async function documentWith(page: Page, source: string) {
  await page.goto('/');
  await page.getByRole('menubar').getByRole('menuitem', { name: '文件', exact: true }).click();
  await page.getByRole('menuitem', { name: '新建', exact: false }).click();
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.evaluate(text => window.dispatchEvent(new CustomEvent('editor-replace-range', { detail: { from: 0, to: 0, text } })), source);
  await page.keyboard.press('Control+Home');
}

test('keeps independent undo histories when a pending cursor flush coincides with a tab switch', async ({ page }) => {
  await documentWith(page, 'First');
  await page.keyboard.press('Control+End'); await page.keyboard.insertText(' edit');
  await page.keyboard.press('Control+n');
  await expect(page.locator('.tab-item')).toHaveCount(2);
  await page.keyboard.insertText('Second');
  await page.locator('.tab-item').nth(0).click();
  await expect(page.locator('.cm-content')).toHaveText('First edit');
  await page.evaluate(() => {
    const first = document.querySelector<HTMLElement>('.tab-item.active')!;
    window.dispatchEvent(new CustomEvent('editor-reveal-range', { detail: {
      sessionId: first.dataset.sessionId, from: 2, to: 2, line: 1,
    } }));
    document.querySelectorAll<HTMLElement>('.tab-item')[1].click();
  });
  await expect(page.locator('.cm-content')).toHaveText('Second');
  await page.locator('.tab-item').nth(0).click();
  await expect(page.locator('.cm-content')).toHaveText('First edit');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.cm-content')).toHaveText('First');
  await page.locator('.tab-item').nth(1).click();
  await expect(page.locator('.cm-content')).toHaveText('Second');
});

test('activates the tab close button with Enter rather than selecting its parent tab', async ({ page }) => {
  await documentWith(page, 'keep'); await page.keyboard.press('Control+n');
  await expect(page.locator('.tab-item')).toHaveCount(2);
  const close = page.locator('.tab-item.active .tab-close');
  await close.focus(); await close.press('Enter');
  await expect(page.locator('.tab-item')).toHaveCount(1);
  await expect(page.locator('.cm-content')).toHaveText('keep');
});

test('exposes checked editor modes and returns focus to the visible document', async ({ page }) => {
  await documentWith(page, '# Modes');
  const trigger = page.getByRole('menubar').getByRole('menuitem', { name: '视图', exact: true });
  await trigger.click();
  await expect(page.getByRole('menuitemradio', { name: '写作', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('menuitemradio', { name: '源码', exact: true }).click();
  await expect(page.locator('[data-editor-mode="source"]')).toBeVisible();
  await expect(page.locator('.cm-content')).toBeFocused();
  await trigger.click();
  await expect(page.getByRole('menuitemradio', { name: '源码', exact: true })).toHaveAttribute('aria-checked', 'true');
  await trigger.press('Escape');
  await expect(trigger).toBeFocused();
});

test('saves the last preview scroll frame before a tab replaces the rendered document', async ({ page }) => {
  await documentWith(page, Array.from({ length: 150 }, (_, index) => `Paragraph ${index}\n`).join('\n'));
  await page.getByRole('button', { name: '阅读', exact: true }).click();
  await expect(page.locator('.preview-container')).toContainText('Paragraph 0');
  await page.keyboard.press('Control+n');
  await expect(page.locator('.tab-item')).toHaveCount(2);
  await page.locator('.tab-item').nth(0).click();
  const preview = page.locator('.preview-container');
  await expect(preview).toBeVisible();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.evaluate(() => {
    const preview = document.querySelector<HTMLElement>('.preview-container')!;
    preview.scrollTop = 800;
    preview.dispatchEvent(new Event('scroll'));
    document.querySelectorAll<HTMLElement>('.tab-item')[1].click();
  });
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.locator('.tab-item').nth(0).click();
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate(node => node.scrollTop)).toBeGreaterThan(750);
});

test('edits an existing link destination without nesting the Markdown', async ({ page }) => {
  await documentWith(page, '[label](https://example.org "title")');
  await page.getByRole('button', { name: '源码', exact: true }).click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Control+k');
  await page.keyboard.insertText('https://changed.example');
  await expect(page.locator('.cm-content')).toHaveText('[label](https://changed.example "title")');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.cm-content')).toHaveText('[label](https://example.org "title")');
});

test('shows active formatting and toggles underscores through the keyboard toolbar', async ({ page }) => {
  await documentWith(page, '__word__');
  await page.getByRole('button', { name: '源码', exact: true }).click();
  await page.keyboard.press('Control+Home'); await page.keyboard.press('Control+a');
  const toolbar = page.getByRole('toolbar', { name: 'Markdown 格式' });
  await expect(toolbar).toBeVisible();
  await expect(toolbar.getByRole('button', { name: '粗体', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Alt+.');
  await expect(toolbar.getByRole('button', { name: '粗体', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.cm-content')).toHaveText('word');
  await expect(page.locator('.cm-content')).toBeFocused();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.cm-content')).toHaveText('__word__');
});

test('navigates the mode group without losing its focus and restores the document on activation', async ({ page }) => {
  await documentWith(page, '# Keyboard modes');
  const group = page.getByRole('group', { name: '文档视图', exact: true });
  await group.getByRole('button', { name: '写作', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(group.getByRole('button', { name: '源码', exact: true })).toBeFocused();
  await expect(page.locator('[data-editor-mode="source"]')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(group.getByRole('button', { name: '阅读', exact: true })).toBeFocused();
  await expect(page.locator('.preview-container')).toBeVisible();
  await page.keyboard.press('Home');
  await expect(group.getByRole('button', { name: '写作', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.cm-content')).toBeFocused();
});

test('filters live file names without losing refreshed entries or hierarchy', async ({ page }) => {
  await installBrowserWorkspace(page, { 'notes/alpha.md': '# Alpha', 'notes/beta.md': '# Beta' });
  await documentWith(page, 'draft'); await openBrowserWorkspace(page);
  await page.getByRole('button', { name: '筛选文件名' }).click();
  const input = page.getByRole('textbox', { name: '筛选文件名' });
  await expect(input).toBeFocused(); await input.fill('alpha');
  await expect(page.locator('.file-tree-item').filter({ hasText: 'notes' })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.file-tree-item').filter({ hasText: 'alpha.md' })).toBeVisible();
  await expect(page.locator('.file-tree-item').filter({ hasText: 'beta.md' })).toHaveCount(0);
  await page.evaluate(() => {
    delete window.readerTestFs.files['notes/alpha.md']; window.readerTestFs.files['notes/gamma.md'] = '# Gamma';
  });
  await page.getByRole('button', { name: '刷新文件树', exact: true }).click();
  await expect(page.getByText('没有匹配的文件', { exact: true })).toBeVisible({ timeout: 10_000 });
  await input.press('Escape');
  await page.locator('.file-tree-item').filter({ hasText: 'notes' }).click();
  await expect(page.locator('.file-tree-item').filter({ hasText: 'gamma.md' })).toBeVisible();
  await expect(page.locator('.file-tree-item').filter({ hasText: 'alpha.md' })).toHaveCount(0);
});

test('cancels a slow quick-open request without creating a tab or stealing focus', async ({ page }) => {
  await installBrowserWorkspace(page, { 'slow.md': '# Old result' });
  await documentWith(page, 'draft'); await openBrowserWorkspace(page);
  await page.locator('.cm-content').click();
  await page.evaluate(() => window.readerTestFs.delayed.add('slow.md'));
  await page.keyboard.press('Control+Shift+o');
  const query = page.getByRole('dialog', { name: '快速打开文件' }).getByRole('combobox'); await query.fill('slow'); await query.press('Enter');
  await expect(page.getByRole('dialog', { name: '快速打开文件' })).toHaveAttribute('aria-busy', 'true');
  await expect.poll(() => page.evaluate(() => window.readerTestFs.pending.has('slow.md'))).toBe(true);
  await query.press('Escape');
  await expect(page.locator('.cm-content')).toBeFocused();
  await page.evaluate(() => window.readerTestFs.finish('slow.md'));
  await expect(page.locator('.tab-item')).toHaveCount(1);
  await expect(page.locator('.cm-content')).toHaveText('draft');
});

test('keeps the selected quick-open file when a refreshed index inserts a higher-ranked result', async ({ page }) => {
  await installBrowserWorkspace(page, { 'folder/notes-a.md': '# Alpha', 'folder/notes-b.md': '# Beta' });
  await documentWith(page, 'draft'); await openBrowserWorkspace(page);
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+Shift+o');
  const query = page.getByRole('dialog', { name: '快速打开文件' }).getByRole('combobox'); await query.fill('note');
  await expect(page.getByRole('option')).toHaveCount(2);
  await query.press('ArrowDown');
  await expect(page.locator('.quick-open [aria-selected="true"]')).toContainText('notes-b.md');
  await page.evaluate(() => { window.readerTestFs.files['folder/note.md'] = '# New'; });
  await page.getByRole('button', { name: '刷新索引', exact: true }).click();
  await expect(page.getByRole('option')).toHaveCount(3);
  await expect(page.locator('.quick-open [aria-selected="true"]')).toContainText('notes-b.md');
  await query.focus(); await query.press('Enter');
  await expect(page.locator('.tab-item.active')).toContainText('notes-b.md');
  await expect(page.locator('.cm-content')).toContainText('Beta');
});

test('supports quick-open paging, clear-search focus and unsaved indicators', async ({ page }) => {
  await installBrowserWorkspace(page, Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`note-${index}.md`, `# Note ${index}`])));
  await documentWith(page, 'unsaved draft'); await openBrowserWorkspace(page);
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+Shift+o');
  const query = page.getByRole('dialog', { name: '快速打开文件' }).getByRole('combobox');
  await expect(page.getByRole('option').first()).toContainText('未保存');
  await query.fill('note'); await expect(page.getByRole('option')).toHaveCount(20);
  await query.press('PageUp');
  await expect(page.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
  await query.press('PageDown');
  await expect(page.getByRole('option').first()).toHaveAttribute('aria-selected', 'false');
  await query.fill('no-matching-file');
  await expect(page.getByRole('option')).toHaveCount(0);
  await page.getByRole('button', { name: '清除文件搜索', exact: true }).click();
  await expect(query).toBeFocused(); await expect(query).toHaveValue('');
  await expect(page.getByRole('option')).toHaveCount(21);
  await query.press('Escape'); await expect(page.locator('.cm-content')).toBeFocused();
});

test('keeps the last sidebar click when an earlier file read finishes later', async ({ page }) => {
  await installBrowserWorkspace(page, { 'slow.md': '# Slow', 'fast.md': '# Fast' });
  await documentWith(page, 'draft'); await openBrowserWorkspace(page);
  await page.evaluate(() => window.readerTestFs.delayed.add('slow.md'));
  await page.locator('.file-tree-item').filter({ hasText: 'slow.md' }).click();
  await expect.poll(() => page.evaluate(() => window.readerTestFs.pending.has('slow.md'))).toBe(true);
  await page.locator('.file-tree-item').filter({ hasText: 'fast.md' }).click();
  await expect(page.locator('.cm-content')).toContainText('Fast');
  await page.evaluate(() => window.readerTestFs.finish('slow.md'));
  await expect(page.locator('.tab-item')).toHaveCount(2);
  await expect(page.locator('.tab-item.active')).toContainText('fast.md');
});

test('replaces regex captures consistently and does not hijack editing while find is open', async ({ page }) => {
  await documentWith(page, 'alpha-1 beta-2');
  await page.keyboard.press('Control+h');
  await page.getByPlaceholder('搜索', { exact: true }).fill('([a-z]+)-(\\d+)');
  await page.getByTitle('正则表达式', { exact: true }).click();
  await page.getByPlaceholder('替换', { exact: true }).fill('$1:$2');
  await page.getByRole('button', { name: '替换', exact: true }).click();
  await expect(page.locator('.cm-content')).toHaveText('alpha:1 beta-2');
  const editor = page.locator('.cm-content'); await editor.click();
  await page.keyboard.press('Control+End'); await page.keyboard.insertText(' end');
  await expect(editor).toBeFocused(); await expect(editor).toContainText('end');
  await page.getByPlaceholder('搜索', { exact: true }).focus(); await page.keyboard.press('Escape');
  await expect(editor).toBeFocused();
  await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
  await expect(editor).toHaveText('alpha-1 beta-2');
});

test('uses safe keyboard focus and Escape cancellation in the unsaved-close dialog', async ({ page }) => {
  await documentWith(page, 'keep this draft'); await page.locator('.cm-content').click();
  await page.keyboard.press('Control+w');
  const dialog = page.getByRole('dialog', { name: '未保存变更' });
  await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await expect(page.locator('.cm-content')).toBeFocused(); await expect(page.locator('.cm-content')).toHaveText('keep this draft');
});

test('focuses the visible Read surface after quick-open switches away from Write', async ({ page }) => {
  await documentWith(page, '# Reading tab');
  await page.getByRole('button', { name: '阅读', exact: true }).click();
  await page.keyboard.press('Control+n');
  await expect(page.locator('.cm-content')).toBeVisible(); await page.locator('.cm-content').click();
  await page.keyboard.press('Control+Shift+o'); await page.getByRole('dialog', { name: '快速打开文件' }).getByRole('combobox').press('Enter');
  const preview = page.locator('.preview-container');
  await expect(preview).toBeVisible(); await expect(preview).toBeFocused();
  await page.keyboard.press('Control+f'); await page.getByPlaceholder('搜索', { exact: true }).fill('Reading');
  await page.keyboard.press('Escape'); await expect(preview).toBeFocused();
});

test('preserves outline folding after inserting text before a heading and supports keyboard tabs', async ({ page }) => {
  await documentWith(page, '# Parent\n\n## Child\n\nend');
  await page.getByRole('button', { name: '显示侧栏' }).click();
  const files = page.getByRole('tab', { name: '文件', exact: true });
  await files.focus(); await files.press('ArrowRight');
  await expect(page.getByRole('tab', { name: '大纲', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '折叠 Parent', exact: true }).click();
  await expect(page.locator('.outline-item').filter({ hasText: 'Child' })).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('editor-replace-range', { detail: { from: 0, to: 0, text: 'intro\n\n' } })));
  await expect(page.getByRole('button', { name: '展开 Parent', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.outline-item').filter({ hasText: 'Child' })).toHaveCount(0);
});

test('restores Setext source when the caret enters its collapsed delimiter', async ({ page }) => {
  await documentWith(page, 'Title\n=====\n\nparagraph');
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End');
  await expect(page.locator('.cm-setext-delimiter')).toHaveCount(1);
  expect(await page.locator('.cm-setext-delimiter').evaluate(node => node.getBoundingClientRect().height)).toBe(0);
  await page.keyboard.press('Control+Home'); await page.keyboard.press('ArrowDown');
  await expect(page.locator('.cm-setext-delimiter')).toHaveCount(0);
  await expect(page.locator('.cm-content')).toContainText('=====');
  await page.getByRole('button', { name: '源码', exact: true }).click();
  await expect(page.locator('.cm-content')).toHaveText('Title=====paragraph');
});

test('starts a focused F2 rename without nesting an input inside the file button', async ({ page }) => {
  await installBrowserWorkspace(page, { 'alpha.md': '# Alpha' });
  await documentWith(page, 'draft'); await openBrowserWorkspace(page);
  const file = page.locator('.file-tree-item').filter({ hasText: 'alpha.md' });
  await file.focus(); await file.press('F2');
  const rename = page.getByRole('textbox', { name: '重命名 alpha.md' });
  await expect(rename).toBeFocused();
  expect(await rename.evaluate(node => node.closest('button') === null)).toBe(true);
  await rename.press('Escape'); await expect(file).toBeFocused();
  await expect(page.locator('.tab-item')).toHaveCount(1);
});

test('renders list markers and read-only tasks without modifying Markdown', async ({ page }) => {
  await documentWith(page, '- plain\n- [ ] pending\n  - [X] completed\n\n1. ordered\n2. next');
  await page.getByRole('button', { name: '阅读', exact: true }).click();
  const preview = page.locator('.preview-container');
  await expect(preview.locator('ul').first()).toHaveCSS('list-style-type', 'disc');
  await expect(preview.locator('ol')).toHaveCSS('list-style-type', 'decimal');
  const tasks = preview.getByRole('checkbox');
  await expect(tasks).toHaveCount(2); await expect(tasks.nth(0)).toBeDisabled();
  await expect(tasks.nth(0)).not.toBeChecked(); await expect(tasks.nth(1)).toBeChecked();
  await page.getByRole('button', { name: '源码', exact: true }).click();
  await expect(page.locator('.cm-content')).toContainText('- [ ] pending');
  await expect(page.locator('.cm-content')).toContainText('- [X] completed');
});
