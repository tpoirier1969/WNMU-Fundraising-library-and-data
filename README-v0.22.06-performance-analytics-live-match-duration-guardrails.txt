v0.22.07

Performance Analytics live-break 1:1 comparison guardrails.

Changes:
- Adds program length/duration compatibility to live vs non-live 1:1 matching.
- Prevents 3-hour programs from being compared to 30-minute programs.
- Tightens performer/music-title matching so broad series labels like Great Performances do not make unrelated performers look comparable.
- Rejects same-title/same-dollar clone-risk matches when source hashes are missing or reused.
- Keeps good comparisons when topic/daypart/weekpart/duration/title evidence is strong.
- Adds duration and clearer no-match reasons in the comparison table.

No real config.js is included.
