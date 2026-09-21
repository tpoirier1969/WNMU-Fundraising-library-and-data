(() => {
  'use strict';
  function installCard() {
    const hub = document.querySelector('.report-hub');
    if (!hub || hub.querySelector('[data-premium-report-card]')) return false;
    const card = document.createElement('a');
    card.className = 'report-card-link';
    card.href = 'premium-report.html';
    card.dataset.premiumReportCard = 'true';
    card.innerHTML = `
      <div class="report-card-number">06</div>
      <div><h2>Premium Performance &amp; Economics</h2><p>Compare exact premium packages, premium cost, category patterns, and program/topic context without double-counting bundle components.</p></div>
      <span>Open premium report →</span>`;
    hub.append(card);
    return true;
  }
  function start() {
    if (installCard()) return;
    const root = document.getElementById('report-output') || document.body;
    const observer = new MutationObserver(() => { if (installCard()) observer.disconnect(); });
    observer.observe(root, { childList:true, subtree:true });
    window.setTimeout(() => observer.disconnect(), 15000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true}); else start();
})();
