import { isTauri as isTauriRuntime } from '@tauri-apps/api/core';

/**
 * 平台检测工具
 * 用于检测当前运行环境：Tauri、Electron 或浏览器
 */

// Tauri 环境检测
export const isTauri = (): boolean => {
  if (typeof window === 'undefined') return false;

  try {
    if (isTauriRuntime()) return true;
  } catch {
    // Keep browser/test environments quiet if the runtime shim is unavailable.
  }

  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
};

// Electron 环境检测
export const isElectron = (): boolean => {
  return typeof window !== 'undefined' && '__ELECTRON__' in window;
};

// 纯浏览器环境
export const isBrowser = (): boolean => {
  return !isTauri() && !isElectron();
};

// 检测是否支持 File System Access API
export const isFileSystemAccessSupported = (): boolean => {
  return !isTauri() && typeof window !== 'undefined' && 'showOpenFilePicker' in window;
};

// 获取当前平台类型
export type Platform = 'tauri' | 'electron' | 'browser';

export const getPlatform = (): Platform => {
  if (isTauri()) return 'tauri';
  if (isElectron()) return 'electron';
  return 'browser';
};

// 获取平台信息
export const getPlatformInfo = () => {
  const platform = getPlatform();
  return {
    platform,
    isTauri: platform === 'tauri',
    isElectron: platform === 'electron',
    isBrowser: platform === 'browser',
    supportsFileSystemAccess: isFileSystemAccessSupported(),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
  };
};
