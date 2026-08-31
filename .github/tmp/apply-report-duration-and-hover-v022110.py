from pathlib import Path
import re

analysis_path = Path('assets/js/one-sheet-analysis.js')
analysis = analysis_path.read_text()
old = "lengthLabel: !item.durationValues.length ? 'Missing' : uniqueLengths.length === 1 ? `${uniqueLengths[0]} min` : 'Varies',"
new = "lengthLabel: !item.durationValues.length ? 'Length missing' : uniqueLengths.length === 1 ? `${uniqueLengths[0]} min` : 'Varies',"
if old not in analysis:
    raise SystemExit('missing program-results length label marker')
analysis_path.write_text(analysis.replace(old, new, 1))

reports_path = Path('assets/js/one-sheet-reports.js')
reports = reports_path.read_text()

old_duration = '''  function durationCoverageText(analyses = []) {
    const summary = missingDurationSummary(analyses);
    if (!summary.missing.length) return '';
    return `${summary.airings} program airing${summary.airings === 1 ? '' : 's'} lack a usable saved length and Program Library runtime. Their dollars remain in totals but are excluded from $/hour calculations and rankings.`;
  }
'''
new_duration = '''  function durationCoverageText(analyses = []) {
    const summary = missingDurationSummary(analyses);
    if (!summary.missing.length) return '';
    const titles = [...new Set(summary.missing.map((item) => A.text(item.title)).filter(Boolean))];
    const visible = titles.slice(0, 8);
    const extra = Math.max(0, titles.length - visible.length);
    const affected = visible.length
      ? ` Affected title${titles.length === 1 ? '' : 's'}: ${visible.join(', ')}${extra ? `, plus ${extra} more` : ''}.`
      : '';
    return `${summary.airings} program airing${summary.airings === 1 ? '' : 's'} lack both a usable saved schedule length and a reliable Program Library runtime.${affected} Their Broadcast dollars and pledges remain in factual totals, but those airings are excluded from $/hour calculations and rankings.`;
  }
'''
if old_duration not in reports:
    raise SystemExit('durationCoverageText marker not found')
reports = reports.replace(old_duration, new_duration, 1)

old_modal = '<p>These programs do not have a usable saved schedule length or a Program Library runtime. $/hour would be misleading if the report guessed a duration.</p>'
new_modal = '<p>These programs have neither a usable saved schedule length nor a reliable Program Library runtime. $/hour would be misleading if the report guessed a duration.</p>'
if old_modal not in reports:
    raise SystemExit('duration modal copy marker not found')
reports = reports.replace(old_modal, new_modal, 1)

old_line_sig = "  function lineChartSvg({ labels = [], series = [], ariaLabel = 'Fundraiser comparison line graph', className = '', legendTop = false } = {}) {"
if old_line_sig not in reports:
    raise SystemExit('lineChartSvg signature marker not found')

old_points = '''      const points = values.map((value, index) => {
        if (value === null || value === undefined || !Number.isFinite(Number(value))) return '';
        return `<circle cx="${x(index).toFixed(1)}" cy="${y(value).toFixed(1)}" r="4" fill="#fff" stroke="${style.stroke}" stroke-width="2"><title>${escapeHtml(item.label)} · ${escapeHtml(labels[index])}: ${escapeHtml(money(value))}</title></circle>`;
      }).join('');
'''
new_points = '''      const points = values.map((value, index) => {
        if (value === null || value === undefined || !Number.isFinite(Number(value))) return '';
        const tooltip = item.tooltips?.[index] || null;
        const title = `${item.label} · ${labels[index]}: ${money(value)}`;
        if (!tooltip) return `<circle cx="${x(index).toFixed(1)}" cy="${y(value).toFixed(1)}" r="4" fill="#fff" stroke="${style.stroke}" stroke-width="2"><title>${escapeHtml(title)}</title></circle>`;
        const payload = encodeURIComponent(JSON.stringify(tooltip));
        return `<g class="chart-node" tabindex="0" role="button" aria-label="${escapeHtml(title)}. Hover or focus for program titles." data-chart-tooltip="${escapeHtml(payload)}"><circle class="chart-node-hit" cx="${x(index).toFixed(1)}" cy="${y(value).toFixed(1)}" r="11"/><circle class="chart-node-marker" cx="${x(index).toFixed(1)}" cy="${y(value).toFixed(1)}" r="4" fill="#fff" stroke="${style.stroke}" stroke-width="2"><title>${escapeHtml(title)}</title></circle></g>`;
      }).join('');
'''
if old_points not in reports:
    raise SystemExit('line chart points block not found')
