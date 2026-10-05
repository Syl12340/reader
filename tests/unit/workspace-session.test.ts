import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { activeSessionId, createSession, sessions } from '../../src/lib/stores/document';
import { currentDirectory } from '../../src/lib/stores/file';
import { WorkspaceSessionService, parseWorkspaceSnapshot } from '../../src/lib/services/workspace-session';
import { readFile } from '../../src/lib/utils/native-fs';
import { isTauri } from '../../src/lib/utils/platform';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { WorkspaceService } from '../../src/lib/services/workspace';

vi.mock('../../src/lib/utils/platform', () => ({ isTauri: vi.fn(() => true) }));
vi.mock('../../src/lib/utils/native-fs', () => ({ readFile: vi.fn() }));
vi.mock('../../src/lib/services/workspace', () => ({ WorkspaceService: { openPath: vi.fn() } }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: vi.fn(() => ({ label: 'main' })) }));

const key = 'reader-workspace-v1:main';
let cleanup = () => {};
const persisted = () => parseWorkspaceSnapshot(localStorage.getItem(key))!;

describe('workspace restoration and window close', () => {
  beforeEach(() => {
    localStorage.clear(); sessions.set([]); activeSessionId.set(null); currentDirectory.set(null);
    vi.clearAllMocks(); vi.mocked(isTauri).mockReturnValue(true);
  });
  afterEach(() => { cleanup(); cleanup = () => {}; sessions.set([]); activeSessionId.set(null); });

  it('reads current disk contents and restores layout, positions and active tab', async () => {
    localStorage.setItem(key, JSON.stringify({ version: 1, directory: 'C:/notes', activePath: 'C:/notes/a.md', tabs: [
      { path: 'C:/notes/a.md', workspaceLayout: 'source', cursorOffset: 999, scrollTop: 80 },
      { path: 'C:/notes/b.md', workspaceLayout: 'preview', previewScrollTop: 120 },
    ] }));
    vi.mocked(readFile).mockResolvedValueOnce('fresh a').mockResolvedValueOnce('fresh b');
    cleanup = await WorkspaceSessionService.start();
    expect(WorkspaceService.openPath).toHaveBeenCalledWith('C:/notes');
    const restored = get(sessions);
    expect(restored[0]).toMatchObject({ content: 'fresh a', savedContent: 'fresh a', isDirty: false,
      workspaceLayout: 'source', cursorOffset: 7, scrollTop: 80 });
    expect(restored[1]).toMatchObject({ content: 'fresh b', workspaceLayout: 'preview', previewScrollTop: 120 });
    expect(get(activeSessionId)).toBe(restored[0].id);
  });

  it('keeps all tab metadata while prompts remove sessions during a successful close', async () => {
    createSession('a.md', 'C:/a.md', 'a');
    const active = createSession('b.md', 'C:/b.md', 'b');
    cleanup = await WorkspaceSessionService.start(true);
    WorkspaceSessionService.pauseForClose();
    sessions.set([]); activeSessionId.set(null);
    WorkspaceSessionService.flush(); WorkspaceSessionService.resume(true);
    expect(persisted().tabs.map(tab => tab.path)).toEqual(['C:/a.md', 'C:/b.md']);
    expect(persisted().activePath).toBe('C:/b.md');
    expect(active).toBeTruthy();
  });

  it('updates Save As metadata and removes already closed tabs when window close is cancelled', async () => {
    createSession('a.md', 'C:/a.md', 'a');
    const remaining = createSession('b.md', 'C:/b.md', 'b');
    cleanup = await WorkspaceSessionService.start(true);
    WorkspaceSessionService.pauseForClose();
    sessions.update(list => list.filter(tab => tab.id === remaining).map(tab => ({ ...tab, path: 'C:/renamed.md' })));
    WorkspaceSessionService.resume();
    expect(persisted().tabs.map(tab => tab.path)).toEqual(['C:/renamed.md']);
    expect(persisted().activePath).toBe('C:/renamed.md');
  });

  it('retains the new file path when an unsaved tab is saved in a close prompt', async () => {
    const id = createSession('draft.md', null, 'draft');
    cleanup = await WorkspaceSessionService.start(true);
    WorkspaceSessionService.pauseForClose();
    sessions.update(list => list.map(tab => ({ ...tab, path: 'C:/saved.md' })));
    sessions.set([]); activeSessionId.set(null);
    WorkspaceSessionService.flush(); WorkspaceSessionService.resume(true);
    expect(persisted().activePath).toBe('C:/saved.md');
    expect(persisted().tabs.map(tab => tab.path)).toEqual(['C:/saved.md']);
    expect(id).toBeTruthy();
  });

  it('drops restoration results when the user opens another document during a disk read', async () => {
    localStorage.setItem(key, JSON.stringify({ version: 1, tabs: [{ path: 'C:/old.md' }] }));
    let finish!: (content: string) => void;
    vi.mocked(readFile).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const starting = WorkspaceSessionService.start();
    await vi.waitFor(() => expect(readFile).toHaveBeenCalled());
    const id = createSession('new.md', null, 'new');
    finish('old'); cleanup = await starting;
    expect(get(sessions).map(tab => tab.id)).toEqual([id]);
    expect(get(activeSessionId)).toBe(id);
  });

  it('does not restore or request native access in browser mode', async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    localStorage.setItem(key, JSON.stringify({ version: 1, tabs: [{ path: 'C:/old.md' }] }));
    cleanup = await WorkspaceSessionService.start();
    expect(readFile).not.toHaveBeenCalled();
    expect(getCurrentWindow).not.toHaveBeenCalled();
    expect(get(sessions)).toHaveLength(0);
  });
});
