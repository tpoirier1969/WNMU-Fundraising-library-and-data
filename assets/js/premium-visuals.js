(() => {
  'use strict';

  const A = window.WNMUPremiumAnalysis;
  const D = window.WNMUPremiumData;
  const X = window.WNMUPremiumChartAnalysis;
  const C = window.WNMUPremiumCharts;
  const $ = (selector, root = document) => root.querySelector(selector);

  function filteredSnapshot(mode = 'analytics') {
    const full = D?.snapshot?.();
    if (!full) return null;
    const selectId = mode === 'report' ? '#premium-report-fundraiser' : '#premium-fundraiser-filter';
    const key = $(selectId)?.value || 'all';
    if (key === 'all') return full;
    const imports = full.imports.filter((item) => item.fundraiser?.key === key);
    const flat = A.flattenImports(imports);
    const mappedRows = full.mappedRows.filter((row) => row.fundraiserKey === key);
    const performanceRows = full.performanceRows.filter((row) => row.fundraiserKey === key);
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
      premiumImpact: A.premiumImpactEvidence(mappedRows, flat.summaries, performanceRows),
      mappingQuality: A.mappingQuality(mappedRows)
    };
  }

  function setHtml(id, html) {
    const node = document.getElementById(id);
    if (node) node.innerHTML = html;
  }

  function metricLabel(metric) {
    return ({
      net:'Net after premium',
      pledged:'Pledged dollars',
      pledges:'Pledge count',
      cost:'Premium cost',
      average:'Average pledge',
      costPercent:'Premium cost %',
      workhorse:'Workhorse score'
    })[metric] || 'Value';
  }

  function metricFormatter(metric) {
    if (metric === 'pledges') return (value) => C.num(value);
    if (metric === 'costPercent') return (value) => C.pct(value);
    if (metric === 'workhorse') return (value) => C.num(value, 0);
    return (value) => C.money(value);
  }

  function workhorseHtml(snapshot, compact = false) {
    const leaders = X.workhorseLeaders(snapshot.packages || [], 5);
    if (!leaders.length) return C.empty('Not enough premium history to rank workhorses yet.');
    return `<div class="premium-workhorse-note">Workhorse score balances <strong>net after premium</strong> and <strong>pledge count</strong> equally using their geometric mean relative to the leaders in the current filter. A premium has to be strong on both dimensions to rank well.</div>
      <ol class="premium-workhorse-list ${compact ? 'compact' : ''}">${leaders.map((row, index)=>`<li>
        <span class="premium-workhorse-rank">#${index+1}</span>
        <div class="premium-workhorse-copy"><strong>${C.esc(row.description)}</strong><small>${C.esc(row.fundraiserLabel || '')}${row.packageCompositionLabel ? ` · ${C.esc(row.packageCompositionLabel)}` : ''}</small></div>
        <div class="premium-workhorse-metrics"><strong>${C.num(row.workhorseScore,0)}</strong><span>score</span><b>${C.money(row.estimatedNetAfterPremium)}</b><span>net</span><b>${C.num(row.pledgeCount)}</b><span>pledges</span></div>
      </li>`).join('')}</ol>`;
  }

  function compositionNetChart(snapshot) {
    const items = [...(snapshot.compositions || [])]
      .sort((a,b)=>Number(b.estimatedNetAfterPremium||0)-Number(a.estimatedNetAfterPremium||0))
      .slice(0,12)
      .map((row)=>({label:row.label,value:Number(row.estimatedNetAfterPremium)||0}));
    return C.horizontalBars(items,{formatter:C.money,ariaLabel:'Net after premium by package composition'});
  }

  function efficiencyChart(snapshot) {
    const items = [...(snapshot.packages || [])]
      .sort((a,b)=>Number(b.estimatedNetAfterPremium||0)-Number(a.estimatedNetAfterPremium||0))
      .slice(0,12)
      .map((row)=>({
        label:`${row.description} · ${row.fundraiserLabel || ''}`,
        value:Number(row.estimatedNetAfterPremium)||0,
        costPercent:Number(row.costPercentOfPledged)||0
      }));
    return C.horizontalBars(items,{
      formatter:C.money,
      annotation:(item)=>`cost ${C.pct(item.costPercent)}`,
      ariaLabel:'Net after premium with premium cost percentage'
    });
  }

  function mixChart(snapshot, metric = 'net') {
    const data = X.compositionMix(snapshot.mappedRows || [], metric, 7);
    return C.stackedBars(data.categories,data.series,{formatter:metricFormatter(metric),ariaLabel:`${metricLabel(metric)} mix by fundraiser`});
  }

  function averagePledgeChart(snapshot) {
    const rows = snapshot.fundraiserAnalysis || [];
    return C.groupedBars(
      rows.map((row)=>row.label),
      [
        {label:'Premium pledge',values:rows.map((row)=>Number(row.averagePremiumPledge)||0)},
        {label:'No-premium pledge',values:rows.map((row)=>Number(row.averageNoPremiumPledge)||0)}
      ],
      {formatter:C.money,ariaLabel:'Average premium pledge versus no-premium pledge by fundraiser'}
    );
  }

  function takeRateChart(snapshot) {
    const rows = snapshot.fundraiserAnalysis || [];
    return C.percentCombo(
      rows.map((row)=>row.label),
      rows.map((row)=>Number(row.premiumTakeRate)||0),
      rows.map((row)=>Number(row.premiumCostPercentOfTotal)||0),
      {barLabel:'Premium take rate',lineLabel:'Premium cost % of total pledged',ariaLabel:'Premium take rate and premium cost percentage by fundraiser'}
    );
  }

  function exactRankingChart(snapshot, metric='net', direction='top') {
    const rows = X.rankPackages(snapshot.packages || [],metric,direction,12);
    const formatter = metricFormatter(metric);
    const items = rows.map((row)=>({
      label:`${row.description} · ${row.fundraiserLabel || ''}`,
      value: metric === 'workhorse' ? Number(row.workhorseScore)||0 : X.packageMetric(row,metric),
      costPercent:Number(row.costPercentOfPledged)||0
    }));
    return C.horizontalBars(items,{
      formatter,
      annotation: metric === 'costPercent' ? ()=>'' : (item)=>`cost ${C.pct(item.costPercent)}`,
      ariaLabel:`${direction === 'bottom' ? 'Bottom' : 'Top'} exact premiums by ${metricLabel(metric)}`
    });
  }

  function brandCharts(snapshot) {
    const rows = snapshot.brandScopes || [];
    const grouped = C.groupedBars(
      rows.map((row)=>row.scope),
      [
        {label:'Pledged',values:rows.map((row)=>Number(row.pledgedDollars)||0)},
        {label:'Net after premium',values:rows.map((row)=>Number(row.estimatedNetAfterPremium)||0)},
        {label:'Premium cost',values:rows.map((row)=>Number(row.totalPremiumCost)||0)}
      ],
      {formatter:C.money,ariaLabel:'WNMU local versus national and program premium economics'}
    );
    const pie = C.pie(X.brandPie(rows,'pledges'),{formatter:C.num,ariaLabel:'Share of premium pledges by brand source'});
    return {grouped,pie};
  }

  function heatmapChart(snapshot, metric='net') {
    return C.heatmap(
      X.topicCompositionHeatmap(snapshot.mappedRows || [],metric,10,8),
      {formatter:metricFormatter(metric)}
    );
  }

  function renderAnalytics() {
    if (!$('#premium-visual-dashboard')) return;
    const snapshot = filteredSnapshot('analytics');
    if (!snapshot) return;
    setHtml('premium-workhorse-list', workhorseHtml(snapshot));
    setHtml('premium-composition-net-chart', compositionNetChart(snapshot));
    setHtml('premium-efficiency-chart', efficiencyChart(snapshot));

    const mixMetric = $('#premium-mix-metric')?.value || 'net';
    setHtml('premium-mix-chart', mixChart(snapshot,mixMetric));

    setHtml('premium-average-pledge-chart', averagePledgeChart(snapshot));
    setHtml('premium-take-rate-chart', takeRateChart(snapshot));

    const rankMetric = $('#premium-rank-metric')?.value || 'net';
    const rankDirection = $('#premium-rank-direction')?.value || 'top';
    setHtml('premium-exact-ranking-chart', exactRankingChart(snapshot,rankMetric,rankDirection));

    const brand = brandCharts(snapshot);
    setHtml('premium-brand-grouped-chart',brand.grouped);
    setHtml('premium-brand-pie-chart',brand.pie);

    const heatMetric = $('#premium-heatmap-metric')?.value || 'net';
    setHtml('premium-topic-composition-heatmap',heatmapChart(snapshot,heatMetric));
  }

  let reportRendering = false;

  function reportChartsHtml(snapshot) {
    const brand = brandCharts(snapshot);
    const mix = mixChart(snapshot,'net');
    return `<section class="premium-report-visuals" data-premium-report-visuals>
      <div class="section-heading"><h2>Visual premium analytics</h2><p>Charts use the same exact-package accounting and current fundraiser filter as the tables below.</p></div>
      <div class="premium-report-chart-grid">
        <article class="premium-chart-card premium-chart-card-wide"><h3>Premium Workhorses · Top 5</h3>${workhorseHtml(snapshot,true)}</article>
        <article class="premium-chart-card"><h3>Net after premium by package composition</h3>${compositionNetChart(snapshot)}</article>
        <article class="premium-chart-card"><h3>Net with premium-cost burden</h3>${efficiencyChart(snapshot)}</article>
        <article class="premium-chart-card premium-chart-card-wide"><h3>Fundraiser mix · net after premium</h3>${mix}</article>
        <article class="premium-chart-card"><h3>Average pledge · premium vs no premium</h3>${averagePledgeChart(snapshot)}<p class="premium-causal-warning"><strong>Association only.</strong> These donor groups are self-selected and are not a no-premium control experiment.</p></article>
        <article class="premium-chart-card"><h3>Take rate vs premium cost %</h3>${takeRateChart(snapshot)}</article>
        <article class="premium-chart-card"><h3>Exact premiums ranked by net</h3>${exactRankingChart(snapshot,'net','top')}</article>
        <article class="premium-chart-card"><h3>Brand / source economics</h3>${brand.grouped}</article>
        <article class="premium-chart-card"><h3>Share of premium pledges by brand / source</h3>${brand.pie}</article>
        <article class="premium-chart-card premium-chart-card-wide"><h3>Topic × package composition heat map · net after premium</h3>${heatmapChart(snapshot,'net')}</article>
      </div>
    </section>`;
  }

  function renderReport() {
    const output = $('#premium-report-output');
    if (!output || reportRendering || !output.firstElementChild) return;
    const snapshot = filteredSnapshot('report');
    if (!snapshot) return;
    reportRendering = true;
    output.querySelector('[data-premium-report-visuals]')?.remove();
    const article = output.querySelector('.premium-report-sheet') || output.firstElementChild;
    const header = article?.querySelector('.sheet-title');
    if (article) {
      const wrapper = document.createElement('div');
      wrapper.innerHTML = reportChartsHtml(snapshot);
      const section = wrapper.firstElementChild;
      if (header?.nextSibling) article.insertBefore(section,header.nextSibling);
      else article?.append(section);
    }
    window.setTimeout(()=>{ reportRendering=false; },0);
  }

  function bindAnalytics() {
    if (!$('#premium-visual-dashboard')) return;
    ['premium-mix-metric','premium-rank-metric','premium-rank-direction','premium-heatmap-metric','premium-fundraiser-filter'].forEach((id)=>{
      document.getElementById(id)?.addEventListener('change',()=>window.setTimeout(renderAnalytics,0));
    });
    const count=$('#premium-import-count');
    const status=$('#premium-status');
    const observer=new MutationObserver(()=>window.setTimeout(renderAnalytics,30));
    if(count) observer.observe(count,{childList:true,subtree:true,characterData:true});
    if(status) observer.observe(status,{childList:true,subtree:true,characterData:true});
    window.setTimeout(renderAnalytics,150);
  }

  function bindReport() {
    const output=$('#premium-report-output');
    if(!output) return;
    const observer=new MutationObserver(()=>window.setTimeout(renderReport,0));
    observer.observe(output,{childList:true,subtree:false});
    $('#premium-report-fundraiser')?.addEventListener('change',()=>window.setTimeout(renderReport,20));
    window.setTimeout(renderReport,180);
  }

  function start() {
    if (!A || !D || !X || !C) return;
    bindAnalytics();
    bindReport();
  }

  window.WNMUPremiumVisuals = {
    filteredSnapshot,
    workhorseHtml,
    compositionNetChart,
    efficiencyChart,
    mixChart,
    averagePledgeChart,
    takeRateChart,
    exactRankingChart,
    brandCharts,
    heatmapChart,
    renderAnalytics,
    renderReport
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();