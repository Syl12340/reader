import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
  type WidgetType,
} from '@codemirror/view';
import type { WidgetRenderContext } from '$lib/types';
import {
  intersectsSelection,
  scanFencedBlocks,
  scanMath,
  scanTables,
  scanTasks,
  type FenceRange,
  type MathRange,
  type SourceRange,
  type TableRange,
  type TaskRange,
} from '$lib/editor/markdown-scanner';
import {
  isCovered,
  type DecorationRange,
} from '$lib/editor/decorations/common';
import {
  collectImageRanges,
  ImageWidget,
} from '$lib/editor/decorations/image';
import { MathWidget } from '$lib/editor/decorations/math';
import { TaskWidget } from '$lib/editor/decorations/task';
import { CodeWidget, MermaidWidget, ChartWidget } from '$lib/editor/decorations/code';
import { TableWidget } from '$lib/editor/decorations/table';
import { collectMarkerDecorations } from '$lib/editor/decorations/marker';
import { resolveImageSrc } from './markdown';

interface ScanCache {
  fences: FenceRange[];
  math: MathRange[];
  tasks: TaskRange[];
  tables: TableRange[];
}

const SCAN_MARGIN = 10_000;
const scansByDocument = new WeakMap<object, Map<string, ScanCache>>();
const interactionState = StateEffect.define<{ composing?: boolean; dragging?: boolean }>();

function scanDocument(text: string, excluded: SourceRange[] = []): ScanCache {
  const fences = scanFencedBlocks(text);
  const codeRanges = [...fences, ...excluded];
  return {
    fences,
    math: scanMath(text, codeRanges),
    tasks: scanTasks(text, codeRanges),
    tables: scanTables(text, codeRanges),
  };
}

function mergeScanCache(target: ScanCache, source: ScanCache, offset: number): void {
  target.fences.push(...source.fences.map(item => ({
    ...item,
    from: item.from + offset,
    to: item.to + offset,
  })));
  target.math.push(...source.math.map(item => ({
    ...item,
    from: item.from + offset,
    to: item.to + offset,
  })));
  target.tasks.push(...source.tasks.map(item => ({
    ...item,
    from: item.from + offset,
    to: item.to + offset,
  })));
  target.tables.push(...source.tables.map(item => ({
    ...item,
    from: item.from + offset,
    to: item.to + offset,
  })));
}

