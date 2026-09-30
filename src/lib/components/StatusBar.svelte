<script lang="ts">
  import { derived } from 'svelte/store';
  import { currentFile, fileExtension, isDirty, isEditing } from '$lib/stores/document';
  import { cursorPosition } from '$lib/stores/editor-ui';
  import { sessions, activeSessionId, activeSession } from '$lib/stores/document';
  import { editorMode, setEditorMode } from '$lib/stores/ui';
  import { DocumentService } from '$lib/services/document';
  import { getSaveStatus } from '$lib/utils/save-status';
  import { recoveryStorageError } from '$lib/services/recovery';
  import { CommandService } from '$lib/services/command';

  const saveStatus = derived(activeSession, getSaveStatus);

  const activeContent = derived([sessions, activeSessionId], ([list, id]) =>
    list.find(session => session.id === id)?.content ?? '',
  );

  const stats = derived(activeContent, content => {
    if (!content) return { words: 0, chars: 0, readMin: 0 };
    const chars = content.length;
    const stripped = content
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`[^`]+`/g, '')
      .replace(/!\[.*?\]\(.*?\)/g, '')
      .replace(/\[.*?\]\(.*?\)/g, '')
      .replace(/#{1,6}\s/g, '')
      .replace(/[*_~>]/g, '');
    const english = (stripped.match(/[a-zA-Z]+/g) || []).length;
    const chinese = (stripped.match(/[\u4e00-\u9fa5]/g) || []).length;
    const words = english + chinese;
    return { words, chars, readMin: Math.max(1, Math.round(words / 250)) };
  });

</script>

<div class="status-bar" aria-label="Document status">
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

      <span class="status-bar-item line-state">
        Line {$cursorPosition.line}, Col {$cursorPosition.column}
      </span>

      {#if $activeSession?.externalModified}
        <button
          type="button"
          class="status-bar-item external-change"
          title={$activeSession.externalReadError || 'The source file changed outside Reader'}
          onclick={() => $activeSession && void DocumentService.reloadSessionFromDisk($activeSession.id)}
        >
          {$activeSession.externalReadError ? 'Read failed' : $activeSession.externalMissing ? 'Missing on disk' : 'Changed on disk'} · Reload
        </button>
      {/if}
    {/if}
  </div>

  <div class="status-bar-right">
    {#if $currentFile || $isEditing}
      <span class="status-bar-item">{$stats.words} words</span>
      <span class="status-bar-item">~{$stats.readMin} min</span>
      <span class="status-bar-item">{$fileExtension?.toUpperCase() || 'MD'}</span>
      <span class="status-bar-item">UTF-8</span>
    {/if}
    {#if $sessions.length > 0}
      <div class="status-mode-switcher" role="group" aria-label="Editor view">
        <button
          type="button"
          class:active={$editorMode === 'wysiwym'}
          aria-pressed={$editorMode === 'wysiwym'}
          aria-label="Write"
          onclick={() => setEditorMode('wysiwym')}
          title="Write view"
        >
          Write
        </button>
        <button
          type="button"
          class:active={$editorMode === 'source'}
          aria-pressed={$editorMode === 'source'}
          aria-label="Source"
          onclick={() => setEditorMode('source')}
          title="Source view"
        >
          Source
        </button>
        <button
          type="button"
          class:active={$editorMode === 'preview'}
          aria-pressed={$editorMode === 'preview'}
          aria-label="Read"
          onclick={() => setEditorMode('preview')}
          title="Read view"
        >
          Read
        </button>
      </div>
    {/if}
  </div>
</div>

<style>
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
  }

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
    opacity: 0.58;
  }

  .status-mode-switcher button {
    min-width: 0;
    height: auto;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--ui-text-muted);
    font-size: 10px;
    line-height: 1;
    cursor: pointer;
  }

  .status-mode-switcher button:hover {
    color: var(--ui-text);
  }

  .status-mode-switcher button.active {
    color: var(--ui-text);
    font-weight: 500;
  }

  .status-mode-switcher button:focus-visible {
    outline: 2px solid var(--ui-accent);
    outline-offset: 2px;
  }
</style>
