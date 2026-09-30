<script lang="ts">
  import { onMount } from 'svelte';
  import { theme, themePreset } from '$lib/stores/theme';
  import { typewriterMode, focusMode } from '$lib/stores/ui';
  import { THEME_PRESETS } from '$lib/themes';
  import { settings as settingsStore, updateSettings } from '$lib/stores/settings';
  import { ShortcutService, parseKeyboardEvent } from '$lib/services/shortcut';

  let { visible = $bindable(false) }: {
    visible?: boolean;
  } = $props();
  let settingsPanel = $state<HTMLDivElement>();
  let restoreFocus: HTMLElement | null = null;

  $effect(() => {
    if (!visible) return;
    restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    queueMicrotask(() => {
      const firstControl = settingsPanel?.querySelector<HTMLElement>(
        'button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      (firstControl || settingsPanel)?.focus();
    });
    return () => {
      restoreFocus?.focus();
      restoreFocus = null;
    };
  });

  // 设置分类
  type SettingsTab = 'general' | 'editor' | 'theme' | 'shortcuts' | 'export';
  let activeTab: SettingsTab = $state('general');

  // 本地配置状态，初始化自 settingsStore
  let settings = $state({
    autoSave: false,
    autoSaveInterval: 30,
    language: 'zh-CN',
    fontSize: 16,
    lineHeight: 1.75,
    tabSize: 4,
    wordWrap: true,
    showLineNumbers: true,
    bracketMatching: true,
    autoCloseBrackets: true,
    currentTheme: 'light',
    currentPreset: 'default',
    customAccentColor: '#3a6ff7',
    customBgPrimary: '',
    customBgSecondary: '',
    customTextPrimary: '',
    customFontContent: '',
    exportDefaultFormat: 'html',
    exportIncludeCss: true,
  });

  // 同步 settingsStore 的值到本地状态
  onMount(() => {
    const unsubscribe = settingsStore.subscribe(($s) => {
      settings.autoSave = $s.autoSave;
      settings.autoSaveInterval = $s.autoSaveInterval;
      settings.fontSize = $s.fontSize;
      settings.lineHeight = $s.lineHeight;
      settings.tabSize = $s.tabSize;
      settings.wordWrap = $s.wordWrap;
      settings.showLineNumbers = $s.showLineNumbers;
      settings.bracketMatching = $s.bracketMatching;
      settings.autoCloseBrackets = $s.autoCloseBrackets;
      settings.customAccentColor = $s.customAccentColor;
      settings.customBgPrimary = $s.customBgPrimary;
      settings.customBgSecondary = $s.customBgSecondary;
      settings.customTextPrimary = $s.customTextPrimary;
      settings.customFontContent = $s.customFontContent;
      settings.exportDefaultFormat = $s.exportDefaultFormat;
      settings.exportIncludeCss = $s.exportIncludeCss;
    });

    // 填充实际快捷键
    shortcuts.forEach(s => {
      s.key = ShortcutService.getShortcutKey(s.id);
    });

    return unsubscribe;
  });

  // 快捷键配置
  let shortcuts = $state([
    { id: 'newFile', name: '新建文件', key: '', category: '文件' },
    { id: 'openFile', name: '打开文件', key: '', category: '文件' },
    { id: 'saveFile', name: '保存文件', key: '', category: '文件' },
    { id: 'saveAs', name: '另存为', key: '', category: '文件' },
    { id: 'exportPdf', name: '导出 PDF', key: '', category: '文件' },
    { id: 'print', name: '打印', key: '', category: '文件' },
    { id: 'undo', name: '撤销', key: '', category: '编辑' },
    { id: 'redo', name: '重做', key: '', category: '编辑' },
    { id: 'find', name: '查找', key: '', category: '编辑' },
    { id: 'replace', name: '替换', key: '', category: '编辑' },
    { id: 'bold', name: '加粗', key: '', category: '格式' },
    { id: 'italic', name: '斜体', key: '', category: '格式' },
    { id: 'link', name: '插入链接', key: '', category: '格式' },
    { id: 'code', name: '行内代码', key: '', category: '格式' },
    { id: 'toggleSidebar', name: '切换侧边栏', key: '', category: '视图' },
    { id: 'togglePreview', name: '切换预览', key: '', category: '视图' },
    { id: 'toggleTheme', name: '切换主题', key: '', category: '视图' },
    { id: 'commandPalette', name: '命令面板', key: '', category: '通用' },
    { id: 'settings', name: '设置', key: '', category: '通用' },
  ]);

  let editingShortcut = $state<string | null>(null);
  let shortcutSearch = $state('');

  // 过滤后的快捷键
  let filteredShortcuts = $derived.by(() => {
    const search = shortcutSearch.toLowerCase();
    return shortcuts.filter(s =>
      s.name.toLowerCase().includes(search) ||
      s.key.toLowerCase().includes(search) ||
      s.category.toLowerCase().includes(search)
    );
  });

  // 按分类分组的快捷键
  let groupedShortcuts = $derived.by(() => {
    const groups = new Map<string, typeof shortcuts>();
    for (const s of filteredShortcuts) {
      const existing = groups.get(s.category) || [];
      existing.push(s);
      groups.set(s.category, existing);
    }
    return Array.from(groups.entries());
  });

  function saveSettings() {
    updateSettings({
      autoSave: settings.autoSave,
      autoSaveInterval: settings.autoSaveInterval,
      fontSize: settings.fontSize,
      lineHeight: settings.lineHeight,
      tabSize: settings.tabSize,
      wordWrap: settings.wordWrap,
      showLineNumbers: settings.showLineNumbers,
      bracketMatching: settings.bracketMatching,
      autoCloseBrackets: settings.autoCloseBrackets,
      exportDefaultFormat: settings.exportDefaultFormat,
      exportIncludeCss: settings.exportIncludeCss,
    });

    // 应用主题
    theme.set(settings.currentTheme as 'light' | 'dark');
    if (settings.currentPreset) {
      themePreset.set(settings.currentPreset as any);
    }
  }

  function startEditShortcut(id: string) {
    editingShortcut = id;
  }

  function handleShortcutKeydown(event: KeyboardEvent, id: string) {
    event.preventDefault();
    event.stopPropagation();

    if (event.key === 'Escape') {
      editingShortcut = null;
      return;
    }

    const newKey = parseKeyboardEvent(event);
    if (!newKey) return;

    // 检查冲突
    const success = ShortcutService.updateShortcutKey(id, newKey);
    if (!success) {
      const conflict = shortcuts.find(s => s.id !== id && s.key === newKey);
      alert(`快捷键 ${newKey} 已被 "${conflict ? conflict.name : '其他功能'}" 使用`);
      return;
    }

    // 更新本地状态以渲染
    const shortcut = shortcuts.find(s => s.id === id);
    if (shortcut) {
      shortcut.key = newKey;
    }

    editingShortcut = null;
  }

  function resetShortcut(id: string) {
    editingShortcut = null;
  }

  // 应用自定义颜色
  function applyCustomColors() {
    const root = document.documentElement;

    if (settings.customAccentColor) {
      root.style.setProperty('--accent-color', settings.customAccentColor);
      updateSettings({ customAccentColor: settings.customAccentColor });
    }

    if (settings.customBgPrimary) {
      root.style.setProperty('--bg-primary', settings.customBgPrimary);
      updateSettings({ customBgPrimary: settings.customBgPrimary });
    }

    if (settings.customBgSecondary) {
      root.style.setProperty('--bg-secondary', settings.customBgSecondary);
      updateSettings({ customBgSecondary: settings.customBgSecondary });
    }

    if (settings.customTextPrimary) {
      root.style.setProperty('--text-primary', settings.customTextPrimary);
      updateSettings({ customTextPrimary: settings.customTextPrimary });
    }

    if (settings.customFontContent) {
      root.style.setProperty('--font-content', settings.customFontContent);
      updateSettings({ customFontContent: settings.customFontContent });
    }
  }

  // 重置自定义颜色
  function resetCustomColors() {
    const root = document.documentElement;
    root.style.removeProperty('--accent-color');
    root.style.removeProperty('--bg-primary');
    root.style.removeProperty('--bg-secondary');
    root.style.removeProperty('--text-primary');
    root.style.removeProperty('--font-content');

    settings.customAccentColor = '#3a6ff7';
    settings.customBgPrimary = '';
    settings.customBgSecondary = '';
    settings.customTextPrimary = '';
    settings.customFontContent = '';

    updateSettings({
      customAccentColor: '#3a6ff7',
      customBgPrimary: '',
      customBgSecondary: '',
      customTextPrimary: '',
      customFontContent: '',
    });
  }

  function close() {
    saveSettings();
    visible = false;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab' || !settingsPanel) return;

    const controls = Array.from(settingsPanel.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ));
    if (controls.length === 0) {
      event.preventDefault();
      settingsPanel.focus();
      return;
    }

    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
</script>

{#if visible}
  <div class="settings-overlay">
    <button class="settings-backdrop" aria-label="关闭设置" onclick={close}></button>
    <div
      bind:this={settingsPanel}
      class="settings-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      tabindex="-1"
      onkeydown={handleKeydown}
    >
      <!-- 头部 -->
      <div class="settings-header">
        <h2 id="settings-title">设置</h2>
        <button class="close-btn" aria-label="关闭设置" onclick={close}>✕</button>
      </div>

      <!-- 内容 -->
      <div class="settings-content">
        <!-- 侧边栏标签 -->
        <div class="settings-sidebar">
          <button class="sidebar-item" class:active={activeTab === 'general'} onclick={() => activeTab = 'general'}>
            通用
          </button>
          <button class="sidebar-item" class:active={activeTab === 'editor'} onclick={() => activeTab = 'editor'}>
            编辑器
          </button>
          <button class="sidebar-item" class:active={activeTab === 'theme'} onclick={() => activeTab = 'theme'}>
            主题
          </button>
          <button class="sidebar-item" class:active={activeTab === 'shortcuts'} onclick={() => activeTab = 'shortcuts'}>
            快捷键
          </button>
          <button class="sidebar-item" class:active={activeTab === 'export'} onclick={() => activeTab = 'export'}>
            导出
          </button>
        </div>

        <!-- 设置项 -->
        <div class="settings-body">
          {#if activeTab === 'general'}
            <div class="settings-section">
              <h3>通用设置</h3>

              <div class="setting-item">
                <div class="setting-info">
                  <span class="setting-label">自动保存</span>
                  <span class="setting-desc">定期自动保存文件</span>
                </div>
                <label class="toggle">
                  <input type="checkbox" bind:checked={settings.autoSave} onchange={saveSettings} title="自动保存当前标签；后台标签保留恢复快照" />
                  <span class="toggle-slider"></span>
                </label>
              </div>

              {#if settings.autoSave}
                <div class="setting-item">
                  <div class="setting-info">
                    <span class="setting-label">自动保存间隔</span>
                    <span class="setting-desc">单位：秒</span>
                  </div>
                  <input type="number" class="setting-input" bind:value={settings.autoSaveInterval} min="5" max="300" onchange={saveSettings} />
                </div>
              {/if}
            </div>

          {:else if activeTab === 'editor'}
            <div class="settings-section">
              <h3>编辑器设置</h3>

              <div class="setting-item">
                <div class="setting-info">
                  <span class="setting-label">字体大小</span>
                  <span class="setting-desc">编辑器字体大小（像素）</span>
                </div>
                <input type="number" class="setting-input" bind:value={settings.fontSize} min="10" max="24" onchange={saveSettings} />
              </div>

              <div class="setting-item">
                <div class="setting-info">
                  <span class="setting-label">行高</span>
                  <span class="setting-desc">行间距倍数</span>
                </div>
                <input type="number" class="setting-input" bind:value={settings.lineHeight} min="1" max="3" step="0.1" onchange={saveSettings} />
              </div>

              <div class="setting-item">
                <div class="setting-info">
                  <span class="setting-label">Tab 大小</span>
                  <span class="setting-desc">Tab 键对应的空格数</span>
                </div>
                <input type="number" class="setting-input" bind:value={settings.tabSize} min="2" max="8" onchange={saveSettings} />
              </div>

              <div class="setting-item">
                <div class="setting-info">
                  <span class="setting-label">自动换行</span>
                  <span class="setting-desc">长行自动换行显示</span>
                </div>
                <label class="toggle">
                  <input type="checkbox" bind:checked={settings.wordWrap} onchange={saveSettings} />
                  <span class="toggle-slider"></span>
                </label>
              </div>

              <div class="setting-item">
                <div class="setting-info">
                  <span class="setting-label">显示行号</span>
                  <span class="setting-desc">在编辑器左侧显示行号</span>
                </div>
                <label class="toggle">
                  <input type="checkbox" bind:checked={settings.showLineNumbers} onchange={saveSettings} />
                  <span class="toggle-slider"></span>
                </label>
              </div>

              <div class="setting-item">
                <div class="setting-info">
                  <span class="setting-label">括号匹配</span>
                  <span class="setting-desc">高亮匹配的括号</span>
                </div>
                <label class="toggle">
                  <input type="checkbox" bind:checked={settings.bracketMatching} onchange={saveSettings} />
                  <span class="toggle-slider"></span>
                </label>
              </div>

              <div class="setting-item">
                <div class="setting-info">
                  <span class="setting-label">自动闭合括号</span>
                  <span class="setting-desc">输入左括号时自动补全右括号</span>
                </div>
                <label class="toggle">
                  <input type="checkbox" bind:checked={settings.autoCloseBrackets} onchange={saveSettings} />
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>

          {:else if activeTab === 'theme'}
            <div class="settings-section">
              <h3>主题设置</h3>

              <div class="setting-item">
                <div class="setting-info">
                  <span class="setting-label">颜色模式</span>
                  <span class="setting-desc">亮色或暗色主题</span>
                </div>
                <div class="theme-toggle-group">
                  <button class="theme-btn" class:active={settings.currentTheme === 'light'} onclick={() => { settings.currentTheme = 'light'; saveSettings(); }}>
                    ☀️ 亮色
                  </button>
                  <button class="theme-btn" class:active={settings.currentTheme === 'dark'} onclick={() => { settings.currentTheme = 'dark'; saveSettings(); }}>
                    🌙 暗色
                  </button>
                </div>
              </div>

              <div class="setting-item">
                <div class="setting-info">
                  <span class="setting-label">排版主题</span>
                  <span class="setting-desc">选择文档排版风格</span>
                </div>
                <div class="preset-list">
                  {#each THEME_PRESETS as preset}
                    <button
                      class="preset-item"
                      class:active={settings.currentPreset === preset.id}
                      onclick={() => { settings.currentPreset = preset.id; saveSettings(); }}
                    >
                      <span class="preset-name">{preset.name}</span>
                      <span class="preset-desc">{preset.description}</span>
                    </button>
                  {/each}
                </div>
              </div>

              <!-- 自定义颜色 -->
              <div class="setting-item">
                <div class="setting-info">
                  <span class="setting-label">自定义配色</span>
                  <span class="setting-desc">覆盖默认主题颜色</span>
                </div>
              </div>

              <div class="color-grid">
                <div class="color-item">
                  <label class="color-label" for="accent-color">强调色</label>
                  <div class="color-input-wrapper">
                    <input id="accent-color" type="color" class="color-picker" bind:value={settings.customAccentColor} onchange={applyCustomColors} />
                    <input aria-label="强调色十六进制值" type="text" class="color-text" bind:value={settings.customAccentColor} onchange={applyCustomColors} placeholder="#3a6ff7" />
                  </div>
                </div>

                <div class="color-item">
                  <label class="color-label" for="primary-background-color">背景色</label>
                  <div class="color-input-wrapper">
                    <input id="primary-background-color" type="color" class="color-picker" value={settings.customBgPrimary || '#f8f6f1'} onchange={(e) => { settings.customBgPrimary = (e.target as HTMLInputElement).value; applyCustomColors(); }} />
                    <input aria-label="背景色十六进制值" type="text" class="color-text" bind:value={settings.customBgPrimary} onchange={applyCustomColors} placeholder="默认" />
                  </div>
                </div>

                <div class="color-item">
                  <label class="color-label" for="secondary-background-color">侧边栏背景</label>
                  <div class="color-input-wrapper">
                    <input id="secondary-background-color" type="color" class="color-picker" value={settings.customBgSecondary || '#f1eee7'} onchange={(e) => { settings.customBgSecondary = (e.target as HTMLInputElement).value; applyCustomColors(); }} />
                    <input aria-label="侧边栏背景十六进制值" type="text" class="color-text" bind:value={settings.customBgSecondary} onchange={applyCustomColors} placeholder="默认" />
                  </div>
                </div>

                <div class="color-item">
                  <label class="color-label" for="primary-text-color">文字颜色</label>
                  <div class="color-input-wrapper">
                    <input id="primary-text-color" type="color" class="color-picker" value={settings.customTextPrimary || '#22211f'} onchange={(e) => { settings.customTextPrimary = (e.target as HTMLInputElement).value; applyCustomColors(); }} />
                    <input aria-label="文字颜色十六进制值" type="text" class="color-text" bind:value={settings.customTextPrimary} onchange={applyCustomColors} placeholder="默认" />
                  </div>
                </div>
              </div>

              <div class="setting-item">
                <div class="setting-info">
                  <span class="setting-label">正文字体</span>
                  <span class="setting-desc">自定义内容区域字体</span>
                </div>
                <select class="setting-select" bind:value={settings.customFontContent} onchange={applyCustomColors}>
                  <option value="">默认 (Source Serif 4)</option>
                  <option value="'Noto Serif SC', serif">思源宋体</option>
                  <option value="'Noto Sans SC', sans-serif">思源黑体</option>
                  <option value="system-ui, sans-serif">系统字体</option>
                  <option value="Georgia, serif">Georgia</option>
                  <option value="'Times New Roman', serif">Times New Roman</option>
                </select>
              </div>

              <button class="reset-colors-btn" onclick={resetCustomColors}>
                恢复默认配色
              </button>
            </div>

          {:else if activeTab === 'shortcuts'}
            <div class="settings-section">
              <h3>快捷键设置</h3>

              <div class="shortcut-search">
                <input
                  type="text"
                  placeholder="搜索快捷键..."
                  bind:value={shortcutSearch}
                />
              </div>

              <div class="shortcuts-list">
                {#each groupedShortcuts as [category, items]}
                  <div class="shortcut-group">
                    <h4>{category}</h4>
                    {#each items as shortcut}
                      <div class="shortcut-item">
                        <span class="shortcut-name">{shortcut.name}</span>
                        {#if editingShortcut === shortcut.id}
                          <button
                            class="shortcut-key editing"
                            onkeydown={(e) => handleShortcutKeydown(e, shortcut.id)}
                            onclick={() => editingShortcut = null}
                          >
                            按下快捷键...
                          </button>
                        {:else}
                          <button
                            class="shortcut-key"
                            onclick={() => startEditShortcut(shortcut.id)}
                          >
                            {shortcut.key || '未设置'}
                          </button>
                        {/if}
                      </div>
                    {/each}
                  </div>
                {/each}
              </div>
            </div>

          {:else if activeTab === 'export'}
            <div class="settings-section">
              <h3>导出设置</h3>

              <div class="setting-item">
                <div class="setting-info">
                  <span class="setting-label">默认导出格式</span>
                  <span class="setting-desc">文件菜单“快速导出”使用的格式</span>
                </div>
                <select class="setting-select" bind:value={settings.exportDefaultFormat} onchange={saveSettings}>
                  <option value="html">HTML</option>
                  <option value="pdf">PDF</option>
                  <option value="docx">Word (DOCX)</option>
                  <option value="epub">EPUB</option>
                </select>
              </div>

              <div class="setting-item">
                <div class="setting-info">
                  <span class="setting-label">导出包含 CSS</span>
                  <span class="setting-desc">HTML 导出时内嵌样式</span>
                </div>
                <label class="toggle">
                  <input type="checkbox" bind:checked={settings.exportIncludeCss} onchange={saveSettings} />
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .settings-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 300;
  }

  .settings-backdrop {
    position: absolute;
    inset: 0;
    border: 0;
    background: transparent;
    cursor: default;
  }

  .settings-panel {
    position: relative;
    z-index: 1;
    width: 720px;
    max-height: 80vh;
    background: var(--ui-panel);
    border: 1px solid var(--ui-border);
    border-radius: 8px;
    box-shadow: var(--ui-shadow-popover);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .settings-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--ui-border);
  }

  .settings-header h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--ui-text);
  }

  .close-btn {
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--ui-text-muted);
    cursor: pointer;
    font-size: 14px;
  }

  .close-btn:hover {
    background: var(--ui-panel-hover);
    color: var(--ui-text);
  }

  .settings-content {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .settings-sidebar {
    width: 140px;
    padding: 12px 8px;
    border-right: 1px solid var(--ui-border);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .sidebar-item {
    padding: 8px 12px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--ui-text-muted);
    font-size: 13px;
    cursor: pointer;
    text-align: left;
  }

  .sidebar-item:hover {
    background: var(--ui-panel-hover);
    color: var(--ui-text);
  }

  .sidebar-item.active {
    background: var(--ui-panel-active);
    color: var(--ui-text);
    font-weight: 500;
  }

  .settings-body {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
  }

  .settings-section h3 {
    margin: 0 0 16px;
    font-size: 16px;
    font-weight: 600;
  }

  .setting-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 0;
    border-bottom: 1px solid var(--border-color);
  }

  .setting-info {
    flex: 1;
  }

  .setting-label {
    display: block;
    font-size: 14px;
    font-weight: 500;
    color: var(--text-primary);
  }

  .setting-desc {
    display: block;
    font-size: 12px;
    color: var(--text-tertiary);
    margin-top: 2px;
  }

  .setting-input {
    width: 80px;
    padding: 6px 10px;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 13px;
    text-align: center;
  }

  .setting-input:focus {
    outline: none;
    border-color: var(--accent-color);
  }

  .setting-select {
    padding: 6px 12px;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 13px;
  }

  /* Toggle switch */
  .toggle {
    position: relative;
    display: inline-block;
    width: 44px;
    height: 24px;
  }

  .toggle input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .toggle-slider {
    position: absolute;
    cursor: pointer;
    inset: 0;
    background: var(--bg-tertiary);
    border-radius: 12px;
    transition: 0.2s;
  }

  .toggle-slider::before {
    content: '';
    position: absolute;
    height: 18px;
    width: 18px;
    left: 3px;
    bottom: 3px;
    background: white;
    border-radius: 50%;
    transition: 0.2s;
  }

  .toggle input:checked + .toggle-slider {
    background: var(--accent-color);
  }

  .toggle input:checked + .toggle-slider::before {
    transform: translateX(20px);
  }

  /* Theme buttons */
  .theme-toggle-group {
    display: flex;
    gap: 8px;
  }

  .theme-btn {
    padding: 6px 16px;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 13px;
    cursor: pointer;
  }

  .theme-btn.active {
    background: var(--accent-color);
    color: white;
    border-color: var(--accent-color);
  }

  /* Preset list */
  .preset-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 8px;
  }

  .preset-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-secondary);
    cursor: pointer;
    text-align: left;
  }

  .preset-item:hover {
    border-color: var(--accent-color);
  }

  .preset-item.active {
    border-color: var(--accent-color);
    background: rgba(var(--accent-rgb), 0.1);
  }

  .preset-name {
    font-size: 14px;
    font-weight: 500;
  }

  .preset-desc {
    font-size: 12px;
    color: var(--text-tertiary);
  }

  /* Shortcuts */
  .shortcut-search {
    margin-bottom: 16px;
  }

  .shortcut-search input {
    width: 100%;
    padding: 8px 12px;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 13px;
  }

  .shortcut-search input:focus {
    outline: none;
    border-color: var(--accent-color);
  }

  .shortcuts-list {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .shortcut-group h4 {
    margin: 0 0 8px;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .shortcut-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 0;
  }

  .shortcut-name {
    font-size: 13px;
    color: var(--text-primary);
  }

  .shortcut-key {
    padding: 4px 10px;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    background: var(--bg-secondary);
    color: var(--text-secondary);
    font-size: 12px;
    font-family: var(--font-mono);
    cursor: pointer;
    min-width: 100px;
    text-align: center;
  }

  .shortcut-key:hover {
    border-color: var(--accent-color);
  }

  .shortcut-key.editing {
    border-color: var(--accent-color);
    background: rgba(var(--accent-rgb), 0.1);
    color: var(--accent-color);
    animation: pulse 1s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
  }

  /* Color picker */
  .color-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin: 12px 0;
  }

  .color-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .color-label {
    font-size: 12px;
    color: var(--text-secondary);
    font-weight: 500;
  }

  .color-input-wrapper {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .color-picker {
    width: 32px;
    height: 32px;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    cursor: pointer;
    padding: 2px;
  }

  .color-text {
    flex: 1;
    padding: 6px 8px;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 12px;
    font-family: var(--font-mono);
  }

  .color-text:focus {
    outline: none;
    border-color: var(--accent-color);
  }

  .reset-colors-btn {
    width: 100%;
    padding: 8px 16px;
    margin-top: 16px;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    background: var(--bg-secondary);
    color: var(--text-secondary);
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .reset-colors-btn:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }
</style>
