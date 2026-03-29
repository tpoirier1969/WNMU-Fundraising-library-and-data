# WNMU Pledge Program Library v0.18.4

- Rebuilt live-break analytics to classify imported airings from matched scheduler placements instead of defaulting everything to no live breaks.
- Added explicit Unknown / not matched to schedule bucket for imported airings that cannot be matched to a scheduled placement.
- Renamed performance stat labels to read more clearly: Programs represented, Airings with dollars / dates.
- Performance stats now count distinct programs more reliably using program id / NOLA / title fallback rather than raw title only.
