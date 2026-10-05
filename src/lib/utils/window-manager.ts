/**
 * 多窗口管理工具
 * Tauri v2 多窗口支持
 */

import { isTauri } from './platform';
import { waitForWindowCreation } from './window-creation';
import { notify } from '$lib/services/interaction';

/**
 * 在新窗口中打开文件
 */
export async function openInNewWindow(filePath: string): Promise<boolean> {
  if (!isTauri()) {
    notify('新窗口打开仅支持桌面版；浏览器新标签无法继承文件授权。');
    return false;
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

    await waitForWindowCreation(webview);
    return true;
  } catch (err) {
    console.error('Failed to open new window:', err);
    notify(`无法创建新窗口：${err instanceof Error ? err.message : String(err)}`);
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
