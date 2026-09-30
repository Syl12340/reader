import { expect, test } from '@playwright/test';

const sample = [
  '# Heading',
  '',
  'Paragraph with **bold** text.',
  '',
  '- [ ] task',
  '',
  '$E = mc^2$',
  '',
  '![pixel](data:image/gif;base64,R0lGODlhAQABAAAAACw=)',
  '',
  'inline ![pixel](data:image/gif;base64,R0lGODlhAQABAAAAACw=) image',
  '',
  '```js',
  'const answer = 42;',
  '```',
  '',
  '```mermaid',
  'graph TD',
  '  A --> B',
  '```',
  '',
  '| Name | Value |',
  '| --- | ---: |',
  '| alpha | 1 |',
  '',
].join('\n');

async function createNewDocument(page: import('@playwright/test').Page) {
  await page.getByRole('menubar').getByRole('button', { name: '文件', exact: true }).click();
  await page.getByRole('button', { name: '新建', exact: false }).click();
  await expect(page.locator('.cm-content')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await createNewDocument(page);
});

test('uses a paper-first shell with drawer navigation and Write Source Read views', async ({ page }) => {
  await expect(page.locator('.sidebar-drawer')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open library drawer' })).toBeVisible();

  await page.getByRole('button', { name: 'Open library drawer' }).click();
  await expect(page.locator('.sidebar-drawer')).toBeVisible();
  const sidebarPresentation = await page.locator('.sidebar-drawer').evaluate(element => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      position: style.position,
      borderRadius: style.borderRadius,
      boxShadow: style.boxShadow,
      left: Math.round(rect.left),
      height: Math.round(rect.height),
      viewportHeight: window.innerHeight,
    };
  });
  expect(sidebarPresentation.position).toBe('relative');
  expect(sidebarPresentation.borderRadius).toBe('0px');
  expect(sidebarPresentation.boxShadow).toBe('none');
  expect(sidebarPresentation.left).toBe(0);
  expect(sidebarPresentation.height).toBeGreaterThan(sidebarPresentation.viewportHeight - 90);
  await expect(page.getByRole('button', { name: 'Files', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Outline', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeVisible();

		await page.getByRole('button', { name: 'Hide library sidebar' }).click();
  await expect(page.locator('.sidebar-drawer')).toHaveCount(0);

  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.insertText('# Shell\n\nA quiet paragraph.');

  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.locator('[data-editor-mode="source"]')).toBeVisible();
  await expect(page.locator('.cm-gutters .cm-lineNumbers')).toBeVisible();
  const modeSwitcherPlacement = await page.locator('.status-mode-switcher').evaluate(element => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      viewportWidth: window.innerWidth,
      position: getComputedStyle(element).position,
    };
  });
  expect(modeSwitcherPlacement.position).toBe('static');
  expect(modeSwitcherPlacement.left).toBeGreaterThan(modeSwitcherPlacement.viewportWidth * 0.55);

  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await expect(page.locator('.preview-container')).toContainText('Shell');
  const readPresentation = await page.locator('.preview-container').evaluate(element => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      lineHeight: Number.parseFloat(style.lineHeight),
      fontFamily: style.fontFamily,
    };
  });
  expect(readPresentation.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(readPresentation.lineHeight).toBeGreaterThan(24);
  expect(readPresentation.fontFamily).not.toMatch(/monospace|Consolas|JetBrains Mono|Cascadia Code/i);

  await page.getByRole('button', { name: 'Write', exact: true }).click();
  await expect(page.locator('[data-editor-mode="wysiwym"]')).toBeVisible();
});

test('does not overlay the empty placeholder on a single-line document', async ({ page }) => {
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.insertText('plain single line');
  await expect(page.locator('.cm-line')).toHaveText('plain single line');

  const writeBeforeContent = await page.locator('.cm-line').first().evaluate(element =>
    getComputedStyle(element, '::before').content,
  );
  expect(writeBeforeContent).not.toContain('开始写作');
  expect(writeBeforeContent).not.toContain('Start writing');

  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.locator('[data-editor-mode="source"]')).toBeVisible();
  const sourceBeforeContent = await page.locator('.cm-line').first().evaluate(element =>
    getComputedStyle(element, '::before').content,
  );
  expect(sourceBeforeContent).not.toContain('开始写作');
  expect(sourceBeforeContent).not.toContain('Start writing');
});

