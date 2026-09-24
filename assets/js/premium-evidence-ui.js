(() => {
  'use strict';

  const D = window.WNMUPremiumData;
  const H = window.WNMUPremiumHistoricalEvidence;

  function setStatus(message, tone = '') {
    const node = document.getElementById('premium-status');
    if (!node) return;
    node.textContent = message;
    node.className = `premium-status ${tone}`.trim();
  }

  function refreshCount() {
    const node = document.getElementById('premium-evidence-count');
    if (!node || !H || !D) return;
    const summary = H.summary(D.state.historicalEvidence);
    node.textContent = `${summary.offerCount} verified offer record${summary.offerCount === 1 ? '' : 's'} · ${summary.selectedMappingCount} selected-premium mapping${summary.selectedMappingCount === 1 ? '' : 's'}`;
  }

  function triggerRefresh() {
    const filter = document.getElementById('premium-fundraiser-filter');
    if (filter) filter.dispatchEvent(new Event('change', { bubbles:true }));
    refreshCount();
  }

  async function importEvidence(file) {
    const raw = await file.text();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_error) {
      throw new Error('That evidence file is not valid JSON.');
    }
    const checked = H.validateEvidence(parsed);
    if (!checked.valid) throw new Error(checked.errors.join(' '));
    D.setHistoricalEvidence(checked.evidence);
    triggerRefresh();
    const summary = H.summary(checked.evidence);
    setStatus(
      `Loaded ${summary.offerCount} verified historical offer record${summary.offerCount === 1 ? '' : 's'} across ${summary.fundraiserCount} fundraiser${summary.fundraiserCount === 1 ? '' : 's'}. Existing pledge data was not changed.`,
      'good'
    );
  }

  function start() {
    if (!D || !H) return;
    refreshCount();

    const input = document.getElementById('premium-evidence-file-input');
    input?.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        setStatus('Loading verified historical premium evidence…');
        await importEvidence(file);
      } catch (error) {
        console.error(error);
        setStatus(error?.message || 'Historical premium evidence import failed.', 'error');
      } finally {
        event.target.value = '';
      }
    });

    document.getElementById('premium-clear-evidence')?.addEventListener('click', () => {
      if (!window.confirm('Clear only the browser-stored verified premium-offer evidence? Premium-cost reports and existing WNMU data will remain untouched.')) return;
      D.clearHistoricalEvidence();
      triggerRefresh();
      setStatus('Verified premium-offer evidence cleared. Premium-cost reports and existing pledge/program data were untouched.', 'good');
    });
  }

  window.WNMUPremiumEvidenceUI = { importEvidence, refreshCount };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once:true });
  else start();
})();