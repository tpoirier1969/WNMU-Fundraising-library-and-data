import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const pages = [
  'app-shell.html',
  'premium-analytics.html',
  'premium-report.html',
  'programming-strategy-backtest.html',
  'programming-strategy.html',
  'reports.html'
];

test('all browser surfaces pin the Supabase client version with the cross-tab refresh fix', () => {
  for (const page of pages) {
    const source = fs.readFileSync(page, 'utf8');
    assert.match(source, /@supabase\/supabase-js@2\.117\.2/);
    assert.doesNotMatch(source, /@supabase\/supabase-js@2(?=["/])/);
  }
});

test('explicit logout only signs out the current Supabase session', () => {
  const source = fs.readFileSync('assets/js/app.js', 'utf8');
  assert.match(source, /auth\.signOut\(\{ scope: 'local' \}\)/);
  assert.doesNotMatch(source, /auth\.signOut\(\)/);
});

test('browser auth still persists and auto-refreshes sessions', () => {
  const source = fs.readFileSync('assets/js/data.js', 'utf8');
  assert.match(source, /persistSession:\s*true/);
  assert.match(source, /autoRefreshToken:\s*true/);
  assert.match(source, /authOptions\.storage = window\.localStorage/);
});
