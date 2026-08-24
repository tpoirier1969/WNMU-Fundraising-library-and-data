from pathlib import Path
import json

ROOT = Path('.')


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'missing patch target: {label}')
    return text.replace(old, new, 1)


def replace_all_expected(text, old, new, expected, label):
    count = text.count(old)
    if count != expected:
        raise SystemExit(f'{label}: expected {expected} matches, found {count}')
    return text.replace(old, new)


js_path = ROOT / 'assets/js/ui-analytics.js'
js = js_path.read_text(encoding='utf-8')

js = replace_once(
    js,
    "    trendRows: new Map(),\n",
    "    trendRows: new Map(),\n    groupDetailRows: new Map(),\n",
    'group detail state map'
)

outlier_anchor = """  function outlierLabel(row = {}) {
    const count = Number(row.outlierCount || 0);
    if (!count) return 'None flagged';
    const bits = [];
    if (row.highOutliers) bits.push(`${row.highOutliers} high`);
    if (row.lowOutliers) bits.push(`${row.lowOutliers} low`);
    return `${count} unusual${bits.length ? ` · ${bits.join(' / ')}` : ''}`;
  }
"""
outlier_extra = outlier_anchor + """
  function groupDetailId(row = {}) {
    const id = `group-${state.groupDetailRows.size + 1}`;
    state.groupDetailRows.set(id, row);
    return id;
  }

  function groupTitleDetailCell(row = {}) {
    const id = groupDetailId(row);
    return `<button type=\"button\" class=\"analytics-detail-link\" data-group-detail-id=\"${escapeHtml(id)}\" data-group-detail-mode=\"all\">${labelWithMixCell(row)}</button>`;
  }

  function groupOutlierDetailCell(row = {}) {
    if (!Number(row.outlierCount || 0)) return escapeHtml(outlierLabel(row));
    const id = groupDetailId(row);
    return `<button type=\"button\" class=\"analytics-detail-link outlier-link\" data-group-detail-id=\"${escapeHtml(id)}\" data-group-detail-mode=\"outliers\">${escapeHtml(outlierLabel(row))}</button>`;
  }

  function outlierStatusForRecord(row = {}, record = {}) {
    const value = Number(record.dollars || 0);
    const flagged = Array.isArray(row.outlierValues) && row.outlierValues.some((candidate) => Number(candidate) === value);
    if (!flagged) return '';
    const median = Number(row.median || 0);
    if (value > median) return 'High outlier';
    if (value < median) return 'Low outlier';
    return 'Unusual result';
  }
"""
js = replace_once(js, outlier_anchor, outlier_extra, 'group detail helpers')

render_event_old = """    dom.table.querySelectorAll('[data-trend-id]').forEach((button) => {
      button.addEventListener('click', () => openTrend(button.dataset.trendId || ''));
    });
    dom.table.querySelectorAll('[data-program-detail-id]').forEach((button) => {
      button.addEventListener('click', () => openProgramDetail(button.dataset.programDetailId || '', button.dataset.programDetailTitle || button.textContent || ''));
    });
"""
render_event_new = """    dom.table.querySelectorAll('[data-trend-id]').forEach((button) => {
      button.addEventListener('click', () => openTrend(button.dataset.trendId || ''));
    });
    dom.table.querySelectorAll('[data-group-detail-id]').forEach((button) => {
      button.addEventListener('click', () => openGroupDetail(button.dataset.groupDetailId || '', button.dataset.groupDetailMode || 'all'));
    });
    dom.table.querySelectorAll('[data-program-detail-id]').forEach((button) => {
      button.addEventListener('click', () => openProgramDetail(button.dataset.programDetailId || '', button.dataset.programDetailTitle || button.textContent || ''));
    });
"""
js = replace_once(js, render_event_old, render_event_new, 'group detail event binding')

