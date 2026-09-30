const PREVIEW_KEY = 'data-preview-key';
const sourceMetadata = new WeakMap<Node, { signature: string; key: string; lines: Element[] }>();

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function sourceSignature(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return `text:${node.textContent ?? ''}`;
  if (!(node instanceof Element)) return `node:${node.nodeName}:${node.textContent ?? ''}`;
  const clone = node.cloneNode(true) as Element;
  clone.removeAttribute(PREVIEW_KEY);
  clone.querySelectorAll(`[${PREVIEW_KEY}]`).forEach(child => child.removeAttribute(PREVIEW_KEY));
  clone.querySelectorAll('[data-line]').forEach(child => child.removeAttribute('data-line'));
  clone.removeAttribute('data-line');
  return `${clone.tagName}:${clone.outerHTML}`;
}

function assignStableKeys(nodes: Node[]): void {
  const occurrences = new Map<string, number>();
  for (const node of nodes) {
    const signature = sourceSignature(node);
    const count = occurrences.get(signature) ?? 0;
    occurrences.set(signature, count + 1);
    const key = `${hashText(signature)}:${count}`;
    sourceMetadata.set(node, {
      signature,
      key,
      lines: node instanceof Element
        ? [...(node.hasAttribute('data-line') ? [node] : []), ...node.querySelectorAll('[data-line]')]
        : [],
    });
    if (node instanceof HTMLElement) {
      node.setAttribute(PREVIEW_KEY, key);
    }
  }
}

function syncLineMetadata(current: Node, next: Node): void {
  const currentLines = sourceMetadata.get(current)?.lines ?? [];
  const nextLines = sourceMetadata.get(next)?.lines ?? [];
  // Keep source references because enhancements can insert unrelated children.
  for (let index = 0; index < Math.min(currentLines.length, nextLines.length); index++) {
    const line = nextLines[index].getAttribute('data-line');
    if (line !== null && current.contains(currentLines[index])) {
      currentLines[index].setAttribute('data-line', line);
    }
  }
}

export interface PatchResult {
  changedRoots: HTMLElement[];
  replacedAll: boolean;
}

export function patchPreviewHtml(
  container: HTMLElement,
  html: string,
  replaceAll = false,
): PatchResult {
  const template = document.createElement('template');
  template.innerHTML = html;
  const nextNodes = Array.from(template.content.childNodes);
  assignStableKeys(nextNodes);

  if (replaceAll || container.childNodes.length === 0) {
    container.replaceChildren(...nextNodes);
    return {
      changedRoots: nextNodes.filter((node): node is HTMLElement => node instanceof HTMLElement),
      replacedAll: true,
    };
  }

  const existingByKey = new Map<string, Node[]>();
  Array.from(container.childNodes).forEach(node => {
    const metadata = sourceMetadata.get(node);
    if (!metadata) return;
    const bucket = existingByKey.get(metadata.key) ?? [];
    bucket.push(node);
    existingByKey.set(metadata.key, bucket);
  });

  const retained = new Set<Node>();
  const changedRoots: HTMLElement[] = [];
  const targets = nextNodes.map(nextNode => {
    const metadata = sourceMetadata.get(nextNode)!;
    const bucket = existingByKey.get(metadata.key);
    const index = bucket?.findIndex(node => sourceMetadata.get(node)?.signature === metadata.signature) ?? -1;
    const existing = index >= 0 ? bucket!.splice(index, 1)[0] : undefined;
    const target = existing ?? nextNode;
    if (existing) syncLineMetadata(existing, nextNode);
    else if (nextNode instanceof HTMLElement) changedRoots.push(nextNode);
    retained.add(target);
    return target;
  });

  for (const node of Array.from(container.childNodes)) {
    if (!retained.has(node)) node.remove();
  }
  let cursor: ChildNode | null = container.firstChild;
  for (const target of targets) {
    if (target !== cursor) container.insertBefore(target, cursor);
    cursor = target.nextSibling;
  }

  return { changedRoots, replacedAll: false };
}
