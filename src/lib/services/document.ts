import { get, writable } from 'svelte/store';
import {
  sessions,
  activeSessionId,
  createSession,
  closeSession,
  refreshSessionFromDisk,
  markSessionExternalModified,
  markSessionsMissingUnderPath,
} from '$lib/stores/document';
import { saveFile as fsSaveFile, openFile as fsOpenFile, readFile as fsReadFile, type SaveTarget } from '$lib/utils/native-fs';
import { RecoveryService, type RecoverySnapshot } from './recovery';
import { normalizePathKey, pathContains } from '$lib/utils/path';
import { asFileError } from '$lib/utils/file-error';

export interface ConfirmCloseOptions {
  fileName: string;
  onResolve: (action: 'save' | 'dontsave' | 'cancel') => void;
}

export const closeConfirmDialog = writable<ConfirmCloseOptions | null>(null);

export class DocumentService {
  private static operations = new Map<string, Promise<boolean>>();
  private static closing = new Map<string, Promise<boolean>>();
  private static closeQueue: Promise<void> = Promise.resolve();
  private static closingAll: Promise<boolean> | null = null;
  private static deletingPaths = new Set<string>();
  private static saveTargets = new Set<string>();

  private static isDeleting(path: string | null): boolean {
    return !!path && [...this.deletingPaths].some(root => pathContains(root, path));
  }

  static async deleteEntry(path: string, permanent: boolean, isDirectory: boolean, remove: () => Promise<void>): Promise<boolean> {
    if ([...this.deletingPaths].some(root => pathContains(root, path) || pathContains(path, root))) return false;
    this.deletingPaths.add(path);
    try {
      const affected = () => get(sessions).filter(s => s.path && pathContains(path, s.path));
      for (const session of affected()) await this.waitForSessionOperations(session.id);
      for (const [key, pending] of this.operations) {
        if (key.startsWith('file:') && pathContains(path, key.slice(5))) await pending;
      }
      const open = affected();
      const dirty = open.filter(s => s.isDirty);
      const action = permanent ? '永久删除（不可撤销）' : '移入系统回收站';
      const scope = isDirectory ? '文件夹及其全部内容' : '文件';
      const warning = `将${scope} ${path} ${action}？\n\n影响 ${open.length} 个已打开标签，其中 ${dirty.length} 个有未保存修改。\n标签内容会保留，删除后可另存为。`;
      if (!confirm(warning)) return false;
      for (const session of affected().filter(s => s.isDirty)) {
        if (!RecoveryService.saveSnapshot(session)) throw new Error('无法备份未保存内容，已取消删除。');
      }
      await remove();
      markSessionsMissingUnderPath(path);
      return true;
    } finally {
      this.deletingPaths.delete(path);
    }
  }

  private static enqueue(id: string, operation: () => Promise<boolean>): Promise<boolean> {
    const previous = this.operations.get(id) ?? Promise.resolve(true);
    const pending = previous.then(operation, operation).finally(() => {
      if (this.operations.get(id) === pending) this.operations.delete(id);
    });
    this.operations.set(id, pending);
    return pending;
  }

  static async waitForSessionOperations(id: string): Promise<void> {
    while (this.operations.has(id)) await this.operations.get(id);
  }

  static hasPendingOperations(): boolean {
    return this.operations.size > 0;
  }

  static async autoSaveSession(id: string): Promise<boolean> {
    if (this.operations.has(id) || this.closing.has(id) || this.closingAll) return false;
    const session = get(sessions).find(item => item.id === id);
    if (!session?.isDirty || session.externalModified || (!session.path && !session.fileHandle)) return false;
    return this.enqueue(id, async () => {
      const latest = get(sessions).find(item => item.id === id);
      if (!latest?.isDirty || latest.externalModified) return false;
      return this.performSave(id, false);
    });
  }

  static async replaceDiskContent(path: string, expected: string, content: string): Promise<'saved' | 'skipped'> {
    if (this.closingAll || this.isDeleting(path)) return 'skipped';
    const key = normalizePathKey(path);
    const findSession = () => get(sessions).find(s => s.path && normalizePathKey(s.path) === key);
    const initial = findSession();
    let saved = false;
    await this.enqueue(initial?.id ?? `file:${key}`, async () => {
      if (this.isDeleting(path)) return false;
      const before = findSession();
      if (before && this.closing.has(before.id)) return false;
      if (before && (before.isDirty || before.externalModified || before.content !== expected)) return false;
      const { writeFile } = await import('$lib/utils/tauri-fs');
      if (this.isDeleting(path)) return false;
      const current = findSession();
      if (current && (current.isDirty || current.externalModified || current.content !== expected)) return false;
      if (!RecoveryService.saveCheckpoint(path, expected)) throw new Error('替换前恢复点保存失败，文件未修改。');
      await writeFile(path, content, expected);
      saved = true;
      const latest = findSession();
      if (latest) {
        if (latest.content === expected && !latest.isDirty) refreshSessionFromDisk(latest.id, content);
        else markSessionExternalModified(latest.id, content);
      }
      return true;
    });
    return saved ? 'saved' : 'skipped';
  }

