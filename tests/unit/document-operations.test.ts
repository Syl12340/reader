import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { activeSessionId, createSession, sessions, updateSessionContent } from '../../src/lib/stores/document';
import { DocumentService } from '../../src/lib/services/document';
import { RecoveryService } from '../../src/lib/services/recovery';
import { readFile, saveFile, type FileSaveResult } from '../../src/lib/utils/native-fs';
import { writeFile } from '../../src/lib/utils/tauri-fs';

vi.mock('../../src/lib/utils/tauri-fs', () => ({ writeFile: vi.fn() }));
vi.mock('../../src/lib/utils/platform', () => ({ isTauri: () => true }));
vi.mock('../../src/lib/services/interaction', () => ({
  notify: vi.fn(),
  confirmAction: async (_title: string, message: string) => window.confirm(message),
  ask: async ({ message }: { message: string }) => window.confirm(message) ? 'overwrite' : 'cancel',
}));

vi.mock('../../src/lib/utils/native-fs', () => ({
  saveFile: vi.fn(), readFile: vi.fn(), openFile: vi.fn(),
}));

describe('document operation boundaries', () => {
  beforeEach(() => {
    sessions.set([]);
    activeSessionId.set(null);
    RecoveryService.clearAllSnapshots();
    vi.clearAllMocks();
    localStorage.clear();
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });
  afterEach(() => {
    sessions.set([]);
    RecoveryService.clearAllSnapshots();
    vi.restoreAllMocks();
  });

  it('drops a cancelled file-open result and suppresses its stale error', async () => {
    let current = true;
    let finish!: (text: string) => void;
    vi.mocked(readFile).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = DocumentService.openPath('C:/cancelled.md', () => current);
    await Promise.resolve(); current = false; finish('old result');
    expect(await pending).toBeNull(); expect(get(sessions)).toHaveLength(0);
    vi.mocked(readFile).mockRejectedValueOnce(new Error('old error'));
    expect(await DocumentService.openPath('C:/cancelled.md', () => false)).toBeNull();
    expect(window.alert).not.toHaveBeenCalled();
  });

  it('preserves edits and recovery data made while a save is in flight', async () => {
    const id = createSession('note.md', 'C:/note.md', 'first edit', 'baseline');
    let finish!: (result: FileSaveResult) => void;
    vi.mocked(saveFile).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = DocumentService.saveSession(id);
    await Promise.resolve();
    updateSessionContent(id, 'second edit');
    finish({ path: 'C:/note.md' });
    await pending;
    expect(get(sessions)[0]).toMatchObject({ content: 'second edit', savedContent: 'first edit', isDirty: true });
    expect(RecoveryService.getSnapshots()[0].content).toBe('second edit');
    expect(saveFile).toHaveBeenCalledWith('note.md', 'first edit', 'C:/note.md', 'baseline');
  });

  it('coalesces automatic saves while the session already has an operation', async () => {
    const id = createSession('note.md', 'C:/note.md', 'edit', 'baseline');
    let finish!: (result: FileSaveResult) => void;
    vi.mocked(saveFile).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = DocumentService.autoSaveSession(id);
    await Promise.resolve();
    expect(await DocumentService.autoSaveSession(id)).toBe(false);
    finish({ path: 'C:/note.md' });
    await pending;
    expect(saveFile).toHaveBeenCalledTimes(1);
  });

  it('does not overwrite edits made during a reload', async () => {
    const id = createSession('note.md', 'C:/note.md', 'baseline');
    let finish!: (text: string) => void;
    vi.mocked(readFile).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = DocumentService.reloadSessionFromDisk(id);
    await Promise.resolve();
    updateSessionContent(id, 'local edit');
    finish('external edit');
    expect(await pending).toBe(false);
    expect(get(sessions)[0]).toMatchObject({ content: 'local edit', isDirty: true, externalContent: 'external edit' });
  });

  it('reports write failure without advancing the saved baseline', async () => {
    const id = createSession('note.md', 'C:/note.md', 'edit', 'baseline');
    vi.mocked(saveFile).mockRejectedValueOnce(new Error('disk full'));
    expect(await DocumentService.saveSession(id)).toBe(false);
    expect(get(sessions)[0]).toMatchObject({ savedContent: 'baseline', saveState: 'error', saveError: 'disk full', isDirty: true });
  });

  it('clears saving status when the file picker is cancelled', async () => {
    const id = createSession('note.md', null, 'edit', '');
    vi.mocked(saveFile).mockResolvedValueOnce(null);
    expect(await DocumentService.saveSession(id)).toBe(false);
    expect(get(sessions)[0].saveState).toBeUndefined();
    expect(get(sessions)[0].isDirty).toBe(true);
  });

  it('blocks Save As when the selected target belongs to another open tab', async () => {
    const sourceId = createSession('draft.md', null, 'draft', '');
    const targetId = createSession('target.md', 'C:/target.md', 'target', 'target');
    activeSessionId.set(sourceId);
    vi.mocked(saveFile).mockImplementationOnce(async (_name, _content, _handle, _expected, validate) => {
      expect(validate).toBeTypeOf('function');
      const accepted = await validate!({ path: 'C:/target.md', name: 'target.md', existed: true });
      return accepted ? { path: 'C:/target.md' } : null;
    });
    expect(await DocumentService.saveSessionAs(sourceId)).toBe(false);
    expect(get(activeSessionId)).toBe(targetId);
    expect(get(sessions).find(session => session.id === sourceId)?.path).toBeNull();
  });

  it('requires overwrite confirmation before Save As replaces an existing target', async () => {
    const id = createSession('draft.md', null, 'draft', '');
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    vi.mocked(saveFile).mockImplementationOnce(async (_name, _content, _handle, _expected, validate) => {
      const accepted = await validate!({ path: 'C:/existing.md', name: 'existing.md', existed: true });
      return accepted ? { path: 'C:/existing.md' } : null;
    });
    expect(await DocumentService.saveSessionAs(id)).toBe(false);
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('确认覆盖'));
    expect(get(sessions)[0].path).toBeNull();
  });

  it('validates the target on the first ordinary save, not only Save As', async () => {
    const id = createSession('draft.md', null, 'draft', '');
    createSession('target.md', 'C:/notes/target.md', 'disk');
    activeSessionId.set(id);
    vi.mocked(saveFile).mockImplementationOnce(async (_name, _content, _handle, _expected, validate) => {
      expect(validate).toBeTypeOf('function');
      expect(await validate!({ path: 'C:/notes/sub/../target.md', name: 'target.md', existed: true })).toBe(false);
      return null;
    });
    expect(await DocumentService.saveSession(id)).toBe(false);
    expect(get(sessions).find(session => session.id === id)?.path).toBeNull();
  });

  it('preserves dirty tabs and their recovery snapshot when a folder is removed', async () => {
    createSession('note.md', 'C:/notes/note.md', 'edit', 'baseline');
    const remove = vi.fn().mockResolvedValue(undefined);
    expect(await DocumentService.deleteEntry('C:/notes', false, true, remove)).toBe(true);
    expect(remove).toHaveBeenCalledOnce();
    expect(get(sessions)[0]).toMatchObject({ content: 'edit', isDirty: true, externalMissing: true });
    expect(RecoveryService.getSnapshots()[0].content).toBe('edit');
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('回收站'));
  });

  it('does not delete after cancellation or failed recovery persistence', async () => {
    createSession('note.md', 'C:/note.md', 'edit', 'baseline');
    const remove = vi.fn();
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    expect(await DocumentService.deleteEntry('C:/note.md', true, false, remove)).toBe(false);
    vi.spyOn(RecoveryService, 'saveSnapshot').mockReturnValueOnce(false);
    await expect(DocumentService.deleteEntry('C:/note.md', false, false, remove)).rejects.toThrow('无法备份');
    expect(remove).not.toHaveBeenCalled();
  });

  it('does not retry a failed recycle-bin operation as permanent deletion', async () => {
    createSession('note.md', 'C:/note.md', 'baseline');
    const remove = vi.fn().mockRejectedValue(new Error('trash unavailable'));
    await expect(DocumentService.deleteEntry('C:/note.md', false, false, remove)).rejects.toThrow('trash unavailable');
    expect(remove).toHaveBeenCalledOnce();
    expect(get(sessions)[0].externalMissing).not.toBe(true);
  });

  it('restores a separate untitled copy without changing the original tab or removing its snapshot', () => {
    const original = createSession('note.md', 'C:/note.md', 'current', 'baseline');
    RecoveryService.saveSnapshot(get(sessions)[0]);
    const snapshot = RecoveryService.getSnapshots()[0];
    const copy = DocumentService.restoreSnapshotAsCopy(snapshot);
    expect(copy).not.toBe(original);
    expect(get(sessions).find(s => s.id === original)).toMatchObject({ path: 'C:/note.md', content: 'current' });
    expect(get(sessions).find(s => s.id === copy)).toMatchObject({ path: null, content: 'current', isDirty: true, name: 'note (恢复副本).md' });
    expect(RecoveryService.getSnapshots().some(s => s.id === original)).toBe(true);
  });

  it('persists the original version before invoking a disk replacement', async () => {
    vi.mocked(writeFile).mockImplementationOnce(async () => {
      expect(RecoveryService.getRecoveryItems()).toEqual([expect.objectContaining({ kind: 'checkpoint', content: 'before' })]);
    });
    expect(await DocumentService.replaceDiskContent('C:/note.md', 'before', 'after')).toBe('saved');
    expect(writeFile).toHaveBeenCalledWith('C:/note.md', 'after', 'before');
  });

  it('blocks disk replacement when its recovery checkpoint cannot be persisted', async () => {
    vi.spyOn(RecoveryService, 'saveCheckpoint').mockReturnValueOnce(false);
    await expect(DocumentService.replaceDiskContent('C:/note.md', 'before', 'after')).rejects.toThrow('恢复点');
    expect(writeFile).not.toHaveBeenCalled();
  });
});