test('keeps document state across editor modes', async ({ page }) => {
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.insertText(sample);
  await page.keyboard.press('Control+Home');

  await expect(page.locator('.cm-task-widget')).toBeVisible();
  await expect(page.locator('.cm-math-widget')).toBeVisible();
  await expect(page.locator('.cm-image-widget.cm-block-widget')).toBeVisible();
  await expect(page.locator('.cm-image-widget.cm-inline-widget')).toBeVisible();
  await expect(page.locator('.cm-code-widget')).toBeVisible();
  await expect(page.locator('.cm-mermaid-widget')).toBeVisible();
  await expect(page.locator('.cm-table-widget')).toBeVisible();
  const immersiveFont = await page.locator('.cm-content').evaluate(element =>
    getComputedStyle(element).fontFamily,
  );
  expect(immersiveFont).not.toMatch(/monospace|Consolas|JetBrains Mono|Cascadia Code/i);
  const immersiveHeading = await page.locator('.cm-heading-1').first().evaluate(element => {
    const style = getComputedStyle(element);
    return {
      textDecoration: style.textDecorationLine,
      fontWeight: Number.parseInt(style.fontWeight, 10),
    };
  });
  expect(immersiveHeading.textDecoration).toBe('none');
  expect(immersiveHeading.fontWeight).toBeGreaterThanOrEqual(600);

  await page.getByRole('button', { name: 'Source' }).click();
  await expect(page.locator('[data-editor-mode="source"]')).toBeVisible();
  await expect(page.locator('.cm-content')).toContainText('const answer = 42;');
  await expect(page.locator('.cm-content')).toContainText('**bold**');
  await expect(page.locator('.cm-content')).toContainText('![pixel]');
  await expect(page.locator('.cm-gutters .cm-lineNumbers')).toBeVisible();
  await expect(page.locator('.cm-task-widget')).toHaveCount(0);
  await expect(page.locator('.cm-math-widget')).toHaveCount(0);
  await expect(page.locator('.cm-image-widget')).toHaveCount(0);
  await expect(page.locator('.cm-code-widget')).toHaveCount(0);
  await expect(page.locator('.cm-mermaid-widget')).toHaveCount(0);
  await expect(page.locator('.cm-table-widget')).toHaveCount(0);
  await expect(page.locator('.cm-heading-1')).toHaveCount(0);
  await expect(page.locator('.cm-bold')).toHaveCount(0);
  const sourcePresentation = await page.locator('.cm-line').first().evaluate(element => {
    const style = getComputedStyle(element);
    return {
      fontFamily: style.fontFamily,
      fontWeight: Number.parseInt(style.fontWeight, 10),
      textDecoration: style.textDecorationLine,
      highlightedSpans: document.querySelectorAll('.cm-content span[class*="ͼ"]').length,
    };
  });
  expect(sourcePresentation.fontFamily).toMatch(/monospace|Consolas|JetBrains Mono|Cascadia Code/i);
  expect(sourcePresentation.fontWeight).toBeLessThan(600);
  expect(sourcePresentation.textDecoration).toBe('none');
  expect(sourcePresentation.highlightedSpans).toBe(0);
  const sourceViewportPresentation = await page.locator('.cm-line').evaluateAll(elements =>
    elements.slice(0, 12).map(element => {
      const style = getComputedStyle(element as HTMLElement);
      return {
        fontSize: Number.parseFloat(style.fontSize),
        fontWeight: Number.parseInt(style.fontWeight, 10),
        textDecoration: style.textDecorationLine,
        textTransform: style.textTransform,
      };
    }),
  );
  expect(Math.max(...sourceViewportPresentation.map(item => item.fontSize))).toBeLessThanOrEqual(16);
  expect(Math.max(...sourceViewportPresentation.map(item => item.fontWeight))).toBeLessThan(600);
  expect(sourceViewportPresentation.every(item => item.textDecoration === 'none')).toBe(true);
  expect(sourceViewportPresentation.every(item => item.textTransform === 'none')).toBe(true);

  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await expect(page.locator('.preview-container')).toContainText('Heading');

  await page.getByRole('button', { name: 'Write' }).click();
  await expect(page.locator('[data-editor-mode="wysiwym"]')).toBeVisible();
  await expect(page.locator('.cm-task-widget')).toBeVisible();
});

test('updates task source through a CodeMirror transaction', async ({ page }) => {
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.insertText('- [ ] task\n\ncursor');
  await page.keyboard.press('Control+End');

  const checkbox = page.locator('.cm-task-widget');
  await expect(checkbox).toBeVisible();
  await checkbox.check();
  await page.getByRole('button', { name: 'Source' }).click();
  await expect(page.locator('.cm-content')).toContainText('[x] task');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.cm-content')).toContainText('[ ] task');
});

