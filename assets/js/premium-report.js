(() => {
  'use strict';

  const A = window.WNMUPremiumAnalysis;
  const D = window.WNMUPremiumData;
  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = (value) => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const money = (value, digits=0) => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString(undefined,{style:'currency',currency:'USD',minimumFractionDigits:digits,maximumFractionDigits:digits});
  const num = (value, digits=0) => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString(undefined,{minimumFractionDigits:digits,maximumFractionDigits:digits});
  const pct = (value, digits=1) => value == null || !Number.isFinite(Number(value)) ? '—' : `${(Number(value)*100).toFixed(digits)}%`;

  function setStatus(message, tone='') {
    const node = $('#premium-report-status'); if (!node) return; node.textContent=message; node.className=`premium-status ${tone}`.trim();
  }
  function table(headers, rows) {
    if (!rows.length) return '<p class="premium-note">No matching rows.</p>';
    return `<div class="premium-table-wrap"><table><thead><tr>${headers.map((h)=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  }
  function selectionSnapshot() {
    const full = D.snapshot();
    const key = $('#premium-report-fundraiser')?.value || 'all';
    const imports = key==='all' ? full.imports : full.imports.filter((i)=>i.fundraiser?.key===key);
    const flat=A.flattenImports(imports);
    const mappedRows=key==='all'?full.mappedRows:full.mappedRows.filter((r)=>r.fundraiserKey===key);
    const performanceRows=key==='all'?full.performanceRows:full.performanceRows.filter((r)=>r.fundraiserKey===key);
    return {
      ...full,
      imports, rows:flat.rows, summaries:flat.summaries, mappedRows, performanceRows,
      portfolio:A.portfolioSummary(flat.rows,flat.summaries),
      fundraiserAnalysis:A.fundraiserAnalysis(flat.rows,flat.summaries),
      categories:A.categoryAnalysis(mappedRows), compositions:A.compositionAnalysis(mappedRows), packages:A.packageAnalysis(mappedRows),
      programs:A.mappedGroupAnalysis(mappedRows,'programTitle'), topics:A.mappedGroupAnalysis(mappedRows,'topicPrimary'),
      combinedPrograms:A.combinedProgramAnalysis(mappedRows,performanceRows),
      combinedTopics:A.combinedTopicAnalysis(mappedRows,performanceRows)
    };
  }
  function render() {
    const s=selectionSnapshot();
    const p=s.portfolio;
    const title=s.imports.length===1?s.imports[0].fundraiser.label:'All imported fundraisers';
    const quality=A.mappingQuality(s.mappedRows);
    $('#premium-report-output').innerHTML=`<article class="one-sheet premium-report-sheet">
      <header class="sheet-title"><div><div class="report-kicker">Premium Performance &amp; Economics</div><h1>${esc(title)}</h1><p>Exact selectable packages are the accounting unit. Component categories overlap and are used only for trend analysis.</p></div><div class="premium-report-kpis"><strong>${money(p.totalPledged)}</strong><span>pledged</span><strong>${money(p.totalPremiumCost)}</strong><span>reported premium cost</span><strong>${pct(p.premiumCostPercentOfTotal)}</strong><span>cost / total pledged</span></div></header>
      <section><div class="section-heading"><h2>Fundraiser economics</h2><p>Premium-taking behavior and cost by drive.</p></div>${table(['Fundraiser','Pledged','Pledges','Premium take rate','Premium $','Premium cost','Cost / total $','Avg premium pledge','Avg no-premium pledge'],s.fundraiserAnalysis.map((r)=>`<tr><td><strong>${esc(r.label)}</strong></td><td>${money(r.totalPledged)}</td><td>${num(r.totalPledges)}</td><td>${pct(r.premiumTakeRate)}</td><td>${money(r.anyPremiumDollars)}</td><td>${money(r.totalPremiumCost)}</td><td>${pct(r.premiumCostPercentOfTotal)}</td><td>${money(r.averagePremiumPledge)}</td><td>${money(r.averageNoPremiumPledge)}</td></tr>`))}</section>
      <section><div class="section-heading"><h2>Exact premium packages</h2><p>Each selectable premium remains its own accounting record. The normalized composition lets us compare similar package recipes across different titles.</p></div>${table(['Fundraiser','Premium / package','Package composition','Pledges','Pledged','Avg pledge','Cost','Cost %','Est. net'],s.packages.slice(0,40).map((r)=>`<tr><td>${esc(r.fundraiserLabel)}</td><td><strong>${esc(r.description)}</strong></td><td>${esc(r.packageCompositionLabel||'—')}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.averagePledge)}</td><td>${money(r.totalPremiumCost,2)}</td><td>${pct(r.costPercentOfPledged)}</td><td>${money(r.estimatedNetAfterPremium)}</td></tr>`))}</section>
      <section><div class="section-heading"><h2>Category trends</h2><p>Component categories overlap, so these rows are comparative and must not be summed together. Bundle itself is structural, not a component category.</p></div>${table(['Category tag','Packages','Fundraisers','Pledges','Pledged','Avg pledge','Cost %'],s.categories.map((r)=>`<tr><td><strong>${esc(r.category)}</strong></td><td>${num(r.distinctPackages)}</td><td>${num(r.fundraiserCount)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.averagePledge)}</td><td>${pct(r.costPercentOfPledged)}</td></tr>`))}</section>
      <section><div class="section-heading"><h2>Package composition trends</h2><p>Groups different exact premiums that use the same component recipe, such as DVD + CD + Book.</p></div>${table(['Package composition','Exact packages','Titles','Fundraisers','Pledges','Pledged','Avg pledge','Cost %'],(s.compositions||[]).map((r)=>`<tr><td><strong>${esc(r.label)}</strong></td><td>${num(r.distinctPackages)}</td><td>${num(r.distinctTitles)}</td><td>${num(r.fundraiserCount)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.averagePledge)}</td><td>${pct(r.costPercentOfPledged)}</td></tr>`))}</section>
      <section><div class="section-heading"><h2>Program / topic context</h2><p>Current Program Library premium text may be used as a historical proxy. It is labeled as such rather than treated as verified history.</p></div><div class="premium-two-col"><div><h3>Programs</h3>${table(['Program','Packages','Pledges','Premium-linked $','Cost %'],s.programs.slice(0,20).map((r)=>`<tr><td><strong>${esc(r.label)}</strong></td><td>${num(r.exactPremiumCount)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${pct(r.costPercentOfPledged)}</td></tr>`))}</div><div><h3>Topics</h3>${table(['Topic','Packages','Pledges','Premium-linked $','Cost %'],s.topics.slice(0,20).map((r)=>`<tr><td><strong>${esc(r.label)}</strong></td><td>${num(r.exactPremiumCount)}</td><td>${num(r.pledgeCount)}</td><td>${money(r.pledgedDollars)}</td><td>${pct(r.costPercentOfPledged)}</td></tr>`))}</div></div></section>
      <section><div class="section-heading"><h2>Combined program / topic context</h2><p>Existing broadcast results and premium-report dollars are kept as separate measures. This lets the report compare the fundraising program with its premium economics without pretending the two sources have identical attribution.</p></div><div class="premium-two-col"><div><h3>Programs</h3>${table(['Program','Broadcast $','$ / pledge hr','Premium-linked $','Premium cost'],s.combinedPrograms.filter((r)=>r.premiumPackages).slice(0,20).map((r)=>`<tr><td><strong>${esc(r.programTitle)}</strong><br><small>${esc(r.fundraiserLabel)}</small></td><td>${money(r.broadcastDollars)}</td><td>${money(r.broadcastDollarsPerHour)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.totalPremiumCost)}</td></tr>`))}</div><div><h3>Topics</h3>${table(['Topic','Broadcast $','$ / pledge hr','Premium-linked $','Premium cost'],s.combinedTopics.filter((r)=>r.premiumPackages).slice(0,20).map((r)=>`<tr><td><strong>${esc(r.topic)}</strong></td><td>${money(r.broadcastDollars)}</td><td>${money(r.broadcastDollarsPerHour)}</td><td>${money(r.pledgedDollars)}</td><td>${money(r.totalPremiumCost)}</td></tr>`))}</div></div></section>
      <section><div class="section-heading"><h2>Data confidence</h2></div><p class="data-quality-note">Mapping rows: ${num(quality['Historically verified']||0)} historically verified · ${num(quality['Current-offer proxy']||0)} current-offer proxy · ${num(quality['Strongly inferred']||0)} strongly inferred · ${num(quality.Unmapped||0)} unmapped. Reported premium costs exclude expenses not present in the source report, such as shipping/handling.</p></section>
    </article>`;
  }
  function populate() {
    const select=$('#premium-report-fundraiser');
    const old=select.value;
    const imports=D.state.imports;
    select.innerHTML=`<option value="all">All imported fundraisers</option>${imports.map((i)=>`<option value="${esc(i.fundraiser.key)}">${esc(i.fundraiser.label)}</option>`).join('')}`;
    if([...select.options].some((o)=>o.value===old))select.value=old;
  }
  async function init(){
    try{
      if(!A||!D)throw new Error('Premium report modules did not load.');
      const allowed=await D.requireAdmin({gateId:'premium-report-access-gate',appId:'premium-report-app',roleId:'premium-report-role'}); if(!allowed)return;
      await D.loadExistingAnalytics(); populate(); render();
      setStatus(D.state.imports.length?'Premium report ready.':'No browser-stored premium reports yet. Import them in Premium Analytics first.',D.state.imports.length?'good':'warn');
      $('#premium-report-fundraiser')?.addEventListener('change',render);
      $('#premium-report-print')?.addEventListener('click',()=>window.print());
    }catch(error){console.error(error);setStatus(error?.message||'Premium report could not start.','error');}
  }
  document.addEventListener('DOMContentLoaded',init,{once:true});
})();
