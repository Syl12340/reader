export interface FileReplacementPreview {
  path: string;
  expected: string;
  content: string;
  count: number;
}

/** A bounded before/after excerpt, not a minimal edit script. */
export function changePreview(before: string, after: string) {
  const oldLines = before.split('\n');
  const newLines = after.split('\n');
  let first = 0;
  while (first < oldLines.length && first < newLines.length && oldLines[first] === newLines[first]) first++;
  if (first === oldLines.length && first === newLines.length) return { line: 1, before: '', after: '', truncated: false };
  const start = Math.max(0, first - 2);
  const oldText = oldLines.slice(start, start + 120).join('\n');
  const newText = newLines.slice(start, start + 120).join('\n');
  return {
    line: start + 1, before: oldText.slice(0, 16000), after: newText.slice(0, 16000),
    truncated: oldLines.length > start + 120 || newLines.length > start + 120 || oldText.length > 16000 || newText.length > 16000,
  };
}
