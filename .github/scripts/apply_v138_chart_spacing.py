from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"Missing expected source block: {label}")
    return text.replace(old, new, 1)


js_path = Path('assets/js/one-sheet-reports.js')
source = js_path.read_text()

old_events = """  const HISTORICAL_EVENT_ANNOTATIONS = [
    { type: 'band', start: '2007-12-01', end: '2009-06-30', label: 'Great Recession · Dec 2007–Jun 2009' },
    { type: 'marker', date: '2018-01-01', label: 'TCJA changes take effect · Jan 2018' },
    { type: 'marker', date: '2019-02-01', label: 'WNMU Passport · Feb 2019' },
    { type: 'band', start: '2020-03-11', end: '2023-05-11', label: 'COVID emergency period · Mar 2020–May 2023' },
    { type: 'marker', date: '2020-03-11', label: 'COVID emergency begins · Mar 2020' },
    { type: 'marker', date: '2023-05-11', label: 'COVID emergency ends · May 2023' },
    { type: 'marker', date: '2025-07-24', label: 'CPB funding rescinded · Jul 2025' }
  ];
"""
new_events = """  const HISTORICAL_EVENT_ANNOTATIONS = [
    { type: 'band', start: '2007-12-01', end: '2009-06-30', label: 'Great Recession · Dec 2007–Jun 2009', lines: ['Great Recession', 'Dec 2007–Jun 2009'], lane: 0 },
    { type: 'marker', date: '2018-01-01', label: 'Federal tax-law changes · Jan 2018', lines: ['Federal tax-law changes', 'Jan 2018'], lane: 0 },
    { type: 'marker', date: '2019-02-01', label: 'WNMU Passport · Feb 2019', lines: ['WNMU Passport', 'Feb 2019'], lane: 1 },
    { type: 'band', start: '2020-03-11', end: '2023-05-11', label: 'COVID emergency period · Mar 2020–May 2023', lines: ['COVID emergency period', 'Mar 2020–May 2023'], lane: 3 },
    { type: 'marker', date: '2020-03-11', label: 'COVID emergency begins · Mar 2020', lines: ['COVID emergency begins', 'Mar 2020'], lane: 2 },
    { type: 'marker', date: '2023-05-11', label: 'COVID emergency ends · May 2023', lines: ['COVID emergency ends', 'May 2023'], lane: 0 },
    { type: 'marker', date: '2025-07-24', label: 'CPB funding rescinded · Jul 2025', lines: ['CPB funding rescinded', 'Jul 2025'], lane: 1 }
  ];
"""
source = replace_once(source, old_events, new_events, 'historical event metadata')

old_dimensions = """    const width = 760;
    const height = hasEventAnnotations ? 330 : 285;
    const margin = { left: 70, right: 20, top: hasEventAnnotations ? 66 : 22, bottom: labels.length > 8 ? 86 : 62 };
"""
new_dimensions = """    const crowdedChronology = displayLabels.length > 20;
    const width = hasEventAnnotations ? 980 : (crowdedChronology ? 920 : 760);
    const height = hasEventAnnotations ? 400 : 285;
    const margin = {
      left: 70,
      right: 24,
      top: hasEventAnnotations ? 108 : 22,
      bottom: crowdedChronology ? 118 : (labels.length > 8 ? 92 : 62)
    };
"""
source = replace_once(source, old_dimensions, new_dimensions, 'line chart dimensions')

old_labels = """    const rotate = displayLabels.length > 8 || displayLabels.some((label) => String(label).length > 12);
    const xLabels = displayLabels.map((label, index) => {
      if (index % Math.max(1, Number(xLabelEvery || 1)) !== 0 && index !== labels.length - 1) return '';
      const xpos = x(index);
      const ypos = margin.top + plotHeight + 21;
      const labelText = escapeHtml(chartLabel(label, rotate ? 15 : 19));
      return rotate
        ? `<text x="${xpos.toFixed(1)}" y="${ypos}" text-anchor="end" transform="rotate(-38 ${xpos.toFixed(1)} ${ypos})">${labelText}</text>`
        : `<text x="${xpos.toFixed(1)}" y="${ypos}" text-anchor="middle">${labelText}</text>`;
    }).join('');
"""
new_labels = """    const rotate = displayLabels.length > 8 || displayLabels.some((label) => String(label).length > 12);
    const xLabelAngle = crowdedChronology ? -68 : -46;
    const xLabels = displayLabels.map((label, index) => {
      if (index % Math.max(1, Number(xLabelEvery || 1)) !== 0 && index !== labels.length - 1) return '';
      const xpos = x(index);
      const ypos = margin.top + plotHeight + 21;
      const labelText = escapeHtml(chartLabel(label, rotate ? (crowdedChronology ? 18 : 15) : 19));
      return rotate
        ? `<text class="chart-x-label" x="${xpos.toFixed(1)}" y="${ypos}" text-anchor="end" transform="rotate(${xLabelAngle} ${xpos.toFixed(1)} ${ypos})">${labelText}</text>`
        : `<text class="chart-x-label" x="${xpos.toFixed(1)}" y="${ypos}" text-anchor="middle">${labelText}</text>`;
    }).join('');
"""
source = replace_once(source, old_labels, new_labels, 'x axis labels')

