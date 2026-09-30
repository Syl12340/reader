import type { DocumentSession } from '$lib/types';

export function getSaveStatus(session: DocumentSession | null): { label: string; detail: string } {
  if (!session) return { label: '', detail: '' };
  if (session.saveState === 'saving') return { label: 'Saving', detail: '正在写入文件，恢复快照不等同于磁盘保存。' };
  if (session.saveState === 'error') return { label: 'Save failed', detail: session.saveError ?? '保存失败，请重试或另存为。' };
  if (session.externalModified) return {
    label: session.externalReadError ? 'Read failed' : session.externalMissing ? 'Missing on disk' : 'External conflict',
    detail: session.externalReadError ?? '磁盘版本与当前文档不同，请重新载入或另存为。',
  };
  if (!session.path && !session.fileHandle) return { label: 'Not saved to disk', detail: '文档尚未保存到文件；恢复快照不是正式保存。' };
  if (session.isDirty) return { label: 'Unsaved', detail: '当前修改尚未写入文件。' };
  return { label: 'Saved', detail: '当前内容与最后读取或成功保存的文件版本一致。' };
}
