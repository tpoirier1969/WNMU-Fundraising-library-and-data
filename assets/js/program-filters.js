(() => {
  const App = window.PledgeLib;
  const { utils, derive } = App;

  function sameLookupValue(a, b) {
    return utils.normalizeLookupKey(a) === utils.normalizeLookupKey(b);
  }

  function scoreOptionLabel(value) {
    const text = utils.normalizeText(value);
    if (!text) return -1;
    const hasLower = /[a-z]/.test(text);
    const hasUpper = /[A-Z]/.test(text);
    const isAllCaps = hasUpper && !hasLower;
    if (isAllCaps) return 1;
    if (hasUpper && hasLower) return 3;
    return 2;
  }

  function canonicalOptionEntries(values = []) {
    const map = new Map();
    (values || []).forEach((value) => {
      const label = utils.normalizeText(value);
      const key = utils.normalizeLookupKey(label);
      if (!key) return;
      const existing = map.get(key);
      if (!existing || scoreOptionLabel(label) > scoreOptionLabel(existing.label) || utils.compareText(label, existing.label) < 0) {
        map.set(key, { value: label, label });
      }
    });
    return [...map.values()].sort((a, b) => utils.compareText(a.label, b.label));
  }

  function latestAiredValue(rows = []) {
    const candidates = (rows || [])
      .map((row) => utils.firstNonEmpty(
        row?.last_aired_at,
        row?.last_aired,
        row?.aired_at,
        row?.last_aired_date,
        row?.air_date,
        row?.most_recent_airing_at,
        row?.most_recent_airing,
        row?.recent_airing_date
      ))
      .filter(Boolean)
      .map((value) => ({ raw: value, ts: new Date(value).getTime() }))
      .filter((entry) => Number.isFinite(entry.ts))
      .sort((a, b) => b.ts - a.ts);
    return candidates[0]?.raw || '';
  }

  function rowHasAired(row = {}) {
    const airedDate = utils.firstNonEmpty(
      row?.last_aired_at,
      row?.last_aired,
      row?.aired_at,
      row?.last_aired_date,
      row?.air_date,
      row?.most_recent_airing_at,
      row?.most_recent_airing,
      row?.recent_airing_date
    );
    if (utils.normalizeText(airedDate)) return true;

    const counts = [
      row?.fundraiser_count,
      row?.drive_count,
      row?.fundraiser_total,
      row?.drive_total,
      row?.airing_count,
      row?.aired_count,
      row?.times_aired,
      row?.total_airings,
      row?.total_airings_count
    ].map((value) => Number(value)).filter((value) => Number.isFinite(value));
    if (counts.some((value) => value > 0)) return true;

    const avg = Number(derive.avgPerFundraiser(row) || 0) || 0;
    const total = Number(derive.totalRaised(row) || 0) || 0;
    return avg > 0 || total > 0;
  }

  function rowIsTopEarner(row = {}, threshold = 500) {
    const avg = Number(derive.avgPerFundraiser(row) || 0) || 0;
    return avg >= threshold;
  }

  function rightsYearMatches(row = {}, targetYear) {
    const year = Number(targetYear);
    if (!Number.isFinite(year) || year < 1900) return false;
    const rightsBegin = utils.normalizeText(derive.rightsBegin(row));
    const match = rightsBegin.match(/(19|20)\d{2}/);
    return Boolean(match) && Number(match[0]) === year;
  }

  function rowMatchesStatus(row = {}, statusFilter = 'active') {
    if (statusFilter === 'active') return derive.isActive(row);
    if (statusFilter === 'archived') return !derive.isActive(row);
    return true;
  }

  function identityKey(row = {}) {
    if (utils.isNonSpecificRow(row)) return 'non_specific';
    const direct = String(derive.programId(row) || '').trim();
    if (direct) return `id:${direct}`;
    const nolaKey = utils.normalizeLookupKey(derive.nola(row));
    if (nolaKey) return `nola:${nolaKey}`;
    const titleKey = utils.normalizeLookupKey(derive.title(row));
    if (titleKey) return `title:${titleKey}`;
    return '';
  }

  function scoreRowForPreference(row = {}, statusPreference = 'all') {
    let score = 0;
    if (derive.programId(row)) score += 500;
    if (derive.nola(row)) score += 260;
    if (derive.title(row)) score += 120;
    if (derive.topicPrimary(row)) score += 50;
    if (derive.distributor(row)) score += 25;
    if (derive.rightsBegin(row)) score += 30;
    if (derive.rightsEnd(row)) score += 30;
    if (rowHasAired(row)) score += 80;
    if (rowIsTopEarner(row)) score += 40;
    if (derive.isActive(row)) score += statusPreference === 'archived' ? -40 : 40;
    else score += statusPreference === 'archived' ? 40 : -40;
    const total = Number(derive.totalRaised(row) || 0) || 0;
    const avg = Number(derive.avgPerFundraiser(row) || 0) || 0;
    score += Math.min(Math.round(total / 50), 40);
    score += Math.min(Math.round(avg / 25), 20);
    return score;
  }

  function collapseRows(rows = [], options = {}) {
    const statusPreference = options.statusPreference || 'all';
    const groups = new Map();
    (rows || []).forEach((row, index) => {
      const key = identityKey(row) || `row:${index}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });

    return [...groups.values()].map((group) => {
      const ordered = [...group].sort((a, b) => {
        const scoreDiff = scoreRowForPreference(b, statusPreference) - scoreRowForPreference(a, statusPreference);
        if (scoreDiff) return scoreDiff;
        return utils.compareText(derive.title(a), derive.title(b));
      });
      const merged = ordered.reduce((acc, row) => utils.mergeRows(acc, row), {});
      const latestAired = latestAiredValue(group);
      if (latestAired && utils.isBlank(merged.last_aired_at) && utils.isBlank(merged.last_aired) && utils.isBlank(merged.aired_at)) {
        merged.last_aired_at = latestAired;
      }
      const maxCount = Math.max(0, ...(group.map((row) => Number(utils.firstNonEmpty(
        row?.fundraiser_count,
        row?.drive_count,
        row?.fundraiser_total,
        row?.drive_total,
        row?.airing_count,
        row?.aired_count,
        row?.times_aired,
        row?.total_airings,
        0
      ))).filter((value) => Number.isFinite(value))));
      if (maxCount > 0) {
        if (!Number(merged.fundraiser_count)) merged.fundraiser_count = maxCount;
        if (!Number(merged.airing_count)) merged.airing_count = maxCount;
      }
      const maxTotal = Math.max(0, ...(group.map((row) => Number(derive.totalRaised(row) || 0)).filter((value) => Number.isFinite(value))));
      const maxAvg = Math.max(0, ...(group.map((row) => Number(derive.avgPerFundraiser(row) || 0)).filter((value) => Number.isFinite(value))));
      const mergedTotal = Number(derive.totalRaised(merged) || 0) || 0;
      const mergedAvg = Number(derive.avgPerFundraiser(merged) || 0) || 0;
      if (maxTotal > 0 && !(mergedTotal > 0)) merged.total_contributions = maxTotal;
      if (maxAvg > 0 && !(mergedAvg > 0)) merged.avg_contribution_per_drive = maxAvg;
      const repairedCount = Number(utils.firstNonEmpty(
        merged?.fundraiser_count,
        merged?.drive_count,
        merged?.fundraiser_total,
        merged?.drive_total,
        merged?.airing_count,
        merged?.aired_count,
        merged?.times_aired,
        merged?.total_airings,
        0
      ) || 0);
      const repairedAvg = Number(derive.avgPerFundraiser(merged) || 0) || 0;
      const repairedTotal = Number(derive.totalRaised(merged) || 0) || 0;
      if (repairedAvg > 0 && repairedTotal <= 0) {
        merged.total_contributions = repairedCount > 0 ? Math.round(repairedAvg * repairedCount * 100) / 100 : Math.round(repairedAvg * 100) / 100;
      }
      if (repairedTotal > 0 && !(repairedAvg > 0) && repairedCount > 0) {
        merged.avg_contribution_per_drive = Math.round((repairedTotal / repairedCount) * 100) / 100;
      }
      return merged;
    });
  }

  function rowMatchesScheduleFilters(row = {}, filters = {}) {
    if (filters.unairedOnly && rowHasAired(row)) return false;
    if (filters.rightsStartYear && !rightsYearMatches(row, filters.rightsStartYear)) return false;
    if (filters.topEarner && !rowIsTopEarner(row, Number(filters.topEarnerThreshold) || 500)) return false;
    return true;
  }

  App.programFilters = {
    sameLookupValue,
    canonicalOptionEntries,
    rowHasAired,
    rowIsTopEarner,
    rightsYearMatches,
    rowMatchesStatus,
    identityKey,
    collapseRows,
    rowMatchesScheduleFilters
  };
})();
