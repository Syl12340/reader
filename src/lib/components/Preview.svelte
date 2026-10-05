<script lang="ts">
  import { get } from 'svelte/store';
  import { selectionText, selectionSource, cursorPosition } from '$lib/stores/editor-ui';
  import { activeSessionId, sessions, fileContent, updateSessionPreviewScroll } from '$lib/stores/document';
  import { theme } from '$lib/stores/theme';
  import { setEditorMode } from '$lib/stores/ui';
  import FloatingTOC from './FloatingTOC.svelte';
  import { patchPreviewHtml } from '$lib/utils/dom-patch';
  import { clearPreviewMatch, highlightPreviewMatch } from '$lib/utils/preview-match';
  import { RenderService } from '$lib/services/render';
  import { NavigationService } from '$lib/services/navigation';
  import { focusMode } from '$lib/stores/ui';
  import { readingLine } from '$lib/stores/editor-ui';
  import type { EditorRevealRequest } from '$lib/types';
  import { captureReadingAnchor, restoreReadingAnchor, type ReadingAnchor } from '$lib/utils/reading-anchor';
  import { notify } from '$lib/services/interaction';
  import { installFigureControls } from '$lib/utils/figure';
  import { renderFormula } from '$lib/utils/latex';

  let { content, showFloatingOutline = true }: { content: string; showFloatingOutline?: boolean } = $props();

  let previewContainer: HTMLDivElement | undefined = $state();
  let latestSelectionText = '';
  let latestSelectionSource: 'editor' | 'preview' | null = null;
  let lastRenderedSessionId: string | null = null;
  let renderRevision = 0;
  let previewScrollTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingPreviewScroll: { id: string; scrollTop: number; anchor?: ReadingAnchor } | null = null;
  let restoringPreviewScroll = false;
  let searchRequest: EditorRevealRequest | null = null;
  let selecting = false;
  let scrollFrame = 0;
  let restoreFrame = 0;
  let queuedPreviewScroll: { id: string | null; scrollTop: number } | null = null;
  let figureObserver: IntersectionObserver | null = null;
  const visibleFigures = new WeakSet<Element>();

  function cancelPreviewRestoration(): void {
    if (restoreFrame) cancelAnimationFrame(restoreFrame);
    restoreFrame = 0;
    restoringPreviewScroll = false;
  }

  function drainPreviewScroll(container = previewContainer): void {
    if (scrollFrame) {
      cancelAnimationFrame(scrollFrame);
      scrollFrame = 0;
      capturePreviewScroll(queuedPreviewScroll?.id ?? lastRenderedSessionId, false, queuedPreviewScroll?.scrollTop, container);
    }
    queuedPreviewScroll = null;
    flushPreviewScroll();
  }

  function flushPreviewScroll(): void {
    if (previewScrollTimer) {
      clearTimeout(previewScrollTimer);
      previewScrollTimer = null;
    }
    if (!pendingPreviewScroll) return;
    updateSessionPreviewScroll(pendingPreviewScroll.id, pendingPreviewScroll.scrollTop, pendingPreviewScroll.anchor);
    pendingPreviewScroll = null;
  }

  function escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function previewInteractions(node: HTMLDivElement) {
    if (typeof IntersectionObserver !== 'undefined') {
      figureObserver = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            visibleFigures.add(entry.target);
            void renderFigureBlocks(renderRevision, [entry.target as HTMLElement]);
          } else visibleFigures.delete(entry.target);
        }
      }, { root: node, rootMargin: '300px' });
    }
    const observer = new ResizeObserver(() => {
      if (restoringPreviewScroll || selecting || scrollFrame || !node.isConnected || get(activeSessionId) !== lastRenderedSessionId) return;
      const session = get(sessions).find(item => item.id === lastRenderedSessionId);
      const pending = pendingPreviewScroll?.id === session?.id ? pendingPreviewScroll : null;
      restoreReadingAnchor(node, pending?.anchor ?? session?.previewAnchor, pending?.scrollTop ?? session?.previewScrollTop ?? 0);
    });
    const mutations = new MutationObserver(() => {
      observer.disconnect();
      for (const child of node.children) observer.observe(child);
    });
    mutations.observe(node, { childList: true });
    const startSelection = (event: PointerEvent) => {
      cancelPreviewRestoration();
      if (event.button === 0 && event.target instanceof Element && !event.target.closest('a, button, input, select, textarea')) selecting = true;
    };
    const endSelection = () => { if (!selecting) return; selecting = false; handlePreviewScroll(); };
    const userScroll = () => cancelPreviewRestoration();
    node.addEventListener('pointerdown', startSelection);
    node.addEventListener('wheel', userScroll, { passive: true });
    node.addEventListener('touchstart', userScroll, { passive: true });
    node.addEventListener('keydown', userScroll);
    window.addEventListener('pointerup', endSelection);
    window.addEventListener('pointercancel', endSelection);
    node.addEventListener('scroll', handlePreviewScroll);
    node.addEventListener('mouseup', handlePreviewSelection);
    node.addEventListener('keyup', handlePreviewSelection);
    node.addEventListener('click', handlePreviewClick);
    node.addEventListener('dblclick', handleDoubleClick);
    return {
      destroy() {
        figureObserver?.disconnect(); figureObserver = null;
        observer.disconnect(); mutations.disconnect();
        selecting = false;
        node.removeEventListener('pointerdown', startSelection);
        window.removeEventListener('pointerup', endSelection); window.removeEventListener('pointercancel', endSelection);
        drainPreviewScroll(node);
        cancelPreviewRestoration();
        node.removeEventListener('wheel', userScroll);
        node.removeEventListener('touchstart', userScroll);
        node.removeEventListener('keydown', userScroll);
        node.removeEventListener('scroll', handlePreviewScroll);
        node.removeEventListener('mouseup', handlePreviewSelection);
        node.removeEventListener('keyup', handlePreviewSelection);
        node.removeEventListener('click', handlePreviewClick);
        node.removeEventListener('dblclick', handleDoubleClick);
        renderRevision++;
        highlightSeqId++;
        if (highlightTimer) clearTimeout(highlightTimer);
        pendingHighlights.clear();
      },
    };
  }

  // content 已经是完整渲染后的 HTML（由 +page.svelte 的渲染流水线处理）
  $effect(() => {
    // 读取 content 以建立依赖
    const _content = content;
    if (!previewContainer) return;
    const activeId = $activeSessionId;
    const sessionChanged = activeId !== lastRenderedSessionId;
    if (sessionChanged) {
      drainPreviewScroll();
      cancelPreviewRestoration();
      selecting = false;
      renderRevision++;
      highlightSeqId++;
      pendingHighlights.clear();
      searchRequest = null;
      restoringPreviewScroll = true;
    }
    const revision = renderRevision;
    lastRenderedSessionId = activeId;
    if (!_content) {
      previewContainer.replaceChildren();
    } else {
      const { changedRoots } = patchPreviewHtml(previewContainer, _content, sessionChanged);
      addCopyButtons(changedRoots);
      handleImages(changedRoots);
      for (const error of elementsWithin(changedRoots, '.reader-math-error')) {
        if (error.querySelector('button')) continue;
        const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = '编辑公式';
        error.append(edit);
      }
      void renderLatexBlocks(revision, changedRoots);
      scheduleFigures(changedRoots);
      highlightCodeBlocks(changedRoots);
      const selectedText = latestSelectionSource === 'editor' ? latestSelectionText : '';
      if (selectedText) highlightSelection(selectedText, false);
      if (searchRequest && searchRequest.sessionId === activeId) showSearchMatch(searchRequest, false);
    }

    if (sessionChanged) {
      const session = get(sessions).find(item => item.id === activeId);
      const nextScrollTop = session?.previewScrollTop ?? 0;
      restoreFrame = requestAnimationFrame(() => {
        restoreFrame = 0;
        if (!previewContainer || get(activeSessionId) !== activeId || revision !== renderRevision) return;
        restoreReadingAnchor(previewContainer, session?.previewAnchor, nextScrollTop);
        restoringPreviewScroll = false;
      });
    }
  });

  // 主题变化时重新高亮
  $effect(() => {
    const _theme = $theme;
    if (!previewContainer) return;
    highlightCodeBlocks();
    scheduleFigures();
  });

  // 监听大纲/搜索的行跳转事件
  $effect(() => {
    if (!previewContainer) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ line: number; sessionId?: string }>).detail;
      if (detail?.line && (!detail.sessionId || detail.sessionId === get(activeSessionId))) scrollTo(detail.line);
    };
    window.addEventListener('heading-click', handler);
    return () => window.removeEventListener('heading-click', handler);
  });

  $effect(() => {
    if (!previewContainer) return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<EditorRevealRequest>).detail;
      if (detail?.sessionId === get(activeSessionId)) {
        searchRequest = detail;
        showSearchMatch(detail);
      }
    };
    const clear = () => { searchRequest = null; if (previewContainer) clearPreviewMatch(previewContainer); };
    window.addEventListener('editor-reveal-range', handler);
    window.addEventListener('preview-search-clear', clear);
    return () => { window.removeEventListener('editor-reveal-range', handler); window.removeEventListener('preview-search-clear', clear); };
  });

  function showSearchMatch(request: EditorRevealRequest, scroll = true) {
    if (!previewContainer) return;
    if (scroll) cancelPreviewRestoration();
    const node = request.to > request.from ? highlightPreviewMatch(previewContainer, get(fileContent), request.from, request.to,
      source => RenderService.render(source)) : null;
    if (scroll) { if (node) node.scrollIntoView({ block: 'center' }); else scrollTo(request.line); }
  }

  async function handlePreviewClick(event: Event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const mathError = target.closest<HTMLElement>('.reader-math-error');
    if (mathError) { editFigureSource(mathError); return; }
    const link = target.closest<HTMLAnchorElement>('a[href]');
    if (link && previewContainer?.contains(link)) {
      event.preventDefault();
      await NavigationService.open(link.getAttribute('href') || '');
      return;
    }

    const copyButton = target.closest<HTMLButtonElement>('.copy-button');
    if (copyButton && previewContainer?.contains(copyButton)) {
      const codeBlock = copyButton.closest('.code-block') || copyButton.closest('pre');
      const code = codeBlock?.querySelector('code');
      if (!code) return;
      if (copyButton.disabled) return;
      copyButton.disabled = true;
      try {
        await navigator.clipboard.writeText(code.textContent || '');
        copyButton.textContent = '已复制';
        window.setTimeout(() => {
          if (copyButton.isConnected) copyButton.textContent = '复制';
        }, 2000);
      } catch (err) {
        console.warn('Copy code failed:', err);
        notify('复制代码失败，请检查系统剪贴板权限或手动选择代码。');
      } finally { if (copyButton.isConnected) copyButton.disabled = false; }
      return;
    }
    if (target instanceof HTMLInputElement && target.type === 'checkbox') event.preventDefault();
  }

  // 双击定位源码行
  function handleDoubleClick(event: MouseEvent) {
    if (!event.altKey) return;
    const target = event.target as HTMLElement;
    if (!target) return;

    // 向上查找带 data-line 的元素
    let el: HTMLElement | null = target;
    while (el && !el.getAttribute('data-line')) {
      el = el.parentElement;
    }

    const lineAttr = el?.getAttribute('data-line');
    if (lineAttr) {
      event.preventDefault();
      const line = parseInt(lineAttr) + 1; // data-line 是 0-indexed
      cursorPosition.set({ line, column: 1 });
      setEditorMode('wysiwym');
      window.dispatchEvent(new CustomEvent('heading-click', { detail: { line } }));
    }
  }

  // 异步高亮代码块（Shiki）— 带序列 ID 防止竞态
  let highlightTimer: ReturnType<typeof setTimeout> | null = null;
  let highlightSeqId = 0;
  type HighlightJob = { theme: 'light' | 'dark'; sequence: number };
  const pendingHighlights = new Map<Element, HighlightJob>();
  const highlightJobs = new WeakMap<Element, HighlightJob>();
  const figureJobs = new WeakMap<Element, { code: string; theme: 'light' | 'dark' }>();
  let highlighting = false;

  function elementsWithin(roots: HTMLElement[] | undefined, selector: string): Element[] {
    if (!roots) return previewContainer ? Array.from(previewContainer.querySelectorAll(selector)) : [];
    return roots.flatMap(root => [
      ...(root.matches(selector) ? [root] : []),
      ...Array.from(root.querySelectorAll(selector)),
    ]);
  }

  function highlightCodeBlocks(roots?: HTMLElement[]) {
    if (!previewContainer) return;
    const requestedTheme = get(theme);
    for (const pre of elementsWithin(roots, '.code-block-pre')) {
      const previous = highlightJobs.get(pre);
      if (previous?.theme === requestedTheme && previous.sequence === highlightSeqId) continue;
      const job = { theme: requestedTheme, sequence: highlightSeqId };
      highlightJobs.set(pre, job);
      pendingHighlights.set(pre, job);
    }
    if (highlightTimer || highlighting || pendingHighlights.size === 0) return;
    highlightTimer = setTimeout(() => {
      highlightTimer = null;
      void drainHighlights();
    }, 100);
  }

  async function drainHighlights() {
    highlighting = true;
    try {
      const { highlightCode } = await import('$lib/utils/highlight');
      while (pendingHighlights.size > 0) {
        const [pre, job] = pendingHighlights.entries().next().value!;
        pendingHighlights.delete(pre);
        if (job.sequence !== highlightSeqId || !pre.isConnected || !previewContainer?.contains(pre)) continue;
        const code = pre.querySelector('code');
        if (!code) continue;
        try {
          const highlighted = await highlightCode(code.textContent || '', pre.getAttribute('data-lang') || 'text', job.theme);
          if (job.sequence !== highlightSeqId || highlightJobs.get(pre) !== job || !pre.isConnected || !previewContainer?.contains(pre)) continue;
          const template = document.createElement('template');
          template.innerHTML = highlighted;
          const newPre = template.content.firstElementChild;
          if (!newPre) continue;
          // Preserve the source node, its line metadata and its incremental identity.
          pre.replaceChildren(...Array.from(newPre.childNodes));
          pre.setAttribute('class', newPre.className);
          pre.classList.add('code-block-pre', 'code-block-highlighted');
          pre.setAttribute('style', newPre.getAttribute('style') || '');
          if (!pre.closest('.code-block')) addCopyButtonToBlock(pre);
        } catch (error) {
          if (highlightJobs.get(pre) === job) highlightJobs.delete(pre);
          console.warn('Code highlighting failed:', error);
        }
      }
    } catch (error) {
      for (const pre of pendingHighlights.keys()) highlightJobs.delete(pre);
      pendingHighlights.clear();
      console.warn('Code highlighting failed:', error);
    } finally {
      highlighting = false;
    }
  }

  function editFigureSource(container: HTMLElement) {
    if (!container.isConnected || !previewContainer?.contains(container)) return;
    const sessionId = get(activeSessionId);
    const line = Number(container.closest('[data-line]')?.getAttribute('data-line') ?? 0) + 1;
    setEditorMode('source');
    window.dispatchEvent(new CustomEvent('heading-click', { detail: { line, sessionId } }));
  }

  function scheduleFigures(roots?: HTMLElement[]) {
    for (const element of elementsWithin(roots, '[data-mermaid], [data-chart]')) {
      if (figureObserver) figureObserver.observe(element);
      if (!figureObserver || visibleFigures.has(element)) void renderFigureBlocks(renderRevision, [element as HTMLElement]);
    }
  }

  async function renderFigureBlocks(revision: number, roots?: HTMLElement[]) {
    if (!previewContainer) return;
    const containers = elementsWithin(roots, '[data-mermaid], [data-chart]');
    if (containers.length === 0) return;
    const requestedTheme = get(theme);
    for (const node of containers) {
        const container = node as HTMLElement;
        if (revision !== renderRevision || !container.isConnected || !previewContainer.contains(container)) continue;
        const chart = container.hasAttribute('data-chart');
        const encodedCode = container.getAttribute(chart ? 'data-chart' : 'data-mermaid');
        if (encodedCode === null) continue;
        const previous = figureJobs.get(container);
        if (previous?.code === encodedCode && previous.theme === requestedTheme) continue;
        const job = { code: encodedCode, theme: requestedTheme };
        figureJobs.set(container, job);
        const current = () => revision === renderRevision && figureJobs.get(container) === job
          && get(theme) === requestedTheme && container.isConnected && !!previewContainer?.contains(container);
        let code = encodedCode;
        try {
          code = decodeURIComponent(encodedCode);
          let svg: string;
          let title = 'Mermaid 图表';
          let table: (() => string) | undefined;
          if (chart) {
            const engine = await import('$lib/utils/data-chart');
            if (!current()) continue;
            try {
              title = engine.parseDataChart(code).title;
              svg = engine.renderDataChart(code, requestedTheme);
              table = () => engine.renderChartTable(code);
            } catch (error) { svg = engine.renderChartError(code, error); }
          } else {
            const { renderMermaid } = await import('$lib/utils/mermaid');
            if (!current()) continue;
            svg = await renderMermaid(code, requestedTheme);
          }
          if (!current()) continue;
          container.innerHTML = svg;
          installFigureControls(container, { title, source: code, table, edit: () => editFigureSource(container) });
        } catch (error) {
          if (!current()) continue;
          container.textContent = '图形加载失败，源码仍可编辑。';
          const pre = document.createElement('pre'); pre.textContent = code; container.append(pre);
          installFigureControls(container, { title: '图形', source: code, edit: () => editFigureSource(container) });
          console.warn('Figure rendering failed:', error);
        }
    }
  }

  // 渲染 LaTeX 代码块（```latex / ```math）
  async function renderLatexBlocks(revision: number, roots?: HTMLElement[]) {
    if (!previewContainer) return;

    const latexContainers = elementsWithin(roots, '.latex-code-block');
    if (latexContainers.length === 0) return;

    try {
      if (revision !== renderRevision || !previewContainer) return;

      for (const container of latexContainers) {
        if (revision !== renderRevision || !previewContainer) return;
        if (!container.isConnected || !previewContainer.contains(container)) continue;
        const encodedCode = container.getAttribute('data-latex');
        if (!encodedCode) continue;

        let code = encodedCode;
        try {
          code = decodeURIComponent(encodedCode);
          if (revision !== renderRevision || !container.isConnected) return;
          container.innerHTML = renderFormula(code, true);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'LaTeX rendering failed';
          container.innerHTML = `<span class="katex-error" title="${escapeHtml(message)}">${escapeHtml(code)}</span>`;
        }
        container.removeAttribute('data-latex');
      }
    } catch (err) {
      console.warn('LaTeX code block rendering failed:', err);
    }
  }

  // 添加代码复制按钮
  function addCopyButtons(roots?: HTMLElement[]) {
    if (!previewContainer) return;
    const codeBlocks = elementsWithin(roots, '.code-block, pre');
    codeBlocks.forEach(block => {
      if (block.matches('pre') && block.closest('.code-block')) return;
      addCopyButtonToBlock(block);
    });
  }

  // 为单个代码块添加复制按钮
  function addCopyButtonToBlock(block: Element) {
    if (block.querySelector('.copy-button')) return;

    const button = document.createElement('button');
    button.className = 'copy-button';
    button.textContent = '复制';

    // 设置代码块为相对定位
    (block as HTMLElement).style.position = 'relative';
    block.appendChild(button);
  }

  // 处理图片
  function handleImages(roots?: HTMLElement[]) {
    if (!previewContainer) return;
    const images = elementsWithin(roots, 'img') as HTMLImageElement[];
    images.forEach(img => {
      const showLoaded = () => {
        img.style.opacity = '1';
        img.removeAttribute('title');
      };
      const showFailed = () => {
        img.style.opacity = '0.5';
        img.title = '图片加载失败';
      };
      img.onload = () => {
        showLoaded();
      };
      img.onerror = () => {
        showFailed();
      };
      img.style.transition = 'opacity 0.3s';
      if (img.complete) {
        if (img.naturalWidth > 0) showLoaded();
        else showFailed();
      } else {
        img.style.opacity = '0';
      }
    });
  }

  function clearSelectionHighlight() {
    if (!previewContainer) return;
    const marks = previewContainer.querySelectorAll('mark.selection-highlight');
    marks.forEach(mark => {
      const parent = mark.parentNode;
      if (!parent) return;
      const textNode = document.createTextNode(mark.textContent || '');
      parent.replaceChild(textNode, mark);
      if (parent instanceof HTMLElement) {
        parent.normalize();
      }
    });
  }

  function highlightSelection(text: string, scroll = true) {
    if (!previewContainer || !text) return;
    if (scroll) cancelPreviewRestoration();
    const currentMark = previewContainer.querySelector('mark.selection-highlight');
    if (currentMark?.textContent === text) {
      if (scroll) currentMark.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
      return;
    }
    clearSelectionHighlight();

    const walker = document.createTreeWalker(
      previewContainer,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node.nodeValue || !node.nodeValue.includes(text)) return NodeFilter.FILTER_SKIP;
          const parent = (node as Text).parentElement;
          if (parent?.closest('code, pre, .katex, .katex-display')) return NodeFilter.FILTER_SKIP;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const found = walker.nextNode() as Text | null;
    if (!found || !found.nodeValue) return;

    const index = found.nodeValue.indexOf(text);
    if (index === -1) return;

    const before = found.nodeValue.slice(0, index);
    const after = found.nodeValue.slice(index + text.length);
    const parent = found.parentNode;
    if (!parent) return;

    const beforeNode = before ? document.createTextNode(before) : null;
    const mark = document.createElement('mark');
    mark.className = 'selection-highlight';
    mark.textContent = text;
    const afterNode = after ? document.createTextNode(after) : null;

    parent.replaceChild(mark, found);
    if (beforeNode) parent.insertBefore(beforeNode, mark);
    if (afterNode) parent.insertBefore(afterNode, mark.nextSibling);

    if (scroll) mark.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
  }

  function scrollBehavior(): ScrollBehavior { return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'; }

  // 滚动到指定位置
  export function scrollTo(line: number) {
    if (!previewContainer) return;
    cancelPreviewRestoration();

    const sourceLine = Math.max(0, line - 1);
    let closest: Element | null = null;
    let closestLine = -1;
    for (const element of previewContainer.querySelectorAll('[data-line]')) {
      const mappedLine = Number(element.getAttribute('data-line'));
      if (Number.isFinite(mappedLine) && mappedLine <= sourceLine && mappedLine > closestLine) {
        closest = element;
        closestLine = mappedLine;
      }
    }
    if (closest) {
      closest.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
      return;
    }

    // 查找对应的元素
    const elements = previewContainer.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, pre, blockquote');
    let currentLine = 0;

    for (const element of elements) {
      const text = element.textContent || '';
      const lines = text.split('\n').length;

      if (currentLine + lines >= line) {
        element.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
        break;
      }

      currentLine += lines;
    }
  }

  // 获取滚动位置百分比
  export function getScrollPercentage(): number {
    if (!previewContainer) return 0;

    const scrollTop = previewContainer.scrollTop;
    const scrollHeight = previewContainer.scrollHeight - previewContainer.clientHeight;

    return scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;
  }

  // 设置滚动位置百分比
  export function setScrollPercentage(percentage: number) {
    if (!previewContainer) return;
    cancelPreviewRestoration();

    const scrollHeight = previewContainer.scrollHeight - previewContainer.clientHeight;
    previewContainer.scrollTop = (percentage / 100) * scrollHeight;
  }

  // 预览滚动时同步到 store（编辑器会跟着动）
  function handlePreviewScroll() {
    queuedPreviewScroll = { id: lastRenderedSessionId, scrollTop: previewContainer?.scrollTop ?? 0 };
    if (!scrollFrame) scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      const queued = queuedPreviewScroll;
      queuedPreviewScroll = null;
      if (queued) capturePreviewScroll(queued.id, true, queued.scrollTop);
    });
  }

  function capturePreviewScroll(id = get(activeSessionId), publishLine = true, queuedTop?: number, container = previewContainer) {
    if (!container || restoringPreviewScroll) return;
    if (!id || id !== lastRenderedSessionId) return;
    const session = get(sessions).find(item => item.id === id);
    if (!session) return;
    if (publishLine && id === get(activeSessionId) && container.isConnected) {
      const top = container.getBoundingClientRect().top + 80;
      let line = 1;
      for (const node of container.querySelectorAll<HTMLElement>('[data-line]')) {
        if (node.getBoundingClientRect().top > top) break;
        const mapped = Number(node.dataset.line);
        if (Number.isInteger(mapped) && mapped >= 0) line = mapped + 1;
      }
      readingLine.set(line);
    }
    const scrollTop = container.isConnected ? container.scrollTop : queuedTop ?? container.scrollTop;
    const previous = pendingPreviewScroll?.id === id ? pendingPreviewScroll : null;
    const oldAnchor = previous?.anchor ?? session.previewAnchor;
    // Detached DOM has no usable rectangles; carry the last anchor by the queued scroll delta.
    const anchor = container.isConnected ? captureReadingAnchor(container)
      : oldAnchor ? { ...oldAnchor, offset: oldAnchor.offset + scrollTop - (previous?.scrollTop ?? session.previewScrollTop ?? 0) } : undefined;
    pendingPreviewScroll = { id, scrollTop, anchor };
    if (previewScrollTimer) clearTimeout(previewScrollTimer);
    previewScrollTimer = setTimeout(() => {
      previewScrollTimer = null;
      flushPreviewScroll();
    }, 120);
  }

  function handlePreviewSelection() {
    if (!previewContainer) return;
    if (get(focusMode)) {
      previewContainer.querySelectorAll('.preview-focus-block').forEach(node => node.classList.remove('preview-focus-block'));
      const anchor = window.getSelection()?.anchorNode;
      const element = anchor instanceof Element ? anchor : anchor?.parentElement;
      element?.closest('p, li, pre, table, blockquote, h1, h2, h3, h4, h5, h6, .katex-display, .mermaid-container')?.classList.add('preview-focus-block');
    }
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      selectionText.set('');
      selectionSource.set(null);
      clearSelectionHighlight();
      return;
    }

    const anchor = selection.anchorNode;
    const focus = selection.focusNode;
    if (!anchor || !focus || !previewContainer.contains(anchor) || !previewContainer.contains(focus)) {
      selectionText.set('');
      selectionSource.set(null);
      clearSelectionHighlight();
      return;
    }

    const text = selection.toString().trim();
    if (!text) {
      selectionText.set('');
      selectionSource.set(null);
      clearSelectionHighlight();
      return;
    }
    selectionText.set(text);
    selectionSource.set('preview');
  }

  $effect(() => {
    const value = $selectionText;
    latestSelectionText = value;
    if (latestSelectionSource === 'editor' && value) {
      highlightSelection(value);
    } else if (!value) {
      clearSelectionHighlight();
    }
  });

  $effect(() => {
    const source = $selectionSource;
    latestSelectionSource = source;
    if (source === 'editor' && latestSelectionText) {
      highlightSelection(latestSelectionText);
    }
  });
