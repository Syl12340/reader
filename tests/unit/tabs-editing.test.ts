import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import {
  activeSessionId,
  closeSession,
  createSession,
  isEditing,
  sessions,
  setActiveSession,
} from '../../src/lib/stores/document';

describe('tab editing visibility', () => {
  beforeEach(() => {
    sessions.set([]);
    activeSessionId.set(null);
  });

  it('shows the editor when opening a document session', () => {
    const id = createSession('note.md', 'C:/notes/note.md', '# Note');

    expect(get(activeSessionId)).toBe(id);
    expect(get(isEditing)).toBe(true);
  });

  it('keeps the editor visible when switching document sessions', () => {
    const first = createSession('first.md', 'C:/notes/first.md', 'first');
    const second = createSession('second.md', 'C:/notes/second.md', 'second');

    setActiveSession(first);

    expect(second).not.toBe(first);
    expect(get(activeSessionId)).toBe(first);
    expect(get(isEditing)).toBe(true);
  });

  it('hides the editor after closing the last session', () => {
    const id = createSession('note.md', 'C:/notes/note.md', '# Note');

    closeSession(id);

    expect(get(activeSessionId)).toBeNull();
    expect(get(isEditing)).toBe(false);
  });

  it('hides the editor after closing every session', () => {
    const first = createSession('first.md', 'C:/notes/first.md', 'first');
    const second = createSession('second.md', 'C:/notes/second.md', 'second');

    closeSession(first);
    closeSession(second);

    expect(get(sessions)).toEqual([]);
    expect(get(activeSessionId)).toBeNull();
    expect(get(isEditing)).toBe(false);
  });
});
