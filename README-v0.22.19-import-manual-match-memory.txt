WNMU Pledge Program Library v0.22.19

Import manual-match memory fix

Changed:
- Manual matches in the import review now default to being remembered.
- The import review checkbox now reads "Remember this match" and is checked by default.
- Applying a row/group match saves an import-title/NOLA mapping rule for future imports unless the checkbox is deliberately unchecked.
- Apply All and Create + link follow the same remembered-match behavior.

Scope:
- Rules are stored in the existing browser/app import-match rule store and reused by future imports on that installation.
- Exact NOLA-aware rules remain preferred. Broad generic imported titles with unmatched NOLA are still guarded from unsafe auto-matching.
