import { parseFrontmatter, renderFrontmatterCard } from '../utils/frontmatter';
import { prepareLatex, restoreLatex } from '../utils/latex';
import { renderMarkdown, renderInlineMarkdown } from '../utils/markdown';

export class RenderService {
  /**
   * 统一渲染服务，输入 Markdown 内容与配置，输出 HTML 结果
   */
  static render(content: string, config: { filePath?: string | null } = {}): string {
    if (!content) return '';

    // 阶段 0：提取 Frontmatter
    const { metadata, body } = parseFrontmatter(content);
    const cardHtml = metadata ? renderFrontmatterCard(metadata) : '';

    // 阶段 1：保护 LaTeX（防止 markdown-it 误杀 _ ^ * 等）
    const { cleaned, map } = prepareLatex(body);

    // 阶段 2：markdown-it 渲染为 HTML (默认带有 data-line 行号属性)
    const lineOffset = content.slice(0, content.length - body.length).split('\n').length - 1;
    const html = renderMarkdown(cleaned, config.filePath ?? null, content, lineOffset);

    // 阶段 3：还原 LaTeX 占位符为 KaTeX HTML
    const finalHtml = restoreLatex(html, map);

    // 合并并返回
    return cardHtml ? cardHtml + finalHtml : finalHtml;
  }
  static inline(content: string, filePath: string | null = null): string {
    const { cleaned, map } = prepareLatex(content);
    return restoreLatex(renderInlineMarkdown(cleaned, filePath), map);
  }
}
