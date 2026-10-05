import { syntaxTree } from '@codemirror/language';
import type { EditorView } from '@codemirror/view';
import { get } from 'svelte/store';
import { activeSessionId } from '$lib/stores/document';
import type { ResourceEditRequest } from '$lib/utils/resource-edit';

export function inspectResource(view: EditorView, position: number): boolean {
  let node = syntaxTree(view.state).resolveInner(position, 1);
  while (node.parent && node.name !== 'Image' && node.name !== 'Link') node = node.parent;
  const url = node.getChild('URL');
  const marks = node.getChildren('LinkMark');
  const labelFrom = marks[0]?.to, labelTo = marks[1]?.from;
  const sessionId = get(activeSessionId);
  if (!sessionId || !url || labelFrom == null || labelTo == null || !['Image', 'Link'].includes(node.name)) return false;
  const request: ResourceEditRequest = {
    sessionId, kind: node.name === 'Image' ? 'image' : 'link', from: node.from, to: node.to,
    markdown: view.state.sliceDoc(node.from, node.to),
    source: view.state.sliceDoc(url.from, url.to).replace(/^<|>$/g, ''),
    label: view.state.sliceDoc(labelFrom, labelTo).replace(/\\([\\[\]])/g, '$1'),
    sourceFrom: url.from - node.from, sourceTo: url.to - node.from,
    labelFrom: labelFrom - node.from, labelTo: labelTo - node.from,
  };
  window.dispatchEvent(new CustomEvent('reader-inspect-resource', { detail: request }));
  return true;
}
