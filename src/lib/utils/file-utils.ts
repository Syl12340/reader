import { getFileIcon as getIcon } from './icons';

/**
 * 获取文件扩展名
 */
export const getFileExtension = (filename: string): string => {
  const lastDot = filename.lastIndexOf('.');
  return lastDot > 0 ? filename.substring(lastDot + 1).toLowerCase() : '';
};

/**
 * 获取文件图标
 */
export const getFileIcon = (filename: string, isDirectory: boolean, isExpanded?: boolean): string => {
  if (isDirectory) {
    return isExpanded ? '📂' : '📁';
  }
  const ext = getFileExtension(filename);
  return getIcon(ext, false);
};
