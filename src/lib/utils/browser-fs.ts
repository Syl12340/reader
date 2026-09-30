// 浏览器文件系统工具
// 使用 File System Access API (现代浏览器支持)



export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  handle?: FileSystemHandle;
  children?: FileEntry[];
  isExpanded?: boolean;
}

// 检查是否支持 File System Access API
export function isFileSystemAccessSupported(): boolean {
  return 'showOpenFilePicker' in window && 'showDirectoryPicker' in window;
}

// 打开文件
export async function openFile(): Promise<{ name: string; content: string; handle: FileSystemFileHandle | null } | null> {
  try {
    if (!isFileSystemAccessSupported()) {
      // 降级方案：使用 input[type=file]
      return await openFileFallback();
    }

    const [handle] = await (window as any).showOpenFilePicker({
      types: [
        {
          description: 'Markdown Files',
          accept: {
            'text/markdown': ['.md', '.markdown'],
            'text/plain': ['.txt'],
          },
        },
        {
          description: 'All Files',
          accept: {
            'text/*': ['.md', '.markdown', '.txt', '.json', '.yaml', '.yml', '.toml', '.xml', '.html', '.css', '.js', '.ts'],
          },
        },
      ],
      multiple: false,
    });

    const file = await handle.getFile();
    const content = await file.text();

    return {
      name: file.name,
      content,
      handle,
    };
  } catch (error: any) {
    if (error.name === 'AbortError') {
      // 用户取消
      return null;
    }
    console.error('Failed to open file:', error);
    throw error;
  }
}

// 降级方案：使用 input[type=file]
async function openFileFallback(): Promise<{ name: string; content: string; handle: null } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.markdown,.txt,.json,.yaml,.yml,.toml,.xml,.html,.css,.js,.ts';

    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }

      const content = await file.text();
      resolve({
        name: file.name,
        content,
        handle: null,
      });
    };

    input.oncancel = () => {
      resolve(null);
    };

    input.click();
  });
}

// 打开文件夹
export async function openDirectory(): Promise<FileSystemDirectoryHandle | null> {
  try {
    if (!isFileSystemAccessSupported()) {
      console.warn('File System Access API not supported');
      alert('您的浏览器不支持打开文件夹功能。请使用 Chrome/Edge 86+ 浏览器。');
      return null;
    }

    const handle = await (window as any).showDirectoryPicker({
      mode: 'readwrite',
    });

    return handle;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      // 用户取消
      return null;
    }
    console.error('Failed to open directory:', error);
    throw error;
  }
}

// 读取目录内容
export async function readDirectory(dirHandle: FileSystemDirectoryHandle): Promise<FileEntry[]> {
  const entries: FileEntry[] = [];

  for await (const [name, handle] of (dirHandle as any).entries()) {
    // 跳过隐藏文件
    if (name.startsWith('.')) {
      continue;
    }

    entries.push({
      name,
      path: name, // 相对路径
      isDirectory: handle.kind === 'directory',
      handle,
    });
  }

  // 排序：文件夹在前，文件在后
  entries.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  });

  return entries;
}

// 读取文件内容
export async function readFile(fileHandle: FileSystemFileHandle): Promise<string> {
  const file = await fileHandle.getFile();
  return await file.text();
}

// 写入文件内容
export async function writeFile(fileHandle: FileSystemFileHandle, content: string): Promise<void> {
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

// 创建文件
export async function createFile(
  dirHandle: FileSystemDirectoryHandle,
  name: string,
  content: string = ''
): Promise<FileSystemFileHandle> {
  const fileHandle = await dirHandle.getFileHandle(name, { create: true });
  await writeFile(fileHandle, content);
  return fileHandle;
}

// 创建文件夹
export async function createDirectory(
  dirHandle: FileSystemDirectoryHandle,
  name: string
): Promise<FileSystemDirectoryHandle> {
  return await dirHandle.getDirectoryHandle(name, { create: true });
}

// 删除文件
export async function deleteFile(
  dirHandle: FileSystemDirectoryHandle,
  name: string
): Promise<void> {
  await dirHandle.removeEntry(name);
}

// 删除文件夹
export async function deleteDirectory(
  dirHandle: FileSystemDirectoryHandle,
  name: string
): Promise<void> {
  await dirHandle.removeEntry(name, { recursive: true });
}

// 重命名文件
// File System Access API 不支持直接重命名
// 安全顺序：先创建新文件 → 验证成功 → 再删除旧文件
// 这样即使中途失败，旧文件仍然保留（最坏情况是产生重复文件，不会丢数据）
export async function renameFile(
  dirHandle: FileSystemDirectoryHandle,
  oldName: string,
  newName: string
): Promise<void> {
  const oldHandle = await dirHandle.getFileHandle(oldName);
  const content = await readFile(oldHandle);

  // 先创建新文件并验证
  const newHandle = await createFile(dirHandle, newName, content);
  if (!newHandle) {
    throw new Error(`Failed to create new file: ${newName}`);
  }

  // 验证新文件可读
  try {
    await readFile(newHandle);
  } catch (e) {
    // 新文件写入不完整，清理并抛错
    await deleteFile(dirHandle, newName);
    throw new Error(`Failed to verify new file: ${newName}`);
  }

  // 验证通过，删除旧文件
  await deleteFile(dirHandle, oldName);
}

// 递归读取目录树
export async function readDirectoryTree(
  dirHandle: FileSystemDirectoryHandle,
  maxDepth: number = 3,
  currentDepth: number = 0,
  basePath: string = ''
): Promise<FileEntry[]> {
  if (currentDepth >= maxDepth) {
    return [];
  }

  const entries: FileEntry[] = [];

  for await (const [name, handle] of (dirHandle as any).entries()) {
    // 跳过隐藏文件和 node_modules
    if (name.startsWith('.') || name === 'node_modules') {
      continue;
    }

    const entryPath = basePath ? `${basePath}/${name}` : name;
    const entry: FileEntry = {
      name,
      path: entryPath,
      isDirectory: handle.kind === 'directory',
      handle,
      isExpanded: false,
    };

    if (handle.kind === 'directory' && currentDepth < maxDepth - 1) {
      entry.children = await readDirectoryTree(
        handle as FileSystemDirectoryHandle,
        maxDepth,
        currentDepth + 1,
        entryPath
      );
    }

    entries.push(entry);
  }

  // 排序
  entries.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  });

  return entries;
}

