import { normalizeSettings, type Settings } from '../stores/settings';
import type { ExportTypography } from './export-html';

export interface ExportSource {
  sessionId: string;
  baseName: string;
  markdown: string;
  filePath: string | null;
  theme: 'light' | 'dark';
}

export const EXPORT_OPTION_KEYS = [
  'exportPaper', 'exportMargin', 'exportOrientation', 'exportOutline', 'exportPageNumbers',
  'exportBookmarks', 'exportChapterBreaks', 'exportIncludeCss',
] as const;

export function exportOptions(settings: Settings): Partial<Settings> {
  return Object.fromEntries(EXPORT_OPTION_KEYS.map(key => [key, settings[key]]));
}

export function exportTypography(settings: Settings): ExportTypography {
  return {
    typographyPreset: settings.typographyPreset, fontSize: settings.fontSize, lineHeight: settings.lineHeight,
    fontFamily: settings.customFontContent, paper: settings.exportPaper, margin: settings.exportMargin,
    orientation: settings.exportOrientation, outline: settings.exportOutline,
    pageNumbers: settings.exportPageNumbers, chapterBreaks: settings.exportChapterBreaks,
  };
}

export function exportPreset(settings: Settings, report: boolean): Settings {
  return normalizeSettings({ ...settings, exportPaper: 'A4', exportOrientation: 'portrait',
    exportMargin: report ? 20 : 15, exportOutline: report, exportPageNumbers: report,
    exportChapterBreaks: report, exportBookmarks: false });
}
