from pathlib import Path

p = Path('assets/js/one-sheet-reports.js')
s = p.read_text()
old = 'Whole-fundraiser Broadcast $/pledge hour uses all Broadcast dollars over saved pledge hours. Program/topic $/hour excludes unknown results, Non-Specific Pledges, and airings with missing duration from both numerator and denominator; Rate-eligible hours show that program-attributed denominator. Non-Specific Pledges remain in factual Broadcast totals.'
new = 'Whole-fundraiser Broadcast $/pledge hour uses all Broadcast dollars over saved pledge hours. Program/topic $/hour excludes unknown results and airings with missing duration from both numerator and denominator; Non-Specific Pledges are also excluded from program/topic attribution but remain in factual Broadcast totals. Rate-eligible hours show the program-attributed denominator.'
if s.count(old) != 1:
    raise RuntimeError(f'rate-definition wording: expected 1 occurrence, found {s.count(old)}')
p.write_text(s.replace(old, new, 1))
print('OK rate-definition regression wording')
