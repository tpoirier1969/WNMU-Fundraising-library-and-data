(() => {
  'use strict';

  const COLORS = 8;

  function esc(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function short(value, max = 34) {
    const source = String(value ?? '');
    return source.length > max ? source.slice(0, Math.max(1, max - 1)) + '…' : source;
  }

  function money(value, digits = 0) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return n.toLocaleString(undefined, { style:'currency', currency:'USD', minimumFractionDigits:digits, maximumFractionDigits:digits });
  }

  function num(value, digits = 0) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return n.toLocaleString(undefined, { minimumFractionDigits:digits, maximumFractionDigits:digits });
  }

  function pct(value, digits = 1) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return `${(n * 100).toFixed(digits)}%`;
  }

  function empty(message = 'Not enough data for this chart yet.') {
    return `<div class="premium-chart-empty">${esc(message)}</div>`;
  }

  function horizontalBars(items = [], options = {}) {
    const rows = items.filter((item) => Number.isFinite(Number(item.value)));
    if (!rows.length) return empty();
    const width = options.width || 960;
    const left = options.left || 260;
    const right = options.right || 150;
    const rowHeight = options.rowHeight || 34;
    const top = 18;
    const bottom = 24;
    const height = top + bottom + rows.length * rowHeight;
    const plotWidth = width - left - right;
    const maxAbs = Math.max(1, ...rows.map((item) => Math.abs(Number(item.value) || 0)));
    const formatter = options.formatter || ((value) => num(value));
    const annotation = options.annotation || (() => '');
    const rowSvg = rows.map((item, index) => {
      const value = Number(item.value) || 0;
      const y = top + index * rowHeight;
      const barWidth = Math.max(value === 0 ? 0 : 2, Math.abs(value) / maxAbs * plotWidth);
      const cls = value < 0 ? 'premium-chart-negative' : `premium-chart-series-${index % COLORS}`;
      const note = annotation(item);
      return `<g>
        <title>${esc(item.label)}: ${esc(formatter(value))}${note ? ` · ${esc(note)}` : ''}</title>
        <text class="premium-chart-label" x="${left - 10}" y="${y + 18}" text-anchor="end">${esc(short(item.label, options.labelMax || 38))}</text>
        <rect class="${cls}" x="${left}" y="${y + 5}" width="${barWidth.toFixed(1)}" height="18" rx="4"></rect>
        <text class="premium-chart-value" x="${left + barWidth + 8}" y="${y + 18}">${esc(formatter(value))}${note ? ` · ${esc(note)}` : ''}</text>
      </g>`;
    }).join('');
    return `<div class="premium-chart-scroll"><svg class="premium-svg-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(options.ariaLabel || 'Horizontal bar chart')}">${rowSvg}</svg></div>`;
  }

  function groupedBars(categories = [], series = [], options = {}) {
    if (!categories.length || !series.length) return empty();
    const width = options.width || 960;
    const height = options.height || 350;
    const left = 65;
    const right = 24;
    const top = 38;
    const bottom = 84;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const maxValue = Math.max(1, ...series.flatMap((set) => set.values || []).map((value) => Number(value) || 0));
    const groupWidth = plotWidth / Math.max(1, categories.length);
    const inner = Math.max(8, groupWidth * 0.78);
    const barWidth = inner / Math.max(1, series.length);
    const formatter = options.formatter || ((value) => num(value));
    const grid = [0, .25, .5, .75, 1].map((ratio) => {
      const y = top + plotHeight - plotHeight * ratio;
      return `<g><line class="premium-chart-gridline" x1="${left}" x2="${width-right}" y1="${y}" y2="${y}"></line><text class="premium-chart-axis" x="${left-8}" y="${y+4}" text-anchor="end">${esc(formatter(maxValue*ratio))}</text></g>`;
    }).join('');
    const bars = categories.map((category, categoryIndex) => {
      const center = left + groupWidth * categoryIndex + groupWidth / 2;
      const start = center - inner / 2;
      const groupBars = series.map((set, seriesIndex) => {
        const value = Number(set.values?.[categoryIndex]) || 0;
        const h = Math.max(value ? 2 : 0, value / maxValue * plotHeight);
        const x = start + seriesIndex * barWidth;
        const y = top + plotHeight - h;
        return `<g><title>${esc(category)} · ${esc(set.label)}: ${esc(formatter(value))}</title><rect class="premium-chart-series-${seriesIndex % COLORS}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(2,barWidth-3).toFixed(1)}" height="${h.toFixed(1)}" rx="3"></rect></g>`;
      }).join('');
      return `${groupBars}<text class="premium-chart-axis premium-chart-xlabel" x="${center}" y="${height-50}" text-anchor="middle" transform="rotate(-28 ${center} ${height-50})">${esc(short(category, 20))}</text>`;
    }).join('');
    const legend = series.map((set,index)=>`<span><i class="premium-chart-swatch premium-chart-bg-${index%COLORS}"></i>${esc(set.label)}</span>`).join('');
    return `<div class="premium-chart-legend">${legend}</div><div class="premium-chart-scroll"><svg class="premium-svg-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(options.ariaLabel || 'Grouped bar chart')}">${grid}${bars}</svg></div>`;
  }

  function stackedBars(categories = [], series = [], options = {}) {
    if (!categories.length || !series.length) return empty();
    const width = options.width || 960;
    const height = options.height || 360;
    const left = 65;
    const right = 24;
    const top = 28;
    const bottom = 92;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const totals = categories.map((_, index) => series.reduce((sum, set) => sum + Math.max(0, Number(set.values?.[index]) || 0), 0));
    const maxValue = Math.max(1, ...totals);
    const groupWidth = plotWidth / Math.max(1, categories.length);
    const barWidth = Math.min(72, groupWidth * .58);
    const formatter = options.formatter || ((value) => num(value));
    const bars = categories.map((category, categoryIndex) => {
      const x = left + groupWidth * categoryIndex + (groupWidth - barWidth) / 2;
      let y = top + plotHeight;
      const segments = series.map((set, seriesIndex) => {
        const value = Math.max(0, Number(set.values?.[categoryIndex]) || 0);
        const h = value / maxValue * plotHeight;
        y -= h;
        return `<g><title>${esc(category)} · ${esc(set.label)}: ${esc(formatter(value))}</title><rect class="premium-chart-series-${seriesIndex % COLORS}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(0,h).toFixed(1)}"></rect></g>`;
      }).join('');
      return `${segments}<text class="premium-chart-axis premium-chart-xlabel" x="${x+barWidth/2}" y="${height-55}" text-anchor="middle" transform="rotate(-28 ${x+barWidth/2} ${height-55})">${esc(short(category,20))}</text>`;
    }).join('');
    const legend = series.map((set,index)=>`<span><i class="premium-chart-swatch premium-chart-bg-${index%COLORS}"></i>${esc(set.label)}</span>`).join('');
    return `<div class="premium-chart-legend">${legend}</div><div class="premium-chart-scroll"><svg class="premium-svg-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(options.ariaLabel || 'Stacked bar chart')}"><line class="premium-chart-gridline" x1="${left}" x2="${width-right}" y1="${top+plotHeight}" y2="${top+plotHeight}"></line>${bars}</svg></div>`;
  }

  function percentCombo(categories = [], barValues = [], lineValues = [], options = {}) {
    if (!categories.length) return empty();
    const width = options.width || 960;
    const height = options.height || 340;
    const left = 60;
    const right = 28;
    const top = 30;
    const bottom = 80;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const maxPct = Math.max(1, ...barValues, ...lineValues, 1);
    const groupWidth = plotWidth / categories.length;
    const points = [];
    const bars = categories.map((category,index)=>{
      const bar = Math.max(0, Number(barValues[index]) || 0);
      const line = Math.max(0, Number(lineValues[index]) || 0);
      const h = bar / maxPct * plotHeight;
      const x = left + groupWidth * index + groupWidth*.25;
      const bw = groupWidth*.5;
      const y = top + plotHeight - h;
      const px = left + groupWidth*index + groupWidth/2;
      const py = top + plotHeight - line/maxPct*plotHeight;
      points.push([px,py]);
      return `<g><title>${esc(category)} · ${esc(options.barLabel || 'Bar')}: ${esc(pct(bar))}; ${esc(options.lineLabel || 'Line')}: ${esc(pct(line))}</title><rect class="premium-chart-series-0" x="${x}" y="${y}" width="${bw}" height="${h}" rx="4"></rect><text class="premium-chart-axis premium-chart-xlabel" x="${px}" y="${height-48}" text-anchor="middle" transform="rotate(-28 ${px} ${height-48})">${esc(short(category,18))}</text></g>`;
    }).join('');
    const poly = points.map((point)=>point.join(',')).join(' ');
    const dots = points.map((point)=>`<circle class="premium-chart-line-dot" cx="${point[0]}" cy="${point[1]}" r="4"></circle>`).join('');
    const grid = [0,.25,.5,.75,1].map((ratio)=>{
      const y=top+plotHeight-plotHeight*ratio;
      return `<g><line class="premium-chart-gridline" x1="${left}" x2="${width-right}" y1="${y}" y2="${y}"></line><text class="premium-chart-axis" x="${left-8}" y="${y+4}" text-anchor="end">${Math.round(maxPct*ratio*100)}%</text></g>`;
    }).join('');
    return `<div class="premium-chart-legend"><span><i class="premium-chart-swatch premium-chart-bg-0"></i>${esc(options.barLabel || 'Bar')}</span><span><i class="premium-chart-line-swatch"></i>${esc(options.lineLabel || 'Line')}</span></div><div class="premium-chart-scroll"><svg class="premium-svg-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(options.ariaLabel || 'Bar and line chart')}">${grid}${bars}<polyline class="premium-chart-line" points="${poly}"></polyline>${dots}</svg></div>`;
  }

  function pie(items = [], options = {}) {
    const rows = items.filter((item)=>Number(item.value)>0);
    if (!rows.length) return empty();
    const total = rows.reduce((sum,item)=>sum+Number(item.value),0);
    let offset = 0;
    const rings = rows.map((item,index)=>{
      const share = Number(item.value)/total*100;
      const dash = `${share} ${100-share}`;
      const circle = `<circle class="premium-pie-series-${index % COLORS}" cx="70" cy="70" r="52" pathLength="100" fill="none" stroke-width="34" stroke-dasharray="${dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 70 70)"><title>${esc(item.label)}: ${esc(options.formatter ? options.formatter(item.value) : num(item.value))} (${share.toFixed(1)}%)</title></circle>`;
      offset += share;
      return circle;
    }).join('');
    const legend = rows.map((item,index)=>{
      const share = Number(item.value)/total*100;
      return `<li><i class="premium-chart-swatch premium-chart-bg-${index%COLORS}"></i><span>${esc(item.label)}</span><strong>${share.toFixed(1)}%</strong></li>`;
    }).join('');
    return `<div class="premium-pie-layout"><svg class="premium-pie-chart" viewBox="0 0 140 140" role="img" aria-label="${esc(options.ariaLabel || 'Pie chart')}">${rings}<circle class="premium-pie-hole" cx="70" cy="70" r="31"></circle></svg><ul class="premium-pie-legend">${legend}</ul></div>`;
  }

  function heatmap(matrix = {}, options = {}) {
    const rows = matrix.topics || [];
    const cols = matrix.compositions || [];
    const values = matrix.values || [];
    if (!rows.length || !cols.length) return empty('Not enough mapped topic/composition data for a heat map.');
    const flat = values.flat().map(Number).filter(Number.isFinite);
    const max = Math.max(0, ...flat);
    const min = Math.min(0, ...flat);
    const formatter = options.formatter || ((value)=>num(value));
    function level(value) {
      const n=Number(value)||0;
      if (n<0) return 'neg';
      if (!max || n<=0) return '0';
      return String(Math.min(5,Math.max(1,Math.ceil(n/max*5))));
    }
    const head = cols.map((col)=>`<th title="${esc(col)}">${esc(short(col,22))}</th>`).join('');
    const body = rows.map((row,rowIndex)=>`<tr><th>${esc(short(row,28))}</th>${cols.map((col,colIndex)=>{
      const value=Number(values[rowIndex]?.[colIndex])||0;
      return `<td class="premium-heat-${level(value)}" title="${esc(row)} · ${esc(col)}: ${esc(formatter(value))}"><span>${esc(formatter(value))}</span></td>`;
    }).join('')}</tr>`).join('');
    return `<div class="premium-heatmap-wrap"><table class="premium-heatmap"><thead><tr><th>Topic ↓ / Composition →</th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  const api = { esc, short, money, num, pct, horizontalBars, groupedBars, stackedBars, percentCombo, pie, heatmap, empty };
  globalThis.WNMUPremiumCharts = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();