import {
  currentDirectory,
  currentDirectoryHandle,
  setDirectoryTree,
  type FileNode,
} from '$lib/stores/file';
import { openDirectory, readDirectoryTree } from '$lib/utils/native-fs';
import { notify } from './interaction';

export class WorkspaceService {
  private static openRevision = 0;

  static async openPath(path: string): Promise<boolean> {
    const revision = ++this.openRevision;
    try {
      const entries = await readDirectoryTree(path, 5);
      if (revision !== this.openRevision) return false;
      setDirectoryTree(entries as FileNode[], false);
      currentDirectory.set(path);
      currentDirectoryHandle.set(null);
      return true;
    } catch (error) { console.warn('Workspace restoration failed:', error); return false; }
  }

  static async openFolder(): Promise<boolean> {
    const revision = ++this.openRevision;
    try {
      const result = await openDirectory();
      if (!result || revision !== this.openRevision) return false;

      const directoryRef = result.path ?? result.handle;
      if (!directoryRef) return false;

      const entries = await readDirectoryTree(directoryRef, 5);
      if (revision !== this.openRevision) return false;
      setDirectoryTree(entries as FileNode[], false);
      currentDirectory.set(result.path ?? result.handle?.name ?? null);
      currentDirectoryHandle.set(result.handle ?? null);
      return true;
    } catch (error) {
      console.error('Failed to open folder:', error);
      notify(`打开文件夹失败: ${error instanceof Error ? error.message : String(error)}`, { label: '重试', run: () => this.openFolder() });
      return false;
    }
  }
}