close_anchor = """  function closeProgramDetail() {
    dom.programModal.classList.add('hidden');
    dom.programModalBody.innerHTML = '';
  }
"""
close_extra = close_anchor + """

  function openGroupDetail(id = '', mode = 'all') {
    const row = state.groupDetailRows.get(id);
    if (!row) return;
    const records = Array.isArray(row.records) ? [...row.records] : [];
    const zeroCount = records.filter((record) => Number(record.dollars || 0) === 0).length;
    const outlierCount = Number(row.outlierCount || 0);
    const sortedRecords = records.sort((a, b) => {
      if (mode === 'outliers') {
        const aFlagged = outlierStatusForRecord(row, a) ? 1 : 0;
        const bFlagged = outlierStatusForRecord(row, b) ? 1 : 0;
        if (aFlagged !== bFlagged) return bFlagged - aFlagged;
      }
      const aTime = a.date instanceof Date && !Number.isNaN(a.date.getTime()) ? a.date.getTime() : 0;
      const bTime = b.date instanceof Date && !Number.isNaN(b.date.getTime()) ? b.date.getTime() : 0;
      return bTime - aTime || Number(b.dollars || 0) - Number(a.dollars || 0);
    });
    const lens = state.question === 'secondaryTopics' ? 'Secondary topic' : 'Topic';
    dom.programModalTitle.textContent = `${row.title || lens} · ${lens} detail`;
    dom.programModalSubtitle.textContent = `${formatNumber(records.length)} airing(s) · Median ${formatMoney(row.median || 0)} · Average ${formatMoney(row.avg || 0)} · Total ${formatMoney(row.dollars || 0)}`;
    const detailRows = sortedRecords.map((record) => {
      const status = outlierStatusForRecord(row, record);
      const date = record.date instanceof Date && !Number.isNaN(record.date.getTime()) ? record.date.toLocaleDateString() : (record.dateKey || '—');
      const start = Number.isFinite(Number(record.startMinutes)) ? formatTimeFromMinutes(record.startMinutes) : '—';
      return `<tr class=\"${status ? 'outlier-row' : ''}\"><td>${escapeHtml(date)}</td><td>${escapeHtml(record.fundraiser || record.seasonYear || '—')}</td><td>${escapeHtml(record.title || record.importedTitle || '—')}</td><td>${escapeHtml(start)}</td><td class=\"analytics-left\">${formatMoney(record.dollars || 0)}</td><td class=\"analytics-left\">${formatNumber(record.pledges || 0)}</td><td>${status ? `<span class=\"risk\">${escapeHtml(status)}</span>` : '—'}</td></tr>`;
    }).join('');
    dom.programModalBody.innerHTML = `
      <div class=\"program-detail-summary\">
        <div class=\"stat\"><div class=\"v\">${formatMoney(row.median || 0)}</div><div>Median / airing</div></div>
        <div class=\"stat\"><div class=\"v\">${formatMoney(row.avg || 0)}</div><div>Average / airing</div></div>
        <div class=\"stat\"><div class=\"v\">${formatNumber(records.length)}</div><div>Airings</div></div>
        <div class=\"stat\"><div class=\"v\">${formatNumber(outlierCount)}</div><div>Outliers</div></div>
        <div class=\"stat\"><div class=\"v\">${formatNumber(zeroCount)}</div><div>Zero-$ airings</div></div>
      </div>
      <div class=\"program-detail-table-wrap\"><table><thead><tr><th>Date</th><th>Fundraiser</th><th>Program</th><th>Start</th><th>Dollars</th><th>Pledges</th><th>Outlier status</th></tr></thead><tbody>${detailRows || '<tr><td colspan=\"7\">No airing detail is available.</td></tr>'}</tbody></table></div>
      <div class=\"program-detail-note\">${mode === 'outliers' ? 'Flagged outliers are listed first. ' : ''}Outlier flags use Median Absolute Deviation. No airing is removed or discounted from the Median, Average, or Total shown here.</div>`;
    dom.programModal.classList.remove('hidden');
  }
"""
js = replace_once(js, close_anchor, close_extra, 'group detail modal')

