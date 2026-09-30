import { derived, get, writable } from 'svelte/store';
import type { EditorMode, TableEditRequest, WorkspaceLayout } from '$lib/types';
import { activeSession, activeSessionId, sessions } from './document';

const defaultLayout = writable<WorkspaceLayout>('wysiwym');
const layoutValue = derived([activeSession, defaultLayout], ([session, fallback]) => session?.workspaceLayout ?? fallback);
function setLayout(layout: WorkspaceLayout) {
  const id = get(activeSessionId);
  if (!id) { defaultLayout.set(layout); return; }
  sessions.update(list => list.map(session => session.id === id ? {
    ...session,
    workspaceLayout: layout,
    lastEditingLayout: layout === 'preview'
      ? session.lastEditingLayout ?? (session.workspaceLayout !== 'preview' ? session.workspaceLayout : undefined) ?? 'wysiwym'
      : layout,
  } : session));
}
export const workspaceLayout = {
  subscribe: layoutValue.subscribe,
  set: setLayout,
  update: (updater: (layout: WorkspaceLayout) => WorkspaceLayout) => setLayout(updater(get(layoutValue))),
};
export const editorMode = derived(workspaceLayout, (layout): EditorMode => {
  if (layout === 'preview') return 'preview';
  return layout.startsWith('source') ? 'source' : 'wysiwym';
});
export const splitPreviewVisible = derived(
  workspaceLayout,
  layout => layout === 'wysiwym-preview' || layout === 'source-preview',
);
export const tableEditRequest = writable<TableEditRequest | null>(null);

export function setEditorMode(mode: EditorMode) {
  workspaceLayout.set(mode);
}

export function toggleReadMode() {
  workspaceLayout.update(layout => layout === 'preview' ? get(activeSession)?.lastEditingLayout ?? 'wysiwym' : 'preview');
}

export function toggleSplitPreview() {
  workspaceLayout.update(layout => {
    if (layout === 'wysiwym-preview') return 'wysiwym';
    if (layout === 'source-preview') return 'source';
    if (layout === 'source') return 'source-preview';
    if (layout === 'preview') {
      return get(activeSession)?.lastEditingLayout?.startsWith('source') ? 'source-preview' : 'wysiwym-preview';
    }
    return 'wysiwym-preview';
  });
}

// ── 打字机模式 ──
export const typewriterMode = writable(false);

// ── 专注模式 ──
export const focusMode = writable(false);

// ── 全局搜索面板开关 ──
export const globalSearchOpen = writable(false);

// ── 悬浮工具栏开关 ──
export const floatingToolbarVisible = writable(false);

// ── 斜杠菜单开关 ──
export const slashMenuVisible = writable(false);

// ── 表格选择器开关 ──
export const tablePickerVisible = writable(false);
