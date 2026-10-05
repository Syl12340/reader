import { writable } from 'svelte/store';
import { TYPOGRAPHY_PRESETS, type TypographyPreset } from '$lib/styles/typography';

export interface Settings {
  autoSave: boolean;
  autoSaveInterval: number;
  fontSize: number;
  lineHeight: number;
  typographyPreset: TypographyPreset;
  showSingleTab: boolean;
  displayZoom: number;
  contentWidth: number;
  floatingToolbar: 'automatic' | 'manual' | 'off';
  imageDirectory: string;
  exportPaper: 'A4' | 'Letter';
  exportMargin: number;
  exportOutline: boolean;
  exportOrientation: 'portrait' | 'landscape';
  exportPageNumbers: boolean;
  exportBookmarks: boolean;
  exportChapterBreaks: boolean;
  tabSize: number;
  wordWrap: boolean;
  showLineNumbers: boolean;
  bracketMatching: boolean;
  autoCloseBrackets: boolean;
  typewriterMode: boolean;
  typewriterOnlyTyping: boolean;
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
  typographyPreset: 'clean',
  showSingleTab: false,
  displayZoom: 100,
  contentWidth: 800,
  floatingToolbar: 'automatic',
  imageDirectory: 'assets',
  exportPaper: 'A4',
  exportMargin: 20,
  exportOutline: false,
  exportOrientation: 'portrait',
  exportPageNumbers: false,
  exportBookmarks: false,
  exportChapterBreaks: false,
  tabSize: 4,
  wordWrap: true,
  showLineNumbers: true,
  bracketMatching: true,
  autoCloseBrackets: true,
  typewriterMode: false,
  typewriterOnlyTyping: true,
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
    typographyPreset: ['clean', 'serif', 'technical'].includes(String(value.typographyPreset)) ? value.typographyPreset! : 'clean',
    showSingleTab: value.showSingleTab === true,
    displayZoom: finiteNumber(value.displayZoom, 100, 75, 200, true),
    contentWidth: finiteNumber(value.contentWidth, TYPOGRAPHY_PRESETS[value.typographyPreset ?? 'clean']?.width ?? 800, 560, 1200, true),
    floatingToolbar: ['automatic', 'manual', 'off'].includes(String(value.floatingToolbar)) ? value.floatingToolbar! : 'automatic',
    imageDirectory: normalizeImageDirectory(value.imageDirectory),
    exportPaper: value.exportPaper === 'Letter' ? 'Letter' : 'A4',
    exportMargin: finiteNumber(value.exportMargin, 20, 10, 35),
    exportOutline: value.exportOutline === true,
    exportOrientation: value.exportOrientation === 'landscape' ? 'landscape' : 'portrait',
    exportPageNumbers: value.exportPageNumbers === true,
    exportBookmarks: value.exportBookmarks === true,
    exportChapterBreaks: value.exportChapterBreaks === true,
  };
}

export function normalizeImageDirectory(value: unknown): string {
  const path = typeof value === 'string' ? value.trim().replace(/\\/g, '/').replace(/\/$/, '') : '';
  return path && path.split('/').every(part => part && part !== '.' && part !== '..' && !/[<>:"|?*\x00-\x1f]/.test(part))
    ? path : 'assets';
}

function loadSettings(): Settings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    return normalizeSettings({
      autoSave: localStorage.getItem('autoSave') === 'true',
      autoSaveInterval: parseInt(localStorage.getItem('autoSaveInterval') || '30'),
      fontSize: parseInt(localStorage.getItem('fontSize') || '16'),
      lineHeight: parseFloat(localStorage.getItem('lineHeight') || '1.75'),
      typographyPreset: (localStorage.getItem('typographyPreset') || 'clean') as TypographyPreset,
      showSingleTab: localStorage.getItem('showSingleTab') === 'true',
      displayZoom: Number(localStorage.getItem('displayZoom') || '100'),
      contentWidth: localStorage.getItem('contentWidth') ? Number(localStorage.getItem('contentWidth')) : undefined,
      floatingToolbar: (localStorage.getItem('floatingToolbar') || 'automatic') as Settings['floatingToolbar'],
      imageDirectory: localStorage.getItem('imageDirectory') || 'assets',
      exportPaper: localStorage.getItem('exportPaper') === 'Letter' ? 'Letter' : 'A4',
      exportMargin: Number(localStorage.getItem('exportMargin') || '20'),
      exportOutline: localStorage.getItem('exportOutline') === 'true',
      exportOrientation: localStorage.getItem('exportOrientation') === 'landscape' ? 'landscape' : 'portrait',
      exportPageNumbers: localStorage.getItem('exportPageNumbers') === 'true',
      exportBookmarks: localStorage.getItem('exportBookmarks') === 'true',
      exportChapterBreaks: localStorage.getItem('exportChapterBreaks') === 'true',
      tabSize: parseInt(localStorage.getItem('tabSize') || '4'),
      wordWrap: localStorage.getItem('wordWrap') !== 'false',
      showLineNumbers: localStorage.getItem('showLineNumbers') !== 'false',
      bracketMatching: localStorage.getItem('bracketMatching') !== 'false',
      autoCloseBrackets: localStorage.getItem('autoCloseBrackets') !== 'false',
      typewriterMode: localStorage.getItem('typewriterMode') === 'true',
      typewriterOnlyTyping: localStorage.getItem('typewriterOnlyTyping') !== 'false',
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
