/**
 * Tauri 文件系统操作
 * 使用 Tauri IPC 调用后端命令
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { asFileError } from './file-error';

// 文件节点接口
export interface FileNode {
  name: string;
  path: string;
  is_directory: boolean;
  children?: FileNode[];
  is_expanded?: boolean;
}

// 文件信息接口
export interface FileInfo {
  name: string;
  path: string;
  size: number;
  is_directory: boolean;
  modified?: string;
  created?: string;
  extension?: string;
}

// 搜索结果接口
export interface SearchResult {
  name: string;
  path: string;
  file_type: string;
  matches?: Array<{
    line: number;
    column: number;
    text: string;
  }>;
}

export interface WatchPath {
  path: string;
  recursive: boolean;
}

export interface FileChangeEvent {
  kind: string;
  paths: string[];
  rename?: { from: string; to: string } | null;
}

/**
 * 读取文件内容
 */
export const readFile = async (path: string): Promise<string> => {
  for (let attempt = 0; ; attempt++) {
    try { return await invoke<string>('read_file', { path }); }
    catch (error) {
      const failure = asFileError(error);
      if (failure.code !== 'busy' || attempt >= 2) throw failure;
      await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
};

/**
 * 写入文件内容
 */
export const writeFile = async (path: string, content: string, expectedContent?: string): Promise<void> => {
  try { await invoke('write_file', { path, content, expectedContent }); }
  catch (error) { throw asFileError(error); }
};

/**
 * 读取目录结构
 */
export const readDirectory = async (path: string): Promise<FileNode[]> => {
  return await invoke<FileNode[]>('read_directory', { path });
};

/**
 * 递归读取目录树（Rust walkdir 实现，单次 IPC 调用）
 */
export const readDirectoryTree = async (path: string, maxDepth: number = 10): Promise<FileNode[]> => {
  return await invoke<FileNode[]>('read_directory_tree', { path, maxDepth });
};

/**
 * 打开文件对话框
 */
export const openFile = async (): Promise<{ name: string; content: string; path: string } | null> => {
  const result = await invoke<FileNode | null>('open_file_dialog');
  if (!result) return null;

  const content = await readFile(result.path);
  return {
    name: result.name,
    content,
    path: result.path,
  };
};

/**
 * 打开文件夹对话框
 */
export const openDirectory = async (): Promise<string | null> => {
  return await invoke<string | null>('open_folder_dialog');
};

/**
 * 新建文件对话框
 */
export const newFileDialog = async (): Promise<{ name: string; path: string } | null> => {
  return await invoke<FileNode | null>('new_file_dialog');
};

/**
 * 保存文件对话框
 */
export const saveFileDialog = async (): Promise<string | null> => {
  return await invoke<string | null>('save_file_dialog');
};

/**
 * 保存 HTML 对话框
 */
export const saveHtmlDialog = async (): Promise<string | null> => {
  return await invoke<string | null>('save_html_dialog');
};

export const saveExportDialog = async (
  defaultName: string,
  extension: string,
  description: string,
): Promise<string | null> => {
  return await invoke<string | null>('save_export_dialog', {
    defaultName,
    extension,
    description,
  });
};

export const writeBinaryFile = async (path: string, data: string): Promise<void> => {
  await invoke('write_binary_file', { path, data });
};

/**
 * 搜索文件
 */
export const searchFiles = async (directory: string, query: string): Promise<SearchResult[]> => {
  return await invoke<SearchResult[]>('search_files', { directory, query });
};

/**
 * 获取文件信息
 */
export const getFileInfo = async (path: string): Promise<FileInfo> => {
  return await invoke<FileInfo>('get_file_info', { path });
};

/**
 * 创建文件
 */
export const createFile = async (path: string, content?: string): Promise<void> => {
  await invoke('create_file', { path, content });
};

/**
 * 创建目录
 */
export const createDirectory = async (path: string): Promise<void> => {
  await invoke('create_directory', { path });
};

/**
 * 删除文件或目录
 */
export const deleteFile = async (path: string, permanent = false): Promise<void> => {
  await invoke('delete_file', { path, permanent });
};

/**
 * 重命名文件或目录
 */
export const renameFile = async (oldPath: string, newPath: string): Promise<void> => {
  await invoke('rename_file', { oldPath, newPath });
};

/**
 * 监听目录变化
 */
export const watchDirectory = async (path: string): Promise<void> => {
  await invoke('watch_directory', { path });
};

export const watchPaths = async (paths: WatchPath[]): Promise<void> => {
  await invoke('watch_paths', { paths });
};

export const unwatchDirectory = async (): Promise<void> => {
  await invoke('unwatch_directory');
};

/**
 * 监听文件系统事件
 */
export const onFsChange = async (callback: (event: FileChangeEvent) => void): Promise<() => void> => {
  const unlisten = await listen<FileChangeEvent>('fs-change', (event) => {
    callback(event.payload);
  });
  return unlisten;
};

export { getFileExtension, getFileIcon } from './file-utils';

/**
 * 全局内容搜索
 */
export interface ContentSearchResult {
  file: string;
  line: number;
  column: number;
  context: string;
}

export interface ContentSearchOptions {
  caseSensitive?: boolean;
  useRegex?: boolean;
  wholeWord?: boolean;
  extensions?: string[];
}

export const searchContent = async (
  directory: string,
  query: string,
  maxResults?: number,
  options: ContentSearchOptions = {},
): Promise<ContentSearchResult[]> => {
  return await invoke<ContentSearchResult[]>('search_content', {
    directory,
    query,
    maxResults,
    caseSensitive: options.caseSensitive,
    useRegex: options.useRegex,
    wholeWord: options.wholeWord,
    extensions: options.extensions,
  });
};
