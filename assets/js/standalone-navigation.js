(() => {
  'use strict';

  const placeholder = document.querySelector('[data-standalone-navigation]');
  if (!placeholder) return;

  const active = String(placeholder.dataset.active || '').trim();
  const extras = new Set(
    String(placeholder.dataset.extras || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  );

  const core = [
    ['library', 'Program Library', './?workspace=library'],
    ['scheduling', 'Pledge Scheduling', './?workspace=scheduling'],
    ['imports', 'Import Pledge Report', './?workspace=imports'],
    ['performance', 'Performance Analytics', './?workspace=performance'],
    ['comparison', 'Fundraiser Comparison Lab', './?workspace=comparison']
  ];

  const extraLinks = [
    ['reports', 'Report Center', 'reports.html'],
    ['strategy', 'Fundraiser Programming Strategy', 'programming-strategy.html'],
    ['premium', 'Premium Analytics', 'premium-analytics.html'],
    ['premium-report', 'Premium Report', 'premium-report.html']
  ].filter(([key]) => extras.has(key));

  const shell = document.createElement('div');
  shell.className = 'standalone-nav-shell';

  const nav = document.createElement('nav');
  nav.className = 'standalone-nav';
  nav.setAttribute('aria-label', 'WNMU Pledge navigation');

  const row = document.createElement('div');
  row.className = 'standalone-nav-row';

  const addLink = ([key, label, href]) => {
    const link = document.createElement('a');
    link.className = 'standalone-nav-link';
    link.href = href;
    link.textContent = label;
    if (key === active) {
      link.classList.add('is-active');
      link.setAttribute('aria-current', 'page');
    }
    row.appendChild(link);
  };

  core.forEach(addLink);

  if (extraLinks.length) {
    const divider = document.createElement('span');
    divider.className = 'standalone-nav-divider';
    divider.setAttribute('aria-hidden', 'true');
    row.appendChild(divider);
    extraLinks.forEach(addLink);
  }

  nav.appendChild(row);
  shell.appendChild(nav);
  placeholder.replaceWith(shell);
})();