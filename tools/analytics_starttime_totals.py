from pathlib import Path
import json
import re


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


def regex_once(path: Path, pattern: str, replacement: str, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    path.write_text(updated, encoding="utf-8")


analytics = Path("pledge-performance-lab-shell.html")
scheduler = Path("assets/js/ui-scheduling.js")
styles = Path("assets/styles.css")
version = Path("version.json")

# ---------------------------------------------------------------------------
# Analytics: explain season-mix shorthand.
# ---------------------------------------------------------------------------
replace_once(
    analytics,
    '''    .scope-note { flex: 1 1 100%; color: var(--muted); font-size: .9rem; }\n    .cohort-note {''',
    '''    .scope-note { flex: 1 1 100%; color: var(--muted); font-size: .9rem; }\n    .season-mix-key { margin-top: 6px; }\n    .cohort-note {''',
    "season mix key style",
)

regex_once(
    analytics,
    r"  function setScopeNote\(message = ''\) \{.*?\n  \}\n\n  function formatMoney",
    '''  function setScopeNote(message = '') {
    if (!dom.scopeNote) return;
    const cohort = cohortScopePrefix();
    const messageHtml = message ? escapeHtml(message) : '';
    const seasonMixKey = '<div class="season-mix-key"><strong>Season mix key:</strong> M = March · J = June · A = August · D = December. The number after each letter is the number of airings in that pledge season. Example: [M-0, J-0, A-1, D-0] means one August airing and none in the other three seasons.</div>';
    dom.scopeNote.innerHTML = `${cohort}${cohort && messageHtml ? '<div style="margin-top:6px"></div>' : ''}${messageHtml}${seasonMixKey}`;
    dom.scopeNote.querySelector('#clear-cohort')?.addEventListener('click', clearAnalyticsCohort);
  }

  function formatMoney''',
    "season mix key rendering",
)

# ---------------------------------------------------------------------------
# Analytics math: a completed $0 broadcast is still an airing. The old filter
# discarded those rows, inflating per-airing averages and medians.
# ---------------------------------------------------------------------------
replace_once(
    analytics,
    '''    }).filter((record) => record.date && record.dollars > 0 && record.season);''',
    '''    }).filter((record) => record.date && Number.isFinite(Number(record.dollars)) && Number(record.dollars) >= 0 && record.season);''',
    "retain zero-dollar imported airings",
)

regex_once(
    analytics,
    r"        const canUseMatchedDollars = matchedDollarKey \? !usedAiringDollarMatches\.has\(matchedDollarKey\) : Boolean\(matched\);\n        const dollars = Number\(firstNonEmpty\(\n          explicitDollars,\n          canUseMatchedDollars \? matched\?\.dollars : null,\n          0\n        \) \|\| 0\);\n        const pledges = Number\(firstNonEmpty\(\n          explicitPledges,\n          canUseMatchedDollars \? matched\?\.pledges : null,\n          0\n        \) \|\| 0\);\n        if \(matchedDollarKey && explicitDollars == null && dollars > 0\) usedAiringDollarMatches\.add\(matchedDollarKey\);\n        if \(!\(dollars > 0\)\) return;",
    '''        const canUseMatchedDollars = matchedDollarKey ? !usedAiringDollarMatches.has(matchedDollarKey) : Boolean(matched);
        const resultKnown = explicitDollars != null || Boolean(canUseMatchedDollars && matched);
        const dollars = Number(firstNonEmpty(
          explicitDollars,
          canUseMatchedDollars ? matched?.dollars : null,
          0
        ) || 0);
        const pledges = Number(firstNonEmpty(
          explicitPledges,
          canUseMatchedDollars ? matched?.pledges : null,
          0
        ) || 0);
        if (matchedDollarKey && explicitDollars == null && canUseMatchedDollars && matched) usedAiringDollarMatches.add(matchedDollarKey);
        if (!resultKnown) return;''',
    "retain known zero-dollar scheduled results",
)

# Start-time ranking previously stayed in clock order even while the heading
# claimed the rows were ranked by the selected metric. Make the selected metric
# authoritative, and make the explanatory readout agree with it.
regex_once(
    analytics,
    r"  function startTimeRead\(rows = \[\]\) \{.*?\n  \}\n\n  function rowsStartTimes\(\) \{.*?\n  \}\n\n  function rowsPrograms\(\) \{",
    '''  function startTimeRead(rows = []) {
    if (!rows.length) return 'No start-time records match the current filters.';
    const useful = rows.filter((row) => Number(row.broadcasts || 0) >= 3);
    const bestUseful = useful[0] || rows[0];
    return `Start-time performance is grouped in <b>30-minute start buckets</b>, not rounded to the hour. Completed <b>$0 broadcasts still count as airings</b>, so median and average dollars per airing use the real denominator.<br><br>Current rank: <b>${escapeHtml(metricLabel())}</b>. Best current bucket with useful sample size: <b>${escapeHtml(bestUseful.title)}</b> at <b>${formatMetricValue(bestUseful)}</b>; median <b>${formatMoney(bestUseful.median || 0)}</b>, average <b>${formatMoney(bestUseful.avg || 0)}</b>, total <b>${formatMoney(bestUseful.dollars || 0)}</b>, across <b>${formatNumber(bestUseful.broadcasts || 0)}</b> airing(s).<br><br>Use Pledge season = March/June/August/December, plus Primary and Secondary topic, to test specific arguments like <b>August Music at 8:00 vs 9:30 vs 10:30</b>, or afternoon blocks like <b>1:00 vs 3:00</b>.`;
  }

  function rowsStartTimes() {
    return applyEvidence([...groupBy(filteredRecordsFor('startTimes'), startTimeLabel)]
      .map(([title, records]) => {
        const row = summarizeGroup(title, records);
        row.startMinutes = records.map((record) => Number(record.startMinutes)).filter((value) => Number.isFinite(value)).sort((a, b) => a - b)[0];
        return row;
      })
      .filter((row) => row.title !== 'Unknown start time')
      .sort((a, b) => metricValue(b) - metricValue(a) || startTimeSortKey(a) - startTimeSortKey(b)));
  }

  function rowsPrograms() {''',
    "start-time metric ranking",
)

replace_once(
    analytics,
    "      graphTitle: 'Start time buckets by median dollars per airing',",
    "      graphTitle: 'Start time buckets',",
    "start-time graph title",
)
replace_once(
    analytics,
    "      tableNote: 'Grouped in exact 30-minute start buckets. Use Pledge season plus Primary/Secondary topic to test March, June, August, or December scheduling arguments. Rights and title filters are intentionally not part of this view.',",
    "      tableNote: 'Grouped in exact 30-minute start buckets. Completed $0 broadcasts count as airings and remain in median/average denominators. Use Pledge season plus Primary/Secondary topic to test March, June, August, or December scheduling arguments. Rights and title filters are intentionally not part of this view.',",
    "start-time table math note",
)
replace_once(
    analytics,
    "      metric: (rows) => rows[0] ? formatMoney(rows[0].median || 0) : '—',",
    "      metric: (rows) => rows[0] ? formatMetricValue(rows[0]) : '—',",
    "start-time selected metric summary",
)

# ---------------------------------------------------------------------------
# Scheduler: aggregate program-specific broadcast proceeds by 30-minute start
# bucket across the loaded fundraiser. Include imported $0 rows and manual
# results, but exclude the non-specific pledge bucket.
# ---------------------------------------------------------------------------
replace_once(
    scheduler,
    '''\n  function schedulePartialOnlineMailTotal''',
    '''
  function scheduleStartBucketMoneyMap(schedule = {}, importedRows = []) {
    const result = new Map();
    const add = (minutesValue, dollarsValue) => {
      const minutes = Number(minutesValue);
      if (!Number.isFinite(minutes)) return;
      const normalized = ((minutes % 1440) + 1440) % 1440;
      const bucket = Math.floor(normalized / constants.DEFAULT_SLOT_MINUTES) * constants.DEFAULT_SLOT_MINUTES;
      const current = result.get(bucket) || { dollars: 0, starts: 0 };
      current.dollars += Number(dollarsValue || 0) || 0;
      current.starts += 1;
      result.set(bucket, current);
    };

    importedRowsForSchedule(schedule, importedRows).forEach((row) => {
      if (importedRowIsNonSpecific(row)) return;
      const minutes = importedRowStartMinutes(row);
      if (!Number.isFinite(minutes)) return;
      add(minutes, Number(row?.dollars || 0) || 0);
    });

    (schedule?.placements || []).forEach((placement) => {
      if (!placementHasManualResult(placement)) return;
      add(placement?.startMinutes, placementManualResultDollars(placement));
    });

    return result;
  }

  function schedulePartialOnlineMailTotal''',
    "scheduler start-bucket money helper",
)

replace_once(
    scheduler,
    '''    const dailyMoney = scheduleDailyMoneyMap(schedule, importedRows);\n    renderSameFundraiserComparison(schedule, importedRows, importedRowsReady);''',
    '''    const dailyMoney = scheduleDailyMoneyMap(schedule, importedRows);
    const startBucketMoney = scheduleStartBucketMoneyMap(schedule, importedRows);
    renderSameFundraiserComparison(schedule, importedRows, importedRowsReady);''',
    "scheduler start-bucket map load",
)

replace_once(
    scheduler,
    '''      const normalizedMinutes = ((minutes % 1440) + 1440) % 1440;\n      const isHighlightedRow = Number(state.scheduleHighlightedRowMinutes) === minutes;\n      const showTimeLabel = isHighlightedRow || !compactTimeLabels || (ultraCompactTimeLabels ? (normalizedMinutes % 120 === 0) : (normalizedMinutes % 60 === 0));\n      const guideClass = guideMinutes.has(minutes) || guideMinutes.has(normalizedMinutes) ? ' guide-line-red' : '';\n      const rowHighlightClass = isHighlightedRow ? ' row-highlighted' : '';\n      const timeLabel = utils.minutesToLabel(minutes);\n      const timeLabelHelp = isHighlightedRow ? `Clear ${timeLabel} row highlight` : `Highlight ${timeLabel} row across the calendar`;\n      body.push(`<button type="button" class="schedule-time-label ${showTimeLabel ? '' : 'quiet'}${guideClass}${rowHighlightClass}" data-schedule-row-minutes="${minutes}" aria-pressed="${isHighlightedRow ? 'true' : 'false'}" aria-label="${utils.escapeHtml(timeLabelHelp)}" title="${utils.escapeHtml(timeLabelHelp)}"><span>${showTimeLabel ? utils.escapeHtml(timeLabel) : ''}</span></button>`);''',
    '''      const normalizedMinutes = ((minutes % 1440) + 1440) % 1440;
      const rowMoney = startBucketMoney.get(normalizedMinutes) || null;
      const hasRowMoney = Boolean(rowMoney && Number(rowMoney.starts || 0) > 0);
      const isHighlightedRow = Number(state.scheduleHighlightedRowMinutes) === minutes;
      const showTimeLabel = isHighlightedRow || hasRowMoney || !compactTimeLabels || (ultraCompactTimeLabels ? (normalizedMinutes % 120 === 0) : (normalizedMinutes % 60 === 0));
      const guideClass = guideMinutes.has(minutes) || guideMinutes.has(normalizedMinutes) ? ' guide-line-red' : '';
      const rowHighlightClass = isHighlightedRow ? ' row-highlighted' : '';
      const timeLabel = utils.minutesToLabel(minutes);
      const timeLabelHelp = isHighlightedRow ? `Clear ${timeLabel} row highlight` : `Highlight ${timeLabel} row across the calendar`;
      const rowMoneyTitle = hasRowMoney
        ? `${utils.formatCount(rowMoney.starts)} program${Number(rowMoney.starts) === 1 ? '' : 's'} started in this 30-minute bucket; broadcast proceeds ${utils.formatMoney(rowMoney.dollars)}`
        : '';
      const rowMoneyHtml = hasRowMoney
        ? `<span class="schedule-time-row-total" title="${utils.escapeHtml(rowMoneyTitle)}">${utils.escapeHtml(utils.formatMoney(rowMoney.dollars))}</span>`
        : '';
      body.push(`<button type="button" class="schedule-time-label ${showTimeLabel ? '' : 'quiet'}${guideClass}${rowHighlightClass}" data-schedule-row-minutes="${minutes}" aria-pressed="${isHighlightedRow ? 'true' : 'false'}" aria-label="${utils.escapeHtml(timeLabelHelp)}" title="${utils.escapeHtml(timeLabelHelp)}"><span><span class="schedule-time-clock">${showTimeLabel ? utils.escapeHtml(timeLabel) : ''}</span>${rowMoneyHtml}</span></button>`);''',
    "scheduler start-bucket row total render",
)

replace_once(
    styles,
    '''.schedule-time-label > span {\n  position: absolute;\n  left: 8px;\n  top: 0;\n  line-height: 1;\n  white-space: nowrap;\n}\n.schedule-time-label.quiet > span { display: none; }''',
    '''.schedule-time-label > span {
  position: absolute;
  left: 8px;
  top: 0;
  line-height: 1;
  white-space: nowrap;
  display: flex;
  align-items: baseline;
  gap: 4px;
}
.schedule-time-clock { white-space: nowrap; }
.schedule-time-row-total {
  color: var(--teal-dark);
  font-size: .66rem;
  font-weight: 900;
  letter-spacing: -.01em;
  white-space: nowrap;
}
.schedule-time-label.quiet > span { display: none; }''',
    "scheduler row-total styling",
)

# Version changes in one place only.
version_payload = json.loads(version.read_text(encoding="utf-8"))
if version_payload.get("appVersion") != "0.22.71":
    raise SystemExit(f"unexpected starting version: {version_payload.get('appVersion')}")
version_payload["appVersion"] = "0.22.72"
version_payload["releasedAt"] = "2026-08-19"
version.write_text(json.dumps(version_payload, separators=(",", ":")) + "\n", encoding="utf-8")