reports = reports.replace(old_points, new_points, 1)

chart_helper_marker = "  function incomeBarChartSvg(days = []) {\n"
if chart_helper_marker not in reports:
    raise SystemExit('incomeBarChartSvg marker not found')
chart_helpers = r'''  function chartTooltipElement() {
    let tooltip = document.getElementById('chart-hover-tooltip');
    if (tooltip) return tooltip;
    tooltip = document.createElement('div');
    tooltip.id = 'chart-hover-tooltip';
    tooltip.className = 'chart-hover-tooltip hidden';
    tooltip.setAttribute('role', 'status');
    document.body.appendChild(tooltip);
    return tooltip;
  }

  function positionChartTooltip(tooltip, clientX, clientY) {
    const gap = 14;
    const pad = 10;
    tooltip.style.left = `${clientX + gap}px`;
    tooltip.style.top = `${clientY + gap}px`;
    const rect = tooltip.getBoundingClientRect();
    let left = clientX + gap;
    let top = clientY + gap;
    if (left + rect.width > window.innerWidth - pad) left = Math.max(pad, clientX - rect.width - gap);
    if (top + rect.height > window.innerHeight - pad) top = Math.max(pad, clientY - rect.height - gap);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function showChartTooltip(node, clientX, clientY) {
    const encoded = node?.getAttribute('data-chart-tooltip') || '';
    if (!encoded) return;
    let payload;
    try {
      payload = JSON.parse(decodeURIComponent(encoded));
    } catch (_error) {
      return;
    }
    const tooltip = chartTooltipElement();
    const lines = Array.isArray(payload.lines) ? payload.lines.filter(Boolean) : [];
    tooltip.innerHTML = `<strong>${escapeHtml(payload.title || '')}</strong>${payload.detail ? `<span>${escapeHtml(payload.detail)}</span>` : ''}${lines.length ? `<ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>` : '<em>No program titles recorded for this day.</em>'}`;
    tooltip.classList.remove('hidden');
    positionChartTooltip(tooltip, clientX, clientY);
  }

  function hideChartTooltip() {
    document.getElementById('chart-hover-tooltip')?.classList.add('hidden');
  }

  function bindChartTooltips(root = document) {
    $$('.chart-node[data-chart-tooltip]', root).forEach((node) => {
      if (node.dataset.tooltipBound === 'true') return;
      node.dataset.tooltipBound = 'true';
      node.addEventListener('mouseenter', (event) => showChartTooltip(node, event.clientX, event.clientY));
      node.addEventListener('mousemove', (event) => positionChartTooltip(chartTooltipElement(), event.clientX, event.clientY));
      node.addEventListener('mouseleave', hideChartTooltip);
      node.addEventListener('focus', () => {
        const rect = node.getBoundingClientRect();
        showChartTooltip(node, rect.left + (rect.width / 2), rect.top + (rect.height / 2));
      });
      node.addEventListener('blur', hideChartTooltip);
    });
  }

'''
reports = reports.replace(chart_helper_marker, chart_helpers + chart_helper_marker, 1)