js = replace_once(js, "    state.trendRows.clear();\n", "    state.trendRows.clear();\n    state.groupDetailRows.clear();\n", 'clear group detail map')

topic_overview_old = """      columns: [
        ['Topic', (row) => labelWithMixCell(row), '', (row) => row.title],
        ['Median / airing', (row) => formatMoney(row.median), 'money emphasis', (row) => row.median],
        ['Avg / airing', (row) => formatMoney(row.avg), 'money', (row) => row.avg],
        ['Outliers', (row) => escapeHtml(outlierLabel(row)), '', (row) => row.outlierCount || 0],
        ['Total $', (row) => formatMoney(row.dollars), 'money', (row) => row.dollars],
        ['Pledges', (row) => formatNumber(row.pledges), 'num', (row) => row.pledges],
        ['Broadcasts', (row) => formatNumber(row.broadcasts), 'num', (row) => row.broadcasts],
        ['Season mix', (row) => escapeHtml(row.mix), '', (row) => row.seasons || 0]
      ]
"""
topic_overview_new = """      columns: [
        ['Topic', (row) => groupTitleDetailCell(row), 'analytics-left', (row) => row.title],
        ['Median / airing', (row) => formatMoney(row.median), 'money emphasis analytics-left', (row) => row.median],
        ['Avg / airing', (row) => formatMoney(row.avg), 'money analytics-left', (row) => row.avg],
        ['Outliers', (row) => groupOutlierDetailCell(row), 'analytics-left', (row) => row.outlierCount || 0],
        ['Total $', (row) => formatMoney(row.dollars), 'money analytics-left', (row) => row.dollars],
        ['Pledges', (row) => formatNumber(row.pledges), 'num analytics-left', (row) => row.pledges],
        ['Broadcasts', (row) => formatNumber(row.broadcasts), 'num analytics-left', (row) => row.broadcasts],
        ['Season mix', (row) => escapeHtml(row.mix), 'analytics-left', (row) => row.seasons || 0]
      ]
"""
js = replace_once(js, topic_overview_old, topic_overview_new, 'topic overview columns')

topic_old = """      columns: [
        ['Topic', (row) => labelWithMixCell(row), '', (row) => row.title],
        ['Median / airing', (row) => formatMoney(row.median), 'money emphasis', (row) => row.median],
        ['Avg / airing', (row) => formatMoney(row.avg), 'money', (row) => row.avg],
        ['Outliers', (row) => escapeHtml(outlierLabel(row)), '', (row) => row.outlierCount || 0],
        ['Total $', (row) => formatMoney(row.dollars), 'money', (row) => row.dollars],
        ['Broadcasts', (row) => formatNumber(row.broadcasts), 'num', (row) => row.broadcasts],
        ['Season mix', (row) => escapeHtml(row.mix), '', (row) => row.seasons || 0]
      ]
"""
topic_new = """      columns: [
        ['Topic', (row) => groupTitleDetailCell(row), 'analytics-left', (row) => row.title],
        ['Median / airing', (row) => formatMoney(row.median), 'money emphasis analytics-left', (row) => row.median],
        ['Avg / airing', (row) => formatMoney(row.avg), 'money analytics-left', (row) => row.avg],
        ['Outliers', (row) => groupOutlierDetailCell(row), 'analytics-left', (row) => row.outlierCount || 0],
        ['Total $', (row) => formatMoney(row.dollars), 'money analytics-left', (row) => row.dollars],
        ['Broadcasts', (row) => formatNumber(row.broadcasts), 'num analytics-left', (row) => row.broadcasts],
        ['Season mix', (row) => escapeHtml(row.mix), 'analytics-left', (row) => row.seasons || 0]
      ]
"""
# This block occurs once for primary Topics.
js = replace_once(js, topic_old, topic_new, 'primary topic columns')

