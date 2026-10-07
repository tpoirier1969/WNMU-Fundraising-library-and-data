import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../assets/js/ui-scheduling.js', import.meta.url), 'utf8');

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} should exist`);
  let brace = source.indexOf('{', start);
  assert.ok(brace >= 0);
  let depth = 0;
  for (let i = brace; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Could not extract ${name}`);
}

const context = {
  Date,
  Number,
  Array,
  Math,
  console,
  SCHEDULE_STALE_DEFAULT_DAYS: 21,
  utils: {
    normalizeText(value) { return String(value ?? '').trim(); },
    dateKeyFromDate(date) {
      return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0')
      ].join('-');
    }
  },
  getScheduleDateSpanInfo(schedule = {}) {
    const start = String(schedule.startDate || '').trim();
    const end = String(schedule.endDate || start).trim();
    return { ok: /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end) && end >= start };
  },
  daysBetweenDateKeys(a, b) {
    const one = new Date(`${a}T00:00:00`);
    const two = new Date(`${b}T00:00:00`);
    return Math.round((two - one) / 86400000);
  }
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(extractFunction('scheduleDistanceFromToday') + '\n' + extractFunction('closestScheduleToToday'), context);

const choose = (items, today) => context.closestScheduleToToday(items, today);

test('current fundraiser remains the default', () => {
  const selected = choose([
    { id:'current', startDate:'2026-10-01', endDate:'2026-10-10' },
    { id:'next', startDate:'2026-12-01', endDate:'2026-12-10' }
  ], '2026-10-07');
  assert.equal(selected.id, 'current');
});

test('recently ended fundraiser may remain the default during the three-week grace period', () => {
  const selected = choose([
    { id:'recent', startDate:'2026-09-20', endDate:'2026-09-25' },
    { id:'next', startDate:'2026-11-20', endDate:'2026-11-29' }
  ], '2026-10-10');
  assert.equal(selected.id, 'recent');
});

test('after more than three weeks, the next upcoming fundraiser becomes the default', () => {
  const selected = choose([
    { id:'old', startDate:'2026-09-01', endDate:'2026-09-10' },
    { id:'next', startDate:'2026-12-01', endDate:'2026-12-10' }
  ], '2026-10-07');
  assert.equal(selected.id, 'next');
});

test('without an upcoming fundraiser, the latest past fundraiser remains available as the default', () => {
  const selected = choose([
    { id:'older', startDate:'2026-08-01', endDate:'2026-08-10' },
    { id:'latest', startDate:'2026-09-01', endDate:'2026-09-10' }
  ], '2026-10-07');
  assert.equal(selected.id, 'latest');
});
