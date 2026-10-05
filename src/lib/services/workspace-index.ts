import { get, writable } from 'svelte/store';
import { currentDirectory, currentDirectoryHandle } from '$lib/stores/file';
import { readDirectory } from '$lib/utils/native-fs';
import { normalizePathKey, joinPath } from '$lib/utils/path';
import { isTauri } from '$lib/utils/platform';

interface IndexState { root: string | null; paths: string[]; status: 'idle' | 'indexing' | 'ready' | 'partial' | 'cancelled'; detail: string }
export const workspaceIndex = writable<IndexState>({ root: null, paths: [], status: 'idle', detail: '' });
const ignored = new Set(['node_modules', 'target', 'build', 'dist', '.git', '.svelte-kit']);
const extensions = /\.(md|markdown|mdown|mkd|txt|mdx)$/i;
let revision = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

export class WorkspaceIndex {
  static cancel() {
    revision++; if (timer) clearTimeout(timer); timer = null;
    workspaceIndex.update(state => ({ ...state, status: 'cancelled', detail: '已取消，当前索引可能不完整' }));
  }
  static invalidate() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void this.refresh(); }, 600);
  }
  static start(): () => void {
    let root: string | null = null;
    let handle: FileSystemDirectoryHandle | null = null;
    const changed = () => {
      const nextRoot = get(currentDirectory), nextHandle = get(currentDirectoryHandle);
      if (nextRoot === root && nextHandle === handle) return;
      root = nextRoot; handle = nextHandle; this.cancel();
      workspaceIndex.set({ root, paths: [], status: 'idle', detail: '' });
      this.invalidate();
    };
    const cleanups = [currentDirectory.subscribe(changed), currentDirectoryHandle.subscribe(changed)];
    return () => { cleanups.forEach(cleanup => cleanup()); this.cancel(); };
  }
  static async refresh(): Promise<void> {
    if (timer) clearTimeout(timer); timer = null;
    const request = ++revision, root = get(currentDirectory), handle = get(currentDirectoryHandle);
    const native = isTauri();
    if (!root || (!native && !handle)) { workspaceIndex.set({ root, paths: [], status: 'idle', detail: '' }); return; }
    const valid = () => request === revision && root === get(currentDirectory) && handle === get(currentDirectoryHandle);
    workspaceIndex.update(state => ({ root, paths: state.root === root ? state.paths : [], status: 'indexing', detail: '正在索引工作区文件名…' }));
    const queue: Array<{ ref: string | FileSystemDirectoryHandle; relative: string; depth: number }> = [{ ref: native ? root : handle!, relative: '', depth: 0 }];
    const paths = new Map<string, string>();
    const seen = new Set<string>();
    const started = Date.now();
    let cursor = 0, partial = false, errors = 0, scanned = 0;
    while (cursor < queue.length && valid()) {
      if (cursor >= 10000 || paths.size >= 50000 || scanned >= 100000 || Date.now() - started > 30000) { partial = true; break; }
      const item = queue[cursor++];
      const key = normalizePathKey(native ? item.ref as string : item.relative || '/');
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        const entries = await readDirectory(item.ref);
        if (!valid()) return;
        for (const entry of entries) {
          if (++scanned > 100000) { partial = true; break; }
          if (entry.name.startsWith('.') || ignored.has(entry.name.toLowerCase())) continue;
          const path = native ? entry.path : item.relative ? joinPath(item.relative, entry.name) : entry.name;
          if (entry.isDirectory) {
            if (item.depth >= 64) { partial = true; continue; }
            if (queue.length >= 10000) { partial = true; continue; }
            const ref = native ? path : entry.handle as FileSystemDirectoryHandle | undefined;
            if (ref) queue.push({ ref, relative: path, depth: item.depth + 1 });
          } else if (extensions.test(entry.name)) paths.set(normalizePathKey(path), path);
          if (paths.size >= 50000) { partial = true; break; }
        }
      } catch { errors++; partial = true; }
      if (cursor % 32 === 0) {
        workspaceIndex.set({ root, paths: [...paths.values()], status: 'indexing', detail: `已索引 ${paths.size} 个文档…` });
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    if (!valid()) return;
    workspaceIndex.set({ root, paths: [...paths.values()], status: partial ? 'partial' : 'ready',
      detail: `${paths.size} 个文档${partial ? ` · 索引不完整（限额或 ${errors} 个不可读目录）` : ' · 工作区索引完成'} · 跳过隐藏目录和构建缓存` });
  }
}
