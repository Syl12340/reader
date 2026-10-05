export function normalizePathKey(path: string): string {
  const normalized = resolvePath(path).replace(/\/+$/, '');
  return /^[a-zA-Z]:\//.test(normalized) || normalized.startsWith('//') ? normalized.toLowerCase() : normalized;
}

export function resolvePath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const prefix = normalized.startsWith('//') ? '//' : normalized.startsWith('/') ? '/' : '';
  const parts: string[] = [];
  const rootDepth = prefix === '//' ? 2 : /^[a-zA-Z]:/.test(normalized) ? 1 : 0;
  for (const part of normalized.split('/').filter(Boolean)) {
    if (part === '.') continue;
    if (part === '..') {
      if (parts.length > rootDepth && parts.at(-1) !== '..') parts.pop();
      else if (!prefix && rootDepth === 0) parts.push(part);
    } else parts.push(part);
  }
  return prefix + parts.join('/');
}

export function pathContains(parent: string, candidate: string): boolean {
  const parentKey = normalizePathKey(parent);
  const candidateKey = normalizePathKey(candidate);
  return candidateKey === parentKey || candidateKey.startsWith(`${parentKey}/`);
}

export function parentPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  const index = normalized.lastIndexOf('/');
  if (index < 0) return '';
  const parent = normalized.slice(0, index);
  return path.includes('\\') ? parent.replace(/\//g, '\\') : parent;
}

export function joinPath(directory: string, name: string): string {
  const separator = directory.includes('\\') ? '\\' : '/';
  return `${directory.replace(/[\\/]+$/, '')}${separator}${name}`;
}

export function replacePathPrefix(path: string, oldPrefix: string, newPrefix: string): string {
  if (!pathContains(oldPrefix, path)) return path;
  const pathKey = path.replace(/\\/g, '/');
  const oldKey = oldPrefix.replace(/\\/g, '/').replace(/\/+$/, '');
  const suffix = pathKey.slice(oldKey.length).replace(/^\/+/, '');
  if (!suffix) return newPrefix;
  return joinPath(newPrefix, suffix.replace(/\//g, newPrefix.includes('\\') ? '\\' : '/'));
}
