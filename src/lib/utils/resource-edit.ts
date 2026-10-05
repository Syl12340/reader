export interface ResourceEditRequest {
  sessionId: string;
  kind: 'image' | 'link';
  from: number;
  to: number;
  markdown: string;
  source: string;
  label: string;
  sourceFrom: number;
  sourceTo: number;
  labelFrom: number;
  labelTo: number;
}

export function replaceResource(request: ResourceEditRequest, source: string, label: string): string {
  source = source.trim();
  if (!source || /[<>\r\n\x00-\x1f]/.test(source)) throw new Error('路径不能为空，也不能包含换行或尖括号。');
  if (/^(?![a-z]:[\\/])[a-z][\w+.-]*:/i.test(source)
    && !/^(https?:|mailto:)/i.test(source) && !(request.kind === 'image' && /^data:image\//i.test(source))) {
    throw new Error('此资源协议不受支持。');
  }
  const changes = [
    { from: request.sourceFrom, to: request.sourceTo, insert: `<${source}>` },
    { from: request.labelFrom, to: request.labelTo, insert: label.replace(/\r?\n/g, ' ').replace(/[\\[\]]/g, '\\$&') },
  ].sort((a, b) => b.from - a.from);
  let markdown = request.markdown;
  for (const change of changes) {
    if (change.from < 0 || change.to < change.from || change.to > request.markdown.length) throw new Error('资源范围已失效。');
    markdown = markdown.slice(0, change.from) + change.insert + markdown.slice(change.to);
  }
  return markdown;
}