old_daily = '''  function dailyComparisonChart(analyses, aligned) {
    return lineChartSvg({
      labels: aligned.map((entry) => entry.label.title),
      series: analyses.map((analysis, analysisIndex) => ({
        label: analysis.schedule.title,
        values: aligned.map((entry) => entry.days?.[analysisIndex] ? Number(entry.days[analysisIndex].dollars || 0) : null)
      })),
      ariaLabel: 'Broadcast dollars by corresponding fundraiser day',
      className: 'daily-comparison-chart',
      legendTop: true
    });
  }
'''
new_daily = '''  function titlesForFundraiserDay(analysis, day) {
    const dateKey = A.text(day?.dateKey || '');
    if (!dateKey) return [];
    const seen = new Set();
    return [...(analysis?.placementRows || [])]
      .filter((row) => A.text(row.dateKey) === dateKey && !rowIsNonSpecific(row))
      .sort((a, b) => Number(a.startMinutes ?? 99999) - Number(b.startMinutes ?? 99999))
      .map((row) => A.text(row.title || row.plannedTitle || ''))
      .filter((title) => {
        const key = title.toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function dailyComparisonChart(analyses, aligned) {
    return lineChartSvg({
      labels: aligned.map((entry) => entry.label.title),
      series: analyses.map((analysis, analysisIndex) => ({
        label: analysis.schedule.title,
        values: aligned.map((entry) => entry.days?.[analysisIndex] ? Number(entry.days[analysisIndex].dollars || 0) : null),
        tooltips: aligned.map((entry) => {
          const day = entry.days?.[analysisIndex] || null;
          if (!day) return null;
          return {
            title: analysis.schedule.title,
            detail: `${formatDate(day.date)} · ${entry.label.title} · ${money(day.dollars)} Broadcast`,
            lines: titlesForFundraiserDay(analysis, day)
          };
        })
      })),
      ariaLabel: 'Broadcast dollars by corresponding fundraiser day',
      className: 'daily-comparison-chart',
      legendTop: true
    });
  }
'''
if old_daily not in reports:
    raise SystemExit('dailyComparisonChart marker not found')
reports = reports.replace(old_daily, new_daily, 1)

old_topic_return = '''    return `<section class="sheet-section topic-matrix"><div class="section-heading"><div><h2>Topic airtime & performance</h2><p>$ / hour uses only program airings with valid duration and known results. Non-Specific Pledges are shown as their own giving category; because those donations are not tied to a program, airtime and $/hour are not applicable. Income % includes Non-Specific Pledges in the giving-category denominator. Programs shown in bold aired in two or more selected fundraisers.</p></div></div>${topicComparisonChart(analyses, rows)}<div class="table-scroll"><table><thead><tr><th>Topic / giving category</th>${head}</tr></thead><tbody>${body || '<tr><td>No topic data.</td></tr>'}</tbody></table></div></section>`;
'''
new_topic_return = '''    const durationCopy = analyses.some((analysis) => meaningfulMissingDurationRows(analysis).length)
      ? 'Programs excluded from $/hour because duration is unavailable are named in the Duration coverage note above. '
      : '';
    return `<section class="sheet-section topic-matrix"><div class="section-heading"><div><h2>Topic airtime & performance</h2><p>${durationCopy}Non-Specific Pledges are shown as their own giving category; because those donations are not tied to a program, airtime and $/hour are not applicable. Income % includes Non-Specific Pledges in the giving-category denominator. Programs shown in bold aired in two or more selected fundraisers.</p></div></div>${topicComparisonChart(analyses, rows)}<div class="table-scroll"><table><thead><tr><th>Topic / giving category</th>${head}</tr></thead><tbody>${body || '<tr><td>No topic data.</td></tr>'}</tbody></table></div></section>`;
'''
if old_topic_return not in reports:
    raise SystemExit('comparison topic copy marker not found')
reports = reports.replace(old_topic_return, new_topic_return, 1)

old_render_block = '''    $('#report-output').innerHTML = render();
    await ensureWeatherForAnalyses(analyses);
    $('#report-output').innerHTML = render();
'''
new_render_block = '''    $('#report-output').innerHTML = render();
    bindChartTooltips($('#report-output'));
    await ensureWeatherForAnalyses(analyses);
    $('#report-output').innerHTML = render();
    bindChartTooltips($('#report-output'));
'''
if old_render_block not in reports:
    raise SystemExit('comparison render block not found')
reports = reports.replace(old_render_block, new_render_block, 1)
reports_path.write_text(reports)

css_path = Path('assets/one-sheet-reports.css')
css = css_path.read_text()
if '.report-chart{padding:5px 7px 7px;background:#fff}' not in css:
    raise SystemExit('report-chart css marker not found')
