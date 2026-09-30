<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { EditorView, drawSelection, highlightActiveLine, highlightSpecialChars, keymap, lineNumbers, rectangularSelection, placeholder } from '@codemirror/view';
  import { Compartment, EditorState, Transaction, type Extension } from '@codemirror/state';
  import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo } from '@codemirror/commands';
  import { CommandService } from '$lib/services/command';
  import { ShortcutService } from '$lib/services/shortcut';
  import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
  import {
    bracketMatching,
    defaultHighlightStyle,
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

  export interface SelectionDetails {
    text: string;
    from: number;
    to: number;
    x: number;
    y: number;
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
  let unsubscribeMode = () => {};
  let unsubscribeTheme = () => {};
  let unsubscribeActiveSession = () => {};
  let unsubscribeSessionContent = () => {};
  const commandCleanups: Array<() => void> = [];
  let presentationRevision = 0;
  let isSwitchingSession = false;
  let sessionStateTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingCursorState: { id: string; offset: number } | null = null;
  let pendingScrollState: { id: string; scrollTop: number } | null = null;
  let pendingSessionScroll: { id: string | null; top: number } | null = null;
  let scrollRestoreFrame: number | null = null;
  let typewriterFrame: number | null = null;

  const lineNumbersCompartment = new Compartment();
  const bracketMatchingCompartment = new Compartment();
  const wordWrapCompartment = new Compartment();
  const tabSizeCompartment = new Compartment();
  const autoCloseBracketsCompartment = new Compartment();
  const decorationsCompartment = new Compartment();
  const modeAttributesCompartment = new Compartment();
  const syntaxHighlightingCompartment = new Compartment();

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
      updateSessionScroll(pendingScrollState.id, pendingScrollState.scrollTop);
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
    pendingScrollState = { id, scrollTop };
    scheduleSessionStateFlush();
  }

  function wrapSelection(editor: EditorView, before: string, after: string): void {
    const { from, to } = editor.state.selection.main;
    const text = editor.state.sliceDoc(from, to);
    editor.dispatch({
      changes: { from, to, insert: `${before}${text}${after}` },
      selection: { anchor: from + before.length, head: from + before.length + text.length },
    });
  }

  function insertLinePrefix(editor: EditorView, prefix: string): void {
    const line = editor.state.doc.lineAt(editor.state.selection.main.from);
    const existing = line.text.match(/^#{0,6}\s*/)?.[0] || '';
    editor.dispatch({
      changes: { from: line.from, to: line.from + existing.length, insert: prefix },
      selection: { anchor: line.from + prefix.length },
    });
  }

  function smartEnter(editor: EditorView): boolean {
    const { from } = editor.state.selection.main;
    const line = editor.state.doc.lineAt(from);
    const unordered = line.text.match(/^(\s*)([-*+])\s+(?:\[([ xX])\]\s+)?/);
    if (unordered) {
      const marker = unordered[3] === undefined ? `${unordered[2]} ` : `${unordered[2]} [ ] `;
      if (line.text.trim() === unordered[0].trim()) {
        editor.dispatch({ changes: { from: line.from, to: line.to, insert: '' } });
      } else {
        editor.dispatch({ changes: { from, insert: `\n${unordered[1]}${marker}` } });
      }
      return true;
    }

    const ordered = line.text.match(/^(\s*)(\d+)\.\s+/);
    if (ordered) {
      if (line.text.trim() === `${ordered[2]}.`) {
        editor.dispatch({ changes: { from: line.from, to: line.to, insert: '' } });
      } else {
        editor.dispatch({
          changes: { from, insert: `\n${ordered[1]}${Number(ordered[2]) + 1}. ` },
        });
      }
      return true;
    }

    const indent = line.text.match(/^(\s+)/)?.[1];
    if (indent) {
      editor.dispatch({ changes: { from, insert: `\n${indent}` } });
      return true;
    }
    return false;
  }

  function markdownKeymap(): Extension {
    return keymap.of([
      { key: 'Mod-b', run: editor => (wrapSelection(editor, '**', '**'), true) },
      { key: 'Mod-i', run: editor => (wrapSelection(editor, '*', '*'), true) },
      { key: 'Mod-Shift-x', run: editor => (wrapSelection(editor, '~~', '~~'), true) },
      {
        key: 'Mod-Shift-k',
        run(editor) {
          const { from, to } = editor.state.selection.main;
          const multiline = editor.state.sliceDoc(from, to).includes('\n');
          wrapSelection(editor, multiline ? '```\n' : '`', multiline ? '\n```' : '`');
          return true;
        },
      },
      {
        key: 'Mod-k',
        run(editor) {
          const { from, to } = editor.state.selection.main;
          const text = editor.state.sliceDoc(from, to) || 'text';
          editor.dispatch({
            changes: { from, to, insert: `[${text}](url)` },
            selection: { anchor: from + text.length + 3, head: from + text.length + 6 },
          });
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

  function syncViewToSessionContent(session = currentSession()): void {
    if (!view || !session) return;
    const nextContent = session.content ?? '';
    if (view.state.doc.toString() === nextContent) return;

    const scrollTop = session.scrollTop || view.scrollDOM.scrollTop;
    const currentHead = view.state.selection.main.head;
    const nextHead = Math.min(session.cursorOffset || currentHead, nextContent.length);

    isUpdatingFromStore = true;
    try {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: nextContent },
        selection: { anchor: nextHead },
        annotations: Transaction.addToHistory.of(false),
      });
    } finally {
      isUpdatingFromStore = false;
    }

    reconfigurePresentation();
    requestAnimationFrame(() => {
      if (!view) return;
      view.scrollDOM.scrollTop = Math.min(scrollTop, view.scrollDOM.scrollHeight);
    });
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
    return EditorView.editorAttributes.of({
      class: `cm-reader-${mode}`,
    });
  }

  function currentSyntaxHighlighting(): Extension {
    return get(editorMode) === 'source'
      ? syntaxHighlighting(defaultHighlightStyle, { fallback: true })
      : [];
  }

  function reconfigurePresentation(): void {
    if (!view) return;
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
      ],
    });
    view.requestMeasure({
      key: 'restore-presentation-scroll',
      read(measuredView) {
        const anchor = Math.min(viewportAnchor, measuredView.state.doc.length);
        return Math.max(0, measuredView.lineBlockAt(anchor).top + offsetWithinBlock);
      },
      write(nextScrollTop, measuredView) {
        if (revision !== presentationRevision) return;
        measuredView.scrollDOM.scrollTop = nextScrollTop;
      },
    });
  }

  function notifySelection(updateView: EditorView): void {
    const { from, to, head } = updateView.state.selection.main;
    if (from === to) {
      onSelectionChange?.(null);
    } else {
      const start = updateView.coordsAtPos(from);
      const end = updateView.coordsAtPos(to);
      const rect = updateView.dom.getBoundingClientRect();
      const left = start?.left ?? end?.left ?? rect.left;
      const right = end?.right ?? start?.right ?? left;
      const top = Math.min(start?.top ?? rect.top, end?.top ?? start?.top ?? rect.top);
      onSelectionChange?.({
        text: updateView.state.sliceDoc(from, to),
        from,
        to,
        x: (left + right) / 2,
        y: top - 8,
      });
    }

    const line = updateView.state.doc.lineAt(head);
    const beforeCursor = updateView.state.sliceDoc(line.from, head);
    const slash = beforeCursor.match(/(?:^|\s)\/([\p{L}\p{N}-]*)$/u);
    if (!slash || get(editorMode) === 'preview') {
      onSlashTrigger?.(null);
      return;
    }
    const coords = updateView.coordsAtPos(head);
    const slashLength = slash[0].trimStart().length;
    onSlashTrigger?.({
      from: head - slashLength,
      to: head,
      query: slash[1],
      x: coords?.left || 0,
      y: coords?.bottom || 0,
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
        if (update.docChanged && !isUpdatingFromStore) {
          const id = get(activeSessionId);
          if (id) updateSessionContent(id, update.state.doc.toString());
        }
        if (update.selectionSet || update.docChanged) {
          const position = update.state.selection.main.head;
          const line = update.state.doc.lineAt(position);
          cursorPosition.set({ line: line.number, column: position - line.from + 1 });
          const id = get(activeSessionId);
          if (id) scheduleCursorState(id, position);
          notifySelection(update.view);
        }
        if (update.selectionSet && get(typewriterMode)) {
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
        blur: () => {
          onSelectionChange?.(null);
          onSlashTrigger?.(null);
        },
        scroll: () => {
          const id = get(activeSessionId);
          if (id && view && !isSwitchingSession && !pendingSessionScroll) {
            const scrollTop = view.scrollDOM.scrollTop;
            scheduleScrollState(id, scrollTop);
          }
          onSelectionChange?.(null);
          onInteraction?.();
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
        '.cm-activeLineGutter': { background: 'rgba(var(--accent-rgb), 0.05)' },
        '&.cm-focused': { outline: 'none' },
        '&.cm-focused .cm-activeLine': { background: 'rgba(var(--accent-rgb), 0.04)' },
        '.cm-selectionBackground': { background: 'rgba(var(--accent-rgb), 0.15) !important' },
        '.cm-cursor': {
          borderLeftColor: 'var(--accent-color)',
          borderLeftWidth: '2px',
          animation: 'cm-cursor-blink 1.2s ease-in-out infinite',
        },
      }),
    ];

    const initialState = session?.editorState instanceof EditorState
      ? session.editorState
      : EditorState.create({ doc: session?.content || '', extensions });
    view = new EditorView({ state: initialState, parent: editorContainer });
    for (const [id, command] of [['undo', undo], ['redo', redo]] as const) {
      commandCleanups.push(CommandService.register(id, () => {
        if (!view || get(editorMode) === 'preview' || isSwitchingSession) return;
        command(view);
        view.focus();
      }));
      commandCleanups.push(ShortcutService.register(id, () => CommandService.execute(id)));
    }
    if (!session?.editorState && session?.cursorOffset) {
      view.dispatch({ selection: { anchor: Math.min(session.cursorOffset, view.state.doc.length) } });
    }
    reconfigurePresentation();

    unsubscribeSettings = settings.subscribe(value => {
      if (!view) return;
      view.dispatch({
        effects: [
          lineNumbersCompartment.reconfigure(currentLineNumbers()),
          bracketMatchingCompartment.reconfigure(value.bracketMatching ? bracketMatching() : []),
          autoCloseBracketsCompartment.reconfigure(value.autoCloseBrackets ? closeBrackets() : []),
          wordWrapCompartment.reconfigure(value.wordWrap ? EditorView.lineWrapping : []),
          tabSizeCompartment.reconfigure(EditorState.tabSize.of(value.tabSize)),
        ],
      });
    });
    unsubscribeMode = editorMode.subscribe(() => reconfigurePresentation());
    unsubscribeTheme = theme.subscribe(() => reconfigurePresentation());
    let lastSessionContent = session?.content || '';
    unsubscribeSessionContent = sessions.subscribe(list => {
      const activeId = get(activeSessionId);
      const nextContent = list.find(item => item.id === activeId)?.content || '';
      if (nextContent === lastSessionContent) return;
      lastSessionContent = nextContent;
      if (!isSwitchingSession) syncViewToSessionContent();
    });

    let previousSessionId = get(activeSessionId);
    unsubscribeActiveSession = activeSessionId.subscribe(nextSessionId => {
      if (!view || nextSessionId === previousSessionId) return;
      flushPendingSessionState();
      isSwitchingSession = true;
      if (scrollRestoreFrame !== null) cancelAnimationFrame(scrollRestoreFrame);
      if (previousSessionId) {
        const oldState = view.state;
        const oldScrollTop = pendingSessionScroll?.id === previousSessionId
          ? pendingSessionScroll.top : view.scrollDOM.scrollTop;
        sessions.update(list => list.map(item => item.id === previousSessionId
          ? {
              ...item,
              editorState: oldState,
              cursorOffset: oldState.selection.main.head,
              scrollTop: oldScrollTop,
            }
          : item));
      }

      const next = get(sessions).find(item => item.id === nextSessionId);
      lastSessionContent = next?.content || '';
      isUpdatingFromStore = true;
      if (next?.editorState instanceof EditorState) {
        view.setState(next.editorState);
      } else {
        view.setState(EditorState.create({ doc: next?.content || '', extensions }));
        if (next?.cursorOffset) {
          view.dispatch({ selection: { anchor: Math.min(next.cursorOffset, view.state.doc.length) } });
        }
      }
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
      const target = view;
      const pending = { id: nextSessionId, top: next?.scrollTop ?? 0 };
      pendingSessionScroll = pending;
      scrollRestoreFrame = requestAnimationFrame(() => {
        scrollRestoreFrame = null;
        if (view !== target || get(activeSessionId) !== nextSessionId || pendingSessionScroll !== pending) return;
        target.scrollDOM.scrollTop = pending.top;
        pendingSessionScroll = null;
      });
      isUpdatingFromStore = false;
      isSwitchingSession = false;
      previousSessionId = nextSessionId;
    });
  });

  onDestroy(() => {
    commandCleanups.forEach(cleanup => cleanup());
    presentationRevision++;
    if (scrollRestoreFrame !== null) cancelAnimationFrame(scrollRestoreFrame);
    if (typewriterFrame !== null) cancelAnimationFrame(typewriterFrame);
    flushPendingSessionState();
    const id = get(activeSessionId);
    if (id && view) {
      const state = view.state;
      const scrollTop = pendingSessionScroll?.id === id ? pendingSessionScroll.top : view.scrollDOM.scrollTop;
      sessions.update(list => list.map(item => item.id === id
        ? { ...item, editorState: state, cursorOffset: state.selection.main.head, scrollTop }
        : item));
    }
    unsubscribeSettings();
    unsubscribeMode();
    unsubscribeTheme();
    unsubscribeActiveSession();
    unsubscribeSessionContent();
    view?.destroy();
    view = null;
  });

  export function focus(): void {
    view?.focus();
  }

  export function scrollToLine(lineNumber: number): void {
    if (!view) return;
    const line = view.state.doc.line(Math.min(Math.max(lineNumber, 1), view.state.doc.lines));
    view.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: 'start', yMargin: 50 }),
    });
  }

  export function replaceRange(from: number, to: number, text: string): void {
    if (!view) return;
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
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
  style="--editor-font-size: {$settings.fontSize}px; --editor-line-height: {$settings.lineHeight};"
></div>

<style>
  .cm-editor-wrapper {
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    container-type: inline-size; /* 允许子元素使用 cqi 单位，避免内容宽度拉伸布局 */
    --editor-h-pad: max(34px, calc((100% - var(--doc-content-width, 760px)) / 2));
    --editor-top-padding: 64px;
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
    --editor-top-padding: 64px;
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
