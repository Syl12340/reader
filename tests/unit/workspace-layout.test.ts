import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { activeSessionId, createSession, sessions } from '../../src/lib/stores/document';
import { setEditorMode, toggleReadMode, toggleSplitPreview, workspaceLayout } from '../../src/lib/stores/ui';

describe('per-tab workspace layout', () => {
  beforeEach(() => { sessions.set([]); activeSessionId.set(null); workspaceLayout.set('wysiwym'); });

  it('returns from reading to the previous source split without changing content or position', () => {
    createSession('note.md', null, 'text');
    sessions.update(list => list.map(s => ({ ...s, cursorOffset: 2, scrollTop: 100 })));
    setEditorMode('source'); toggleSplitPreview();
    toggleReadMode();
    expect(get(workspaceLayout)).toBe('preview');
    toggleReadMode();
    expect(get(workspaceLayout)).toBe('source-preview');
    expect(get(sessions)[0]).toMatchObject({ content: 'text', cursorOffset: 2, scrollTop: 100 });
  });

  it('remembers different layouts and read return targets for different tabs', () => {
    const first = createSession('a.md', null, 'a');
    setEditorMode('source'); toggleReadMode();
    const second = createSession('b.md', null, 'b');
    expect(get(workspaceLayout)).toBe('wysiwym');
    toggleSplitPreview();
    activeSessionId.set(first);
    expect(get(workspaceLayout)).toBe('preview');
    toggleReadMode();
    expect(get(workspaceLayout)).toBe('source');
    activeSessionId.set(second);
    expect(get(workspaceLayout)).toBe('wysiwym-preview');
  });
});
