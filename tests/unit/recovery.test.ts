import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecoveryService } from '../../src/lib/services/recovery';
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
});
