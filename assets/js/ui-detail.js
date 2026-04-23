(() => {
  const App = window.PledgeLib;
  const { state, utils, derive } = App;
  const { els, setDetailNotice } = App.dom;

  const PROGRAM_FIELD_ORDER = [
    'title', 'nola_code', 'program_id', 'id', 'topic_primary', 'topic_secondary', 'distributor', 'package_type',
    'source_format', 'length_bucket_minutes', 'actual_runtime_seconds', 'actual_runtime_minutes', 'runtime_minutes',
    'rights_start', 'rights_end', 'rights_notes', 'premium_summary', 'program_notes', 'status', 'library_state',
    'aired_on_13_1', 'aired_on_13_3', 'last_aired_at', 'last_aired', 'total_contributions', 'avg_contribution_per_drive'
  ];
  const CORE_EDIT_FIELD_SET = new Set([
    'title', 'nola_code', 'distributor', 'length_bucket_minutes', 'actual_runtime_seconds', 'actual_runtime_minutes', 'runtime_minutes',
    'topic_primary', 'topic_secondary', 'rights_start', 'rights_end', 'package_type', 'source_format', 'rights_notes',
    'premium_summary', 'program_notes'
  ]);
  const NON_EDITABLE_FIELD_PATTERN = /^(?:id|program_id|source_row_number|created_at|updated_at|created_by|updated_by|row_hash)$/i;
  const READ_ONLY_DETAIL_FIELD_PATTERN = /^(?:__.*|total_contributions|avg_contribution_per_drive|avg_per_fundraiser|total_raised|last_aired(?:_at)?|fundraiser_count|drive_count|fundraiser_total|matched_library_title|match_method|match_reason|approved_unlinked|review_status)$/i;

  function canEdit() {
    return App.auth.canEdit();
  }


  function friendlyCreateError(error) {
    const message = String(error?.message || error || '');
    if (/created_by_email|updated_by_email|created_by|updated_by/i.test(message)) {
      return 'The app tried to send audit columns that do not belong in pledge_programs_v2. That was an app bug, not a valid program field.';
    }
    if (/source_row_number/i.test(message) && /duplicate key value|unique constraint/i.test(message)) {
      return 'The app collided with a unique import-row marker while creating a manual program. That was an app bug, not a duplicate title rule.';
    }
    if (/row-level security|violates row-level security|permission denied|new row violates/i.test(message)) {
      return 'Supabase is blocking new-title inserts on pledge_programs_v2. The app can read and probably update, but INSERT is still denied by RLS. Run the included SQL patch for pledge_programs_v2 insert/update policies, then try again.';
    }
    return message || 'Something went sideways while saving this title.';
  }

  function blankProgram() {
    return {
      title: '',
      nola_code: '',
      distributor: '',
      length_bucket_minutes: '',
      actual_runtime_seconds: '',
      topic_primary: '',
      topic_secondary: '',
      rights_start: '',
      rights_end: '',
      package_type: '',
      source_format: '',
      rights_notes: '',
      premium_summary: '',
      program_notes: ''
    };
  }

  function resolveBaseProgramSource(source = {}) {
    const directId = String(derive.programId(source) || '');
    const directNola = utils.normalizeLookupKey(derive.nola(source));
    const directTitle = utils.normalizeLookupKey(derive.title(source));
    return (state.baseRows || []).find((row) => {
      if (directId && String(derive.programId(row) || '') === directId) return true;
      if (directNola && utils.normalizeLookupKey(derive.nola(row)) === directNola) return true;
      if (directTitle && utils.normalizeLookupKey(derive.title(row)) === directTitle) return true;
      return false;
    }) || source || {};
  }

  function isEditableExtraField(key, value) {
    if (!key || CORE_EDIT_FIELD_SET.has(key) || NON_EDITABLE_FIELD_PATTERN.test(key) || READ_ONLY_DETAIL_FIELD_PATTERN.test(key)) return false;
    if (typeof value === 'function') return false;
    if (value && typeof value === 'object' && !Array.isArray(value)) return false;
    return true;
  }

  function editableExtraFieldEntries(source = {}) {
    const baseSource = resolveBaseProgramSource(source);
    return Object.keys(baseSource || {})
      .filter((key) => isEditableExtraField(key, baseSource[key]))
      .sort(utils.compareText)
      .map((key) => [key, baseSource[key]]);
  }

  function inferExtraFieldKind(key, value) {
    if (/^(?:aired_on_13_1|aired_on_13_3)$/i.test(key)) return 'checkbox';
    if (typeof value === 'boolean') return 'checkbox';
    if (/(notes|description|summary|premium|memo|copy|text)$/i.test(key)) return 'textarea';
    if (typeof value === 'number') return 'number';
    if (value != null && value !== '' && /^-?\d+(?:\.\d+)?$/.test(String(value)) && !/^0\d+/.test(String(value))) return 'number';
    return 'text';
  }

  function renderExtraFieldsEditor(source = {}) {
    if (!els.detailExtraFieldsEditor) return;
    const entries = editableExtraFieldEntries(source);
    state.detailExtraFieldDraft = Object.fromEntries(entries.map(([key, value]) => [key, value]));
    if (!entries.length) {
      els.detailExtraFieldsEditor.innerHTML = '<div class="detail-extra-empty">No additional writable base-row fields were detected for this title.</div>';
      return;
    }
    els.detailExtraFieldsEditor.innerHTML = `<div class="detail-extra-grid">${entries.map(([key, value]) => {
      const kind = inferExtraFieldKind(key, value);
      const label = utils.escapeHtml(displayKeyLabel(key));
      if (kind === 'checkbox') {
        const checked = value === true || value === 1 || String(value).toLowerCase() === 'true';
        return `<label class="detail-form-field detail-extra-field"><span class="filter-label">${label}</span><label class="detail-inline-check"><input type="checkbox" class="detail-extra-input" data-extra-field-key="${utils.escapeHtml(key)}" ${checked ? 'checked' : ''}><span>Enabled</span></label></label>`;
      }
      if (kind === 'textarea') {
        return `<label class="detail-form-field detail-extra-field detail-extra-field-wide"><span class="filter-label">${label}</span><textarea rows="3" class="detail-extra-input" data-extra-field-key="${utils.escapeHtml(key)}">${utils.escapeHtml(value == null ? '' : String(value))}</textarea></label>`;
      }
      return `<label class="detail-form-field detail-extra-field"><span class="filter-label">${label}</span><input type="${kind}" class="detail-extra-input" data-extra-field-key="${utils.escapeHtml(key)}" value="${utils.escapeHtml(value == null ? '' : String(value))}"></label>`;
    }).join('')}</div>`;
  }

  function syncExtraFieldsDraftFromDom() {
    const next = { ...(state.detailExtraFieldDraft || {}) };
    els.detailExtraFieldsEditor?.querySelectorAll('.detail-extra-input').forEach((input) => {
      const key = input.getAttribute('data-extra-field-key') || '';
      if (!key) return;
      if (input.type === 'checkbox') next[key] = Boolean(input.checked);
      else if (input.tagName === 'TEXTAREA') next[key] = utils.normalizeText(input.value) || null;
      else if (input.type === 'number') next[key] = input.value === '' ? null : Number(input.value);
      else next[key] = utils.normalizeText(input.value) || null;
    });
    state.detailExtraFieldDraft = next;
  }

  function extraFieldPayload() {
    syncExtraFieldsDraftFromDom();
    return { ...(state.detailExtraFieldDraft || {}) };
  }

  function contributionAmount(row = {}) {
    return Number(utils.firstNonEmpty(
      row?.contribution_amount,
      row?.total_contributions,
      row?.total_dollars,
      row?.dollars,
      row?.contributed
    ) || 0) || 0;
  }

  function historyGroupKey(row = {}) {
    return utils.normalizeLookupKey([
      row?.fundraiser_label || row?.drive_label || row?.drive_column || '',
      row?.drive_start_date || row?.drive_date || row?.air_date || utils.dateKeyFromDate(row?.aired_at) || '',
      row?.drive_end_date || ''
    ].join('|'));
  }

  function buildDriveFallbackMaps(driveResults = [], exactAirings = []) {
    const driveByGroup = new Map();
    (driveResults || []).forEach((row) => {
      const key = historyGroupKey(row);
      if (!key) return;
      const prior = driveByGroup.get(key) || { amount: 0, rows: [] };
      prior.amount += contributionAmount(row);
      prior.rows.push(row);
      driveByGroup.set(key, prior);
    });
    const airingCountByGroup = new Map();
    (exactAirings || []).forEach((row) => {
      const key = historyGroupKey(row);
      if (!key) return;
      airingCountByGroup.set(key, Number(airingCountByGroup.get(key) || 0) + 1);
    });
    return { driveByGroup, airingCountByGroup };
  }

  function resolvedExactAiringRows(exactAirings = [], driveResults = []) {
    const { driveByGroup, airingCountByGroup } = buildDriveFallbackMaps(driveResults, exactAirings);
    return (exactAirings || []).map((row) => {
      const directAmount = contributionAmount(row);
      const key = historyGroupKey(row);
      const group = key ? driveByGroup.get(key) : null;
      const airingCount = key ? Number(airingCountByGroup.get(key) || 0) : 0;
      const fallbackAmount = group && airingCount === 1 ? Number(group.amount || 0) || 0 : 0;
      const resolvedAmount = directAmount > 0 ? directAmount : fallbackAmount;
      return {
        ...row,
        __resolved_contribution_amount: resolvedAmount,
        __resolved_contribution_source: directAmount > 0 ? 'airing' : (fallbackAmount > 0 ? 'drive_rollup' : 'none')
      };
    });
  }


  function detailBroadcastDayStartHour() {
    const hour = Number(state.performance?.broadcastDayStartHour);
    return Number.isFinite(hour) ? hour : 7;
  }

  function detailBroadcastAnchorDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
    const shifted = new Date(date.getTime());
    if (shifted.getHours() < detailBroadcastDayStartHour()) shifted.setDate(shifted.getDate() - 1);
    return shifted;
  }

  function detailNormalizedDateKey(value) {
    const text = utils.normalizeText(value);
    if (!text) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const parsedInput = utils.parseFlexibleDateInput(text);
    if (parsedInput?.valid && parsedInput?.iso) return parsedInput.iso;
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) return utils.dateKeyFromDate(parsed);
    return '';
  }

  function detailNormalizedTimeValue(value) {
    const text = utils.normalizeText(value);
    if (!text) return '';
    if (/^\d{1,2}:\d{2}:\d{2}$/.test(text)) return text;
    if (/^\d{1,2}:\d{2}$/.test(text)) return `${text}:00`;
    if (/^\d{3,4}$/.test(text)) {
      const padded = text.padStart(4, '0');
      return `${padded.slice(0, 2)}:${padded.slice(2, 4)}:00`;
    }
    return text;
  }

  function detailDateFromParts(dateValue, timeValue = '', fallbackHour = 12) {
    const dateKey = detailNormalizedDateKey(dateValue);
    if (!dateKey) return null;
    const normalizedTime = detailNormalizedTimeValue(timeValue);
    if (normalizedTime) {
      const merged = new Date(`${dateKey}T${normalizedTime}`);
      if (!Number.isNaN(merged.getTime())) return merged;
    }
    const fallback = new Date(`${dateKey}T${String(fallbackHour).padStart(2, '0')}:00:00`);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }

  function detailRecordDate(row = {}) {
    const rawTime = utils.firstNonEmpty(row?.air_time, row?.time_of_day, row?.scheduled_time, row?.slot_time, row?.airtime, row?.broadcast_time);
    const exactLocal = detailDateFromParts(row?.air_date, rawTime, 12);
    if (exactLocal) return exactLocal;

    const rawDateTime = utils.firstNonEmpty(row?.aired_at, row?.air_date, row?.drive_date, row?.drive_start_date, row?.date_key);
    if (!utils.isBlank(rawDateTime)) {
      const text = String(rawDateTime).trim();
      const parsed = new Date(text);
      if (!Number.isNaN(parsed.getTime())) return parsed;
      const localFallback = detailDateFromParts(text, rawTime, 12);
      if (localFallback) return localFallback;
    }

    const driveDate = detailDateFromParts(utils.firstNonEmpty(row?.drive_date, row?.drive_start_date, row?.date_key), '', 12);
    if (driveDate) return driveDate;
    return null;
  }


  function detailRecordHasExplicitTime(row = {}) {
    const rawTime = utils.firstNonEmpty(row?.air_time, row?.time_of_day, row?.scheduled_time, row?.slot_time, row?.airtime, row?.broadcast_time);
    if (!utils.isBlank(rawTime)) return true;
    const rawDateTime = utils.firstNonEmpty(row?.aired_at, row?.air_date, row?.drive_date, row?.drive_start_date, row?.date_key);
    if (!utils.isBlank(rawDateTime)) {
      const text = String(rawDateTime).trim();
      if (/\d{1,2}:\d{2}/.test(text) || /T\d{2}:\d{2}/i.test(text)) return true;
    }
    return false;
  }

  function detailDisplayDate(row = {}, fallback = 'N/A') {
    const when = detailRecordDate(row);
    if (!(when instanceof Date) || Number.isNaN(when.getTime())) return fallback;
    return detailDateLabel(when);
  }

  function detailDisplayDateTime(row = {}, fallback = 'N/A') {
    const when = detailRecordDate(row);
    if (!(when instanceof Date) || Number.isNaN(when.getTime())) return fallback;
    return detailRecordHasExplicitTime(row) ? `${detailDateLabel(when)} · ${detailTimeLabel(when)}` : detailDateLabel(when);
  }

  function detailDateLabel(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 'Unknown date';
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function detailDayLabel(date) {
    const anchor = detailBroadcastAnchorDate(date) || date;
    if (!(anchor instanceof Date) || Number.isNaN(anchor.getTime())) return 'Unknown day';
    return anchor.toLocaleDateString(undefined, { weekday: 'long' });
  }

  function detailTimeLabel(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 'Unknown time';
    const minutes = (date.getHours() * 60) + date.getMinutes();
    return utils.minutesToLabel(minutes);
  }

  function detailHourLabel(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 'Unknown hour';
    return utils.minutesToLabel(date.getHours() * 60);
  }

  function detailSlotLabel(date) {
    const day = detailDayLabel(date);
    const hour = detailHourLabel(date);
    if (day === 'Unknown day' || hour === 'Unknown hour') return '';
    return `${day} · ${hour}`;
  }

  function detailPledges(row = {}) {
    return Number(utils.firstNonEmpty(row?.pledge_count, row?.pledges, row?.total_pledges, row?.pledge_total) || 0) || 0;
  }

  function detailMetricCell(label = '') {
    return { label, airingCount: 0, totalDollars: 0, totalPledges: 0, totalMinutes: 0, avgDollars: 0 };
  }

  function aggregateDetailMetricCell(cell, record) {
    cell.airingCount += 1;
    cell.totalDollars += Number(record?.amount || 0) || 0;
    cell.totalPledges += Number(record?.pledges || 0) || 0;
    cell.totalMinutes += Number(record?.minutes || 0) || 0;
  }

  function finalizeDetailMetricCell(cell) {
    return {
      ...cell,
      avgDollars: cell.airingCount ? (cell.totalDollars / cell.airingCount) : 0,
      avgPledges: cell.airingCount ? (cell.totalPledges / cell.airingCount) : 0,
      dollarsPerMinute: cell.totalMinutes > 0 ? (cell.totalDollars / cell.totalMinutes) : 0
    };
  }

  function strengthBand(value, orderedValues = []) {
    const values = (orderedValues || []).filter((entry) => Number.isFinite(entry)).sort((a, b) => a - b);
    if (!values.length || !Number.isFinite(value)) return 'unknown';
    const lowIndex = Math.max(0, Math.floor((values.length - 1) * 0.33));
    const highIndex = Math.max(0, Math.floor((values.length - 1) * 0.66));
    const lowCut = values[lowIndex];
    const highCut = values[highIndex];
    if (value >= highCut) return 'strong';
    if (value <= lowCut) return 'weak';
    return 'okay';
  }

  function overallSlotNote(slotCell, cache) {
    if (!slotCell || !cache) return 'Overall slot expectation unavailable';
    const band = strengthBand(slotCell.avgDollars, cache.overallValues || []);
    if (band === 'strong') return 'Strong overall slot';
    if (band === 'weak') return 'Weak overall slot';
    return 'Okay overall slot';
  }

  function topicSlotNote(topic, slotCell, cache) {
    const topicText = utils.normalizeText(topic);
    const topicKey = utils.normalizeLookupKey(topicText);
    if (!topicKey || !slotCell || !cache) return 'Topic fit unavailable';
    const values = cache.topicValueMap?.get(topicKey) || [];
    const band = strengthBand(slotCell.avgDollars, values);
    if (band === 'strong') return `Good for ${topicText}`;
    if (band === 'weak') return `Weak for ${topicText}`;
    return `Okay for ${topicText}`;
  }

  function titleRelativeNote(amount, averageAmount) {
    if (!Number.isFinite(amount) || !Number.isFinite(averageAmount) || averageAmount <= 0) return 'Title baseline thin';
    const ratio = amount / averageAmount;
    if (ratio >= 1.15) return "Above this title's norm";
    if (ratio <= 0.85) return "Below this title's norm";
    return 'About typical for this title';
  }

  function buildDetailBenchmarkCache(records = []) {
    const overallSlotMap = new Map();
    const topicSlotMap = new Map();
    const topicValueMap = new Map();
    (Array.isArray(records) ? records : []).forEach((record) => {
      if (!record || record.isNonSpecific) return;
      if (!record.moneyTrusted || record.excludedForIntegrity) return;
      if (!record.hasDate || !record.hasExplicitTime || record.estimatedOnly) return;
      if (!state.performance?.includeExpiredPrograms && record.libraryProgramKnown && (!record.libraryProgramActive || record.libraryRightsExpired)) return;
      const slotLabel = `${record.day || detailDayLabel(record.broadcastWhen || record.when)} · ${detailHourLabel(record.when)}`;
      if (!slotLabel || slotLabel.includes('Unknown')) return;
      if (!overallSlotMap.has(slotLabel)) overallSlotMap.set(slotLabel, detailMetricCell(slotLabel));
      aggregateDetailMetricCell(overallSlotMap.get(slotLabel), { amount: record.amount, pledges: record.pledges, minutes: record.minutes });
      const topic = utils.normalizeText(record.topicDisplay || record.topic || '');
      const topicKey = utils.normalizeLookupKey(topic);
      if (!topicKey) return;
      const combinedKey = `${topicKey}|${slotLabel}`;
      if (!topicSlotMap.has(combinedKey)) topicSlotMap.set(combinedKey, detailMetricCell(combinedKey));
      aggregateDetailMetricCell(topicSlotMap.get(combinedKey), { amount: record.amount, pledges: record.pledges, minutes: record.minutes });
    });
    const finalizedOverall = new Map();
    const overallValues = [];
    overallSlotMap.forEach((cell, key) => {
      const finalCell = finalizeDetailMetricCell(cell);
      finalizedOverall.set(key, finalCell);
      overallValues.push(finalCell.avgDollars);
    });
    const finalizedTopic = new Map();
    topicSlotMap.forEach((cell, key) => finalizedTopic.set(key, finalizeDetailMetricCell(cell)));
    finalizedTopic.forEach((cell, key) => {
      const [topicKey] = key.split('|');
      if (!topicValueMap.has(topicKey)) topicValueMap.set(topicKey, []);
      topicValueMap.get(topicKey).push(cell.avgDollars);
    });
    return {
      overallSlotMap: finalizedOverall,
      topicSlotMap: finalizedTopic,
      overallValues,
      topicValueMap
    };
  }

  function getDetailBenchmarkCache() {
    if (state.detailBenchmarkCache && state.detailBenchmarkCache.sourceKey === state.performance?.lastLoadedAt) return state.detailBenchmarkCache;
    if (!state.performance?.ready || !Array.isArray(state.performance.records) || !state.performance.records.length) return null;
    state.detailBenchmarkCache = {
      sourceKey: state.performance.lastLoadedAt,
      ...buildDetailBenchmarkCache(state.performance.records)
    };
    return state.detailBenchmarkCache;
  }

  function maybeRefreshDetailBenchmarks() {
    if (state.performance?.ready || state.performance?.loading || state.detailBenchmarkPromise || !App.performanceUi?.refreshData) return;
    const activeProgramId = state.selectedProgramId;
    const activeToken = state.detailLoadToken;
    state.detailBenchmarkPromise = App.performanceUi.refreshData({ silent: true })
      .then(() => {
        if (state.selectedProgramId !== activeProgramId || state.detailLoadToken !== activeToken || !state.currentDetailProgram) return;
        renderPerformanceGraph(state.currentDetailProgram, state.currentDetailDriveResults || [], state.currentDetailAirings || []);
      })
      .catch(() => {})
      .finally(() => {
        state.detailBenchmarkPromise = null;
      });
  }

  function buildAiringInsightRows(program, driveResults = [], exactAirings = []) {
    const cache = getDetailBenchmarkCache();
    const topic = derive.topicPrimary(program);
    const topicKey = utils.normalizeLookupKey(topic);
    const resolvedAirings = resolvedExactAiringRows(exactAirings, driveResults)
      .map((row) => ({ ...row, __detail_when: detailRecordDate(row) }))
      .sort((a, b) => {
        const aTime = a.__detail_when instanceof Date && !Number.isNaN(a.__detail_when.getTime()) ? a.__detail_when.getTime() : Number.POSITIVE_INFINITY;
        const bTime = b.__detail_when instanceof Date && !Number.isNaN(b.__detail_when.getTime()) ? b.__detail_when.getTime() : Number.POSITIVE_INFINITY;
        return aTime - bTime;
      });
    return resolvedAirings.map((row) => {
      const when = row.__detail_when;
      const amount = Number(utils.firstNonEmpty(row?.__resolved_contribution_amount, contributionAmount(row)) || 0) || 0;
      const pledges = detailPledges(row);
      const slotLabel = detailSlotLabel(when);
      const overallSlot = slotLabel && cache ? cache.overallSlotMap.get(slotLabel) : null;
      const topicSlot = slotLabel && cache && topicKey ? cache.topicSlotMap.get(`${topicKey}|${slotLabel}`) : null;
      const expectedTopicAmount = Number.isFinite(Number(topicSlot?.avgDollars)) ? Number(topicSlot.avgDollars) : null;
      const vsTopicNote = !Number.isFinite(expectedTopicAmount) || expectedTopicAmount <= 0
        ? 'Topic thin'
        : amount >= (expectedTopicAmount * 1.15)
          ? 'Above topic'
          : amount <= (expectedTopicAmount * 0.85)
            ? 'Below topic'
            : 'On topic';
      const noteBits = [
        overallSlotNote(overallSlot, cache),
        topicSlotNote(topic, topicSlot, cache),
        vsTopicNote
      ].filter(Boolean);
      return {
        row,
        when,
        dateLabel: detailDateLabel(when),
        dayLabel: detailDayLabel(when),
        timeLabel: detailRecordHasExplicitTime(row) ? detailTimeLabel(when) : 'Unknown time',
        amount,
        pledges,
        overallNote: overallSlotNote(overallSlot, cache),
        topicNote: topicSlotNote(topic, topicSlot, cache),
        expectedTopicAmount,
        vsTopicNote,
        combinedNote: noteBits.join(' · ')
      };
    });
  }



  function detailFundraiserAxisLabel(dateKey = '', label = '') {
    const when = detailDateFromParts(dateKey, '', 12);
    if (when instanceof Date && !Number.isNaN(when.getTime())) {
      return when.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
    }
    const text = utils.normalizeText(label);
    if (!text) return 'Fundraiser';
    return text.length > 16 ? `${text.slice(0, 16)}…` : text;
  }

  function detailFundraiserHoverLabel(startKey = '', endKey = '', label = '') {
    const bits = [];
    const text = utils.normalizeText(label);
    if (text) bits.push(text);
    const startText = startKey ? utils.formatDate(startKey, startKey) : '';
    const endText = endKey ? utils.formatDate(endKey, endKey) : '';
    if (startText && endText && startText !== endText) bits.push(`${startText} → ${endText}`);
    else if (startText || endText) bits.push(startText || endText);
    return bits.join(' · ') || 'Fundraiser';
  }

  function detailFundraiserDescriptor(row = {}) {
    const startKey = detailNormalizedDateKey(utils.firstNonEmpty(row?.drive_start_date, row?.drive_date, row?.air_date, row?.aired_at, row?.date_key));
    const endKey = detailNormalizedDateKey(utils.firstNonEmpty(row?.drive_end_date, row?.drive_start_date, row?.drive_date, row?.air_date, row?.aired_at, row?.date_key));
    const label = utils.normalizeText(utils.firstNonEmpty(row?.fundraiser_label, row?.drive_label, row?.drive_column, '')) || '';
    const keyBase = startKey || detailNormalizedDateKey(utils.firstNonEmpty(row?.air_date, row?.aired_at, row?.drive_date, row?.date_key));
    if (!keyBase && !label) return null;
    const key = [keyBase || '', endKey || '', utils.normalizeLookupKey(label)].join('|');
    return {
      key,
      startKey: keyBase || '',
      endKey: endKey || '',
      label,
      axisLabel: detailFundraiserAxisLabel(keyBase || endKey || '', label),
      hoverLabel: detailFundraiserHoverLabel(keyBase || '', endKey || '', label)
    };
  }

  function detailFundraiserSourceRows() {
    if (Array.isArray(state.imports?.airingsRows) && state.imports.airingsRows.length) return state.imports.airingsRows;
    if (state.performance?.ready && Array.isArray(state.performance.records) && state.performance.records.length) {
      return state.performance.records.flatMap((record) => Array.isArray(record?.sampleSourceRows) ? record.sampleSourceRows : []);
    }
    return [];
  }

  function buildDetailFundraiserTimelineFromRows(rows = []) {
    const grouped = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const descriptor = detailFundraiserDescriptor(row);
      if (!descriptor?.key) return;
      const prior = grouped.get(descriptor.key) || { ...descriptor, count: 0 };
      prior.count += 1;
      if (!prior.startKey || (descriptor.startKey && descriptor.startKey < prior.startKey)) prior.startKey = descriptor.startKey;
      if (!prior.endKey || (descriptor.endKey && descriptor.endKey > prior.endKey)) prior.endKey = descriptor.endKey;
      if (!prior.label && descriptor.label) prior.label = descriptor.label;
      prior.axisLabel = detailFundraiserAxisLabel(prior.startKey || prior.endKey || '', prior.label);
      prior.hoverLabel = detailFundraiserHoverLabel(prior.startKey || '', prior.endKey || '', prior.label || '');
      grouped.set(descriptor.key, prior);
    });
    return [...grouped.values()].sort((a, b) => {
      const sortA = String(a.startKey || a.endKey || a.label || '');
      const sortB = String(b.startKey || b.endKey || b.label || '');
      return sortA.localeCompare(sortB) || utils.compareText(a.label || '', b.label || '');
    });
  }

  function getDetailFundraiserTimeline() {
    const sourceRows = detailFundraiserSourceRows();
    if (!sourceRows.length) return null;
    const sourceKey = Array.isArray(state.imports?.airingsRows) && state.imports.airingsRows.length
      ? `imports:${state.imports.airingsRows.length}`
      : `performance:${state.performance?.lastLoadedAt || ''}:${sourceRows.length}`;
    if (state.detailFundraiserTimelineCache && state.detailFundraiserTimelineCache.sourceKey === sourceKey) {
      return state.detailFundraiserTimelineCache;
    }
    const rows = buildDetailFundraiserTimelineFromRows(sourceRows);
    const byKey = new Map(rows.map((entry, index) => [entry.key, { ...entry, index }]));
    state.detailFundraiserTimelineCache = { sourceKey, rows, byKey };
    return state.detailFundraiserTimelineCache;
  }

  function buildGraphFundraiserAxis(series = []) {
    const timeline = getDetailFundraiserTimeline();
    if (!timeline?.rows?.length || !timeline?.byKey || !Array.isArray(series) || !series.length) return null;
    const matchedIndices = series
      .map((entry) => timeline.byKey.get(entry?.fundraiser?.key)?.index)
      .filter((value) => Number.isInteger(value));
    if (!matchedIndices.length) return null;
    const start = Math.min(...matchedIndices);
    const end = Math.max(...matchedIndices);
    const slots = timeline.rows.slice(start, end + 1);
    const slotByKey = new Map(slots.map((slot, index) => [slot.key, { ...slot, localIndex: index }]));
    return { slots, slotByKey };
  }

  function buildGraphSeries(driveResults = [], exactAirings = []) {
    if (exactAirings.length) {
      return resolvedExactAiringRows(exactAirings, driveResults)
        .map((row, index) => {
          const when = detailRecordDate(row);
          const amount = Number(utils.firstNonEmpty(row?.__resolved_contribution_amount, contributionAmount(row)) || 0) || 0;
          const baseLabel = when instanceof Date && !Number.isNaN(when.getTime())
            ? `${detailDateLabel(when)} · ${detailTimeLabel(when)}`
            : (utils.normalizeText(utils.firstNonEmpty(row?.fundraiser_label, row?.drive_label, row?.notes)) || `Airing ${index + 1}`);
          return {
            label: baseLabel,
            dateKey: when instanceof Date && !Number.isNaN(when.getTime()) ? utils.dateKeyFromDate(when) : `${index + 1}`,
            sortKey: when instanceof Date && !Number.isNaN(when.getTime()) ? when.getTime() : index,
            amount,
            when,
            dayLabel: detailDayLabel(when),
            timeLabel: detailRecordHasExplicitTime(row) ? detailTimeLabel(when) : 'Unknown time',
            pledges: detailPledges(row),
            fundraiser: detailFundraiserDescriptor(row),
            row
          };
        })
        .sort((a, b) => a.sortKey - b.sortKey);
    }
    const sourceRows = driveResults || [];
    const grouped = new Map();
    sourceRows.forEach((row) => {
      const iso = utils.firstNonEmpty(row?.drive_date, row?.drive_start_date, row?.aired_at, row?.date_key);
      const dateKey = detailNormalizedDateKey(iso) || utils.dateKeyFromDate(iso) || utils.normalizeText(iso);
      const label = utils.normalizeText(utils.firstNonEmpty(row?.fundraiser_label, row?.drive_label, row?.drive_column)) || (dateKey || 'Unknown');
      const amount = Number(contributionAmount(row) || 0) || 0;
      if (!dateKey && !label) return;
      const key = `${dateKey || label}|${label}`;
      const prior = grouped.get(key) || {
        label,
        dateKey: dateKey || label,
        sortKey: dateKey || label,
        amount: 0,
        fundraiser: detailFundraiserDescriptor(row),
        row
      };
      prior.amount += amount;
      grouped.set(key, prior);
    });
    return [...grouped.values()].sort((a, b) => String(a.sortKey).localeCompare(String(b.sortKey)));
  }


  function renderPerformanceGraph(program, driveResults = [], exactAirings = []) {
    if (!els.detailPerformanceGraph || !els.detailGraphPill) return;
    maybeRefreshDetailBenchmarks();
    const series = buildGraphSeries(driveResults, exactAirings);
    const insightRows = buildAiringInsightRows(program, driveResults, exactAirings);
    if (!series.length) {
      els.detailGraphPill.textContent = 'Needs history';
      els.detailPerformanceGraph.innerHTML = '<div class="detail-graph-empty">This section fills in once the title has readable airing or fundraiser history.</div>';
      return;
    }
    els.detailGraphPill.textContent = `${series.length} point${series.length === 1 ? '' : 's'}`;
    const width = 760;
    const height = 252;
    const margin = { top: 18, right: 22, bottom: 64, left: 58 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;
    const expectedValues = insightRows
      .map((entry) => Number(entry?.expectedTopicAmount))
      .filter((value) => Number.isFinite(value) && value >= 0);
    const maxAmount = Math.max(
      ...series.map((entry) => Number(entry.amount || 0) || 0),
      ...expectedValues,
      1
    );
    const topicName = utils.normalizeText(derive.topicPrimary(program) || 'topic');
    const axis = buildGraphFundraiserAxis(series);
    const axisSlots = axis?.slots?.length
      ? axis.slots
      : series.map((entry, index) => ({
        key: entry?.fundraiser?.key || `airing-${index}`,
        axisLabel: entry?.fundraiser?.axisLabel || (entry.when instanceof Date && !Number.isNaN(entry.when.getTime()) ? detailDateLabel(entry.when) : `Airing ${index + 1}`),
        hoverLabel: entry?.fundraiser?.hoverLabel || entry.label || `Airing ${index + 1}`
      }));
    const xStep = axisSlots.length > 1 ? innerW / (axisSlots.length - 1) : 0;
    const seriesWithSlots = series.map((entry, index) => {
      const mappedIndex = axis?.slotByKey?.get(entry?.fundraiser?.key)?.localIndex;
      const slotIndex = Number.isInteger(mappedIndex) ? mappedIndex : Math.min(index, Math.max(axisSlots.length - 1, 0));
      return { ...entry, slotIndex, slotKey: axisSlots[slotIndex]?.key || `slot-${slotIndex}` };
    });
    const slotCounts = new Map();
    seriesWithSlots.forEach((entry) => slotCounts.set(entry.slotIndex, Number(slotCounts.get(entry.slotIndex) || 0) + 1));
    const slotSeen = new Map();
    const slotOffsetStep = axisSlots.length > 1 ? Math.min(16, Math.max(6, xStep * 0.22)) : 0;
    const points = seriesWithSlots.map((entry, index) => {
      const expectedTopicAmount = Number(insightRows[index]?.expectedTopicAmount);
      const centerX = axisSlots.length > 1 ? margin.left + (xStep * entry.slotIndex) : margin.left + (innerW / 2);
      const countInSlot = Number(slotCounts.get(entry.slotIndex) || 1);
      const slotOrder = Number(slotSeen.get(entry.slotIndex) || 0);
      slotSeen.set(entry.slotIndex, slotOrder + 1);
      const offset = countInSlot > 1 ? (slotOrder - ((countInSlot - 1) / 2)) * slotOffsetStep : 0;
      const x = centerX + offset;
      const y = margin.top + innerH - ((Number(entry.amount || 0) || 0) / maxAmount * innerH);
      const expectedY = Number.isFinite(expectedTopicAmount) && expectedTopicAmount >= 0
        ? margin.top + innerH - (expectedTopicAmount / maxAmount * innerH)
        : null;
      return {
        ...entry,
        insight: insightRows[index] || null,
        expectedTopicAmount: Number.isFinite(expectedTopicAmount) ? expectedTopicAmount : null,
        x,
        y,
        expectedY,
        centerX,
        slotCount: countInSlot
      };
    });
    const polyline = points.map((pt) => `${pt.x},${pt.y}`).join(' ');
    const expectedPolyline = points
      .filter((pt) => Number.isFinite(pt.expectedY))
      .map((pt) => `${pt.x},${pt.expectedY}`)
      .join(' ');
    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => {
      const y = margin.top + innerH - (innerH * fraction);
      const value = maxAmount * fraction;
      return `<g><line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" class="detail-graph-grid"></line><text x="${margin.left - 8}" y="${y + 4}" text-anchor="end" class="detail-graph-axis">${utils.escapeHtml(utils.formatMoney(value))}</text></g>`;
    }).join('');
    const airedSlotIndices = new Set(points.map((pt) => pt.slotIndex));
    const baselineY = margin.top + innerH;
    const axisTicks = axisSlots.map((slot, index) => {
      const x = axisSlots.length > 1 ? margin.left + (xStep * index) : margin.left + (innerW / 2);
      const tickClass = airedSlotIndices.has(index) ? 'detail-graph-axis-tick detail-graph-axis-tick-aired' : 'detail-graph-axis-tick';
      return `<g><line x1="${x}" y1="${baselineY}" x2="${x}" y2="${baselineY + 7}" class="${tickClass}"></line><title>${utils.escapeHtml(slot.hoverLabel || slot.axisLabel || 'Fundraiser')}</title></g>`;
    }).join('');
    const labelEvery = Math.max(1, Math.ceil(axisSlots.length / 6));
    const xLabels = axisSlots.map((slot, index) => {
      const shouldShow = index === 0 || index === axisSlots.length - 1 || airedSlotIndices.has(index) || index % labelEvery === 0;
      if (!shouldShow) return '';
      const x = axisSlots.length > 1 ? margin.left + (xStep * index) : margin.left + (innerW / 2);
      const anchor = index === 0 ? 'start' : index === axisSlots.length - 1 ? 'end' : 'middle';
      const xShift = index === 0 ? 4 : index === axisSlots.length - 1 ? -4 : 0;
      return `<text x="${x + xShift}" y="${height - 16}" text-anchor="${anchor}" class="detail-graph-axis">${utils.escapeHtml(slot.axisLabel || 'Fundraiser')}</text>`;
    }).join('');
    const expectedDots = points.map((pt) => {
      if (!Number.isFinite(pt.expectedY)) return '';
      const tooltip = [
        pt.fundraiser?.hoverLabel || '',
        pt.when instanceof Date && !Number.isNaN(pt.when.getTime()) ? `${detailDateLabel(pt.when)} · ${detailDayLabel(pt.when)} · ${pt.row && detailRecordHasExplicitTime(pt.row) ? detailTimeLabel(pt.when) : 'Unknown time'}` : pt.label,
        `Expected for ${topicName}: ${utils.formatMoney(pt.expectedTopicAmount)}`,
        pt.insight?.topicNote || ''
      ].filter(Boolean).join('\n');
      return `<g><circle cx="${pt.x}" cy="${pt.expectedY}" r="3.5" class="detail-graph-expected-dot"></circle><title>${utils.escapeHtml(tooltip)}</title></g>`;
    }).join('');
    const dots = points.map((pt) => {
      const tooltip = [
        pt.fundraiser?.hoverLabel || '',
        pt.when instanceof Date && !Number.isNaN(pt.when.getTime()) ? `${detailDateLabel(pt.when)} · ${detailDayLabel(pt.when)} · ${pt.row && detailRecordHasExplicitTime(pt.row) ? detailTimeLabel(pt.when) : 'Unknown time'}` : pt.label,
        `${utils.formatMoney(pt.amount)}${Number.isFinite(pt.pledges) && pt.pledges > 0 ? ` · ${utils.formatCount(pt.pledges)} pledges` : ''}`,
        pt.expectedTopicAmount != null ? `Expected for ${topicName}: ${utils.formatMoney(pt.expectedTopicAmount)}` : 'Topic expectation thin',
        pt.insight?.combinedNote || ''
      ].filter(Boolean).join('\n');
      return `<g><circle cx="${pt.x}" cy="${pt.y}" r="4" class="detail-graph-dot"></circle><title>${utils.escapeHtml(tooltip)}</title></g>`;
    }).join('');
    const pointLabels = points.map((pt, index) => {
      const fullDay = utils.escapeHtml(pt.dayLabel || 'Unknown day');
      const timeText = utils.escapeHtml(pt.timeLabel || 'Unknown time');
      const slotLine = `${timeText}`;
      const noteLine = fullDay;
      const anchor = index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle';
      const labelX = index === 0 ? pt.x + 8 : index === points.length - 1 ? pt.x - 8 : pt.x;
      const labelAbove = (index % 2 === 0 && pt.y > (margin.top + 30)) || pt.y > (margin.top + innerH * 0.72);
      const baseY = labelAbove ? pt.y - 12 : pt.y + 18;
      const connectorY = labelAbove ? pt.y - 4 : pt.y + 4;
      return `<g>
        <line x1="${pt.x}" y1="${connectorY}" x2="${labelX}" y2="${labelAbove ? baseY - 3 : baseY - 11}" class="detail-graph-label-line"></line>
        <text x="${labelX}" y="${baseY}" text-anchor="${anchor}" class="detail-graph-point-label">
          <tspan x="${labelX}" dy="0">${slotLine}</tspan>
          <tspan x="${labelX}" dy="11" class="detail-graph-point-note">${noteLine}</tspan>
        </text>
      </g>`;
    }).join('');
    const latest = points[points.length - 1];
    const latestWhen = latest.when instanceof Date && !Number.isNaN(latest.when.getTime()) ? `${detailDateLabel(latest.when)} · ${latest.row && detailRecordHasExplicitTime(latest.row) ? detailTimeLabel(latest.when) : 'Unknown time'}` : utils.formatDate(latest.dateKey, latest.dateKey);
    const latestExpectedText = latest.expectedTopicAmount != null ? ` vs topic-expected ${utils.formatMoney(latest.expectedTopicAmount)}` : '';
    const fundraiserSpanNote = axisSlots.length > points.length ? ` Timeline ticks show ${utils.formatCount(axisSlots.length)} fundraisers between the first and last airing.` : '';
    const summary = `${utils.escapeHtml(derive.title(program) || 'Program')} · blue = actual dollars, orange = expected results by topic for that day/time slot. Latest: ${utils.escapeHtml(utils.formatMoney(latest.amount))}${utils.escapeHtml(latestExpectedText)} on ${utils.escapeHtml(latestWhen)}.${utils.escapeHtml(fundraiserSpanNote)}`;
    const legend = `
      <div class="detail-graph-legend" aria-hidden="true">
        <span><span class="detail-graph-swatch detail-graph-swatch-actual"></span>Actual</span>
        <span><span class="detail-graph-swatch detail-graph-swatch-expected"></span>Expected results by topic</span>
      </div>`;
    els.detailPerformanceGraph.innerHTML = `
      <div class="detail-graph-summary">${summary}</div>
      ${legend}
      <svg viewBox="0 0 ${width} ${height}" class="detail-graph-svg" role="img" aria-label="Income over time chart with actual dollars, topic-expected dollars, and fundraiser timeline ticks between the first and last airing">
        ${yTicks}
        <line x1="${margin.left}" y1="${baselineY}" x2="${width - margin.right}" y2="${baselineY}" class="detail-graph-axis-line"></line>
        ${axisTicks}
        ${expectedPolyline ? `<polyline fill="none" points="${expectedPolyline}" class="detail-graph-expected-line"></polyline>` : ''}
        ${points.length > 1 ? `<polyline fill="none" points="${polyline}" class="detail-graph-line"></polyline>` : ''}
        ${expectedDots}
        ${dots}
        ${pointLabels}
        ${xLabels}
      </svg>`;
  }
  function labelValue(label, value, extraClass = '') {
    return `
      <div class="${utils.escapeHtml(extraClass)}">
        <dt>${utils.escapeHtml(label)}</dt>
        <dd>${value}</dd>
      </div>
    `;
  }

  function detailSubtitleHtml(_program) {
    return state.detailCreateMode
      ? 'Create a new pledge title. NOLA is the key field for report matching.'
      : 'Everything we know about this program.';
  }

  function renderLead(program) {
    const topicValue = [derive.topicPrimary(program), derive.topicSecondary(program)].filter(Boolean).join(' / ') || '—';
    const rightsWindow = [utils.formatDate(derive.rightsBegin(program), '—'), utils.formatDate(derive.rightsEnd(program), '—')].join(' → ');
    const description = derive.description(program) || 'No description or program notes are available.';

    els.detailProgramMeta.innerHTML = [
      `<div class="detail-lead-chip"><span class="detail-lead-label">NOLA</span><strong>${utils.escapeHtml(derive.nola(program) || '—')}</strong></div>`,
      `<div class="detail-lead-chip"><span class="detail-lead-label">Topic</span><strong>${utils.escapeHtml(topicValue)}</strong></div>`,
      `<div class="detail-lead-chip"><span class="detail-lead-label">Distributor</span><strong>${utils.escapeHtml(derive.distributor(program) || '—')}</strong></div>`,
      `<div class="detail-lead-chip"><span class="detail-lead-label">Rights window</span><strong>${utils.escapeHtml(rightsWindow)}</strong></div>`
    ].join('');
    els.detailProgramDescription.innerHTML = `<div class="detail-long-text">${utils.escapeHtml(description)}</div>`;
  }

  function premiumSummaryHtml(value) {
    const text = utils.normalizeText(value);
    if (!text) return '<div class="premium-line">—</div>';
    const lines = text
      .replace(/\r/g, '')
      .replace(/\s*;\s*/g, '\n')
      .replace(/\s+(?=\$)/g, '\n')
      .split(/\n+/)
      .map((part) => utils.normalizeText(part))
      .filter(Boolean);
    const finalLines = lines.length ? lines : [text];
    return finalLines.map((line) => `<div class="premium-line">${utils.escapeHtml(line)}</div>`).join('');
  }

  function renderOverview(program, driveResults = [], exactAirings = []) {
    const topicValue = [derive.topicPrimary(program), derive.topicSecondary(program)].filter(Boolean).join(' / ') || '—';
    const lastAired = exactAirings.length
      ? detailDisplayDateTime(exactAirings[0], 'N/A')
      : driveResults.length
        ? detailDisplayDateTime(driveResults[0], 'N/A')
        : derive.lastAiredDisplay(program);

    els.overviewGrid.innerHTML = [
      labelValue('Actual runtime', utils.escapeHtml(derive.actualRuntimeLabel(program)), 'overview-spotlight'),
      labelValue('Length bucket', utils.escapeHtml(derive.lengthLabel(program)), 'overview-spotlight'),
      labelValue('Topic', utils.escapeHtml(topicValue), 'overview-spotlight'),
      labelValue('Distributor', utils.escapeHtml(derive.distributor(program) || '—'), 'overview-spotlight'),
      labelValue('Rights begin', utils.escapeHtml(utils.formatDate(derive.rightsBegin(program)))),
      labelValue('Rights end', utils.escapeHtml(utils.formatDate(derive.rightsEnd(program)))),
      labelValue('Last aired', utils.escapeHtml(lastAired || 'N/A')),
      labelValue('Status', utils.escapeHtml(utils.normalizeText(utils.firstNonEmpty(program.status, program.library_state, derive.isActive(program) ? 'Active' : 'Archived')) || '—')),
      labelValue('Total contributions', utils.escapeHtml(utils.formatMoney(derive.totalRaised(program)))),
      labelValue('Average per fundraiser', utils.escapeHtml(utils.formatMoney(derive.avgPerFundraiser(program)))),
      labelValue('Package type', utils.escapeHtml(utils.normalizeText(program.package_type) || '—')),
      labelValue('Source format', utils.escapeHtml(utils.normalizeText(program.source_format) || '—')),
      labelValue('Rights notes', utils.escapeHtml(utils.normalizeText(program.rights_notes) || '—'), 'overview-wide'),
      labelValue('Premium summary', premiumSummaryHtml(derive.premiumSummary(program) || '—'), 'overview-wide')
    ].join('');
  }

  function isTimingSecondsKey(key = '') {
    return /(seconds|offset|duration|runtime|cutin|break|act)_?seconds$/i.test(key || '');
  }

  function formatTimingSecondsMmSs(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return '—';
    const rounded = Math.round(numeric);
    const minutes = Math.floor(rounded / 60);
    const seconds = rounded % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  function formatTimingInputValue(key, value) {
    if (value == null || value === '') return '';
    if (isTimingSecondsKey(key)) return formatTimingSecondsMmSs(value);
    return String(value);
  }

  function parseTimingInputValue(key, raw) {
    const text = utils.normalizeText(raw);
    if (!text) return null;
    if (isTimingSecondsKey(key)) {
      if (/^\d+$/.test(text)) return Number(text);
      return utils.parseRuntimeInput(text);
    }
    if (/(number|slot|segment)/i.test(key)) {
      const numeric = Number(text);
      return Number.isFinite(numeric) ? numeric : null;
    }
    return text;
  }

  function formatMaybeSeconds(key, value) {
    if (value == null || value === '') return '—';
    const numeric = Number(value);
    if (Number.isFinite(numeric) && isTimingSecondsKey(key)) {
      return utils.escapeHtml(formatTimingSecondsMmSs(numeric));
    }
    if (typeof value === 'object') return utils.escapeHtml(JSON.stringify(value));
    return utils.escapeHtml(utils.normalizeText(value) || String(value));
  }

  function candidateColumns(rows) {
    const preferred = [
      'segment_number', 'slot_number', 'act_offset_seconds', 'act_seconds', 'break_offset_seconds', 'break_seconds', 'local_cutin_seconds',
      'segment_title', 'segment_name', 'notes', 'title', 'nola_code', 'program_title'
    ];
    const seen = new Set();
    const keys = [];
    preferred.forEach((key) => {
      if (rows.some((row) => Object.prototype.hasOwnProperty.call(row || {}, key))) {
        seen.add(key);
        keys.push(key);
      }
    });
    rows.forEach((row) => {
      Object.keys(row || {}).forEach((key) => {
        if (!seen.has(key) && !/^created_at|updated_at$/i.test(key)) {
          seen.add(key);
          keys.push(key);
        }
      });
    });
    return keys;
  }


  function timingEditorColumns(rows = []) {
    const cols = candidateColumns(rows).filter((key) => !/^(id|program_id|source_row_number)$/i.test(key));
    return cols.length ? cols : ['segment_number', 'act_offset_seconds', 'act_seconds', 'break_offset_seconds', 'break_seconds', 'local_cutin_seconds', 'notes'];
  }

  function cloneTimingRows(rows = []) {
    return (rows || []).map((row) => JSON.parse(JSON.stringify(row || {})));
  }

  function blankTimingRow() {
    return {
      segment_number: null,
      act_offset_seconds: null,
      act_seconds: null,
      break_offset_seconds: null,
      break_seconds: null,
      local_cutin_seconds: null,
      notes: ''
    };
  }

  function inputTypeForTimingKey(key = '') {
    if (isTimingSecondsKey(key)) return 'text';
    return /(number|slot|segment)/i.test(key) ? 'number' : 'text';
  }

  function renderTimingEditor(rows = []) {
    if (!els.detailTimingEditor) return;
    const draftRows = cloneTimingRows(rows);
    state.detailTimingDraftRows = draftRows;
    const columns = timingEditorColumns(draftRows);
    els.detailTimingEditor.innerHTML = `
      <div class="segment-table-wrap">
        <table class="segment-table detail-timing-table">
          <thead>
            <tr>
              ${columns.map((key) => `<th>${utils.escapeHtml(displayKeyLabel(key))}</th>`).join('')}
              <th>Remove</th>
            </tr>
          </thead>
          <tbody>
            ${draftRows.length ? draftRows.map((row, rowIndex) => `
              <tr data-timing-row-index="${rowIndex}">
                ${columns.map((key) => `<td><input type="${inputTypeForTimingKey(key)}" class="detail-timing-input" ${isTimingSecondsKey(key) ? 'inputmode="numeric" placeholder="m:ss"' : ''} data-timing-row-index="${rowIndex}" data-timing-key="${utils.escapeHtml(key)}" value="${utils.escapeHtml(formatTimingInputValue(key, row[key]))}"></td>`).join('')}
                <td><button type="button" class="ghost detail-remove-timing-row-button" data-timing-row-index="${rowIndex}">Remove</button></td>
              </tr>
            `).join('') : `<tr><td colspan="${columns.length + 1}" class="placeholder-row">No timing rows yet. Add one below.</td></tr>`}
          </tbody>
        </table>
      </div>`;
  }

  function syncTimingDraftFromDom() {
    if (!els.detailTimingEditor) return;
    const rows = cloneTimingRows(state.detailTimingDraftRows || []);
    els.detailTimingEditor.querySelectorAll('.detail-timing-input').forEach((input) => {
      const rowIndex = Number(input.getAttribute('data-timing-row-index') || -1);
      const key = input.getAttribute('data-timing-key') || '';
      if (rowIndex < 0 || !rows[rowIndex] || !key) return;
      const raw = input.value;
      rows[rowIndex][key] = parseTimingInputValue(key, raw);
    });
    state.detailTimingDraftRows = rows;
  }

  function addTimingDraftRow() {
    const next = cloneTimingRows(state.detailTimingDraftRows || state.currentDetailTimings || []);
    next.push(blankTimingRow());
    renderTimingEditor(next);
  }

  function removeTimingDraftRow(index) {
    const next = cloneTimingRows(state.detailTimingDraftRows || state.currentDetailTimings || []);
    next.splice(index, 1);
    renderTimingEditor(next);
  }

  function timingMetricSeconds(row = {}, keys = []) {
    for (const key of keys) {
      const raw = row?.[key];
      const num = Number(raw);
      if (Number.isFinite(num)) return num;
      if (raw === 0) return 0;
    }
    return null;
  }

  function timingLabel(row = {}, fallbackIndex = 0) {
    const direct = Number(utils.firstNonEmpty(row.segment_number, row.slot_number));
    const seq = Number.isFinite(direct) && direct > 0 ? direct : fallbackIndex + 1;
    return `Act ${seq}`;
  }

  function timingNotes(row = {}) {
    return utils.normalizeText(utils.firstNonEmpty(
      row.notes,
      row.description,
      row.segment_title,
      row.segment_name,
      row.timing_note,
      row.timing_notes
    ));
  }

  function normalizeTimingRows(timings = []) {
    return [...(Array.isArray(timings) ? timings : [])]
      .map((row, index) => {
        const programSeconds = timingMetricSeconds(row, ['program_segment_length_seconds', 'segment_seconds', 'act_seconds']);
        const breakSeconds = timingMetricSeconds(row, ['pledge_break_seconds', 'break_length_seconds', 'break_seconds']);
        const localCutInSeconds = timingMetricSeconds(row, ['local_cutin_seconds', 'local_cutin', 'local_cutin_length_seconds']);
        return {
          row,
          sortKey: Number(utils.firstNonEmpty(row.segment_number, row.slot_number, index + 1)) || (index + 1),
          label: timingLabel(row, index),
          programSeconds,
          breakSeconds,
          localCutInSeconds,
          note: timingNotes(row)
        };
      })
      .sort((a, b) => a.sortKey - b.sortKey);
  }

  function timingTableHasStructuredData(rows = []) {
    return rows.some((row) => Number.isFinite(row.programSeconds) || Number.isFinite(row.breakSeconds) || Number.isFinite(row.localCutInSeconds));
  }

  function renderTiming(timings) {
    els.timingCountChip.textContent = `${timings.length}`;
    if (!timings.length) {
      els.timingList.innerHTML = '<div class="timing-card">No detailed timing rows are available for this title.</div>';
      return;
    }
    const normalizedRows = normalizeTimingRows(timings);
    if (timingTableHasStructuredData(normalizedRows)) {
      els.timingList.innerHTML = `
        <article class="timing-card">
          <div class="segment-table-wrap">
            <table class="segment-table timing-acts-table">
              <thead>
                <tr>
                  <th>Segment</th>
                  <th>Program</th>
                  <th>Break</th>
                  <th>Local Cut In</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                ${normalizedRows.map((entry) => `
                  <tr>
                    <td>${utils.escapeHtml(entry.label)}</td>
                    <td>${utils.escapeHtml(Number.isFinite(entry.programSeconds) ? formatTimingSecondsMmSs(entry.programSeconds) : '—')}</td>
                    <td>${utils.escapeHtml(Number.isFinite(entry.breakSeconds) ? formatTimingSecondsMmSs(entry.breakSeconds) : '—')}</td>
                    <td>${utils.escapeHtml(Number.isFinite(entry.localCutInSeconds) ? formatTimingSecondsMmSs(entry.localCutInSeconds) : '—')}</td>
                    <td>${utils.escapeHtml(entry.note || '—')}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </article>
      `;
      return;
    }
    const rows = [...timings].sort((a, b) => Number(a.segment_number || a.slot_number || 0) - Number(b.segment_number || b.slot_number || 0));
    const columns = candidateColumns(rows).filter((key) => !/^(id|program_id|source_row_number)$/i.test(key));
    els.timingList.innerHTML = `
      <article class="timing-card">
        <div class="segment-table-wrap">
          <table class="segment-table">
            <thead>
              <tr>
                ${columns.map((key) => `<th>${utils.escapeHtml(displayKeyLabel(key))}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${rows.map((row) => `
                <tr>
                  ${columns.map((key) => `<td>${formatMaybeSeconds(key, row[key])}</td>`).join('')}
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </article>
    `;
  }

  function renderDriveResults(driveResults, exactAirings) {
    const combined = [];
    const resolvedAirings = resolvedExactAiringRows(exactAirings, driveResults);
    if (resolvedAirings.length) {
      resolvedAirings.forEach((row) => {
        const sourceNote = row.__resolved_contribution_source === 'drive_rollup' ? ' · fundraiser rollup' : '';
        combined.push({
          when: detailDisplayDateTime(row, 'N/A'),
          contributed: utils.firstNonEmpty(row.__resolved_contribution_amount, contributionAmount(row)),
          note: `${utils.normalizeText(utils.firstNonEmpty(row.fundraiser_label, row.drive_label, row.notes)) || '—'}${sourceNote}`
        });
      });
    } else {
      driveResults.forEach((row) => {
        const label = utils.normalizeText(utils.firstNonEmpty(row.drive_label, row.drive_column, row.fundraiser_label)) || 'Drive';
        const when = utils.firstNonEmpty(row.drive_date, row.drive_start_date)
          ? `${detailDisplayDate(row, 'N/A')}${row.drive_window_text ? ` · ${row.drive_window_text}` : ''}`
          : label;
        combined.push({ when, contributed: contributionAmount(row), note: label });
      });
    }
    els.airingCountChip.textContent = `${combined.length}`;
    if (!combined.length) {
      els.airingList.innerHTML = '<div class="premium-card">No readable drive or airing history is available for this title.</div>';
      return;
    }
    els.airingList.innerHTML = `
      <div class="airing-table-wrap">
        <table class="segment-table">
          <thead>
            <tr>
              <th>Aired / drive</th>
              <th>Contributed</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            ${combined.map((row) => `
              <tr>
                <td>${utils.escapeHtml(row.when)}</td>
                <td>${utils.escapeHtml(row.contributed == null || row.contributed === '' ? '—' : utils.formatMoney(row.contributed))}</td>
                <td>${utils.escapeHtml(row.note || '—')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderPremiums(program) {
    const lines = (App.listUi?.premiumLines ? App.listUi.premiumLines(derive.premiumSummary(program)) : [derive.premiumSummary(program)])
      .filter((line) => line && line !== '—');
    els.premiumCountChip.textContent = `${lines.length || 0}`;
    els.premiumsList.innerHTML = lines.length
      ? lines.map((line) => `<article class="premium-card">${utils.escapeHtml(line)}</article>`).join('')
      : '<div class="premium-card">No premium summary is available for this title.</div>';
  }

  function displayKeyLabel(key) {
    return key
      .replace(/^__resolved_/, '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function sortedProgramEntries(program) {
    const seen = new Set();
    const orderedKeys = [...PROGRAM_FIELD_ORDER, ...Object.keys(program || {}).sort(utils.compareText)];
    return orderedKeys
      .filter((key) => {
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((key) => [key, program?.[key]])
      .filter(([key, value]) => !utils.isBlank(value) && !/^(?:__supplement_match_method|id|program_id|source_row_number)$/i.test(key));
  }

  function renderAllFields(program) {
    const entries = sortedProgramEntries(program);
    els.allFieldsList.innerHTML = entries.length
      ? `<dl class="raw-grid">${entries.map(([key, value]) => labelValue(displayKeyLabel(key), formatMaybeSeconds(key, value))).join('')}</dl>`
      : '<div class="premium-card">No readable program-row fields were available.</div>';
  }

  function renderSectionLoading() {
    els.timingCountChip.textContent = '…';
    els.airingCountChip.textContent = '…';
    els.timingList.innerHTML = '<div class="timing-card">Loading timing rows…</div>';
    els.airingList.innerHTML = '<div class="premium-card">Loading airing and drive history…</div>';
  }

  function renderDetailShell(program) {
    els.detailEmpty.classList.add('hidden');
    els.detailContent.classList.remove('hidden');
    els.detailTitle.textContent = state.detailCreateMode ? 'Add Program' : derive.title(program);
    els.detailSubtitle.textContent = state.detailCreateMode
      ? detailSubtitleHtml(program)
      : 'Loading timing rows and drive history…';
    renderLead(program);
    renderOverview(program, [], []);
    renderSectionLoading();
    renderPremiums(program);
    renderPerformanceGraph(program, [], []);
    renderAllFields(program);
  }

  function renderDetail(program, timings, driveResults, exactAirings) {
    els.detailEmpty.classList.add('hidden');
    els.detailContent.classList.remove('hidden');
    els.detailTitle.textContent = state.detailCreateMode ? 'Add Program' : derive.title(program);
    els.detailSubtitle.textContent = detailSubtitleHtml(program);
    renderLead(program);
    renderOverview(program, driveResults, exactAirings);
    renderTiming(timings);
    renderDriveResults(driveResults, exactAirings);
    renderPremiums(program);
    renderPerformanceGraph(program, driveResults, exactAirings);
    renderAllFields(program);
  }

  function showDetailFailure(message) {
    els.detailTitle.textContent = 'Detail load failed';
    els.detailSubtitle.textContent = message || 'Something went sideways while loading this title.';
    els.detailContent.classList.add('hidden');
    els.detailEmpty.classList.remove('hidden');
    els.detailEmpty.textContent = message || 'Something went sideways while loading this title.';
  }

  function ensureSelectOption(select, value) {
    if (!select) return;
    const normalized = utils.normalizeText(value);
    if (!normalized) {
      select.value = '';
      return;
    }
    const exists = [...select.options].some((option) => utils.normalizeText(option.value) === normalized);
    if (!exists) {
      const option = document.createElement('option');
      option.value = normalized;
      option.textContent = normalized;
      option.dataset.dynamic = 'true';
      select.appendChild(option);
    }
    select.value = normalized;
  }

  function normalizeDateFieldInput(input) {
    if (!input) return true;
    const parsed = utils.parseFlexibleDateInput(input.value);
    if (parsed.blank) {
      input.value = '';
      return true;
    }
    if (!parsed.valid) return false;
    input.value = parsed.display;
    return true;
  }

  function bindCompactDateInputs() {
    ['rights_start', 'rights_end'].forEach((name) => {
      const input = els.detailEditForm?.elements?.[name];
      if (!input || input.dataset.compactDateBound === 'true') return;
      input.dataset.compactDateBound = 'true';
      input.addEventListener('blur', () => {
        if (!normalizeDateFieldInput(input)) {
          setDetailNotice(`${name === 'rights_start' ? 'Rights begin' : 'Rights end'} should look like MM/DD/YY.`, 'warn');
        } else if (state.detailEditMode) {
          handleEditorInput();
        }
      });
    });
  }

  function setFormFieldsFromSource(source = {}) {
    const form = els.detailEditForm;
    form.elements.title.value = derive.title(source) === 'Untitled program' ? '' : derive.title(source);
    form.elements.nola_code.value = derive.nola(source);
    form.elements.distributor.value = derive.distributor(source);
    form.elements.length_bucket_minutes.value = derive.lengthBucket(source) || '';
    form.elements.actual_runtime_input.value = derive.actualRuntimeLabel(source) === '—' ? '' : derive.actualRuntimeLabel(source);
    form.elements.topic_primary.value = derive.topicPrimary(source);
    form.elements.topic_secondary.value = derive.topicSecondary(source);
    form.elements.rights_start.value = utils.formatCompactDateInput(derive.rightsBegin(source));
    form.elements.rights_end.value = utils.formatCompactDateInput(derive.rightsEnd(source));
    form.elements.package_type.value = utils.normalizeText(source.package_type);
    ensureSelectOption(form.elements.source_format, utils.normalizeText(source.source_format));
    form.elements.rights_notes.value = utils.normalizeText(source.rights_notes);
    form.elements.premium_summary.value = derive.premiumSummary(source);
    form.elements.program_notes.value = derive.description(source);
    renderExtraFieldsEditor(source);
  }

  function findDuplicates({ title = '', nola = '', excludeId = '' } = {}) {
    const titleKey = utils.normalizeLookupKey(title);
    const nolaKey = utils.normalizeLookupKey(nola);
    const excludeKey = String(excludeId || '');
    let exactNola = null;
    let exactTitle = null;

    (state.rawRows || []).forEach((row) => {
      const rowId = String(derive.programId(row) || '');
      if (excludeKey && rowId === excludeKey) return;
      if (!exactNola && nolaKey && utils.normalizeLookupKey(derive.nola(row)) === nolaKey) exactNola = row;
      if (!exactTitle && titleKey && utils.normalizeLookupKey(derive.title(row)) === titleKey) exactTitle = row;
    });

    return { exactNola, exactTitle };
  }

  function currentDetailProgramId() {
    return derive.programId(state.currentDetailProgram) || state.selectedProgramId || '';
  }

  function editorDuplicateMessage({ title = '', nola = '' } = {}) {
    const duplicates = findDuplicates({ title, nola, excludeId: state.detailCreateMode ? '' : currentDetailProgramId() });
    if (duplicates.exactNola) {
      return {
        text: `NOLA ${derive.nola(duplicates.exactNola)} already exists on “${derive.title(duplicates.exactNola)}”. NOLA is king, so this would create a duplicate title record.`,
        type: 'warn',
        blocking: true
      };
    }
    if (duplicates.exactTitle) {
      return {
        text: `Title matches existing record “${derive.title(duplicates.exactTitle)}”${derive.nola(duplicates.exactTitle) ? ` (${derive.nola(duplicates.exactTitle)})` : ''}. Double-check before saving.`,
        type: 'warn',
        blocking: false
      };
    }
    return { text: '', type: '', blocking: false };
  }

  function handleEditorInput() {
    if (!state.detailEditMode) {
      if (els.detailTimingEditor) els.detailTimingEditor.innerHTML = '';
      if (els.detailExtraFieldsEditor) els.detailExtraFieldsEditor.innerHTML = '';
      return;
    }
    const form = els.detailEditForm;
    const title = utils.normalizeText(form.elements.title.value);
    const nola = utils.normalizeText(form.elements.nola_code.value);
    const dup = editorDuplicateMessage({ title, nola });
    if (dup.text) {
      setDetailNotice(dup.text, dup.type || 'warn');
      return;
    }
    if (state.detailCreateMode) {
      setDetailNotice('Edit the core fields here. Break timings save with the same button.', '');
    } else {
      setDetailNotice('');
    }
  }

  function setDetailMode(mode = 'view') {
    state.detailEditMode = mode === 'edit' && canEdit();
    els.detailModal.classList.toggle('create-mode', state.detailCreateMode);
    els.detailEditForm.classList.toggle('hidden', !state.detailEditMode);
    els.detailEditButton.classList.toggle('hidden', !canEdit() || state.detailEditMode || state.detailCreateMode);
    if (els.detailFormHeading) els.detailFormHeading.textContent = state.detailCreateMode ? 'Add Program' : 'Edit program';
    if (els.detailSaveButton) els.detailSaveButton.textContent = state.detailCreateMode ? 'Create program' : 'Save';
    if (!state.detailEditMode) return;

    const source = state.currentDetailProgram || blankProgram();
    setFormFieldsFromSource(source);
    bindCompactDateInputs();
    renderTimingEditor(state.currentDetailTimings || []);
    handleEditorInput();
  }

  function openDetailModal() {
    els.detailBackdrop.classList.remove('hidden');
    els.detailModal.classList.remove('hidden');
    document.body.classList.add('modal-open');
  }

  function closeDetailModal() {
    els.detailBackdrop.classList.add('hidden');
    els.detailModal.classList.add('hidden');
    document.body.classList.remove('modal-open');
    state.detailEditMode = false;
    state.detailCreateMode = false;
    state.detailLoadToken = null;
    els.detailModal.classList.remove('create-mode');
    setDetailNotice('');
  }

  function openCreateProgram() {
    if (!canEdit()) return;
    state.selectedProgramId = '';
    App.listUi.syncSelectedRows();
    state.detailCreateMode = true;
    state.currentDetailProgram = blankProgram();
    state.currentDetailTimings = [];
    state.currentDetailDriveResults = [];
    state.currentDetailAirings = [];
    openDetailModal();
    els.detailTitle.textContent = 'Add Program';
    els.detailSubtitle.textContent = 'Create the library record now. NOLA is required because reports match by NOLA, not title.';
    if (els.detailProgramMeta) els.detailProgramMeta.innerHTML = '';
    if (els.detailProgramDescription) els.detailProgramDescription.innerHTML = '';
    els.detailEmpty.classList.add('hidden');
    els.detailContent.classList.remove('hidden');
    setDetailMode('edit');
    setDetailNotice('Edit the core fields here. Break timings save with the same button.');
    window.setTimeout(() => els.detailEditForm?.elements?.title?.focus(), 0);
  }

  async function loadProgramDetail(programId, options = {}) {
    state.selectedProgramId = App.programLinks?.resolveId?.(programId) || programId;
    state.currentDetailProgram = blankProgram();
    state.currentDetailTimings = [];
    state.currentDetailDriveResults = [];
    state.currentDetailAirings = [];
    state.detailCreateMode = false;

    const preserveMode = Object.prototype.hasOwnProperty.call(options, 'preserveMode')
      ? Boolean(options.preserveMode)
      : canEdit();

    const loadToken = Symbol(`detail:${programId}`);
    state.detailLoadToken = loadToken;

    openDetailModal();
    els.detailModal.classList.remove('create-mode');
    els.detailTitle.textContent = 'Loading detail…';
    els.detailSubtitle.textContent = 'Checking the program row, timing rows, and drive history.';
    if (els.detailProgramMeta) els.detailProgramMeta.innerHTML = '';
    if (els.detailProgramDescription) els.detailProgramDescription.innerHTML = '';
    els.detailEmpty.classList.add('hidden');
    els.detailContent.classList.add('hidden');
    setDetailMode('view');
    setDetailNotice('');

    const snapshotProgram = App.data.resolveProgramSnapshot?.(programId);
    if (snapshotProgram) {
      state.currentDetailProgram = snapshotProgram;
      state.selectedProgramId = derive.programId(snapshotProgram) || state.selectedProgramId;
      renderDetailShell(snapshotProgram);
      if (preserveMode && canEdit()) setDetailMode('edit');
    }

    try {
      const detail = await App.data.fetchProgramDetail(programId);
      if (state.detailLoadToken !== loadToken) return;
      if (!detail.program) {
        showDetailFailure('No readable detail data came back for this title.');
        return;
      }

      state.currentDetailProgram = detail.program;
      state.selectedProgramId = derive.programId(detail.program) || state.selectedProgramId;
      state.currentDetailTimings = detail.timings;
      state.currentDetailDriveResults = detail.driveResults;
      state.currentDetailAirings = detail.airings;
      setDetailNotice(detail.warnings.join(' '), detail.warnings.length ? 'warn' : '');
      renderDetail(detail.program, detail.timings, detail.driveResults, detail.airings);
      if (preserveMode && canEdit()) setDetailMode('edit');
      else els.detailCloseButton.focus();
    } catch (error) {
      if (state.detailLoadToken !== loadToken) return;
      console.error('Detail render failed.', error);
      setDetailNotice(`Detail render warning: ${error.message || error}`, 'bad');
      const fallbackProgram = App.data.resolveProgramSnapshot?.(programId)
        || App.programLinks?.resolveRow?.(programId)
        || state.rawRows.find((row) => String(derive.programId(row)) === String(programId))
        || null;
      if (fallbackProgram) {
        state.currentDetailProgram = fallbackProgram;
        state.selectedProgramId = derive.programId(fallbackProgram) || state.selectedProgramId;
        renderDetail(fallbackProgram, [], [], []);
      } else {
        showDetailFailure('Something went sideways while loading this title.');
      }
    }
  }

  function buildPayloadFromForm() {
    const form = els.detailEditForm;
    const payload = {
      title: utils.normalizeText(form.elements.title.value),
      nola_code: utils.normalizeText(form.elements.nola_code.value) || null,
      distributor: utils.normalizeText(form.elements.distributor.value) || null,
      length_bucket_minutes: form.elements.length_bucket_minutes.value ? Number(form.elements.length_bucket_minutes.value) : null,
      actual_runtime_seconds: utils.parseRuntimeInput(form.elements.actual_runtime_input.value),
      topic_primary: utils.normalizeText(form.elements.topic_primary.value) || null,
      topic_secondary: utils.normalizeText(form.elements.topic_secondary.value) || null,
      rights_start: null,
      rights_end: null,
      package_type: utils.normalizeText(form.elements.package_type.value) || null,
      source_format: utils.normalizeText(form.elements.source_format.value) || null,
      rights_notes: utils.normalizeText(form.elements.rights_notes.value) || null,
      premium_summary: utils.normalizeText(form.elements.premium_summary.value) || null,
      program_notes: utils.normalizeText(form.elements.program_notes.value) || null,
      ...extraFieldPayload()
    };
    const rightsBegin = utils.parseFlexibleDateInput(form.elements.rights_start.value);
    const rightsEnd = utils.parseFlexibleDateInput(form.elements.rights_end.value);
    if (!rightsBegin.valid) throw new Error('Rights begin should look like MM/DD/YY.');
    if (!rightsEnd.valid) throw new Error('Rights end should look like MM/DD/YY.');
    payload.rights_start = rightsBegin.iso;
    payload.rights_end = rightsEnd.iso;
    if (payload.length_bucket_minutes != null && !Number.isFinite(payload.length_bucket_minutes)) payload.length_bucket_minutes = null;
    return payload;
  }

  async function saveDetailEdit(event) {
    event.preventDefault();
    if (!canEdit()) return;

    const payload = buildPayloadFromForm();
    if (!payload.title) {
      setDetailNotice('Title is required.', 'bad');
      els.detailEditForm.elements.title.focus();
      return;
    }
    if (state.detailCreateMode && !payload.nola_code) {
      setDetailNotice('NOLA is required for a new pledge title. Reports match to the library by NOLA.', 'bad');
      els.detailEditForm.elements.nola_code.focus();
      return;
    }

    const duplicateState = editorDuplicateMessage({ title: payload.title, nola: payload.nola_code || '' });
    if (duplicateState.blocking) {
      setDetailNotice(duplicateState.text, 'bad');
      els.detailEditForm.elements.nola_code.focus();
      return;
    }

    setDetailNotice(state.detailCreateMode ? 'Creating program…' : 'Saving changes…');

    if (state.detailCreateMode) {
      const response = await App.data.createProgram(payload);
      if (response.error) {
        const friendly = friendlyCreateError(response.error);
        setDetailNotice(friendly, 'bad');
        throw new Error(friendly);
      }
      const createdId = derive.programId(response.data || {});
      syncTimingDraftFromDom();
      if (createdId && (state.detailTimingDraftRows || []).length) {
        const timingResponse = await App.data.saveTimingRows(createdId, state.detailTimingDraftRows || []);
        if (timingResponse?.error) throw timingResponse.error;
      }
      await App.app.refreshAll();
      if (createdId) {
        state.detailCreateMode = false;
        await loadProgramDetail(createdId, { preserveMode: false });
      } else {
        closeDetailModal();
      }
      App.dom.setNotice(`Added ${payload.title}.`);
      return;
    }

    const programId = currentDetailProgramId();
    if (!programId || String(programId).startsWith('lookup:')) {
      throw new Error('Could not resolve the real program ID for this record.');
    }
    const { error } = await App.data.updateProgram(programId, payload);
    if (error) throw error;
    syncTimingDraftFromDom();
    const timingResponse = await App.data.saveTimingRows(programId, state.detailTimingDraftRows || []);
    if (timingResponse?.error) throw timingResponse.error;
    await App.app.refreshAll({ preserveDetail: true });
    await loadProgramDetail(programId, { preserveMode: false });
    setDetailNotice('Changes saved.');
    App.dom.setNotice('Program updated.');
    setDetailMode('view');
  }

  App.detailUi = {
    canEdit,
    openDetailModal,
    closeDetailModal,
    openCreateProgram,
    setDetailMode,
    loadProgramDetail,
    saveDetailEdit,
    handleEditorInput,
    showDetailFailure,
    addTimingDraftRow,
    removeTimingDraftRow,
    syncTimingDraftFromDom
  };
})();
