import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const readJson = (file) => JSON.parse(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));

test('generic release manifest explicitly excludes live station configuration', () => {
  const manifest = readJson('productization/generic-release-manifest.json');
  assert.equal(manifest.releaseMode, 'copy-only');
  assert.ok(Array.isArray(manifest.neverCopy));
  assert.ok(manifest.neverCopy.includes('config.js'));
  assert.ok(!manifest.copy.includes('config.js'));
});

test('generic release manifest excludes known WNMU-only and legacy artifacts', () => {
  const manifest = readJson('productization/generic-release-manifest.json');
  const neverCopy = new Set(manifest.neverCopy);
  assert.ok(neverCopy.has('WNMU-TV-logo-head2019.png'));
  assert.ok(neverCopy.has('assets/WNMU-TV-logo-head2019.png'));
  assert.ok(neverCopy.has('trace40/**'));
  assert.ok(neverCopy.has('WNMU-Pledge-Program-Library-v0.18.0-import-fix/**'));
  assert.ok(neverCopy.has('README.txt'));
  assert.ok(neverCopy.has('supabase-setup.sql'));
  assert.ok(neverCopy.has('manifest.webmanifest'));
});

test('station configuration example contains no WNMU identity or concrete Supabase project URL', () => {
  const text = fs.readFileSync(new URL('../productization/station-config.example.json', import.meta.url), 'utf8');
  assert.doesNotMatch(text, /\bWNMU(?:-TV)?\b/i);
  assert.doesNotMatch(text, /https:\/\/[a-z0-9-]+\.supabase\.co/i);

  const config = JSON.parse(text);
  assert.equal(config.database.provider, 'supabase');
  assert.equal(config.distribution.includeDemoData, false);
  assert.ok(Array.isArray(config.authentication.adminEmails));
  assert.ok(config.authentication.adminEmails.length > 0, 'generic example should demonstrate an explicit administrator');
});

test('generic release policy includes privacy and contamination checks', () => {
  const manifest = readJson('productization/generic-release-manifest.json');
  const checks = new Set(manifest.requiredReleaseChecks);
  assert.ok(checks.has('no-live-config'));
  assert.ok(checks.has('no-concrete-supabase-project-url'));
  assert.ok(checks.has('no-production-data-or-database-dumps'));
  assert.ok(checks.has('no-unrelated-project-files'));
  assert.ok(checks.has('database-installer-built-from-productization-migrations-only'));
});
