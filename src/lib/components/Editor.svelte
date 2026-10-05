<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { get } from 'svelte/store';
  import type { EditorContentEditRequest, EditorRevealRequest, TableEditRequest } from '$lib/types';
  import { isolateHistory } from '@codemirror/commands';
  import { activeSessionId } from '$lib/stores/document';
  import { focusMode, typewriterMode, editorMode } from '$lib/stores/ui';
  import type { Text } from '@codemirror/state';
  import { CommandService } from '$lib/services/command';
  import { selectionSource, selectionText } from '$lib/stores/editor-ui';
  import { notify } from '$lib/services/interaction';
  import { settings } from '$lib/stores/settings';
  import CodeMirrorEditor, {
    type SelectionDetails,
    type SlashDetails,
  } from './CodeMirrorEditor.svelte';
  import FloatingToolbar from './FloatingToolbar.svelte';
  import SlashMenu, { type SlashItem } from './SlashMenu.svelte';
  import TableEditor from './TableEditor.svelte';
  import TablePicker from './TablePicker.svelte';

  let editor: CodeMirrorEditor | undefined = $state();
  let selection: SelectionDetails | null = $state(null);
  let manualToolbar = $state(false);
  let slash: SlashDetails | null = $state(null);
  let tablePickerVisible = $state(false);
  let tablePickerX = $state(0);
  let tablePickerY = $state(0);
  let tableEditorVisible = $state(false);
  let tableRequest: TableEditRequest | null = $state(null);
  let tableInsertion: { sessionId: string; from: number; to: number; doc: Text; slash: boolean } | null = $state(null);

  $effect(() => {
    void $activeSessionId; void $editorMode;
    selection = null; slash = null; tablePickerVisible = false; tableInsertion = null;
    tableEditorVisible = false; tableRequest = null;
  });

  const slashTemplates: Record<string, string> = {
    h1: '# ',
    h2: '## ',
    h3: '### ',
    code: '```\n\n```',
    latex: '$$\n\n$$',
    mermaid: '```mermaid\ngraph TD\n  A --> B\n```',
    chart: '```chart\n{\n  "type": "line",\n  "title": "数据图表",\n  "labels": ["A", "B", "C"],\n  "series": [{ "name": "系列一", "data": [1, 3, 2] }]\n}\n```\n\n',
    quote: '> ',
    hr: '---',
    image: '![alt](url)',
    ul: '- ',
    ol: '1. ',
    task: '- [ ] ',
  };

  function handleSelectionChange(details: SelectionDetails | null): void {
    manualToolbar = false;
    selection = details;
    selectionText.set(details?.text || '');
    selectionSource.set(details ? 'editor' : null);
  }

  function handleSlashTrigger(details: SlashDetails | null): void {
    slash = details;
  }

  function applySlashItem(item: SlashItem): void {
    if (!slash || !editor) return;
    const range = slash;
    slash = null;
    if (item.id === 'table') {
      const view = editor.getView();
      const id = get(activeSessionId);
      if (!view || !id) return;
      tableInsertion = { sessionId: id, from: range.from, to: range.to, doc: view.state.doc, slash: true };
      tablePickerX = range.x;
      tablePickerY = range.y;
      tablePickerVisible = true;
      return;
    }
    const view = editor.getView();
    if (!view) return;
    const prefix = view.state.sliceDoc(view.state.doc.lineAt(range.from).from, range.from);
    editor.replaceRange(range.from, range.to, continueBlock(slashTemplates[item.id] || '', prefix));
  }

  function continueBlock(markdown: string, prefix: string): string {
    const continuation = prefix.replace(/(?:[-+*]|\d+[.)])\s+|\[[ xX]\]\s+/g, marker => ' '.repeat(marker.length));
    return markdown.replace(/\n/g, `\n${continuation}`);
  }

  function closeTablePicker(restoreFocus = true): void {
    tablePickerVisible = false; tableInsertion = null;
    if (restoreFocus) void tick().then(() => { if (get(editorMode) !== 'preview') editor?.focus(); });
  }

  function insertTable(rows: number, columns: number): void {
    const request = tableInsertion;
    const view = editor?.getView();
    if (!request || !view || request.sessionId !== get(activeSessionId) || view.state.doc !== request.doc
      || get(editorMode) === 'preview') {
      notify('文档已变化，未插入表格。请重新选择插入位置。'); closeTablePicker(); return;
    }
    const header = `| ${Array.from({ length: columns }, (_, index) => `列 ${index + 1}`).join(' | ')} |`;
    const divider = `| ${Array.from({ length: columns }, () => '---').join(' | ')} |`;
    const body = Array.from({ length: rows }, () =>
      `| ${Array.from({ length: columns }, () => '').join(' | ')} |`,
    );
    let markdown = [header, divider, ...body].join('\n');
    const before = view.state.sliceDoc(view.state.doc.lineAt(request.from).from, request.from);
    const after = view.state.sliceDoc(request.to, view.state.doc.lineAt(request.to).to);
    if (request.slash) markdown = continueBlock(markdown, before);
    else markdown = (before.trim() ? '\n\n' : '') + markdown + (after.trim() ? '\n\n' : '\n');
    tablePickerVisible = false; tableInsertion = null;
    editor?.replaceRange(request.from, request.to, markdown);
    void tick().then(() => { if (get(activeSessionId) === request.sessionId && get(editorMode) !== 'preview') editor?.focus(); });
  }

  function handleToolbarAction(action: string): void {
    if (!editor) return;
    if (action === 'table') {
      const view = editor.getView();
      const id = get(activeSessionId);
      if (!view || !id) return;
      const range = view.state.selection.main;
      tableInsertion = { sessionId: id, from: range.from, to: range.to, doc: view.state.doc, slash: false };
      tablePickerX = selection?.x || 0;
      tablePickerY = selection?.y || 0;
      tablePickerVisible = true;
    } else void CommandService.execute(action);
    selection = null;
  }

  function applyTable(markdown: string): void {
    const request = tableRequest;
    const view = editor?.getView();
    if (!request || !view || request.sessionId !== get(activeSessionId)
      || !Number.isInteger(request.from) || !Number.isInteger(request.to)
      || request.from < 0 || request.to < request.from || request.to > view.state.doc.length
      || view.state.sliceDoc(request.from, request.to) !== request.markdown) {
      notify('表格所在文档已变化，请重新打开表格编辑器后再修改。');
      tableRequest = null;
      tableEditorVisible = false;
      return;
    }
    editor?.replaceRange(request.from, request.to, markdown);
    tableRequest = null;
    tableEditorVisible = false;
    void tick().then(() => { if (get(activeSessionId) === request.sessionId && get(editorMode) !== 'preview') editor?.focus(); });
  }

  onMount(() => {
    const showToolbar = () => { if (selection && get(settings).floatingToolbar !== 'off') manualToolbar = true; };
    window.addEventListener('reader-show-format-toolbar', showToolbar);
    const headingHandler = (event: Event) => {
      const detail = (event as CustomEvent<{ line: number; sessionId?: string }>).detail;
      const id = get(activeSessionId);
      const line = detail?.line;
      if (line && get(editorMode) !== 'preview' && (!detail.sessionId || detail.sessionId === id)) {
        editor?.scrollToLine(line);
        void tick().then(() => { if (get(activeSessionId) === id && get(editorMode) !== 'preview') editor?.focus(); });
      }
    };
    const tableHandler = (event: Event) => {
      const request = (event as CustomEvent<TableEditRequest>).detail;
      if (!request || request.sessionId !== get(activeSessionId)) return;
      tableRequest = request;
      tableEditorVisible = true;
    };
    const revealHandler = (event: Event) => {
      const detail = (event as CustomEvent<EditorRevealRequest>).detail;
      if (!detail || detail.sessionId !== get(activeSessionId) || get(editorMode) === 'preview') return;
      editor?.revealRange(detail.from, detail.to, detail.focus ?? false);
    };
    const replaceHandler = (event: Event) => {
      const detail = (event as CustomEvent<{ from: number; to: number; text: string; sessionId?: string; expectedContent?: string }>).detail;
      const view = editor?.getView();
      if (!detail || !view || (detail.sessionId && detail.sessionId !== get(activeSessionId))
        || (detail.expectedContent !== undefined && detail.expectedContent !== view.state.doc.toString())
        || detail.from < 0 || detail.to < detail.from || detail.to > view.state.doc.length) return;
      editor?.replaceRange(detail.from, detail.to, detail.text);
    };
    const contentEditHandler = (event: Event) => {
      const detail = (event as CustomEvent<EditorContentEditRequest>).detail;
      const view = editor?.getView();
      if (!detail || !view || detail.sessionId !== get(activeSessionId)
        || view.state.doc.toString() !== detail.expectedContent) return;
      const before = detail.expectedContent;
      const after = detail.content;
      let from = 0;
      while (from < before.length && from < after.length && before[from] === after[from]) from++;
      let to = before.length;
      let end = after.length;
      while (to > from && end > from && before[to - 1] === after[end - 1]) { to--; end--; }
      if (from !== to || from !== end) view.dispatch({
        changes: { from, to, insert: after.slice(from, end) },
        annotations: isolateHistory.of('full'),
        userEvent: 'input.replace.all',
      });
      detail.applied = true;
    };
    window.addEventListener('heading-click', headingHandler);
    window.addEventListener('table-edit-request', tableHandler);
    window.addEventListener('editor-reveal-range', revealHandler);
    window.addEventListener('editor-replace-range', replaceHandler);
    window.addEventListener('editor-replace-content', contentEditHandler);
    return () => {
      window.removeEventListener('reader-show-format-toolbar', showToolbar);
      window.removeEventListener('heading-click', headingHandler);
      window.removeEventListener('table-edit-request', tableHandler);
      window.removeEventListener('editor-reveal-range', revealHandler);
      window.removeEventListener('editor-replace-range', replaceHandler);
      window.removeEventListener('editor-replace-content', contentEditHandler);
    };
  });
