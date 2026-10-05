<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { EditorView, drawSelection, highlightActiveLine, highlightSpecialChars, keymap, lineNumbers, rectangularSelection, placeholder } from '@codemirror/view';
  import { Compartment, EditorState, EditorSelection, Transaction, type Extension } from '@codemirror/state';
  import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo } from '@codemirror/commands';
  import { CommandService } from '$lib/services/command';
  import { ShortcutService } from '$lib/services/shortcut';
  import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
  import {
    bracketMatching,
    HighlightStyle,
    foldGutter,
    indentOnInput,
    syntaxHighlighting,
  } from '@codemirror/language';
  import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
  import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
  import { activeSessionId, sessions, updateSessionContent, updateSessionCursor, updateSessionScroll } from '$lib/stores/document';
  import { settings } from '$lib/stores/settings';
  import { theme } from '$lib/stores/theme';
  import { editorMode, typewriterMode } from '$lib/stores/ui';
  import { cursorPosition } from '$lib/stores/editor-ui';
  import { createMarkdownDecorations } from '$lib/utils/markdown-decorations';
  import { importImage } from '$lib/utils/image-handler';
  import { DocumentService } from '$lib/services/document';
  import { NavigationService } from '$lib/services/navigation';
  import { inspectResource } from '$lib/editor/resource-request';
  import { isTauri } from '$lib/utils/platform';
  import { syntaxTree } from '@codemirror/language';
  import { isolateHistory } from '@codemirror/commands';
  import { Decoration, ViewPlugin } from '@codemirror/view';
  import { tags } from '@lezer/highlight';
  import { toggleFormat, toggleCode, toggleLinePrefix, insertLink, markdownEnter, activeFormatting, type ActiveFormatting } from '$lib/editor/commands';
  import { confirmAction, notify } from '$lib/services/interaction';
  import { slashTrigger } from '$lib/editor/slash';
  import { restoreEditorState } from '$lib/editor/session-state';
  import type { DocumentSession } from '$lib/types';

  export interface SelectionDetails {
    text: string;
    from: number;
    to: number;
    x: number;
    y: number;
    formatting: ActiveFormatting;
  }

  export interface SlashDetails {
    from: number;
    to: number;
    query: string;
    x: number;
    y: number;
  }

  let {
    onSelectionChange,
    onSlashTrigger,
    onInteraction,
  }: {
    onSelectionChange?: (details: SelectionDetails | null) => void;
    onSlashTrigger?: (details: SlashDetails | null) => void;
    onInteraction?: () => void;
  } = $props();

  let editorContainer: HTMLDivElement;
  let view: EditorView | null = null;
  let isUpdatingFromStore = false;
  let unsubscribeSettings = () => {};
  let pointerSelecting = false;
  onMount(() => {
    const release = () => {
      if (!pointerSelecting) return;
      pointerSelecting = false;
      const target = view, id = viewSessionId;
      requestAnimationFrame(() => { if (target?.dom.isConnected && view === target && viewSessionId === id) notifySelection(target); });
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    return () => { window.removeEventListener('pointerup', release); window.removeEventListener('pointercancel', release); };
  });
  let unsubscribeMode = () => {};
  let unsubscribeTheme = () => {};
  let unsubscribeActiveSession = () => {};
  let unsubscribeSessionContent = () => {};
  const commandCleanups: Array<() => void> = [];
  let presentationRevision = 0;
  let viewSessionId: string | null = null;
  let isSwitchingSession = false;
  let suppressSlashDuringScroll = false;
  let sessionStateTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingCursorState: { id: string; offset: number } | null = null;
  let pendingScrollState: { id: string; scrollTop: number; anchor?: { from: number; offset: number } } | null = null;
  let pendingSessionScroll: { id: string | null; top: number } | null = null;
  let scrollRestoreFrame: number | null = null;
  let typewriterFrame: number | null = null;
  const imageJobs = new Set<{ id: string; from: number; to: number; cancelled: boolean }>();

  async function insertImages(files: Blob[], editor: EditorView, position?: number): Promise<void> {
    const session = currentSession();
    if (!session) return;
    const selection = editor.state.selection.main;
    const job = { id: session.id, from: position ?? selection.from, to: position ?? selection.to, cancelled: false };
    imageJobs.add(job);
    try {
      if (isTauri() && !session.path) {
        if (!await confirmAction('保存后插入图片', '需要先保存文档，以便将图片放入文档旁的 assets 文件夹。现在保存？', '保存')
          || !await DocumentService.saveSession(session.id)) return;
      }
      const path = get(sessions).find(item => item.id === job.id)?.path ?? null;
      const images: string[] = [];
      for (const file of files) images.push(await importImage(file, path));
      const target = get(sessions).find(item => item.id === job.id);
      if (job.cancelled || !target || target.path !== path) return;
      const insert = images.join('\n');
      if (get(activeSessionId) === job.id && view) {
        view.dispatch({ changes: { from: job.from, to: job.to, insert },
          selection: { anchor: job.from + insert.length }, annotations: isolateHistory.of('full'), userEvent: 'input.paste' });
      } else if (target.editorState instanceof EditorState && target.editorState.doc.toString() === target.content) {
        const transaction = target.editorState.update({ changes: { from: job.from, to: job.to, insert },
          selection: { anchor: job.from + insert.length }, annotations: isolateHistory.of('full'), userEvent: 'input.paste' });
        sessions.update(list => list.map(item => item.id === job.id ? { ...item, editorState: transaction.state,
          cursorOffset: transaction.state.selection.main.head } : item));
        updateSessionContent(job.id, transaction.state.doc.toString());
      }
    } catch (error) { notify(`图片插入失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { imageJobs.delete(job); }
  }

  const focusBlocks = ViewPlugin.fromClass(class {
    decorations = Decoration.none;
    constructor(editor: EditorView) { this.build(editor); }
    update(update: import('@codemirror/view').ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) this.build(update.view);
    }
    build(editor: EditorView) {
      const areas = editor.state.selection.ranges.map(selection => {
        if (!selection.empty) return selection;
        let node = syntaxTree(editor.state).resolveInner(selection.head);
        while (node.parent && !/Paragraph|Heading|FencedCode|Table|Blockquote/.test(node.name)) node = node.parent;
        return node.name === 'Document' ? editor.state.doc.lineAt(selection.head) : node;
      });
      const lines = [];
      for (const visible of editor.visibleRanges) {
        const last = editor.state.doc.lineAt(visible.to).number;
        for (let number = editor.state.doc.lineAt(visible.from).number; number <= last; number++) {
          const line = editor.state.doc.line(number);
          if (areas.some(area => area.from <= line.to && area.to >= line.from)) lines.push(Decoration.line({ class: 'cm-focus-active' }).range(line.from));
        }
      }
      this.decorations = Decoration.set(lines, true);
    }
  }, { decorations: plugin => plugin.decorations });

  const lineNumbersCompartment = new Compartment();
  const bracketMatchingCompartment = new Compartment();
  const wordWrapCompartment = new Compartment();
  const tabSizeCompartment = new Compartment();
  const autoCloseBracketsCompartment = new Compartment();
  const decorationsCompartment = new Compartment();
  const modeAttributesCompartment = new Compartment();
  const syntaxHighlightingCompartment = new Compartment();
  const sourceHighlighting = HighlightStyle.define([
    { tag: [tags.meta, tags.processingInstruction, tags.comment, tags.contentSeparator], color: 'var(--syntax-muted)' },
    { tag: [tags.url, tags.link, tags.keyword, tags.atom, tags.bool, tags.labelName], color: 'var(--syntax-accent)' },
    { tag: [tags.string, tags.inserted, tags.typeName, tags.namespace], color: 'var(--syntax-string)' },
    { tag: [tags.number, tags.literal, tags.regexp, tags.escape], color: 'var(--syntax-literal)' },
    { tag: tags.heading, color: 'var(--doc-text)' },
    { tag: tags.strikethrough, textDecoration: 'line-through' },
    { tag: [tags.deleted, tags.invalid], color: 'var(--syntax-error)' },
  ]);

  function flushPendingSessionState(): void {
    if (sessionStateTimer !== null) {
      clearTimeout(sessionStateTimer);
      sessionStateTimer = null;
    }
    if (pendingCursorState) {
      updateSessionCursor(pendingCursorState.id, pendingCursorState.offset);
      pendingCursorState = null;
    }
    if (pendingScrollState) {
      updateSessionScroll(pendingScrollState.id, pendingScrollState.scrollTop, pendingScrollState.anchor);
      pendingScrollState = null;
    }
  }

  function scheduleSessionStateFlush(): void {
    if (sessionStateTimer !== null) clearTimeout(sessionStateTimer);
    sessionStateTimer = setTimeout(() => {
      sessionStateTimer = null;
      flushPendingSessionState();
    }, 120);
  }

  function scheduleCursorState(id: string, offset: number): void {
    pendingCursorState = { id, offset };
    scheduleSessionStateFlush();
  }

  function scheduleScrollState(id: string, scrollTop: number): void {
    const block = view?.lineBlockAtHeight(scrollTop);
    pendingScrollState = { id, scrollTop, anchor: block ? { from: block.from, offset: scrollTop - block.top } : undefined };
    scheduleSessionStateFlush();
  }

  function wrapSelection(editor: EditorView, before: string, after: string): void {
    toggleFormat(editor, before, after);
  }

  function insertLinePrefix(editor: EditorView, prefix: string): void {
    toggleLinePrefix(editor, prefix);
  }

  function smartEnter(editor: EditorView): boolean {
    return markdownEnter(editor);
  }

  function markdownKeymap(): Extension {
    return keymap.of([
      { key: 'Alt-.', run: () => {
        if (get(settings).floatingToolbar === 'off' || !view || view.state.selection.main.empty) return false;
        notifySelection(view);
        window.dispatchEvent(new Event('reader-show-format-toolbar'));
        const id = viewSessionId, target = view;
        requestAnimationFrame(() => {
          if (view === target && viewSessionId === id && get(editorMode) !== 'preview') document.querySelector<HTMLButtonElement>('.floating-toolbar button:not(:disabled)')?.focus();
        });
        return true;
      } },
      { key: 'Alt-Enter', run: editor => inspectResource(editor, editor.state.selection.main.head) },
      { key: 'Mod-b', run: editor => (wrapSelection(editor, '**', '**'), true) },
      { key: 'Mod-i', run: editor => (wrapSelection(editor, '*', '*'), true) },
      { key: 'Mod-Shift-x', run: editor => (wrapSelection(editor, '~~', '~~'), true) },
      {
        key: 'Mod-Shift-k',
        run(editor) {
          toggleCode(editor);
          return true;
        },
      },
      {
        key: 'Mod-k',
        run(editor) {
          insertLink(editor);
          return true;
        },
      },
      ...[1, 2, 3, 4, 5, 6].map(level => ({
        key: `Mod-Shift-${level}`,
        run(editor: EditorView) {
          insertLinePrefix(editor, `${'#'.repeat(level)} `);
          return true;
        },
      })),
      { key: 'Enter', run: smartEnter },
    ]);
  }

  function currentSession() {
    const id = get(activeSessionId);
    return id ? get(sessions).find(session => session.id === id) || null : null;
  }

  function cancelScrollRestoration(): void {
    presentationRevision++;
    if (scrollRestoreFrame !== null) cancelAnimationFrame(scrollRestoreFrame);
    scrollRestoreFrame = null;
    pendingSessionScroll = null;
  }

  function restoreSessionScroll(session: DocumentSession | undefined, id: string | null): void {
    if (!view) return;
    if (scrollRestoreFrame !== null) cancelAnimationFrame(scrollRestoreFrame);
    const target = view;
    const pending = { id, top: session?.scrollTop ?? 0 };
    pendingSessionScroll = pending;
    scrollRestoreFrame = requestAnimationFrame(() => {
      scrollRestoreFrame = null;
      if (view !== target || get(activeSessionId) !== id || pendingSessionScroll !== pending) return;
      presentationRevision++;
      const anchor = session?.editorAnchor;
      target.scrollDOM.scrollTop = anchor
        ? Math.max(0, target.lineBlockAt(Math.max(0, Math.min(anchor.from, target.state.doc.length))).top + anchor.offset)
        : pending.top;
      pendingSessionScroll = null;
    });
  }

  function syncViewToSessionContent(session = currentSession()): void {
    if (!view || !session || session.id !== viewSessionId) return;
    const nextContent = session.content ?? '';
    if (view.state.doc.toString() === nextContent) return;

    const scrollTop = session.scrollTop ?? view.scrollDOM.scrollTop;
    const currentHead = view.state.selection.main.head;
    const nextHead = Math.min(session.cursorOffset ?? currentHead, nextContent.length);
    const previous = view.state.doc.toString();
    let from = 0, to = previous.length, end = nextContent.length;
    while (from < to && from < end && previous[from] === nextContent[from]) from++;
    while (to > from && end > from && previous[to - 1] === nextContent[end - 1]) { to--; end--; }
    const changes = view.state.changes({ from, to, insert: nextContent.slice(from, end) });
    const block = view.lineBlockAtHeight(scrollTop);
    const anchor = session.editorAnchor ?? { from: block.from, offset: scrollTop - block.top };
    const mappedAnchor = changes.mapPos(Math.min(anchor.from, previous.length), -1);

    const wasUpdatingFromStore = isUpdatingFromStore;
    isUpdatingFromStore = true;
    try {
      view.dispatch({
        changes,
        selection: session.cursorOffset !== undefined && session.cursorOffset !== currentHead
          ? EditorSelection.cursor(nextHead) : view.state.selection.map(changes),
        annotations: Transaction.addToHistory.of(false),
      });
    } finally {
      isUpdatingFromStore = wasUpdatingFromStore;
    }

    reconfigurePresentation();
    const target = view;
    const expectedState = target.state;
    const revision = presentationRevision;
    target.requestMeasure({ key: 'restore-presentation-scroll',
      read: editor => editor.lineBlockAt(Math.min(mappedAnchor, editor.state.doc.length)).top + anchor.offset,
      write: (top, editor) => {
        if (view === target && editor.state === expectedState && revision === presentationRevision
          && get(activeSessionId) === session.id) editor.scrollDOM.scrollTop = Math.max(0, top);
      } });
  }

  function visibleRangesAtScroll(editor: EditorView): Array<{ from: number; to: number }> {
    const scrollTop = editor.scrollDOM.scrollTop;
    const viewportBottom = scrollTop + editor.scrollDOM.clientHeight;
    const topBlock = editor.lineBlockAtHeight(scrollTop);
    const bottomBlock = editor.lineBlockAtHeight(viewportBottom);
    return [{ from: topBlock.from, to: bottomBlock.to }];
  }

  function currentDecorations(
    visibleRanges: readonly { from: number; to: number }[] | undefined = view?.visibleRanges,
  ): Extension {
    const mode = get(editorMode);
    const session = currentSession();
    if (mode !== 'wysiwym' || !session) return [];
    return createMarkdownDecorations({
      filePath: session.path,
      theme: get(theme),
      mode,
    }, session.id, visibleRanges);
  }

  function currentLineNumbers(): Extension {
    return get(editorMode) === 'source' && get(settings).showLineNumbers
      ? [lineNumbers(), foldGutter()]
      : [];
  }

  function currentModeAttributes(): Extension {
    const mode = get(editorMode);
    return [EditorView.editorAttributes.of({ class: `cm-reader-${mode}` }),
      EditorView.contentAttributes.of({ 'aria-label': mode === 'source' ? 'Markdown 源码编辑器' : 'Markdown 写作编辑器',
        'aria-keyshortcuts': 'Alt+.' })];
  }

  function currentSyntaxHighlighting(): Extension {
    return get(editorMode) === 'source'
      ? syntaxHighlighting(sourceHighlighting)
      : [];
  }

  function reconfigurePresentation(): void {
    if (!view || viewSessionId !== get(activeSessionId)) return;
    const target = view;
    const sessionId = viewSessionId;
    const value = get(settings);
    const revision = ++presentationRevision;
    const scrollTop = view.scrollDOM.scrollTop;
    const topBlock = view.lineBlockAtHeight(scrollTop);
    const viewportAnchor = topBlock.from;
    const offsetWithinBlock = scrollTop - topBlock.top;
    const visibleRanges = visibleRangesAtScroll(view);
    view.dispatch({
      effects: [
        modeAttributesCompartment.reconfigure(currentModeAttributes()),
        lineNumbersCompartment.reconfigure(currentLineNumbers()),
        decorationsCompartment.reconfigure(currentDecorations(visibleRanges)),
        syntaxHighlightingCompartment.reconfigure(currentSyntaxHighlighting()),
        bracketMatchingCompartment.reconfigure(value.bracketMatching ? bracketMatching() : []),
        autoCloseBracketsCompartment.reconfigure(value.autoCloseBrackets ? closeBrackets() : []),
        wordWrapCompartment.reconfigure(value.wordWrap ? EditorView.lineWrapping : []),
        tabSizeCompartment.reconfigure(EditorState.tabSize.of(value.tabSize)),
      ],
    });
    const expectedState = target.state;
    view.requestMeasure({
      key: 'restore-presentation-scroll',
      read(measuredView) {
        const anchor = Math.min(viewportAnchor, measuredView.state.doc.length);
        return Math.max(0, measuredView.lineBlockAt(anchor).top + offsetWithinBlock);
      },
      write(nextScrollTop, measuredView) {
        if (view !== target || measuredView.state !== expectedState || revision !== presentationRevision
          || get(activeSessionId) !== sessionId || pendingSessionScroll) return;
        measuredView.scrollDOM.scrollTop = nextScrollTop;
      },
    });
  }

  function notifySelection(updateView: EditorView): void {
    if (pointerSelecting || updateView.composing || !updateView.hasFocus || get(editorMode) === 'preview') {
      onSelectionChange?.(null); onSlashTrigger?.(null); return;
    }
    const { from, to, head } = updateView.state.selection.main;
    if (from === to) {
      onSelectionChange?.(null);
    } else {
      const start = updateView.coordsAtPos(from);
      const end = updateView.coordsAtPos(to);
      const rect = updateView.scrollDOM.getBoundingClientRect();
      const edge = [start, end].find(position => position && position.bottom >= rect.top && position.top <= rect.bottom);
      const visible = !!edge;
      const left = start?.left ?? end?.left ?? rect.left;
      const right = end?.right ?? start?.right ?? left;
      const top = Math.max(rect.top, Math.min(start?.top ?? edge?.top ?? rect.top, end?.top ?? edge?.top ?? rect.top));
      onSelectionChange?.(visible ? {
        text: updateView.state.sliceDoc(from, to),
        from,
        to,
        x: (left + right) / 2,
        y: top - 8,
        formatting: activeFormatting(updateView.state),
      } : null);
    }

    const slash = slashTrigger(updateView.state);
    if (!slash) {
      onSlashTrigger?.(null);
      return;
    }
    const coords = updateView.coordsAtPos(head);
    if (!coords) {
      onSlashTrigger?.(null);
      const document = updateView.state.doc;
      const sessionId = viewSessionId;
      // A large paste may place the caret outside the old measured viewport.
      updateView.requestMeasure({ key: 'slash-trigger-coordinates',
        read: editor => editor.state.doc === document ? editor.coordsAtPos(head) : null,
        write: (position, editor) => {
          if (!position || editor.state.doc !== document || editor.state.selection.main.head !== head
            || viewSessionId !== sessionId || !editor.hasFocus || get(editorMode) === 'preview') return;
          onSlashTrigger?.({ ...slash, x: position.left, y: position.bottom + 6 });
        },
      });
      return;
    }
    onSlashTrigger?.({
      ...slash,
      x: coords.left,
      y: coords.bottom,
    });
  }

  onMount(() => {
    const currentSettings = get(settings);
    const session = currentSession();
    const extensions: Extension[] = [
      modeAttributesCompartment.of(currentModeAttributes()),
      lineNumbersCompartment.of(currentLineNumbers()),
      decorationsCompartment.of(currentDecorations()),
      bracketMatchingCompartment.of(currentSettings.bracketMatching ? bracketMatching() : []),
      autoCloseBracketsCompartment.of(currentSettings.autoCloseBrackets ? closeBrackets() : []),
      wordWrapCompartment.of(currentSettings.wordWrap ? EditorView.lineWrapping : []),
      tabSizeCompartment.of(EditorState.tabSize.of(currentSettings.tabSize)),
      highlightActiveLine(),
      focusBlocks,
      highlightSpecialChars(),
      drawSelection(),
      rectangularSelection(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      highlightSelectionMatches(),
      history(),
      placeholder('开始写作...'),
      syntaxHighlightingCompartment.of(currentSyntaxHighlighting()),
      markdown({ base: markdownLanguage }),
      markdownKeymap(),
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        ...closeBracketsKeymap,
        ...searchKeymap,
        indentWithTab,
      ]),
      EditorView.updateListener.of(update => {
        if ((update.docChanged || update.selectionSet) && !isUpdatingFromStore && !isSwitchingSession) cancelScrollRestoration();
        if (update.docChanged) for (const job of imageJobs) if (job.id === viewSessionId) {
          for (const transaction of update.transactions) {
            job.from = transaction.changes.mapPos(job.from, -1);
            job.to = transaction.changes.mapPos(job.to, 1);
          }
        }
        if (update.docChanged && !isUpdatingFromStore) {
          const id = viewSessionId;
          if (id) updateSessionContent(id, update.state.doc.toString());
        }
        if (update.selectionSet || update.docChanged) {
          suppressSlashDuringScroll = false;
          const position = update.state.selection.main.head;
          const line = update.state.doc.lineAt(position);
          cursorPosition.set({ line: line.number, column: position - line.from + 1 });
          const id = viewSessionId;
          if (id) scheduleCursorState(id, position);
          notifySelection(update.view);
        }
        if (update.selectionSet && get(typewriterMode) && (!get(settings).typewriterOnlyTyping
          || update.transactions.some(transaction => transaction.isUserEvent('input')))) {
          const head = update.state.selection.main.head;
          const target = update.view;
          const state = update.state;
          const sessionId = get(activeSessionId);
          if (typewriterFrame !== null) cancelAnimationFrame(typewriterFrame);
          typewriterFrame = requestAnimationFrame(() => {
            typewriterFrame = null;
            if (view !== target || target.state !== state || get(activeSessionId) !== sessionId) return;
            target.dispatch({ effects: EditorView.scrollIntoView(head, { y: 'center' }) });
          });
        }
      }),
      EditorView.domEventHandlers({
        contextmenu: (event, editor) => {
          const position = editor.posAtCoords({ x: event.clientX, y: event.clientY });
          if (position != null && inspectResource(editor, position)) { event.preventDefault(); return true; }
          return false;
        },
        wheel: () => { cancelScrollRestoration(); suppressSlashDuringScroll = true; onSlashTrigger?.(null); },
        touchstart: () => { cancelScrollRestoration(); suppressSlashDuringScroll = true; onSlashTrigger?.(null); },
        pointerdown: (event, editor) => {
          if (event.button === 0 && event.target instanceof Element && event.target.closest('.cm-content')
            && !event.target.closest('.cm-block-widget, input, button, a')) {
            pointerSelecting = true; onSelectionChange?.(null); onSlashTrigger?.(null);
          }
          cancelScrollRestoration();
          if (event.target === editor.scrollDOM) { suppressSlashDuringScroll = true; onSlashTrigger?.(null); }
        },
        keydown: () => { cancelScrollRestoration(); },
        paste: (event, editor) => {
          const images = [...(event.clipboardData?.items ?? [])].filter(item => item.type.startsWith('image/'))
            .map(item => item.getAsFile()).filter((file): file is File => !!file);
          if (!images.length) return false;
          event.preventDefault();
          event.stopPropagation();
          void insertImages(images, editor);
          return true;
        },
        drop: (event, editor) => {
          const images = [...(event.dataTransfer?.files ?? [])].filter(file => file.type.startsWith('image/'));
          if (!images.length) return false;
          event.preventDefault();
          event.stopPropagation();
          void insertImages(images, editor, editor.posAtCoords({ x: event.clientX, y: event.clientY }) ?? undefined);
          return true;
        },
        click: (event, editor) => {
          const target = event.target instanceof Element ? event.target : null;
          const link = target?.closest<HTMLAnchorElement>('a[href]');
          if (link) { event.preventDefault(); void NavigationService.open(link.getAttribute('href') || ''); return true; }
          if (!(event.ctrlKey || event.metaKey) || get(editorMode) === 'source') return false;
          const position = editor.posAtCoords({ x: event.clientX, y: event.clientY });
          if (position == null) return false;
          let node = syntaxTree(editor.state).resolveInner(position);
          while (node.parent && node.name !== 'Link') node = node.parent;
          if (node.name !== 'Link') return false;
          const source = editor.state.sliceDoc(node.from, node.to);
          const href = source.match(/\]\(<?([^\s)>]+)>?(?:\s+["'][^]*?["'])?\)$/)?.[1];
          if (!href) return false;
          event.preventDefault(); void NavigationService.open(href); return true;
        },
        blur: event => {
          pointerSelecting = false;
          const target = event.relatedTarget;
          if (!(target instanceof Element) || !target.closest('.floating-toolbar, .table-picker')) onSelectionChange?.(null);
          onSlashTrigger?.(null);
        },
        compositionstart: () => {
          onSelectionChange?.(null); onSlashTrigger?.(null);
        },
        scroll: () => {
          const id = viewSessionId;
          if (id && view && !isSwitchingSession && !pendingSessionScroll) {
            const scrollTop = view.scrollDOM.scrollTop;
            scheduleScrollState(id, scrollTop);
          }
          onSelectionChange?.(null);
          onSlashTrigger?.(null);
          onInteraction?.();
          if (!suppressSlashDuringScroll && view?.hasFocus) {
            const editor = view;
            const doc = editor.state.doc;
            const trigger = slashTrigger(editor.state);
            const head = editor.state.selection.main.head;
            if (trigger) editor.requestMeasure({ key: 'slash-after-layout-scroll',
              read: target => target.state.doc === doc ? target.coordsAtPos(head) : null,
              write: (position, target) => {
                if (position && !suppressSlashDuringScroll && target.hasFocus && target.state.doc === doc
                  && target.state.selection.main.head === head && get(editorMode) !== 'preview') {
                  onSlashTrigger?.({ ...trigger, x: position.left, y: position.bottom + 6 });
                }
              },
            });
          }
        },
      }),
      EditorView.theme({
        '&': {
          height: '100%',
          fontSize: 'var(--editor-font-size, 14px)',
          fontFamily: 'var(--editor-font-family, var(--font-mono))',
        },
        '.cm-scroller': {
          overflow: 'auto',
        },
        '.cm-content': {
          padding: 'var(--editor-top-padding, 48px) 0 var(--editor-bottom-padding, 80px)',
          lineHeight: 'var(--editor-line-height, 1.8)',
          fontFamily: 'var(--editor-font-family, var(--font-mono))',
          caretColor: 'var(--accent-color)',
          maxWidth: 'none',
          margin: '0',
        },
        '.cm-line': {
          padding: '0 var(--editor-h-pad, 24px)',
          fontFamily: 'inherit',
        },
        '.cm-gutters': {
          background: 'var(--bg-secondary)',
          border: 'none',
          borderRight: '1px solid var(--border-color)',
          color: 'var(--text-tertiary)',
        },
        '.cm-activeLine': { background: 'transparent' },
        '.cm-activeLineGutter': { background: 'color-mix(in srgb, var(--ui-accent) 5%, transparent)' },
        '&.cm-focused': { outline: 'none' },
        '&.cm-focused .cm-activeLine': { background: 'color-mix(in srgb, var(--ui-accent) 4%, transparent)' },
        '.cm-selectionBackground': { background: 'color-mix(in srgb, var(--ui-accent) 24%, transparent) !important' },
        '&.cm-focused .cm-selectionBackground': { background: 'color-mix(in srgb, var(--ui-accent) 32%, transparent) !important' },
        '.cm-cursor': {
          borderLeftColor: 'var(--accent-color)',
          borderLeftWidth: '2px',
          animation: 'cm-cursor-blink 1.2s ease-in-out infinite',
        },
      }),
    ];

    viewSessionId = session?.id ?? null;
    const initialState = restoreEditorState(session?.content ?? '', session?.editorState, extensions, session?.cursorOffset);
    view = new EditorView({ state: initialState, parent: editorContainer });
    for (const [id, command] of [
      ['bold', (editor: EditorView) => toggleFormat(editor, '**', '**')],
      ['italic', (editor: EditorView) => toggleFormat(editor, '*', '*')],
      ['strikethrough', (editor: EditorView) => toggleFormat(editor, '~~', '~~')],
      ['code', toggleCode],
      ['link', insertLink],
      ['h1', (editor: EditorView) => toggleLinePrefix(editor, '# ')],
      ['h2', (editor: EditorView) => toggleLinePrefix(editor, '## ')],
      ['quote', (editor: EditorView) => toggleLinePrefix(editor, '> ')],
    ] as const) {
      commandCleanups.push(CommandService.register(id, () => {
        if (!view || get(editorMode) === 'preview' || isSwitchingSession) return;
        command(view); view.focus();
      }, { enabled: () => !!view && !view.composing && get(editorMode) !== 'preview' && !isSwitchingSession,
        unavailable: '请切换到写作或源码模式，并完成当前输入后再修改格式。' }));
      commandCleanups.push(ShortcutService.register(id, () => CommandService.execute(id)));
    }
    for (const [id, command] of [['undo', undo], ['redo', redo]] as const) {
      commandCleanups.push(CommandService.register(id, () => {
        if (!view || get(editorMode) === 'preview' || isSwitchingSession) return;
        command(view);
        view.focus();
      }, { enabled: () => !!view && !view.composing && get(editorMode) !== 'preview' && !isSwitchingSession,
        unavailable: '请切换到写作或源码模式，并完成当前输入后再撤销或重做。' }));
      commandCleanups.push(ShortcutService.register(id, () => CommandService.execute(id)));
    }
    if (session) syncViewToSessionContent(session);
    const initialHead = view.state.selection.main.head;
    const initialLine = view.state.doc.lineAt(initialHead);
    cursorPosition.set({ line: initialLine.number, column: initialHead - initialLine.from + 1 });
    reconfigurePresentation();

    unsubscribeSettings = settings.subscribe(() => reconfigurePresentation());
    unsubscribeMode = editorMode.subscribe(() => reconfigurePresentation());
    unsubscribeTheme = theme.subscribe(() => reconfigurePresentation());
    let lastSessionContent = session?.content || '';
    let lastSessionPath = session?.path ?? null;
    unsubscribeSessionContent = sessions.subscribe(list => {
      const activeId = get(activeSessionId);
      if (isSwitchingSession || activeId !== viewSessionId) return;
      const next = list.find(item => item.id === activeId);
      if (!next) return;
      const nextContent = next.content;
      const pathChanged = next.path !== lastSessionPath;
      lastSessionPath = next.path;
      if (nextContent === lastSessionContent) {
        if (pathChanged) reconfigurePresentation();
        return;
      }
      lastSessionContent = nextContent;
      syncViewToSessionContent();
    });

    let previousSessionId = get(activeSessionId);
    unsubscribeActiveSession = activeSessionId.subscribe(nextSessionId => {
      if (!view || nextSessionId === previousSessionId) return;
      isSwitchingSession = true;
      try {
        flushPendingSessionState();
        presentationRevision++;
        if (scrollRestoreFrame !== null) cancelAnimationFrame(scrollRestoreFrame);
        if (typewriterFrame !== null) cancelAnimationFrame(typewriterFrame);
        typewriterFrame = null;
        if (previousSessionId) {
          const oldState = view.state;
          const oldScrollTop = pendingSessionScroll?.id === previousSessionId
            ? pendingSessionScroll.top : view.scrollDOM.scrollTop;
          const oldBlock = view.lineBlockAtHeight(oldScrollTop);
          sessions.update(list => list.map(item => item.id === previousSessionId
            ? {
                ...item,
                editorState: oldState,
                cursorOffset: oldState.selection.main.head,
                scrollTop: oldScrollTop,
                editorAnchor: pendingSessionScroll?.id === previousSessionId ? item.editorAnchor
                  : { from: oldBlock.from, offset: oldScrollTop - oldBlock.top },
              }
            : item));
        }

        const next = get(sessions).find(item => item.id === nextSessionId);
        lastSessionContent = next?.content || '';
        lastSessionPath = next?.path ?? null;
        isUpdatingFromStore = true;
        viewSessionId = nextSessionId;
        view.setState(restoreEditorState(next?.content ?? '', next?.editorState, extensions, next?.cursorOffset));
        if (next) syncViewToSessionContent(next);
        const nextHead = view.state.selection.main.head;
        const nextLine = view.state.doc.lineAt(nextHead);
        cursorPosition.set({
          line: nextLine.number,
          column: nextHead - nextLine.from + 1,
        });
        onSelectionChange?.(null);
        onSlashTrigger?.(null);
        reconfigurePresentation();
        restoreSessionScroll(next, nextSessionId);
      } finally {
        isUpdatingFromStore = false;
        isSwitchingSession = false;
        previousSessionId = nextSessionId;
      }
    });
    restoreSessionScroll(session ?? undefined, viewSessionId);
  });

  onDestroy(() => {
    for (const job of imageJobs) job.cancelled = true;
    commandCleanups.forEach(cleanup => cleanup());
    presentationRevision++;
    if (scrollRestoreFrame !== null) cancelAnimationFrame(scrollRestoreFrame);
    if (typewriterFrame !== null) cancelAnimationFrame(typewriterFrame);
    unsubscribeSettings();
    unsubscribeMode();
    unsubscribeTheme();
    unsubscribeActiveSession();
    unsubscribeSessionContent();
    flushPendingSessionState();
    const id = viewSessionId;
    if (id && view) {
      const state = view.state;
      const scrollTop = pendingSessionScroll?.id === id ? pendingSessionScroll.top : view.scrollDOM.scrollTop;
      sessions.update(list => list.map(item => item.id === id
        ? { ...item, editorState: state, cursorOffset: state.selection.main.head, scrollTop,
          editorAnchor: pendingSessionScroll?.id === id ? item.editorAnchor
            : { from: view!.lineBlockAtHeight(scrollTop).from, offset: scrollTop - view!.lineBlockAtHeight(scrollTop).top } }
        : item));
    }
    view?.destroy();
    view = null;
  });

  export function focus(): void {
    view?.focus();
  }

  export function scrollToLine(lineNumber: number): void {
    if (!view) return;
    cancelScrollRestoration();
    const line = view.state.doc.line(Math.min(Math.max(lineNumber, 1), view.state.doc.lines));
    view.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 50 }),
    });
  }

  export function revealRange(from: number, to: number, focusEditor = false): void {
    if (!view || from < 0 || to < from || to > view.state.doc.length) return;
    cancelScrollRestoration();
    view.dispatch({
      selection: { anchor: from, head: to },
      effects: EditorView.scrollIntoView(from, { y: 'center', yMargin: 48 }),
    });
    if (focusEditor) view.focus();
  }

  export function replaceRange(from: number, to: number, text: string): void {
    if (!view || view.composing || get(editorMode) === 'preview' || !Number.isInteger(from) || !Number.isInteger(to)
      || from < 0 || to < from || to > view.state.doc.length) return;
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
      annotations: isolateHistory.of('full'),
      userEvent: 'input.insert',
    });
    view.focus();
  }

  export function insertText(text: string): void {
    if (!view) return;
    const { from, to } = view.state.selection.main;
    replaceRange(from, to, text);
  }

  export function wrapCurrentSelection(before: string, after: string): void {
    if (view) wrapSelection(view, before, after);
  }

  export function prefixCurrentLine(prefix: string): void {
    if (view) insertLinePrefix(view, prefix);
  }

  export function getView(): EditorView | null {
    return view;
  }
</script>

<div
  bind:this={editorContainer}
  class="cm-editor-wrapper"
  data-editor-mode={$editorMode}
  style="--editor-font-size: {$settings.fontSize * $settings.displayZoom / 100}px; --editor-line-height: {$settings.lineHeight};"
></div>

<style>
  .cm-editor-wrapper {
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    container-type: inline-size; /* 允许子元素使用 cqi 单位，避免内容宽度拉伸布局 */
    --editor-h-pad: max(34px, calc((100% - var(--doc-content-width, 760px)) / 2));
    --editor-top-padding: 48px;
    --editor-bottom-padding: 60vh;
  }

  .cm-editor-wrapper :global(.cm-editor) {
    height: 100%;
    min-height: 0;
  }

  .cm-editor-wrapper :global(.cm-content),
  .cm-editor-wrapper :global(.cm-line) {
    cursor: text;
    user-select: text;
    -webkit-user-select: text;
  }

  /* WYSIWYM 模式 */
  .cm-editor-wrapper[data-editor-mode="wysiwym"] {
    --editor-font-family: var(--font-content);
    --editor-line-height: var(--reader-line-height, var(--doc-line-height, 1.75));
    --editor-font-weight: 400;
  }

  /* 源码模式 */
  .cm-editor-wrapper[data-editor-mode="source"] {
    --editor-font-family: var(--font-mono);
    --editor-line-height: var(--reader-line-height, 1.72);
    --editor-font-weight: 400;
    --editor-top-padding: 48px;
    --editor-bottom-padding: 60vh;
  }

  .cm-editor-wrapper[data-editor-mode="wysiwym"] :global(.cm-content),
  .cm-editor-wrapper[data-editor-mode="wysiwym"] :global(.cm-line) {
    font-weight: var(--editor-font-weight);
  }

  .cm-editor-wrapper[data-editor-mode="source"] :global(.cm-content),
  .cm-editor-wrapper[data-editor-mode="source"] :global(.cm-line),
  .cm-editor-wrapper[data-editor-mode="source"] :global(.cm-line *) {
    font-family: var(--font-mono) !important;
    font-size: var(--editor-font-size, 14px) !important;
    font-style: normal !important;
    font-weight: 400 !important;
    letter-spacing: 0 !important;
    text-decoration: none !important;
    text-transform: none !important;
  }

  .cm-editor-wrapper[data-editor-mode="source"] :global(.cm-line) {
    min-height: auto !important;
    padding-top: 0 !important;
    padding-bottom: 0 !important;
  }

  .cm-editor-wrapper[data-editor-mode="source"] :global(.cm-gutters) {
    background: transparent !important;
    border: 0 !important;
    color: color-mix(in srgb, var(--doc-text-muted) 62%, transparent) !important;
  }

  .cm-editor-wrapper[data-editor-mode="source"] :global(.cm-activeLineGutter) {
    background: transparent !important;
    color: var(--doc-text-muted) !important;
  }

  /* 光标闪烁动画关键帧 */
  @keyframes cm-cursor-blink {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0; }
  }

  /* WYSIWYM 模式占位符样式 */
  .cm-editor-wrapper[data-editor-mode="wysiwym"] :global(.cm-placeholder) {
    color: var(--text-tertiary);
    font-style: italic;
    font-family: var(--font-content);
    font-size: inherit;
  }

  /* 覆盖 CM 默认的高亮活动行（WYSIWYM 模式下使用更精细的样式） */
  .cm-editor-wrapper[data-editor-mode="wysiwym"] :global(.cm-activeLine) {
    border-radius: 3px;
  }
</style>
