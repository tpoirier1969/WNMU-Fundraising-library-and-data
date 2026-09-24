# Premium Analytics checkpoint — 2026-09-24

Work paused here so Fundraiser Programming Strategy can take priority.

## Current production state
- Main branch version at pause: **0.22.194**
- Premium Analytics already includes:
  - exact premium/package economics
  - package-composition analysis
  - brand/source scope
  - charts and Premium Workhorse ranking
  - Premium Impact evidence framework that separates observation, association and causal claims
- Premium Impact deliberately treats premium-taking and no-premium donors as self-selected groups, not a causal control comparison.

## Historical-offer evidence work in progress
Unmerged working branch:
- `feature/premium-historical-evidence-loader-2026-09-24`

That branch contains a browser-local/private historical-offer evidence loader intended to:
- import dated PBS offer evidence from JSON
- override current-offer proxies with historically verified title/fundraiser/package relationships
- keep private email-derived evidence out of the public repository
- distinguish **different items selected by donors** from **an actually different offer set**

Important analytical correction already made in that branch:
- a same-title comparison counts as a changed premium offer only when dated evidence identifies different `offerSetId` values
- different donor selections in two fundraisers do **not** by themselves prove the station offered different packages

## Initial verified evidence batch
A private JSON evidence file was generated outside the repository:
- 11 fundraiser/title offer records
- 23 selected-premium mappings

Verified examples include:
- All Creatures Great and Small: Tricki & Friends
- All Creatures Great and Small: The Wisdom of the Dales
- Kris Kristofferson: Life & Songs
- All Creatures Great and Small: Chapter Five
- All Creatures Great and Small: Cheers to the Years!
- Mister Rogers: It's You I Like
- All Creatures Great and Small: Seasons of the Dales
- All Creatures Great and Small: Chapter Six

Repeated-title findings:
- **Kris Kristofferson: Life & Songs** appeared in March and June 2025 with the same verified PBS offer set.
- **Mister Rogers: It's You I Like** appeared in December 2025 and June 2026 with the same verified offer set.
- **Tricki & Friends** appeared in December 2024 and June 2026 with the same verified offer set.
- Therefore these are useful repeated-title cases, but not yet same-title/different-offer natural experiments.

## Older evidence discovered while digging
An **August 2015 WNMU pledge premium report** was found in email. It is an older report format and should not be mixed blindly with the 2024–26 premium-cost economics.

It does provide historical premium-selection evidence, including:
- Lawrence Welk Milestones & Memories print, CD and DVD
- John Sebastian Folk Rewind CD, DVD and 5-CD
- Downton Abbey 1–6 DVDs
- Simon & Garfunkel DVD/CD and 5-CD
- Il Volo CDs/DVD
- TV Day Sponsor
- multiple health-program premiums

This may create an approximately 11-year premium-history thread for some recurring titles, especially Lawrence Welk.

## Next premium steps when work resumes
1. Finish and test the historical-evidence loader branch before merging.
2. Continue mining older pledge reports and PBS/Pledgechat offer emails for repeated titles.
3. Prioritize true **same title + multiple fundraisers + verified different offer sets**.
4. Keep older incompatible report formats as evidence unless/until a defensible normalization is designed.
5. Do not turn premium association into an estimated causal lift without a valid counterfactual or controlled test.
