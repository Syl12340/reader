export const TYPOGRAPHY_PRESETS = {
  clean: { label: '清爽写作', font: '"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif', size: 16, lineHeight: 1.75, width: 800, h1: 2, h2: 1.5, paragraphGap: 0.95 },
  serif: { label: '衬线阅读', font: 'Georgia, "Songti SC", SimSun, serif', size: 18, lineHeight: 1.85, width: 740, h1: 2, h2: 1.45, paragraphGap: 1.1 },
  technical: { label: '技术文档', font: '"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif', size: 16, lineHeight: 1.65, width: 900, h1: 1.8, h2: 1.35, paragraphGap: 0.85 },
} as const;
export type TypographyPreset = keyof typeof TYPOGRAPHY_PRESETS;
