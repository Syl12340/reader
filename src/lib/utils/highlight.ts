import {
  createHighlighterCore,
  createJavaScriptRegexEngine,
  type HighlighterCore,
  type LanguageInput,
  type ThemeInput,
} from 'shiki/core';

type HighlightTheme = 'light' | 'dark';
type SupportedTheme = 'github-light' | 'github-dark';
type SupportedLanguage =
  | 'bash'
  | 'css'
  | 'html'
  | 'javascript'
  | 'json'
  | 'markdown'
  | 'python'
  | 'rust'
  | 'svelte'
  | 'typescript';

let highlighter: HighlighterCore | null = null;
let isInitializing = false;
let initPromise: Promise<HighlighterCore> | null = null;
let currentTheme: HighlightTheme = 'light';

const loadedLanguages = new Set<string>(['text']);
const languagePromises = new Map<string, Promise<void>>();

const THEMES: Record<HighlightTheme, SupportedTheme> = {
  light: 'github-light',
  dark: 'github-dark',
};

const THEME_LOADERS: Record<SupportedTheme, () => Promise<ThemeInput>> = {
  'github-light': () => import('shiki/themes/github-light.mjs').then((mod) => mod.default),
  'github-dark': () => import('shiki/themes/github-dark.mjs').then((mod) => mod.default),
};

const LANGUAGE_LOADERS: Record<SupportedLanguage, () => Promise<LanguageInput>> = {
  bash: () => import('shiki/langs/bash.mjs').then((mod) => mod.default),
  css: () => import('shiki/langs/css.mjs').then((mod) => mod.default),
  html: () => import('shiki/langs/html.mjs').then((mod) => mod.default),
  javascript: () => import('shiki/langs/javascript.mjs').then((mod) => mod.default),
  json: () => import('shiki/langs/json.mjs').then((mod) => mod.default),
  markdown: () => import('shiki/langs/markdown.mjs').then((mod) => mod.default),
  python: () => import('shiki/langs/python.mjs').then((mod) => mod.default),
  rust: () => import('shiki/langs/rust.mjs').then((mod) => mod.default),
  svelte: () => import('shiki/langs/svelte.mjs').then((mod) => mod.default),
  typescript: () => import('shiki/langs/typescript.mjs').then((mod) => mod.default),
};

const LANGUAGE_ALIASES: Record<string, SupportedLanguage> = {
  bash: 'bash',
  sh: 'bash',
  shell: 'bash',
  shellscript: 'bash',
  zsh: 'bash',
  css: 'css',
  html: 'html',
  htm: 'html',
  js: 'javascript',
  javascript: 'javascript',
  jsx: 'javascript',
  json: 'json',
  jsonc: 'json',
  md: 'markdown',
  markdown: 'markdown',
  py: 'python',
  python: 'python',
  rs: 'rust',
  rust: 'rust',
  svelte: 'svelte',
  ts: 'typescript',
  tsx: 'typescript',
  typescript: 'typescript',
};

async function getHighlighter(): Promise<HighlighterCore> {
  if (highlighter) return highlighter;
  if (initPromise) return initPromise;

  isInitializing = true;
  initPromise = (async () => createHighlighterCore({
    engine: createJavaScriptRegexEngine(),
    themes: await Promise.all([
      THEME_LOADERS[THEMES.light](),
      THEME_LOADERS[THEMES.dark](),
    ]),
    langs: [],
  }))()
    .then((instance) => {
      highlighter = instance;
      isInitializing = false;
      return instance;
    })
    .catch((err) => {
      console.error('Shiki initialization failed:', err);
      isInitializing = false;
      initPromise = null;
      throw err;
    });

  return initPromise;
}

function normalizeLanguage(lang?: string): SupportedLanguage | 'text' {
  if (!lang) return 'text';
  return LANGUAGE_ALIASES[lang.trim().toLowerCase()] ?? 'text';
}

async function ensureLanguage(hl: HighlighterCore, lang: SupportedLanguage | 'text'): Promise<void> {
  if (lang === 'text' || loadedLanguages.has(lang)) return;

  let pending = languagePromises.get(lang);
  if (!pending) {
    pending = (async () => {
      await hl.loadLanguage(await LANGUAGE_LOADERS[lang]());
      loadedLanguages.add(lang);
    })().finally(() => languagePromises.delete(lang));
    languagePromises.set(lang, pending);
  }
  await pending;
}

function escapeCode(code: string): string {
  return code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function setHighlightTheme(theme: HighlightTheme) {
  currentTheme = theme;
}

export function getHighlightTheme(): string {
  return THEMES[currentTheme];
}

export async function highlightCode(code: string, lang?: string, theme: HighlightTheme = currentTheme): Promise<string> {
  try {
    const hl = await getHighlighter();
    const language = normalizeLanguage(lang);
    await ensureLanguage(hl, language);

    return hl.codeToHtml(code, {
      lang: language,
      theme: THEMES[theme],
      transformers: [{
        pre(node) {
          node.properties.class = `${node.properties.class || ''} shiki-pre`;
        },
        code(node) {
          node.properties.class = `${node.properties.class || ''} shiki-code`;
        },
      }],
    });
  } catch (err) {
    console.warn('Shiki highlight failed, falling back to plain text:', err);
    return `<pre class="shiki-fallback"><code>${escapeCode(code)}</code></pre>`;
  }
}

export function highlightCodeSync(code: string, lang?: string): string | null {
  if (!highlighter) return null;

  try {
    const language = normalizeLanguage(lang);
    if (language !== 'text' && !loadedLanguages.has(language)) return null;

    return highlighter.codeToHtml(code, {
      lang: language,
      theme: THEMES[currentTheme],
    });
  } catch {
    return null;
  }
}

export async function preloadLanguages(langs?: string[]) {
  try {
    const hl = await getHighlighter();
    const toLoad = langs || ['javascript', 'typescript', 'python', 'rust', 'html', 'css', 'json', 'bash'];
    await Promise.all(toLoad.map((lang) => ensureLanguage(hl, normalizeLanguage(lang))));
  } catch (err) {
    console.warn('Failed to preload languages:', err);
  }
}

export function isHighlighterReady(): boolean {
  return highlighter !== null && !isInitializing;
}
