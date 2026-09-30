/**
 * 主题预设注册中心
 * 管理所有排版主题的加载与切换
 */

export type ThemePreset = 'default' | 'github' | 'newsprint' | 'night' | 'typora';

export interface ThemePresetInfo {
  id: ThemePreset;
  name: string;
  description: string;
}

export const THEME_PRESETS: ThemePresetInfo[] = [
  { id: 'typora',    name: 'Typora', description: '极简无边框设计，干净克制' },
  { id: 'default',   name: '经典',   description: '兼容原有 Reader 排版' },
  { id: 'github',    name: 'GitHub', description: '经典 GitHub 渲染风格，无衬线字体' },
  { id: 'newsprint', name: '报刊',   description: '报纸印刷风格，高级衬线字体' },
  { id: 'night',     name: '夜间',   description: '深邃暗色，高对比度' },
];

let currentPreset: ThemePreset = 'typora';

/**
 * 应用主题预设
 * 通过设置 data-theme-preset 属性和动态加载 CSS 实现
 */
export function applyThemePreset(preset: ThemePreset) {
  currentPreset = preset;
  document.documentElement.setAttribute('data-theme-preset', preset);
  localStorage.setItem('themePreset', preset);
}

/**
 * 获取当前主题预设
 */
export function getCurrentPreset(): ThemePreset {
  return currentPreset;
}

/**
 * 初始化主题预设（从 localStorage 恢复）
 */
export function initThemePreset(): ThemePreset {
  const saved = localStorage.getItem('themePreset') as ThemePreset | null;
  const preset = saved && THEME_PRESETS.some(p => p.id === saved) ? saved : 'typora';
  applyThemePreset(preset);
  return preset;
}
