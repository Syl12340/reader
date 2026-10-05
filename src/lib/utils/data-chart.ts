export type ChartTheme = 'light' | 'dark';
export interface DataChart {
  type: 'line' | 'bar' | 'scatter';
  title: string;
  xLabel: string;
  yLabel: string;
  labels: string[];
  series: Array<{ name: string; data: Array<[number, number]> }>;
}

export function escapeChartText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function label(value: unknown, fallback = ''): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.length > 300) throw new Error('图表文字必须是 300 字以内的字符串');
  return value;
}

function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e100) {
    throw new Error('图表数据必须是有限数值，不能包含函数或表达式');
  }
  return value;
}

export function parseDataChart(source: string): DataChart {
  if (source.length > 1_000_000) throw new Error('图表配置超过 1MB，请先减少数据');
  const input = JSON.parse(source);
  if (!input || typeof input !== 'object' || !['line', 'bar', 'scatter'].includes(input.type)) {
    throw new Error('type 必须是 line、bar 或 scatter');
  }
  if (Object.keys(input).some(key => !['type', 'title', 'xLabel', 'yLabel', 'labels', 'series'].includes(key))) {
    throw new Error('图表配置只允许 type、title、xLabel、yLabel、labels、series');
  }
  if (!Array.isArray(input.series) || !input.series.length || input.series.length > 8) {
    throw new Error('图表需要 1–8 组 series');
  }
  const labels = input.labels === undefined ? [] : input.labels;
  if (!Array.isArray(labels) || labels.length > 10_000) throw new Error('labels 必须是最多 10000 项的数组');
  const chart: DataChart = {
    type: input.type, title: label(input.title, '数据图表'), xLabel: label(input.xLabel),
    yLabel: label(input.yLabel), labels: labels.map(value => label(value)), series: [],
  };
  let total = 0;
  chart.series = input.series.map((series: unknown, index: number) => {
    if (!series || typeof series !== 'object' || !('data' in series) || !Array.isArray(series.data)
      || !series.data.length || series.data.length > 10_000) throw new Error('每组 data 需要 1–10000 项数据');
    if (Object.keys(series).some(key => !['name', 'data'].includes(key))) throw new Error('series 只允许 name 和 data');
    total += series.data.length;
    if (total > 40_000) throw new Error('图表总数据量不能超过 40000 项');
    if (chart.type !== 'scatter' && chart.labels.length && chart.labels.length !== series.data.length) {
      throw new Error('labels 的长度必须与各组 data 一致');
    }
    const data: Array<[number, number]> = series.data.map((value: unknown, position: number) => {
      if (chart.type === 'scatter') {
        if (!Array.isArray(value) || value.length !== 2) throw new Error('散点数据必须是 [x, y] 数值对');
        return [number(value[0]), number(value[1])];
      }
      return [position, number(value)];
    });
    return { name: label('name' in series ? series.name : undefined, `系列 ${index + 1}`), data };
  });
  return chart;
}

function sample(data: Array<[number, number]>, limit: number): Array<[number, number]> {
  if (data.length <= limit) return data;
  return Array.from({ length: limit }, (_, index) => data[Math.round(index * (data.length - 1) / (limit - 1))]);
}

const format = (value: number) => Number(value.toPrecision(5)).toLocaleString('zh-CN');
const chartCache = new Map<string, string>();

