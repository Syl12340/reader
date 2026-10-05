import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { waitForWindowCreation } from '../../src/lib/utils/window-creation';
import { openInNewWindow } from '../../src/lib/utils/window-manager';
import { notices } from '../../src/lib/services/interaction';

vi.mock('../../src/lib/utils/platform', () => ({ isTauri: () => false }));

type EventName = 'tauri://created' | 'tauri://error';
type Handler = (event: { payload: unknown }) => void;

function creationSource() {
  const handlers = new Map<EventName, Handler>();
  const cleanup = new Map<EventName, ReturnType<typeof vi.fn>>();
  const once = vi.fn((event: EventName, handler: Handler) => {
    handlers.set(event, handler);
    const unlisten = vi.fn(); cleanup.set(event, unlisten);
    return Promise.resolve(unlisten);
  });
  return { once, cleanup, emit: (event: EventName, payload: unknown = null) => handlers.get(event)?.({ payload }) };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); notices.set([]); });

describe('window creation lifecycle', () => {
  it('removes both listeners and the timeout after successful creation', async () => {
    vi.useFakeTimers();
    const source = creationSource(), request = waitForWindowCreation(source);
    await Promise.resolve(); source.emit('tauri://created');
    await expect(request).resolves.toBeUndefined();
    expect(source.cleanup.get('tauri://created')).toHaveBeenCalledOnce();
    expect(source.cleanup.get('tauri://error')).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    source.emit('tauri://error', 'late error');
    expect(source.cleanup.get('tauri://error')).toHaveBeenCalledOnce();
  });

  it('rejects creation errors once and clears resources', async () => {
    vi.useFakeTimers();
    const source = creationSource(), request = waitForWindowCreation(source);
    const rejected = expect(request).rejects.toThrow('denied');
    await Promise.resolve(); source.emit('tauri://error', 'denied');
    await rejected;
    source.emit('tauri://created');
    expect(source.cleanup.get('tauri://created')).toHaveBeenCalledOnce();
    expect(source.cleanup.get('tauri://error')).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('handles rejected listener registration without leaving the other listener or timer', async () => {
    vi.useFakeTimers();
    const cleanup = vi.fn();
    const source = { once: vi.fn((event: EventName, _handler: Handler) => event === 'tauri://created'
      ? Promise.reject(new Error('registration failed')) : Promise.resolve(cleanup)) };
    await expect(waitForWindowCreation(source)).rejects.toThrow('registration failed');
    expect(cleanup).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('times out safely and ignores subsequent creation events', async () => {
    vi.useFakeTimers();
    const source = creationSource(), request = waitForWindowCreation(source, 50);
    const rejected = expect(request).rejects.toThrow('响应超时');
    await vi.advanceTimersByTimeAsync(50); await rejected;
    source.emit('tauri://created');
    expect(source.cleanup.get('tauri://created')).toHaveBeenCalledOnce();
    expect(source.cleanup.get('tauri://error')).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans up registration that resolves after an immediate creation event', async () => {
    vi.useFakeTimers();
    const cleanup = vi.fn();
    let registered!: (unlisten: () => void) => void;
    const source = { once: vi.fn((_event: EventName, handler: Handler) => {
      handler({ payload: null });
      return new Promise<() => void>(resolve => { registered = resolve; });
    }) };
    await expect(waitForWindowCreation(source)).resolves.toBeUndefined();
    expect(source.once).toHaveBeenCalledOnce();
    registered(cleanup); await Promise.resolve();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('finishes and removes remaining listeners even if one cleanup throws', async () => {
    const source = creationSource(), request = waitForWindowCreation(source);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await Promise.resolve();
    source.cleanup.get('tauri://created')!.mockImplementation(() => { throw new Error('already removed'); });
    source.emit('tauri://created');
    await expect(request).resolves.toBeUndefined();
    expect(source.cleanup.get('tauri://error')).toHaveBeenCalledOnce();
  });

  it('does not open an unauthorized browser tab for a native path', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    expect(await openInNewWindow('D:/notes/private.md')).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(get(notices)[0]?.message).toContain('无法继承文件授权');
  });
});
