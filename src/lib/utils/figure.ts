import { dialogFocus } from './dialog-focus';
import { notify } from '../services/interaction';
import { uniqueSvg } from './svg';

export interface FigureOptions {
  title: string;
  source: string;
  edit: () => void;
  table?: () => string;
}

export async function saveFigureSvg(svg: SVGSVGElement, title: string): Promise<void> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.style.fontFamily = 'system-ui, "Microsoft YaHei", sans-serif';
  clone.querySelectorAll('[tabindex]').forEach(node => node.removeAttribute('tabindex'));
  const { embedDocumentImages } = await import('../services/export-document');
  const warnings: string[] = [];
  await embedDocumentImages(clone, warnings);
  if (warnings.length) throw new Error(warnings.join('\n'));
  const { saveExportFile } = await import('./export-formats');
  const filename = (title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim().slice(0, 80) || 'diagram') + '.svg';
  await saveExportFile(filename, new XMLSerializer().serializeToString(clone), 'image/svg+xml', 'SVG 图形');
}

function button(label: string, action: () => void): HTMLButtonElement {
  const node = document.createElement('button');
  node.type = 'button'; node.textContent = label;
  node.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); action(); });
  return node;
}

export function installFigureControls(container: HTMLElement, options: FigureOptions): void {
  container.classList.add('reader-figure');
  const body = document.createElement('div');
  body.className = 'reader-figure-body';
  body.append(...Array.from(container.childNodes));
  const graphic = document.createElement('div');
  graphic.append(...Array.from(body.childNodes));
  body.append(graphic);
  const svg = graphic.querySelector<SVGSVGElement>('svg');
  const controls = document.createElement('div');
  controls.className = 'reader-figure-actions';
  controls.setAttribute('aria-label', `${options.title}操作`);
  const show = (node: HTMLElement) => { body.replaceChildren(node); };
  const source = document.createElement('pre');
  const code = document.createElement('code'); code.textContent = options.source; source.append(code);
  if (options.table) {
    let table: HTMLElement | null = null;
    controls.append(button('图形', () => show(graphic)), button('数据', () => {
      if (!table) { table = document.createElement('div'); table.innerHTML = options.table!(); }
      show(table);
    }));
  }
  controls.append(button('查看源码', () => show(source)), button('编辑', options.edit));
  if (svg) {
    controls.append(button('放大', () => openFigure(svg, options.title)), button('导出 SVG', () => {
      void saveFigureSvg(svg, options.title).catch(error => notify(`图形导出失败：${error instanceof Error ? error.message : String(error)}`));
    }));
    if (!options.table) controls.prepend(button('图形', () => show(graphic)));
  }
  container.replaceChildren(body, controls);
}

let dialogId = 0;
export function openFigure(svg: SVGSVGElement, title: string): void {
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const dialog = document.createElement('dialog');
  dialog.className = 'reader-figure-dialog';
  dialog.tabIndex = -1;
  const heading = document.createElement('h2'); heading.textContent = title;
  heading.id = `reader-figure-title-${++dialogId}`;
  dialog.setAttribute('aria-labelledby', heading.id);
  const header = document.createElement('header');
  const viewport = document.createElement('div');
  viewport.className = 'reader-figure-viewport'; viewport.tabIndex = 0;
  viewport.setAttribute('aria-label', '图形视图，可使用方向键滚动');
  viewport.innerHTML = uniqueSvg(new XMLSerializer().serializeToString(svg), `figure-dialog-${dialogId}-`);
  const graphic = viewport.querySelector<SVGSVGElement>('svg')!;
  let zoom = 1;
  const status = document.createElement('output'); status.setAttribute('aria-live', 'polite');
  const resize = () => {
    const viewBox = graphic.viewBox?.baseVal;
    const ratio = viewBox?.width && viewBox.height ? viewBox.height / viewBox.width : 0.6;
    const fit = Math.max(240, Math.min(viewport.clientWidth - 48, (viewport.clientHeight - 48) / ratio));
    const width = fit * zoom;
    graphic.style.cssText = `display:block;width:${width}px;min-width:${width}px;max-width:none;height:auto;margin:auto;`;
    status.textContent = `${Math.round(zoom * 100)}%`;
  };
  const changeZoom = (factor: number) => { zoom = Math.max(0.25, Math.min(6, zoom * factor)); resize(); };
  const close = () => dialog.close();
  header.append(heading, button('缩小', () => changeZoom(1 / 1.25)), status,
    button('放大', () => changeZoom(1.25)), button('适应窗口', () => { zoom = 1; resize(); }), button('关闭', close));
  dialog.append(header, viewport); document.body.append(dialog);
  const focus = dialogFocus(dialog, { close, initial: 'header button:last-child' });
  const observer = new ResizeObserver(resize); observer.observe(viewport);
  let dragging: { x: number; y: number; left: number; top: number } | null = null;
  viewport.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    dragging = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
    viewport.setPointerCapture(event.pointerId);
  });
  viewport.addEventListener('pointermove', event => {
    if (!dragging) return;
    viewport.scrollLeft = dragging.left + dragging.x - event.clientX;
    viewport.scrollTop = dragging.top + dragging.y - event.clientY;
  });
  viewport.addEventListener('pointerup', () => { dragging = null; });
  viewport.addEventListener('pointercancel', () => { dragging = null; });
  dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
  dialog.addEventListener('close', () => {
    observer.disconnect(); focus.destroy(); dialog.remove();
    previous?.isConnected && previous.focus({ preventScroll: true });
  }, { once: true });
  dialog.showModal(); resize();
}
