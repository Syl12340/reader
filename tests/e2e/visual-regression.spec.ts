import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const showcase = readFileSync(
  resolve(process.cwd(), 'tests/fixtures/visual-showcase.md'),
  'utf8',
);

async function openShowcase(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('menubar').getByRole('menuitem', { name: '文件', exact: true }).click();
  await page.getByRole('menuitem', { name: '新建', exact: false }).click();
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.evaluate((text) => {
    window.dispatchEvent(new CustomEvent('editor-replace-range', {
      detail: { from: 0, to: 0, text },
    }));
  }, showcase);
  await page.keyboard.press('Control+Home');
  await expect(page.locator('.cm-code-widget')).toBeVisible();
  await expect(page.locator('.cm-table-widget')).toBeVisible();
  await expect(page.locator('.cm-mermaid-widget')).toBeVisible({ timeout: 15_000 });
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
        caret-color: transparent !important;
      }
    `,
  });
}

test.use({ viewport: { width: 1366, height: 768 } });

test('matches the Typora light document baseline', async ({ page }) => {
  await openShowcase(page);
  await expect(page).toHaveScreenshot('typora-light.png', {
    animations: 'disabled',
    fullPage: false,
  });
});

test('matches the Typora dark source baseline', async ({ page }) => {
  await openShowcase(page);
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('theme', 'dark');
  });
  await page.getByRole('button', { name: '源码', exact: true }).click();
  await expect(page.locator('[data-editor-mode="source"]')).toBeVisible();
  await expect(page.locator('.cm-content').getByText('https://example.com', { exact: true })).toHaveCSS('color', 'rgb(123, 169, 226)');
  await expect(page).toHaveScreenshot('typora-dark-source.png', {
    animations: 'disabled',
    fullPage: false,
  });
});

test('matches the Typora outline reading baseline', async ({ page }) => {
  await openShowcase(page);
  await page.getByRole('button', { name: '显示侧栏' }).click();
  await page.getByRole('tab', { name: '大纲', exact: true }).click();
  await page.getByRole('button', { name: '阅读', exact: true }).click();
  await expect(page.locator('.preview-container .katex')).not.toHaveCount(0);
  await expect(page).toHaveScreenshot('typora-outline-read.png', { animations: 'disabled', fullPage: false });
});

test('matches the narrow find panel baseline', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 800 });
  await openShowcase(page);
  await page.getByRole('button', { name: '源码', exact: true }).click();
  await page.keyboard.press('Control+h');
  await page.getByPlaceholder('搜索', { exact: true }).fill('paragraph');
  await expect(page.getByRole('dialog', { name: '搜索替换' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page).toHaveScreenshot('typora-narrow-find.png', { animations: 'disabled', fullPage: false });
});
