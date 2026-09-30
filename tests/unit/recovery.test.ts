import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecoveryService, recoveryStorageError } from '../../src/lib/services/recovery';
import { get } from 'svelte/store';
import type { DocumentSession } from '../../src/lib/types';

const snapshot = (overrides: Partial<DocumentSession> = {}): DocumentSession => ({
  id: 'recovery-test', name: 'note.md', path: 'C:/notes/note.md',
  content: 'unsaved', savedContent: 'saved', isDirty: true, cursorOffset: 2, scrollTop: 30,
  ...overrides,
});

describe('recovery persistence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    RecoveryService.clearAllSnapshots();
    localStorage.clear();
    recoveryStorageError.set(null);
  });
  afterEach(() => {
    RecoveryService.clearAllSnapshots();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('skips malformed records without discarding subsequent valid snapshots', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem('reader_recovery_broken', '{invalid');
    RecoveryService.saveSnapshot(snapshot());
    expect(RecoveryService.getSnapshots().map(value => value.id)).toEqual(['recovery-test']);
    expect(localStorage.getItem('reader_recovery_broken')).toBe('{invalid');
  });

  it('persists a renamed dirty document even when text did not change', () => {
    RecoveryService.saveSnapshot(snapshot());
    RecoveryService.scheduleSnapshot(snapshot({ path: 'C:/notes/moved.md', name: 'moved.md' }));
    vi.advanceTimersByTime(750);
    expect(RecoveryService.getSnapshots()[0].path).toBe('C:/notes/moved.md');
  });

  it('reports persistence failures so the caller can retain the original snapshot', () => {
    RecoveryService.saveSnapshot(snapshot());
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(RecoveryService.saveSnapshot(snapshot({ id: 'restored-copy' }))).toBe(false);
    expect(RecoveryService.getSnapshots()[0].content).toBe('unsaved');
  });

  it('replaces a pending older snapshot with the newest immediate snapshot', () => {
    RecoveryService.scheduleSnapshot(snapshot({ content: 'older' }));
    RecoveryService.saveSnapshot(snapshot({ content: 'newest' }));
    vi.advanceTimersByTime(1000);
    expect(RecoveryService.getSnapshots()[0].content).toBe('newest');
  });

  it('keeps replacement checkpoints separate from startup drafts and clean-session cleanup', () => {
    RecoveryService.saveSnapshot(snapshot());
    expect(RecoveryService.saveCheckpoint('C:/notes/note.md', 'before replacement')).toBe(true);
    RecoveryService.saveSnapshot(snapshot({ isDirty: false }));
    expect(RecoveryService.getSnapshots()).toEqual([]);
    const records = RecoveryService.getRecoveryItems();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ kind: 'checkpoint', content: 'before replacement', savedAt: expect.any(Number) });
    expect(RecoveryService.removeRecoveryItem(records[0])).toBe(true);
    expect(RecoveryService.getRecoveryItems()).toEqual([]);
  });

  it('exposes checkpoint quota failures instead of reporting success', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(RecoveryService.saveCheckpoint('C:/note.md', 'before')).toBe(false);
    expect(get(recoveryStorageError)).toContain('quota');
    expect(RecoveryService.getRecoveryItems()).toEqual([]);
  });

  it('does not rewrite an unchanged persisted draft just to refresh its timestamp', () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    RecoveryService.saveSnapshot(snapshot());
    const first = RecoveryService.getSnapshots()[0].savedAt;
    vi.setSystemTime(new Date('2026-01-01T00:01:00Z'));
    RecoveryService.saveSnapshot(snapshot());
    expect(RecoveryService.getSnapshots()[0].savedAt).toBe(first);
  });

  it('reports recovery storage use and clears checkpoints without deleting drafts', () => {
    RecoveryService.saveSnapshot(snapshot());
    RecoveryService.saveCheckpoint('C:/notes/note.md', 'before replacement');
    expect(RecoveryService.getStorageUsage()).toMatchObject({ entries: 2, checkpoints: 1 });
    expect(RecoveryService.getStorageUsage().bytes).toBeGreaterThan(0);
    expect(RecoveryService.clearCheckpoints()).toBe(1);
    expect(RecoveryService.getSnapshots()).toHaveLength(1);
    expect(RecoveryService.getStorageUsage()).toMatchObject({ entries: 1, checkpoints: 0 });
  });
});
