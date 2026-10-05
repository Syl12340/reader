interface WindowCreationSource {
  once(event: 'tauri://created' | 'tauri://error', handler: (event: { payload: unknown }) => void): Promise<() => void>;
}

export function waitForWindowCreation(source: WindowCreationSource, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const listeners: Array<() => void> = [];
    const cleanup = (unlisten: () => void) => {
      try { unlisten(); } catch (error) { console.warn('Failed to remove window creation listener:', error); }
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      listeners.splice(0).forEach(cleanup);
      if (error) reject(error); else resolve();
    };
    const timer = setTimeout(() => finish(new Error('新窗口响应超时，请确认窗口是否已创建后再试。')), timeoutMs);
    const fail = (error: unknown) => finish(error instanceof Error ? error : new Error(String(error ?? '未知错误')));
    for (const event of ['tauri://created', 'tauri://error'] as const) {
      try {
        // Registration may finish after creation, failure or timeout has already settled the request.
        void source.once(event, payload => event === 'tauri://created' ? finish() : fail(payload.payload))
          .then(unlisten => { if (settled) cleanup(unlisten); else listeners.push(unlisten); }, fail);
      } catch (error) { fail(error); }
      if (settled) break;
    }
  });
}