function expandedScanRanges(
  state: EditorState,
  visibleRanges: readonly SourceRange[],
): SourceRange[] {
  const expanded = visibleRanges.map(range => {
    const roughFrom = Math.min(state.doc.length, Math.max(0, range.from - SCAN_MARGIN));
    const roughTo = Math.min(state.doc.length, range.to + SCAN_MARGIN);
    return {
      from: state.doc.lineAt(roughFrom).from,
      to: state.doc.lineAt(roughTo).to,
    };
  }).sort((a, b) => a.from - b.from);

  const merged: SourceRange[] = [];
  for (const range of expanded) {
    const previous = merged[merged.length - 1];
    if (previous && range.from <= previous.to + 1) {
      previous.to = Math.max(previous.to, range.to);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function scansForState(
  state: EditorState,
  visibleRanges: readonly SourceRange[],
): ScanCache {
  const documentKey = state.doc as unknown as object;
  const scanRanges = expandedScanRanges(state, visibleRanges);
  const cacheKey = scanRanges.map(range => `${range.from}:${range.to}`).join('|');
  let documentCache = scansByDocument.get(documentKey);
  if (!documentCache) {
    documentCache = new Map();
    scansByDocument.set(documentKey, documentCache);
  }
  const cached = documentCache.get(cacheKey);
  if (cached) return cached;

  const scans: ScanCache = { fences: [], math: [], tasks: [], tables: [] };
  for (const range of scanRanges) {
    const excluded: SourceRange[] = [];
    syntaxTree(state).iterate({ from: range.from, to: range.to, enter(node) {
      if (!/^(FencedCode|CodeBlock|InlineCode)$/.test(node.name)) return;
      excluded.push({ from: node.from - range.from, to: node.to - range.from });
      return false;
    } });
    mergeScanCache(scans, scanDocument(state.sliceDoc(range.from, range.to), excluded), range.from);
  }
  documentCache.set(cacheKey, scans);
  if (documentCache.size > 24) {
    const oldestKey = documentCache.keys().next().value;
    if (oldestKey !== undefined) documentCache.delete(oldestKey);
  }
  return scans;
}

function inVisibleRange(range: SourceRange, visibleRanges: readonly SourceRange[]): boolean {
  return visibleRanges.some(visible => range.from <= visible.to && range.to >= visible.from);
}

function createDecorations(
  state: EditorState,
  visibleRanges: readonly SourceRange[],
  context: WidgetRenderContext,
  sessionId: string,
  scans: ScanCache,
  version: string,
): DecorationSet {
  const selections = state.selection.ranges.map(range => ({ from: range.from, to: range.to }));
  const ranges: DecorationRange[] = [];
  const covered: SourceRange[] = [];
  const active = (range: SourceRange) => intersectsSelection(range, selections);
  const addReplacement = (range: SourceRange, widget: WidgetType, block: boolean) => {
    covered.push(range);
    ranges.push({
      ...range,
      decoration: Decoration.replace({ widget, block, inclusive: false }),
    });
  };

  for (const item of scans.fences) {
    if (item.closed === false || !inVisibleRange(item, visibleRanges) || active(item)) continue;
    addReplacement(
      item,
      item.language === 'mermaid'
        ? new MermaidWidget(item, context.theme, version)
        : item.language === 'chart' ? new ChartWidget(item, context.theme)
        : ['latex', 'math', 'tex'].includes(item.language)
          ? new MathWidget({ ...item, source: item.code, display: true }, true, context.theme)
        : new CodeWidget(item, context.theme, version),
      true,
    );
  }

  for (const item of scans.tables) {
    if (!inVisibleRange(item, visibleRanges) || active(item) || isCovered(item, covered)) continue;
    addReplacement(item, new TableWidget(item, sessionId, context.filePath), true);
  }

  for (const item of scans.math) {
    if (!inVisibleRange(item, visibleRanges) || active(item) || isCovered(item, covered)) continue;
    const startLine = state.doc.lineAt(item.from);
    const endLine = state.doc.lineAt(Math.max(item.from, item.to - 1));
    const block = item.display && startLine.from === item.from && endLine.to === item.to;
    addReplacement(item, new MathWidget(item, block, context.theme), block);
  }

  for (const item of scans.tasks) {
    if (!inVisibleRange(item, visibleRanges) || active(item) || isCovered(item, covered)) continue;
    addReplacement(item, new TaskWidget(item), false);
  }

  for (const image of collectImageRanges(state, visibleRanges)) {
    if (active(image) || isCovered(image, covered)) continue;
    const directory = context.filePath?.replace(/[\\/][^\\/]*$/, '') || '';
    const resolvedSource = resolveImageSrc(image.source, context.filePath);
    const key = `${image.source}|${image.alt}|${directory}|${context.theme}|${image.block}`;
    addReplacement(
      image,
      new ImageWidget(
        image.source,
        resolvedSource,
        image.alt,
        image.from,
        key,
        image.block,
      ),
      image.block,
    );
  }

  ranges.push(...collectMarkerDecorations(state, visibleRanges, covered, active));

  return Decoration.set(
    ranges
      .filter(range => range.from >= 0 && range.to <= state.doc.length && range.to >= range.from)
      .map(range => range.decoration.range(range.from, range.to)),
    true,
  );
}

export function createMarkdownDecorations(
  context: WidgetRenderContext,
  sessionId: string,
  initialVisibleRanges?: readonly SourceRange[],
): Extension {
  interface DecorationState {
    decorations: DecorationSet;
    scans: ScanCache;
    version: number;
    visibleRanges: readonly SourceRange[];
    composing: boolean;
    dragging: boolean;
  }

  const setVisibleRanges = StateEffect.define<readonly SourceRange[]>();
  const field = StateField.define<DecorationState>({
    create(state) {
      const visibleRanges = initialVisibleRanges?.length
        ? initialVisibleRanges.map(range => ({
            from: Math.min(range.from, state.doc.length),
            to: Math.min(range.to, state.doc.length),
          }))
        : [{ from: 0, to: Math.min(state.doc.length, 10_000) }];
      const scans = scansForState(state, visibleRanges);
      return {
        scans,
        visibleRanges,
        version: 0,
        composing: false,
        dragging: false,
        decorations: createDecorations(state, visibleRanges, context, sessionId, scans, '0'),
      };
    },
    update(value, transaction) {
      let visibleRanges = transaction.docChanged ? value.visibleRanges.map(range => ({
        from: transaction.changes.mapPos(range.from, -1), to: transaction.changes.mapPos(range.to, 1),
      })) : value.visibleRanges;
      let composing = value.composing, dragging = value.dragging;
      for (const effect of transaction.effects) {
        if (effect.is(setVisibleRanges)) visibleRanges = effect.value;
        if (effect.is(interactionState)) {
          composing = effect.value.composing ?? composing;
          dragging = effect.value.dragging ?? dragging;
        }
      }
      // Keep the DOM stable while the IME or pointer owns the selection.
      if (composing || dragging) return { ...value, composing, dragging, visibleRanges,
        decorations: value.decorations.map(transaction.changes),
        version: value.version + (transaction.docChanged ? 1 : 0) };
      const released = value.composing || value.dragging;
      const visibleRangesChanged = visibleRanges !== value.visibleRanges;
      const scans = transaction.docChanged || visibleRangesChanged || released
        ? scansForState(transaction.state, visibleRanges)
        : value.scans;
      const version = transaction.docChanged ? value.version + 1 : value.version;
      const shouldUpdate = transaction.docChanged
        || transaction.selection
        || visibleRangesChanged || released;
      if (!shouldUpdate) return value;

      return {
        scans,
        visibleRanges,
        composing,
        dragging,
        version,
        decorations: createDecorations(
          transaction.state,
          visibleRanges,
          context,
          sessionId,
          scans,
          String(version),
        ),
      };
    },
    provide: decorationField => EditorView.decorations.from(
      decorationField,
      value => value.decorations,
    ),
  });

  const viewportSync = ViewPlugin.fromClass(class {
    private scheduled = false;
    private destroyed = false;
    private releasePointer = () => this.defer({ dragging: false });

    constructor(readonly view: EditorView) {
      view.dom.ownerDocument.addEventListener('pointerup', this.releasePointer);
      view.dom.ownerDocument.addEventListener('pointercancel', this.releasePointer);
      this.schedule();
    }

    freeze(value: { composing?: boolean; dragging?: boolean }) {
      this.view.dispatch({ effects: interactionState.of(value) });
    }

    defer(value: { composing?: boolean; dragging?: boolean }) {
      queueMicrotask(() => { if (!this.destroyed) this.freeze(value); });
    }

    update(update: ViewUpdate) {
      if (update.viewportChanged) this.schedule();
    }

    destroy() {
      this.destroyed = true;
      this.view.dom.ownerDocument.removeEventListener('pointerup', this.releasePointer);
      this.view.dom.ownerDocument.removeEventListener('pointercancel', this.releasePointer);
    }

    private schedule() {
      if (this.scheduled) return;
      this.scheduled = true;
      queueMicrotask(() => {
        this.scheduled = false;
        if (this.destroyed) return;
        this.view.dispatch({
          effects: setVisibleRanges.of(
            this.view.visibleRanges.map(range => ({ from: range.from, to: range.to })),
          ),
        });
      });
    }
  }, { eventHandlers: {
    compositionstart() { this.freeze({ composing: true }); },
    compositionend() { this.defer({ composing: false }); },
    pointerdown(event) {
      if (event.button === 0 && event.target instanceof Element && event.target.closest('.cm-content')
        && !event.target.closest('.cm-block-widget, input, button, a')) this.freeze({ dragging: true });
    },
    blur() { this.defer({ composing: false, dragging: false }); },
  } });

  return [field, viewportSync];
}
