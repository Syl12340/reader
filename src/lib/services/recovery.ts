import type { DocumentSession } from '$lib/types';

const PREFIX = 'reader_recovery_';
const SNAPSHOT_DELAY_MS = 750;

export interface RecoverySnapshot {
  id: string;
  name: string;
  path: string | null;
  content: string;
  savedContent: string;
  cursorOffset: number;
  scrollTop: number;
}

class RecoveryManager {
  private pending = new Map<string, ReturnType<typeof setTimeout>>();
  private scheduledContent = new Map<string, Pick<DocumentSession, 'content' | 'path' | 'name' | 'savedContent'>>();

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
      this.removeSnapshot(session.id);
      return true;
    }
    try {
      const data = {
        id: session.id,
        name: session.name,
        path: session.path,
        content: session.content,
        savedContent: session.savedContent,
        cursorOffset: session.cursorOffset,
        scrollTop: session.scrollTop,
      };
      localStorage.setItem(`${PREFIX}${session.id}`, JSON.stringify(data));
      this.scheduledContent.set(session.id, {
        content: session.content, path: session.path, name: session.name, savedContent: session.savedContent,
      });
      return true;
    } catch (e) {
      this.scheduledContent.delete(session.id);
      console.error('Failed to save document snapshot:', e);
      return false;
    }
  }

  removeSnapshot(id: string) {
    if (typeof window === 'undefined') return;
    const pending = this.pending.get(id);
    if (pending) clearTimeout(pending);
    this.pending.delete(id);
    this.scheduledContent.delete(id);
    try {
      localStorage.removeItem(`${PREFIX}${id}`);
    } catch {}
  }

  getSnapshots(): RecoverySnapshot[] {
    if (typeof window === 'undefined') return [];
    const snapshots: RecoverySnapshot[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(PREFIX)) {
          try {
            const val = localStorage.getItem(key);
            if (!val) continue;
            const data = JSON.parse(val);
            if (!data || typeof data.id !== 'string' || key !== `${PREFIX}${data.id}`
              || typeof data.name !== 'string' || typeof data.content !== 'string'
              || typeof data.savedContent !== 'string'
              || (data.path !== null && typeof data.path !== 'string')) {
              throw new Error('Invalid recovery snapshot');
            }
            snapshots.push({ ...data,
              cursorOffset: Number.isFinite(data.cursorOffset) ? Math.max(0, Math.min(data.content.length, data.cursorOffset)) : 0,
              scrollTop: Number.isFinite(data.scrollTop) ? Math.max(0, data.scrollTop) : 0,
            });
          } catch (error) {
            // Preserve malformed entries for recovery without blocking other documents.
            console.warn('Skipping invalid recovery snapshot:', key, error);
          }
        }
      }
    } catch (e) {
      console.error('Failed to load snapshots:', e);
    }
    return snapshots;
  }

  clearAllSnapshots() {
    if (typeof window === 'undefined') return;
    this.pending.forEach(timer => clearTimeout(timer));
    this.pending.clear();
    this.scheduledContent.clear();
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
