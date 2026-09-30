/**
 * 统一文件系统门面
 * 采用依赖注入/策略模式，根据运行环境自动选择 Tauri 或浏览器实现
 *
 * 类型说明：
 * - Tauri 模式: file 参数为 string (文件路径)
 * - 浏览器模式: file 参数为 FileSystemFileHandle
 * - 统一类型: FileRef = string | FileSystemFileHandle
 */

import { isTauri } from './platform';
import { FileOperationError, asFileError } from './file-error';
import type { FileNode as TauriFileNode } from './tauri-fs';
import type { WatchPath, FileChangeEvent } from './tauri-fs';
export type { WatchPath } from './tauri-fs';

export type FileRef = string | FileSystemFileHandle;

export function isPathRef(ref: FileRef): ref is string {
  return typeof ref === 'string';
}

export function isHandleRef(ref: FileRef): ref is FileSystemFileHandle {
  return typeof ref !== 'string' && 'getFile' in ref;
}

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  handle?: FileSystemHandle;
  children?: FileEntry[];
  isExpanded?: boolean;
}

export interface FileOpenResult {
  name: string;
  content: string;
  path?: string;
  handle?: FileSystemFileHandle;
}

export interface FileSaveResult {
  path?: string;
  handle?: FileSystemFileHandle;
  downloaded?: boolean;
}
export interface SaveTarget {
  name: string;
  path?: string;
  handle?: FileSystemFileHandle;
  existingContent?: string;
  existed: boolean;
}
export type SaveTargetValidator = (target: SaveTarget) => boolean | Promise<boolean>;

export interface IFileSystem {
  readFile(file: FileRef): Promise<string>;
  writeFile(file: FileRef, content: string): Promise<void>;
  openFile(): Promise<FileOpenResult | null>;
  openDirectory(): Promise<{ path?: string; handle?: FileSystemDirectoryHandle } | null>;
  readDirectory(dir: string | FileSystemDirectoryHandle): Promise<FileEntry[]>;
  readDirectoryTree(dir: string | FileSystemDirectoryHandle, maxDepth?: number): Promise<FileEntry[]>;
  saveFile(filename: string, content: string, handle?: FileRef, expectedContent?: string, validateTarget?: SaveTargetValidator): Promise<FileSaveResult | null>;
  createFile(dir: string | FileSystemDirectoryHandle, name: string, content?: string): Promise<FileEntry | null>;
  createDirectory(dir: string | FileSystemDirectoryHandle, name: string): Promise<FileEntry | null>;
  deleteItem(dir: string | FileSystemDirectoryHandle, name: string, permanent?: boolean): Promise<void>;
  renameItem(dir: string | FileSystemDirectoryHandle, oldName: string, newName: string): Promise<void>;
  searchFiles(directory: string, query: string): Promise<FileEntry[]>;
  watchDirectory(path: string): Promise<void>;
  watchPaths(paths: WatchPath[]): Promise<void>;
  unwatchDirectory(): Promise<void>;
  onFsChange(callback: (event: FileChangeEvent) => void): Promise<() => void>;
  exportAsMarkdown(filename: string, content: string): Promise<void>;
  exportAsHTML(filename: string, htmlContent: string): Promise<void>;
  downloadFile(filename: string, content: string, mimeType?: string): Promise<void>;
}

// 辅助函数：转换单个 Tauri 节点
function convertTauriNode(node: TauriFileNode): FileEntry {
  return {
    name: node.name,
    path: node.path,
    isDirectory: node.is_directory,
    children: node.children ? node.children.map(convertTauriNode) : undefined,
    isExpanded: node.is_expanded ?? false,
  };
}

class TauriFileSystem implements IFileSystem {
  constructor(private tauriFs: any) {}

  async readFile(file: FileRef): Promise<string> {
    const path = isPathRef(file) ? file : ((file as any).path || file.name);
    return await this.tauriFs.readFile(path);
  }

  async writeFile(file: FileRef, content: string): Promise<void> {
    const path = isPathRef(file) ? file : ((file as any).path || file.name);
    await this.tauriFs.writeFile(path, content);
  }

