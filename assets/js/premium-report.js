(() => {
  'use strict';

  const A = window.WNMUPremiumAnalysis;
  const D = window.WNMUPremiumData;
  const $ = (selector, root = document) => root.querySelector(selector);

  const esc = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const money = (value, digits = 0) => {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    return Number(value).toLocaleString(undefined, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  };

  const num = (value, digits = 0) => {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    return Number(value).toLocaleString(undefined, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  };

  const pct = (value, digits = 1) => {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    return `${(Number(value) * 100).toFixed(digits)}%`;
  };

  function setStatus(message, tone = '') {
    const node = $('#premium-report-status');
    if (!node) return;
    node.textContent = message;
    node.className = `premium-status ${tone}`.trim();
  }

  function table(headers, rows) {
    if (!rows.length) return '<p class="premium-note">No matching rows.</p>';
    return `<div class="premium-table-wrap"><table><thead><tr>${headers.map((header) => `<th>${esc(header)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  }

  function selectionSnapshot() {
    const full = D.snapshot();
    const key = $('#premium-report-fundraiser')?.value || 'all';
    const imports = key === 'all'
      ? full.imports
      : full.imports.filter((item) => item.fundraiser?.key === key);
    const flat = A.flattenImports(imports);
    const mappedRows = key === 'all'
      ? full.mappedRows
      : full.mappedRows.filter((row) => row.fundraiserKey === key);
    const performanceRows = key === 'all'
      ? full.performanceRows
      : full.performanceRows.filter((row) => row.fundraiserKey === key);

    return {
      ...full,
      imports,
      rows: flat.rows,
      summaries: flat.summaries,
      mappedRows,
      performanceRows,
      portfolio: A.portfolioSummary(flat.rows, flat.summaries),
      fundraiserAnalysis: A.fundraiserAnalysis(flat.rows, flat.summaries),
      categories: A.categoryAnalysis(mappedRows),
      compositions: A.compositionAnalysis(mappedRows),
      brandScopes: A.brandScopeAnalysis(mappedRows),
      packages: A.packageAnalysis(mappedRows),
      programs: A.mappedGroupAnalysis(mappedRows, 'programTitle'),
      topics: A.mappedGroupAnalysis(mappedRows, 'topicPrimary'),
      combinedPrograms: A.combinedProgramAnalysis(mappedRows, performanceRows),
      combinedTopics: A.combinedTopicAnalysis(mappedRows, performanceRows),
      premiumImpact: A.premiumImpactEvidence(mappedRows, flat.summaries, performanceRows)
    };
  }

  function render() {
    const s = selectionSnapshot();
    const p = s.portfolio;
    const title = s.imports.length === 1
      ? s.imports[0].fundraiser.label
      : 'All imported fundraisers';
    const quality = A.mappingQuality(s.mappedRows);
    const impact = s.premiumImpact || {};
    const impactAssociation = impact.association || {};
    const impactCoverage = impact.coverage || {};
    const impactComparisons = impact.differentPackageComparisons || [];

    const fundraiserRows = s.fundraiserAnalysis.map((row) => `
      <tr>
        <td><strong>${esc(row.label)}</strong></td>
        <td>${money(row.totalPledged)}</td>
        <td>${num(row.totalPledges)}</td>
        <td>${pct(row.premiumTakeRate)}</td>
        <td>${money(row.anyPremiumDollars)}</td>
        <td>${money(row.totalPremiumCost)}</td>
        <td>${pct(row.premiumCostPercentOfTotal)}</td>
        <td>${money(row.estimatedTotalNetAfterPremium)}</td>
        <td>${money(row.averagePremiumPledge)}</td>
        <td>${money(row.averageNoPremiumPledge)}</td>
      </tr>`);

    const packageRows = s.packages.slice(0, 40).map((row) => `
      <tr>
        <td>${esc(row.fundraiserLabel)}</td>
        <td><strong>${esc(row.description)}</strong></td>
        <td>${esc(row.packageCompositionLabel || '—')}</td>
        <td>${esc(row.brandScope || 'Unclassified')}</td>
        <td>${num(row.pledgeCount)}</td>
        <td>${money(row.pledgedDollars)}</td>
        <td>${money(row.averagePledge)}</td>
        <td>${money(row.totalPremiumCost, 2)}</td>
        <td>${pct(row.costPercentOfPledged)}</td>
        <td>${money(row.estimatedNetAfterPremium)}</td>
      </tr>`);

    const categoryRows = s.categories.map((row) => `
      <tr>
        <td><strong>${esc(row.category)}</strong></td>
        <td>${num(row.distinctPackages)}</td>
        <td>${num(row.fundraiserCount)}</td>
        <td>${num(row.pledgeCount)}</td>
        <td>${money(row.pledgedDollars)}</td>
        <td>${money(row.averagePledge)}</td>
        <td>${money(row.totalPremiumCost)}</td>
        <td>${pct(row.costPercentOfPledged)}</td>
        <td>${money(row.estimatedNetAfterPremium)}</td>
      </tr>`);

    const compositionRows = (s.compositions || []).map((row) => `
      <tr>
        <td><strong>${esc(row.label)}</strong></td>
        <td>${num(row.distinctPackages)}</td>
        <td>${num(row.distinctTitles)}</td>
        <td>${num(row.fundraiserCount)}</td>
        <td>${num(row.pledgeCount)}</td>
        <td>${money(row.pledgedDollars)}</td>
        <td>${money(row.averagePledge)}</td>
        <td>${money(row.totalPremiumCost)}</td>
        <td>${pct(row.costPercentOfPledged)}</td>
        <td>${money(row.estimatedNetAfterPremium)}</td>
      </tr>`);

    const brandRows = (s.brandScopes || []).map((row) => `
      <tr>
        <td><strong>${esc(row.scope)}</strong></td>
        <td>${num(row.distinctPackages)}</td>
        <td>${num(row.distinctTitles)}</td>
        <td>${num(row.fundraiserCount)}</td>
        <td>${num(row.pledgeCount)}</td>
        <td>${money(row.pledgedDollars)}</td>
        <td>${money(row.totalPremiumCost)}</td>
        <td>${pct(row.costPercentOfPledged)}</td>
        <td>${money(row.estimatedNetAfterPremium)}</td>
      </tr>`);

    const programRows = s.programs.slice(0, 20).map((row) => `
      <tr>
        <td><strong>${esc(row.label)}</strong></td>
        <td>${num(row.exactPremiumCount)}</td>
        <td>${num(row.pledgeCount)}</td>
        <td>${money(row.pledgedDollars)}</td>
        <td>${money(row.totalPremiumCost)}</td>
        <td>${pct(row.costPercentOfPledged)}</td>
        <td>${money(row.estimatedNetAfterPremium)}</td>
      </tr>`);

    const topicRows = s.topics.slice(0, 20).map((row) => `
      <tr>
        <td><strong>${esc(row.label)}</strong></td>
        <td>${num(row.exactPremiumCount)}</td>
        <td>${num(row.pledgeCount)}</td>
        <td>${money(row.pledgedDollars)}</td>
        <td>${money(row.totalPremiumCost)}</td>
        <td>${pct(row.costPercentOfPledged)}</td>
        <td>${money(row.estimatedNetAfterPremium)}</td>
      </tr>`);

    const combinedProgramRows = s.combinedPrograms
      .filter((row) => row.premiumPackages)
      .slice(0, 20)
      .map((row) => `
        <tr>
          <td><strong>${esc(row.programTitle)}</strong><br><small>${esc(row.fundraiserLabel)}</small></td>
          <td>${money(row.broadcastDollars)}</td>
          <td>${money(row.broadcastDollarsPerHour)}</td>
          <td>${money(row.pledgedDollars)}</td>
          <td>${money(row.totalPremiumCost)}</td>
          <td>${money(row.estimatedNetAfterPremium)}</td>
        </tr>`);

    const combinedTopicRows = s.combinedTopics
      .filter((row) => row.premiumPackages)
      .slice(0, 20)
      .map((row) => `
        <tr>
          <td><strong>${esc(row.topic)}</strong></td>
          <td>${money(row.broadcastDollars)}</td>
          <td>${money(row.broadcastDollarsPerHour)}</td>
          <td>${money(row.pledgedDollars)}</td>
          <td>${money(row.totalPremiumCost)}</td>
          <td>${money(row.estimatedNetAfterPremium)}</td>
        </tr>`);

    $('#premium-report-output').innerHTML = `
      <article class="one-sheet premium-report-sheet">
        <header class="sheet-title">
          <div>
            <div class="report-kicker">Premium Performance &amp; Economics</div>
            <h1>${esc(title)}</h1>
            <p>Exact selectable packages are the accounting unit. Package composition and component categories are analytical views.</p>
          </div>
          <div class="premium-report-kpis">
            <strong>${money(p.totalPledged)}</strong><span>pledged</span>
            <strong>${money(p.totalPremiumCost)}</strong><span>reported premium cost</span>
            <strong>${pct(p.premiumCostPercentOfTotal)}</strong><span>cost / total pledged</span>
          </div>
        </header>

        <section>
          <div class="section-heading"><h2>Fundraiser economics</h2><p>Premium-taking behavior and cost by drive.</p></div>
          ${table(
            ['Fundraiser','Pledged','Pledges','Premium take rate','Premium $','Premium cost','Cost / total $','Net after premium','Avg premium pledge','Avg no-premium pledge'],
            fundraiserRows
          )}
        </section>

        <section>
          <div class="section-heading"><h2>Exact premium packages</h2><p>Each selectable premium remains fundraiser-specific.</p></div>
          ${table(
            ['Fundraiser','Premium / package','Package composition','Brand / source','Pledges','Pledged','Avg pledge','Cost','Cost %','Net after premium'],
            packageRows
          )}
        </section>

        <section>
          <div class="section-heading"><h2>Category trends</h2><p>Component categories overlap and should not be summed together.</p></div>
          ${table(
            ['Category','Packages','Fundraisers','Pledges','Pledged','Avg pledge','Premium cost','Cost %','Net after premium'],
            categoryRows
          )}
        </section>

        <section>
          <div class="section-heading"><h2>Package composition trends</h2><p>Compares recurring package recipes across titles and drives.</p></div>
          ${table(
            ['Package composition','Exact packages','Titles','Fundraisers','Pledges','Pledged','Avg pledge','Premium cost','Cost %','Net after premium'],
            compositionRows
          )}
        </section>

        <section>
          <div class="section-heading"><h2>Brand / source scope</h2><p>WNMU/local, PBS/national, program/title, and unclassified.</p></div>
          ${table(
            ['Brand / source','Packages','Titles','Fundraisers','Pledges','Pledged','Premium cost','Cost %','Net after premium'],
            brandRows
          )}
        </section>

        <section>
          <div class="section-heading"><h2>Program / topic context</h2><p>Current Program Library premium text can be used as a clearly labeled historical proxy.</p></div>
          <div class="premium-two-col">
            <div>
              <h3>Programs</h3>
              ${table(['Program','Packages','Pledges','Premium-linked $','Premium cost','Cost %','Net after premium'], programRows)}
            </div>
            <div>
              <h3>Topics</h3>
              ${table(['Topic','Packages','Pledges','Premium-linked $','Premium cost','Cost %','Net after premium'], topicRows)}
            </div>
          </div>
        </section>

        <section>
          <div class="section-heading"><h2>Combined program / topic context</h2><p>Broadcast results and premium-linked results remain separate measures.</p></div>
          <div class="premium-two-col">
            <div>
              <h3>Programs</h3>
              ${table(['Program','Broadcast $','$ / pledge hr','Premium-linked $','Premium cost','Net after premium'], combinedProgramRows)}
            </div>
            <div>
              <h3>Topics</h3>
              ${table(['Topic','Broadcast $','$ / pledge hr','Premium-linked $','Premium cost','Net after premium'], combinedTopicRows)}
            </div>
          </div>
        </section>

        <section>
          <div class="section-heading"><h2>Premium Impact evidence</h2><p>Separates observed premium performance from evidence that premiums actually changed donor behavior.</p></div>
          <div class="premium-impact-status-grid">
            <article><span>Observed economics</span><strong>${esc(impact.status?.observedEconomics || 'Not available')}</strong></article>
            <article><span>Association analysis</span><strong>${esc(impact.status?.associationAnalysis || 'Limited')}</strong></article>
            <article><span>Same-title / different-package</span><strong>${num(impactCoverage.sameTitleDifferentPackageComparisons || 0)}</strong></article>
            <article class="premium-impact-causal"><span>Causal premium effect</span><strong>${esc(impact.causal?.status || 'Not established')}</strong></article>
          </div>
          <p class="premium-impact-callout"><strong>Association is not lift.</strong> Premium-taking donors averaged <strong>${money(impactAssociation.averagePremiumPledge)}</strong> versus <strong>${money(impactAssociation.averageNoPremiumPledge)}</strong> for donors who took no premium. Those are self-selected groups, so the difference does not tell us what the same donors would have given without premiums.</p>
          ${impactComparisons.length ? table(
            ['Program','Fundraisers','Package compositions','Premium-linked 
          <p class="data-quality-note">
            Mapping rows: ${num(quality['Historically verified'] || 0)} historically verified ·
            ${num(quality['Current-offer proxy'] || 0)} current-offer proxy ·
            ${num(quality['Strongly inferred'] || 0)} strongly inferred ·
            ${num(quality.Unmapped || 0)} unmapped.
            Reported premium costs exclude expenses not present in the source report, such as shipping/handling.
          </p>
        </section>
      </article>`;
  }

  function populate() {
    const select = $('#premium-report-fundraiser');
    if (!select) return;
    const previous = select.value;
    const imports = D.state.imports || [];
    select.innerHTML = `
      <option value="all">All imported fundraisers</option>
      ${imports.map((item) => `<option value="${esc(item.fundraiser.key)}">${esc(item.fundraiser.label)}</option>`).join('')}`;
    if ([...select.options].some((option) => option.value === previous)) select.value = previous;
  }

  async function init() {
    try {
      if (!A || !D) throw new Error('Premium report modules did not load.');
      const allowed = await D.requireAdmin({
        gateId: 'premium-report-access-gate',
        appId: 'premium-report-app',
        roleId: 'premium-report-role'
      });
      if (!allowed) return;

      await D.loadExistingAnalytics();
      populate();
      render();
      setStatus(
        D.state.imports.length
          ? 'Premium report ready.'
          : 'No browser-stored premium reports yet. Import them in Premium Analytics first.',
        D.state.imports.length ? 'good' : 'warn'
      );

      $('#premium-report-fundraiser')?.addEventListener('change', render);
      $('#premium-report-print')?.addEventListener('click', () => window.print());
    } catch (error) {
      console.error(error);
      setStatus(error?.message || 'Premium report could not start.', 'error');
    }
  }

  document.addEventListener('DOMContentLoaded', init, { once: true });
})();
,'Premium cost','Broadcast 
          <p class="data-quality-note">
            Mapping rows: ${num(quality['Historically verified'] || 0)} historically verified ·
            ${num(quality['Current-offer proxy'] || 0)} current-offer proxy ·
            ${num(quality['Strongly inferred'] || 0)} strongly inferred ·
            ${num(quality.Unmapped || 0)} unmapped.
            Reported premium costs exclude expenses not present in the source report, such as shipping/handling.
          </p>
        </section>
      </article>`;
  }

  function populate() {
    const select = $('#premium-report-fundraiser');
    if (!select) return;
    const previous = select.value;
    const imports = D.state.imports || [];
    select.innerHTML = `
      <option value="all">All imported fundraisers</option>
      ${imports.map((item) => `<option value="${esc(item.fundraiser.key)}">${esc(item.fundraiser.label)}</option>`).join('')}`;
    if ([...select.options].some((option) => option.value === previous)) select.value = previous;
  }

  async function init() {
    try {
      if (!A || !D) throw new Error('Premium report modules did not load.');
      const allowed = await D.requireAdmin({
        gateId: 'premium-report-access-gate',
        appId: 'premium-report-app',
        roleId: 'premium-report-role'
      });
      if (!allowed) return;

      await D.loadExistingAnalytics();
      populate();
      render();
      setStatus(
        D.state.imports.length
          ? 'Premium report ready.'
          : 'No browser-stored premium reports yet. Import them in Premium Analytics first.',
        D.state.imports.length ? 'good' : 'warn'
      );

      $('#premium-report-fundraiser')?.addEventListener('change', render);
      $('#premium-report-print')?.addEventListener('click', () => window.print());
    } catch (error) {
      console.error(error);
      setStatus(error?.message || 'Premium report could not start.', 'error');
    }
  }

  document.addEventListener('DOMContentLoaded', init, { once: true });
})();
,'Mapping evidence'],
            impactComparisons.slice(0,10).map((item)=>`<tr><td><strong>${esc(item.programTitle)}</strong></td><td>${num(item.fundraiserCount)}</td><td>${esc(item.compositions.join(' · '))}</td><td>${money(item.totalPremiumLinkedDollars)}</td><td>${money(item.totalPremiumCost)}</td><td>${money(item.totalBroadcastDollars)}</td><td>${esc(item.mappingConfidence.join(', ') || 'Unclassified')}</td></tr>`)
          ) : '<p class="premium-note">No same-title / different-package comparisons are mapped yet.</p>'}
          <p class="premium-impact-causal-note"><strong>Causal estimate: Not established.</strong> ${esc(impact.causal?.reason || '')}</p>
        </section>

        <section>
          <div class="section-heading"><h2>Data confidence</h2></div>
          <p class="data-quality-note">
            Mapping rows: ${num(quality['Historically verified'] || 0)} historically verified ·
            ${num(quality['Current-offer proxy'] || 0)} current-offer proxy ·
            ${num(quality['Strongly inferred'] || 0)} strongly inferred ·
            ${num(quality.Unmapped || 0)} unmapped.
            Reported premium costs exclude expenses not present in the source report, such as shipping/handling.
          </p>
        </section>
      </article>`;
  }

  function populate() {
    const select = $('#premium-report-fundraiser');
    if (!select) return;
    const previous = select.value;
    const imports = D.state.imports || [];
    select.innerHTML = `
      <option value="all">All imported fundraisers</option>
      ${imports.map((item) => `<option value="${esc(item.fundraiser.key)}">${esc(item.fundraiser.label)}</option>`).join('')}`;
    if ([...select.options].some((option) => option.value === previous)) select.value = previous;
  }

  async function init() {
    try {
      if (!A || !D) throw new Error('Premium report modules did not load.');
      const allowed = await D.requireAdmin({
        gateId: 'premium-report-access-gate',
        appId: 'premium-report-app',
        roleId: 'premium-report-role'
      });
      if (!allowed) return;

      await D.loadExistingAnalytics();
      populate();
      render();
      setStatus(
        D.state.imports.length
          ? 'Premium report ready.'
          : 'No browser-stored premium reports yet. Import them in Premium Analytics first.',
        D.state.imports.length ? 'good' : 'warn'
      );

      $('#premium-report-fundraiser')?.addEventListener('change', render);
      $('#premium-report-print')?.addEventListener('click', () => window.print());
    } catch (error) {
      console.error(error);
      setStatus(error?.message || 'Premium report could not start.', 'error');
    }
  }

  document.addEventListener('DOMContentLoaded', init, { once: true });
})();
