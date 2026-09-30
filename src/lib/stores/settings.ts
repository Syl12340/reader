import { writable } from 'svelte/store';

export interface Settings {
  autoSave: boolean;
  autoSaveInterval: number;
  fontSize: number;
  lineHeight: number;
  tabSize: number;
  wordWrap: boolean;
  showLineNumbers: boolean;
  bracketMatching: boolean;
  autoCloseBrackets: boolean;
  typewriterMode: boolean;
  focusMode: boolean;
  customAccentColor: string;
  customBgPrimary: string;
  customBgSecondary: string;
  customTextPrimary: string;
  customFontContent: string;
  exportDefaultFormat: string;
  exportIncludeCss: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  autoSave: false,
  autoSaveInterval: 30,
  fontSize: 16,
  lineHeight: 1.75,
  tabSize: 4,
  wordWrap: true,
  showLineNumbers: true,
  bracketMatching: true,
  autoCloseBrackets: true,
  typewriterMode: false,
  focusMode: false,
  customAccentColor: '#3a6ff7',
  customBgPrimary: '',
  customBgSecondary: '',
  customTextPrimary: '',
  customFontContent: '',
  exportDefaultFormat: 'html',
  exportIncludeCss: true,
};

function finiteNumber(value: unknown, fallback: number, min: number, max: number, integer = false): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  const clamped = Math.min(max, Math.max(min, number));
  return integer ? Math.round(clamped) : clamped;
}

export function normalizeSettings(value: Partial<Settings>): Settings {
  const format = ['html', 'pdf', 'docx', 'epub'].includes(String(value.exportDefaultFormat))
    ? String(value.exportDefaultFormat) : DEFAULT_SETTINGS.exportDefaultFormat;
  return {
    ...DEFAULT_SETTINGS,
    ...value,
    autoSaveInterval: finiteNumber(value.autoSaveInterval, DEFAULT_SETTINGS.autoSaveInterval, 5, 3600, true),
    fontSize: finiteNumber(value.fontSize, DEFAULT_SETTINGS.fontSize, 10, 40),
    lineHeight: finiteNumber(value.lineHeight, DEFAULT_SETTINGS.lineHeight, 1.2, 3),
    tabSize: finiteNumber(value.tabSize, DEFAULT_SETTINGS.tabSize, 1, 16, true),
    exportDefaultFormat: format,
  };
}

function loadSettings(): Settings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    return normalizeSettings({
      autoSave: localStorage.getItem('autoSave') === 'true',
      autoSaveInterval: parseInt(localStorage.getItem('autoSaveInterval') || '30'),
      fontSize: parseInt(localStorage.getItem('fontSize') || '16'),
      lineHeight: parseFloat(localStorage.getItem('lineHeight') || '1.75'),
      tabSize: parseInt(localStorage.getItem('tabSize') || '4'),
      wordWrap: localStorage.getItem('wordWrap') !== 'false',
      showLineNumbers: localStorage.getItem('showLineNumbers') !== 'false',
      bracketMatching: localStorage.getItem('bracketMatching') !== 'false',
      autoCloseBrackets: localStorage.getItem('autoCloseBrackets') !== 'false',
      typewriterMode: localStorage.getItem('typewriterMode') === 'true',
      focusMode: localStorage.getItem('focusMode') === 'true',
      customAccentColor: localStorage.getItem('customAccentColor') || '#3a6ff7',
      customBgPrimary: localStorage.getItem('customBgPrimary') || '',
      customBgSecondary: localStorage.getItem('customBgSecondary') || '',
      customTextPrimary: localStorage.getItem('customTextPrimary') || '',
      customFontContent: localStorage.getItem('customFontContent') || '',
      exportDefaultFormat: localStorage.getItem('exportDefaultFormat') || 'html',
      exportIncludeCss: localStorage.getItem('exportIncludeCss') !== 'false',
    });
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export const settings = writable<Settings>(loadSettings());

export function updateSettings(updates: Partial<Settings>) {
  settings.update(curr => {
    const next = normalizeSettings({ ...curr, ...updates });
    if (typeof window !== 'undefined') {
      try {
        Object.entries(next).forEach(([key, val]) => {
          localStorage.setItem(key, String(val));
        });
      } catch (e) {
        console.error('Failed to save settings to localStorage:', e);
      }
    }
    return next;
  });
}
