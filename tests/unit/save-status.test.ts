import { describe, expect, it } from 'vitest';
import type { DocumentSession } from '../../src/lib/types';
import { getSaveStatus } from '../../src/lib/utils/save-status';

const session: DocumentSession = {
  id: 'test', name: 'untitled.md', path: null, content: '', savedContent: '',
  isDirty: false, cursorOffset: 0, scrollTop: 0,
};

describe('disk save status', () => {
  it('does not report a clean untitled buffer as saved', () => {
    expect(getSaveStatus(session).label).toBe('未保存到文件');
  });
  it('distinguishes pending writes, failures and conflicts from clean disk content', () => {
    const disk = { ...session, path: 'C:/note.md' };
    expect(getSaveStatus(disk).label).toBe('已保存');
    expect(getSaveStatus({ ...disk, isDirty: true }).label).toBe('未保存');
    expect(getSaveStatus({ ...disk, saveState: 'saving' }).label).toBe('保存中');
    expect(getSaveStatus({ ...disk, saveState: 'error', saveError: 'denied' })).toEqual({ label: '保存失败', detail: 'denied' });
    expect(getSaveStatus({ ...disk, externalModified: true }).label).toBe('外部修改');
  });
  it('recognizes a successfully saved browser file handle without a native path', () => {
    expect(getSaveStatus({ ...session, fileHandle: { name: 'note.md' } }).label).toBe('已保存');
  });
});