  async openFile(): Promise<FileOpenResult | null> {
    const result = await this.tauriFs.openFile();
    if (!result) return null;
    return { name: result.name, content: result.content, path: result.path };
  }

  async openDirectory(): Promise<{ path?: string; handle?: FileSystemDirectoryHandle } | null> {
    const path = await this.tauriFs.openDirectory();
    if (!path) return null;
    return { path };
  }

  async readDirectory(dir: string | FileSystemDirectoryHandle): Promise<FileEntry[]> {
    const path = typeof dir === 'string' ? dir : dir.name;
    const nodes = await this.tauriFs.readDirectory(path);
    return nodes.map((node: TauriFileNode) => ({
      name: node.name,
      path: node.path,
      isDirectory: node.is_directory,
      children: node.children ? node.children.map(convertTauriNode) : undefined,
      isExpanded: node.is_expanded ?? false,
    }));
  }

  async readDirectoryTree(dir: string | FileSystemDirectoryHandle, maxDepth: number = 10): Promise<FileEntry[]> {
    const path = typeof dir === 'string' ? dir : dir.name;
    const nodes = await this.tauriFs.readDirectoryTree(path, maxDepth);
    return nodes.map((node: TauriFileNode) => convertTauriNode(node));
  }

  async saveFile(filename: string, content: string, handle?: FileRef, expectedContent?: string, validateTarget?: SaveTargetValidator): Promise<FileSaveResult | null> {
    const pathRef = handle ? (isPathRef(handle) ? handle : (handle as any).path) : null;
    if (pathRef) {
      await this.tauriFs.writeFile(pathRef, content, expectedContent);
      return { path: pathRef };
    } else {
      const path = await this.tauriFs.saveFileDialog();
      if (path) {
        let existingContent: string | undefined;
        let existed = false;
        try { existingContent = await this.tauriFs.readFile(path); existed = true; }
        catch (error) { if (asFileError(error).code !== 'not_found') throw error; }
        const name = path.split(/[/\\]/).pop() || filename;
        if (validateTarget && !await validateTarget({ name, path, existingContent, existed })) return null;
        await this.tauriFs.writeFile(path, content, existingContent, !existed);
        return { path };
      }
    }
    return null;
  }

  async createFile(dir: string | FileSystemDirectoryHandle, name: string, content?: string): Promise<FileEntry | null> {
    const dirPath = typeof dir === 'string' ? dir : dir.name;
    const filePath = `${dirPath}/${name}`;
    await this.tauriFs.createFile(filePath, content);
    return { name, path: filePath, isDirectory: false };
  }

  async createDirectory(dir: string | FileSystemDirectoryHandle, name: string): Promise<FileEntry | null> {
    const dirPath = typeof dir === 'string' ? dir : dir.name;
    const newPath = `${dirPath}/${name}`;
    await this.tauriFs.createDirectory(newPath);
    return { name, path: newPath, isDirectory: true };
  }

  async deleteItem(dir: string | FileSystemDirectoryHandle, name: string, permanent = false): Promise<void> {
    const dirPath = typeof dir === 'string' ? dir : dir.name;
    const filePath = `${dirPath}/${name}`;
    await this.tauriFs.deleteFile(filePath, permanent);
  }

  async renameItem(dir: string | FileSystemDirectoryHandle, oldName: string, newName: string): Promise<void> {
    const dirPath = typeof dir === 'string' ? dir : dir.name;
    await this.tauriFs.renameFile(`${dirPath}/${oldName}`, `${dirPath}/${newName}`);
  }

  async searchFiles(directory: string, query: string): Promise<FileEntry[]> {
    return await this.tauriFs.searchFiles(directory, query);
  }

  async watchDirectory(path: string): Promise<void> {
    await this.tauriFs.watchDirectory(path);
  }

  async watchPaths(paths: WatchPath[]): Promise<void> {
    await this.tauriFs.watchPaths(paths);
  }

  async unwatchDirectory(): Promise<void> {
    await this.tauriFs.unwatchDirectory();
  }

  async onFsChange(callback: (event: FileChangeEvent) => void): Promise<() => void> {
    return await this.tauriFs.onFsChange(callback);
  }

