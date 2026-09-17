import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('assets/js/program-fundraiser-season-focus.js', 'utf8');

test('older Drama Docs receive a real score penalty and context ceiling', () => {
  assert.match(source, /const OLD_DRAMA_PENALTY = 10;/);
  assert.match(source, /const CONTEXT_CHECK_MAX_SCORE = 47;/);
  assert.match(source, /if \(oldDrama\) \{[\s\S]*?score = Math\.max\(0, score - OLD_DRAMA_PENALTY\)/);
  assert.match(source, /if \(oldDrama && !oldDramaException\) \{[\s\S]*?score = Math\.min\(score, CONTEXT_CHECK_MAX_SCORE\)/);
  assert.match(source, /outlook: 'Context check first'/);
});

test('programmer promising or must-air ratings can overcome the automatic context tier', () => {
  assert.match(source, /\['promising', 'must_air'\]\.includes\(programmerRating\)/);
});

test('outlook evaluation does not use testing instructions as recommendations', () => {
  assert.doesNotMatch(source, /outlook\s*=\s*['"](?:Low confidence · )?Needs another prime test/);
  assert.doesNotMatch(source, /outlook\s*=\s*['"]Limited evidence/);
});