old_events_render = """    const eventBands = hasEventAnnotations ? eventAnnotations.filter((item) => item.type === 'band').map((item) => {
      const startX = xForDate(item.start);
      const endX = xForDate(item.end);
      if (!(Number.isFinite(startX) && Number.isFinite(endX))) return '';
      const left = Math.min(startX, endX);
      const bandWidth = Math.max(1, Math.abs(endX - startX));
      return `<g class="chart-event-band"><rect x="${left.toFixed(1)}" y="${margin.top}" width="${bandWidth.toFixed(1)}" height="${plotHeight}" fill="#dbe3e7" fill-opacity="0.42"/><text x="${(left + 4).toFixed(1)}" y="${margin.top + 13}" font-size="9" font-weight="800" fill="#536a76"><title>${escapeHtml(item.label)}</title>${escapeHtml(chartLabel(item.label, 28))}</text></g>`;
    }).join('') : '';
    const eventMarkers = hasEventAnnotations ? eventAnnotations.filter((item) => item.type === 'marker').map((item, index) => {
      const xpos = xForDate(item.date);
      if (!Number.isFinite(xpos)) return '';
      const labelY = 14 + ((index % 3) * 15);
      const shortLabel = chartLabel(item.label, 24);
      return `<g class="chart-event-marker"><line x1="${xpos.toFixed(1)}" y1="${margin.top}" x2="${xpos.toFixed(1)}" y2="${margin.top + plotHeight}" stroke="#7b8790" stroke-width="1" stroke-dasharray="3 3"/><text x="${xpos.toFixed(1)}" y="${labelY}" text-anchor="middle" font-size="9" font-weight="800" fill="#4f626d"><title>${escapeHtml(item.label)}</title>${escapeHtml(shortLabel)}</text></g>`;
    }).join('') : '';
    const eventLayer = `${eventBands}${eventMarkers}`;
"""
new_events_render = """    const eventLabelLines = (item = {}) => {
      if (Array.isArray(item.lines) && item.lines.length) return item.lines.slice(0, 3).map((line) => A.text(line)).filter(Boolean);
      const words = A.text(item.label || '').split(/\\s+/).filter(Boolean);
      if (!words.length) return [];
      const lines = [];
      let current = '';
      words.forEach((word) => {
        const candidate = current ? `${current} ${word}` : word;
        if (candidate.length <= 22 || !current) current = candidate;
        else {
          lines.push(current);
          current = word;
        }
      });
      if (current) lines.push(current);
      return lines.slice(0, 3);
    };
    const eventText = (item, xpos, labelY) => {
      const lines = eventLabelLines(item);
      return `<text class="chart-event-label" x="${xpos.toFixed(1)}" y="${labelY}" text-anchor="middle"><title>${escapeHtml(item.label)}</title>${lines.map((line, lineIndex) => `<tspan x="${xpos.toFixed(1)}" dy="${lineIndex === 0 ? 0 : 11}">${escapeHtml(line)}</tspan>`).join('')}</text>`;
    };
    const eventBands = hasEventAnnotations ? eventAnnotations.filter((item) => item.type === 'band').map((item) => {
      const startX = xForDate(item.start);
      const endX = xForDate(item.end);
      if (!(Number.isFinite(startX) && Number.isFinite(endX))) return '';
      const left = Math.min(startX, endX);
      const bandWidth = Math.max(1, Math.abs(endX - startX));
      const centerX = left + (bandWidth / 2);
      const lane = Math.max(0, Number(item.lane || 0));
      const labelY = 16 + (lane * 22);
      const lines = eventLabelLines(item);
      const leaderStartY = labelY + (Math.max(0, lines.length - 1) * 11) + 5;
      return `<g class="chart-event-band"><rect x="${left.toFixed(1)}" y="${margin.top}" width="${bandWidth.toFixed(1)}" height="${plotHeight}" fill="#dbe3e7" fill-opacity="0.42"/><line class="chart-event-leader" x1="${centerX.toFixed(1)}" y1="${leaderStartY}" x2="${centerX.toFixed(1)}" y2="${margin.top - 3}"/>${eventText(item, centerX, labelY)}</g>`;
    }).join('') : '';
    const eventMarkers = hasEventAnnotations ? eventAnnotations.filter((item) => item.type === 'marker').map((item) => {
      const xpos = xForDate(item.date);
      if (!Number.isFinite(xpos)) return '';
      const lane = Math.max(0, Number(item.lane || 0));
      const labelY = 16 + (lane * 22);
      const lines = eventLabelLines(item);
      const leaderStartY = labelY + (Math.max(0, lines.length - 1) * 11) + 5;
      return `<g class="chart-event-marker"><line class="chart-event-leader" x1="${xpos.toFixed(1)}" y1="${leaderStartY}" x2="${xpos.toFixed(1)}" y2="${margin.top - 3}"/><line class="chart-event-guide" x1="${xpos.toFixed(1)}" y1="${margin.top}" x2="${xpos.toFixed(1)}" y2="${margin.top + plotHeight}"/>${eventText(item, xpos, labelY)}</g>`;
    }).join('') : '';
    const eventLayer = `${eventBands}${eventMarkers}`;
"""
source = replace_once(source, old_events_render, new_events_render, 'event annotation rendering')

