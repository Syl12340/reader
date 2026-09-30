/**
 * 统一文件图标映射
 * 消除 FileTree、browser-fs、tauri-fs、native-fs 中的重复定义
 */

const FILE_ICONS: Record<string, string> = {
  // ── 文档 ──
  md: '📝', markdown: '📝', txt: '📄', rtf: '📄',
  pdf: '📕', doc: '📘', docx: '📘',
  xls: '📗', xlsx: '📗', csv: '📗',
  ppt: '📙', pptx: '📙',

  // ── 图片 ──
  jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️',
  svg: '🖼️', webp: '🖼️', ico: '🖼️', bmp: '🖼️',

  // ── 音视频 ──
  mp3: '🎵', wav: '🎵', flac: '🎵', aac: '🎵', ogg: '🎵',
  mp4: '🎬', avi: '🎬', mkv: '🎬', mov: '🎬', webm: '🎬',

  // ── 压缩包 ──
  zip: '📦', rar: '📦', '7z': '📦', tar: '📦', gz: '📦', bz2: '📦',

  // ── Web / 前端 ──
  html: '🌐', htm: '🌐',
  css: '🎨', scss: '🎨', sass: '🎨', less: '🎨',
  js: '⚡', jsx: '⚡', mjs: '⚡', cjs: '⚡',
  ts: '🔷', tsx: '🔷', mts: '🔷', cts: '🔷',
  svelte: '🔥', vue: '💚',

  // ── 编程语言 ──
  py: '🐍', pyw: '🐍',
  java: '☕', class: '☕', jar: '☕',
  c: '⚙️', cpp: '⚙️', cc: '⚙️', cxx: '⚙️',
  h: '📎', hpp: '📎', hxx: '📎',
  rs: '🦀',
  go: '🐹',
  rb: '💎',
  php: '🐘',
  swift: '🦅',
  kt: '🟣', kotlin: '🟣',
  lua: '🌙',
  r: '📐', R: '📐',
  pl: '🐪', pm: '🐪',
  ex: '💧', exs: '💧',  // Elixir
  erl: '📱',             // Erlang
  hs: 'λ',               // Haskell
  scala: '🔴',
  clj: '🟢',             // Clojure
  dart: '🎯',
  zig: '⚡',

  // ── Shell / 脚本 ──
  sh: '🐚', bash: '🐚', zsh: '🐚', fish: '🐚',
  ps1: '💠', bat: '💠', cmd: '💠',

  // ── 数据 / 配置 ──
  json: '📋', jsonc: '📋',
  xml: '📄', xsl: '📄',
  yaml: '⚙️', yml: '⚙️',
  toml: '⚙️',
  ini: '⚙️', cfg: '⚙️', conf: '⚙️', config: '⚙️',
  env: '🔧',

  // ── 其他 ──
  lock: '🔒',
  log: '📜',
  sql: '🗃️', db: '🗃️', sqlite: '🗃️',
  graphql: '◈', gql: '◈',
  wasm: '🧩',
  dockerfile: '🐳',
  makefile: '🛠️',
  gitignore: '🙈',
  woff: '🔤', woff2: '🔤', ttf: '🔤', otf: '🔤', eot: '🔤',
};

/**
 * 根据文件扩展名返回对应图标
 * @param extension 文件扩展名（不含点号），如 "ts"、"py"
 * @param isDirectory 是否为目录
 */
export function getFileIcon(extension: string | null | undefined, isDirectory: boolean): string {
  if (isDirectory) return '📁';
  if (!extension) return '📄';
  return FILE_ICONS[extension.toLowerCase()] ?? '📄';
}

/**
 * 获取完整的图标映射表（供需要遍历的场景使用）
 */
export function getIconMap(): Record<string, string> {
  return { ...FILE_ICONS };
}