  static createNewSession(name = 'untitled.md'): string {
    return createSession(name, null, '');
  }

  static restoreSnapshotAsCopy(snapshot: RecoverySnapshot): string {
    const name = snapshot.name.replace(/(\.[^.]+)?$/, ' (恢复副本)$1');
    const id = createSession(name, null, snapshot.content, '');
    sessions.update(list => list.map(session => session.id === id ? {
      ...session, cursorOffset: Math.min(snapshot.content.length, snapshot.cursorOffset), scrollTop: snapshot.scrollTop,
    } : session));
    const restored = get(sessions).find(session => session.id === id);
    if (restored) RecoveryService.saveSnapshot(restored);
    // The original stays available even if persisting the new copy fails.
    return id;
  }

  /**
   * 保存会话
   */
  static saveSession(id: string): Promise<boolean> {
    return this.enqueue(id, () => this.performSave(id, false));
  }

  static saveSessionAs(id: string): Promise<boolean> {
    return this.enqueue(id, () => this.performSave(id, true));
  }

  private static async performSave(id: string, saveAs: boolean): Promise<boolean> {
    const session = get(sessions).find(s => s.id === id);
    if (!session) return false;
    if (this.isDeleting(session.path)) return false;

    if (
      !saveAs && session.externalModified
      && !confirm(session.externalReadError
        ? '当前无法确认磁盘版本。继续保存可能覆盖外部修改，是否继续？'
        : '磁盘文件已被外部修改。继续保存将覆盖外部版本，是否继续？')
    ) return false;

    let reservedTarget: string | null = null;
    const validateTarget = async (target: SaveTarget): Promise<boolean> => {
      const key = target.path ? `path:${normalizePathKey(target.path)}` : `handle:${target.name.toLocaleLowerCase()}`;
      if (this.saveTargets.has(key)) {
        alert('另一个保存操作正在写入同一目标，请等待完成后重试。');
        return false;
      }
      for (const other of get(sessions)) {
        if (other.id === id) continue;
        let same = !!(target.path && other.path && normalizePathKey(target.path) === normalizePathKey(other.path));
        if (!same && target.handle && other.fileHandle) {
          if (target.handle === other.fileHandle) same = true;
          else if (typeof target.handle.isSameEntry === 'function') {
            try { same = await target.handle.isSameEntry(other.fileHandle); } catch {}
          }
        }
        if (same) {
          activeSessionId.set(other.id);
          alert(`目标文件已在标签“${other.name}”中打开。为避免产生两个竞争版本，另存为已取消。`);
          return false;
        }
      }
      if (target.existed && !confirm(`目标文件“${target.name}”已存在。确认覆盖当前磁盘版本？`)) return false;
      this.saveTargets.add(key);
      reservedTarget = key;
      return true;
    };

    sessions.update(list => list.map(s => s.id === id ? { ...s, saveState: 'saving' as const, saveError: undefined } : s));
    try {
      const handle = saveAs ? undefined : session.fileHandle || session.path || undefined;
      const expected = !saveAs && handle && !session.externalModified ? session.savedContent : undefined;
      const result = saveAs
        ? await fsSaveFile(session.name, session.content, handle, expected, validateTarget)
        : await fsSaveFile(session.name, session.content, handle, expected);
      if (!result) return false;
      if (result.downloaded) {
        alert('已下载文件副本。浏览器无法确认原文件已保存，当前修改仍保留为未保存状态。');
        return false;
      }
      const latest = get(sessions).find(s => s.id === id);
      if (!latest || latest.path !== session.path || latest.fileHandle !== session.fileHandle) {
        if (latest?.isDirty) RecoveryService.saveSnapshot(latest);
        return false;
      }
      const path = result.path ?? (saveAs ? null : latest.path);
      const fileHandle = result.handle ?? (saveAs ? undefined : latest.fileHandle);
      const name = result.handle?.name || path?.split(/[/\\]/).pop() || latest.name;
      const newConflict = path === session.path && fileHandle === session.fileHandle
        && latest.externalModified && latest.externalContent !== session.content
        && (!session.externalModified || latest.externalContent !== session.externalContent
          || latest.externalMissing !== session.externalMissing || latest.externalReadError !== session.externalReadError);
      // Commit the saved baseline without discarding edits made while writing.
      sessions.update(list => list.map(s => s.id === id ? {
        ...s,
        path,
        fileHandle,
        name,
        savedContent: session.content,
        saveState: undefined,
        saveError: undefined,
        isDirty: s.content !== session.content,
        externalModified: newConflict,
        externalContent: newConflict ? s.externalContent : undefined,
        externalMissing: newConflict ? s.externalMissing : false,
        externalReadError: newConflict ? s.externalReadError : undefined,
      } : s));
      const saved = get(sessions).find(s => s.id === id);
      if (saved?.isDirty) RecoveryService.saveSnapshot(saved);
      else RecoveryService.removeSnapshot(id);
      return !newConflict;
    } catch (e) {
      console.error('Failed to save file:', e);
      const failure = asFileError(e);
      sessions.update(list => list.map(s => s.id === id ? { ...s, saveState: 'error' as const, saveError: failure.message } : s));
      if (failure.code === 'conflict' || failure.code === 'not_found') {
        const latest = get(sessions).find(s => s.id === id);
        if (latest?.path === session.path && latest?.fileHandle === session.fileHandle) {
          markSessionExternalModified(id, undefined, failure.code === 'not_found');
        }
      }
      alert(`保存文件失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (reservedTarget) this.saveTargets.delete(reservedTarget);
      sessions.update(list => list.map(s => s.id === id && s.saveState === 'saving'
        ? { ...s, saveState: session.saveState === 'error' ? 'error' as const : undefined, saveError: session.saveError }
        : s));
    }
    return false;
  }

  /**
   * 打开文件
   */
  static async openFile(): Promise<string | null> {
    try {
      const result = await fsOpenFile();
      if (result) {
        const sessionId = createSession(result.name, result.path || null, result.content, result.content, result.handle);
        return sessionId;
      }
    } catch (e) {
      console.error('Failed to open file:', e);
      alert(`打开文件失败: ${e instanceof Error ? e.message : String(e)}`);
    }
    return null;
  }

  static async openPath(path: string): Promise<string | null> {
    try {
      const content = await fsReadFile(path);
      const name = path.split(/[/\\]/).pop() || path;
      return createSession(name, path, content, content, path);
    } catch (e) {
      console.error('Failed to open path:', e);
      alert(`打开文件失败: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  static reloadSessionFromDisk(id: string): Promise<boolean> {
    return this.enqueue(id, () => this.performReload(id));
  }

  private static async performReload(id: string): Promise<boolean> {
    const session = get(sessions).find(item => item.id === id);
    const reference = session?.fileHandle || session?.path;
    if (!session || !reference) return false;
    if (session.isDirty && !confirm('重新载入将丢弃当前未保存的修改，是否继续？')) {
      return false;
    }

    try {
      const content = await fsReadFile(reference);
      const latest = get(sessions).find(s => s.id === id);
      if (!latest || latest.path !== session.path || latest.fileHandle !== session.fileHandle) return false;
      if (latest.contentVersion !== session.contentVersion || latest.content !== session.content) {
        markSessionExternalModified(id, content);
        return false;
      }
      refreshSessionFromDisk(id, content);
      return true;
    } catch (e) {
      console.error('Failed to reload file:', e);
      alert(`重新载入失败: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  /**
   * 提示未保存并关闭特定会话
   */
  static closeSessionWithPrompt(id: string): Promise<boolean> {
    const existing = this.closing.get(id);
    if (existing) return existing;
    const pending = this.closeQueue.then(() => this.performClose(id)).finally(() => {
      this.closing.delete(id);
    });
    this.closing.set(id, pending);
    this.closeQueue = pending.then(() => undefined, () => undefined);
    return pending;
  }

  private static async performClose(id: string): Promise<boolean> {
    while (true) {
      await this.waitForSessionOperations(id);
      const session = get(sessions).find(s => s.id === id);
      if (!session) return true;
      if (session.isDirty) {
        const choice = await new Promise<'save' | 'dontsave' | 'cancel'>(resolve => {
          let resolved = false;
          closeConfirmDialog.set({
            fileName: session.name,
            onResolve: action => {
              if (resolved) return;
              resolved = true;
              closeConfirmDialog.set(null);
              resolve(action);
            },
          });
        });
        if (choice === 'cancel') return false;
        if (choice === 'save') {
          if (!await this.saveSession(id)) return false;
          continue;
        }
        await this.waitForSessionOperations(id);
        const latest = get(sessions).find(s => s.id === id);
        if (latest && (latest.contentVersion !== session.contentVersion || latest.content !== session.content
          || latest.path !== session.path || latest.fileHandle !== session.fileHandle)) continue;
      }
      closeSession(id);
      RecoveryService.removeSnapshot(id);
      return true;
    }
  }

  /**
   * 关闭所有会话并提示
   */
  static closeAllSessionsWithPrompt(): Promise<boolean> {
    if (this.closingAll) return this.closingAll;
    this.closingAll = (async () => {
      while (get(sessions).length > 0 || this.operations.size > 0) {
        if (get(sessions).length === 0) {
          await Promise.allSettled([...this.operations.values()]);
          continue;
        }
        const session = get(sessions)[0];
        activeSessionId.set(session.id);
        if (!await this.closeSessionWithPrompt(session.id)) return false;
      }
      return true;
    })().finally(() => { this.closingAll = null; });
    return this.closingAll;
  }
}

// 自动为所有会话的内容变更保存恢复快照
if (typeof window !== 'undefined') {
  let knownSessionIds = new Set<string>();
  sessions.subscribe(($sessions) => {
    const currentIds = new Set($sessions.map(session => session.id));
    knownSessionIds.forEach(id => {
      if (!currentIds.has(id)) RecoveryService.removeSnapshot(id);
    });
    $sessions.forEach(s => {
      RecoveryService.scheduleSnapshot(s);
    });
    knownSessionIds = currentIds;
  });
}