secondary_old = """      columns: [
        ['Secondary topic', (row) => labelWithMixCell(row), '', (row) => row.title],
        ['Median / airing', (row) => formatMoney(row.median), 'money emphasis', (row) => row.median],
        ['Avg / airing', (row) => formatMoney(row.avg), 'money', (row) => row.avg],
        ['Outliers', (row) => escapeHtml(outlierLabel(row)), '', (row) => row.outlierCount || 0],
        ['Total $', (row) => formatMoney(row.dollars), 'money', (row) => row.dollars],
        ['Broadcasts', (row) => formatNumber(row.broadcasts), 'num', (row) => row.broadcasts],
        ['Season mix', (row) => escapeHtml(row.mix), '', (row) => row.seasons || 0]
      ]
"""
secondary_new = """      columns: [
        ['Secondary topic', (row) => groupTitleDetailCell(row), 'analytics-left', (row) => row.title],
        ['Median / airing', (row) => formatMoney(row.median), 'money emphasis analytics-left', (row) => row.median],
        ['Avg / airing', (row) => formatMoney(row.avg), 'money analytics-left', (row) => row.avg],
        ['Outliers', (row) => groupOutlierDetailCell(row), 'analytics-left', (row) => row.outlierCount || 0],
        ['Total $', (row) => formatMoney(row.dollars), 'money analytics-left', (row) => row.dollars],
        ['Broadcasts', (row) => formatNumber(row.broadcasts), 'num analytics-left', (row) => row.broadcasts],
        ['Season mix', (row) => escapeHtml(row.mix), 'analytics-left', (row) => row.seasons || 0]
      ]
"""
js = replace_once(js, secondary_old, secondary_new, 'secondary topic columns')

js_path.write_text(js, encoding='utf-8')

html_path = ROOT / 'assets/analytics-workspace.html'
html = html_path.read_text(encoding='utf-8')
html = replace_once(
    html,
    "    .money, .num { text-align: right; white-space: nowrap; }\n",
    "    .money, .num { text-align: right; white-space: nowrap; }\n    .analytics-left { text-align: left !important; }\n    .analytics-detail-link { border: 0; border-radius: 0; padding: 0; background: transparent; color: var(--accent-2); font-weight: 900; text-decoration: underline; text-underline-offset: 2px; text-align: left; display: inline-grid; gap: 2px; }\n    .analytics-detail-link:hover { color: var(--accent); }\n    .analytics-detail-link.outlier-link { color: var(--bad); display: inline; }\n    .outlier-row { background: #fff8e8; }\n",
    'analytics detail styles'
)
html = replace_once(html, '<div class="eyebrow">Program detail</div>', '<div class="eyebrow">Analytics detail</div>', 'modal eyebrow')
html_path.write_text(html, encoding='utf-8')

test_path = ROOT / 'tests/performance-analytics.test.mjs'
test = test_path.read_text(encoding='utf-8')
test += """

test('topic analytics exposes clickable topic and outlier drilldown controls', () => {
  const text = fs.readFileSync(sourcePath, 'utf8');
  assert.match(text, /groupTitleDetailCell/);
  assert.match(text, /groupOutlierDetailCell/);
  assert.match(text, /data-group-detail-id/);
  assert.match(text, /openGroupDetail/);
});

test('topic analytics columns explicitly opt into left alignment', () => {
  const text = fs.readFileSync(sourcePath, 'utf8');
  assert.match(text, /Median \/ airing'[^\n]+analytics-left/);
  assert.match(text, /Outliers'[^\n]+analytics-left/);
  const workspace = fs.readFileSync(new URL('../assets/analytics-workspace.html', import.meta.url), 'utf8');
  assert.match(workspace, /\.analytics-left \{ text-align: left !important; \}/);
});
"""
test_path.write_text(test, encoding='utf-8')

version_path = ROOT / 'version.json'
version = json.loads(version_path.read_text(encoding='utf-8'))
version['appVersion'] = '0.22.93'
version['releasedAt'] = '2026-08-24'
version_path.write_text(json.dumps(version, separators=(',', ':')) + '\n', encoding='utf-8')

print('v0.22.93 topic drilldown patch applied')
