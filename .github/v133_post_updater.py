from pathlib import Path

path = Path('assets/js/one-sheet-reports.js')
text = path.read_text()
old = "      values: ordered.map((analysis) => Number(metric(analysis) || 0))\n"
new = "      values: ordered.map((analysis) => Number(metric(analysis) || 0)),\n      tooltips: ordered.map((analysis) => fundraiserTooltip(analysis))\n"
if old not in text:
    raise SystemExit('post updater: trendSeriesForHistory target missing')
path.write_text(text.replace(old, new, 1))
