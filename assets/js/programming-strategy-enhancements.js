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
        if (example.actualDollars != null && Number.isFinite(Number(example.actualDollars))) html += ' · ' + esc(money(example.actualDollars));
        if (example.goalDollars != null && Number.isFinite(Number(example.goalDollars))) html += ' on ' + esc(money(example.goalDollars)) + ' goal';
        if (example.pledgeCount != null && Number.isFinite(Number(example.pledgeCount))) html += ' · ' + Number(example.pledgeCount) + ' pledge' + (Number(example.pledgeCount) === 1 ? '' : 's');
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
    insertPeerPractices(root, result.peerPractices || []);
    decorateDayMap(root, result.strategy || {});
    splitCompoundSections(root);
    enableCollapsibleSections(root);
  }

  globalThis.WNMUStrategyEnhancements = {
    decorate,
    decorateDayMap,
    insertPeerPractices,
    splitCompoundSections,
    enableCollapsibleSections,
    timingEvidenceHtml,
    peerPracticesHtml
  };
})();