export { getFileExtension, getFileIcon } from './file-utils';

// 下载文件
export function downloadFile(filename: string, content: string, mimeType: string = 'text/plain') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// 导出为 Markdown
export function exportAsMarkdown(filename: string, content: string) {
  downloadFile(filename, content, 'text/markdown');
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeHTML(html: string): string {
  // 移除所有 script 标签及内容
  let cleaned = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  // 移除所有 on* 事件属性，例如 onclick, onload 等
  cleaned = cleaned.replace(/\s+on\w+\s*=\s*(["']).*?\1/gi, '');
  cleaned = cleaned.replace(/\s+on\w+\s*=\s*[^>\s]+/gi, '');
  // 移除 javascript: 伪协议链接
  cleaned = cleaned.replace(/href\s*=\s*(["'])javascript:.*?\1/gi, '');
  cleaned = cleaned.replace(/href\s*=\s*javascript:[^>\s]+/gi, '');
  return cleaned;
}

// 导出为 HTML
export function exportAsHTML(filename: string, htmlContent: string) {
  const escapedFilename = escapeHtml(filename);
  const sanitizedContent = sanitizeHTML(htmlContent);
  const hasHtml = /<html[\s>]/i.test(sanitizedContent) || /<!doctype html>/i.test(sanitizedContent);
  const safeName = /\.html?$/i.test(filename)
    ? filename
    : filename.replace(/\.[^/.]+$/, '') + '.html';

  if (hasHtml) {
    downloadFile(safeName, sanitizedContent, 'text/html');
    return;
  }

  const fullHTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapedFilename}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 20px;
      line-height: 1.6;
    }
    pre {
      background: #f5f5f5;
      padding: 16px;
      border-radius: 4px;
      overflow-x: auto;
    }
    code {
      background: #f5f5f5;
      padding: 2px 4px;
      border-radius: 3px;
    }
    blockquote {
      border-left: 4px solid #3b82f6;
      padding-left: 16px;
      margin-left: 0;
      color: #666;
    }
    img {
      max-width: 100%;
    }
    table {
      border-collapse: collapse;
      width: 100%;
    }
    th, td {
      border: 1px solid #ddd;
      padding: 8px;
      text-align: left;
    }
    th {
      background: #f5f5f5;
    }
  </style>
</head>
<body>
${sanitizedContent}
</body>
</html>`;

  downloadFile(safeName, fullHTML, 'text/html');
}

// 打印预览
export function printContent(htmlContent: string) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('请允许弹出窗口以打印内容');
    return;
  }

  const sanitizedContent = sanitizeHTML(htmlContent);

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Print Preview</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          max-width: 800px;
          margin: 0 auto;
          padding: 20px;
          line-height: 1.6;
        }
        pre {
          background: #f5f5f5;
          padding: 16px;
          border-radius: 4px;
        }
        code {
          background: #f5f5f5;
          padding: 2px 4px;
          border-radius: 3px;
        }
        blockquote {
          border-left: 4px solid #3b82f6;
          padding-left: 16px;
          margin-left: 0;
        }
        img { max-width: 100%; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ddd; padding: 8px; }
        th { background: #f5f5f5; }
        @media print {
          body { padding: 0; }
        }
      </style>
    </head>
    <body>
      ${sanitizedContent}
      <script>
        window.onload = function() {
          window.print();
          window.onafterprint = function() { window.close(); };
        };
      </script>
    </body>
    </html>
  `);
  printWindow.document.close();
}
