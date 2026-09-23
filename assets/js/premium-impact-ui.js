(() => {
  'use strict';

  const A = window.WNMUPremiumAnalysis;
  const D = window.WNMUPremiumData;

  function esc(value) {
    return String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function money(value, digits = 0) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    return Number(value).toLocaleString(undefined,{style:'currency',currency:'USD',minimumFractionDigits:digits,maximumFractionDigits:digits});
  }

  function num(value, digits = 0) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    return Number(value).toLocaleString(undefined,{minimumFractionDigits:digits,maximumFractionDigits:digits});
  }

  function pct(value, digits = 1) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    return (Number(value) * 100).toFixed(digits) + '%';
  }

  function filteredImpact(mode) {
    const full = D?.snapshot?.();
    if (!full) return null;
    const selector = mode === 'report' ? '#premium-report-fundraiser' : '#premium-fundraiser-filter';
    const key = document.querySelector(selector)?.value || 'all';
    if (key === 'all') return full.premiumImpact || A.premiumImpactEvidence(full.mappedRows, full.summaries, full.performanceRows);

    const imports = full.imports.filter((item) => item.fundraiser?.key === key);
    const flat = A.flattenImports(imports);
    const mappedRows = full.mappedRows.filter((row) => row.fundraiserKey === key);
    const performanceRows = full.performanceRows.filter((row) => row.fundraiserKey === key);
    return A.premiumImpactEvidence(mappedRows, flat.summaries, performanceRows);
  }

  function comparisonsTable(items) {
    if (!items.length) return '<div class="premium-empty">No same-title / different-package comparisons are mapped yet. More historical premium mappings will make this section more useful.</div>';
    const rows = items.slice(0,12).map((item) =>
      '<tr>' +
        '<td><strong>' + esc(item.programTitle) + '</strong></td>' +
        '<td>' + num(item.fundraiserCount) + '</td>' +
        '<td>' + esc(item.compositions.join(' · ')) + '</td>' +
        '<td>' + money(item.totalPremiumLinkedDollars) + '</td>' +
        '<td>' + money(item.totalPremiumCost) + '</td>' +
        '<td>' + money(item.totalBroadcastDollars) + '</td>' +
        '<td>' + esc(item.mappingConfidence.join(', ') || 'Unclassified') + '</td>' +
      '</tr>'
    ).join('');

    return '<div class="premium-table-wrap"><table style="min-width:1050px">' +
      '<thead><tr><th>Program</th><th>Fundraisers</th><th>Package compositions</th><th>Premium-linked $</th><th>Premium cost</th><th>Broadcast $</th><th>Mapping evidence</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
  }

  function impactMarkup(impact, compact) {
    if (!impact) return '<div class="premium-empty">Premium Impact evidence is not available yet.</div>';
    const association = impact.association || {};
    const coverage = impact.coverage || {};
    const causal = impact.causal || {};
    const delta = Number(association.averagePledgeDifference || 0);
    const deltaPct = association.averagePledgeDifferencePercent;
    const deltaText = (delta >= 0 ? '+' : '') + money(delta) + (deltaPct == null ? '' : ', ' + (deltaPct >= 0 ? '+' : '') + pct(deltaPct));

    const status = '<div class="premium-impact-status-grid">' +
      '<article><span>Observed premium economics</span><strong>' + esc(impact.status?.observedEconomics || 'Not available') + '</strong><small>What actually happened in the imported reports.</small></article>' +
      '<article><span>Premium association</span><strong>' + esc(impact.status?.associationAnalysis || 'Limited') + '</strong><small>Descriptive relationships, not estimated lift.</small></article>' +
      '<article><span>Same-title / different-package</span><strong>' + num(coverage.sameTitleDifferentPackageComparisons || 0) + '</strong><small>Comparative opportunities across fundraiser history.</small></article>' +
      '<article class="premium-impact-causal"><span>Causal premium effect</span><strong>' + esc(causal.status || 'Not established') + '</strong><small>No valid counterfactual yet.</small></article>' +
    '</div>';

    const callout = '<div class="premium-impact-callout"><strong>Association is not lift.</strong> Premium-taking donors averaged <strong>' +
      money(association.averagePremiumPledge) + '</strong> versus <strong>' + money(association.averageNoPremiumPledge) +
      '</strong> for donors who took no premium (' + deltaText + '). That difference does <strong>not</strong> tell us what those same donors would have given without premiums.</div>';

    const coverageGrid = '<div class="premium-impact-evidence-grid">' +
      '<article><strong>' + num(coverage.fundraiserCount || 0) + '</strong><span>fundraisers analyzed</span></article>' +
      '<article><strong>' + num(coverage.repeatedTitles || 0) + '</strong><span>titles seen with premium data in 2+ drives</span></article>' +
      '<article><strong>' + num(coverage.comparablePremiumVsNoPremiumFundraisers || 0) + '</strong><span>drives with both premium/no-premium averages</span></article>' +
      '<article><strong>' + num(coverage.verifiedRows || 0) + '</strong><span>historically verified premium mappings</span></article>' +
    '</div>';

    const direction = '<p class="premium-note">Across comparable fundraisers, premium-taking donors had the higher average pledge in <strong>' +
      num(association.fundraisersPremiumAverageHigher || 0) + '</strong> drive(s) and the lower average in <strong>' +
      num(association.fundraisersPremiumAverageLower || 0) +
      '</strong>. Donor self-selection means neither group is a control group.</p>';

    const causalNote = '<div class="premium-impact-causal-note"><strong>Causal estimate: Not established.</strong> ' + esc(causal.reason || '') + '</div>';

    if (compact) return status + callout + coverageGrid + causalNote;
    return status + callout + coverageGrid + direction + '<h3>Best historical comparisons available</h3>' +
      comparisonsTable(impact.differentPackageComparisons || []) + causalNote;
  }

  function renderAnalyticsImpact() {
    const target = document.getElementById('premium-impact');
    if (!target) return;
    target.innerHTML = impactMarkup(filteredImpact('analytics'), false);
  }

  function renderReportImpact() {
    const output = document.getElementById('premium-report-output');
    if (!output) return;
    const article = output.querySelector('.premium-report-sheet');
    if (!article) return;
    article.querySelector('[data-premium-impact-report]')?.remove();

    const section = document.createElement('section');
    section.dataset.premiumImpactReport = 'true';
    section.innerHTML = '<div class="section-heading"><h2>Premium Impact evidence</h2><p>Observed economics and associations are separated from causal claims.</p></div>' +
      impactMarkup(filteredImpact('report'), true);

    const confidenceHeading = [...article.querySelectorAll('h2')].find((node) => node.textContent.trim() === 'Data confidence');
    const confidenceSection = confidenceHeading?.closest('section');
    if (confidenceSection) article.insertBefore(section, confidenceSection);
    else article.append(section);
  }

  function start() {
    if (!A || !D) return;

    const analyticsTarget = document.getElementById('premium-impact');
    if (analyticsTarget) {
      renderAnalyticsImpact();
      document.getElementById('premium-fundraiser-filter')?.addEventListener('change', () => setTimeout(renderAnalyticsImpact, 0));
      const status = document.getElementById('premium-status');
      if (status) new MutationObserver(() => setTimeout(renderAnalyticsImpact, 20)).observe(status,{childList:true,subtree:true,characterData:true});
    }

    const reportOutput = document.getElementById('premium-report-output');
    if (reportOutput) {
      new MutationObserver(() => setTimeout(renderReportImpact, 0)).observe(reportOutput,{childList:true,subtree:false});
      document.getElementById('premium-report-fundraiser')?.addEventListener('change', () => setTimeout(renderReportImpact, 20));
      setTimeout(renderReportImpact, 180);
    }
  }

  window.WNMUPremiumImpactUI = { filteredImpact, impactMarkup, renderAnalyticsImpact, renderReportImpact };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
  else start();
})();