css = css.replace('.report-chart{padding:5px 7px 7px;background:#fff}', '.report-chart{position:relative;padding:5px 7px 7px;background:#fff}', 1)
chart_empty = '.chart-empty{padding:12px;text-align:center;color:var(--muted);font-size:.88rem}\n'
if chart_empty not in css:
    raise SystemExit('chart-empty css marker not found')
tooltip_css = '''.chart-empty{padding:12px;text-align:center;color:var(--muted);font-size:.88rem}
.chart-node{cursor:help;outline:none}.chart-node-hit{fill:transparent;stroke:none;pointer-events:all}.chart-node-marker{pointer-events:none}.chart-node:focus .chart-node-marker,.chart-node:hover .chart-node-marker{stroke-width:3;r:5px}.chart-hover-tooltip{position:fixed;z-index:2500;pointer-events:none;width:max-content;max-width:min(380px,calc(100vw - 24px));padding:9px 11px;border-radius:8px;background:#17384a;color:#fff;box-shadow:0 8px 24px rgb(0 0 0 / 28%);font-size:.86rem;line-height:1.3}.chart-hover-tooltip strong{display:block;font-size:.92rem}.chart-hover-tooltip span{display:block;color:#dbe8ee;margin-top:2px}.chart-hover-tooltip ul{margin:6px 0 0;padding-left:18px}.chart-hover-tooltip li{margin:2px 0}.chart-hover-tooltip em{display:block;margin-top:5px;color:#dbe8ee}
'''
css = css.replace(chart_empty, tooltip_css, 1)
css = css.replace('.report-topbar,.report-toolbar,.report-modal-backdrop{display:none!important}', '.report-topbar,.report-toolbar,.report-modal-backdrop,.chart-hover-tooltip{display:none!important}', 1)
css_path.write_text(css)

html_path = Path('reports.html')
html = html_path.read_text()
if html.count('0.22.107') < 3:
    raise SystemExit('expected stale report asset cache markers not found')
html = html.replace('0.22.107', '0.22.110')
html_path.write_text(html)

refine_path = Path('tests/one-sheet-report-refinements.test.mjs')
refine = refine_path.read_text()
refine = refine.replace(r'one-sheet-reports\.js\?v=0\.22\.107', r'one-sheet-reports\.js\?v=0\.22\.110')
refine = refine.replace(r'one-sheet-analysis\.js\?v=0\.22\.107', r'one-sheet-analysis\.js\?v=0\.22\.110')
refine = refine.replace(r'one-sheet-reports\.css\?v=0\.22\.107', r'one-sheet-reports\.css\?v=0\.22\.110')
anchor = "assert.match(reports, /Continue with incomplete data/);\n"
if anchor not in refine:
    raise SystemExit('refinement test duration anchor not found')
refine = refine.replace(anchor, anchor + "assert.match(reports, /Affected title/);\nassert.match(reports, /function bindChartTooltips/);\nassert.match(reports, /function titlesForFundraiserDay/);\nassert.match(reports, /data-chart-tooltip/);\n", 1)
refine_path.write_text(refine)

reports_test_path = Path('tests/one-sheet-reports.test.mjs')
reports_test = reports_test_path.read_text()
missing_assert = "  assert.equal(A.missingDurationPrograms([analysis])[0].title, 'Missing Length');\n"
if missing_assert not in reports_test:
    raise SystemExit('one-sheet missing duration test anchor not found')
reports_test = reports_test.replace(missing_assert, missing_assert + "  assert.equal(A.programResultsRows(analysis)[0].lengthLabel, 'Length missing');\n", 1)
source_anchor = "assert.match(reportSource, /Continue with incomplete data/);\n"
if source_anchor not in reports_test:
    raise SystemExit('one-sheet report source anchor not found')
reports_test = reports_test.replace(source_anchor, source_anchor + "assert.match(reportSource, /Affected title/);\nassert.match(reportSource, /function bindChartTooltips/);\nassert.match(reportSource, /function titlesForFundraiserDay/);\nassert.match(reportSource, /data-chart-tooltip/);\n", 1)
reports_test_path.write_text(reports_test)

version_path = Path('version.json')
version = version_path.read_text()
if '"0.22.109"' not in version:
    raise SystemExit('v0.22.109 marker not found')
version = version.replace('"0.22.109"', '"0.22.110"', 1)
version_path.write_text(version)