</script>

<div class="preview-wrapper" class:focus-mode={$focusMode}>
  {#if showFloatingOutline}<FloatingTOC />{/if}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (Scrollable reading content needs keyboard scrolling and restored search focus.) -->
  <div
    bind:this={previewContainer}
    use:previewInteractions
    class="preview-container markdown-body"
    role="document"
    aria-label="Markdown 预览"
    tabindex="0"
  ></div>

  {#if !content}
    <div class="preview-empty flex flex-col items-center justify-center h-full p-6 text-[var(--text-tertiary)]">
      <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="mb-4 opacity-50">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="16" y1="13" x2="8" y2="13"></line>
        <line x1="16" y1="17" x2="8" y2="17"></line>
        <polyline points="10 9 9 9 8 9"></polyline>
      </svg>
      <p class="text-lg">开始输入 Markdown 内容</p>
      <p class="text-sm mt-2">支持 Markdown 语法、LaTeX 数学公式、代码高亮</p>
    </div>
  {/if}
</div>
<style>
  .preview-wrapper {
    position: relative;
    height: 100%;
    background: var(--doc-paper-bg, var(--doc-bg));
  }

  .preview-empty {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .preview-container {
    height: 100%;
    max-width: none;
    margin: 0;
    overflow-y: auto;
    font-family: var(--font-content);
    line-height: var(--reader-line-height, var(--doc-line-height, 1.75));
    padding-top: 48px;
    padding-bottom: 60vh;
    padding-left: max(34px, calc((100% - var(--doc-content-width, 760px)) / 2));
    padding-right: max(34px, calc((100% - var(--doc-content-width, 760px)) / 2));
    font-size: var(--reader-font-size, var(--doc-font-size, 16px));
    background: var(--doc-paper-bg, var(--doc-bg));
    cursor: text;
    user-select: text;
    -webkit-user-select: text;
  }

  .preview-container :global(*) {
    user-select: text;
    -webkit-user-select: text;
  }

  .preview-container :global(button),
  .preview-container :global(input),
  .preview-container :global(select),
  .preview-container :global(textarea) {
    user-select: none;
    -webkit-user-select: none;
  }

  .preview-container :global(.katex-display) {
    margin: 1em 0;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 0.5em 0;
  }

  .preview-container :global(.katex) {
    font-size: 1.1em;
  }

  .preview-container :global(.katex-error) {
    color: var(--syntax-error);
    background: color-mix(in srgb, var(--syntax-error) 8%, var(--doc-code-bg));
    padding: 0.2em 0.4em;
    border-radius: 3px;
    font-family: monospace;
  }

  .preview-container :global(mark.selection-highlight) {
    background: var(--accent-color);
    color: white;
    padding: 0 2px;
    border-radius: 2px;
  }

  .preview-container :global(.code-block) {
    position: relative;
    margin: 1.2em 0;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--doc-table-border) 44%, transparent);
    border-radius: 4px;
    background: color-mix(in srgb, var(--doc-code-bg) 88%, transparent);
  }

  .preview-container :global(.code-header) {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.42em 0.9em;
    background: transparent;
    border-bottom: 1px solid color-mix(in srgb, var(--doc-table-border) 36%, transparent);
    font-size: 0.85em;
    color: var(--text-secondary);
  }

  .preview-container :global(.code-language) {
    font-weight: 500;
  }

  .preview-container :global(.copy-button) {
    padding: 0.25em 0.5em;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 0.85em;
    transition: all 0.2s;
  }

  .preview-container :global(.copy-button:hover) {
    background: color-mix(in srgb, var(--doc-code-bg) 72%, var(--doc-paper-bg, var(--doc-bg)));
    border-color: color-mix(in srgb, var(--doc-table-border) 54%, transparent);
    color: var(--doc-text);
  }

  .preview-container :global(pre) {
    margin: 0;
    border: 0;
    border-radius: 0;
  }

  .preview-container :global(img) {
    max-width: 100%;
    height: auto;
    border-radius: 4px;
    box-shadow: none;
  }

  .preview-container :global(a) {
    color: var(--link-color);
    text-decoration: none;
    border-bottom: 1px solid transparent;
    transition: border-color 0.2s;
  }

  .preview-container :global(a:hover) {
    border-bottom-color: var(--link-color);
  }

  .preview-container :global(table) {
    width: 100%;
    border-collapse: collapse;
    margin: 1.35em 0;
    font-size: 0.96em;
  }

  .preview-container :global(th),
  .preview-container :global(td) {
    border: 1px solid color-mix(in srgb, var(--doc-table-border) 72%, transparent);
    padding: 0.4em 0.7em;
    text-align: left;
  }

  .preview-container :global(th) {
    background: color-mix(in srgb, var(--doc-code-bg) 54%, transparent);
    font-weight: 600;
  }

  .preview-container :global(tr:nth-child(even)) {
    background: transparent;
  }

  .preview-container :global(blockquote) {
    border-left: 3px solid color-mix(in srgb, var(--doc-quote-border) 78%, transparent);
    padding-left: 1em;
    margin: 1.15em 0;
    color: var(--doc-text-muted);
  }

  .preview-container :global(blockquote p:last-child) {
    margin-bottom: 0;
  }

  .preview-container :global(hr) {
    border: none;
    border-top: 1px solid var(--doc-subtle-rule);
    margin: 2em 0;
  }

</style>
