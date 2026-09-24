(() => {
  'use strict';

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function money(value) {
    const n = Number(value);
    return Number.isFinite(n)
      ? n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
      : '';
  }

  function clock(minutes) {
    let m = Number(minutes);
    if (!Number.isFinite(m)) return '';
    m = ((m % 1440) + 1440) % 1440;
    const h = Math.floor(m / 60);
    const mi = m % 60;
    return (h % 12 || 12) + (mi ? ':' + String(mi).padStart(2, '0') : '') + ' ' + (h >= 12 ? 'PM' : 'AM');
  }

  function timingEvidenceHtml(slot) {
    const timing = slot && slot.timingEvidence ? slot.timingEvidence : {};
    const peer = Array.isArray(timing.peerEvidence) ? timing.peerEvidence : [];
    const nearby = Array.isArray(timing.nearbyPeers) ? timing.nearbyPeers : [];
    const localFundraisers = Number(timing.localFundraisers || 0);
    const localRows = Number(timing.localRows || 0);
    const localAverage = Number(timing.localAverageRate);

    let localText = 'WNMU has no direct rate-valid history in this exact window.';
    if (localFundraisers >= 2 && Number.isFinite(localAverage)) {
      localText = 'WNMU has ' + localFundraisers + ' fundraiser samples here, averaging $' + Math.round(localAverage) + '/pledge hr.';
    } else if (localRows > 0) {
      localText = 'WNMU has only ' + localRows + ' rate-valid historical row' + (localRows === 1 ? '' : 's') + ' in this exact window.';
    }

    let html = '<div class="strategy-window-rationale">';
    html += '<div class="strategy-window-rationale-head"><strong>Why this window?</strong><span>' + esc(timing.status || 'Timing evidence unavailable') + '</span></div>';
    html += '<p>' + esc(localText) + '</p>';

    if (timing.boundaryNote) {
      html += '<p><strong>Timing note:</strong> ' + esc(timing.boundaryNote) + '</p>';
    }

    html += '<div class="strategy-window-peer"><strong>Peer evidence</strong>';
    if (peer.length) {
      html += '<ul class="strategy-timing-peer-list">';
      peer.slice(0, 4).forEach(function (item) {
        html += '<li class="evidence-' + esc(item.tone || 'neutral') + '"><b>' + esc(item.sourceLabel || 'Other station') + ':</b> ' + esc(item.text || '') + '</li>';
      });
      html += '</ul>';
    } else {
      html += '<p>No matching peer-station evidence is loaded for this exact planning window.</p>';
    }
    html += '</div>';

    if (nearby.length) {
      html += '<div class="strategy-timing-nearby"><strong>Nearby exact peer starts</strong><ul>';
      nearby.forEach(function (item) {
        html += '<li class="evidence-' + esc(item.tone || 'neutral') + '">';
        html += '<b>' + esc(clock(item.startMinutes)) + ' · ' + esc(item.sourceLabel || 'Other station') + '</b>';
        if (item.programTitle) html += ' · ' + esc(item.programTitle);
        html += ': ' + esc(item.text || '');
        if (Number.isFinite(Number(item.actualDollars))) html += ' · ' + esc(money(item.actualDollars));
        if (Number.isFinite(Number(item.pledgeCount))) html += ' · ' + Number(item.pledgeCount) + ' pledge' + (Number(item.pledgeCount) === 1 ? '' : 's');
        html += '</li>';
      });
      html += '</ul></div>';
    }

    html += '</div>';
    return html;
  }

  function decorateDayMap(root, strategy) {
    if (!root || !strategy || !Array.isArray(strategy.windows)) return;
    const mapSection = Array.from(root.querySelectorAll('section.sheet-section')).find(function (section) {
      const heading = section.querySelector(':scope > h2');
      return heading && heading.textContent.trim() === 'Day-by-day programming map';
    });
    if (!mapSection) return;

    const intro = mapSection.querySelector(':scope > p');
    if (intro) {
      intro.textContent = 'These are planning windows, not automatic exact start times. Evidence-thin windows now explain why the window exists and show nearby peer timing examples before you treat a boundary such as 5:00 PM as a schedule recommendation.';
    }

    const headTime = mapSection.querySelector('.strategy-program-head > span:first-child');
    if (headTime) headTime.textContent = 'Planning window';

    const byDate = new Map();
    strategy.windows.forEach(function (slot) {
      if (!byDate.has(slot.date)) byDate.set(slot.date, []);
      byDate.get(slot.date).push(slot);
    });

    const dayNodes = Array.from(mapSection.querySelectorAll('.strategy-day-compact'));
    const dateGroups = Array.from(byDate.entries());

    dayNodes.forEach(function (dayNode, dayIndex) {
      const slots = dateGroups[dayIndex] ? dateGroups[dayIndex][1] : [];
      const dividers = Array.from(dayNode.querySelectorAll('.strategy-window-divider'));
      dividers.forEach(function (divider, slotIndex) {
        const slot = slots[slotIndex];
        if (!slot || slot.blocked) return;

        const timing = slot.timingEvidence || {};
        const thin = Number(timing.localFundraisers || 0) < 2;
        if (thin) divider.classList.add('is-evidence-thin');

        const status = divider.querySelector('span');
        if (status && timing.status) {
          status.textContent = status.textContent + ' · ' + timing.status;
        }

        if (thin || slot.label === 'Early evening' || slot.experimental) {
          divider.insertAdjacentHTML('afterend', timingEvidenceHtml(slot));
        }

        const windowText = clock(slot.startMinutes) + '–' + clock(slot.endMinutes);
        let sibling = divider.nextElementSibling;
        while (sibling && !sibling.classList.contains('strategy-window-divider')) {
          if (sibling.classList.contains('strategy-window-rationale')) {
            sibling = sibling.nextElementSibling;
            continue;
          }
          if (sibling.classList.contains('strategy-program-row') && !sibling.classList.contains('strategy-program-head')) {
            const timeCell = sibling.querySelector('.strategy-program-time');
            if (timeCell) timeCell.textContent = windowText;
          }
          sibling = sibling.nextElementSibling;
        }
      });
    });
  }

  function comparisonSummary(item) {
    if (!item || !Number(item.pairedFundraisers)) {
      return { paired:0, eight:0, nine:0, ties:0, diff:null, differenceLabel:'Not enough paired history' };
    }
    const paired = Number(item.pairedFundraisers || 0);
    const eight = Number(item.hourAWins || 0);
    const nine = Number(item.hourBWins || 0);
    const ties = Number(item.ties || 0);
    const diff = Number(item.medianDifference);
    let differenceLabel = 'Median difference unavailable';
    if (Number.isFinite(diff)) {
      if (Math.abs(diff) < 0.5) differenceLabel = 'Median difference: essentially even';
      else if (diff > 0) differenceLabel = 'Median difference: 9:00 PM +' + money(Math.abs(diff)) + '/pledge hr';
      else differenceLabel = 'Median difference: 8:00 PM +' + money(Math.abs(diff)) + '/pledge hr';
    }
    return { paired, eight, nine, ties, diff, differenceLabel };
  }

  function comparisonCell(item) {
    const s = comparisonSummary(item);
    if (!s.paired) return '<span class="strategy-starttime-none">Not enough paired history</span>';
    return '<div class="strategy-starttime-cell">' +
      '<strong>' + s.paired + ' paired fundraiser' + (s.paired === 1 ? '' : 's') + '</strong>' +
      '<div class="strategy-starttime-wins">' +
        '<span><b>8:00 PM better:</b> ' + s.eight + '</span>' +
        '<span><b>9:00 PM better:</b> ' + s.nine + '</span>' +
        '<span><b>Ties:</b> ' + s.ties + '</span>' +
      '</div>' +
      '<div class="strategy-starttime-difference">' + esc(s.differenceLabel) + '</div>' +
    '</div>';
  }

  function startTimeReconciliationHtml(hourly, diagnostics) {
    const rec = hourly && hourly.reconciliation ? hourly.reconciliation : null;
    if (!rec) return '';

    const overall = comparisonSummary(rec.overall || {});
    const rows = Array.isArray(rec.weekdays) ? rec.weekdays : [];
    let html = '<div class="strategy-starttime-reconcile">';
    html += '<div class="strategy-starttime-reconcile-head"><strong>8:00 PM vs 9:00 PM cross-check</strong><span>Paired-fundraiser comparison</span></div>';
    html += '<div class="strategy-starttime-howto"><strong>How to read this</strong>';
    html += '<p>A <b>paired fundraiser</b> is one where we have at least one pledge-program start in both the <b>8:00–8:29 PM</b> bucket and the <b>9:00–9:29 PM</b> bucket for the weekday being compared. <b>8:30 and 9:30 are separate buckets and are not included in this cross-check.</b></p>';
    html += '<p><b>8:00 PM better</b> and <b>9:00 PM better</b> count which bucket had the higher dollars-per-pledge-hour result within each fundraiser. <b>Median difference</b> is the middle of those within-fundraiser differences. It describes the history; it does not mean moving the same program by one hour will automatically create that amount.</p>';
    html += '</div>';

    if (Number(diagnostics?.excludedBoundaryBreakRows || 0) > 0) {
      html += '<p class="strategy-starttime-cleanup"><strong>Data cleanup:</strong> ' +
        Number(diagnostics.excludedBoundaryBreakRows) +
        ' regular-program boundary/end-break row' +
        (Number(diagnostics.excludedBoundaryBreakRows) === 1 ? '' : 's') +
        ' excluded from pledge-program performance and start-time averages.</p>';
    }

    if (overall.paired) {
      html += '<p class="strategy-starttime-broad"><b>Broad history:</b> ' +
        overall.paired + ' paired fundraisers. <b>8:00 PM better: ' + overall.eight +
        '</b> · <b>9:00 PM better: ' + overall.nine + '</b> · <b>Ties: ' + overall.ties +
        '</b>. <b>' + esc(overall.differenceLabel) + '.</b></p>';
    }

    html += '<p>The hourly grid above is narrower: it is <b>weekday-specific</b> and usually <b>' +
      esc(rec.targetSeason || hourly.season || 'selected') +
      '-season specific</b>. A weekday can therefore legitimately differ from the broad result.</p>';

    const usable = rows.filter(function (row) {
      return Number(row.allHistory?.pairedFundraisers || 0) > 0 || Number(row.targetSeason?.pairedFundraisers || 0) > 0;
    });

    if (usable.length) {
      html += '<div class="strategy-starttime-reconcile-table">';
      html += '<div class="strategy-starttime-reconcile-row strategy-starttime-reconcile-header"><span>Weekday</span><span>All history</span><span>' +
        esc(rec.targetSeason || 'Target season') + ' only</span></div>';
      usable.forEach(function (row) {
        html += '<div class="strategy-starttime-reconcile-row"><strong>' + esc(row.weekday || '') + '</strong><span>' +
          comparisonCell(row.allHistory) + '</span><span>' + comparisonCell(row.targetSeason) + '</span></div>';
      });
      html += '</div>';
    }

    html += '<p class="strategy-starttime-caution"><strong>Still not causal.</strong> Pairing the 8:00 PM and 9:00 PM half-hour buckets within the same fundraiser reduces drive-to-drive differences, but program mix remains a major confound. A bucket loaded with unusually strong or weak titles can make the clock look more important than it is.</p>';
    html += '</div>';
    return html;
  }

  function decorateHourlySection(root, hourly, diagnostics) {
    if (!root || !hourly) return;
    const section = Array.from(root.querySelectorAll('section.sheet-section')).find(function (item) {
      const heading = item.querySelector('.strategy-section-head h2, :scope > h2');
      return heading && heading.textContent.trim() === 'Day/time performance';
    });
    if (!section || section.querySelector('.strategy-starttime-reconcile')) return;
    const head = section.querySelector(':scope > .strategy-section-head');
    const html = startTimeReconciliationHtml(hourly, diagnostics || {});
    if (!html) return;
    if (head) head.insertAdjacentHTML('afterend', html);
    else section.insertAdjacentHTML('afterbegin', html);
  }

  function peerPracticesHtml(rows) {
    if (!Array.isArray(rows) || !rows.length) {
      return '<section class="sheet-section"><h2>Peer practices WNMU may be leaving on the table</h2><p>No strong positive peer-practice evidence is loaded yet.</p></section>';
    }

    let html = '<section class="sheet-section strategy-peer-practices-section">';
    html += '<div class="strategy-section-head"><div><h2>Peer practices WNMU may be leaving on the table</h2>';
    html += '<p>Positive reports from other public-TV stations. “Not represented” means the tactic is absent from the structured WNMU strategy data, not proof that staff never use it.</p></div></div>';
    html += '<div class="strategy-peer-practice-grid">';

    rows.forEach(function (item) {
      html += '<article class="strategy-peer-practice">';
      html += '<header><strong>' + esc(item.label || '') + '</strong><span>' + Number(item.stationCount || 0) + ' station' + (Number(item.stationCount || 0) === 1 ? '' : 's') + ' · ' + Number(item.observationCount || 0) + ' positive observation' + (Number(item.observationCount || 0) === 1 ? '' : 's') + '</span></header>';
      html += '<p class="strategy-peer-status"><b>WNMU status:</b> ' + esc(item.wnmuStatus || 'Not classified.') + '</p>';
      html += '<div class="strategy-peer-examples">';

      (item.examples || []).forEach(function (example) {
        html += '<div><strong>' + esc(example.station || 'Other station') + '</strong><span>';
        if (example.programTitle) html += esc(example.programTitle) + ' · ';
        html += esc(example.summary || '');
        if (Number.isFinite(Number(example.actualDollars))) html += ' · ' + esc(money(example.actualDollars));
        if (Number.isFinite(Number(example.goalDollars))) html += ' on ' + esc(money(example.goalDollars)) + ' goal';
        if (Number.isFinite(Number(example.pledgeCount))) html += ' · ' + Number(example.pledgeCount) + ' pledge' + (Number(example.pledgeCount) === 1 ? '' : 's');
        html += '</span></div>';
      });

      html += '</div>';
      html += '<p class="strategy-peer-test"><b>Possible WNMU test:</b> ' + esc(item.testIdea || '') + '</p>';
      html += '</article>';
    });

    html += '</div></section>';
    return html;
  }

  function insertPeerPractices(root, rows) {
    if (!root) return;
    const mapSection = Array.from(root.querySelectorAll('section.sheet-section')).find(function (section) {
      const heading = section.querySelector(':scope > h2');
      return heading && heading.textContent.trim() === 'Day-by-day programming map';
    });
    if (!mapSection) return;
    mapSection.insertAdjacentHTML('beforebegin', peerPracticesHtml(rows));
  }

  function splitCompoundSections(root) {
    if (!root) return;
    const compounds = Array.from(root.querySelectorAll('section.sheet-section.strategy-two-column'));
    compounds.forEach(function (compound) {
      const replacement = document.createDocumentFragment();
      const columns = Array.from(compound.children);

      columns.forEach(function (column) {
        let current = null;
        Array.from(column.childNodes).forEach(function (node) {
          if (node.nodeType === 1 && node.tagName === 'H2') {
            current = document.createElement('section');
            current.className = 'sheet-section strategy-split-section';
            current.appendChild(node);
            replacement.appendChild(current);
          } else if (current) {
            current.appendChild(node);
          }
        });
      });

      if (replacement.childNodes.length) compound.replaceWith(replacement);
    });
  }

  function enableCollapsibleSections(root) {
    if (!root) return;
    const sections = Array.from(root.querySelectorAll('section.sheet-section'));
    sections.forEach(function (section, index) {
      if (section.dataset.collapseReady === '1') return;
      section.dataset.collapseReady = '1';

      let head = section.querySelector(':scope > .strategy-section-head');
      if (!head) {
        const heading = section.querySelector(':scope > h2');
        if (!heading) return;
        head = document.createElement('div');
        head.className = 'strategy-section-head strategy-generated-head';
        section.insertBefore(head, heading);
        head.appendChild(heading);
      }

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'strategy-collapse-toggle';
      button.setAttribute('aria-expanded', 'true');
      button.textContent = 'Hide';
      head.appendChild(button);

      if (!section.id) section.id = 'strategy-section-' + index;
      button.addEventListener('click', function () {
        const collapsed = section.classList.toggle('is-collapsed');
        button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        button.textContent = collapsed ? 'Show' : 'Hide';
      });
    });
  }

  function decorate(root, result) {
    if (!root || !result) return;
    decorateHourlySection(root, result.hourlyPatterns || {}, result.diagnostics || {});
    insertPeerPractices(root, result.peerPractices || []);
    decorateDayMap(root, result.strategy || {});
    splitCompoundSections(root);
    enableCollapsibleSections(root);
  }

  globalThis.WNMUStrategyEnhancements = {
    decorate,
    decorateDayMap,
    decorateHourlySection,
    startTimeReconciliationHtml,
    insertPeerPractices,
    splitCompoundSections,
    enableCollapsibleSections,
    timingEvidenceHtml,
    peerPracticesHtml
  };
})();