export function renderDataChart(source: string, theme: ChartTheme = 'light'): string {
  const key = `${theme}:${source}`;
  const cached = chartCache.get(key);
  if (cached) return cached;
  const chart = parseDataChart(source);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const series of chart.series) for (const [x, y] of series.data) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  if (chart.type === 'bar') { minY = Math.min(0, minY); maxY = Math.max(0, maxY); }
  if (minX === maxX) { const padding = Math.max(1, Math.abs(minX) * 0.1); minX -= padding; maxX += padding; }
  if (minY === maxY) { const padding = Math.max(1, Math.abs(minY) * 0.1); minY -= padding; maxY += padding; }
  const left = 92, top = 94, width = 644, height = 250;
  const count = Math.max(...chart.series.map(series => series.data.length));
  const xPos = (x: number) => left + (chart.type === 'bar' ? (x + 0.5) / count : (x - minX) / (maxX - minX)) * width;
  const yPos = (y: number) => top + height - (y - minY) / (maxY - minY) * height;
  const text = theme === 'dark' ? '#d7d4ce' : '#383838';
  const grid = theme === 'dark' ? '#454545' : '#e6e6e6';
  const palette = theme === 'dark'
    ? ['#8cb7e5', '#e7ac72', '#92c5a2', '#c8a8df', '#e6959c', '#82c8cf', '#d2c07d', '#b6b9c3']
    : ['#34699a', '#ad642b', '#397851', '#7d559a', '#ac4b56', '#267680', '#84721c', '#636877'];
  const svg = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 420" role="img" aria-label="${escapeChartText(chart.title)}" style="font-family:system-ui,sans-serif;font-size:13px;color:${text}">`,
    `<title>${escapeChartText(chart.title)}</title>`,
    `<desc>${chart.type}，${chart.series.length} 组数据；数值见数据表，完整配置见源码。</desc>`,
    `<text x="400" y="28" text-anchor="middle" fill="${text}" font-size="18">${escapeChartText(chart.title.slice(0, 50))}</text>`];
  for (let tick = 0; tick <= 4; tick++) {
    const value = minY + (maxY - minY) * tick / 4;
    const y = yPos(value);
    svg.push(`<path d="M${left} ${y}h${width}" stroke="${grid}" fill="none"/>`,
      `<text x="${left - 10}" y="${y + 4}" text-anchor="end" fill="${text}">${format(value)}</text>`);
  }
  const ticks = chart.type === 'scatter' ? 5 : Math.min(6, count);
  for (let index = 0; index < ticks; index++) {
    const value = chart.type === 'scatter' ? minX + (maxX - minX) * index / 4
      : Math.round(index * (count - 1) / Math.max(1, ticks - 1));
    const name = chart.type === 'scatter' ? format(value) : chart.labels[value] ?? String(value + 1);
    svg.push(`<text x="${xPos(value)}" y="370" text-anchor="middle" fill="${text}">${escapeChartText(name.slice(0, 16))}</text>`);
  }
  const limit = chart.type === 'bar' ? 100 : 600;
  for (const [index, series] of chart.series.entries()) {
    const color = palette[index];
    const points = sample(series.data, limit);
    svg.push(`<text x="${left + (index % 4) * 166}" y="${55 + Math.floor(index / 4) * 20}" fill="${color}">${index + 1}. ${escapeChartText(series.name.slice(0, 18))}</text>`);
    if (chart.type === 'line') {
      svg.push(`<polyline points="${points.map(([x, y]) => `${xPos(x)},${yPos(y)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2"${index ? ` stroke-dasharray="${index + 2} 3"` : ''}/>`);
    }
    const barWidth = Math.max(0.8, Math.min(32, width / Math.max(2, count) / chart.series.length * 0.8));
    for (const [x, y] of points) {
      const title = `<title>${escapeChartText(series.name)}: ${escapeChartText(chart.type === 'scatter' ? format(x) : chart.labels[x] ?? String(x + 1))}, ${format(y)}</title>`;
      if (chart.type === 'bar') {
        const base = yPos(0), end = yPos(y);
        const bx = Math.max(left, Math.min(left + width - barWidth, xPos(x) + (index - (chart.series.length - 1) / 2) * barWidth));
        svg.push(`<rect x="${bx}" y="${Math.min(base, end)}" width="${barWidth}" height="${Math.abs(base - end)}" fill="${color}">${title}</rect>`);
      } else if (index % 2) {
        svg.push(`<rect x="${xPos(x) - 3}" y="${yPos(y) - 3}" width="6" height="6" fill="${color}">${title}</rect>`);
      } else {
        svg.push(`<circle cx="${xPos(x)}" cy="${yPos(y)}" r="3" fill="${color}">${title}</circle>`);
      }
    }
  }
  svg.push(`<text x="414" y="405" text-anchor="middle" fill="${text}">${escapeChartText(chart.xLabel.slice(0, 50))}</text>`,
    `<text transform="translate(20 220) rotate(-90)" text-anchor="middle" fill="${text}">${escapeChartText(chart.yLabel.slice(0, 40))}</text>`);
  if (chart.series.some(series => series.data.length > limit)) {
    svg.push(`<text x="736" y="405" text-anchor="end" fill="${text}" font-size="11">已抽样；完整值见数据表</text>`);
  }
  svg.push('</svg>');
  const result = svg.join('');
  chartCache.set(key, result);
  if (chartCache.size > 24) chartCache.delete(chartCache.keys().next().value!);
  return result;
}

export function renderChartTable(source: string): string {
  const chart = parseDataChart(source);
  const rows = chart.series.flatMap(series => series.data.slice(0, 1000).map(([x, y]) =>
    `<tr><td>${escapeChartText(series.name)}</td><td>${escapeChartText(chart.type === 'scatter' ? format(x) : chart.labels[x] ?? String(x + 1))}</td><td>${format(y)}</td></tr>`));
  const truncated = chart.series.some(series => series.data.length > 1000);
  return `<table><caption>${escapeChartText(chart.title)}${truncated ? '（每组仅显示前 1000 项，完整数据见源码）' : ''}</caption><thead><tr><th scope="col">系列</th><th scope="col">${escapeChartText(chart.xLabel || 'X')}</th><th scope="col">${escapeChartText(chart.yLabel || 'Y')}</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

export function renderChartError(source: string, error: unknown): string {
  return `<div class="reader-chart-error" role="status"><strong>图表渲染失败</strong><p>${escapeChartText(error instanceof Error ? error.message : String(error))}</p><pre><code>${escapeChartText(source)}</code></pre></div>`;
}
