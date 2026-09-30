/**
 * Frontmatter (YAML 元数据) 解析工具
 * 提取 Markdown 文档顶部 --- 包裹的 YAML 数据
 */

import { parse } from 'yaml';

export interface FrontmatterResult {
  metadata: Record<string, any> | null;
  body: string;
}

/**
 * 解析 frontmatter
 * @param content 原始 Markdown 内容
 * @returns { metadata, body } — metadata 为解析后的对象，body 为去除 frontmatter 后的正文
 */
export function parseFrontmatter(content: string): FrontmatterResult {
  if (!content) return { metadata: null, body: content };

  // 匹配开头的 --- 块
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) return { metadata: null, body: content };

  const yamlStr = match[1];
  const body = content.substring(match[0].length);

  try {
    const metadata = parse(yamlStr);
    if (typeof metadata !== 'object' || metadata === null) {
      return { metadata: null, body: content };
    }
    return { metadata, body };
  } catch (err) {
    console.warn('Frontmatter YAML parse error:', err);
    return { metadata: null, body: content };
  }
}

/**
 * 将 frontmatter metadata 渲染为 HTML 信息卡片
 */
export function renderFrontmatterCard(metadata: Record<string, any>): string {
  if (!metadata || typeof metadata !== 'object') return '';

  const entries = Object.entries(metadata).filter(([_, v]) => v !== undefined && v !== null);
  if (entries.length === 0) return '';

  const rows = entries.map(([key, value]) => {
    const displayValue = Array.isArray(value)
      ? value.map(v => `<span class="fm-tag">${escapeHtml(String(v))}</span>`).join(' ')
      : escapeHtml(String(value));

    return `<div class="fm-row">
      <span class="fm-key">${escapeHtml(formatKey(key))}</span>
      <span class="fm-value">${displayValue}</span>
    </div>`;
  }).join('');

  return `<div class="frontmatter-card">${rows}</div>`;
}

function formatKey(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]/g, ' ')
    .replace(/^\w/, c => c.toUpperCase())
    .trim();
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
