from pathlib import Path

p = Path('assets/js/one-sheet-reports.js')
s = p.read_text()
replacements = {
    "style: { stroke: '#f0c419', dash: '', width: 1.75 }": "style: { stroke: '#ff2020', dash: '', width: 2.8 }",
    "style: { stroke: '#ff2020', dash: '', width: 1.1 }": "style: { stroke: '#ff2020', dash: '9 4', width: 1.4 }",
    "The yellow line combines all selected years; the thin solid red least-squares line reports the long-term slope across fundraiser-day positions with R² in the legend.": "The bright red solid line combines all selected years; the dashed red least-squares trend line reports the long-term slope across fundraiser-day positions with R² in the legend.",
}
for old, new in replacements.items():
    if old not in s:
        raise SystemExit(f'missing report target: {old}')
    s = s.replace(old, new)
p.write_text(s)

# Update regression expectations for the intentional visual emphasis change.
for name in [
    'tests/chart-program-tooltips-trend-v134.test.mjs',
    'tests/comparison-eight-thinner-lines-v133.test.mjs',
]:
    t = Path(name)
    ts = t.read_text()
    ts = ts.replace("stroke: '#f0c419', dash: '', width: 1\\.75", "stroke: '#ff2020', dash: '', width: 2\\.8")
    ts = ts.replace("stroke: '#ff2020', dash: '', width: 1\\.1", "stroke: '#ff2020', dash: '9 4', width: 1\\.4")
    ts = ts.replace("style: \\{ stroke: '#f0c419', dash: '', width: 1\\.75 \\}", "style: \\{ stroke: '#ff2020', dash: '', width: 2\\.8 \\}")
    ts = ts.replace("style: \\{ stroke: '#ff2020', dash: '', width: 1\\.1 \\}", "style: \\{ stroke: '#ff2020', dash: '9 4', width: 1\\.4 \\}")
    ts = ts.replace("least-squares line reports the long-term slope", "dashed red least-squares trend line reports the long-term slope")
    t.write_text(ts)
