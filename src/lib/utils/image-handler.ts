/**
 * 图片粘贴处理工具
 * 支持从剪贴板粘贴图片并保存到文件系统
 */

import { isTauri } from './platform';

/**
 * 生成带时间戳的图片文件名
 */
function generateImageName(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `image-${date}-${time}.png`;
}

/**
 * 从剪贴板事件中提取图片数据
 * @returns 图片的 Blob，如果没有图片则返回 null
 */
function extractImageFromClipboard(event: ClipboardEvent): Blob | null {
  const items = event.clipboardData?.items;
  if (!items) return null;

  for (const item of items) {
    if (item.type.startsWith('image/')) {
      return item.getAsFile();
    }
  }
  return null;
}

/**
 * Blob 转 Base64
 */
async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // 去掉 data:image/png;base64, 前缀
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * 处理图片粘贴
 * @param event 粘贴事件
 * @param currentFilePath 当前编辑文件的路径（用于确定图片保存目录）
 * @returns Markdown 图片语法，如果没有图片则返回 null
 */
export async function handleImagePaste(
  event: ClipboardEvent,
  currentFilePath: string | null
): Promise<string | null> {
  const blob = extractImageFromClipboard(event);
  if (!blob) return null;

  const imageName = generateImageName();

  if (isTauri()) {
    return await handleTauriImagePaste(blob, imageName, currentFilePath);
  } else {
    return await handleBrowserImagePaste(blob, imageName);
  }
}

/**
 * Tauri 模式：保存图片到文件系统
 */
async function handleTauriImagePaste(
  blob: Blob,
  imageName: string,
  currentFilePath: string | null
): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core');

  // 获取当前文件所在目录
  let dirPath = '';
  if (currentFilePath) {
    const sep = currentFilePath.includes('\\') ? '\\' : '/';
    const parts = currentFilePath.split(sep);
    parts.pop();
    dirPath = parts.join(sep);
  }

  // 创建 assets 目录
  const assetsDir = dirPath ? `${dirPath}/assets` : 'assets';
  try {
    await invoke('create_directory', { path: assetsDir });
  } catch {
    // 目录可能已存在，忽略错误
  }

  // 保存图片
  const base64 = await blobToBase64(blob);
  const imagePath = `${assetsDir}/${imageName}`;
  await invoke('save_image', { path: imagePath, data: base64 });

  // 返回相对路径的 Markdown 图片语法
  return `![image](./assets/${imageName})`;
}

/**
 * 浏览器模式：下载图片
 */
async function handleBrowserImagePaste(blob: Blob, imageName: string): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(`![image](${reader.result})`);
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * 处理拖拽图片
 * @param event 拖放事件
 * @param currentFilePath 当前编辑文件的路径
 * @returns Markdown 图片语法，如果没有图片则返回 null
 */
export async function handleImageDrop(
  event: DragEvent,
  currentFilePath: string | null
): Promise<string | null> {
  const files = event.dataTransfer?.files;
  if (!files || files.length === 0) return null;

  const file = files[0];
  if (!file.type.startsWith('image/')) return null;

  const imageName = generateImageName();

  if (isTauri()) {
    const base64 = await blobToBase64(file);
    const { invoke } = await import('@tauri-apps/api/core');

    let dirPath = '';
    if (currentFilePath) {
      const sep = currentFilePath.includes('\\') ? '\\' : '/';
      const parts = currentFilePath.split(sep);
      parts.pop();
      dirPath = parts.join(sep);
    }

    const assetsDir = dirPath ? `${dirPath}/assets` : 'assets';
    try {
      await invoke('create_directory', { path: assetsDir });
    } catch {}

    const imagePath = `${assetsDir}/${imageName}`;
    await invoke('save_image', { path: imagePath, data: base64 });

    return `![image](./assets/${imageName})`;
  } else {
    return await handleBrowserImagePaste(file, imageName);
  }
}
