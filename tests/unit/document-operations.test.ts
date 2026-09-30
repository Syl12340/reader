import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { activeSessionId, createSession, sessions, updateSessionContent } from '../../src/lib/stores/document';
import { DocumentService } from '../../src/lib/services/document';
import { RecoveryService } from '../../src/lib/services/recovery';
import { readFile, saveFile, type FileSaveResult } from '../../src/lib/utils/native-fs';

vi.mock('../../src/lib/utils/native-fs', () => ({
  saveFile: vi.fn(), readFile: vi.fn(), openFile: vi.fn(),
}));

describe('document operation boundaries', () => {
  beforeEach(() => {
    sessions.set([]);
    activeSessionId.set(null);
    RecoveryService.clearAllSnapshots();
    vi.clearAllMocks();
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });
  afterEach(() => {
    sessions.set([]);
    RecoveryService.clearAllSnapshots();
    vi.restoreAllMocks();
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
});
