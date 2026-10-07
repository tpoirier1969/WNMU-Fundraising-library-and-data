#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const strict = process.argv.includes('--strict');
const textExtensions = new Set(['.html', '.js', '.mjs', '.css', '.json', '.md', '.txt', '.sql', '.webmanifest', '.yml', '.yaml']);

function trackedFiles() {
  try {
    return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
      .split('\0')
      .filter(Boolean);
  } catch (error) {
    console.error('Could not read tracked files. Run this tool from a Git working tree.');
    process.exit(2);
  }
}

const files = trackedFiles();
const ignoredPrefixes = ['productization/'];
const legacyPrefixes = ['trace40/', 'WNMU-Pledge-Program-Library-v0.18.0-import-fix/'];
const findings = [];

function add(kind, file, detail) {
  findings.push({ kind, file, detail });
}

for (const file of files) {
  if (ignoredPrefixes.some((prefix) => file.startsWith(prefix))) continue;
  if (legacyPrefixes.some((prefix) => file.startsWith(prefix))) {
    add('legacy-tree', file, 'Legacy snapshot must not be included in a generic distribution.');
    continue;
  }
  if (file === 'config.js') add('live-config', file, 'Live station configuration must never ship in a generic distribution.');
  if (/WNMU-TV-logo/i.test(file)) add('station-asset', file, 'Station-specific branding asset.');
  if (/\.bak$/i.test(file)) add('backup-file', file, 'Backup files must not ship in a generic distribution.');

  const ext = path.extname(file).toLowerCase();
  if (!textExtensions.has(ext)) continue;
  let text = '';
  try {
    text = fs.readFileSync(path.join(root, file), 'utf8');
  } catch {
    continue;
  }
  if (/\bWNMU(?:-TV)?\b/i.test(text)) add('station-token', file, 'Contains WNMU-specific text or identifiers.');
  if (/Fishing Logbook|fishing_catch_logs|fishing_logbook_shared/i.test(text)) add('unrelated-project', file, 'Contains unrelated Fishing Logbook material.');
  if (/https:\/\/[a-z0-9-]+\.supabase\.co/i.test(text) && file !== 'config.example.js') {
    add('supabase-project-url', file, 'Contains a concrete Supabase project URL. Value intentionally not printed.');
  }
}

const grouped = new Map();
for (const finding of findings) {
  const list = grouped.get(finding.kind) || [];
  list.push(finding);
  grouped.set(finding.kind, list);
}

console.log('Generic station readiness audit');
console.log(`Tracked files checked: ${files.length}`);
console.log(`Findings: ${findings.length}`);
for (const [kind, items] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  console.log(`\n[${kind}] ${items.length}`);
  for (const item of items.slice(0, 30)) console.log(`- ${item.file}: ${item.detail}`);
  if (items.length > 30) console.log(`- ... ${items.length - 30} more`);
}

if (!findings.length) console.log('\nNo generic-release blockers found by this audit.');
if (strict && findings.length) process.exit(1);
