import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import { WidgetType, type EditorView } from '@codemirror/view';
import type { SourceRange } from '../markdown-scanner';
import { makeSourceButton, revealSource } from './common';

export interface ImageRange extends SourceRange {
  source: string;
  alt: string;
  block: boolean;
}

export class ImageWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly resolvedSource: string,
    readonly alt: string,
    readonly position: number,
    readonly cacheKey: string,
    readonly block: boolean,
  ) {
    super();
  }

  eq(other: ImageWidget): boolean {
    return other.cacheKey === this.cacheKey && other.position === this.position;
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement(this.block ? 'div' : 'span');
    container.className = this.block
      ? 'cm-image-widget cm-block-widget'
      : 'cm-image-widget cm-inline-widget';
    const preview = document.createElement('button');
    preview.type = 'button';
    preview.className = 'cm-image-preview-button';
    preview.setAttribute('aria-label', `编辑图片：${this.alt || this.source}`);
    const image = document.createElement('img');
    image.className = 'cm-image-preview';
    image.src = this.resolvedSource;
    image.alt = this.alt;
    image.loading = 'lazy';
    preview.addEventListener('click', () => revealSource(view, this.position));
    image.addEventListener('error', () => {
      preview.remove();
      const error = document.createElement('div');
      error.className = 'cm-widget-error';
      error.textContent = `图片加载失败：${this.source}`;
      error.appendChild(makeSourceButton('编辑路径', view, this.position));
      container.appendChild(error);
    });
    preview.appendChild(image);
    container.appendChild(preview);
    return container;
  }

  get estimatedHeight(): number {
    return this.block ? 220 : -1;
  }
}

export function collectImageRanges(
  state: EditorState,
  visibleRanges: readonly SourceRange[],
): ImageRange[] {
  const images: ImageRange[] = [];
  for (const visible of visibleRanges) {
    syntaxTree(state).iterate({
      from: visible.from,
      to: visible.to,
      enter(node) {
        if (node.name !== 'Image') return;
        const url = node.node.getChild('URL');
        const label = node.node.getChild('LinkText');
        if (!url) return;
        const line = state.doc.lineAt(node.from);
        images.push({
          from: node.from,
          to: node.to,
          source: state.sliceDoc(url.from, url.to),
          alt: label ? state.sliceDoc(label.from, label.to) : '',
          block: line.text.trim() === state.sliceDoc(node.from, node.to).trim(),
        });
      },
    });
  }
  return images;
}