test('opens slash menu and edits a table widget', async ({ page }) => {
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.insertText(`${sample}\n\n/table`);
  await expect(page.getByRole('listbox', { name: '插入内容' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: '选择表格大小' })).toBeVisible();
  await expect(page.locator('.table-picker-cell[data-row="0"][data-col="0"]')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+Home');
  await expect(page.locator('.cm-table-widget')).toHaveCount(2);

  const editTable = page.getByRole('button', { name: '编辑表格' }).first();
  await expect(editTable).toBeVisible();
  await editTable.click();
  await expect(page.getByRole('dialog', { name: '表格编辑器' })).toBeVisible();
  await page.getByLabel('第 1 行第 1 列').fill('beta');
  await page.getByRole('button', { name: '应用' }).click();
  await page.getByRole('button', { name: 'Source' }).click();
  await expect(page.locator('.cm-content')).toContainText('| beta | 1 |');
});

test('shows Markdown markers for a cross-node selection', async ({ page }) => {
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.insertText('**one** and *two*');
  await expect(page.locator('.cm-hidden-marker').first()).toBeAttached();

  await page.keyboard.press('Control+a');
  await expect(page.locator('.cm-hidden-marker')).toHaveCount(0);

  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.cm-hidden-marker').first()).toBeAttached();
});

test('restores cursor, history, mode, and widgets after tab switches', async ({ page }) => {
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.insertText(sample);
  await page.keyboard.press('Control+Home');
  await page.getByRole('button', { name: 'Source' }).click();

  await page.keyboard.press('Control+n');
  await page.locator('.cm-content').click();
  await page.keyboard.insertText('# Second tab');
  await expect(page.getByRole('tab')).toHaveCount(2);

  await page.getByRole('tab').nth(0).click();
  await expect(page.locator('[data-editor-mode="source"]')).toBeVisible();
  await page.locator('.cm-content').focus();
  await page.keyboard.insertText('X');
  await expect(page.locator('.cm-content')).toContainText('X# Heading');
  await page.keyboard.press('Control+z');
  await expect(page.locator('.cm-content')).not.toContainText('X# Heading');

  await page.getByRole('button', { name: 'Write' }).click();
  await page.keyboard.press('Control+Home');
  await expect(page.locator('.cm-task-widget')).toBeVisible();
});

test('keeps browser fallback free of Tauri API calls', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.reload();
  await createNewDocument(page);
  expect(errors.filter(message => message.includes('Tauri'))).toEqual([]);
});

test('keeps render failures editable', async ({ page }) => {
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.insertText([
    '![missing](/definitely-missing-reader-image.png)',
    '',
    '$\\notARealCommand{$',
    '',
    '```mermaid',
    'not a valid diagram',
    '```',
    '',
    'cursor',
  ].join('\n'));
  await page.keyboard.press('Control+End');

  await expect(page.locator('.cm-image-widget .cm-widget-error')).toContainText(
    '/definitely-missing-reader-image.png',
  );
  await expect(page.locator('.cm-math-widget.cm-widget-error')).toBeVisible();
  await expect(page.locator('.cm-mermaid-widget .cm-widget-error')).toBeVisible({
    timeout: 15_000,
  });

  await page.getByRole('button', { name: '编辑路径' }).click();
  await expect(page.locator('.cm-content')).toContainText('definitely-missing-reader-image.png');
});

test('accepts input and switches modes in a 500KB document', async ({ page }) => {
  test.slow();
  const editor = page.locator('.cm-content');
  const largeDocument = `${'plain text for performance\n'.repeat(21_000)}tail`;
  expect(largeDocument.length).toBeGreaterThan(500_000);

  await editor.click();
  await page.evaluate((text) => {
    window.dispatchEvent(new CustomEvent('editor-replace-range', {
      detail: { from: 0, to: 0, text }
    }));
  }, largeDocument);
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('-marker');
  await expect(page.locator('.cm-content')).toContainText('tail-marker');

  await page.getByRole('button', { name: 'Source' }).click();
  await page.getByRole('button', { name: 'Write' }).click();
  await expect(page.locator('[data-editor-mode="wysiwym"]')).toBeVisible();
  await expect(page.locator('.cm-content')).toContainText('tail-marker');
});

