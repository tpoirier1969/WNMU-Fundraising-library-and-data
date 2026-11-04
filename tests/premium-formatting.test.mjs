import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const formatterSource = fs.readFileSync(new URL('../assets/js/premium-formatting.js', import.meta.url), 'utf8');
const shell = fs.readFileSync(new URL('../app-shell.html', import.meta.url), 'utf8');
const list = fs.readFileSync(new URL('../assets/js/ui-list.js', import.meta.url), 'utf8');
const detail = fs.readFileSync(new URL('../assets/js/ui-detail.js', import.meta.url), 'utf8');

function makeFormatter() {
  const context = { window: {}, document: null };
  vm.runInNewContext(formatterSource, context, { filename: 'premium-formatting.js' });
  return context.window.PledgePremiumFormatting;
}

const hanukkah = [
  '| <br> |',
  '| ---- |',
  '',
  '| **&#xA0;** | **SUSTAINER** | **ANNUAL** |',
  '| --- | --- | --- |',
  '| Choice of:<br>*A Celebration of Hanukkah* (DVD)<br>or<br>Exclusive Celebration of Hanukkah Socks | $10.00 | $120.00 |',
  '| *A Year of Jewish Joy* (HBK) | $15.00 | $180.00 |',
  '| Collection: DVD + Socks + HBK | $18.00 | $216.00 |'
].join('\n');

test('pasted email Markdown table renders offers with sustainer and annual prices', () => {
  const f = makeFormatter();
  const html = f.fullHtml(hanukkah);
  assert.equal(f.parse(hanukkah).length, 1);
  assert.equal(f.count(hanukkah), 3);
  assert.match(html, /<th scope="col">Premium<\/th>/);
  assert.match(html, /<th scope="col"><strong>SUSTAINER<\/strong><\/th>/);
  assert.match(html, /<em>A Celebration of Hanukkah<\/em>/);
  assert.match(html, /<br>or<br>/);
  assert.match(html, /\$10\.00<\/td>/);
  assert.match(html, /\$216\.00<\/td>/);
  assert.equal(f.compact(hanukkah), '3 premium options · from $10.00');
});

test('ordinary lists, paragraphs and tab-separated offers render without table guesses', () => {
  const f = makeFormatter();
  assert.equal(f.count('- DVD $10\n- CD $15\n- Collection $20'), 3);
  assert.match(f.fullHtml('- DVD $10\n- CD $15'), /<ul class="premium-offer-list">/);
  assert.match(f.fullHtml('1. DVD\n2. CD'), /<ol class="premium-offer-list">/);
  assert.match(f.fullHtml('DVD; $10 per month'), /DVD; \$10 per month/);
  assert.doesNotMatch(f.fullHtml('DVD; $10 per month'), /<table/);
  assert.match(f.fullHtml('Premium\tSustainer\tAnnual\nDVD\t$10\t$120'), /<table class="premium-offer-table">/);
});

test('pasted text is HTML-escaped before limited Markdown emphasis is applied', () => {
  const f = makeFormatter();
  const html = f.fullHtml('<img src=x onerror=alert(1)>\n**Strong** and *italic*');
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /<strong>Strong<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
});

test('premium fields are stored as plain textarea values; views use shared formatter', () => {
  assert.match(shell, /<textarea name="premium_summary" rows="4"><\/textarea>/);
  const position = (text) => shell.indexOf(text);
  assert.ok(position('assets/js/premium-formatting.js') > 0);
  assert.ok(position('assets/js/premium-formatting.js') < position('assets/js/ui-list.js'));
  assert.ok(position('assets/js/premium-formatting.js') < position('assets/js/ui-detail.js'));
  assert.match(detail, /form\.elements\.premium_summary\.value = derive\.premiumSummary\(source\)/);
  assert.match(detail, /premium_summary: utils\.normalizeText\(form\.elements\.premium_summary\.value\)/);
  assert.match(detail, /PledgePremiumFormatting\?\.fullHtml\(value\)/);
  assert.match(detail, /formatter\?\.fullHtml\(summary\)/);
  assert.match(list, /formatter\?\.compact\(value\)/);
});