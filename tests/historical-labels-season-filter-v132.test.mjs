import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('assets/js/one-sheet-reports.js', 'utf8');
const html = fs.readFileSync('reports.html', 'utf8');
const version = JSON.parse(fs.readFileSync('version.json', 'utf8'));

test('historical trend charts retain every fundraiser position with compact labels and guides', () => {
  assert.match(source, /xDisplayLabels = null/);
  assert.match(source, /axisLabels: ordered\.map\(compactTrendAxisLabel\)/);
  assert.match(source, /if \(season === 'March'\) return `March \${year}`/);
  assert.match(source, /if \(season === 'June'\) return `J \${shortYear}`/);
  assert.match(source, /if \(season === 'August'\) return `A \${shortYear}`/);
  assert.match(source, /if \(season === 'December'\) return `D \${shortYear}`/);
  assert.match(source, /xLabelEvery: 1,\n        verticalGridEvery: 1/);
  assert.doesNotMatch(source, /trendEvery|giftEvery/);
});

test('season chart is full width and historical analytics can filter canonical or special seasons', () => {
  assert.match(source, /HISTORICAL_SEASONS = \['March', 'June', 'August', 'December', 'Special'\]/);
  assert.match(source, /id=\"historical-season\"/);
  assert.match(source, /historicalSeasonBucket\(analysis\) === season/);
  assert.match(source, /Season performance over time[\s\S]*?visual-card-wide/);
});

test('report asset cache-busters stay synchronized', () => {
  assert.match(version.appVersion, /^\d+\.\d+\.\d+$/);
  const assetVersions = [...html.matchAll(/(?:one-sheet-reports\.css|one-sheet-analysis\.js|one-sheet-reports\.js)\?v=(\d+\.\d+\.\d+)/g)].map((match) => match[1]);
  assert.equal(assetVersions.length, 3);
  assert.equal(new Set(assetVersions).size, 1);
});