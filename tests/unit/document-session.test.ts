import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { activeSessionId, createSession, sessions } from '../../src/lib/stores/document';

describe('document session state', () => {
  beforeEach(() => {
    sessions.set([]);
    activeSessionId.set(null);
  });

  it('refreshes a clean reopened file and drops stale editor state', () => {
    const id = createSession('note.md', 'C:/notes/note.md', '# Note\n\nFresh');

    sessions.update(list => list.map(session => session.id === id
      ? {
          ...session,
          editorState: {
            doc: {
              toString: () => '',
            },
          },
        }
      : session));

    const reopenedId = createSession('note.md', 'C:/notes/note.md', '# Note\n\nFresh');
    const session = get(sessions).find(item => item.id === id);

    expect(reopenedId).toBe(id);
    expect(get(activeSessionId)).toBe(id);
    expect(session?.content).toBe('# Note\n\nFresh');
    expect(session?.editorState).toBeUndefined();
  });

  it('does not overwrite a dirty reopened file', () => {
    const id = createSession('note.md', 'C:/notes/note.md', 'local edit', 'saved text');

    const reopenedId = createSession('note.md', 'C:/notes/note.md', 'disk text', 'disk text');
    const session = get(sessions).find(item => item.id === id);

    expect(reopenedId).toBe(id);
    expect(session?.content).toBe('local edit');
    expect(session?.isDirty).toBe(true);
  });
});