old_return = """    const svg = `<svg class="report-line-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(ariaLabel)}"><line x1="${margin.left}" y1="${margin.top + plotHeight}" x2="${width - margin.right}" y2="${margin.top + plotHeight}" class="chart-axis"/><line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + plotHeight}" class="chart-axis"/>${grid}${verticalGrid}${eventLayer}${plotted}${xLabels}<text x="18" y="${margin.top + (plotHeight / 2)}" transform="rotate(-90 18 ${margin.top + (plotHeight / 2)})" text-anchor="middle" class="chart-axis-title">${escapeHtml(yLabel)}</text></svg>`;
    return `<div class="report-chart ${escapeHtml(className)}">${legendTop ? legend : ''}${svg}${legendTop ? '' : legend}</div>`;
"""
new_return = """    const svg = `<svg class="report-line-chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(ariaLabel)}"><line x1="${margin.left}" y1="${margin.top + plotHeight}" x2="${width - margin.right}" y2="${margin.top + plotHeight}" class="chart-axis"/><line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + plotHeight}" class="chart-axis"/>${grid}${verticalGrid}${eventLayer}${plotted}${xLabels}<text x="18" y="${margin.top + (plotHeight / 2)}" transform="rotate(-90 18 ${margin.top + (plotHeight / 2)})" text-anchor="middle" class="chart-axis-title">${escapeHtml(yLabel)}</text></svg>`;
    const chartClasses = ['report-chart', hasEventAnnotations ? 'report-chart-annotated' : '', className].filter(Boolean).map(escapeHtml).join(' ');
    return `<div class="${chartClasses}">${legendTop ? legend : ''}${svg}${legendTop ? '' : legend}</div>`;
"""
source = replace_once(source, old_return, new_return, 'annotated chart wrapper class')
js_path.write_text(source)

css_path = Path('assets/one-sheet-reports.css')
css = css_path.read_text()
addition = """
.report-chart-annotated{overflow-x:auto;overflow-y:visible}
.report-chart-annotated .report-line-chart-svg{min-width:940px;max-height:400px}
.chart-x-label{font-size:11px!important}
.chart-event-label{font-size:10px!important;font-weight:850;fill:#405662!important}
.chart-event-leader{stroke:#6d7f88;stroke-width:1.1}
.chart-event-guide{stroke:#7b8790;stroke-width:1;stroke-dasharray:3 3}
"""
if '.report-chart-annotated{' not in css:
    css += addition
css_path.write_text(css)

for target in [Path('reports.html'), Path('version.json'), *Path('tests').glob('*.test.mjs')]:
    text = target.read_text()
    text = text.replace('0.22.137', '0.22.138')
    text = text.replace(r'0\.22\.137', r'0\.22\.138')
    target.write_text(text)

chart_test = Path('tests/chart-program-tooltips-trend-v134.test.mjs')
test = chart_test.read_text()
test = test.replace("assert.match(source, /TCJA changes take effect · Jan 2018/);", "assert.match(source, /Federal tax-law changes · Jan 2018/);")
marker = "assert.match(source, /bindHistoricalChartControls\\(\\$\\('#report-output'\\)\\)/);\n"
additions = r"""assert.match(source, /const width = hasEventAnnotations \? 980 : \(crowdedChronology \? 920 : 760\)/);
assert.match(source, /const xLabelAngle = crowdedChronology \? -68 : -46/);
assert.match(source, /class=\"chart-x-label\"/);
assert.match(source, /class=\"chart-event-leader\"/);
assert.match(source, /class=\"chart-event-guide\"/);
assert.match(source, /function|const eventLabelLines/);
assert.match(source, /lines: \['WNMU Passport', 'Feb 2019'\]/);
assert.match(source, /lines: \['COVID emergency begins', 'Mar 2020'\]/);
assert.match(source, /lines: \['COVID emergency ends', 'May 2023'\]/);
assert.match(source, /lines: \['CPB funding rescinded', 'Jul 2025'\]/);
assert.match(source, /report-chart-annotated/);
"""
if additions not in test:
    test = replace_once(test, marker, marker + additions, 'v138 chart spacing assertions')
test = test.replace("console.log('v0.22.137 chart hover, event annotation, era toggle, and trend tests passed');", "console.log('v0.22.138 chart spacing, leader, hover, era toggle, and trend tests passed');")
chart_test.write_text(test)
