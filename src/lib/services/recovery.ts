import type { DocumentSession } from '$lib/types';
import { writable } from 'svelte/store';

const PREFIX = 'reader_recovery_';
const CHECKPOINT_PREFIX = 'reader_checkpoint_';
const SNAPSHOT_DELAY_MS = 750;
export const recoveryStorageError = writable<string | null>(null);

function reportStorageError(message: string, error: unknown) {
  recoveryStorageError.set(`${message}: ${error instanceof Error ? error.message : String(error)}`);
}

export interface RecoverySnapshot {
  id: string;
  name: string;
  path: string | null;
  content: string;
  savedContent: string;
  cursorOffset: number;
  scrollTop: number;
  savedAt?: number;
  kind?: 'draft' | 'checkpoint';
}

export interface RecoveryStorageUsage {
  entries: number;
  checkpoints: number;
  bytes: number;
}

class RecoveryManager {
  private pending = new Map<string, ReturnType<typeof setTimeout>>();
  private scheduledContent = new Map<string, Pick<DocumentSession, 'content' | 'path' | 'name' | 'savedContent'>>();
  private persistedContent = new Map<string, Pick<DocumentSession, 'content' | 'path' | 'name' | 'savedContent'>>();

  scheduleSnapshot(session: DocumentSession) {
    if (typeof window === 'undefined') return;
    if (!session.isDirty) {
      if (this.pending.has(session.id) || this.scheduledContent.has(session.id)) {
        this.removeSnapshot(session.id);
      }
      return;
    }

    const previous = this.scheduledContent.get(session.id);
    if (previous?.content === session.content && previous.path === session.path
      && previous.name === session.name && previous.savedContent === session.savedContent) return;
    this.scheduledContent.set(session.id, {
      content: session.content, path: session.path, name: session.name, savedContent: session.savedContent,
    });

    const existing = this.pending.get(session.id);
    if (existing) clearTimeout(existing);
    const snapshot = { ...session };
    this.pending.set(session.id, setTimeout(() => {
      this.pending.delete(session.id);
      this.saveSnapshot(snapshot);
    }, SNAPSHOT_DELAY_MS));
  }

  saveSnapshot(session: DocumentSession): boolean {
    if (typeof window === 'undefined') return false;
    const pending = this.pending.get(session.id);
    if (pending) clearTimeout(pending);
    this.pending.delete(session.id);
    if (!session.isDirty) {
      return this.removeSnapshot(session.id);
    }
    try {
      const key = `${PREFIX}${session.id}`;
      const previous = this.persistedContent.get(session.id);
      if (previous?.content === session.content && previous.path === session.path
        && previous.name === session.name && previous.savedContent === session.savedContent
        && localStorage.getItem(key) !== null) return true;
      const data = {
        id: session.id,
        name: session.name,
        path: session.path,
        content: session.content,
        savedContent: session.savedContent,
        cursorOffset: session.cursorOffset,
        scrollTop: session.scrollTop,
        savedAt: Date.now(),
      };
      localStorage.setItem(key, JSON.stringify(data));
      this.scheduledContent.set(session.id, {
        content: session.content, path: session.path, name: session.name, savedContent: session.savedContent,
      });
      this.persistedContent.set(session.id, {
        content: session.content, path: session.path, name: session.name, savedContent: session.savedContent,
      });
      return true;
    } catch (e) {
      this.scheduledContent.delete(session.id);
      this.persistedContent.delete(session.id);
      console.error('Failed to save document snapshot:', e);
      reportStorageError('恢复快照未保存，请及时保存文档', e);
      return false;
    }
  }

  removeSnapshot(id: string): boolean {
    if (typeof window === 'undefined') return false;
    const pending = this.pending.get(id);
    if (pending) clearTimeout(pending);
    this.pending.delete(id);
    this.scheduledContent.delete(id);
    this.persistedContent.delete(id);
    try {
      localStorage.removeItem(`${PREFIX}${id}`);
      return true;
    } catch (error) {
      reportStorageError('无法删除恢复快照', error);
      return false;
    }
  }

  getSnapshots(): RecoverySnapshot[] {
    return this.readSnapshots(PREFIX, 'draft');
  }