test('uses one scroll container and renders the current viewport after mode switches', async ({ page }) => {
  const editor = page.locator('.cm-content');
  const longDocument = [
    ...Array.from({ length: 240 }, (_, index) => `paragraph ${index}`),
    '',
    '- [ ] viewport task',
    '',
    '| Name | Value |',
    '| --- | ---: |',
    '| near-end | 1 |',
    '',
    'tail anchor',
  ].join('\n');

  await editor.click();
  await page.keyboard.insertText(longDocument);
  await page.keyboard.press('Control+End');

  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.locator('.cm-gutters .cm-lineNumbers')).toBeVisible();

  const sourceMetrics = await page.evaluate(() => {
    const pane = document.querySelector<HTMLElement>('.editor-pane')!;
    const wrapper = document.querySelector<HTMLElement>('.cm-editor-wrapper')!;
    const scroller = document.querySelector<HTMLElement>('.cm-scroller')!;
    scroller.scrollTop = scroller.scrollHeight;
    return {
      paneOverflow: pane.scrollHeight - pane.clientHeight,
      wrapperOverflow: wrapper.scrollHeight - wrapper.clientHeight,
      scrollerOverflow: scroller.scrollHeight - scroller.clientHeight,
    };
  });
  expect(sourceMetrics.paneOverflow).toBeLessThanOrEqual(1);
  expect(sourceMetrics.wrapperOverflow).toBeLessThanOrEqual(1);
  expect(sourceMetrics.scrollerOverflow).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Write', exact: true }).click();
  await expect(page.locator('.cm-gutters .cm-lineNumbers')).toHaveCount(0);
  await expect(page.locator('.cm-task-widget')).toBeVisible();
  await expect(page.locator('.cm-table-widget')).toBeVisible();
  await expect(page.locator('.cm-content')).toContainText('tail anchor');
});

test('keeps immersive and source content on the same reading grid', async ({ page }) => {
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.insertText('# Layout heading\n\nparagraph');
  await page.keyboard.press('Control+End');

  const immersiveLayout = await page.evaluate(() => {
    const pane = document.querySelector<HTMLElement>('.editor-pane')!.getBoundingClientRect();
    const heading = document.querySelector<HTMLElement>('.cm-heading-1')!.getBoundingClientRect();
    const lineElement = document.querySelector<HTMLElement>('.cm-line')!;
    const content = document.querySelector<HTMLElement>('.cm-content')!;
    return {
      headingLeft: heading.left,
      expectedLeft: pane.left + Math.max(34, (pane.width - 760) / 2),
      linePadding: getComputedStyle(lineElement).paddingLeft,
      contentPaddingTop: Number.parseFloat(getComputedStyle(content).paddingTop) || 0,
      contentPaddingBottom: Number.parseFloat(getComputedStyle(content).paddingBottom) || 0,
      viewportHeight: window.innerHeight,
    };
  });
  expect(Math.abs(immersiveLayout.headingLeft - immersiveLayout.expectedLeft)).toBeLessThan(40);
  expect(immersiveLayout.linePadding).not.toContain('cqi');
  expect(immersiveLayout.contentPaddingTop).toBeGreaterThanOrEqual(32);
  expect(immersiveLayout.contentPaddingBottom).toBeGreaterThan(immersiveLayout.viewportHeight * 0.45);

  await page.getByRole('button', { name: 'Source', exact: true }).click();
  const sourceLayout = await page.evaluate(() => {
    const pane = document.querySelector<HTMLElement>('.editor-pane')!.getBoundingClientRect();
    const lineElement = document.querySelector<HTMLElement>('.cm-line')!;
    const content = document.querySelector<HTMLElement>('.cm-content')!;
    const line = lineElement.getBoundingClientRect();
    const gutters = document.querySelector<HTMLElement>('.cm-gutters')!.getBoundingClientRect();
    const linePadding = Number.parseFloat(getComputedStyle(lineElement).paddingLeft) || 0;
    const contentStyle = getComputedStyle(content);
    return {
      textLeft: line.left + linePadding,
      expectedLeft: pane.left + gutters.width + Math.max(34, (pane.width - 760) / 2),
      contentPaddingTop: Number.parseFloat(contentStyle.paddingTop) || 0,
      contentPaddingBottom: Number.parseFloat(contentStyle.paddingBottom) || 0,
      viewportHeight: window.innerHeight,
    };
  });
  expect(Math.abs(sourceLayout.textLeft - sourceLayout.expectedLeft)).toBeLessThan(40);
  expect(sourceLayout.contentPaddingTop).toBeGreaterThanOrEqual(32);
  expect(sourceLayout.contentPaddingTop).toBeLessThanOrEqual(80);
  expect(sourceLayout.contentPaddingBottom).toBeGreaterThan(sourceLayout.viewportHeight * 0.45);
});