</script>

<div class="editor-wrapper h-full" class:focus-mode={$focusMode} class:typewriter-mode={$typewriterMode}>
  <CodeMirrorEditor
    bind:this={editor}
    onSelectionChange={handleSelectionChange}
    onSlashTrigger={handleSlashTrigger}
    onInteraction={() => {
      selection = null;
    }}
  />
</div>

<FloatingToolbar
  visible={selection !== null && ($settings.floatingToolbar === 'automatic' || ($settings.floatingToolbar === 'manual' && manualToolbar))}
  formatting={selection?.formatting}
  x={selection?.x || 0}
  y={selection?.y || 0}
  onAction={handleToolbarAction}
  onClose={(restoreFocus = true) => { selection = null; if (restoreFocus) editor?.focus(); }}
/>

<SlashMenu
  visible={slash !== null}
  x={slash?.x || 0}
  y={slash?.y || 0}
  query={slash?.query || ''}
  onSelect={applySlashItem}
  onClose={() => slash = null}
/>

<TablePicker
  visible={tablePickerVisible}
  x={tablePickerX}
  y={tablePickerY}
  onSelect={insertTable}
  onClose={closeTablePicker}
/>

<TableEditor
  bind:visible={tableEditorVisible}
  request={tableRequest}
  onConfirm={applyTable}
  onCancel={() => tableRequest = null}
/>

<style>
  .editor-wrapper {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
</style>