  async exportAsMarkdown(filename: string, content: string): Promise<void> {
    const path = await this.tauriFs.saveFileDialog();
    if (path) {
      await this.tauriFs.writeFile(path, content);
    }
  }

  async exportAsHTML(filename: string, htmlContent: string): Promise<void> {
    const path = await this.tauriFs.saveHtmlDialog();
    if (path) {
      const finalPath = /\.html?$/i.test(path) ? path : `${path}.html`;
      await this.tauriFs.writeFile(finalPath, htmlContent);
    }
  }

  async downloadFile(filename: string, content: string, mimeType?: string): Promise<void> {
    await this.exportAsMarkdown(filename, content);
  }
}

class BrowserFileSystem implements IFileSystem {
  constructor(private browserFs: any) {}

  async readFile(file: FileRef): Promise<string> {
    return await this.browserFs.readFile(file as FileSystemFileHandle);
  }

  async writeFile(file: FileRef, content: string): Promise<void> {
    await this.browserFs.writeFile(file as FileSystemFileHandle, content);
  }

  async openFile(): Promise<FileOpenResult | null> {
    const result = await this.browserFs.openFile();
    if (!result) return null;
    return { name: result.name, content: result.content, handle: result.handle };
  }

  async openDirectory(): Promise<{ path?: string; handle?: FileSystemDirectoryHandle } | null> {
    const handle = await this.browserFs.openDirectory();
    if (!handle) return null;
    return { handle };
  }

  async readDirectory(dir: string | FileSystemDirectoryHandle): Promise<FileEntry[]> {
    return await this.browserFs.readDirectory(dir as FileSystemDirectoryHandle);
  }

  async readDirectoryTree(dir: string | FileSystemDirectoryHandle, maxDepth: number = 10): Promise<FileEntry[]> {
    return await this.browserFs.readDirectoryTree(dir as FileSystemDirectoryHandle, maxDepth);
  }

  async saveFile(filename: string, content: string, handle?: FileRef, expectedContent?: string, validateTarget?: SaveTargetValidator): Promise<FileSaveResult | null> {
    if (handle && isHandleRef(handle)) {
      if (expectedContent !== undefined && await (await handle.getFile()).text() !== expectedContent) {
        throw new FileOperationError('conflict', '文件已发生外部修改，请重新载入或确认覆盖后保存。');
      }
      await this.browserFs.writeFile(handle, content);
      return { handle };
    }
    const pickerWindow = window as Window & {
      showSaveFilePicker?: (options: { suggestedName: string }) => Promise<FileSystemFileHandle>;
    };
    if (pickerWindow.showSaveFilePicker) {
      try {
        const selected = await pickerWindow.showSaveFilePicker({ suggestedName: filename });
        const existingContent = await (await selected.getFile()).text();
        if (validateTarget && !await validateTarget({
          name: selected.name, handle: selected, existingContent, existed: true,
        })) return null;
        if (await (await selected.getFile()).text() !== existingContent) {
          throw new FileOperationError('conflict', '目标文件在确认后发生变化，已取消另存为。');
        }
        await this.browserFs.writeFile(selected, content);
        return { handle: selected };
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return null;
        throw error;
      }
    }
    await this.browserFs.exportAsMarkdown(filename, content);
    return { downloaded: true };
  }

  async createFile(dir: string | FileSystemDirectoryHandle, name: string, content?: string): Promise<FileEntry | null> {
    return await this.browserFs.createFile(dir as FileSystemDirectoryHandle, name, content);
  }

  async createDirectory(dir: string | FileSystemDirectoryHandle, name: string): Promise<FileEntry | null> {
    return await this.browserFs.createDirectory(dir as FileSystemDirectoryHandle, name);
  }

  async deleteItem(dir: string | FileSystemDirectoryHandle, name: string, permanent = false): Promise<void> {
    if (!permanent) throw new Error('浏览器不支持回收站，请使用桌面版或明确选择永久删除。');
    await (dir as FileSystemDirectoryHandle).removeEntry(name, { recursive: true });
  }