  getRecoveryItems(): RecoverySnapshot[] {
    return [...this.getSnapshots(), ...this.readSnapshots(CHECKPOINT_PREFIX, 'checkpoint')]
      .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
  }

  saveCheckpoint(path: string, content: string): boolean {
    if (typeof window === 'undefined') return false;
    try {
      const id = globalThis.crypto.randomUUID();
      const data: RecoverySnapshot = {
        id, path, name: path.split(/[/\\]/).pop() || path,
        content, savedContent: '', cursorOffset: 0, scrollTop: 0,
        savedAt: Date.now(), kind: 'checkpoint',
      };
      localStorage.setItem(`${CHECKPOINT_PREFIX}${id}`, JSON.stringify(data));
      return true;
    } catch (error) {
      reportStorageError('无法保存替换前恢复点，已阻止本次文件写入', error);
      return false;
    }
  }

  removeRecoveryItem(item: RecoverySnapshot): boolean {
    if (item.kind !== 'checkpoint') return this.removeSnapshot(item.id);
    try {
      localStorage.removeItem(`${CHECKPOINT_PREFIX}${item.id}`);
      return true;
    } catch (error) {
      reportStorageError('无法删除恢复点', error);
      return false;
    }
  }

  getStorageUsage(): RecoveryStorageUsage {
    const usage: RecoveryStorageUsage = { entries: 0, checkpoints: 0, bytes: 0 };
    if (typeof window === 'undefined') return usage;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || (!key.startsWith(PREFIX) && !key.startsWith(CHECKPOINT_PREFIX))) continue;
        const value = localStorage.getItem(key) ?? '';
        usage.entries++;
        if (key.startsWith(CHECKPOINT_PREFIX)) usage.checkpoints++;
        usage.bytes += (key.length + value.length) * 2;
      }
    } catch (error) {
      reportStorageError('无法统计恢复存储', error);
    }
    return usage;
  }

  clearCheckpoints(): number {
    if (typeof window === 'undefined') return 0;
    const keys: string[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(CHECKPOINT_PREFIX)) keys.push(key);
      }
      keys.forEach(key => localStorage.removeItem(key));
      return keys.length;
    } catch (error) {
      reportStorageError('无法清理替换前恢复点', error);
      return 0;
    }
  }

  private readSnapshots(prefix: string, kind: 'draft' | 'checkpoint'): RecoverySnapshot[] {
    if (typeof window === 'undefined') return [];
    const snapshots: RecoverySnapshot[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(prefix)) {
          try {
            const val = localStorage.getItem(key);
            if (!val) continue;
            const data = JSON.parse(val);
            if (!data || typeof data.id !== 'string' || key !== `${prefix}${data.id}`
              || typeof data.name !== 'string' || typeof data.content !== 'string'
              || typeof data.savedContent !== 'string'
              || (data.path !== null && typeof data.path !== 'string')) {
              throw new Error('Invalid recovery snapshot');
            }
            snapshots.push({ ...data, kind,
              savedAt: Number.isFinite(data.savedAt) && data.savedAt > 0 ? data.savedAt : 0,
              cursorOffset: Number.isFinite(data.cursorOffset) ? Math.max(0, Math.min(data.content.length, data.cursorOffset)) : 0,
              scrollTop: Number.isFinite(data.scrollTop) ? Math.max(0, data.scrollTop) : 0,
            });
          } catch (error) {
            // Preserve malformed entries for recovery without blocking other documents.
            console.warn('Skipping invalid recovery snapshot:', key, error);
            reportStorageError('部分恢复记录损坏，原始记录已保留', error);
          }
        }
      }
    } catch (e) {
      console.error('Failed to load snapshots:', e);
      reportStorageError('无法读取恢复存储', e);
    }
    return snapshots;
  }

  clearAllSnapshots() {
    if (typeof window === 'undefined') return;
    this.pending.forEach(timer => clearTimeout(timer));
    this.pending.clear();
    this.scheduledContent.clear();
    this.persistedContent.clear();
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(PREFIX)) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
    } catch {}
  }
}

export const RecoveryService = new RecoveryManager();
