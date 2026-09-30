<script lang="ts">
  import { currentFile, fileContent } from '$lib/stores/document';
  import { cursorPosition } from '$lib/stores/editor-ui';
  import { currentDirectory } from '$lib/stores/file';

  // 从文件路径提取目录名和文件名
  let dirName = $derived.by(() => {
    const dir = $currentDirectory;
    if (dir) return dir.split(/[/\\]/).pop() || dir;
    const file = $currentFile;
    if (file) {
      const parts = file.split(/[/\\]/);
      parts.pop();
      return parts.pop() || '';
    }
    return '';
  });

  let fileName = $derived.by(() => {
    const file = $currentFile;
    if (!file) return '';
    return file.split(/[/\\]/).pop() || file;
  });

  // 根据光标位置计算当前所在的标题
  let currentHeading = $derived.by(() => {
    const content = $fileContent;
    const line = $cursorPosition.line;
    if (!content || !line) return '';

    const lines = content.split('\n');
    let inCodeBlock = false;

    // 从当前行向上查找最近的标题
    for (let i = Math.min(line - 1, lines.length - 1); i >= 0; i--) {
      const l = lines[i];
      if (l.match(/^```/)) {
        inCodeBlock = !inCodeBlock;
        continue;
      }
      if (!inCodeBlock) {
        const match = l.match(/^(#{1,6})\s+(.+)$/);
        if (match) {
          return match[2].trim();
        }
      }
    }
    return '';
  });

  function jumpToHeading() {
    if (!currentHeading) return;
    const content = $fileContent;
    if (!content) return;

    const lines = content.split('\n');
    let inCodeBlock = false;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].match(/^```/)) {
        inCodeBlock = !inCodeBlock;
        continue;
      }
      if (!inCodeBlock) {
        const match = lines[i].match(/^#{1,6}\s+(.+)$/);
        if (match && match[1].trim() === currentHeading) {
          window.dispatchEvent(new CustomEvent('heading-click', { detail: { line: i + 1 } }));
          return;
        }
      }
    }
  }
</script>

{#if $currentFile}
  <div class="breadcrumb">
    {#if dirName}
      <span class="breadcrumb-item breadcrumb-dir">{dirName}</span>
      <span class="breadcrumb-sep">›</span>
    {/if}
    <span class="breadcrumb-item breadcrumb-file">{fileName}</span>
    {#if currentHeading}
      <span class="breadcrumb-sep">›</span>
      <button class="breadcrumb-item breadcrumb-heading" onclick={jumpToHeading} title="跳转到标题">
        {currentHeading}
      </button>
    {/if}
  </div>
{/if}

<style>
  .breadcrumb {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px max(28px, calc((100% - var(--doc-content-width, 760px)) / 2)) 0;
    background: transparent;
    border-bottom: 0;
    font-size: 11px;
    color: var(--text-tertiary);
    overflow: hidden;
    white-space: nowrap;
    min-height: 24px;
    opacity: 0.62;
  }

  .breadcrumb:hover,
  .breadcrumb:focus-within {
    opacity: 1;
  }

  .breadcrumb-item {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .breadcrumb-sep {
    color: var(--text-tertiary);
    opacity: 0.5;
    flex-shrink: 0;
  }

  .breadcrumb-dir {
    max-width: 120px;
  }

  .breadcrumb-file {
    font-weight: 400;
    color: var(--text-secondary);
    max-width: 150px;
  }

  .breadcrumb-heading {
    background: none;
    border: none;
    padding: 0;
    color: var(--text-tertiary);
    cursor: pointer;
    font-size: 12px;
    font-family: inherit;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .breadcrumb-heading:hover {
    color: var(--accent-color);
    text-decoration: underline;
  }
</style>