  async renameItem(dir: string | FileSystemDirectoryHandle, oldName: string, newName: string): Promise<void> {
    await this.browserFs.renameFile(dir as FileSystemDirectoryHandle, oldName, newName);
  }

  async searchFiles(directory: string, query: string): Promise<FileEntry[]> {
    console.warn('File search is not supported in browser mode');
    return [];
  }

  async watchDirectory(path: string): Promise<void> {
    console.warn('Directory watching is not supported in browser mode');
  }

  async watchPaths(paths: WatchPath[]): Promise<void> {
    console.warn('Path watching is not supported in browser mode');
  }

  async unwatchDirectory(): Promise<void> {}

  async onFsChange(callback: (event: FileChangeEvent) => void): Promise<() => void> {
    console.warn('File system events are not supported in browser mode');
    return () => {};
  }

  async exportAsMarkdown(filename: string, content: string): Promise<void> {
    this.browserFs.exportAsMarkdown(filename, content);
  }

  async exportAsHTML(filename: string, htmlContent: string): Promise<void> {
    this.browserFs.exportAsHTML(filename, htmlContent);
  }

  async downloadFile(filename: string, content: string, mimeType?: string): Promise<void> {
    this.browserFs.downloadFile(filename, content, mimeType);
  }
}

// 单例实例
let fsInstance: IFileSystem | null = null;

async function getFs(): Promise<IFileSystem> {
  if (fsInstance) return fsInstance;
  if (isTauri()) {
    const tauriFs = await import('./tauri-fs');
    fsInstance = new TauriFileSystem(tauriFs);
  } else {
    const browserFs = await import('./browser-fs');
    fsInstance = new BrowserFileSystem(browserFs);
  }
  return fsInstance;
}

// 导出包装函数，保持向后兼容
export const readFile = async (file: FileRef) => (await getFs()).readFile(file);
export const writeFile = async (file: FileRef, content: string) => (await getFs()).writeFile(file, content);
export const openFile = async () => (await getFs()).openFile();
export const openDirectory = async () => (await getFs()).openDirectory();
export const readDirectory = async (dir: string | FileSystemDirectoryHandle) => (await getFs()).readDirectory(dir);
export const readDirectoryTree = async (dir: string | FileSystemDirectoryHandle, maxDepth?: number) => (await getFs()).readDirectoryTree(dir, maxDepth);
export const saveFile = async (filename: string, content: string, handle?: FileRef, expectedContent?: string, validateTarget?: SaveTargetValidator) =>
  (await getFs()).saveFile(filename, content, handle, expectedContent, validateTarget);
export const createFile = async (dir: string | FileSystemDirectoryHandle, name: string, content?: string) => (await getFs()).createFile(dir, name, content);
export const createDirectory = async (dir: string | FileSystemDirectoryHandle, name: string) => (await getFs()).createDirectory(dir, name);
export const deleteItem = async (dir: string | FileSystemDirectoryHandle, name: string, permanent = false) => (await getFs()).deleteItem(dir, name, permanent);
export const renameItem = async (dir: string | FileSystemDirectoryHandle, oldName: string, newName: string) => (await getFs()).renameItem(dir, oldName, newName);
export const searchFiles = async (directory: string, query: string) => (await getFs()).searchFiles(directory, query);
export const watchDirectory = async (path: string) => (await getFs()).watchDirectory(path);
export const watchPaths = async (paths: WatchPath[]) => (await getFs()).watchPaths(paths);
export const unwatchDirectory = async () => (await getFs()).unwatchDirectory();
export const onFsChange = async (callback: (event: FileChangeEvent) => void) => (await getFs()).onFsChange(callback);
export const exportAsMarkdown = async (filename: string, content: string) => (await getFs()).exportAsMarkdown(filename, content);
export const exportAsHTML = async (filename: string, htmlContent: string) => (await getFs()).exportAsHTML(filename, htmlContent);
export const downloadFile = async (filename: string, content: string, mimeType?: string) => (await getFs()).downloadFile(filename, content, mimeType);

export { getFileExtension, getFileIcon } from './file-utils';

export const isFileSystemAccessSupported = (): boolean => {
  return !isTauri() && typeof window !== 'undefined' && 'showOpenFilePicker' in window;
};
