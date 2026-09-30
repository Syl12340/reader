import { writable, derived, get } from 'svelte/store';
import { isTauri } from '$lib/utils/platform';
import { readDirectory, readDirectoryTree } from '$lib/utils/native-fs';

export interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
  isExpanded?: boolean;
  handle?: any; // FileSystemHandle（浏览器模式）
}

export const currentDirectory = writable<string | null>(null);
export const currentDirectoryHandle = writable<FileSystemDirectoryHandle | null>(null);
export const fileTree = writable<FileNode[]>([]);
export const isLoading = writable<boolean>(false);
export const error = writable<string | null>(null);
let refreshRevision = 0;

// 派生状态
export const directoryName = derived(currentDirectory, ($currentDirectory) => {
  if (!$currentDirectory) return null;
  const sep = $currentDirectory.includes('\\') ? '\\' : '/';
  return $currentDirectory.split(sep).pop() || null;
});

function collectExpanded(nodes: FileNode[], expanded = new Set<string>()): Set<string> {
  for (const node of nodes) {
    if (node.isDirectory && node.isExpanded) expanded.add(node.path);
    if (node.children) collectExpanded(node.children, expanded);
  }
  return expanded;
}

function applyExpanded(nodes: FileNode[], expanded: Set<string>): FileNode[] {
  return nodes.map(node => ({
    ...node,
    isExpanded: node.isDirectory ? expanded.has(node.path) : node.isExpanded,
    children: node.children ? applyExpanded(node.children, expanded) : node.children,
  }));
}

function normalizeEntries(entries: Array<Partial<FileNode> & { name: string; path: string; isDirectory: boolean }>): FileNode[] {
  return entries.map(entry => ({
    name: entry.name,
    path: entry.path,
    isDirectory: entry.isDirectory,
    children: entry.children ? normalizeEntries(entry.children as FileNode[]) : undefined,
    isExpanded: entry.isExpanded ?? false,
    handle: entry.handle,
  }));
}

export function setDirectoryTree(entries: FileNode[], preserveExpanded = true) {
  const expanded = preserveExpanded ? collectExpanded(get(fileTree)) : new Set<string>();
  fileTree.set(applyExpanded(normalizeEntries(entries), expanded));
}

export const fileCount = derived(fileTree, ($fileTree) => {
  function countFiles(nodes: FileNode[]): number {
    let count = 0;
    for (const node of nodes) {
      if (node.isDirectory) {
        count += countFiles(node.children || []);
      } else {
        count++;
      }
    }
    return count;
  }
  return countFiles($fileTree);
});

export const directoryCount = derived(fileTree, ($fileTree) => {
  function countDirs(nodes: FileNode[]): number {
    let count = 0;
    for (const node of nodes) {
      if (node.isDirectory) {
        count++;
        count += countDirs(node.children || []);
      }
    }
    return count;
  }
  return countDirs($fileTree);
});

// 加载目录
export async function loadDirectory(path: string, entries?: FileNode[]) {
  isLoading.set(true);
  error.set(null);

  try {
    if (entries) {
      setDirectoryTree(entries, false);
    }
    currentDirectory.set(path);
  } catch (err) {
    error.set(err instanceof Error ? err.message : String(err));
    console.error('Failed to load directory:', err);
  } finally {
    isLoading.set(false);
  }
}

// 刷新目录
export async function refreshDirectory() {
  const $currentDirectory = get(currentDirectory);
  if (!$currentDirectory) return;
  const revision = ++refreshRevision;

  if (isTauri()) {
    // Tauri 模式：重新读取目录
    try {
      const entries = await readDirectoryTree($currentDirectory, 5);
      if (revision !== refreshRevision || get(currentDirectory) !== $currentDirectory) return;
      setDirectoryTree(entries as FileNode[], true);
    } catch (err) {
      console.error('Failed to refresh directory:', err);
    }
  } else {
    const handle = get(currentDirectoryHandle);
    if (!handle) return;
    try {
      const entries = await readDirectoryTree(handle, 5);
      if (revision !== refreshRevision || get(currentDirectoryHandle) !== handle) return;
      setDirectoryTree(entries as FileNode[], true);
    } catch (err) {
      console.error('Failed to refresh browser directory:', err);
    }
  }
}

// 切换节点展开状态
export function toggleNode(node: FileNode) {
  fileTree.update(tree => {
    function updateNode(nodes: FileNode[]): FileNode[] {
      return nodes.map(n => {
        if (n.path === node.path) {
          return { ...n, isExpanded: !n.isExpanded };
        }
        if (n.children) {
          return { ...n, children: updateNode(n.children) };
        }
        return n;
      });
    }
    return updateNode(tree);
  });
}

// 加载子节点
export async function loadNodeChildren(node: FileNode) {
  if (!node.isDirectory) return;

  // 如果已经有子节点，只切换展开状态
  if (node.children) {
    toggleNode(node);
    return;
  }

  try {
    const directoryRef = isTauri() ? node.path : node.handle;
    if (!directoryRef) return;
    const entries = await readDirectory(directoryRef);
    const children: FileNode[] = entries.map(entry => ({
      name: entry.name,
      path: isTauri() ? entry.path : `${node.path}/${entry.name}`,
      isDirectory: entry.isDirectory,
      isExpanded: false,
      handle: entry.handle,
    }));

    fileTree.update(tree => {
      function updateNode(nodes: FileNode[]): FileNode[] {
        return nodes.map(n => {
          if (n.path === node.path) {
            return { ...n, children, isExpanded: true };
          }
          if (n.children) {
            return { ...n, children: updateNode(n.children) };
          }
          return n;
        });
      }
      return updateNode(tree);
    });
  } catch (err) {
    console.error('Failed to load children:', err);
  }
}

// 清空文件树
export function clearFileTree() {
  fileTree.set([]);
  currentDirectory.set(null);
  currentDirectoryHandle.set(null);
  error.set(null);
}
