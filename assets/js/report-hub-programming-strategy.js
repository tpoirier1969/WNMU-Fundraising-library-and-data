(() => {
  'use strict';

  function installCard() {
    const hub = document.querySelector('.report-hub');
    if (!hub || hub.querySelector('[data-programming-strategy-card]')) return false;
    const card = document.createElement('a');
    card.className = 'report-card-link';
    card.href = 'programming-strategy.html';
    card.dataset.programmingStrategyCard = 'true';
    card.innerHTML = `
      <div class="report-card-number">05</div>
      <div><h2>Fundraiser Programming Strategy</h2><p>Plan an upcoming drive from pre-drive WNMU evidence, current Program Library rights, seasonality, rest/exposure and programmer ratings.</p></div>
      <span>Build strategy report →</span>`;
    hub.append(card);
    return true;
  }

  function start() {
    if (installCard()) return;
    const root = document.getElementById('report-output') || document.body;
    const observer = new MutationObserver(() => {
      if (installCard()) observer.disconnect();
    });
    observer.observe(root, { childList: true, subtree: true });
    window.setTimeout(() => observer.disconnect(), 15000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
