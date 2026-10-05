import { writable, derived, get } from 'svelte/store';
import type { DocumentSession } from '$lib/types';
import { normalizePathKey, pathContains, replacePathPrefix } from '$lib/utils/path';
import { documentStats } from '$lib/utils/document-stats';

export const sessions = writable<DocumentSession[]>([]);
export const activeSessionId = writable<string | null>(null);

export const activeSession = derived(
  [sessions, activeSessionId],
  ([$sessions, $activeSessionId]) => $sessions.find(s => s.id === $activeSessionId) || null
);

export const isEditing = derived(activeSession, session => session !== null);
export const currentFile = derived(activeSession, session => session?.path ?? null);
export const fileContent = derived(activeSession, session => session?.content ?? '');
export const isDirty = derived(activeSession, session => session?.isDirty ?? false);
export const fileName = derived(activeSession, session => session?.name ?? null);
export const fileExtension = derived(fileName, name => {
  if (!name) return null;
  const parts = name.split('.');
  return parts.length > 1 ? parts.pop()?.toLowerCase() || null : null;
});
export const documentStatistics = derived(fileContent, (content, set) => {
  const timer = setTimeout(() => set(documentStats(content)), 180);
  return () => clearTimeout(timer);
}, documentStats(''));
export const wordCount = derived(documentStatistics, stats => stats.words);
export const lineCount = derived(documentStatistics, stats => stats.lines);
export const charCount = derived(documentStatistics, stats => stats.chars);

let nextSessionId = 1;
const closedSessions: DocumentSession[] = [];

export function cycleSession(direction: number): void {
  const list = get(sessions);
  if (!list.length) return;
  const index = list.findIndex(session => session.id === get(activeSessionId));
  activeSessionId.set(list[(Math.max(index, 0) + direction + list.length) % list.length].id);
}

export function takeClosedSession(): DocumentSession | undefined { return closedSessions.pop(); }

