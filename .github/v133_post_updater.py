from pathlib import Path

path = Path('assets/js/one-sheet-reports.js')
text = path.read_text()

old = "      values: ordered.map((analysis) => Number(metric(analysis) || 0))\n"
new = "      values: ordered.map((analysis) => Number(metric(analysis) || 0)),\n      tooltips: ordered.map((analysis) => fundraiserTooltip(analysis))\n"
if old not in text:
    raise SystemExit('post updater: trendSeriesForHistory target missing')
text = text.replace(old, new, 1)

old = """  function historicalSeasonTrendData(analyses = []) {
    const ordered = chronologicalAnalyses(analyses);
    const years = [...new Set(ordered.map((analysis) => Number(analysis.schedule?.year || 0)).filter(Boolean))].sort((a, b) => a - b);
    const seasons = HISTORICAL_SEASONS.filter((season) => ordered.some((analysis) => historicalSeasonBucket(analysis) === season));
    return {
      labels: years.map(String),
      series: seasons.map((season) => ({
        label: season,
        values: years.map((year) => {
          const values = ordered.filter((analysis) => Number(analysis.schedule?.year || 0) === year && historicalSeasonBucket(analysis) === season).map(rateForAnalysis).filter((value) => Number.isFinite(Number(value)));
          return values.length ? medianNumber(values) : null;
        })
      }))
    };
  }
"""
new = """  function historicalSeasonTrendData(analyses = []) {
    const ordered = chronologicalAnalyses(analyses);
    const years = [...new Set(ordered.map((analysis) => Number(analysis.schedule?.year || 0)).filter(Boolean))].sort((a, b) => a - b);
    const seasons = HISTORICAL_SEASONS.filter((season) => ordered.some((analysis) => historicalSeasonBucket(analysis) === season));
    return {
      labels: years.map(String),
      series: seasons.map((season) => ({
        label: season,
        values: years.map((year) => {
          const matches = ordered.filter((analysis) => Number(analysis.schedule?.year || 0) === year && historicalSeasonBucket(analysis) === season);
          const values = matches.map(rateForAnalysis).filter((value) => Number.isFinite(Number(value)));
          return values.length ? medianNumber(values) : null;
        }),
        tooltips: years.map((year) => {
          const matches = ordered.filter((analysis) => Number(analysis.schedule?.year || 0) === year && historicalSeasonBucket(analysis) === season);
          if (!matches.length) return null;
          return {
            title: `${season} ${year}`,
            detail: `${matches.length} fundraiser${matches.length === 1 ? '' : 's'} in this season/year point.`,
            lines: matches.flatMap((analysis) => programTooltipLinesForRows(analysis?.placementRows || []).map((line) => `${analysis.schedule?.title || analysisTrendLabel(analysis)}: ${line}`))
          };
        })
      }))
    };
  }
"""
if old not in text:
    raise SystemExit('post updater: historicalSeasonTrendData target missing')
text = text.replace(old, new, 1)

path.write_text(text)
