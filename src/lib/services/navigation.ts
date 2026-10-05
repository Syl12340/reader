import { tick } from 'svelte';
import { get } from 'svelte/store';
import { activeSession, activeSessionId, sessions } from '$lib/stores/document';
import { DocumentService } from './document';
import { extractHeadings } from '$lib/utils/headings';
import { parentPath, resolvePath } from '$lib/utils/path';
import { isTauri } from '$lib/utils/platform';
import { editorMode } from '$lib/stores/ui';
import { readingLine } from '$lib/stores/editor-ui';
import { notify } from './interaction';

type Location = { sessionId: string; from: number; to: number };
const back: Location[] = [];
const forward: Location[] = [];
let revision = 0;
function current(): Location | null {
  const session = get(activeSession);
  if (!session) return null;
  const from = get(editorMode) === 'preview' ? session.content.split('\n').slice(0, get(readingLine) - 1)
    .reduce((sum, line) => sum + line.length + 1, 0) : session.cursorOffset;
  return { sessionId: session.id, from, to: from };
}
async function reveal(location: Location) {
  if (!get(sessions).some(session => session.id === location.sessionId)) return;
  activeSessionId.set(location.sessionId);
  await tick();
  const session = get(activeSession)!;
  const from = Math.min(location.from, session.content.length);
  window.dispatchEvent(new CustomEvent('editor-reveal-range', { detail: {
    ...location, from, to: Math.min(location.to, session.content.length),
    line: session.content.slice(0, from).split('\n').length, focus: false,
  } }));
}

export function resolveDocumentLink(href: string, filePath: string | null) {
  const hash = href.indexOf('#');
  const pathPart = hash < 0 ? href : href.slice(0, hash);
  const anchor = hash < 0 ? '' : decodeURIComponent(href.slice(hash + 1));
  const decoded = decodeURIComponent(pathPart);
  if (decoded && /^(?![a-zA-Z]:[\\/])[a-z][\w+.-]*:/i.test(decoded)) throw new Error('不支持的本地链接协议');
  const absolute = /^[a-zA-Z]:[\\/]|^\//.test(decoded);
  const directory = filePath ? parentPath(filePath) : '';
  if (decoded && !absolute && !filePath) throw new Error('请先保存文档，以确定相对链接的位置。');
  return { path: decoded ? resolvePath(absolute ? decoded : directory ? `${directory}/${decoded}` : decoded) : filePath, anchor };
}

export class NavigationService {
  static async open(href: string): Promise<void> {
    try {
      if (/^(https?:|mailto:)/i.test(href)) {
        if (isTauri()) {
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('open_external_url', { url: href });
        } else window.open(href, '_blank', 'noopener,noreferrer');
        return;
      }
      const request = ++revision;
      const origin = current();
      const link = resolveDocumentLink(href, get(activeSession)?.path ?? null);
      const id = href.startsWith('#') ? get(activeSessionId) : link.path
        ? await DocumentService.openPath(link.path, () => request === revision && get(activeSessionId) === origin?.sessionId) : null;
      if (!id || request !== revision) return;
      const session = get(sessions).find(item => item.id === id)!;
      const heading = link.anchor ? extractHeadings(session.content).find(item => item.id === link.anchor) : null;
      if (link.anchor && !heading) { notify(`未找到标题：${link.anchor}，可在大纲中筛选标题或修改链接目标。`); return; }
      const from = heading ? session.content.split('\n').slice(0, heading.line - 1).reduce((sum, line) => sum + line.length + 1, 0) : 0;
      if (origin) { back.push(origin); if (back.length > 100) back.shift(); }
      forward.length = 0;
      await reveal({ sessionId: id, from, to: from });
    } catch (error) { notify(`无法打开链接：${error instanceof Error ? error.message : String(error)}`); }
  }

  static async travel(direction: 'back' | 'forward'): Promise<void> {
    revision++;
    const source = direction === 'back' ? back : forward;
    const destination = direction === 'back' ? forward : back;
    let target: Location | undefined;
    do { target = source.pop(); } while (target && !get(sessions).some(session => session.id === target!.sessionId));
    if (!target) return;
    const origin = current();
    if (origin) destination.push(origin);
    await reveal(target);
  }
}
