// Cached SVGs need distinct IDs when the same diagram appears more than once.
export function uniqueSvg(source: string, prefix: string): string {
  const parsed = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (parsed.querySelector('parsererror')) throw new Error('SVG 图形格式无效');
  const ids = new Map<string, string>();
  for (const element of parsed.querySelectorAll('[id]')) {
    const id = element.id;
    ids.set(id, prefix + id);
    element.id = prefix + id;
  }
  const references = (value: string) => value.replace(/url\(\s*(["']?)#([^)'"\s]+)\1\s*\)/g,
    (_match, _quote, id: string) => `url(#${ids.get(id) ?? id})`);
  for (const element of parsed.querySelectorAll('*')) {
    for (const attr of [...element.attributes]) {
      if (attr.name === 'id') continue;
      let value = references(attr.value);
      if (['href', 'xlink:href'].includes(attr.name) && value.startsWith('#')) value = '#' + (ids.get(value.slice(1)) ?? value.slice(1));
      if (['aria-labelledby', 'aria-describedby'].includes(attr.name)) value = value.split(/\s+/).map(id => ids.get(id) ?? id).join(' ');
      if (value !== attr.value) attr.value = value;
    }
    if (element.localName === 'style') {
      let css = references(element.textContent ?? '');
      for (const [id, replacement] of [...ids].sort(([a], [b]) => b.length - a.length)) {
        const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        css = css.replace(new RegExp(`#${escaped}(?=[\\s{.:>+~,\\[)]|$)`, 'g'), () => `#${replacement}`);
      }
      element.textContent = css;
    }
  }
  return new XMLSerializer().serializeToString(parsed.documentElement);
}
