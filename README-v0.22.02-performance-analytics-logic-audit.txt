WNMU Pledge Program Library v0.22.02

Performance Analytics logic-audit build.

Included:
- Season Overview no longer plots missing season/year combinations as $0. Missing data is left blank in the line graph.
- Season Overview detail table now shows one row per season/year with Broadcast, Online, Mail, Total, Pledges, Broadcasts, and Source.
- Duplicate same-date fundraiser schedules are merged instead of simply choosing one and discarding the rest. Manual money fields and imported placements are preserved where possible.
- Program-level analytics now group by stable program/library identity first, falling back to normalized title only when no ID exists.
- Metric-driven chart headings now state the selected Rank By metric.
- Each selected analytics question now displays its source-of-truth note in the detail header.

Future Live Break enhancement noted, not implemented in this audit build:
- Add a 1:1 live-break comparison that finds the closest non-live match by day, time, and primary topic. This is needed because live-break nights were intentionally scheduled for nights expected to perform well, so the current live-vs-nonlive aggregate is not a fair causal comparison.

Verified during build:
- JS syntax checks passed.
- Performance Analytics inline JS syntax passed.
- ZIP integrity passed.
- No real config.js included.
