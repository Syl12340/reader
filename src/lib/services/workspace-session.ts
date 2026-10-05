import { get } from 'svelte/store';
import { sessions, activeSessionId, createSession } from '$lib/stores/document';
import { currentDirectory } from '$lib/stores/file';
import { readFile } from '$lib/utils/native-fs';
import { isTauri } from '$lib/utils/platform';
import { WorkspaceService } from './workspace';
import type { DocumentSession, WorkspaceLayout } from '$lib/types';

type Tab = Pick<DocumentSession, 'path' | 'cursorOffset' | 'scrollTop' | 'previewScrollTop' | 'workspaceLayout' | 'lastEditingLayout' | 'editorAnchor' | 'previewAnchor'>;
export interface WorkspaceSnapshot { version: 1; directory: string | null; activePath: string | null; tabs: Tab[] }
const layouts = new Set<WorkspaceLayout>(['wysiwym', 'source', 'preview', 'wysiwym-preview', 'source-preview']);
export function workspaceSnapshot(list: DocumentSession[], active: string | null, directory: string | null): WorkspaceSnapshot {
  return { version: 1, directory, activePath: list.find(tab => tab.id === active)?.path ?? null,
    tabs: list.filter(tab => tab.path).map(tab => ({ path: tab.path, cursorOffset: tab.cursorOffset,
      scrollTop: tab.scrollTop, previewScrollTop: tab.previewScrollTop ?? 0,
      workspaceLayout: tab.workspaceLayout, lastEditingLayout: tab.lastEditingLayout,
      editorAnchor: tab.editorAnchor, previewAnchor: tab.previewAnchor })) };
}

export function parseWorkspaceSnapshot(value: string | null): WorkspaceSnapshot | null {
  try {
    const snapshot = JSON.parse(value || 'null');
    if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.tabs)) return null;
    const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
    const anchor = (value: unknown, key: 'from' | 'line') => {
      if (!value || typeof value !== 'object') return undefined;
      const item = value as Record<string, unknown>;
      return typeof item[key] === 'number' && Number.isFinite(item[key]) && (item[key] as number) >= 0
        && typeof item.offset === 'number' && Number.isFinite(item.offset)
        ? { [key]: Math.floor(item[key] as number), offset: item.offset } : undefined;
    };
    return { version: 1, directory: typeof snapshot.directory === 'string' ? snapshot.directory : null,
      activePath: typeof snapshot.activePath === 'string' ? snapshot.activePath : null,
      tabs: snapshot.tabs.filter((tab: Tab | null) => tab && typeof tab.path === 'string' && tab.path.length > 0).slice(0, 100).map((tab: Tab) => ({
        path: tab.path, cursorOffset: number(tab.cursorOffset), scrollTop: number(tab.scrollTop), previewScrollTop: number(tab.previewScrollTop),
        editorAnchor: anchor(tab.editorAnchor, 'from') as Tab['editorAnchor'], previewAnchor: anchor(tab.previewAnchor, 'line') as Tab['previewAnchor'],
        workspaceLayout: layouts.has(tab.workspaceLayout!) ? tab.workspaceLayout : 'wysiwym',
        lastEditingLayout: tab.lastEditingLayout !== ('preview' as string) && layouts.has(tab.lastEditingLayout!) ? tab.lastEditingLayout : 'wysiwym',
      })) };
  } catch { return null; }
}

export class WorkspaceSessionService {
  private static key = '';
  private static snapshot: WorkspaceSnapshot | null = null;
  private static timer: ReturnType<typeof setTimeout> | null = null;
  private static paused = false;
  private static disposed = false;
  private static closingTabs = new Map<string, Tab>();
  private static closingActive: string | null = null;

  static async start(skipRestore = false): Promise<() => void> {
    this.disposed = false;
    this.paused = false;
    this.key = '';
    this.snapshot = null;
    this.closingTabs.clear();
    this.closingActive = null;
    // Browser file handles are not serialized or reauthorized without a gesture.
    if (!isTauri()) return () => {};
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    if (this.disposed) return () => {};
    this.key = `reader-workspace-v1:${getCurrentWindow().label}`;
    const stored = parseWorkspaceSnapshot(localStorage.getItem(this.key));
    if (!skipRestore && stored && !get(sessions).length) {
      if (stored.directory) await WorkspaceService.openPath(stored.directory);
      let restoredActive: string | null = null;
      for (const tab of stored.tabs) {
        if (this.disposed || get(activeSessionId) !== restoredActive) break;
        try {
          const content = await readFile(tab.path!);
          if (this.disposed || get(activeSessionId) !== restoredActive) break;
          const id = createSession(tab.path!.split(/[/\\]/).pop()!, tab.path, content, content, tab.path);
          restoredActive = id;
          sessions.update(list => list.map(session => session.id === id ? { ...session, ...tab,
            cursorOffset: Math.min(tab.cursorOffset, content.length) } : session));
        } catch (error) { console.warn('Skipped unavailable restored file:', tab.path, error); }
      }
      const active = get(sessions).find(tab => tab.path === stored.activePath);
      if (active && get(activeSessionId) === restoredActive) activeSessionId.set(active.id);
    }
    if (this.disposed) return () => {};
    const update = () => {
      const next = workspaceSnapshot(get(sessions), get(activeSessionId), get(currentDirectory));
      if (this.paused && this.snapshot) {
        for (const session of get(sessions)) {
          const metadata = workspaceSnapshot([session], session.id, null).tabs[0];
          if (metadata) this.closingTabs.set(session.id, metadata);
        }
        next.tabs = [...this.closingTabs.values()];
        next.activePath = this.closingActive ? this.closingTabs.get(this.closingActive)?.path ?? null : null;
      }
      this.snapshot = next;
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => this.flush(), 250);
    };
    const cleanups = [sessions.subscribe(update), activeSessionId.subscribe(update), currentDirectory.subscribe(update)];
    window.addEventListener('beforeunload', this.flush);
    return () => { this.flush(); this.disposed = true; cleanups.forEach(cleanup => cleanup()); window.removeEventListener('beforeunload', this.flush); };
  }

  static flush = () => {
    if (WorkspaceSessionService.timer) clearTimeout(WorkspaceSessionService.timer);
    WorkspaceSessionService.timer = null;
    if (!WorkspaceSessionService.key || !WorkspaceSessionService.snapshot) return;
    try { localStorage.setItem(WorkspaceSessionService.key, JSON.stringify(WorkspaceSessionService.snapshot)); }
    catch (error) { console.warn('Workspace state could not be persisted:', error); }
  };
  static pauseForClose() {
    this.flush(); this.paused = true;
    this.closingActive = get(activeSessionId);
    this.closingTabs.clear();
    for (const session of get(sessions)) {
      const metadata = workspaceSnapshot([session], session.id, null).tabs[0];
      if (metadata) this.closingTabs.set(session.id, metadata);
    }
  }
  static resume(keepClosingSnapshot = false) {
    this.paused = false;
    this.closingTabs.clear();
    this.closingActive = null;
    if (!keepClosingSnapshot) {
      this.snapshot = workspaceSnapshot(get(sessions), get(activeSessionId), get(currentDirectory));
      this.flush();
    }
  }
  static dispose() { this.disposed = true; }
}
