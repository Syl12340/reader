import type { FileNode } from '$lib/stores/file';

export function filterFileTree(nodes: FileNode[], query: string, collapsed: ReadonlySet<string> = new Set()): FileNode[] {
  const needle = query.trim().normalize('NFKC').toLocaleLowerCase();
  if (!needle) return nodes;
  function filter(items: FileNode[], includeAll = false): FileNode[] {
    return items.flatMap(node => {
      const matches = includeAll || node.name.normalize('NFKC').toLocaleLowerCase().includes(needle);
      const children = node.children ? filter(node.children, matches) : undefined;
      if (!matches && !children?.length) return [];
      return [{ ...node, children, isExpanded: node.isDirectory ? !collapsed.has(node.path) : node.isExpanded }];
    });
  }
  return filter(nodes);
}
