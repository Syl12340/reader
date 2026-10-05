import { isTauri } from './platform';
export interface BuildInfo { version: string; builtAt: string; revision: string; dirty: boolean }
declare const __READER_BUILD_INFO__: BuildInfo;
export const buildInfo: BuildInfo = typeof __READER_BUILD_INFO__ !== 'undefined' ? __READER_BUILD_INFO__
  : { version: '开发环境', builtAt: '', revision: 'unknown', dirty: false };
export function buildTimeLabel(): string {
  return buildInfo.builtAt ? new Date(buildInfo.builtAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '开发环境';
}
export async function runtimeDiagnostics(): Promise<{ executable: string; platform: string; nativeVersion?: string }> {
  if (!isTauri()) return { executable: '浏览器模式，无本地可执行文件', platform: navigator.userAgent };
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke('runtime_diagnostics');
}
export function diagnosticText(runtime: { executable: string; platform: string; nativeVersion?: string }): string {
  return [`Reader ${buildInfo.version}`, `构建时间（北京时间）: ${buildTimeLabel()}`, `源码: ${buildInfo.revision}${buildInfo.dirty ? ' + 未提交修改' : ''}`,
    `运行环境: ${runtime.platform}`, `原生版本: ${runtime.nativeVersion ?? '不适用'}`, `程序路径: ${runtime.executable}`].join('\n');
}
