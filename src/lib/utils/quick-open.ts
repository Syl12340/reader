export function quickOpenScore(path: string, query: string): number {
  const normalized = (value: string) => value.normalize('NFKC').replace(/\\/g, '/').toLowerCase();
  const needle = normalized(query.trim());
  if (!needle) return 0;
  const text = normalized(path);
  const name = text.split('/').pop() || text;
  if (name.startsWith(needle)) return 1000 + 100 / (1 + name.length);
  if (name.includes(needle)) return 500 + 100 / (1 + name.length);
  if (text.includes(needle)) return 200 + 100 / (1 + text.length);
  let cursor = 0;
  for (const character of needle) {
    cursor = text.indexOf(character, cursor);
    if (cursor < 0) return -1;
    cursor += character.length;
  }
  return 100 / (1 + cursor);
}
