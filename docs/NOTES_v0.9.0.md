# Notes for v0.9.0

## New workspace shell

The app now has a simple workspace framework so future tools do not have to be crammed into the main library page.

### Live now
- Library

### Scaffolded now
- Versions & Timing
- Performance
- Import Tools
- Reports
- Admin

These scaffolded sections are present as UI structure and launch points only. Their buttons intentionally surface status text instead of pretending the feature exists.

## Metadata supplementation changes

Summary-view rows are now supplemented from the base table using multiple fallback match paths:

1. program id
2. NOLA
3. normalized title

Resolved values are written into internal helper fields:
- `__resolved_topic_primary`
- `__resolved_topic_secondary`
- `__resolved_distributor`

This keeps the render layer simpler and makes it easier to audit remaining field gaps.


Note: Workspace scaffold was narrowed to Library, Scheduling, and Performance in v0.9.0. Timing/break detail stays with the program record instead of living in a separate workspace.
