import { get, writable } from 'svelte/store';

export type ExportStage = 'destination' | 'render' | 'resources' | 'write';
export interface ExportJobState { label: string; stage: ExportStage; cancellable: boolean }
export const exportJob = writable<ExportJobState | null>(null);
let controller: AbortController | null = null;

export function cancelExport(): void {
  if (get(exportJob)?.cancellable) controller?.abort();
}

export function checkExportSignal(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Export canceled', 'AbortError');
}

export async function waitForExport<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  checkExportSignal(signal);
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException('Export canceled', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export async function withExportJob(label: string, action: (signal: AbortSignal, stage: (value: ExportStage) => void) => Promise<void>): Promise<boolean> {
  if (controller) return false;
  const job = new AbortController();
  controller = job;
  const stage = (value: ExportStage) => {
    checkExportSignal(job.signal);
    exportJob.set({ label, stage: value, cancellable: value !== 'write' });
  };
  stage('destination');
  try { await action(job.signal, stage); checkExportSignal(job.signal); return true; }
  finally { if (controller === job) { controller = null; exportJob.set(null); } }
}
