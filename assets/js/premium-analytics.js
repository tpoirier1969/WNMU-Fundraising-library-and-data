(() => {
  'use strict';

  const A = window.WNMUPremiumAnalysis;
  const D = window.WNMUPremiumData;
  const $ = (selector, root = document) => root.querySelector(selector);

  function esc(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function money(value, digits = 0) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    return Number(value).toLocaleString(undefined, { style:'currency', currency:'USD', minimumFractionDigits:digits, maximumFractionDigits:digits });
  }
  function num(value, digits = 0) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    return Number(value).toLocaleString(undefined, { minimumFractionDigits:digits, maximumFractionDigits:digits });
  }
  function pct(value, digits = 1) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    return `${(Number(value) * 100).toFixed(digits)}%`;
  }
  function setStatus(message, tone = '') {
    const node = $('#premium-status');
    if (!node) return;
    node.textContent = message;
    node.className = `premium-status ${tone}`.trim();
  }
  function badge(value) {
    const label = String(value || 'Unmapped');
    return `<span class="premium-badge premium-badge-${label.toLowerCase().replace(/[^a-z0-9]+/g,'-')}">${esc(label)}</span>`;
  }
  function table(headers, rows, { minWidth = 760 } = {}) {
    if (!rows.length) return '<div class="premium-empty">No matching premium data.</div>';
    return `<div class="premium-table-wrap"><table style="min-width:${minWidth}px"><thead><tr>${headers.map((h)=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  }

  function filtered(snapshot) {
    const key = $('#premium-fundraiser-filter')?.value || 'all';
    if (key === 'all') return snapshot;
    const imports = snapshot.imports.filter((item) => item.fundraiser?.key === key);
    const flat = A.flattenImports(imports);
    const mappedRows = snapshot.mappedRows.filter((row) => row.fundraiserKey === key);
    const performanceRows = snapshot.performanceRows.filter((row) => row.fundraiserKey === key);
    return {
      ...snapshot,
      imports,
      rows: flat.rows,
      summaries: flat.summaries,
      mappedRows,
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
      mappingQuality: A.mappingQuality(mappedRows)
    };
  }

  function renderOverview(s) {
    const p = s.portfolio;
    $('#premium-overview').innerHTML = `<div class="premium-stat-grid">
      <article><span>Fundraisers</span><strong>${num(p.fundraiserCount)}</strong><small>premium-cost reports</small></article>
      <article><span>Total pledged</span><strong>${money(p.totalPledged)}</strong><small>${num(p.totalPledges)} pledges</small></article>
      <article><span>Premium take rate</span><strong>${pct(p.premiumTakeRate)}</strong><small>${num(p.anyPremiumPledges)} premium pledges</small></article>
      <article><span>Premium cost</span><strong>${money(p.totalPremiumCost)}</strong><small>${pct(p.premiumCostPercentOfTotal)} of all pledged dollars</small></article>
      <article><span>Avg premium pledge</span><strong>${money(p.averagePremiumPledge)}</strong><small>vs ${money(p.averageNoPremiumPledge)} with no premium</small></article>
      <article><span>Estimated net after premium</span><strong>${money(p.estimatedTotalNetAfterPremium)}</strong><small>pledged dollars less reported premium cost</small></article>
    </div>${p.unitemizedPremiumPledges ? `<p class="premium-note"><strong>${num(p.unitemizedPremiumPledges)}</strong> premium pledges totaling <strong>${money(p.unitemizedPremiumDollars)}</strong> are reported only in individualized/unknown summary rows, so their exact package cannot be analyzed.</p>` : ''}`;
  }

  function renderFundraisers(s) {
    $('#premium-fundraiser-table').innerHTML = table(
      ['Fundraiser','Pledged','Pledges','Took premium','Premium 
      s.fundraiserAnalysis.map((r)=>`<tr><td><strong>${esc(r.label)}</strong></td><td>${money(r.totalPledged)}</td><td>${num(r.totalPledges)}</td><td>${pct(r.premiumTakeRate)}</td><td>${money(r.anyPremiumDollars)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.premiumCostPercentOfTotal)}</td><td>${money(r.estimatedTotalNetAfterPremium)}</td><td>${money(r.averagePremiumPledge)}</td><td>${money(r.averageNoPremiumPledge)}</td><td>${num(r.unitemizedPremiumPledges)} / ${money(r.unitemizedPremiumDollars)}</td></tr>`),
      { minWidth: 1150 }
    );
  }

  function renderCategories(s) {
    const max = Math.max(1, ...s.categories.map((r)=>Number(r.pledgedDollars)||0));
    $('#premium-category-chart').innerHTML = s.categories.length ? `<div class="premium-bars">${s.categories.slice(0,12).map((r)=>`<div class="premium-bar-row"><div class="premium-bar-label">${esc(r.category)}</div><div class="premium-bar-track"><span style="width:${Math.max(2,(r.pledgedDollars/max)*100).toFixed(1)}%"></span></div><strong>${money(r.pledgedDollars)}</strong></div>`).join('')}</div>` : '<div class="premium-empty">No category data.</div>';
    $('#premium-category-table').innerHTML = table(
      ['Category tag','Packages','Fundraisers','Pledges','Pledged','Avg pledge','Premium cost','Cost %','Net after premium'],
      s.categories.map((r)=>`<tr><td><strong>${esc(r.category)}</strong></td><td>${num(r.distinctPackages)}</td><td>${num(r.fundraiserCount)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.averagePledge)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td><td>${money(r.estimatedNetAfterPremium)}</td></tr>`),
      { minWidth: 850 }
    );
  }

  function renderCompositions(s) {
    $('#premium-composition-table').innerHTML = table(
      ['Package composition','Exact packages','Titles','Fundraisers','Pledges','Pledged','Avg pledge','Premium cost','Cost %','Confidence'],
      (s.compositions || []).map((r)=>`<tr><td><strong>${esc(r.label)}</strong></td><td>${num(r.distinctPackages)}</td><td>${num(r.distinctTitles)}</td><td>${num(r.fundraiserCount)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.averagePledge)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td><td>${r.complete ? 'Complete' : 'Partial / inferred'}</td></tr>`),
      { minWidth: 1150 }
    );
  }

  function renderBrandScopes(s) {
    $('#premium-brand-table').innerHTML = table(
      ['Brand / source scope','Packages','Titles','Fundraisers','Pledges','Pledged','Premium cost','Cost %','Net after premium'],
      (s.brandScopes || []).map((r)=>`<tr><td><strong>${esc(r.scope)}</strong></td><td>${num(r.distinctPackages)}</td><td>${num(r.distinctTitles)}</td><td>${num(r.fundraiserCount)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td><td>${money(r.estimatedNetAfterPremium)}</td></tr>`),
      { minWidth: 1050 }
    );
  }

  function renderPackages(s) {
    $('#premium-package-table').innerHTML = table(
      ['Fundraiser','Exact premium / package','Package composition','Brand / source','Pledges','Pledged','Avg pledge','Reported cost','Cost %','Net after premium'],
      s.packages.map((r)=>`<tr><td>${esc(r.fundraiserLabel)}</td><td><strong>${esc(r.description)}</strong>${r.stationBranded ? '<span class="premium-inline-flag">WNMU</span>' : ''}</td><td>${esc(r.packageCompositionLabel || '—')}</td><td>${esc(r.brandScope || 'Unclassified')}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.averagePledge)}</td><td>${money(r.totalPremiumCost,2)}</td><td>${pct(r.costPercentOfPledged)}</td><td>${money(r.estimatedNetAfterPremium)}</td></tr>`),
      { minWidth: 1200 }
    );
  }

  function renderMapped(s) {
    $('#premium-program-table').innerHTML = table(
      ['Program','Fundraisers','Packages','Pledges','Premium-linked 
      s.programs.map((r)=>`<tr><td><strong>${esc(r.label)}</strong></td><td>${num(r.fundraiserCount)}</td><td>${num(r.exactPremiumCount)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td><td>${money(r.estimatedNetAfterPremium)}</td></tr>`),
      { minWidth: 980 }
    );
    $('#premium-topic-table').innerHTML = table(
      ['Topic','Fundraisers','Packages','Pledges','Premium-linked 
      s.topics.filter((r)=>r.label).map((r)=>`<tr><td><strong>${esc(r.label)}</strong></td><td>${num(r.fundraiserCount)}</td><td>${num(r.exactPremiumCount)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td></tr>`),
      { minWidth: 900 }
    );
  }

  function renderCombined(s) {
    const status = $('#premium-combined-status');
    if (status) status.textContent = 'Broadcast performance comes from the existing fundraiser analytics. Premium-linked dollars remain a separate measure so unlike scopes are not silently added together.';
    $('#premium-combined-program-table').innerHTML = table(
      ['Fundraiser','Program','Topic','Broadcast $','Broadcast pledges','$ / pledge hr','Premium-linked $','Premium pledges','Premium cost','Mapping'],
      s.combinedPrograms.filter((r)=>r.premiumPackages || r.broadcastDollars).map((r)=>`<tr><td>${esc(r.fundraiserLabel)}</td><td><strong>${esc(r.programTitle)}</strong></td><td>${esc(r.topicPrimary||'—')}</td><td>${money(r.broadcastDollars)}</td><td>${num(r.broadcastPledges)}</td><td>${money(r.broadcastDollarsPerHour)}</td><td>${r.premiumPackages ? money(r.pledgedDollars) : '—'}</td><td>${r.premiumPackages ? num(r.pledgeCount) : '—'}</td><td>${r.premiumPackages ? money(r.totalPremiumCost) : '—'}</td><td>${r.mappingConfidence?.length ? r.mappingConfidence.map(badge).join(' ') : '—'}</td></tr>`),
      { minWidth: 1250 }
    );
    $('#premium-combined-topic-table').innerHTML = table(
      ['Topic','Fundraisers','Broadcast $','Broadcast pledges','$ / pledge hr','Premium-linked $','Premium pledges','Premium cost','Cost %'],
      s.combinedTopics.map((r)=>`<tr><td><strong>${esc(r.topic)}</strong></td><td>${num(r.fundraiserCount)}</td><td>${money(r.broadcastDollars)}</td><td>${num(r.broadcastPledges)}</td><td>${money(r.broadcastDollarsPerHour)}</td><td>${money(r.pledgedDollars)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td></tr>`),
      { minWidth: 1050 }
    );
  }

  function renderQuality(s) {
    const q = s.mappingQuality;
    const issues = s.mappedRows.filter((r)=>r.issues?.length);
    const unmapped = s.mappedRows.filter((r)=>r.mappingConfidence==='Unmapped');
    $('#premium-quality').innerHTML = `<div class="premium-quality-grid">
      <article><strong>${num(q['Historically verified']||0)}</strong><span>Historically verified</span></article>
      <article><strong>${num(q['Current-offer proxy']||0)}</strong><span>Current-offer proxy</span></article>
      <article><strong>${num(q['Strongly inferred']||0)}</strong><span>Strongly inferred</span></article>
      <article><strong>${num(q.Unmapped||0)}</strong><span>Unmapped</span></article>
    </div>
    ${issues.length ? `<p class="premium-note"><strong>${issues.length}</strong> exact premium rows have source-data warnings: ${esc([...new Set(issues.flatMap((r)=>r.issues))].join('; '))}.</p>` : '<p class="premium-note">No source-data warnings in the currently selected exact-premium rows.</p>'}
    ${unmapped.length ? table(['Unmapped exact premium','Fundraiser','Categories','Pledges','Pledged'], unmapped.map((r)=>`<tr><td><strong>${esc(r.description)}</strong></td><td>${esc(r.fundraiserLabel)}</td><td>${esc((r.componentCategories||[]).join(', '))}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td></tr>`), {minWidth:800}) : ''}`;
  }

  function updateFundraiserOptions(snapshot) {
    const select = $('#premium-fundraiser-filter');
    if (!select) return;
    const previous = select.value;
    const options = snapshot.imports.map((item)=>`<option value="${esc(item.fundraiser.key)}">${esc(item.fundraiser.label)}</option>`).join('');
    select.innerHTML = `<option value="all">All imported fundraisers</option>${options}`;
    if ([...select.options].some((option)=>option.value===previous)) select.value=previous;
  }

  function render() {
    const all = D.snapshot();
    updateFundraiserOptions(all);
    const s = filtered(all);
    $('#premium-import-count').textContent = `${all.imports.length} fundraiser report${all.imports.length===1?'':'s'} stored in this browser`;
    renderOverview(s);
    renderFundraisers(s);
    renderCategories(s);
    renderCompositions(s);
    renderBrandScopes(s);
    renderPackages(s);
    renderMapped(s);
    renderCombined(s);
    renderQuality(s);
  }

  async function init() {
    try {
      if (!A || !D) throw new Error('Premium analytics modules did not load.');
      const allowed = await D.requireAdmin({ gateId:'premium-access-gate', appId:'premium-app', roleId:'premium-role' });
      if (!allowed) return;
      setStatus('Loading Program Library and fundraiser analytics…');
      await D.loadExistingAnalytics();
      render();
      setStatus(D.state.imports.length ? 'Premium analytics ready.' : 'Import the eight premium-cost reports to start the proof of concept.', D.state.imports.length ? 'good' : 'warn');

      $('#premium-file-input')?.addEventListener('change', async (event) => {
        const files = [...(event.target.files || [])];
        if (!files.length) return;
        try {
          setStatus(`Importing ${files.length} premium-cost report${files.length===1?'':'s'}…`);
          const parsed = await D.importFiles(files);
          render();
          setStatus(`Imported ${parsed.length} report${parsed.length===1?'':'s'}. Exact packages remain tied to their fundraiser.`, 'good');
          event.target.value = '';
        } catch (error) {
          console.error(error);
          setStatus(error?.message || 'Premium-cost import failed.', 'error');
        }
      });
      $('#premium-fundraiser-filter')?.addEventListener('change', render);
      $('#premium-refresh-library')?.addEventListener('click', async () => {
        try { setStatus('Refreshing Program Library and fundraiser analytics…'); await D.loadExistingAnalytics(); render(); setStatus('Program and topic context refreshed.', 'good'); }
        catch (error) { console.error(error); setStatus(error?.message || 'Refresh failed.', 'error'); }
      });
      $('#premium-clear')?.addEventListener('click', () => {
        if (!window.confirm('Clear only the browser-stored premium analytics imports? Existing WNMU pledge/program data will not be changed.')) return;
        D.clearStoredImports();
        render();
        setStatus('Browser-stored premium analytics data cleared. Existing pledge/program data was untouched.', 'good');
      });
    } catch (error) {
      console.error(error);
      setStatus(error?.message || 'Premium analytics could not start.', 'error');
    }
  }

  document.addEventListener('DOMContentLoaded', init, { once:true });
})();
,'Premium cost','Cost / total 
      s.fundraiserAnalysis.map((r)=>`<tr><td><strong>${esc(r.label)}</strong></td><td>${money(r.totalPledged)}</td><td>${num(r.totalPledges)}</td><td>${pct(r.premiumTakeRate)}</td><td>${money(r.anyPremiumDollars)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.premiumCostPercentOfTotal)}</td><td>${money(r.averagePremiumPledge)}</td><td>${money(r.averageNoPremiumPledge)}</td><td>${num(r.unitemizedPremiumPledges)} / ${money(r.unitemizedPremiumDollars)}</td></tr>`),
      { minWidth: 1150 }
    );
  }

  function renderCategories(s) {
    const max = Math.max(1, ...s.categories.map((r)=>Number(r.pledgedDollars)||0));
    $('#premium-category-chart').innerHTML = s.categories.length ? `<div class="premium-bars">${s.categories.slice(0,12).map((r)=>`<div class="premium-bar-row"><div class="premium-bar-label">${esc(r.category)}</div><div class="premium-bar-track"><span style="width:${Math.max(2,(r.pledgedDollars/max)*100).toFixed(1)}%"></span></div><strong>${money(r.pledgedDollars)}</strong></div>`).join('')}</div>` : '<div class="premium-empty">No category data.</div>';
    $('#premium-category-table').innerHTML = table(
      ['Category tag','Packages','Fundraisers','Pledges','Pledged','Avg pledge','Premium cost','Cost %'],
      s.categories.map((r)=>`<tr><td><strong>${esc(r.category)}</strong></td><td>${num(r.distinctPackages)}</td><td>${num(r.fundraiserCount)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.averagePledge)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td></tr>`),
      { minWidth: 850 }
    );
  }

  function renderCompositions(s) {
    $('#premium-composition-table').innerHTML = table(
      ['Package composition','Exact packages','Titles','Fundraisers','Pledges','Pledged','Avg pledge','Premium cost','Cost %','Confidence'],
      (s.compositions || []).map((r)=>`<tr><td><strong>${esc(r.label)}</strong></td><td>${num(r.distinctPackages)}</td><td>${num(r.distinctTitles)}</td><td>${num(r.fundraiserCount)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.averagePledge)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td><td>${r.complete ? 'Complete' : 'Partial / inferred'}</td></tr>`),
      { minWidth: 1150 }
    );
  }

  function renderPackages(s) {
    $('#premium-package-table').innerHTML = table(
      ['Fundraiser','Exact premium / package','Package composition','Pledges','Pledged','Avg pledge','Reported cost','Cost %','Est. net'],
      s.packages.map((r)=>`<tr><td>${esc(r.fundraiserLabel)}</td><td><strong>${esc(r.description)}</strong>${r.stationBranded ? '<span class="premium-inline-flag">WNMU</span>' : ''}</td><td>${esc(r.packageCompositionLabel || '—')}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.averagePledge)}</td><td>${money(r.totalPremiumCost,2)}</td><td>${pct(r.costPercentOfPledged)}</td><td>${money(r.estimatedNetAfterPremium)}</td></tr>`),
      { minWidth: 1200 }
    );
  }

  function renderMapped(s) {
    $('#premium-program-table').innerHTML = table(
      ['Program','Fundraisers','Packages','Pledges','Premium-linked $','Reported cost','Cost %'],
      s.programs.map((r)=>`<tr><td><strong>${esc(r.label)}</strong></td><td>${num(r.fundraiserCount)}</td><td>${num(r.exactPremiumCount)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td></tr>`),
      { minWidth: 900 }
    );
    $('#premium-topic-table').innerHTML = table(
      ['Topic','Fundraisers','Packages','Pledges','Premium-linked $','Reported cost','Cost %'],
      s.topics.filter((r)=>r.label).map((r)=>`<tr><td><strong>${esc(r.label)}</strong></td><td>${num(r.fundraiserCount)}</td><td>${num(r.exactPremiumCount)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td></tr>`),
      { minWidth: 900 }
    );
  }

  function renderCombined(s) {
    const status = $('#premium-combined-status');
    if (status) status.textContent = 'Broadcast performance comes from the existing fundraiser analytics. Premium-linked dollars remain a separate measure so unlike scopes are not silently added together.';
    $('#premium-combined-program-table').innerHTML = table(
      ['Fundraiser','Program','Topic','Broadcast $','Broadcast pledges','$ / pledge hr','Premium-linked $','Premium pledges','Premium cost','Mapping'],
      s.combinedPrograms.filter((r)=>r.premiumPackages || r.broadcastDollars).map((r)=>`<tr><td>${esc(r.fundraiserLabel)}</td><td><strong>${esc(r.programTitle)}</strong></td><td>${esc(r.topicPrimary||'—')}</td><td>${money(r.broadcastDollars)}</td><td>${num(r.broadcastPledges)}</td><td>${money(r.broadcastDollarsPerHour)}</td><td>${r.premiumPackages ? money(r.pledgedDollars) : '—'}</td><td>${r.premiumPackages ? num(r.pledgeCount) : '—'}</td><td>${r.premiumPackages ? money(r.totalPremiumCost) : '—'}</td><td>${r.mappingConfidence?.length ? r.mappingConfidence.map(badge).join(' ') : '—'}</td></tr>`),
      { minWidth: 1250 }
    );
    $('#premium-combined-topic-table').innerHTML = table(
      ['Topic','Fundraisers','Broadcast $','Broadcast pledges','$ / pledge hr','Premium-linked $','Premium pledges','Premium cost','Cost %'],
      s.combinedTopics.map((r)=>`<tr><td><strong>${esc(r.topic)}</strong></td><td>${num(r.fundraiserCount)}</td><td>${money(r.broadcastDollars)}</td><td>${num(r.broadcastPledges)}</td><td>${money(r.broadcastDollarsPerHour)}</td><td>${money(r.pledgedDollars)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td></tr>`),
      { minWidth: 1050 }
    );
  }

  function renderQuality(s) {
    const q = s.mappingQuality;
    const issues = s.mappedRows.filter((r)=>r.issues?.length);
    const unmapped = s.mappedRows.filter((r)=>r.mappingConfidence==='Unmapped');
    $('#premium-quality').innerHTML = `<div class="premium-quality-grid">
      <article><strong>${num(q['Historically verified']||0)}</strong><span>Historically verified</span></article>
      <article><strong>${num(q['Current-offer proxy']||0)}</strong><span>Current-offer proxy</span></article>
      <article><strong>${num(q['Strongly inferred']||0)}</strong><span>Strongly inferred</span></article>
      <article><strong>${num(q.Unmapped||0)}</strong><span>Unmapped</span></article>
    </div>
    ${issues.length ? `<p class="premium-note"><strong>${issues.length}</strong> exact premium rows have source-data warnings: ${esc([...new Set(issues.flatMap((r)=>r.issues))].join('; '))}.</p>` : '<p class="premium-note">No source-data warnings in the currently selected exact-premium rows.</p>'}
    ${unmapped.length ? table(['Unmapped exact premium','Fundraiser','Categories','Pledges','Pledged'], unmapped.map((r)=>`<tr><td><strong>${esc(r.description)}</strong></td><td>${esc(r.fundraiserLabel)}</td><td>${esc((r.componentCategories||[]).join(', '))}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td></tr>`), {minWidth:800}) : ''}`;
  }

  function updateFundraiserOptions(snapshot) {
    const select = $('#premium-fundraiser-filter');
    if (!select) return;
    const previous = select.value;
    const options = snapshot.imports.map((item)=>`<option value="${esc(item.fundraiser.key)}">${esc(item.fundraiser.label)}</option>`).join('');
    select.innerHTML = `<option value="all">All imported fundraisers</option>${options}`;
    if ([...select.options].some((option)=>option.value===previous)) select.value=previous;
  }

  function render() {
    const all = D.snapshot();
    updateFundraiserOptions(all);
    const s = filtered(all);
    $('#premium-import-count').textContent = `${all.imports.length} fundraiser report${all.imports.length===1?'':'s'} stored in this browser`;
    renderOverview(s);
    renderFundraisers(s);
    renderCategories(s);
    renderCompositions(s);
    renderPackages(s);
    renderMapped(s);
    renderCombined(s);
    renderQuality(s);
  }

  async function init() {
    try {
      if (!A || !D) throw new Error('Premium analytics modules did not load.');
      const allowed = await D.requireAdmin({ gateId:'premium-access-gate', appId:'premium-app', roleId:'premium-role' });
      if (!allowed) return;
      setStatus('Loading Program Library and fundraiser analytics…');
      await D.loadExistingAnalytics();
      render();
      setStatus(D.state.imports.length ? 'Premium analytics ready.' : 'Import the eight premium-cost reports to start the proof of concept.', D.state.imports.length ? 'good' : 'warn');

      $('#premium-file-input')?.addEventListener('change', async (event) => {
        const files = [...(event.target.files || [])];
        if (!files.length) return;
        try {
          setStatus(`Importing ${files.length} premium-cost report${files.length===1?'':'s'}…`);
          const parsed = await D.importFiles(files);
          render();
          setStatus(`Imported ${parsed.length} report${parsed.length===1?'':'s'}. Exact packages remain tied to their fundraiser.`, 'good');
          event.target.value = '';
        } catch (error) {
          console.error(error);
          setStatus(error?.message || 'Premium-cost import failed.', 'error');
        }
      });
      $('#premium-fundraiser-filter')?.addEventListener('change', render);
      $('#premium-refresh-library')?.addEventListener('click', async () => {
        try { setStatus('Refreshing Program Library and fundraiser analytics…'); await D.loadExistingAnalytics(); render(); setStatus('Program and topic context refreshed.', 'good'); }
        catch (error) { console.error(error); setStatus(error?.message || 'Refresh failed.', 'error'); }
      });
      $('#premium-clear')?.addEventListener('click', () => {
        if (!window.confirm('Clear only the browser-stored premium analytics imports? Existing WNMU pledge/program data will not be changed.')) return;
        D.clearStoredImports();
        render();
        setStatus('Browser-stored premium analytics data cleared. Existing pledge/program data was untouched.', 'good');
      });
    } catch (error) {
      console.error(error);
      setStatus(error?.message || 'Premium analytics could not start.', 'error');
    }
  }

  document.addEventListener('DOMContentLoaded', init, { once:true });
})();
,'Net after premium','Avg premium pledge','Avg no-premium pledge','Unitemized'],
      s.fundraiserAnalysis.map((r)=>`<tr><td><strong>${esc(r.label)}</strong></td><td>${money(r.totalPledged)}</td><td>${num(r.totalPledges)}</td><td>${pct(r.premiumTakeRate)}</td><td>${money(r.anyPremiumDollars)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.premiumCostPercentOfTotal)}</td><td>${money(r.averagePremiumPledge)}</td><td>${money(r.averageNoPremiumPledge)}</td><td>${num(r.unitemizedPremiumPledges)} / ${money(r.unitemizedPremiumDollars)}</td></tr>`),
      { minWidth: 1150 }
    );
  }

  function renderCategories(s) {
    const max = Math.max(1, ...s.categories.map((r)=>Number(r.pledgedDollars)||0));
    $('#premium-category-chart').innerHTML = s.categories.length ? `<div class="premium-bars">${s.categories.slice(0,12).map((r)=>`<div class="premium-bar-row"><div class="premium-bar-label">${esc(r.category)}</div><div class="premium-bar-track"><span style="width:${Math.max(2,(r.pledgedDollars/max)*100).toFixed(1)}%"></span></div><strong>${money(r.pledgedDollars)}</strong></div>`).join('')}</div>` : '<div class="premium-empty">No category data.</div>';
    $('#premium-category-table').innerHTML = table(
      ['Category tag','Packages','Fundraisers','Pledges','Pledged','Avg pledge','Premium cost','Cost %'],
      s.categories.map((r)=>`<tr><td><strong>${esc(r.category)}</strong></td><td>${num(r.distinctPackages)}</td><td>${num(r.fundraiserCount)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.averagePledge)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td></tr>`),
      { minWidth: 850 }
    );
  }

  function renderCompositions(s) {
    $('#premium-composition-table').innerHTML = table(
      ['Package composition','Exact packages','Titles','Fundraisers','Pledges','Pledged','Avg pledge','Premium cost','Cost %','Confidence'],
      (s.compositions || []).map((r)=>`<tr><td><strong>${esc(r.label)}</strong></td><td>${num(r.distinctPackages)}</td><td>${num(r.distinctTitles)}</td><td>${num(r.fundraiserCount)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.averagePledge)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td><td>${r.complete ? 'Complete' : 'Partial / inferred'}</td></tr>`),
      { minWidth: 1150 }
    );
  }

  function renderPackages(s) {
    $('#premium-package-table').innerHTML = table(
      ['Fundraiser','Exact premium / package','Package composition','Pledges','Pledged','Avg pledge','Reported cost','Cost %','Est. net'],
      s.packages.map((r)=>`<tr><td>${esc(r.fundraiserLabel)}</td><td><strong>${esc(r.description)}</strong>${r.stationBranded ? '<span class="premium-inline-flag">WNMU</span>' : ''}</td><td>${esc(r.packageCompositionLabel || '—')}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.averagePledge)}</td><td>${money(r.totalPremiumCost,2)}</td><td>${pct(r.costPercentOfPledged)}</td><td>${money(r.estimatedNetAfterPremium)}</td></tr>`),
      { minWidth: 1200 }
    );
  }

  function renderMapped(s) {
    $('#premium-program-table').innerHTML = table(
      ['Program','Fundraisers','Packages','Pledges','Premium-linked $','Reported cost','Cost %'],
      s.programs.map((r)=>`<tr><td><strong>${esc(r.label)}</strong></td><td>${num(r.fundraiserCount)}</td><td>${num(r.exactPremiumCount)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td></tr>`),
      { minWidth: 900 }
    );
    $('#premium-topic-table').innerHTML = table(
      ['Topic','Fundraisers','Packages','Pledges','Premium-linked $','Reported cost','Cost %'],
      s.topics.filter((r)=>r.label).map((r)=>`<tr><td><strong>${esc(r.label)}</strong></td><td>${num(r.fundraiserCount)}</td><td>${num(r.exactPremiumCount)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td></tr>`),
      { minWidth: 900 }
    );
  }

  function renderCombined(s) {
    const status = $('#premium-combined-status');
    if (status) status.textContent = 'Broadcast performance comes from the existing fundraiser analytics. Premium-linked dollars remain a separate measure so unlike scopes are not silently added together.';
    $('#premium-combined-program-table').innerHTML = table(
      ['Fundraiser','Program','Topic','Broadcast $','Broadcast pledges','$ / pledge hr','Premium-linked $','Premium pledges','Premium cost','Mapping'],
      s.combinedPrograms.filter((r)=>r.premiumPackages || r.broadcastDollars).map((r)=>`<tr><td>${esc(r.fundraiserLabel)}</td><td><strong>${esc(r.programTitle)}</strong></td><td>${esc(r.topicPrimary||'—')}</td><td>${money(r.broadcastDollars)}</td><td>${num(r.broadcastPledges)}</td><td>${money(r.broadcastDollarsPerHour)}</td><td>${r.premiumPackages ? money(r.pledgedDollars) : '—'}</td><td>${r.premiumPackages ? num(r.pledgeCount) : '—'}</td><td>${r.premiumPackages ? money(r.totalPremiumCost) : '—'}</td><td>${r.mappingConfidence?.length ? r.mappingConfidence.map(badge).join(' ') : '—'}</td></tr>`),
      { minWidth: 1250 }
    );
    $('#premium-combined-topic-table').innerHTML = table(
      ['Topic','Fundraisers','Broadcast $','Broadcast pledges','$ / pledge hr','Premium-linked $','Premium pledges','Premium cost','Cost %'],
      s.combinedTopics.map((r)=>`<tr><td><strong>${esc(r.topic)}</strong></td><td>${num(r.fundraiserCount)}</td><td>${money(r.broadcastDollars)}</td><td>${num(r.broadcastPledges)}</td><td>${money(r.broadcastDollarsPerHour)}</td><td>${money(r.pledgedDollars)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td></tr>`),
      { minWidth: 1050 }
    );
  }

  function renderQuality(s) {
    const q = s.mappingQuality;
    const issues = s.mappedRows.filter((r)=>r.issues?.length);
    const unmapped = s.mappedRows.filter((r)=>r.mappingConfidence==='Unmapped');
    $('#premium-quality').innerHTML = `<div class="premium-quality-grid">
      <article><strong>${num(q['Historically verified']||0)}</strong><span>Historically verified</span></article>
      <article><strong>${num(q['Current-offer proxy']||0)}</strong><span>Current-offer proxy</span></article>
      <article><strong>${num(q['Strongly inferred']||0)}</strong><span>Strongly inferred</span></article>
      <article><strong>${num(q.Unmapped||0)}</strong><span>Unmapped</span></article>
    </div>
    ${issues.length ? `<p class="premium-note"><strong>${issues.length}</strong> exact premium rows have source-data warnings: ${esc([...new Set(issues.flatMap((r)=>r.issues))].join('; '))}.</p>` : '<p class="premium-note">No source-data warnings in the currently selected exact-premium rows.</p>'}
    ${unmapped.length ? table(['Unmapped exact premium','Fundraiser','Categories','Pledges','Pledged'], unmapped.map((r)=>`<tr><td><strong>${esc(r.description)}</strong></td><td>${esc(r.fundraiserLabel)}</td><td>${esc((r.componentCategories||[]).join(', '))}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td></tr>`), {minWidth:800}) : ''}`;
  }

  function updateFundraiserOptions(snapshot) {
    const select = $('#premium-fundraiser-filter');
    if (!select) return;
    const previous = select.value;
    const options = snapshot.imports.map((item)=>`<option value="${esc(item.fundraiser.key)}">${esc(item.fundraiser.label)}</option>`).join('');
    select.innerHTML = `<option value="all">All imported fundraisers</option>${options}`;
    if ([...select.options].some((option)=>option.value===previous)) select.value=previous;
  }

  function render() {
    const all = D.snapshot();
    updateFundraiserOptions(all);
    const s = filtered(all);
    $('#premium-import-count').textContent = `${all.imports.length} fundraiser report${all.imports.length===1?'':'s'} stored in this browser`;
    renderOverview(s);
    renderFundraisers(s);
    renderCategories(s);
    renderCompositions(s);
    renderPackages(s);
    renderMapped(s);
    renderCombined(s);
    renderQuality(s);
  }

  async function init() {
    try {
      if (!A || !D) throw new Error('Premium analytics modules did not load.');
      const allowed = await D.requireAdmin({ gateId:'premium-access-gate', appId:'premium-app', roleId:'premium-role' });
      if (!allowed) return;
      setStatus('Loading Program Library and fundraiser analytics…');
      await D.loadExistingAnalytics();
      render();
      setStatus(D.state.imports.length ? 'Premium analytics ready.' : 'Import the eight premium-cost reports to start the proof of concept.', D.state.imports.length ? 'good' : 'warn');

      $('#premium-file-input')?.addEventListener('change', async (event) => {
        const files = [...(event.target.files || [])];
        if (!files.length) return;
        try {
          setStatus(`Importing ${files.length} premium-cost report${files.length===1?'':'s'}…`);
          const parsed = await D.importFiles(files);
          render();
          setStatus(`Imported ${parsed.length} report${parsed.length===1?'':'s'}. Exact packages remain tied to their fundraiser.`, 'good');
          event.target.value = '';
        } catch (error) {
          console.error(error);
          setStatus(error?.message || 'Premium-cost import failed.', 'error');
        }
      });
      $('#premium-fundraiser-filter')?.addEventListener('change', render);
      $('#premium-refresh-library')?.addEventListener('click', async () => {
        try { setStatus('Refreshing Program Library and fundraiser analytics…'); await D.loadExistingAnalytics(); render(); setStatus('Program and topic context refreshed.', 'good'); }
        catch (error) { console.error(error); setStatus(error?.message || 'Refresh failed.', 'error'); }
      });
      $('#premium-clear')?.addEventListener('click', () => {
        if (!window.confirm('Clear only the browser-stored premium analytics imports? Existing WNMU pledge/program data will not be changed.')) return;
        D.clearStoredImports();
        render();
        setStatus('Browser-stored premium analytics data cleared. Existing pledge/program data was untouched.', 'good');
      });
    } catch (error) {
      console.error(error);
      setStatus(error?.message || 'Premium analytics could not start.', 'error');
    }
  }

  document.addEventListener('DOMContentLoaded', init, { once:true });
})();
,'Reported cost','Cost %','Net after premium'],
      s.programs.map((r)=>`<tr><td><strong>${esc(r.label)}</strong></td><td>${num(r.fundraiserCount)}</td><td>${num(r.exactPremiumCount)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td></tr>`),
      { minWidth: 900 }
    );
    $('#premium-topic-table').innerHTML = table(
      ['Topic','Fundraisers','Packages','Pledges','Premium-linked $','Reported cost','Cost %'],
      s.topics.filter((r)=>r.label).map((r)=>`<tr><td><strong>${esc(r.label)}</strong></td><td>${num(r.fundraiserCount)}</td><td>${num(r.exactPremiumCount)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td></tr>`),
      { minWidth: 900 }
    );
  }

  function renderCombined(s) {
    const status = $('#premium-combined-status');
    if (status) status.textContent = 'Broadcast performance comes from the existing fundraiser analytics. Premium-linked dollars remain a separate measure so unlike scopes are not silently added together.';
    $('#premium-combined-program-table').innerHTML = table(
      ['Fundraiser','Program','Topic','Broadcast $','Broadcast pledges','$ / pledge hr','Premium-linked $','Premium pledges','Premium cost','Mapping'],
      s.combinedPrograms.filter((r)=>r.premiumPackages || r.broadcastDollars).map((r)=>`<tr><td>${esc(r.fundraiserLabel)}</td><td><strong>${esc(r.programTitle)}</strong></td><td>${esc(r.topicPrimary||'—')}</td><td>${money(r.broadcastDollars)}</td><td>${num(r.broadcastPledges)}</td><td>${money(r.broadcastDollarsPerHour)}</td><td>${r.premiumPackages ? money(r.pledgedDollars) : '—'}</td><td>${r.premiumPackages ? num(r.pledgeCount) : '—'}</td><td>${r.premiumPackages ? money(r.totalPremiumCost) : '—'}</td><td>${r.mappingConfidence?.length ? r.mappingConfidence.map(badge).join(' ') : '—'}</td></tr>`),
      { minWidth: 1250 }
    );
    $('#premium-combined-topic-table').innerHTML = table(
      ['Topic','Fundraisers','Broadcast $','Broadcast pledges','$ / pledge hr','Premium-linked $','Premium pledges','Premium cost','Cost %'],
      s.combinedTopics.map((r)=>`<tr><td><strong>${esc(r.topic)}</strong></td><td>${num(r.fundraiserCount)}</td><td>${money(r.broadcastDollars)}</td><td>${num(r.broadcastPledges)}</td><td>${money(r.broadcastDollarsPerHour)}</td><td>${money(r.pledgedDollars)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td></tr>`),
      { minWidth: 1050 }
    );
  }

  function renderQuality(s) {
    const q = s.mappingQuality;
    const issues = s.mappedRows.filter((r)=>r.issues?.length);
    const unmapped = s.mappedRows.filter((r)=>r.mappingConfidence==='Unmapped');
    $('#premium-quality').innerHTML = `<div class="premium-quality-grid">
      <article><strong>${num(q['Historically verified']||0)}</strong><span>Historically verified</span></article>
      <article><strong>${num(q['Current-offer proxy']||0)}</strong><span>Current-offer proxy</span></article>
      <article><strong>${num(q['Strongly inferred']||0)}</strong><span>Strongly inferred</span></article>
      <article><strong>${num(q.Unmapped||0)}</strong><span>Unmapped</span></article>
    </div>
    ${issues.length ? `<p class="premium-note"><strong>${issues.length}</strong> exact premium rows have source-data warnings: ${esc([...new Set(issues.flatMap((r)=>r.issues))].join('; '))}.</p>` : '<p class="premium-note">No source-data warnings in the currently selected exact-premium rows.</p>'}
    ${unmapped.length ? table(['Unmapped exact premium','Fundraiser','Categories','Pledges','Pledged'], unmapped.map((r)=>`<tr><td><strong>${esc(r.description)}</strong></td><td>${esc(r.fundraiserLabel)}</td><td>${esc((r.componentCategories||[]).join(', '))}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td></tr>`), {minWidth:800}) : ''}`;
  }

  function updateFundraiserOptions(snapshot) {
    const select = $('#premium-fundraiser-filter');
    if (!select) return;
    const previous = select.value;
    const options = snapshot.imports.map((item)=>`<option value="${esc(item.fundraiser.key)}">${esc(item.fundraiser.label)}</option>`).join('');
    select.innerHTML = `<option value="all">All imported fundraisers</option>${options}`;
    if ([...select.options].some((option)=>option.value===previous)) select.value=previous;
  }

  function render() {
    const all = D.snapshot();
    updateFundraiserOptions(all);
    const s = filtered(all);
    $('#premium-import-count').textContent = `${all.imports.length} fundraiser report${all.imports.length===1?'':'s'} stored in this browser`;
    renderOverview(s);
    renderFundraisers(s);
    renderCategories(s);
    renderCompositions(s);
    renderPackages(s);
    renderMapped(s);
    renderCombined(s);
    renderQuality(s);
  }

  async function init() {
    try {
      if (!A || !D) throw new Error('Premium analytics modules did not load.');
      const allowed = await D.requireAdmin({ gateId:'premium-access-gate', appId:'premium-app', roleId:'premium-role' });
      if (!allowed) return;
      setStatus('Loading Program Library and fundraiser analytics…');
      await D.loadExistingAnalytics();
      render();
      setStatus(D.state.imports.length ? 'Premium analytics ready.' : 'Import the eight premium-cost reports to start the proof of concept.', D.state.imports.length ? 'good' : 'warn');

      $('#premium-file-input')?.addEventListener('change', async (event) => {
        const files = [...(event.target.files || [])];
        if (!files.length) return;
        try {
          setStatus(`Importing ${files.length} premium-cost report${files.length===1?'':'s'}…`);
          const parsed = await D.importFiles(files);
          render();
          setStatus(`Imported ${parsed.length} report${parsed.length===1?'':'s'}. Exact packages remain tied to their fundraiser.`, 'good');
          event.target.value = '';
        } catch (error) {
          console.error(error);
          setStatus(error?.message || 'Premium-cost import failed.', 'error');
        }
      });
      $('#premium-fundraiser-filter')?.addEventListener('change', render);
      $('#premium-refresh-library')?.addEventListener('click', async () => {
        try { setStatus('Refreshing Program Library and fundraiser analytics…'); await D.loadExistingAnalytics(); render(); setStatus('Program and topic context refreshed.', 'good'); }
        catch (error) { console.error(error); setStatus(error?.message || 'Refresh failed.', 'error'); }
      });
      $('#premium-clear')?.addEventListener('click', () => {
        if (!window.confirm('Clear only the browser-stored premium analytics imports? Existing WNMU pledge/program data will not be changed.')) return;
        D.clearStoredImports();
        render();
        setStatus('Browser-stored premium analytics data cleared. Existing pledge/program data was untouched.', 'good');
      });
    } catch (error) {
      console.error(error);
      setStatus(error?.message || 'Premium analytics could not start.', 'error');
    }
  }

  document.addEventListener('DOMContentLoaded', init, { once:true });
})();
,'Premium cost','Cost / total 
      s.fundraiserAnalysis.map((r)=>`<tr><td><strong>${esc(r.label)}</strong></td><td>${money(r.totalPledged)}</td><td>${num(r.totalPledges)}</td><td>${pct(r.premiumTakeRate)}</td><td>${money(r.anyPremiumDollars)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.premiumCostPercentOfTotal)}</td><td>${money(r.averagePremiumPledge)}</td><td>${money(r.averageNoPremiumPledge)}</td><td>${num(r.unitemizedPremiumPledges)} / ${money(r.unitemizedPremiumDollars)}</td></tr>`),
      { minWidth: 1150 }
    );
  }

  function renderCategories(s) {
    const max = Math.max(1, ...s.categories.map((r)=>Number(r.pledgedDollars)||0));
    $('#premium-category-chart').innerHTML = s.categories.length ? `<div class="premium-bars">${s.categories.slice(0,12).map((r)=>`<div class="premium-bar-row"><div class="premium-bar-label">${esc(r.category)}</div><div class="premium-bar-track"><span style="width:${Math.max(2,(r.pledgedDollars/max)*100).toFixed(1)}%"></span></div><strong>${money(r.pledgedDollars)}</strong></div>`).join('')}</div>` : '<div class="premium-empty">No category data.</div>';
    $('#premium-category-table').innerHTML = table(
      ['Category tag','Packages','Fundraisers','Pledges','Pledged','Avg pledge','Premium cost','Cost %'],
      s.categories.map((r)=>`<tr><td><strong>${esc(r.category)}</strong></td><td>${num(r.distinctPackages)}</td><td>${num(r.fundraiserCount)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.averagePledge)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td></tr>`),
      { minWidth: 850 }
    );
  }

  function renderCompositions(s) {
    $('#premium-composition-table').innerHTML = table(
      ['Package composition','Exact packages','Titles','Fundraisers','Pledges','Pledged','Avg pledge','Premium cost','Cost %','Confidence'],
      (s.compositions || []).map((r)=>`<tr><td><strong>${esc(r.label)}</strong></td><td>${num(r.distinctPackages)}</td><td>${num(r.distinctTitles)}</td><td>${num(r.fundraiserCount)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.averagePledge)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td><td>${r.complete ? 'Complete' : 'Partial / inferred'}</td></tr>`),
      { minWidth: 1150 }
    );
  }

  function renderPackages(s) {
    $('#premium-package-table').innerHTML = table(
      ['Fundraiser','Exact premium / package','Package composition','Pledges','Pledged','Avg pledge','Reported cost','Cost %','Est. net'],
      s.packages.map((r)=>`<tr><td>${esc(r.fundraiserLabel)}</td><td><strong>${esc(r.description)}</strong>${r.stationBranded ? '<span class="premium-inline-flag">WNMU</span>' : ''}</td><td>${esc(r.packageCompositionLabel || '—')}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.averagePledge)}</td><td>${money(r.totalPremiumCost,2)}</td><td>${pct(r.costPercentOfPledged)}</td><td>${money(r.estimatedNetAfterPremium)}</td></tr>`),
      { minWidth: 1200 }
    );
  }

  function renderMapped(s) {
    $('#premium-program-table').innerHTML = table(
      ['Program','Fundraisers','Packages','Pledges','Premium-linked $','Reported cost','Cost %'],
      s.programs.map((r)=>`<tr><td><strong>${esc(r.label)}</strong></td><td>${num(r.fundraiserCount)}</td><td>${num(r.exactPremiumCount)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td></tr>`),
      { minWidth: 900 }
    );
    $('#premium-topic-table').innerHTML = table(
      ['Topic','Fundraisers','Packages','Pledges','Premium-linked $','Reported cost','Cost %'],
      s.topics.filter((r)=>r.label).map((r)=>`<tr><td><strong>${esc(r.label)}</strong></td><td>${num(r.fundraiserCount)}</td><td>${num(r.exactPremiumCount)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td></tr>`),
      { minWidth: 900 }
    );
  }

  function renderCombined(s) {
    const status = $('#premium-combined-status');
    if (status) status.textContent = 'Broadcast performance comes from the existing fundraiser analytics. Premium-linked dollars remain a separate measure so unlike scopes are not silently added together.';
    $('#premium-combined-program-table').innerHTML = table(
      ['Fundraiser','Program','Topic','Broadcast $','Broadcast pledges','$ / pledge hr','Premium-linked $','Premium pledges','Premium cost','Mapping'],
      s.combinedPrograms.filter((r)=>r.premiumPackages || r.broadcastDollars).map((r)=>`<tr><td>${esc(r.fundraiserLabel)}</td><td><strong>${esc(r.programTitle)}</strong></td><td>${esc(r.topicPrimary||'—')}</td><td>${money(r.broadcastDollars)}</td><td>${num(r.broadcastPledges)}</td><td>${money(r.broadcastDollarsPerHour)}</td><td>${r.premiumPackages ? money(r.pledgedDollars) : '—'}</td><td>${r.premiumPackages ? num(r.pledgeCount) : '—'}</td><td>${r.premiumPackages ? money(r.totalPremiumCost) : '—'}</td><td>${r.mappingConfidence?.length ? r.mappingConfidence.map(badge).join(' ') : '—'}</td></tr>`),
      { minWidth: 1250 }
    );
    $('#premium-combined-topic-table').innerHTML = table(
      ['Topic','Fundraisers','Broadcast $','Broadcast pledges','$ / pledge hr','Premium-linked $','Premium pledges','Premium cost','Cost %'],
      s.combinedTopics.map((r)=>`<tr><td><strong>${esc(r.topic)}</strong></td><td>${num(r.fundraiserCount)}</td><td>${money(r.broadcastDollars)}</td><td>${num(r.broadcastPledges)}</td><td>${money(r.broadcastDollarsPerHour)}</td><td>${money(r.pledgedDollars)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td></tr>`),
      { minWidth: 1050 }
    );
  }

  function renderQuality(s) {
    const q = s.mappingQuality;
    const issues = s.mappedRows.filter((r)=>r.issues?.length);
    const unmapped = s.mappedRows.filter((r)=>r.mappingConfidence==='Unmapped');
    $('#premium-quality').innerHTML = `<div class="premium-quality-grid">
      <article><strong>${num(q['Historically verified']||0)}</strong><span>Historically verified</span></article>
      <article><strong>${num(q['Current-offer proxy']||0)}</strong><span>Current-offer proxy</span></article>
      <article><strong>${num(q['Strongly inferred']||0)}</strong><span>Strongly inferred</span></article>
      <article><strong>${num(q.Unmapped||0)}</strong><span>Unmapped</span></article>
    </div>
    ${issues.length ? `<p class="premium-note"><strong>${issues.length}</strong> exact premium rows have source-data warnings: ${esc([...new Set(issues.flatMap((r)=>r.issues))].join('; '))}.</p>` : '<p class="premium-note">No source-data warnings in the currently selected exact-premium rows.</p>'}
    ${unmapped.length ? table(['Unmapped exact premium','Fundraiser','Categories','Pledges','Pledged'], unmapped.map((r)=>`<tr><td><strong>${esc(r.description)}</strong></td><td>${esc(r.fundraiserLabel)}</td><td>${esc((r.componentCategories||[]).join(', '))}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td></tr>`), {minWidth:800}) : ''}`;
  }

  function updateFundraiserOptions(snapshot) {
    const select = $('#premium-fundraiser-filter');
    if (!select) return;
    const previous = select.value;
    const options = snapshot.imports.map((item)=>`<option value="${esc(item.fundraiser.key)}">${esc(item.fundraiser.label)}</option>`).join('');
    select.innerHTML = `<option value="all">All imported fundraisers</option>${options}`;
    if ([...select.options].some((option)=>option.value===previous)) select.value=previous;
  }

  function render() {
    const all = D.snapshot();
    updateFundraiserOptions(all);
    const s = filtered(all);
    $('#premium-import-count').textContent = `${all.imports.length} fundraiser report${all.imports.length===1?'':'s'} stored in this browser`;
    renderOverview(s);
    renderFundraisers(s);
    renderCategories(s);
    renderCompositions(s);
    renderPackages(s);
    renderMapped(s);
    renderCombined(s);
    renderQuality(s);
  }

  async function init() {
    try {
      if (!A || !D) throw new Error('Premium analytics modules did not load.');
      const allowed = await D.requireAdmin({ gateId:'premium-access-gate', appId:'premium-app', roleId:'premium-role' });
      if (!allowed) return;
      setStatus('Loading Program Library and fundraiser analytics…');
      await D.loadExistingAnalytics();
      render();
      setStatus(D.state.imports.length ? 'Premium analytics ready.' : 'Import the eight premium-cost reports to start the proof of concept.', D.state.imports.length ? 'good' : 'warn');

      $('#premium-file-input')?.addEventListener('change', async (event) => {
        const files = [...(event.target.files || [])];
        if (!files.length) return;
        try {
          setStatus(`Importing ${files.length} premium-cost report${files.length===1?'':'s'}…`);
          const parsed = await D.importFiles(files);
          render();
          setStatus(`Imported ${parsed.length} report${parsed.length===1?'':'s'}. Exact packages remain tied to their fundraiser.`, 'good');
          event.target.value = '';
        } catch (error) {
          console.error(error);
          setStatus(error?.message || 'Premium-cost import failed.', 'error');
        }
      });
      $('#premium-fundraiser-filter')?.addEventListener('change', render);
      $('#premium-refresh-library')?.addEventListener('click', async () => {
        try { setStatus('Refreshing Program Library and fundraiser analytics…'); await D.loadExistingAnalytics(); render(); setStatus('Program and topic context refreshed.', 'good'); }
        catch (error) { console.error(error); setStatus(error?.message || 'Refresh failed.', 'error'); }
      });
      $('#premium-clear')?.addEventListener('click', () => {
        if (!window.confirm('Clear only the browser-stored premium analytics imports? Existing WNMU pledge/program data will not be changed.')) return;
        D.clearStoredImports();
        render();
        setStatus('Browser-stored premium analytics data cleared. Existing pledge/program data was untouched.', 'good');
      });
    } catch (error) {
      console.error(error);
      setStatus(error?.message || 'Premium analytics could not start.', 'error');
    }
  }

  document.addEventListener('DOMContentLoaded', init, { once:true });
})();
,'Net after premium','Avg premium pledge','Avg no-premium pledge','Unitemized'],
      s.fundraiserAnalysis.map((r)=>`<tr><td><strong>${esc(r.label)}</strong></td><td>${money(r.totalPledged)}</td><td>${num(r.totalPledges)}</td><td>${pct(r.premiumTakeRate)}</td><td>${money(r.anyPremiumDollars)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.premiumCostPercentOfTotal)}</td><td>${money(r.averagePremiumPledge)}</td><td>${money(r.averageNoPremiumPledge)}</td><td>${num(r.unitemizedPremiumPledges)} / ${money(r.unitemizedPremiumDollars)}</td></tr>`),
      { minWidth: 1150 }
    );
  }

  function renderCategories(s) {
    const max = Math.max(1, ...s.categories.map((r)=>Number(r.pledgedDollars)||0));
    $('#premium-category-chart').innerHTML = s.categories.length ? `<div class="premium-bars">${s.categories.slice(0,12).map((r)=>`<div class="premium-bar-row"><div class="premium-bar-label">${esc(r.category)}</div><div class="premium-bar-track"><span style="width:${Math.max(2,(r.pledgedDollars/max)*100).toFixed(1)}%"></span></div><strong>${money(r.pledgedDollars)}</strong></div>`).join('')}</div>` : '<div class="premium-empty">No category data.</div>';
    $('#premium-category-table').innerHTML = table(
      ['Category tag','Packages','Fundraisers','Pledges','Pledged','Avg pledge','Premium cost','Cost %'],
      s.categories.map((r)=>`<tr><td><strong>${esc(r.category)}</strong></td><td>${num(r.distinctPackages)}</td><td>${num(r.fundraiserCount)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.averagePledge)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td></tr>`),
      { minWidth: 850 }
    );
  }

  function renderCompositions(s) {
    $('#premium-composition-table').innerHTML = table(
      ['Package composition','Exact packages','Titles','Fundraisers','Pledges','Pledged','Avg pledge','Premium cost','Cost %','Confidence'],
      (s.compositions || []).map((r)=>`<tr><td><strong>${esc(r.label)}</strong></td><td>${num(r.distinctPackages)}</td><td>${num(r.distinctTitles)}</td><td>${num(r.fundraiserCount)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.averagePledge)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td><td>${r.complete ? 'Complete' : 'Partial / inferred'}</td></tr>`),
      { minWidth: 1150 }
    );
  }

  function renderPackages(s) {
    $('#premium-package-table').innerHTML = table(
      ['Fundraiser','Exact premium / package','Package composition','Pledges','Pledged','Avg pledge','Reported cost','Cost %','Est. net'],
      s.packages.map((r)=>`<tr><td>${esc(r.fundraiserLabel)}</td><td><strong>${esc(r.description)}</strong>${r.stationBranded ? '<span class="premium-inline-flag">WNMU</span>' : ''}</td><td>${esc(r.packageCompositionLabel || '—')}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.averagePledge)}</td><td>${money(r.totalPremiumCost,2)}</td><td>${pct(r.costPercentOfPledged)}</td><td>${money(r.estimatedNetAfterPremium)}</td></tr>`),
      { minWidth: 1200 }
    );
  }

  function renderMapped(s) {
    $('#premium-program-table').innerHTML = table(
      ['Program','Fundraisers','Packages','Pledges','Premium-linked $','Reported cost','Cost %'],
      s.programs.map((r)=>`<tr><td><strong>${esc(r.label)}</strong></td><td>${num(r.fundraiserCount)}</td><td>${num(r.exactPremiumCount)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td></tr>`),
      { minWidth: 900 }
    );
    $('#premium-topic-table').innerHTML = table(
      ['Topic','Fundraisers','Packages','Pledges','Premium-linked $','Reported cost','Cost %'],
      s.topics.filter((r)=>r.label).map((r)=>`<tr><td><strong>${esc(r.label)}</strong></td><td>${num(r.fundraiserCount)}</td><td>${num(r.exactPremiumCount)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td></tr>`),
      { minWidth: 900 }
    );
  }

  function renderCombined(s) {
    const status = $('#premium-combined-status');
    if (status) status.textContent = 'Broadcast performance comes from the existing fundraiser analytics. Premium-linked dollars remain a separate measure so unlike scopes are not silently added together.';
    $('#premium-combined-program-table').innerHTML = table(
      ['Fundraiser','Program','Topic','Broadcast $','Broadcast pledges','$ / pledge hr','Premium-linked $','Premium pledges','Premium cost','Mapping'],
      s.combinedPrograms.filter((r)=>r.premiumPackages || r.broadcastDollars).map((r)=>`<tr><td>${esc(r.fundraiserLabel)}</td><td><strong>${esc(r.programTitle)}</strong></td><td>${esc(r.topicPrimary||'—')}</td><td>${money(r.broadcastDollars)}</td><td>${num(r.broadcastPledges)}</td><td>${money(r.broadcastDollarsPerHour)}</td><td>${r.premiumPackages ? money(r.pledgedDollars) : '—'}</td><td>${r.premiumPackages ? num(r.pledgeCount) : '—'}</td><td>${r.premiumPackages ? money(r.totalPremiumCost) : '—'}</td><td>${r.mappingConfidence?.length ? r.mappingConfidence.map(badge).join(' ') : '—'}</td></tr>`),
      { minWidth: 1250 }
    );
    $('#premium-combined-topic-table').innerHTML = table(
      ['Topic','Fundraisers','Broadcast $','Broadcast pledges','$ / pledge hr','Premium-linked $','Premium pledges','Premium cost','Cost %'],
      s.combinedTopics.map((r)=>`<tr><td><strong>${esc(r.topic)}</strong></td><td>${num(r.fundraiserCount)}</td><td>${money(r.broadcastDollars)}</td><td>${num(r.broadcastPledges)}</td><td>${money(r.broadcastDollarsPerHour)}</td><td>${money(r.pledgedDollars)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td></tr>`),
      { minWidth: 1050 }
    );
  }

  function renderQuality(s) {
    const q = s.mappingQuality;
    const issues = s.mappedRows.filter((r)=>r.issues?.length);
    const unmapped = s.mappedRows.filter((r)=>r.mappingConfidence==='Unmapped');
    $('#premium-quality').innerHTML = `<div class="premium-quality-grid">
      <article><strong>${num(q['Historically verified']||0)}</strong><span>Historically verified</span></article>
      <article><strong>${num(q['Current-offer proxy']||0)}</strong><span>Current-offer proxy</span></article>
      <article><strong>${num(q['Strongly inferred']||0)}</strong><span>Strongly inferred</span></article>
      <article><strong>${num(q.Unmapped||0)}</strong><span>Unmapped</span></article>
    </div>
    ${issues.length ? `<p class="premium-note"><strong>${issues.length}</strong> exact premium rows have source-data warnings: ${esc([...new Set(issues.flatMap((r)=>r.issues))].join('; '))}.</p>` : '<p class="premium-note">No source-data warnings in the currently selected exact-premium rows.</p>'}
    ${unmapped.length ? table(['Unmapped exact premium','Fundraiser','Categories','Pledges','Pledged'], unmapped.map((r)=>`<tr><td><strong>${esc(r.description)}</strong></td><td>${esc(r.fundraiserLabel)}</td><td>${esc((r.componentCategories||[]).join(', '))}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td></tr>`), {minWidth:800}) : ''}`;
  }

  function updateFundraiserOptions(snapshot) {
    const select = $('#premium-fundraiser-filter');
    if (!select) return;
    const previous = select.value;
    const options = snapshot.imports.map((item)=>`<option value="${esc(item.fundraiser.key)}">${esc(item.fundraiser.label)}</option>`).join('');
    select.innerHTML = `<option value="all">All imported fundraisers</option>${options}`;
    if ([...select.options].some((option)=>option.value===previous)) select.value=previous;
  }

  function render() {
    const all = D.snapshot();
    updateFundraiserOptions(all);
    const s = filtered(all);
    $('#premium-import-count').textContent = `${all.imports.length} fundraiser report${all.imports.length===1?'':'s'} stored in this browser`;
    renderOverview(s);
    renderFundraisers(s);
    renderCategories(s);
    renderCompositions(s);
    renderPackages(s);
    renderMapped(s);
    renderCombined(s);
    renderQuality(s);
  }

  async function init() {
    try {
      if (!A || !D) throw new Error('Premium analytics modules did not load.');
      const allowed = await D.requireAdmin({ gateId:'premium-access-gate', appId:'premium-app', roleId:'premium-role' });
      if (!allowed) return;
      setStatus('Loading Program Library and fundraiser analytics…');
      await D.loadExistingAnalytics();
      render();
      setStatus(D.state.imports.length ? 'Premium analytics ready.' : 'Import the eight premium-cost reports to start the proof of concept.', D.state.imports.length ? 'good' : 'warn');

      $('#premium-file-input')?.addEventListener('change', async (event) => {
        const files = [...(event.target.files || [])];
        if (!files.length) return;
        try {
          setStatus(`Importing ${files.length} premium-cost report${files.length===1?'':'s'}…`);
          const parsed = await D.importFiles(files);
          render();
          setStatus(`Imported ${parsed.length} report${parsed.length===1?'':'s'}. Exact packages remain tied to their fundraiser.`, 'good');
          event.target.value = '';
        } catch (error) {
          console.error(error);
          setStatus(error?.message || 'Premium-cost import failed.', 'error');
        }
      });
      $('#premium-fundraiser-filter')?.addEventListener('change', render);
      $('#premium-refresh-library')?.addEventListener('click', async () => {
        try { setStatus('Refreshing Program Library and fundraiser analytics…'); await D.loadExistingAnalytics(); render(); setStatus('Program and topic context refreshed.', 'good'); }
        catch (error) { console.error(error); setStatus(error?.message || 'Refresh failed.', 'error'); }
      });
      $('#premium-clear')?.addEventListener('click', () => {
        if (!window.confirm('Clear only the browser-stored premium analytics imports? Existing WNMU pledge/program data will not be changed.')) return;
        D.clearStoredImports();
        render();
        setStatus('Browser-stored premium analytics data cleared. Existing pledge/program data was untouched.', 'good');
      });
    } catch (error) {
      console.error(error);
      setStatus(error?.message || 'Premium analytics could not start.', 'error');
    }
  }

  document.addEventListener('DOMContentLoaded', init, { once:true });
})();
,'Reported cost','Cost %','Net after premium'],
      s.topics.filter((r)=>r.label).map((r)=>`<tr><td><strong>${esc(r.label)}</strong></td><td>${num(r.fundraiserCount)}</td><td>${num(r.exactPremiumCount)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td></tr>`),
      { minWidth: 900 }
    );
  }

  function renderCombined(s) {
    const status = $('#premium-combined-status');
    if (status) status.textContent = 'Broadcast performance comes from the existing fundraiser analytics. Premium-linked dollars remain a separate measure so unlike scopes are not silently added together.';
    $('#premium-combined-program-table').innerHTML = table(
      ['Fundraiser','Program','Topic','Broadcast $','Broadcast pledges','$ / pledge hr','Premium-linked $','Premium pledges','Premium cost','Mapping'],
      s.combinedPrograms.filter((r)=>r.premiumPackages || r.broadcastDollars).map((r)=>`<tr><td>${esc(r.fundraiserLabel)}</td><td><strong>${esc(r.programTitle)}</strong></td><td>${esc(r.topicPrimary||'—')}</td><td>${money(r.broadcastDollars)}</td><td>${num(r.broadcastPledges)}</td><td>${money(r.broadcastDollarsPerHour)}</td><td>${r.premiumPackages ? money(r.pledgedDollars) : '—'}</td><td>${r.premiumPackages ? num(r.pledgeCount) : '—'}</td><td>${r.premiumPackages ? money(r.totalPremiumCost) : '—'}</td><td>${r.mappingConfidence?.length ? r.mappingConfidence.map(badge).join(' ') : '—'}</td></tr>`),
      { minWidth: 1250 }
    );
    $('#premium-combined-topic-table').innerHTML = table(
      ['Topic','Fundraisers','Broadcast $','Broadcast pledges','$ / pledge hr','Premium-linked $','Premium pledges','Premium cost','Cost %'],
      s.combinedTopics.map((r)=>`<tr><td><strong>${esc(r.topic)}</strong></td><td>${num(r.fundraiserCount)}</td><td>${money(r.broadcastDollars)}</td><td>${num(r.broadcastPledges)}</td><td>${money(r.broadcastDollarsPerHour)}</td><td>${money(r.pledgedDollars)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td></tr>`),
      { minWidth: 1050 }
    );
  }

  function renderQuality(s) {
    const q = s.mappingQuality;
    const issues = s.mappedRows.filter((r)=>r.issues?.length);
    const unmapped = s.mappedRows.filter((r)=>r.mappingConfidence==='Unmapped');
    $('#premium-quality').innerHTML = `<div class="premium-quality-grid">
      <article><strong>${num(q['Historically verified']||0)}</strong><span>Historically verified</span></article>
      <article><strong>${num(q['Current-offer proxy']||0)}</strong><span>Current-offer proxy</span></article>
      <article><strong>${num(q['Strongly inferred']||0)}</strong><span>Strongly inferred</span></article>
      <article><strong>${num(q.Unmapped||0)}</strong><span>Unmapped</span></article>
    </div>
    ${issues.length ? `<p class="premium-note"><strong>${issues.length}</strong> exact premium rows have source-data warnings: ${esc([...new Set(issues.flatMap((r)=>r.issues))].join('; '))}.</p>` : '<p class="premium-note">No source-data warnings in the currently selected exact-premium rows.</p>'}
    ${unmapped.length ? table(['Unmapped exact premium','Fundraiser','Categories','Pledges','Pledged'], unmapped.map((r)=>`<tr><td><strong>${esc(r.description)}</strong></td><td>${esc(r.fundraiserLabel)}</td><td>${esc((r.componentCategories||[]).join(', '))}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td></tr>`), {minWidth:800}) : ''}`;
  }

  function updateFundraiserOptions(snapshot) {
    const select = $('#premium-fundraiser-filter');
    if (!select) return;
    const previous = select.value;
    const options = snapshot.imports.map((item)=>`<option value="${esc(item.fundraiser.key)}">${esc(item.fundraiser.label)}</option>`).join('');
    select.innerHTML = `<option value="all">All imported fundraisers</option>${options}`;
    if ([...select.options].some((option)=>option.value===previous)) select.value=previous;
  }

  function render() {
    const all = D.snapshot();
    updateFundraiserOptions(all);
    const s = filtered(all);
    $('#premium-import-count').textContent = `${all.imports.length} fundraiser report${all.imports.length===1?'':'s'} stored in this browser`;
    renderOverview(s);
    renderFundraisers(s);
    renderCategories(s);
    renderCompositions(s);
    renderPackages(s);
    renderMapped(s);
    renderCombined(s);
    renderQuality(s);
  }

  async function init() {
    try {
      if (!A || !D) throw new Error('Premium analytics modules did not load.');
      const allowed = await D.requireAdmin({ gateId:'premium-access-gate', appId:'premium-app', roleId:'premium-role' });
      if (!allowed) return;
      setStatus('Loading Program Library and fundraiser analytics…');
      await D.loadExistingAnalytics();
      render();
      setStatus(D.state.imports.length ? 'Premium analytics ready.' : 'Import the eight premium-cost reports to start the proof of concept.', D.state.imports.length ? 'good' : 'warn');

      $('#premium-file-input')?.addEventListener('change', async (event) => {
        const files = [...(event.target.files || [])];
        if (!files.length) return;
        try {
          setStatus(`Importing ${files.length} premium-cost report${files.length===1?'':'s'}…`);
          const parsed = await D.importFiles(files);
          render();
          setStatus(`Imported ${parsed.length} report${parsed.length===1?'':'s'}. Exact packages remain tied to their fundraiser.`, 'good');
          event.target.value = '';
        } catch (error) {
          console.error(error);
          setStatus(error?.message || 'Premium-cost import failed.', 'error');
        }
      });
      $('#premium-fundraiser-filter')?.addEventListener('change', render);
      $('#premium-refresh-library')?.addEventListener('click', async () => {
        try { setStatus('Refreshing Program Library and fundraiser analytics…'); await D.loadExistingAnalytics(); render(); setStatus('Program and topic context refreshed.', 'good'); }
        catch (error) { console.error(error); setStatus(error?.message || 'Refresh failed.', 'error'); }
      });
      $('#premium-clear')?.addEventListener('click', () => {
        if (!window.confirm('Clear only the browser-stored premium analytics imports? Existing WNMU pledge/program data will not be changed.')) return;
        D.clearStoredImports();
        render();
        setStatus('Browser-stored premium analytics data cleared. Existing pledge/program data was untouched.', 'good');
      });
    } catch (error) {
      console.error(error);
      setStatus(error?.message || 'Premium analytics could not start.', 'error');
    }
  }

  document.addEventListener('DOMContentLoaded', init, { once:true });
})();
,'Premium cost','Cost / total 
      s.fundraiserAnalysis.map((r)=>`<tr><td><strong>${esc(r.label)}</strong></td><td>${money(r.totalPledged)}</td><td>${num(r.totalPledges)}</td><td>${pct(r.premiumTakeRate)}</td><td>${money(r.anyPremiumDollars)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.premiumCostPercentOfTotal)}</td><td>${money(r.averagePremiumPledge)}</td><td>${money(r.averageNoPremiumPledge)}</td><td>${num(r.unitemizedPremiumPledges)} / ${money(r.unitemizedPremiumDollars)}</td></tr>`),
      { minWidth: 1150 }
    );
  }

  function renderCategories(s) {
    const max = Math.max(1, ...s.categories.map((r)=>Number(r.pledgedDollars)||0));
    $('#premium-category-chart').innerHTML = s.categories.length ? `<div class="premium-bars">${s.categories.slice(0,12).map((r)=>`<div class="premium-bar-row"><div class="premium-bar-label">${esc(r.category)}</div><div class="premium-bar-track"><span style="width:${Math.max(2,(r.pledgedDollars/max)*100).toFixed(1)}%"></span></div><strong>${money(r.pledgedDollars)}</strong></div>`).join('')}</div>` : '<div class="premium-empty">No category data.</div>';
    $('#premium-category-table').innerHTML = table(
      ['Category tag','Packages','Fundraisers','Pledges','Pledged','Avg pledge','Premium cost','Cost %'],
      s.categories.map((r)=>`<tr><td><strong>${esc(r.category)}</strong></td><td>${num(r.distinctPackages)}</td><td>${num(r.fundraiserCount)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.averagePledge)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td></tr>`),
      { minWidth: 850 }
    );
  }

  function renderCompositions(s) {
    $('#premium-composition-table').innerHTML = table(
      ['Package composition','Exact packages','Titles','Fundraisers','Pledges','Pledged','Avg pledge','Premium cost','Cost %','Confidence'],
      (s.compositions || []).map((r)=>`<tr><td><strong>${esc(r.label)}</strong></td><td>${num(r.distinctPackages)}</td><td>${num(r.distinctTitles)}</td><td>${num(r.fundraiserCount)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.averagePledge)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td><td>${r.complete ? 'Complete' : 'Partial / inferred'}</td></tr>`),
      { minWidth: 1150 }
    );
  }

  function renderPackages(s) {
    $('#premium-package-table').innerHTML = table(
      ['Fundraiser','Exact premium / package','Package composition','Pledges','Pledged','Avg pledge','Reported cost','Cost %','Est. net'],
      s.packages.map((r)=>`<tr><td>${esc(r.fundraiserLabel)}</td><td><strong>${esc(r.description)}</strong>${r.stationBranded ? '<span class="premium-inline-flag">WNMU</span>' : ''}</td><td>${esc(r.packageCompositionLabel || '—')}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.averagePledge)}</td><td>${money(r.totalPremiumCost,2)}</td><td>${pct(r.costPercentOfPledged)}</td><td>${money(r.estimatedNetAfterPremium)}</td></tr>`),
      { minWidth: 1200 }
    );
  }

  function renderMapped(s) {
    $('#premium-program-table').innerHTML = table(
      ['Program','Fundraisers','Packages','Pledges','Premium-linked $','Reported cost','Cost %'],
      s.programs.map((r)=>`<tr><td><strong>${esc(r.label)}</strong></td><td>${num(r.fundraiserCount)}</td><td>${num(r.exactPremiumCount)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td></tr>`),
      { minWidth: 900 }
    );
    $('#premium-topic-table').innerHTML = table(
      ['Topic','Fundraisers','Packages','Pledges','Premium-linked $','Reported cost','Cost %'],
      s.topics.filter((r)=>r.label).map((r)=>`<tr><td><strong>${esc(r.label)}</strong></td><td>${num(r.fundraiserCount)}</td><td>${num(r.exactPremiumCount)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td></tr>`),
      { minWidth: 900 }
    );
  }

  function renderCombined(s) {
    const status = $('#premium-combined-status');
    if (status) status.textContent = 'Broadcast performance comes from the existing fundraiser analytics. Premium-linked dollars remain a separate measure so unlike scopes are not silently added together.';
    $('#premium-combined-program-table').innerHTML = table(
      ['Fundraiser','Program','Topic','Broadcast $','Broadcast pledges','$ / pledge hr','Premium-linked $','Premium pledges','Premium cost','Mapping'],
      s.combinedPrograms.filter((r)=>r.premiumPackages || r.broadcastDollars).map((r)=>`<tr><td>${esc(r.fundraiserLabel)}</td><td><strong>${esc(r.programTitle)}</strong></td><td>${esc(r.topicPrimary||'—')}</td><td>${money(r.broadcastDollars)}</td><td>${num(r.broadcastPledges)}</td><td>${money(r.broadcastDollarsPerHour)}</td><td>${r.premiumPackages ? money(r.pledgedDollars) : '—'}</td><td>${r.premiumPackages ? num(r.pledgeCount) : '—'}</td><td>${r.premiumPackages ? money(r.totalPremiumCost) : '—'}</td><td>${r.mappingConfidence?.length ? r.mappingConfidence.map(badge).join(' ') : '—'}</td></tr>`),
      { minWidth: 1250 }
    );
    $('#premium-combined-topic-table').innerHTML = table(
      ['Topic','Fundraisers','Broadcast $','Broadcast pledges','$ / pledge hr','Premium-linked $','Premium pledges','Premium cost','Cost %'],
      s.combinedTopics.map((r)=>`<tr><td><strong>${esc(r.topic)}</strong></td><td>${num(r.fundraiserCount)}</td><td>${money(r.broadcastDollars)}</td><td>${num(r.broadcastPledges)}</td><td>${money(r.broadcastDollarsPerHour)}</td><td>${money(r.pledgedDollars)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td></tr>`),
      { minWidth: 1050 }
    );
  }

  function renderQuality(s) {
    const q = s.mappingQuality;
    const issues = s.mappedRows.filter((r)=>r.issues?.length);
    const unmapped = s.mappedRows.filter((r)=>r.mappingConfidence==='Unmapped');
    $('#premium-quality').innerHTML = `<div class="premium-quality-grid">
      <article><strong>${num(q['Historically verified']||0)}</strong><span>Historically verified</span></article>
      <article><strong>${num(q['Current-offer proxy']||0)}</strong><span>Current-offer proxy</span></article>
      <article><strong>${num(q['Strongly inferred']||0)}</strong><span>Strongly inferred</span></article>
      <article><strong>${num(q.Unmapped||0)}</strong><span>Unmapped</span></article>
    </div>
    ${issues.length ? `<p class="premium-note"><strong>${issues.length}</strong> exact premium rows have source-data warnings: ${esc([...new Set(issues.flatMap((r)=>r.issues))].join('; '))}.</p>` : '<p class="premium-note">No source-data warnings in the currently selected exact-premium rows.</p>'}
    ${unmapped.length ? table(['Unmapped exact premium','Fundraiser','Categories','Pledges','Pledged'], unmapped.map((r)=>`<tr><td><strong>${esc(r.description)}</strong></td><td>${esc(r.fundraiserLabel)}</td><td>${esc((r.componentCategories||[]).join(', '))}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td></tr>`), {minWidth:800}) : ''}`;
  }

  function updateFundraiserOptions(snapshot) {
    const select = $('#premium-fundraiser-filter');
    if (!select) return;
    const previous = select.value;
    const options = snapshot.imports.map((item)=>`<option value="${esc(item.fundraiser.key)}">${esc(item.fundraiser.label)}</option>`).join('');
    select.innerHTML = `<option value="all">All imported fundraisers</option>${options}`;
    if ([...select.options].some((option)=>option.value===previous)) select.value=previous;
  }

  function render() {
    const all = D.snapshot();
    updateFundraiserOptions(all);
    const s = filtered(all);
    $('#premium-import-count').textContent = `${all.imports.length} fundraiser report${all.imports.length===1?'':'s'} stored in this browser`;
    renderOverview(s);
    renderFundraisers(s);
    renderCategories(s);
    renderCompositions(s);
    renderPackages(s);
    renderMapped(s);
    renderCombined(s);
    renderQuality(s);
  }

  async function init() {
    try {
      if (!A || !D) throw new Error('Premium analytics modules did not load.');
      const allowed = await D.requireAdmin({ gateId:'premium-access-gate', appId:'premium-app', roleId:'premium-role' });
      if (!allowed) return;
      setStatus('Loading Program Library and fundraiser analytics…');
      await D.loadExistingAnalytics();
      render();
      setStatus(D.state.imports.length ? 'Premium analytics ready.' : 'Import the eight premium-cost reports to start the proof of concept.', D.state.imports.length ? 'good' : 'warn');

      $('#premium-file-input')?.addEventListener('change', async (event) => {
        const files = [...(event.target.files || [])];
        if (!files.length) return;
        try {
          setStatus(`Importing ${files.length} premium-cost report${files.length===1?'':'s'}…`);
          const parsed = await D.importFiles(files);
          render();
          setStatus(`Imported ${parsed.length} report${parsed.length===1?'':'s'}. Exact packages remain tied to their fundraiser.`, 'good');
          event.target.value = '';
        } catch (error) {
          console.error(error);
          setStatus(error?.message || 'Premium-cost import failed.', 'error');
        }
      });
      $('#premium-fundraiser-filter')?.addEventListener('change', render);
      $('#premium-refresh-library')?.addEventListener('click', async () => {
        try { setStatus('Refreshing Program Library and fundraiser analytics…'); await D.loadExistingAnalytics(); render(); setStatus('Program and topic context refreshed.', 'good'); }
        catch (error) { console.error(error); setStatus(error?.message || 'Refresh failed.', 'error'); }
      });
      $('#premium-clear')?.addEventListener('click', () => {
        if (!window.confirm('Clear only the browser-stored premium analytics imports? Existing WNMU pledge/program data will not be changed.')) return;
        D.clearStoredImports();
        render();
        setStatus('Browser-stored premium analytics data cleared. Existing pledge/program data was untouched.', 'good');
      });
    } catch (error) {
      console.error(error);
      setStatus(error?.message || 'Premium analytics could not start.', 'error');
    }
  }

  document.addEventListener('DOMContentLoaded', init, { once:true });
})();
,'Net after premium','Avg premium pledge','Avg no-premium pledge','Unitemized'],
      s.fundraiserAnalysis.map((r)=>`<tr><td><strong>${esc(r.label)}</strong></td><td>${money(r.totalPledged)}</td><td>${num(r.totalPledges)}</td><td>${pct(r.premiumTakeRate)}</td><td>${money(r.anyPremiumDollars)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.premiumCostPercentOfTotal)}</td><td>${money(r.averagePremiumPledge)}</td><td>${money(r.averageNoPremiumPledge)}</td><td>${num(r.unitemizedPremiumPledges)} / ${money(r.unitemizedPremiumDollars)}</td></tr>`),
      { minWidth: 1150 }
    );
  }

  function renderCategories(s) {
    const max = Math.max(1, ...s.categories.map((r)=>Number(r.pledgedDollars)||0));
    $('#premium-category-chart').innerHTML = s.categories.length ? `<div class="premium-bars">${s.categories.slice(0,12).map((r)=>`<div class="premium-bar-row"><div class="premium-bar-label">${esc(r.category)}</div><div class="premium-bar-track"><span style="width:${Math.max(2,(r.pledgedDollars/max)*100).toFixed(1)}%"></span></div><strong>${money(r.pledgedDollars)}</strong></div>`).join('')}</div>` : '<div class="premium-empty">No category data.</div>';
    $('#premium-category-table').innerHTML = table(
      ['Category tag','Packages','Fundraisers','Pledges','Pledged','Avg pledge','Premium cost','Cost %'],
      s.categories.map((r)=>`<tr><td><strong>${esc(r.category)}</strong></td><td>${num(r.distinctPackages)}</td><td>${num(r.fundraiserCount)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.averagePledge)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td></tr>`),
      { minWidth: 850 }
    );
  }

  function renderCompositions(s) {
    $('#premium-composition-table').innerHTML = table(
      ['Package composition','Exact packages','Titles','Fundraisers','Pledges','Pledged','Avg pledge','Premium cost','Cost %','Confidence'],
      (s.compositions || []).map((r)=>`<tr><td><strong>${esc(r.label)}</strong></td><td>${num(r.distinctPackages)}</td><td>${num(r.distinctTitles)}</td><td>${num(r.fundraiserCount)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.averagePledge)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td><td>${r.complete ? 'Complete' : 'Partial / inferred'}</td></tr>`),
      { minWidth: 1150 }
    );
  }

  function renderPackages(s) {
    $('#premium-package-table').innerHTML = table(
      ['Fundraiser','Exact premium / package','Package composition','Pledges','Pledged','Avg pledge','Reported cost','Cost %','Est. net'],
      s.packages.map((r)=>`<tr><td>${esc(r.fundraiserLabel)}</td><td><strong>${esc(r.description)}</strong>${r.stationBranded ? '<span class="premium-inline-flag">WNMU</span>' : ''}</td><td>${esc(r.packageCompositionLabel || '—')}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.averagePledge)}</td><td>${money(r.totalPremiumCost,2)}</td><td>${pct(r.costPercentOfPledged)}</td><td>${money(r.estimatedNetAfterPremium)}</td></tr>`),
      { minWidth: 1200 }
    );
  }

  function renderMapped(s) {
    $('#premium-program-table').innerHTML = table(
      ['Program','Fundraisers','Packages','Pledges','Premium-linked $','Reported cost','Cost %'],
      s.programs.map((r)=>`<tr><td><strong>${esc(r.label)}</strong></td><td>${num(r.fundraiserCount)}</td><td>${num(r.exactPremiumCount)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td></tr>`),
      { minWidth: 900 }
    );
    $('#premium-topic-table').innerHTML = table(
      ['Topic','Fundraisers','Packages','Pledges','Premium-linked $','Reported cost','Cost %'],
      s.topics.filter((r)=>r.label).map((r)=>`<tr><td><strong>${esc(r.label)}</strong></td><td>${num(r.fundraiserCount)}</td><td>${num(r.exactPremiumCount)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td></tr>`),
      { minWidth: 900 }
    );
  }

  function renderCombined(s) {
    const status = $('#premium-combined-status');
    if (status) status.textContent = 'Broadcast performance comes from the existing fundraiser analytics. Premium-linked dollars remain a separate measure so unlike scopes are not silently added together.';
    $('#premium-combined-program-table').innerHTML = table(
      ['Fundraiser','Program','Topic','Broadcast $','Broadcast pledges','$ / pledge hr','Premium-linked $','Premium pledges','Premium cost','Mapping'],
      s.combinedPrograms.filter((r)=>r.premiumPackages || r.broadcastDollars).map((r)=>`<tr><td>${esc(r.fundraiserLabel)}</td><td><strong>${esc(r.programTitle)}</strong></td><td>${esc(r.topicPrimary||'—')}</td><td>${money(r.broadcastDollars)}</td><td>${num(r.broadcastPledges)}</td><td>${money(r.broadcastDollarsPerHour)}</td><td>${r.premiumPackages ? money(r.pledgedDollars) : '—'}</td><td>${r.premiumPackages ? num(r.pledgeCount) : '—'}</td><td>${r.premiumPackages ? money(r.totalPremiumCost) : '—'}</td><td>${r.mappingConfidence?.length ? r.mappingConfidence.map(badge).join(' ') : '—'}</td></tr>`),
      { minWidth: 1250 }
    );
    $('#premium-combined-topic-table').innerHTML = table(
      ['Topic','Fundraisers','Broadcast $','Broadcast pledges','$ / pledge hr','Premium-linked $','Premium pledges','Premium cost','Cost %'],
      s.combinedTopics.map((r)=>`<tr><td><strong>${esc(r.topic)}</strong></td><td>${num(r.fundraiserCount)}</td><td>${money(r.broadcastDollars)}</td><td>${num(r.broadcastPledges)}</td><td>${money(r.broadcastDollarsPerHour)}</td><td>${money(r.pledgedDollars)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td></tr>`),
      { minWidth: 1050 }
    );
  }

  function renderQuality(s) {
    const q = s.mappingQuality;
    const issues = s.mappedRows.filter((r)=>r.issues?.length);
    const unmapped = s.mappedRows.filter((r)=>r.mappingConfidence==='Unmapped');
    $('#premium-quality').innerHTML = `<div class="premium-quality-grid">
      <article><strong>${num(q['Historically verified']||0)}</strong><span>Historically verified</span></article>
      <article><strong>${num(q['Current-offer proxy']||0)}</strong><span>Current-offer proxy</span></article>
      <article><strong>${num(q['Strongly inferred']||0)}</strong><span>Strongly inferred</span></article>
      <article><strong>${num(q.Unmapped||0)}</strong><span>Unmapped</span></article>
    </div>
    ${issues.length ? `<p class="premium-note"><strong>${issues.length}</strong> exact premium rows have source-data warnings: ${esc([...new Set(issues.flatMap((r)=>r.issues))].join('; '))}.</p>` : '<p class="premium-note">No source-data warnings in the currently selected exact-premium rows.</p>'}
    ${unmapped.length ? table(['Unmapped exact premium','Fundraiser','Categories','Pledges','Pledged'], unmapped.map((r)=>`<tr><td><strong>${esc(r.description)}</strong></td><td>${esc(r.fundraiserLabel)}</td><td>${esc((r.componentCategories||[]).join(', '))}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td></tr>`), {minWidth:800}) : ''}`;
  }

  function updateFundraiserOptions(snapshot) {
    const select = $('#premium-fundraiser-filter');
    if (!select) return;
    const previous = select.value;
    const options = snapshot.imports.map((item)=>`<option value="${esc(item.fundraiser.key)}">${esc(item.fundraiser.label)}</option>`).join('');
    select.innerHTML = `<option value="all">All imported fundraisers</option>${options}`;
    if ([...select.options].some((option)=>option.value===previous)) select.value=previous;
  }

  function render() {
    const all = D.snapshot();
    updateFundraiserOptions(all);
    const s = filtered(all);
    $('#premium-import-count').textContent = `${all.imports.length} fundraiser report${all.imports.length===1?'':'s'} stored in this browser`;
    renderOverview(s);
    renderFundraisers(s);
    renderCategories(s);
    renderCompositions(s);
    renderPackages(s);
    renderMapped(s);
    renderCombined(s);
    renderQuality(s);
  }

  async function init() {
    try {
      if (!A || !D) throw new Error('Premium analytics modules did not load.');
      const allowed = await D.requireAdmin({ gateId:'premium-access-gate', appId:'premium-app', roleId:'premium-role' });
      if (!allowed) return;
      setStatus('Loading Program Library and fundraiser analytics…');
      await D.loadExistingAnalytics();
      render();
      setStatus(D.state.imports.length ? 'Premium analytics ready.' : 'Import the eight premium-cost reports to start the proof of concept.', D.state.imports.length ? 'good' : 'warn');

      $('#premium-file-input')?.addEventListener('change', async (event) => {
        const files = [...(event.target.files || [])];
        if (!files.length) return;
        try {
          setStatus(`Importing ${files.length} premium-cost report${files.length===1?'':'s'}…`);
          const parsed = await D.importFiles(files);
          render();
          setStatus(`Imported ${parsed.length} report${parsed.length===1?'':'s'}. Exact packages remain tied to their fundraiser.`, 'good');
          event.target.value = '';
        } catch (error) {
          console.error(error);
          setStatus(error?.message || 'Premium-cost import failed.', 'error');
        }
      });
      $('#premium-fundraiser-filter')?.addEventListener('change', render);
      $('#premium-refresh-library')?.addEventListener('click', async () => {
        try { setStatus('Refreshing Program Library and fundraiser analytics…'); await D.loadExistingAnalytics(); render(); setStatus('Program and topic context refreshed.', 'good'); }
        catch (error) { console.error(error); setStatus(error?.message || 'Refresh failed.', 'error'); }
      });
      $('#premium-clear')?.addEventListener('click', () => {
        if (!window.confirm('Clear only the browser-stored premium analytics imports? Existing WNMU pledge/program data will not be changed.')) return;
        D.clearStoredImports();
        render();
        setStatus('Browser-stored premium analytics data cleared. Existing pledge/program data was untouched.', 'good');
      });
    } catch (error) {
      console.error(error);
      setStatus(error?.message || 'Premium analytics could not start.', 'error');
    }
  }

  document.addEventListener('DOMContentLoaded', init, { once:true });
})();
,'Reported cost','Cost %','Net after premium'],
      s.programs.map((r)=>`<tr><td><strong>${esc(r.label)}</strong></td><td>${num(r.fundraiserCount)}</td><td>${num(r.exactPremiumCount)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td></tr>`),
      { minWidth: 900 }
    );
    $('#premium-topic-table').innerHTML = table(
      ['Topic','Fundraisers','Packages','Pledges','Premium-linked $','Reported cost','Cost %'],
      s.topics.filter((r)=>r.label).map((r)=>`<tr><td><strong>${esc(r.label)}</strong></td><td>${num(r.fundraiserCount)}</td><td>${num(r.exactPremiumCount)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td></tr>`),
      { minWidth: 900 }
    );
  }

  function renderCombined(s) {
    const status = $('#premium-combined-status');
    if (status) status.textContent = 'Broadcast performance comes from the existing fundraiser analytics. Premium-linked dollars remain a separate measure so unlike scopes are not silently added together.';
    $('#premium-combined-program-table').innerHTML = table(
      ['Fundraiser','Program','Topic','Broadcast $','Broadcast pledges','$ / pledge hr','Premium-linked $','Premium pledges','Premium cost','Mapping'],
      s.combinedPrograms.filter((r)=>r.premiumPackages || r.broadcastDollars).map((r)=>`<tr><td>${esc(r.fundraiserLabel)}</td><td><strong>${esc(r.programTitle)}</strong></td><td>${esc(r.topicPrimary||'—')}</td><td>${money(r.broadcastDollars)}</td><td>${num(r.broadcastPledges)}</td><td>${money(r.broadcastDollarsPerHour)}</td><td>${r.premiumPackages ? money(r.pledgedDollars) : '—'}</td><td>${r.premiumPackages ? num(r.pledgeCount) : '—'}</td><td>${r.premiumPackages ? money(r.totalPremiumCost) : '—'}</td><td>${r.mappingConfidence?.length ? r.mappingConfidence.map(badge).join(' ') : '—'}</td></tr>`),
      { minWidth: 1250 }
    );
    $('#premium-combined-topic-table').innerHTML = table(
      ['Topic','Fundraisers','Broadcast $','Broadcast pledges','$ / pledge hr','Premium-linked $','Premium pledges','Premium cost','Cost %'],
      s.combinedTopics.map((r)=>`<tr><td><strong>${esc(r.topic)}</strong></td><td>${num(r.fundraiserCount)}</td><td>${money(r.broadcastDollars)}</td><td>${num(r.broadcastPledges)}</td><td>${money(r.broadcastDollarsPerHour)}</td><td>${money(r.pledgedDollars)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td></tr>`),
      { minWidth: 1050 }
    );
  }

  function renderQuality(s) {
    const q = s.mappingQuality;
    const issues = s.mappedRows.filter((r)=>r.issues?.length);
    const unmapped = s.mappedRows.filter((r)=>r.mappingConfidence==='Unmapped');
    $('#premium-quality').innerHTML = `<div class="premium-quality-grid">
      <article><strong>${num(q['Historically verified']||0)}</strong><span>Historically verified</span></article>
      <article><strong>${num(q['Current-offer proxy']||0)}</strong><span>Current-offer proxy</span></article>
      <article><strong>${num(q['Strongly inferred']||0)}</strong><span>Strongly inferred</span></article>
      <article><strong>${num(q.Unmapped||0)}</strong><span>Unmapped</span></article>
    </div>
    ${issues.length ? `<p class="premium-note"><strong>${issues.length}</strong> exact premium rows have source-data warnings: ${esc([...new Set(issues.flatMap((r)=>r.issues))].join('; '))}.</p>` : '<p class="premium-note">No source-data warnings in the currently selected exact-premium rows.</p>'}
    ${unmapped.length ? table(['Unmapped exact premium','Fundraiser','Categories','Pledges','Pledged'], unmapped.map((r)=>`<tr><td><strong>${esc(r.description)}</strong></td><td>${esc(r.fundraiserLabel)}</td><td>${esc((r.componentCategories||[]).join(', '))}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td></tr>`), {minWidth:800}) : ''}`;
  }

  function updateFundraiserOptions(snapshot) {
    const select = $('#premium-fundraiser-filter');
    if (!select) return;
    const previous = select.value;
    const options = snapshot.imports.map((item)=>`<option value="${esc(item.fundraiser.key)}">${esc(item.fundraiser.label)}</option>`).join('');
    select.innerHTML = `<option value="all">All imported fundraisers</option>${options}`;
    if ([...select.options].some((option)=>option.value===previous)) select.value=previous;
  }

  function render() {
    const all = D.snapshot();
    updateFundraiserOptions(all);
    const s = filtered(all);
    $('#premium-import-count').textContent = `${all.imports.length} fundraiser report${all.imports.length===1?'':'s'} stored in this browser`;
    renderOverview(s);
    renderFundraisers(s);
    renderCategories(s);
    renderCompositions(s);
    renderPackages(s);
    renderMapped(s);
    renderCombined(s);
    renderQuality(s);
  }

  async function init() {
    try {
      if (!A || !D) throw new Error('Premium analytics modules did not load.');
      const allowed = await D.requireAdmin({ gateId:'premium-access-gate', appId:'premium-app', roleId:'premium-role' });
      if (!allowed) return;
      setStatus('Loading Program Library and fundraiser analytics…');
      await D.loadExistingAnalytics();
      render();
      setStatus(D.state.imports.length ? 'Premium analytics ready.' : 'Import the eight premium-cost reports to start the proof of concept.', D.state.imports.length ? 'good' : 'warn');

      $('#premium-file-input')?.addEventListener('change', async (event) => {
        const files = [...(event.target.files || [])];
        if (!files.length) return;
        try {
          setStatus(`Importing ${files.length} premium-cost report${files.length===1?'':'s'}…`);
          const parsed = await D.importFiles(files);
          render();
          setStatus(`Imported ${parsed.length} report${parsed.length===1?'':'s'}. Exact packages remain tied to their fundraiser.`, 'good');
          event.target.value = '';
        } catch (error) {
          console.error(error);
          setStatus(error?.message || 'Premium-cost import failed.', 'error');
        }
      });
      $('#premium-fundraiser-filter')?.addEventListener('change', render);
      $('#premium-refresh-library')?.addEventListener('click', async () => {
        try { setStatus('Refreshing Program Library and fundraiser analytics…'); await D.loadExistingAnalytics(); render(); setStatus('Program and topic context refreshed.', 'good'); }
        catch (error) { console.error(error); setStatus(error?.message || 'Refresh failed.', 'error'); }
      });
      $('#premium-clear')?.addEventListener('click', () => {
        if (!window.confirm('Clear only the browser-stored premium analytics imports? Existing WNMU pledge/program data will not be changed.')) return;
        D.clearStoredImports();
        render();
        setStatus('Browser-stored premium analytics data cleared. Existing pledge/program data was untouched.', 'good');
      });
    } catch (error) {
      console.error(error);
      setStatus(error?.message || 'Premium analytics could not start.', 'error');
    }
  }

  document.addEventListener('DOMContentLoaded', init, { once:true });
})();
,'Premium cost','Cost / total 
      s.fundraiserAnalysis.map((r)=>`<tr><td><strong>${esc(r.label)}</strong></td><td>${money(r.totalPledged)}</td><td>${num(r.totalPledges)}</td><td>${pct(r.premiumTakeRate)}</td><td>${money(r.anyPremiumDollars)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.premiumCostPercentOfTotal)}</td><td>${money(r.averagePremiumPledge)}</td><td>${money(r.averageNoPremiumPledge)}</td><td>${num(r.unitemizedPremiumPledges)} / ${money(r.unitemizedPremiumDollars)}</td></tr>`),
      { minWidth: 1150 }
    );
  }

  function renderCategories(s) {
    const max = Math.max(1, ...s.categories.map((r)=>Number(r.pledgedDollars)||0));
    $('#premium-category-chart').innerHTML = s.categories.length ? `<div class="premium-bars">${s.categories.slice(0,12).map((r)=>`<div class="premium-bar-row"><div class="premium-bar-label">${esc(r.category)}</div><div class="premium-bar-track"><span style="width:${Math.max(2,(r.pledgedDollars/max)*100).toFixed(1)}%"></span></div><strong>${money(r.pledgedDollars)}</strong></div>`).join('')}</div>` : '<div class="premium-empty">No category data.</div>';
    $('#premium-category-table').innerHTML = table(
      ['Category tag','Packages','Fundraisers','Pledges','Pledged','Avg pledge','Premium cost','Cost %'],
      s.categories.map((r)=>`<tr><td><strong>${esc(r.category)}</strong></td><td>${num(r.distinctPackages)}</td><td>${num(r.fundraiserCount)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.averagePledge)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td></tr>`),
      { minWidth: 850 }
    );
  }

  function renderCompositions(s) {
    $('#premium-composition-table').innerHTML = table(
      ['Package composition','Exact packages','Titles','Fundraisers','Pledges','Pledged','Avg pledge','Premium cost','Cost %','Confidence'],
      (s.compositions || []).map((r)=>`<tr><td><strong>${esc(r.label)}</strong></td><td>${num(r.distinctPackages)}</td><td>${num(r.distinctTitles)}</td><td>${num(r.fundraiserCount)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.averagePledge)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td><td>${r.complete ? 'Complete' : 'Partial / inferred'}</td></tr>`),
      { minWidth: 1150 }
    );
  }

  function renderPackages(s) {
    $('#premium-package-table').innerHTML = table(
      ['Fundraiser','Exact premium / package','Package composition','Pledges','Pledged','Avg pledge','Reported cost','Cost %','Est. net'],
      s.packages.map((r)=>`<tr><td>${esc(r.fundraiserLabel)}</td><td><strong>${esc(r.description)}</strong>${r.stationBranded ? '<span class="premium-inline-flag">WNMU</span>' : ''}</td><td>${esc(r.packageCompositionLabel || '—')}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.averagePledge)}</td><td>${money(r.totalPremiumCost,2)}</td><td>${pct(r.costPercentOfPledged)}</td><td>${money(r.estimatedNetAfterPremium)}</td></tr>`),
      { minWidth: 1200 }
    );
  }

  function renderMapped(s) {
    $('#premium-program-table').innerHTML = table(
      ['Program','Fundraisers','Packages','Pledges','Premium-linked $','Reported cost','Cost %'],
      s.programs.map((r)=>`<tr><td><strong>${esc(r.label)}</strong></td><td>${num(r.fundraiserCount)}</td><td>${num(r.exactPremiumCount)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td></tr>`),
      { minWidth: 900 }
    );
    $('#premium-topic-table').innerHTML = table(
      ['Topic','Fundraisers','Packages','Pledges','Premium-linked $','Reported cost','Cost %'],
      s.topics.filter((r)=>r.label).map((r)=>`<tr><td><strong>${esc(r.label)}</strong></td><td>${num(r.fundraiserCount)}</td><td>${num(r.exactPremiumCount)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td></tr>`),
      { minWidth: 900 }
    );
  }

  function renderCombined(s) {
    const status = $('#premium-combined-status');
    if (status) status.textContent = 'Broadcast performance comes from the existing fundraiser analytics. Premium-linked dollars remain a separate measure so unlike scopes are not silently added together.';
    $('#premium-combined-program-table').innerHTML = table(
      ['Fundraiser','Program','Topic','Broadcast $','Broadcast pledges','$ / pledge hr','Premium-linked $','Premium pledges','Premium cost','Mapping'],
      s.combinedPrograms.filter((r)=>r.premiumPackages || r.broadcastDollars).map((r)=>`<tr><td>${esc(r.fundraiserLabel)}</td><td><strong>${esc(r.programTitle)}</strong></td><td>${esc(r.topicPrimary||'—')}</td><td>${money(r.broadcastDollars)}</td><td>${num(r.broadcastPledges)}</td><td>${money(r.broadcastDollarsPerHour)}</td><td>${r.premiumPackages ? money(r.pledgedDollars) : '—'}</td><td>${r.premiumPackages ? num(r.pledgeCount) : '—'}</td><td>${r.premiumPackages ? money(r.totalPremiumCost) : '—'}</td><td>${r.mappingConfidence?.length ? r.mappingConfidence.map(badge).join(' ') : '—'}</td></tr>`),
      { minWidth: 1250 }
    );
    $('#premium-combined-topic-table').innerHTML = table(
      ['Topic','Fundraisers','Broadcast $','Broadcast pledges','$ / pledge hr','Premium-linked $','Premium pledges','Premium cost','Cost %'],
      s.combinedTopics.map((r)=>`<tr><td><strong>${esc(r.topic)}</strong></td><td>${num(r.fundraiserCount)}</td><td>${money(r.broadcastDollars)}</td><td>${num(r.broadcastPledges)}</td><td>${money(r.broadcastDollarsPerHour)}</td><td>${money(r.pledgedDollars)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td></tr>`),
      { minWidth: 1050 }
    );
  }

  function renderQuality(s) {
    const q = s.mappingQuality;
    const issues = s.mappedRows.filter((r)=>r.issues?.length);
    const unmapped = s.mappedRows.filter((r)=>r.mappingConfidence==='Unmapped');
    $('#premium-quality').innerHTML = `<div class="premium-quality-grid">
      <article><strong>${num(q['Historically verified']||0)}</strong><span>Historically verified</span></article>
      <article><strong>${num(q['Current-offer proxy']||0)}</strong><span>Current-offer proxy</span></article>
      <article><strong>${num(q['Strongly inferred']||0)}</strong><span>Strongly inferred</span></article>
      <article><strong>${num(q.Unmapped||0)}</strong><span>Unmapped</span></article>
    </div>
    ${issues.length ? `<p class="premium-note"><strong>${issues.length}</strong> exact premium rows have source-data warnings: ${esc([...new Set(issues.flatMap((r)=>r.issues))].join('; '))}.</p>` : '<p class="premium-note">No source-data warnings in the currently selected exact-premium rows.</p>'}
    ${unmapped.length ? table(['Unmapped exact premium','Fundraiser','Categories','Pledges','Pledged'], unmapped.map((r)=>`<tr><td><strong>${esc(r.description)}</strong></td><td>${esc(r.fundraiserLabel)}</td><td>${esc((r.componentCategories||[]).join(', '))}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td></tr>`), {minWidth:800}) : ''}`;
  }

  function updateFundraiserOptions(snapshot) {
    const select = $('#premium-fundraiser-filter');
    if (!select) return;
    const previous = select.value;
    const options = snapshot.imports.map((item)=>`<option value="${esc(item.fundraiser.key)}">${esc(item.fundraiser.label)}</option>`).join('');
    select.innerHTML = `<option value="all">All imported fundraisers</option>${options}`;
    if ([...select.options].some((option)=>option.value===previous)) select.value=previous;
  }

  function render() {
    const all = D.snapshot();
    updateFundraiserOptions(all);
    const s = filtered(all);
    $('#premium-import-count').textContent = `${all.imports.length} fundraiser report${all.imports.length===1?'':'s'} stored in this browser`;
    renderOverview(s);
    renderFundraisers(s);
    renderCategories(s);
    renderCompositions(s);
    renderPackages(s);
    renderMapped(s);
    renderCombined(s);
    renderQuality(s);
  }

  async function init() {
    try {
      if (!A || !D) throw new Error('Premium analytics modules did not load.');
      const allowed = await D.requireAdmin({ gateId:'premium-access-gate', appId:'premium-app', roleId:'premium-role' });
      if (!allowed) return;
      setStatus('Loading Program Library and fundraiser analytics…');
      await D.loadExistingAnalytics();
      render();
      setStatus(D.state.imports.length ? 'Premium analytics ready.' : 'Import the eight premium-cost reports to start the proof of concept.', D.state.imports.length ? 'good' : 'warn');

      $('#premium-file-input')?.addEventListener('change', async (event) => {
        const files = [...(event.target.files || [])];
        if (!files.length) return;
        try {
          setStatus(`Importing ${files.length} premium-cost report${files.length===1?'':'s'}…`);
          const parsed = await D.importFiles(files);
          render();
          setStatus(`Imported ${parsed.length} report${parsed.length===1?'':'s'}. Exact packages remain tied to their fundraiser.`, 'good');
          event.target.value = '';
        } catch (error) {
          console.error(error);
          setStatus(error?.message || 'Premium-cost import failed.', 'error');
        }
      });
      $('#premium-fundraiser-filter')?.addEventListener('change', render);
      $('#premium-refresh-library')?.addEventListener('click', async () => {
        try { setStatus('Refreshing Program Library and fundraiser analytics…'); await D.loadExistingAnalytics(); render(); setStatus('Program and topic context refreshed.', 'good'); }
        catch (error) { console.error(error); setStatus(error?.message || 'Refresh failed.', 'error'); }
      });
      $('#premium-clear')?.addEventListener('click', () => {
        if (!window.confirm('Clear only the browser-stored premium analytics imports? Existing WNMU pledge/program data will not be changed.')) return;
        D.clearStoredImports();
        render();
        setStatus('Browser-stored premium analytics data cleared. Existing pledge/program data was untouched.', 'good');
      });
    } catch (error) {
      console.error(error);
      setStatus(error?.message || 'Premium analytics could not start.', 'error');
    }
  }

  document.addEventListener('DOMContentLoaded', init, { once:true });
})();
,'Net after premium','Avg premium pledge','Avg no-premium pledge','Unitemized'],
      s.fundraiserAnalysis.map((r)=>`<tr><td><strong>${esc(r.label)}</strong></td><td>${money(r.totalPledged)}</td><td>${num(r.totalPledges)}</td><td>${pct(r.premiumTakeRate)}</td><td>${money(r.anyPremiumDollars)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.premiumCostPercentOfTotal)}</td><td>${money(r.averagePremiumPledge)}</td><td>${money(r.averageNoPremiumPledge)}</td><td>${num(r.unitemizedPremiumPledges)} / ${money(r.unitemizedPremiumDollars)}</td></tr>`),
      { minWidth: 1150 }
    );
  }

  function renderCategories(s) {
    const max = Math.max(1, ...s.categories.map((r)=>Number(r.pledgedDollars)||0));
    $('#premium-category-chart').innerHTML = s.categories.length ? `<div class="premium-bars">${s.categories.slice(0,12).map((r)=>`<div class="premium-bar-row"><div class="premium-bar-label">${esc(r.category)}</div><div class="premium-bar-track"><span style="width:${Math.max(2,(r.pledgedDollars/max)*100).toFixed(1)}%"></span></div><strong>${money(r.pledgedDollars)}</strong></div>`).join('')}</div>` : '<div class="premium-empty">No category data.</div>';
    $('#premium-category-table').innerHTML = table(
      ['Category tag','Packages','Fundraisers','Pledges','Pledged','Avg pledge','Premium cost','Cost %'],
      s.categories.map((r)=>`<tr><td><strong>${esc(r.category)}</strong></td><td>${num(r.distinctPackages)}</td><td>${num(r.fundraiserCount)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.averagePledge)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td></tr>`),
      { minWidth: 850 }
    );
  }

  function renderCompositions(s) {
    $('#premium-composition-table').innerHTML = table(
      ['Package composition','Exact packages','Titles','Fundraisers','Pledges','Pledged','Avg pledge','Premium cost','Cost %','Confidence'],
      (s.compositions || []).map((r)=>`<tr><td><strong>${esc(r.label)}</strong></td><td>${num(r.distinctPackages)}</td><td>${num(r.distinctTitles)}</td><td>${num(r.fundraiserCount)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.averagePledge)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td><td>${r.complete ? 'Complete' : 'Partial / inferred'}</td></tr>`),
      { minWidth: 1150 }
    );
  }

  function renderPackages(s) {
    $('#premium-package-table').innerHTML = table(
      ['Fundraiser','Exact premium / package','Package composition','Pledges','Pledged','Avg pledge','Reported cost','Cost %','Est. net'],
      s.packages.map((r)=>`<tr><td>${esc(r.fundraiserLabel)}</td><td><strong>${esc(r.description)}</strong>${r.stationBranded ? '<span class="premium-inline-flag">WNMU</span>' : ''}</td><td>${esc(r.packageCompositionLabel || '—')}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.averagePledge)}</td><td>${money(r.totalPremiumCost,2)}</td><td>${pct(r.costPercentOfPledged)}</td><td>${money(r.estimatedNetAfterPremium)}</td></tr>`),
      { minWidth: 1200 }
    );
  }

  function renderMapped(s) {
    $('#premium-program-table').innerHTML = table(
      ['Program','Fundraisers','Packages','Pledges','Premium-linked $','Reported cost','Cost %'],
      s.programs.map((r)=>`<tr><td><strong>${esc(r.label)}</strong></td><td>${num(r.fundraiserCount)}</td><td>${num(r.exactPremiumCount)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td></tr>`),
      { minWidth: 900 }
    );
    $('#premium-topic-table').innerHTML = table(
      ['Topic','Fundraisers','Packages','Pledges','Premium-linked $','Reported cost','Cost %'],
      s.topics.filter((r)=>r.label).map((r)=>`<tr><td><strong>${esc(r.label)}</strong></td><td>${num(r.fundraiserCount)}</td><td>${num(r.exactPremiumCount)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td></tr>`),
      { minWidth: 900 }
    );
  }

  function renderCombined(s) {
    const status = $('#premium-combined-status');
    if (status) status.textContent = 'Broadcast performance comes from the existing fundraiser analytics. Premium-linked dollars remain a separate measure so unlike scopes are not silently added together.';
    $('#premium-combined-program-table').innerHTML = table(
      ['Fundraiser','Program','Topic','Broadcast $','Broadcast pledges','$ / pledge hr','Premium-linked $','Premium pledges','Premium cost','Mapping'],
      s.combinedPrograms.filter((r)=>r.premiumPackages || r.broadcastDollars).map((r)=>`<tr><td>${esc(r.fundraiserLabel)}</td><td><strong>${esc(r.programTitle)}</strong></td><td>${esc(r.topicPrimary||'—')}</td><td>${money(r.broadcastDollars)}</td><td>${num(r.broadcastPledges)}</td><td>${money(r.broadcastDollarsPerHour)}</td><td>${r.premiumPackages ? money(r.pledgedDollars) : '—'}</td><td>${r.premiumPackages ? num(r.pledgeCount) : '—'}</td><td>${r.premiumPackages ? money(r.totalPremiumCost) : '—'}</td><td>${r.mappingConfidence?.length ? r.mappingConfidence.map(badge).join(' ') : '—'}</td></tr>`),
      { minWidth: 1250 }
    );
    $('#premium-combined-topic-table').innerHTML = table(
      ['Topic','Fundraisers','Broadcast $','Broadcast pledges','$ / pledge hr','Premium-linked $','Premium pledges','Premium cost','Cost %'],
      s.combinedTopics.map((r)=>`<tr><td><strong>${esc(r.topic)}</strong></td><td>${num(r.fundraiserCount)}</td><td>${money(r.broadcastDollars)}</td><td>${num(r.broadcastPledges)}</td><td>${money(r.broadcastDollarsPerHour)}</td><td>${money(r.pledgedDollars)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.costPercentOfPledged)}</td></tr>`),
      { minWidth: 1050 }
    );
  }

  function renderQuality(s) {
    const q = s.mappingQuality;
    const issues = s.mappedRows.filter((r)=>r.issues?.length);
    const unmapped = s.mappedRows.filter((r)=>r.mappingConfidence==='Unmapped');
    $('#premium-quality').innerHTML = `<div class="premium-quality-grid">
      <article><strong>${num(q['Historically verified']||0)}</strong><span>Historically verified</span></article>
      <article><strong>${num(q['Current-offer proxy']||0)}</strong><span>Current-offer proxy</span></article>
      <article><strong>${num(q['Strongly inferred']||0)}</strong><span>Strongly inferred</span></article>
      <article><strong>${num(q.Unmapped||0)}</strong><span>Unmapped</span></article>
    </div>
    ${issues.length ? `<p class="premium-note"><strong>${issues.length}</strong> exact premium rows have source-data warnings: ${esc([...new Set(issues.flatMap((r)=>r.issues))].join('; '))}.</p>` : '<p class="premium-note">No source-data warnings in the currently selected exact-premium rows.</p>'}
    ${unmapped.length ? table(['Unmapped exact premium','Fundraiser','Categories','Pledges','Pledged'], unmapped.map((r)=>`<tr><td><strong>${esc(r.description)}</strong></td><td>${esc(r.fundraiserLabel)}</td><td>${esc((r.componentCategories||[]).join(', '))}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td></tr>`), {minWidth:800}) : ''}`;
  }

  function updateFundraiserOptions(snapshot) {
    const select = $('#premium-fundraiser-filter');
    if (!select) return;
    const previous = select.value;
    const options = snapshot.imports.map((item)=>`<option value="${esc(item.fundraiser.key)}">${esc(item.fundraiser.label)}</option>`).join('');
    select.innerHTML = `<option value="all">All imported fundraisers</option>${options}`;
    if ([...select.options].some((option)=>option.value===previous)) select.value=previous;
  }

  function render() {
    const all = D.snapshot();
    updateFundraiserOptions(all);
    const s = filtered(all);
    $('#premium-import-count').textContent = `${all.imports.length} fundraiser report${all.imports.length===1?'':'s'} stored in this browser`;
    renderOverview(s);
    renderFundraisers(s);
    renderCategories(s);
    renderCompositions(s);
    renderPackages(s);
    renderMapped(s);
    renderCombined(s);
    renderQuality(s);
  }

  async function init() {
    try {
      if (!A || !D) throw new Error('Premium analytics modules did not load.');
      const allowed = await D.requireAdmin({ gateId:'premium-access-gate', appId:'premium-app', roleId:'premium-role' });
      if (!allowed) return;
      setStatus('Loading Program Library and fundraiser analytics…');
      await D.loadExistingAnalytics();
      render();
      setStatus(D.state.imports.length ? 'Premium analytics ready.' : 'Import the eight premium-cost reports to start the proof of concept.', D.state.imports.length ? 'good' : 'warn');

      $('#premium-file-input')?.addEventListener('change', async (event) => {
        const files = [...(event.target.files || [])];
        if (!files.length) return;
        try {
          setStatus(`Importing ${files.length} premium-cost report${files.length===1?'':'s'}…`);
          const parsed = await D.importFiles(files);
          render();
          setStatus(`Imported ${parsed.length} report${parsed.length===1?'':'s'}. Exact packages remain tied to their fundraiser.`, 'good');
          event.target.value = '';
        } catch (error) {
          console.error(error);
          setStatus(error?.message || 'Premium-cost import failed.', 'error');
        }
      });
      $('#premium-fundraiser-filter')?.addEventListener('change', render);
      $('#premium-refresh-library')?.addEventListener('click', async () => {
        try { setStatus('Refreshing Program Library and fundraiser analytics…'); await D.loadExistingAnalytics(); render(); setStatus('Program and topic context refreshed.', 'good'); }
        catch (error) { console.error(error); setStatus(error?.message || 'Refresh failed.', 'error'); }
      });
      $('#premium-clear')?.addEventListener('click', () => {
        if (!window.confirm('Clear only the browser-stored premium analytics imports? Existing WNMU pledge/program data will not be changed.')) return;
        D.clearStoredImports();
        render();
        setStatus('Browser-stored premium analytics data cleared. Existing pledge/program data was untouched.', 'good');
      });
    } catch (error) {
      console.error(error);
      setStatus(error?.message || 'Premium analytics could not start.', 'error');
    }
  }

  document.addEventListener('DOMContentLoaded', init, { once:true });
})();
