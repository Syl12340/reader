import {
  currentDirectory,
  currentDirectoryHandle,
  setDirectoryTree,
  type FileNode,
} from '$lib/stores/file';
import { openDirectory, readDirectoryTree } from '$lib/utils/native-fs';

export class WorkspaceService {
  private static openRevision = 0;

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
      alert(`打开文件夹失败: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
}
