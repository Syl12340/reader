/**
 * 多窗口管理工具
 * Tauri v2 多窗口支持
 */

import { isTauri } from './platform';

/**
 * 在新窗口中打开文件
 */
export async function openInNewWindow(filePath: string): Promise<void> {
  if (!isTauri()) {
    // 浏览器模式：打开新标签
    window.open(`/?file=${encodeURIComponent(filePath)}`, '_blank');
    return;
  }

  try {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    const { join, appDataDir } = await import('@tauri-apps/api/path');

    // 创建新窗口，通过 URL 参数传递文件路径
    const label = `reader-${Date.now()}`;
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

    webview.once('tauri://error', (e) => {
      console.error('Failed to create window:', e);
    });
  } catch (err) {
    console.error('Failed to open new window:', err);
    // 降级：在当前窗口打开
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
