<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import type { EditorContentEditRequest, EditorRevealRequest, TableEditRequest } from '$lib/types';
  import { isolateHistory } from '@codemirror/commands';
  import { activeSessionId } from '$lib/stores/document';
  import { focusMode, typewriterMode } from '$lib/stores/ui';
  import { selectionSource, selectionText } from '$lib/stores/editor-ui';
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
  let slash: SlashDetails | null = $state(null);
  let tablePickerVisible = $state(false);
  let tablePickerX = $state(0);
  let tablePickerY = $state(0);
  let tableEditorVisible = $state(false);
  let tableRequest: TableEditRequest | null = $state(null);

  const slashTemplates: Record<string, string> = {
    h1: '# ',
    h2: '## ',
    h3: '### ',
    code: '```\n\n```',
    latex: '$$\n\n$$',
    mermaid: '```mermaid\ngraph TD\n  A --> B\n```',
    quote: '> ',
    hr: '---',
    image: '![alt](url)',
    ul: '- ',
    ol: '1. ',
    task: '- [ ] ',
  };

  function handleSelectionChange(details: SelectionDetails | null): void {
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
      editor.replaceRange(range.from, range.to, '');
      tablePickerX = range.x;
      tablePickerY = range.y;
      tablePickerVisible = true;
      return;
    }
    editor.replaceRange(range.from, range.to, slashTemplates[item.id] || '');
  }

  function insertTable(rows: number, columns: number): void {
    tablePickerVisible = false;
    const header = `| ${Array.from({ length: columns }, (_, index) => `列 ${index + 1}`).join(' | ')} |`;
    const divider = `| ${Array.from({ length: columns }, () => '---').join(' | ')} |`;
    const body = Array.from({ length: rows }, () =>
      `| ${Array.from({ length: columns }, () => '').join(' | ')} |`,
    );
    editor?.insertText([header, divider, ...body].join('\n'));
  }

  function handleToolbarAction(action: string): void {
    if (!editor) return;
    if (action === 'table') {
      tablePickerX = selection?.x || 0;
      tablePickerY = selection?.y || 0;
      tablePickerVisible = true;
    } else if (action === 'bold') editor.wrapCurrentSelection('**', '**');
    else if (action === 'italic') editor.wrapCurrentSelection('*', '*');
    else if (action === 'strikethrough') editor.wrapCurrentSelection('~~', '~~');
    else if (action === 'code') editor.wrapCurrentSelection('`', '`');
    else if (action === 'link') editor.wrapCurrentSelection('[', '](url)');
    else if (action === 'h1') editor.prefixCurrentLine('# ');
    else if (action === 'h2') editor.prefixCurrentLine('## ');
    else if (action === 'quote') editor.prefixCurrentLine('> ');
    selection = null;
  }

  function applyTable(markdown: string): void {
    const request = tableRequest;
    const view = editor?.getView();
    if (!request || !view || request.sessionId !== get(activeSessionId)
      || !Number.isInteger(request.from) || !Number.isInteger(request.to)
      || request.from < 0 || request.to < request.from || request.to > view.state.doc.length
      || view.state.sliceDoc(request.from, request.to) !== request.markdown) {
      alert('表格所在文档已变化，请重新打开表格编辑器后再修改。');
      tableRequest = null;
      tableEditorVisible = false;
      return;
    }
    editor?.replaceRange(request.from, request.to, markdown);
    tableRequest = null;
    tableEditorVisible = false;
  }

  onMount(() => {
    const headingHandler = (event: Event) => {
      const line = (event as CustomEvent).detail?.line;
      if (line) {
        editor?.scrollToLine(line);
        editor?.focus();
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
      if (!detail || detail.sessionId !== get(activeSessionId)) return;
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
  visible={selection !== null}
  x={selection?.x || 0}
  y={selection?.y || 0}
  onAction={handleToolbarAction}
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
  onClose={() => tablePickerVisible = false}
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