export function createSession(
  name: string,
  path: string | null,
  content: string,
  savedContent: string = content,
  fileHandle?: any
): string {
  // 检查是否已经打开了同一个文件
  if (path) {
    const pathKey = normalizePathKey(path);
    const existing = get(sessions).find(s => s.path && normalizePathKey(s.path) === pathKey);
    if (existing) {
      const editorStateDoc = typeof existing.editorState?.doc?.toString === 'function'
        ? existing.editorState.doc.toString()
        : null;
      const hasStaleEditorState = editorStateDoc !== null && editorStateDoc !== content;
      const shouldRefreshCleanSession =
        !existing.isDirty &&
        (existing.content !== content ||
          existing.savedContent !== savedContent ||
          existing.name !== name ||
          hasStaleEditorState);

      if (shouldRefreshCleanSession) {
        sessions.update(list => list.map(s => s.id === existing.id
          ? {
              ...s,
              name,
              content,
              savedContent,
              contentVersion: (s.contentVersion ?? 0) + 1,
              isDirty: content !== savedContent,
              externalModified: false,
              externalContent: undefined,
              externalMissing: false,
              cursorOffset: Math.min(s.cursorOffset, content.length),
              fileHandle: fileHandle ?? s.fileHandle,
              editorState: undefined,
            }
          : s));
      }
      activeSessionId.set(existing.id);
      return existing.id;
    }
  }

  const id = `session-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${nextSessionId++}`}`;
  const newSession: DocumentSession = {
    id,
    name,
    path,
    content,
    savedContent,
    contentVersion: 0,
    isDirty: content !== savedContent,
    cursorOffset: 0,
    scrollTop: 0,
    previewScrollTop: 0,
    workspaceLayout: 'wysiwym',
    lastEditingLayout: 'wysiwym',
    externalModified: false,
    fileHandle,
  };

  sessions.update(list => [...list, newSession]);
  activeSessionId.set(id);
  return id;
}

export function closeSession(id: string) {
  sessions.update(list => {
    const index = list.findIndex(s => s.id === id);
    if (index === -1) return list;
    // Retain clean tabs only; explicitly discarded drafts must not reappear.
    if (!list[index].isDirty && (list[index].path || list[index].fileHandle)) {
      closedSessions.push({ ...list[index], editorState: undefined });
      if (closedSessions.length > 20) closedSessions.shift();
    }

    const newList = list.filter(s => s.id !== id);

    // 如果关闭的是当前激活的标签，切换到相邻标签
    const currentActiveId = get(activeSessionId);
    if (currentActiveId === id) {
      if (newList.length === 0) {
        activeSessionId.set(null);
      } else {
        const nextIndex = Math.min(index, newList.length - 1);
        activeSessionId.set(newList[nextIndex].id);
      }
    }

    return newList;
  });
}

export function setActiveSession(id: string | null) {
  activeSessionId.set(id);
}

export function updateSessionContent(id: string, content: string) {
  sessions.update(list => {
    const index = list.findIndex(session => session.id === id);
    if (index < 0 || list[index].content === content) return list;
    const matchesExternal = list[index].externalModified
      && !list[index].externalMissing
      && list[index].externalContent === content;
    const next = [...list];
    next[index] = matchesExternal
      ? {
          ...list[index],
          content,
          contentVersion: (list[index].contentVersion ?? 0) + 1,
          savedContent: content,
          isDirty: false,
          externalModified: false,
          externalContent: undefined,
          externalMissing: false,
        }
      : { ...list[index], content, contentVersion: (list[index].contentVersion ?? 0) + 1, isDirty: content !== list[index].savedContent };
    return next;
  });
}

export function updateActiveSessionContent(content: string) {
  const id = get(activeSessionId);
  if (id) updateSessionContent(id, content);
}

export function updateActiveSessionFileHandle(fileHandle: FileSystemFileHandle | null) {
  const id = get(activeSessionId);
  if (!id) return;
  sessions.update(list => list.map(session => session.id === id
    ? { ...session, fileHandle: fileHandle ?? undefined }
    : session));
}

export function updateSessionSavedContent(id: string, savedContent: string) {
  sessions.update(list =>
    list.map(s =>
      s.id === id
        ? {
            ...s,
            savedContent,
            isDirty: s.content !== savedContent,
            externalModified: false,
            externalContent: undefined,
            externalMissing: false,
          }
        : s
    )
  );
}

export function updateSessionCursor(id: string, cursorOffset: number) {
  sessions.update(list => {
    const index = list.findIndex(session => session.id === id);
    if (index < 0 || list[index].cursorOffset === cursorOffset) return list;
    const next = [...list];
    next[index] = { ...list[index], cursorOffset };
    return next;
  });
}

export function updateSessionScroll(id: string, scrollTop: number, editorAnchor?: DocumentSession['editorAnchor']) {
  sessions.update(list => {
    const index = list.findIndex(session => session.id === id);
    if (index < 0 || (!editorAnchor && Math.abs(list[index].scrollTop - scrollTop) < 0.5)) return list;
    const next = [...list];
    next[index] = { ...list[index], scrollTop, editorAnchor: editorAnchor ?? list[index].editorAnchor };
    return next;
  });
}

export function updateSessionPreviewScroll(id: string, previewScrollTop: number, previewAnchor?: DocumentSession['previewAnchor']) {
  sessions.update(list => {
    const index = list.findIndex(session => session.id === id);
    if (index < 0 || (!previewAnchor && Math.abs((list[index].previewScrollTop ?? 0) - previewScrollTop) < 0.5)) return list;
    const next = [...list];
    next[index] = { ...list[index], previewScrollTop, previewAnchor: previewAnchor ?? list[index].previewAnchor };
    return next;
  });
}

export function refreshSessionFromDisk(id: string, content: string) {
  sessions.update(list =>
    list.map(s =>
      s.id === id
        ? {
            ...s,
            content,
            savedContent: content,
            contentVersion: (s.contentVersion ?? 0) + 1,
            isDirty: false,
            saveState: undefined,
            saveError: undefined,
            externalModified: false,
            externalContent: undefined,
            externalMissing: false,
            externalReadError: undefined,
            cursorOffset: Math.min(s.cursorOffset, content.length),
            editorState: undefined,
          }
        : s
    )
  );
}

export function markSessionExternalModified(
  id: string,
  externalContent?: string,
  externalMissing = false,
  externalReadError?: string,
) {
  sessions.update(list => {
    const index = list.findIndex(session => session.id === id);
    if (index < 0) return list;
    const current = list[index];
    if (
      current.externalModified
      && current.externalContent === externalContent
      && current.externalMissing === externalMissing
      && current.externalReadError === externalReadError
    ) return list;
    const next = [...list];
    next[index] = { ...current, externalModified: true, externalContent, externalMissing, externalReadError };
    return next;
  });
}

export function updateSessionPath(
  id: string,
  path: string,
  name: string,
  fileHandle?: any
) {
  sessions.update(list =>
    list.map(s =>
      s.id === id
        ? {
            ...s,
            path,
            name,
            fileHandle,
            externalModified: false,
            externalContent: undefined,
            externalMissing: false,
          }
        : s
    )
  );
}

export function renameSessionPaths(oldPath: string, newPath: string) {
  sessions.update(list => {
    let changed = false;
    const next = list.map(session => {
      if (!session.path || !pathContains(oldPath, session.path)) return session;
      changed = true;
      const path = replacePathPrefix(session.path, oldPath, newPath);
      const name = path.split(/[/\\]/).pop() || session.name;
      return {
        ...session,
        path,
        name,
        fileHandle: typeof session.fileHandle === 'string' ? path : session.fileHandle,
      };
    });
    return changed ? next : list;
  });
}

export function markSessionsMissingUnderPath(path: string) {
  sessions.update(list => {
    let changed = false;
    const next = list.map(session => {
      if (!session.path || !pathContains(path, session.path) || session.externalMissing) return session;
      changed = true;
      return {
        ...session,
        externalModified: true,
        externalContent: undefined,
        externalMissing: true,
        externalReadError: undefined,
      };
    });
    return changed ? next : list;
  });
}
