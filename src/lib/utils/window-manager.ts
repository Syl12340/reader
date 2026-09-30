/**
 * 多窗口管理工具
 * Tauri v2 多窗口支持
 */

import { isTauri } from './platform';

/**
 * 在新窗口中打开文件
 */
export async function openInNewWindow(filePath: string): Promise<boolean> {
  if (!isTauri()) {
    // 浏览器模式：打开新标签
    return window.open(`/?file=${encodeURIComponent(filePath)}`, '_blank') !== null;
  }

  try {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    // 创建新窗口，通过 URL 参数传递文件路径
    const label = `reader-${crypto.randomUUID()}`;
    const webview = new WebviewWindow(label, {
      url: `/?file=${encodeURIComponent(filePath)}`,
      title: `Reader - ${filePath.split(/[/\\]/).pop() || filePath}`,
      width: 1200,
      height: 800,
      minWidth: 800,
      minHeight: 600,
      center: true,
      resizable: true,
    });

    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (result: boolean) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      void webview.once('tauri://created', () => finish(true));
      void webview.once('tauri://error', (event) => {
        console.error('Failed to create window:', event);
        alert(`无法创建新窗口: ${String(event.payload)}`);
        finish(false);
      });
      setTimeout(() => {
        if (!settled) {
          alert('创建新窗口超时，请重试。');
          finish(false);
        }
      }, 10_000);
    });
  } catch (err) {
    console.error('Failed to open new window:', err);
    alert(`无法创建新窗口: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/**
 * 获取当前窗口标签
 */
export function getWindowLabel(): string {
  if (!isTauri()) return 'main';
  // Tauri 环境下可以通过 URL 参数或其他方式获取
  return 'main';
}
