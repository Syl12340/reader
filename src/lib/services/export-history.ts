import { normalizeSettings, type Settings } from '../stores/settings';
import { exportOptions, type ExportSource } from '../utils/export-options';
import { normalizePathKey } from '../utils/path';

export type ExportFormat = 'html' | 'pdf' | 'docx' | 'epub' | 'latex' | 'png' | 'jpg' | 'gfm' | 'commonmark' | 'github' | 'print';
const formats: ExportFormat[] = ['html', 'pdf', 'docx', 'epub', 'latex', 'png', 'jpg', 'gfm', 'commonmark', 'github'];
const key = 'reader-export-history-v1';
const typographyKeys = ['typographyPreset', 'fontSize', 'lineHeight', 'customFontContent'] as const;
type RecordEntry = { format: ExportFormat; preferences: Partial<Settings> };
function preferencesOnly(value: Settings): Partial<Settings> {
  return { ...exportOptions(value), ...Object.fromEntries(typographyKeys.map(key => [key, value[key]])),
    customFontContent: typeof value.customFontContent === 'string' ? value.customFontContent.slice(0, 4096) : '' };
}
function storage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}

export class ExportHistory {
  private entries = new Map<string, RecordEntry>();
  private transient = new Map<string, RecordEntry>();
  constructor(private readonly persistence = storage()) {
    try {
      const raw = persistence?.getItem(key);
      if (!raw || raw.length > 180_000) return;
      const records: unknown = JSON.parse(raw);
      if (!Array.isArray(records)) return;
      for (const entry of records.slice(-50)) {
        if (!entry || typeof entry.path !== 'string' || entry.path.length > 4096 || !entry.path || !formats.includes(entry.format)
          || !entry.preferences || typeof entry.preferences !== 'object' || Array.isArray(entry.preferences)) continue;
        this.entries.set(normalizePathKey(entry.path), { format: entry.format, preferences: preferencesOnly(normalizeSettings(entry.preferences)) });
      }
    } catch { /* Ignore corrupt or unavailable preference storage. */ }
  }
  get(source: ExportSource | null, defaults: Settings): { format: ExportFormat; preferences: Settings } | undefined {
    if (!source) return;
    const entry = source.filePath ? this.entries.get(normalizePathKey(source.filePath)) : this.transient.get(source.sessionId);
    return entry ? { format: entry.format, preferences: normalizeSettings({ ...defaults, ...entry.preferences }) } : undefined;
  }
  record(source: ExportSource, format: ExportFormat, preferences: Settings): void {
    if (!formats.includes(format)) return;
    const entries = source.filePath ? this.entries : this.transient;
    const id = source.filePath ? normalizePathKey(source.filePath) : source.sessionId;
    entries.delete(id); entries.set(id, { format, preferences: preferencesOnly(normalizeSettings(preferences)) });
    while (entries.size > 50) entries.delete(entries.keys().next().value!);
    if (source.filePath) {
      try {
        const encode = () => JSON.stringify([...this.entries].map(([path, value]) => ({ path, ...value })));
        let value = encode();
        while (value.length > 180_000 && this.entries.size > 1) {
          this.entries.delete(this.entries.keys().next().value!); value = encode();
        }
        this.persistence?.setItem(key, value);
      }
      catch (error) { console.warn('Could not persist export preferences:', error); }
    }
  }
}
