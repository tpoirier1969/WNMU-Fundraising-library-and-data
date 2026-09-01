from pathlib import Path
import re

root = Path('.')

def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 occurrence, found {count}')
    print(f'OK {label}')
    return text.replace(old, new, 1)

# historicalSeasonRanking is already the season-only path, so it does not need
# a generic dimension check. Use all Broadcast dollars and saved pledge hours.
p = root / 'assets/js/one-sheet-analysis.js'
s = p.read_text()
s = replace_once(
    s,
    """      const rateMinutes = dimension === 'season'
        ? (Number(analysis?.scheduledMinutes || 0) || scheduledRows.reduce((sum, row) => sum + Number(row.minutes || 0), 0))
        : scheduledRows.reduce((sum, row) => sum + Number(row.minutes || 0), 0);
      const attributableDollars = scheduledRows.reduce((sum, row) => sum + Number(row.dollars || 0), 0);
      const rateDollars = dimension === 'season'
        ? (Number(analysis?.broadcastDollars || 0) || attributableDollars)
        : attributableDollars;
""",
    """      const rateMinutes = Number(analysis?.scheduledMinutes || 0)
        || scheduledRows.reduce((sum, row) => sum + Number(row.minutes || 0), 0);
      const attributableDollars = scheduledRows.reduce((sum, row) => sum + Number(row.dollars || 0), 0);
      const rateDollars = Number(analysis?.broadcastDollars || 0) || attributableDollars;
""",
    'season-only rate variables'
)
p.write_text(s)

# Keep Comparison Lab's established imported-history fallback. Its job is to
# recover historical imported dates when a saved range is stale; changing that
# caused unrelated comparison regressions. The short-range isolation fix belongs
# in Performance Analytics, where the audit found the ownership problem.
p = root / 'assets/js/ui-fundraiser-comparison.js'
s = p.read_text()
pattern = re.compile(r"function importedRowsForSchedule\(schedule = \{\}\) \{.*?\n\}\n\nfunction importedUseKey", re.S)
replacement = """function importedRowsForSchedule(schedule = {}) {
  const start = text(schedule.startDate || schedule.start_date || '');
  const end = text(schedule.endDate || schedule.end_date || '');
  if (start && end) {
    const exact = (state.airings || []).filter((row) =>
      text(row.drive_start_date || '').slice(0, 10) === start
      && text(row.drive_end_date || '').slice(0, 10) === end
    );
    if (exact.length) return exact;
  }
  const identity = scheduleSeasonYear(schedule);
  if (!identity.season || !identity.year) return [];
  return (state.airings || []).filter((row) => {
    const date = parseDate(importedDateKey(row));
    return Boolean(date && seasonForDate(date) === identity.season && date.getFullYear() === identity.year);
  });
}

function importedUseKey"""
s, count = pattern.subn(replacement, s, count=1)
if count != 1:
    raise RuntimeError(f'comparison fallback restore: expected 1 occurrence, found {count}')
print('OK comparison fallback restore')
p.write_text(s)

# Narrow the new regression to the surface actually being repaired.
p = root / 'tests/analytics-consistency-v127.test.mjs'
s = p.read_text()
s = s.replace("const comparison = fs.readFileSync(new URL('../assets/js/ui-fundraiser-comparison.js', import.meta.url), 'utf8');\n", '')
s = s.replace("test('short fundraiser ownership falls back to saved date range, not whole pledge season', () => {\n  const perfFn = analytics.match(/function airingRecordsForSchedule\\([\\s\\S]*?\\n  \\}/)?.[0] || '';\n  assert.match(perfFn, /key >= start && key <= end/);\n  assert.doesNotMatch(perfFn, /record\\.season === season/);\n  const comparisonFn = comparison.match(/function importedRowsForSchedule\\([\\s\\S]*?\\n\\}/)?.[0] || '';\n  assert.match(comparisonFn, /key >= start && key <= end/);\n  assert.doesNotMatch(comparisonFn, /seasonForDate\\(date\\)/);\n});\n", "test('Performance Analytics short fundraiser ownership falls back to saved date range, not whole pledge season', () => {\n  const perfFn = analytics.match(/function airingRecordsForSchedule\\([\\s\\S]*?\\n  \\}/)?.[0] || '';\n  assert.match(perfFn, /key >= start && key <= end/);\n  assert.doesNotMatch(perfFn, /record\\.season === season/);\n});\n")
p.write_text(s)
print('OK focused ownership regression')
