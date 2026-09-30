export interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
  isExpanded?: boolean;
}

export interface CursorPosition {
  line: number;
  column: number;
}

export interface MarkdownStats {
  words: number;
  characters: number;
  lines: number;
  paragraphs: number;
  headings: number;
  codeBlocks: number;
  links: number;
  images: number;
}

export interface SearchResult {
  name: string;
  path: string;
  type: 'file' | 'directory';
  matches?: Array<{
    line: number;
    column: number;
    text: string;
  }>;
}

export type Theme = 'light' | 'dark';
export type EditorMode = 'wysiwym' | 'source' | 'preview';
export type WorkspaceLayout = EditorMode | 'wysiwym-preview' | 'source-preview';

export interface TableEditRequest {
  sessionId: string;
  from: number;
  to: number;
  markdown: string;
}

export interface EditorContentEditRequest {
  sessionId: string;
  expectedContent: string;
  content: string;
  applied: boolean;
}

export interface EditorRevealRequest {
  sessionId: string;
  from: number;
  to: number;
  line: number;
  focus?: boolean;
}

export interface WidgetRenderContext {
  filePath: string | null;
  theme: Theme;
  mode: EditorMode;
}

export type FileExtension =
  | 'md'
  | 'markdown'
  | 'txt'
  | 'json'
  | 'yaml'
  | 'yml'
  | 'toml'
  | 'xml'
  | 'html'
  | 'css'
  | 'js'
  | 'ts'
  | 'jsx'
  | 'tsx'
  | 'py'
  | 'java'
  | 'cpp'
  | 'c'
  | 'h'
  | 'hpp'
  | 'rs'
  | 'go'
  | 'rb'
  | 'php'
  | 'sh'
  | 'bash'
  | 'zsh'
  | 'fish'
  | 'ps1'
  | 'bat'
  | 'cmd'
  | string;

export interface EditorState {
  currentFile: string | null;
  fileHandle?: unknown;
  content: string;
  isEditing: boolean;
  isDirty: boolean;
  cursorPosition: CursorPosition;
}

export interface FileTreeState {
  currentDirectory: string | null;
  tree: FileNode[];
  isLoading: boolean;
  error: string | null;
}

export interface AppState {
  theme: Theme;
  showSidebar: boolean;
  showPreview: boolean;
  editor: EditorState;
  fileTree: FileTreeState;
}

export interface Shortcut {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
  description: string;
  action: () => void;
}

export interface MenuItem {
  label: string;
  shortcut?: string;
  action: () => void;
  disabled?: boolean;
  separator?: boolean;
}

export interface ToolbarButton {
  icon: string;
  title: string;
  action: () => void;
  active?: boolean;
  disabled?: boolean;
}

export interface Notification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message?: string;
  duration?: number;
}

export interface FileDialogResult {
  path: string;
  content: string;
}

export interface SearchOptions {
  query: string;
  directory: string;
  includeFiles?: boolean;
  includeDirectories?: boolean;
  caseSensitive?: boolean;
  useRegex?: boolean;
  maxResults?: number;
}

export interface ExportOptions {
  format: 'html' | 'pdf' | 'markdown';
  includeStyles?: boolean;
  pageSize?: 'a4' | 'letter' | 'legal';
  orientation?: 'portrait' | 'landscape';
}

export interface DocumentSession {
  id: string;
  workspaceLayout?: WorkspaceLayout;
  lastEditingLayout?: Exclude<WorkspaceLayout, 'preview'>;
  saveState?: 'saving' | 'error';
  saveError?: string;
  name: string;
  path: string | null;
  content: string;
  savedContent: string;
  contentVersion?: number;
  isDirty: boolean;
  cursorOffset: number;
  scrollTop: number;
  previewScrollTop?: number;
  externalModified?: boolean;
  externalContent?: string;
  externalMissing?: boolean;
  externalReadError?: string;
  fileHandle?: any;
  editorState?: any;
}
