WNMU Pledge Program Library v0.22.11

Live break comparison cleanup.

Changed:
- 1:1 live vs non-live comparison now lists only live-break airings with a strong comparable non-live airing.
- Live airings without a good comparison are counted in the summary but not listed as fake pairs.
- Saved non-live schedule placements are preferred. Historical imported non-live airing rows may be used only when they have no saved live flag and pass strict topic/daypart/weekpart/time/duration/title checks.
- Comparison rows identify whether the non-live candidate came from saved schedule data or historical imported airing data.

No real config.js included.
