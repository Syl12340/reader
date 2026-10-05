<script lang="ts">
  import { derived } from 'svelte/store';
  import { currentFile, fileExtension, isDirty, isEditing } from '$lib/stores/document';
  import { cursorPosition } from '$lib/stores/editor-ui';
  import { sessions, activeSession, documentStatistics as stats } from '$lib/stores/document';
  import { editorMode } from '$lib/stores/ui';
  import { DocumentService } from '$lib/services/document';
  import { getSaveStatus } from '$lib/utils/save-status';
  import { recoveryStorageError } from '$lib/services/recovery';
  import { CommandService } from '$lib/services/command';
  import { selectDocumentMode } from '$lib/services/editor-presentation';
  import { settings } from '$lib/stores/settings';
  let details = $state(false);

  const saveStatus = derived(activeSession, getSaveStatus);
  const modes = [
    { id: 'wysiwym', label: '写作', title: '写作：就地编辑 Markdown' },
    { id: 'source', label: '源码', title: '源码：显示完整 Markdown 标记' },
    { id: 'preview', label: '阅读', title: '阅读：只读排版' },
  ] as const;
  function modeKeydown(event: KeyboardEvent): void {
    if (event.isComposing || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey
      || !(event.currentTarget instanceof HTMLElement) || !(event.target instanceof HTMLButtonElement)) return;
    const group = event.currentTarget.closest('.status-mode-switcher');
    if (!group) return;
    const controls = [...group.querySelectorAll<HTMLButtonElement>('button')];
    const current = controls.indexOf(event.target);
    const next = event.key === 'ArrowRight' ? (current + 1) % modes.length
      : event.key === 'ArrowLeft' ? (current + modes.length - 1) % modes.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? modes.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    void selectDocumentMode(modes[next].id, false);
    controls[next]?.focus({ preventScroll: true });
  }

</script>

<div class="status-bar" aria-label="文档状态">
  <div class="status-bar-left">
    {#if $recoveryStorageError}
      <button type="button" class="status-bar-item external-change" title={$recoveryStorageError}
        onclick={() => { void CommandService.execute('recoveryCenter'); }}>恢复存储异常</button>
    {/if}
    {#if $currentFile || $isEditing}
      <span class="status-bar-item save-state" class:dirty={$isDirty || $activeSession?.saveState === 'error'} role="status" title={$saveStatus.detail}>
        <span class="dirty-dot" aria-hidden="true"></span>
        {$saveStatus.label}
      </span>

      {#if details && $editorMode !== 'preview'}<span class="status-bar-item line-state">
        行 {$cursorPosition.line}，列 {$cursorPosition.column}
      </span>{/if}

      {#if $activeSession?.externalModified}
        <button
          type="button"
          class="status-bar-item external-change"
          title={$activeSession.externalReadError || '查看磁盘与当前文档的差异'}
          onclick={() => $activeSession && void DocumentService.reviewExternalChange($activeSession.id)}
        >
          {$activeSession.externalReadError ? '读取失败' : $activeSession.externalMissing ? '磁盘文件缺失' : '外部修改'} · 审阅
        </button>
      {/if}
    {/if}
  </div>

  <div class="status-bar-right">
    {#if $currentFile || $isEditing}
      <button type="button" class="status-details" aria-expanded={details} title="展开或收起文档统计" onclick={() => details = !details}>{$stats.words} 字/词</button>
      {#if details}<span class="status-bar-item" title={`${$stats.chars} 个源码字符，${$stats.lines} 行 · ${$fileExtension?.toUpperCase() || 'MD'} · UTF-8`}>约 {$stats.readMin} 分钟 · UTF-8</span>{/if}
      {#if $settings.displayZoom !== 100}<button type="button" class="status-details" title="恢复 100% 显示" onclick={() => void CommandService.execute('zoomReset')}>{$settings.displayZoom}%</button>{/if}
    {/if}
    {#if $sessions.length > 0}
      <div class="status-mode-switcher" role="group" aria-label="文档视图">
        {#each modes as mode (mode.id)}
          <button
            type="button"
            class:active={$editorMode === mode.id}
            aria-pressed={$editorMode === mode.id}
            aria-label={mode.label}
            tabindex={$editorMode === mode.id ? 0 : -1}
            onkeydown={modeKeydown}
            onclick={() => { void CommandService.execute(mode.id === 'wysiwym' ? 'modeWrite' : mode.id === 'source' ? 'modeSource' : 'modeRead'); }}
            title={mode.title}
          >
            {mode.label}
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .status-details { border: 0; background: transparent; color: var(--ui-text-muted); font-size: 12px; cursor: pointer; padding: 3px 5px; border-radius: 3px; }
  .status-details:hover { background: var(--ui-panel-hover); }
  .status-details:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 1px; }
  .status-bar-left,
  .status-bar-right {
    min-width: 0;
  }

  .save-state {
    color: var(--ui-text-muted);
  }

  .save-state.dirty {
    color: var(--ui-accent);
  }

  .external-change {
    color: var(--ui-accent);
    font-weight: 500;
    border: 0;
    background: transparent;
    cursor: pointer;
    border-radius: 3px;
    padding: 2px 4px;
  }
  .external-change:hover { background: var(--ui-panel-hover); }
  .external-change:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 1px; }

  .dirty-dot {
    display: inline-block;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: currentColor;
    opacity: 0.7;
  }

  .line-state {
    opacity: 0.72;
  }

  .status-mode-switcher {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: 2px;
    padding-left: 2px;
    opacity: 1;
  }

  .status-mode-switcher button {
    min-width: 44px;
    height: 24px;
    padding: 0 6px;
    border: 0;
    background: transparent;
    color: var(--ui-text-muted);
    font-size: 12px;
    line-height: 1;
    cursor: pointer;
  }

  .status-mode-switcher button:hover {
    color: var(--ui-text);
  }

  .status-mode-switcher button.active {
    color: var(--ui-text);
    background: var(--ui-panel-hover);
    border-radius: 3px;
    font-weight: 500;
  }

  .status-mode-switcher button:focus-visible {
    outline: 2px solid var(--ui-accent);
    outline-offset: 2px;
  }
</style>
