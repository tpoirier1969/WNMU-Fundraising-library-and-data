(() => {
  const App = window.PledgeLib;
  const { state, utils, derive } = App;
  const { els, setNotice, renderSelectOptions } = App.dom;

  const DATETIME_KEYS = ['aired_at', 'air_datetime', 'air_date', 'drive_date', 'broadcast_at', 'scheduled_at', 'date_time', 'datetime', 'airing_at', 'airing_date'];
  const TIME_ONLY_KEYS = ['air_time', 'time_of_day', 'scheduled_time', 'slot_time', 'airtime', 'broadcast_time'];
  const MONEY_KEYS = ['dollars', 'total_dollars', 'contribution_total', 'total_contributions', 'total_raised', 'gross_contributions', 'amount_raised', 'revenue', 'pledge_total', 'contributions'];
  const LOCAL_BREAK_KEYS = ['local_breaks', 'local_break_count', 'local_cutins_count', 'local_cutin_count', 'local_cutins', 'legacy_has_local_cutins_raw'];
  const LIVE_BREAK_KEYS = ['live_breaks', 'live_break_count', 'live_break_flag', 'live_break_notes', 'live_break_note'];
  const PREMIUM_KEYS = ['premium_summary', 'premiums', 'premium_notes', 'premium_offer', 'premium_description'];
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAY_ORDER = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const TEMPORAL_CRITERIA = new Set(['date', 'day', 'time']);

  function perf() { return state.performance; }

  function setStatus(text, type = '') {
    if (!els.performanceStatus) return;
    els.performanceStatus.textContent = text;
    els.performanceStatus.className = 'list-summary';
    if (type) els.performanceStatus.classList.add(type);
  }

  function candidateValue(row, keys = [], regex = null) {
    for (const key of keys) {
      if (!utils.isBlank(row?.[key])) return row[key];
    }
    if (!regex) return null;
    for (const [key, value] of Object.entries(row || {})) {
      if (regex.test(key) && !utils.isBlank(value)) return value;
    }
    return null;
  }

  function parseMoney(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const cleaned = String(value).replace(/[$,]/g, '').trim();
    if (!cleaned) return null;
    const num = Number(cleaned);
    return Number.isFinite(num) ? num : null;
  }

  function parseInteger(value) {
    if (value == null || value === '') return null;
    const num = Number(String(value).replace(/[^\d.-]/g, ''));
    return Number.isFinite(num) ? Math.trunc(num) : null;
  }

  function parseBooleanish(value) {
    if (typeof value === 'boolean') return value;
    const text = utils.normalizeText(value).toLowerCase();
    if (!text) return null;
    if (['true', 'yes', 'y', '1', 'live', 'has live breaks'].includes(text)) return true;
    if (['false', 'no', 'n', '0', 'none', 'no local breaks', 'no live breaks'].includes(text)) return false;
    return null;
  }

  function parseTemporal(row) {
    const rawDateTime = candidateValue(row, DATETIME_KEYS, /(aired_?at|air_?date|drive_?date|date_?time|datetime|broadcast_?at|scheduled_?at|airing_?date)/i);
    const rawTimeOnly = candidateValue(row, TIME_ONLY_KEYS, /(air_?time|slot_?time|scheduled_?time|time_?of_?day|airtime|broadcast_?time)/i);
    const out = {
      when: null,
      hasDate: false,
      hasExplicitTime: false,
      rawDateText: '',
      rawTimeText: ''
    };

    if (!utils.isBlank(rawDateTime)) {
      const text = String(rawDateTime).trim();
      out.rawDateText = text;
      const hasExplicitTime = /\d{1,2}:\d{2}/.test(text) || /T\d{2}:\d{2}/i.test(text);
      const parsed = new Date(text);
      if (!Number.isNaN(parsed.getTime())) {
        out.when = parsed;
        out.hasDate = true;
        out.hasExplicitTime = hasExplicitTime;
        return out;
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        out.hasDate = true;
        if (!utils.isBlank(rawTimeOnly)) {
          const timeText = String(rawTimeOnly).trim();
          out.rawTimeText = timeText;
          const merged = new Date(`${text}T${timeText}`);
          if (!Number.isNaN(merged.getTime())) {
            out.when = merged;
            out.hasExplicitTime = true;
            return out;
          }
        }
        const midday = new Date(`${text}T12:00:00`);
        if (!Number.isNaN(midday.getTime())) {
          out.when = midday;
          out.hasExplicitTime = false;
          return out;
        }
      }
    }

    if (utils.isBlank(rawDateTime) && !utils.isBlank(rawTimeOnly)) {
      out.rawTimeText = String(rawTimeOnly).trim();
    }
    return out;
  }

  function timeBucketLabel(record) {
    if (!record?.hasExplicitTime || !(record.when instanceof Date) || Number.isNaN(record.when.getTime())) return 'Unknown time';
    const minutes = (record.when.getHours() * 60) + record.when.getMinutes();
    const bucketMinutes = Math.floor(minutes / 30) * 30;
    return utils.minutesToLabel(bucketMinutes);
  }

  function dayLabel(record) {
    if (!record?.hasDate || !(record.when instanceof Date) || Number.isNaN(record.when.getTime())) return 'Unknown day';
    return record.when.toLocaleDateString(undefined, { weekday: 'long' });
  }

  function dateLabel(record) {
    if (!record?.hasDate || !(record.when instanceof Date) || Number.isNaN(record.when.getTime())) return 'Unknown date';
    return record.when.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function splitTopicTokens(...values) {
    const tokens = [];
    values.flat().forEach((value) => {
      const text = utils.normalizeText(value);
      if (!text) return;
      text
        .split(/[;|/]+/)
        .flatMap((part) => part.split(/,(?=\s*[A-Z]|\s*[a-z])/))
        .map((part) => part.trim())
        .filter(Boolean)
        .forEach((part) => tokens.push(part));
    });
    const seen = new Set();
    return tokens.filter((token) => {
      const key = utils.normalizeLookupKey(token);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function topicDisplayFromTokens(tokens = []) {
    if (!tokens.length) return 'Unspecified topic';
    return tokens.join(' · ');
  }

  function topicMatches(record, filterValue) {
    const key = utils.normalizeLookupKey(filterValue);
    if (!key) return true;
    const tokenKeys = (record.topicTokens || []).map((token) => utils.normalizeLookupKey(token));
    if (tokenKeys.some((token) => token === key || token.includes(key) || key.includes(token))) return true;
    const full = utils.normalizeLookupKey(record.topicDisplay || record.topic || '');
    return full.includes(key);
  }

  function premiumLabel(row, programRow) {
    const value = utils.firstNonEmpty(candidateValue(row, PREMIUM_KEYS, /(premium)/i), candidateValue(programRow, PREMIUM_KEYS, /(premium)/i));
    const text = utils.normalizeText(value);
    if (!text) return 'No premium metadata';
    const first = text.split(/\n|\r|;|\|/).map((part) => part.trim()).filter(Boolean)[0] || text;
    return first.length > 48 ? `${first.slice(0, 45)}…` : first;
  }

  function localBreakLabel(row, programRow) {
    const direct = utils.firstNonEmpty(candidateValue(row, LOCAL_BREAK_KEYS, /(local_?(break|cutin))/i), candidateValue(programRow, LOCAL_BREAK_KEYS, /(local_?(break|cutin))/i));
    const booleanish = parseBooleanish(direct);
    if (booleanish === true) return 'Has local breaks';
    if (booleanish === false) return 'No local breaks';
    const count = parseInteger(direct);
    if (Number.isFinite(count) && count > 0) return count === 1 ? '1 local break' : `${count} local breaks`;
    return 'No local breaks';
  }

  function liveBreakLabel(row, programRow) {
    const direct = utils.firstNonEmpty(candidateValue(row, LIVE_BREAK_KEYS, /(live_?break)/i), candidateValue(programRow, LIVE_BREAK_KEYS, /(live_?break)/i));
    const booleanish = parseBooleanish(direct);
    if (booleanish === true) return 'Has live breaks';
    if (booleanish === false) return 'No live breaks';
    const text = utils.normalizeText(direct);
    return text ? 'Has live breaks' : 'No live breaks';
  }

  function normalizeDistributor(value) {
    const raw = utils.normalizeText(value);
    const key = utils.normalizeLookupKey(raw);
    if (!key) return 'Unspecified distributor';
    if (['pbs', 'pbs distribution', 'public broadcasting service', 'pbs dist'].includes(key)) return 'PBS';
    if (['eps', 'educational programming services'].includes(key)) return 'EPS';
    return raw;
  }

  function buildProgramIndexes(rows) {
    const byId = new Map();
    const byNola = new Map();
    const byTitle = new Map();
    const titleEntries = [];
    (rows || []).forEach((row) => {
      const id = utils.normalizeLookupKey(derive.programId(row));
      const nola = utils.normalizeLookupKey(derive.nola(row));
      const title = utils.normalizeLookupKey(derive.title(row));
      if (id && !byId.has(id)) byId.set(id, row);
      if (nola && !byNola.has(nola)) byNola.set(nola, row);
      if (title && !byTitle.has(title)) byTitle.set(title, row);
      if (title) titleEntries.push({ key: title, row });
    });
    return { byId, byNola, byTitle, titleEntries };
  }

  function fuzzyTitleMatch(titleKey, titleEntries) {
    if (!titleKey || titleKey.length < 6) return null;
    const matches = titleEntries.filter((entry) => entry.key.includes(titleKey) || titleKey.includes(entry.key));
    if (matches.length === 1) return matches[0].row;
    return null;
  }

  function matchProgramRow(row, indexes) {
    const id = utils.normalizeLookupKey(utils.firstNonEmpty(row?.program_id, row?.pledge_program_id, row?.id));
    if (id && indexes.byId.has(id)) return indexes.byId.get(id);
    const nola = utils.normalizeLookupKey(utils.firstNonEmpty(row?.nola_code, row?.nola, row?.program_nola));
    if (nola) return indexes.byNola.get(nola) || null;
    const title = utils.normalizeLookupKey(utils.firstNonEmpty(row?.title, row?.program_title, row?.name));
    if (title && indexes.byTitle.has(title)) return indexes.byTitle.get(title);
    return fuzzyTitleMatch(title, indexes.titleEntries);
  }

  function buildPerformanceRecords(inputs) {
    const indexes = buildProgramIndexes(state.rawRows || []);
    const driveRows = Array.isArray(inputs?.driveRows) ? inputs.driveRows : [];
    const airingRows = Array.isArray(inputs?.airingRows) ? inputs.airingRows : [];
    const warnings = [...(inputs?.warnings || [])];
    const events = new Map();
    const exactAiringKeys = new Map();
    const dateOnlyAiringKeys = new Map();
    let matchedDriveRows = 0;
    let unmatchedDriveRows = 0;
    let fuzzyProgramMatches = 0;

    function localDateKey(date) {
      if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }

    function signatureFor(row, programRow) {
      return utils.normalizeLookupKey(
        utils.firstNonEmpty(
          programRow ? derive.programId(programRow) : '',
          row?.program_id,
          row?.pledge_program_id,
          programRow ? derive.nola(programRow) : '',
          row?.nola_code,
          row?.nola,
          programRow ? derive.title(programRow) : '',
          row?.program_title,
          row?.title,
          row?.name
        )
      );
    }

    function eventId(signature, dateKey, timeKey) {
      return [signature || 'unknown', dateKey || 'unknown-date', timeKey || 'unknown-time'].join('|');
    }

    function getOrCreate(signature, dateKey, timeKey) {
      const id = eventId(signature, dateKey, timeKey);
      if (!events.has(id)) {
        events.set(id, {
          id,
          signature,
          dateKey,
          timeKey,
          amount: 0,
          driveRows: 0,
          airingRows: 0,
          matchedDriveRows: 0,
          estimatedOnly: false,
          when: null,
          hasDate: false,
          hasExplicitTime: false,
          programId: '',
          title: 'Unknown title',
          topic: 'Unspecified topic',
          topicDisplay: 'Unspecified topic',
          topicTokens: [],
          distributor: 'Unspecified distributor',
          premiums: 'No premium metadata',
          localBreaks: 'No local breaks',
          liveBreaks: 'No live breaks'
        });
      }
      return events.get(id);
    }

    function applyMetadata(record, row, programRow, temporal) {
      record.programId = record.programId || (programRow ? derive.programId(programRow) : utils.firstNonEmpty(row?.program_id, row?.pledge_program_id, ''));
      record.title = record.title || (programRow ? derive.title(programRow) : utils.firstNonEmpty(row?.title, row?.program_title, row?.name, 'Unknown title'));
      const topicTokens = splitTopicTokens(
        programRow ? derive.topicPrimary(programRow) : utils.firstNonEmpty(row?.topic_primary, row?.topic, ''),
        programRow ? derive.topicSecondary(programRow) : utils.firstNonEmpty(row?.topic_secondary, row?.secondary_topic, '')
      );
      if (!record.topicTokens.length && topicTokens.length) record.topicTokens = topicTokens;
      record.topicDisplay = record.topicTokens.length ? topicDisplayFromTokens(record.topicTokens) : record.topicDisplay;
      record.topic = record.topicDisplay || 'Unspecified topic';
      const distributor = programRow ? derive.distributor(programRow) : utils.firstNonEmpty(row?.distributor, row?.distributor_name, 'Unspecified distributor');
      record.distributor = normalizeDistributor(record.distributor || distributor);
      record.premiums = record.premiums === 'No premium metadata' ? premiumLabel(row, programRow) : record.premiums;
      record.localBreaks = record.localBreaks === 'No local breaks' ? localBreakLabel(row, programRow) : record.localBreaks;
      record.liveBreaks = record.liveBreaks === 'No live breaks' ? liveBreakLabel(row, programRow) : record.liveBreaks;
      if (!record.when && temporal?.when) record.when = temporal.when;
      if (temporal?.hasDate) record.hasDate = true;
      if (temporal?.hasExplicitTime) record.hasExplicitTime = true;
      record.day = dayLabel(record);
      record.date = dateLabel(record);
      record.time = timeBucketLabel(record);
      record.monthIndex = record.hasDate && record.when instanceof Date && !Number.isNaN(record.when.getTime()) ? record.when.getMonth() : null;
    }

    airingRows.forEach((row) => {
      const sourceTitleKey = utils.normalizeLookupKey(utils.firstNonEmpty(row?.title, row?.program_title, row?.name));
      const programRow = matchProgramRow(row, indexes);
      if (programRow && sourceTitleKey && sourceTitleKey !== utils.normalizeLookupKey(derive.title(programRow))) {
        fuzzyProgramMatches += 1;
      }
      const temporal = parseTemporal(row);
      const signature = signatureFor(row, programRow);
      const dateKey = temporal.hasDate ? localDateKey(temporal.when) : '';
      const timeKey = temporal.hasExplicitTime ? timeBucketLabel({ when: temporal.when, hasExplicitTime: true }) : 'unknown-time';
      const record = getOrCreate(signature || utils.makeId('perf-airing'), dateKey, timeKey);
      record.airingRows += 1;
      record.estimatedOnly = false;
      const amount = parseMoney(candidateValue(row, MONEY_KEYS, /(dollars?|total_?dollars?|contribution|raised|gross|amount|revenue|pledge)/i));
      if (Number.isFinite(amount)) record.amount += amount;
      applyMetadata(record, row, programRow, temporal);
      if (temporal.hasDate) {
        const exactKey = eventId(signature, dateKey, timeKey);
        exactAiringKeys.set(exactKey, record.id);
        const dateOnlyKey = [signature || 'unknown', dateKey || 'unknown-date'].join('|');
        if (!dateOnlyAiringKeys.has(dateOnlyKey)) dateOnlyAiringKeys.set(dateOnlyKey, []);
        dateOnlyAiringKeys.get(dateOnlyKey).push(record.id);
      }
    });

    driveRows.forEach((row, index) => {
      const programRow = matchProgramRow(row, indexes);
      const temporal = parseTemporal(row);
      const signature = signatureFor(row, programRow);
      const dateKey = temporal.hasDate ? localDateKey(temporal.when) : '';
      const timeKey = temporal.hasExplicitTime ? timeBucketLabel({ when: temporal.when, hasExplicitTime: true }) : 'unknown-time';
      const exactKey = eventId(signature, dateKey, timeKey);
      const dateOnlyKey = [signature || 'unknown', dateKey || 'unknown-date'].join('|');
      let record = exactAiringKeys.has(exactKey) ? events.get(exactAiringKeys.get(exactKey)) : null;
      if (!record && dateOnlyAiringKeys.has(dateOnlyKey) && dateOnlyAiringKeys.get(dateOnlyKey).length === 1) {
        record = events.get(dateOnlyAiringKeys.get(dateOnlyKey)[0]);
      }
      if (!record) {
        record = getOrCreate(signature || `drive-${index}`, dateKey, timeKey);
        record.estimatedOnly = true;
        unmatchedDriveRows += 1;
      } else {
        matchedDriveRows += 1;
        record.matchedDriveRows += 1;
      }
      const amount = parseMoney(candidateValue(row, MONEY_KEYS, /(contribution|raised|gross|amount|revenue|pledge)/i));
      if (Number.isFinite(amount)) record.amount += amount;
      record.driveRows += 1;
      applyMetadata(record, row, programRow, temporal);
    });

    const records = [...events.values()].map((record) => ({
      ...record,
      amount: Number.isFinite(record.amount) ? record.amount : 0,
      topicDisplay: record.topicDisplay || 'Unspecified topic',
      topic: record.topicDisplay || 'Unspecified topic',
      time: timeBucketLabel(record),
      day: dayLabel(record),
      date: dateLabel(record)
    }));

    if (!driveRows.length && !airingRows.length) warnings.push('No drive-results or airings rows were available yet, so Pledge Performance has no records to compare.');
    if (!records.some((record) => record.topicTokens.length)) warnings.push('Topic matching is still sparse. Some performance rows do not inherit library topics cleanly yet.');

    const datedRecords = records
      .filter((record) => record.hasDate && record.when instanceof Date && !Number.isNaN(record.when.getTime()))
      .sort((a, b) => a.when.getTime() - b.when.getTime());
    const oldestDate = datedRecords.length ? localDateKey(datedRecords[0].when) : '';
    const newestDate = datedRecords.length ? localDateKey(datedRecords[datedRecords.length - 1].when) : '';

    perf().dataShape = {
      driveRows: driveRows.length,
      airingRows: airingRows.length,
      normalizedEvents: records.length,
      matchedDriveRows,
      unmatchedDriveRows,
      fuzzyProgramMatches,
      recordsWithMoney: records.filter((record) => Number.isFinite(record.amount) && record.amount !== 0).length,
      recordsWithDateTime: records.filter((record) => record.hasDate).length,
      recordsWithExplicitTime: records.filter((record) => record.hasExplicitTime).length,
      recordsWithTopic: records.filter((record) => record.topicTokens.length).length,
      temporalEligibleDayDate: records.filter((record) => record.hasDate && !record.estimatedOnly).length,
      temporalEligibleTime: records.filter((record) => record.hasExplicitTime && !record.estimatedOnly).length,
      oldestDate,
      newestDate
    };
    if (!perf().startDate && oldestDate) perf().startDate = oldestDate;
    if (!perf().endDate && newestDate) perf().endDate = newestDate;
    perf().warnings = warnings;
    perf().records = records;
    perf().lastLoadedAt = new Date().toISOString();
  }

  function criterionDisplayName(criterion = perf().criterion) {
    switch (criterion) {
      case 'date': return 'Date';
      case 'day': return 'Day';
      case 'time': return 'Time';
      case 'topic': return 'Topic';
      case 'local_breaks': return 'Local breaks';
      case 'live_breaks': return 'Live breaks';
      case 'premiums': return 'Premium metadata';
      case 'distributor': return 'Distributor';
      default: return 'Group';
    }
  }

  function criterionLabel(record, criterion) {
    switch (criterion) {
      case 'date': return record.date || 'Unknown date';
      case 'day': return record.day || 'Unknown day';
      case 'time': return record.time || 'Unknown time';
      case 'topic': return record.topicDisplay || 'Unspecified topic';
      case 'local_breaks': return record.localBreaks || 'No local breaks';
      case 'live_breaks': return record.liveBreaks || 'No live breaks';
      case 'premiums': return record.premiums || 'No premium metadata';
      case 'distributor': return record.distributor || 'Unspecified distributor';
      default: return 'Unknown';
    }
  }

  function criterionOrderKey(group, criterion) {
    if (criterion === 'date') return group.minTime || Number.MAX_SAFE_INTEGER;
    if (criterion === 'time') return group.minMinutes ?? Number.MAX_SAFE_INTEGER;
    if (criterion === 'day') return DAY_ORDER.indexOf(group.label);
    return group.label;
  }

  function metricLabel(metric = perf().metric) {
    switch (metric) {
      case 'total_dollars': return 'Total dollars';
      case 'airings': return 'Airing count';
      case 'avg_dollars':
      default: return 'Average dollars / airing';
    }
  }

  function metricValue(group, metric = perf().metric) {
    switch (metric) {
      case 'total_dollars': return group.totalDollars;
      case 'airings': return group.airingCount;
      case 'avg_dollars':
      default: return group.avgDollars;
    }
  }

  function chartTypeLabel(type) {
    switch (type) {
      case 'line': return 'Line chart';
      case 'bar': return 'Bar chart';
      default: return 'Auto';
    }
  }

  function isLineFriendly(criterion) {
    return ['date', 'day', 'time'].includes(criterion);
  }

  function effectiveChartType() {
    if (perf().chartType === 'auto') return isLineFriendly(perf().criterion) ? 'line' : 'bar';
    if (perf().chartType === 'line' && !isLineFriendly(perf().criterion)) return 'bar';
    return perf().chartType;
  }

  function temporalEligibility(record, criterion) {
    if (criterion === 'time') return record.hasExplicitTime && !record.estimatedOnly;
    if (criterion === 'date' || criterion === 'day') return record.hasDate && !record.estimatedOnly;
    return true;
  }

  function filterAndGroupRecords() {
    const labelFilter = utils.normalizeLookupKey(perf().labelFilter || '');
    const startDate = perf().startDate ? new Date(`${perf().startDate}T00:00:00`) : null;
    const endDate = perf().endDate ? new Date(`${perf().endDate}T23:59:59`) : null;
    const criterion = perf().criterion;
    const sourceRecords = perf().records || [];
    const postFilter = sourceRecords.filter((record) => {
      if (perf().monthFilter !== '' && record.monthIndex !== Number(perf().monthFilter)) return false;
      if (perf().topicFilter && !topicMatches(record, perf().topicFilter)) return false;
      if (startDate && (!(record.when instanceof Date) || record.when < startDate)) return false;
      if (endDate && (!(record.when instanceof Date) || record.when > endDate)) return false;
      return true;
    });

    const eligibleTemporal = TEMPORAL_CRITERIA.has(criterion)
      ? postFilter.filter((record) => temporalEligibility(record, criterion))
      : postFilter;

    const records = eligibleTemporal.filter((record) => {
      if (labelFilter && !utils.normalizeLookupKey(criterionLabel(record, criterion)).includes(labelFilter)) return false;
      return true;
    });

    const groups = new Map();
    records.forEach((record) => {
      const label = criterionLabel(record, criterion);
      if (!groups.has(label)) {
        groups.set(label, { label, airingCount: 0, totalDollars: 0, moneyCount: 0, avgDollars: 0, titles: new Set(), minTime: null, minMinutes: null });
      }
      const group = groups.get(label);
      group.airingCount += 1;
      if (Number.isFinite(record.amount)) {
        group.totalDollars += record.amount;
        group.moneyCount += 1;
      }
      group.titles.add(record.title || 'Unknown title');
      if (record.when instanceof Date && !Number.isNaN(record.when.getTime())) {
        const ts = record.when.getTime();
        group.minTime = group.minTime == null ? ts : Math.min(group.minTime, ts);
        const minutes = (record.when.getHours() * 60) + record.when.getMinutes();
        group.minMinutes = group.minMinutes == null ? minutes : Math.min(group.minMinutes, minutes);
      }
    });

    const grouped = [...groups.values()].map((group) => ({
      ...group,
      avgDollars: group.airingCount ? group.totalDollars / group.airingCount : 0,
      titleCount: group.titles.size,
      titles: [...group.titles].sort((a, b) => utils.compareText(a, b))
    }));

    const sorted = grouped.sort((a, b) => {
      if (effectiveChartType() === 'line' && isLineFriendly(criterion)) {
        const ak = criterionOrderKey(a, criterion);
        const bk = criterionOrderKey(b, criterion);
        if (typeof ak === 'number' && typeof bk === 'number' && ak !== bk) return ak - bk;
        return utils.compareText(String(a.label), String(b.label));
      }
      const diff = metricValue(b) - metricValue(a);
      if (diff !== 0) return diff;
      return utils.compareText(a.label, b.label);
    });

    const limit = Math.max(1, Number(perf().topN) || 12);
    const limited = limit >= 999 ? sorted : sorted.slice(0, limit);
    perf().filteredRecords = records;
    perf().groups = limited;
    perf().analysisMeta = {
      criterion,
      postFilterCount: postFilter.length,
      eligibleTemporalCount: eligibleTemporal.length,
      excludedWeakTemporalCount: Math.max(0, postFilter.length - eligibleTemporal.length),
      lowConfidenceTemporal: TEMPORAL_CRITERIA.has(criterion) && eligibleTemporal.length > 0 && eligibleTemporal.length < 12,
      noTemporalSupport: TEMPORAL_CRITERIA.has(criterion) && eligibleTemporal.length === 0 && postFilter.length > 0
    };
    return { records, grouped: limited, postFilter };
  }

  function renderStats(records) {
    if (!els.performanceStatGrid) return;
    const titles = new Set(records.map((record) => record.title).filter(Boolean));
    const dollars = records.reduce((sum, record) => sum + (Number.isFinite(record.amount) ? record.amount : 0), 0);
    const moneyCount = records.filter((record) => Number.isFinite(record.amount)).length;
    const datedCount = records.filter((record) => record.hasDate).length;
    const stats = [
      ['Events used', utils.formatCount(records.length)],
      ['Titles represented', utils.formatCount(titles.size)],
      ['Dollars represented', utils.formatMoney(dollars)],
      ['Rows with money / date', `${utils.formatCount(moneyCount)} / ${utils.formatCount(datedCount)}`]
    ];
    els.performanceStatGrid.innerHTML = stats.map(([label, value]) => `
      <article class="performance-stat-card">
        <div class="performance-stat-label">${utils.escapeHtml(label)}</div>
        <div class="performance-stat-value">${utils.escapeHtml(value)}</div>
      </article>
    `).join('');
  }

  function buildBarSvg(groups) {
    const width = 940;
    const left = 180;
    const right = 24;
    const top = 20;
    const rowH = 42;
    const height = Math.max(220, top + (groups.length * rowH) + 20);
    const chartW = width - left - right;
    const max = Math.max(...groups.map((group) => metricValue(group)), 1);
    const bars = groups.map((group, index) => {
      const y = top + (index * rowH);
      const value = metricValue(group);
      const barW = Math.max(2, Math.round((value / max) * chartW));
      const display = perf().metric === 'airings' ? utils.formatCount(value) : utils.formatMoney(value);
      return `
        <text x="${left - 12}" y="${y + 18}" font-size="12" text-anchor="end" fill="#14314f">${utils.escapeHtml(group.label)}</text>
        <rect x="${left}" y="${y + 4}" width="${barW}" height="18" rx="6" fill="#123e6b"></rect>
        <text x="${left + barW + 10}" y="${y + 18}" font-size="12" fill="#183a5f">${utils.escapeHtml(display)}</text>
      `;
    }).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${utils.escapeHtml(metricLabel())} by ${utils.escapeHtml(criterionDisplayName())}">${bars}</svg>`;
  }

  function buildLineSvg(groups) {
    const width = 940;
    const height = 320;
    const left = 64;
    const right = 20;
    const top = 20;
    const bottom = 48;
    const chartW = width - left - right;
    const chartH = height - top - bottom;
    const max = Math.max(...groups.map((group) => metricValue(group)), 1);
    const points = groups.map((group, index) => {
      const x = left + (groups.length <= 1 ? chartW / 2 : (index * chartW / (groups.length - 1)));
      const y = top + chartH - ((metricValue(group) / max) * chartH);
      return { x, y, label: group.label, value: metricValue(group) };
    });
    const path = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({ y: top + chartH - (ratio * chartH), value: max * ratio }));
    const labels = points.map((point) => `<text x="${point.x}" y="${height - 18}" font-size="11" text-anchor="middle" fill="#526174">${utils.escapeHtml(point.label)}</text>`).join('');
    const dots = points.map((point) => `
      <circle cx="${point.x}" cy="${point.y}" r="4" fill="#123e6b"></circle>
      <text x="${point.x}" y="${point.y - 10}" font-size="11" text-anchor="middle" fill="#173a5e">${utils.escapeHtml(perf().metric === 'airings' ? utils.formatCount(point.value) : utils.formatMoney(point.value))}</text>
    `).join('');
    const grid = yTicks.map((tick) => `
      <line x1="${left}" y1="${tick.y}" x2="${left + chartW}" y2="${tick.y}" stroke="#dce8f6" stroke-width="1"></line>
      <text x="${left - 8}" y="${tick.y + 4}" font-size="11" text-anchor="end" fill="#526174">${utils.escapeHtml(perf().metric === 'airings' ? utils.formatCount(Math.round(tick.value)) : utils.formatMoney(tick.value))}</text>
    `).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${utils.escapeHtml(metricLabel())} by ${utils.escapeHtml(criterionDisplayName())}">
      ${grid}
      <path d="${path}" fill="none" stroke="#123e6b" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>
      ${dots}
      ${labels}
    </svg>`;
  }

  function renderChart(groups) {
    if (!els.performanceChart) return;
    if (!groups.length) {
      const analysisMeta = perf().analysisMeta || {};
      const msg = analysisMeta.noTemporalSupport
        ? 'No reliable date/time-backed events match this filter yet. Day/date/time analytics need imported airing/report data or clean matched airings rows.'
        : 'No comparison groups match this filter yet.';
      els.performanceChart.innerHTML = `<div class="performance-chart-empty">${utils.escapeHtml(msg)}</div>`;
      return;
    }
    const chartType = effectiveChartType();
    const svg = chartType === 'line' ? buildLineSvg(groups) : buildBarSvg(groups);
    const note = chartType === 'line'
      ? '<div class="performance-chart-note">Line chart works best for date, day, or time because those labels have a natural order.</div>'
      : '<div class="performance-chart-note">Bar chart is the safer choice for categories like distributor, topic, break flags, and premium metadata.</div>';
    els.performanceChart.innerHTML = `${svg}${note}`;
  }

  function renderTable(groups) {
    if (!els.performanceTableBody) return;
    if (els.performanceTableGroupHeader) els.performanceTableGroupHeader.textContent = criterionDisplayName();
    if (!groups.length) {
      els.performanceTableBody.innerHTML = '<tr><td colspan="5" class="placeholder-row">No comparison groups match this filter yet.</td></tr>';
      return;
    }
    els.performanceTableBody.innerHTML = groups.map((group) => `
      <tr>
        <td>${utils.escapeHtml(group.label)}</td>
        <td>${utils.escapeHtml(utils.formatCount(group.airingCount))}</td>
        <td>${utils.escapeHtml(utils.formatMoney(group.totalDollars))}</td>
        <td>${utils.escapeHtml(utils.formatMoney(group.avgDollars))}</td>
        <td>${utils.escapeHtml(utils.formatCount(group.titleCount))}</td>
      </tr>
    `).join('');
  }

  function confidenceLabel() {
    const meta = perf().analysisMeta || {};
    if (meta.noTemporalSupport) return 'Unavailable until report/airing date data is imported';
    if (meta.lowConfidenceTemporal) return 'Low confidence';
    return 'Working comparison';
  }

  function buildCriteriaSummary(records) {
    const start = perf().startDate ? utils.formatDate(perf().startDate) : 'Earliest available';
    const end = perf().endDate ? utils.formatDate(perf().endDate) : 'Latest available';
    const month = perf().monthFilter === '' ? 'All months' : MONTH_NAMES[Number(perf().monthFilter)] || 'Unknown month';
    const topic = perf().topicFilter || 'All topics';
    const shape = perf().dataShape || {};
    const analysisMeta = perf().analysisMeta || {};
    const source = `Imported airings view · ${utils.formatCount(shape.airingRows || 0)} airings rows`;
    perf().criteriaSummary = [
      ['Date window', `${start} to ${end}`],
      ['Fundraiser month', month],
      ['Topic filter', topic],
      ['Compare by', criterionDisplayName()],
      ['Metric', metricLabel()],
      ['Chart', chartTypeLabel(effectiveChartType())],
      ['Confidence', confidenceLabel()],
      ['Source basis', source],
      ['Filtered rows', utils.formatCount(records.length)]
    ];
    if (!els.performanceCriteriaBar) return;
    els.performanceCriteriaBar.innerHTML = perf().criteriaSummary.map(([label, value]) => `
      <div class="performance-criteria-pill"><span class="label">${utils.escapeHtml(label)}</span><span>${utils.escapeHtml(value)}</span></div>
    `).join('');
    if (analysisMeta.excludedWeakTemporalCount && TEMPORAL_CRITERIA.has(perf().criterion)) {
      els.performanceCriteriaBar.innerHTML += `
        <div class="performance-criteria-pill warn"><span class="label">Excluded weak temporal rows</span><span>${utils.escapeHtml(utils.formatCount(analysisMeta.excludedWeakTemporalCount))}</span></div>
      `;
    }
  }

  function renderExplainTable(records, postFilter) {
    if (!els.performanceExplainBody) return;
    const meta = perf().analysisMeta || {};
    const rows = [
      ['Date window', perf().startDate || perf().endDate ? `${utils.formatDate(perf().startDate || perf().dataShape?.oldestDate || null, 'Earliest available')} to ${utils.formatDate(perf().endDate || perf().dataShape?.newestDate || null, 'Latest available')}` : 'All available dates', 'Only records whose usable date falls inside this window are included.'],
      ['Fundraiser month', perf().monthFilter === '' ? 'All months' : MONTH_NAMES[Number(perf().monthFilter)] || 'Unknown month', 'This cuts across years. “December” means every included row that lands in December.'],
      ['Topic filter', perf().topicFilter || 'All topics', 'Checks both primary and secondary topic text from the library where available.'],
      ['Compare by', criterionDisplayName(), `Each row in the comparison table is one ${criterionDisplayName().toLowerCase()} bucket.`],
      ['Metric', metricLabel(), perf().metric === 'avg_dollars' ? 'This is total dollars divided by the number of normalized events in the comparison group. It is safer than raw totals when sample sizes differ.' : perf().metric === 'total_dollars' ? 'This is raw dollars represented by the filtered events, so groups with more events can dominate.' : 'This is the count of normalized events used in the comparison.'],
      ['Source basis', 'Imported airings layer', `The app is reading ${utils.formatCount((perf().dataShape || {}).airingRows || 0)} imported airings rows. Fundraiser totals are derived later from those same rows instead of being stored a second time.`],
      ['Temporal confidence', confidenceLabel(), meta.noTemporalSupport ? 'Day/date/time comparisons do not have enough trustworthy airing-date evidence for this filter yet.' : meta.lowConfidenceTemporal ? 'There are some temporal matches, but the sample is small enough that the result can wobble.' : 'This comparison has enough temporal support to be usable, but still read the airing count.'],
      ['Premium metadata', 'Not actual viewer choice data', 'Premium comparisons currently mean “programs carrying premium metadata,” not which premium item viewers actually chose.'],
      ['How sturdy is this?', `${utils.formatCount(records.length)} rows from ${utils.formatCount(postFilter.length)} rows after non-label filters`, 'Small counts can make a result look dramatic while still being flimsy. Read the airing count next to every value.']
    ];
    els.performanceExplainBody.innerHTML = rows.map(([setting, value, read]) => `
      <tr>
        <td>${utils.escapeHtml(setting)}</td>
        <td>${utils.escapeHtml(String(value))}</td>
        <td>${utils.escapeHtml(read)}</td>
      </tr>
    `).join('');
  }

  function renderNotes(records, groups) {
    if (!els.performanceSourceNotes) return;
    const notes = [];
    const shape = perf().dataShape || {};
    const meta = perf().analysisMeta || {};
    notes.push(`Pledge Performance is normalizing ${utils.formatCount(shape.airingRows || 0)} imported airings rows into ${utils.formatCount(shape.normalizedEvents || 0)} comparison events.`);
    notes.push(`${utils.formatCount(shape.recordsWithDateTime || 0)} normalized events include a usable date. ${utils.formatCount(shape.recordsWithExplicitTime || 0)} include an explicit time.`);
    notes.push(`${utils.formatCount(shape.recordsWithTopic || 0)} events inherited topic metadata from the library. ${utils.formatCount(shape.fuzzyProgramMatches || 0)} rows needed a title fallback because NOLA was missing.`);
    notes.push('Average dollars per airing is the safest headline metric for comparisons like local breaks vs no local breaks because it reduces the distortion from unequal sample sizes.');
    notes.push('Premium analysis is metadata-only for now. It does not know which premium item viewers actually chose.');
    notes.push('Letter campaign pledges and online pledges are not wired into this performance layer yet, so they are not included in these totals.');
    if (meta.noTemporalSupport) notes.push('Day/date/time views are intentionally cautious now: weak unmatched rows are excluded, and if nothing trustworthy remains the comparison is marked unavailable instead of pretending to know.');
    if (perf().warnings?.length) notes.push(...perf().warnings);
    els.performanceSourceNotes.innerHTML = `
      <ul class="performance-note-list">
        ${notes.map((note) => `<li>${utils.escapeHtml(note)}</li>`).join('')}
      </ul>
      <div class="performance-footnote"><strong>Filtered scope:</strong> ${utils.escapeHtml(utils.formatCount(records.length))} events feeding ${utils.escapeHtml(utils.formatCount(groups.length))} comparison groups.</div>
    `;
  }

  function collectTopicOptions() {
    const labels = new Map();
    (state.rawRows || []).forEach((row) => {
      splitTopicTokens(derive.topicPrimary(row), derive.topicSecondary(row)).forEach((token) => {
        const key = utils.normalizeLookupKey(token);
        if (key && !labels.has(key)) labels.set(key, token);
      });
    });
    (perf().records || []).forEach((record) => {
      (record.topicTokens || []).forEach((token) => {
        const key = utils.normalizeLookupKey(token);
        if (key && !labels.has(key)) labels.set(key, token);
      });
    });
    return [...labels.values()].sort((a, b) => utils.compareText(a, b));
  }

  function populateControls() {
    renderSelectOptions(els.performanceTopicSelect, collectTopicOptions(), perf().topicFilter, 'All topics');
    if (els.performanceCriterionSelect) els.performanceCriterionSelect.value = perf().criterion;
    if (els.performanceMetricSelect) els.performanceMetricSelect.value = perf().metric;
    if (els.performanceChartTypeSelect) els.performanceChartTypeSelect.value = perf().chartType;
    if (els.performanceTopnSelect) els.performanceTopnSelect.value = String(perf().topN);
    if (els.performanceFilterInput) els.performanceFilterInput.value = perf().labelFilter || '';
    const oldestDate = perf().dataShape?.oldestDate || '';
    const newestDate = perf().dataShape?.newestDate || '';
    if (els.performanceStartDate) {
      els.performanceStartDate.min = oldestDate || '';
      els.performanceStartDate.max = newestDate || '';
      els.performanceStartDate.value = perf().startDate || oldestDate || '';
    }
    if (els.performanceEndDate) {
      els.performanceEndDate.min = oldestDate || '';
      els.performanceEndDate.max = newestDate || '';
      els.performanceEndDate.value = perf().endDate || newestDate || '';
    }
    if (els.performanceMonthSelect) els.performanceMonthSelect.value = perf().monthFilter;
    if (els.performanceTopicSelect) els.performanceTopicSelect.value = perf().topicFilter;
  }

  function renderAll() {
    if (!els.performanceChart || !els.performanceTableBody) return;
    populateControls();
    const { records, grouped, postFilter } = filterAndGroupRecords();
    renderStats(records);
    buildCriteriaSummary(records);
    renderExplainTable(records, postFilter);
    renderChart(perf().groups);
    renderTable(perf().groups);
    renderNotes(records, perf().groups);
    if (els.performanceChartTitle) els.performanceChartTitle.textContent = `${metricLabel()} by ${criterionDisplayName()}`;
    if (els.performanceChartPill) els.performanceChartPill.textContent = perf().ready ? `${chartTypeLabel(effectiveChartType())} · ${criterionDisplayName()}` : 'Awaiting data';
    if (els.performanceTablePill) els.performanceTablePill.textContent = `${utils.formatCount(perf().groups.length)} groups shown`;
    if (els.performanceNotesPill) els.performanceNotesPill.textContent = perf().lastLoadedAt ? `Loaded ${utils.formatDateTime(perf().lastLoadedAt)}` : 'Starter framework';
    const meta = perf().analysisMeta || {};
    const warn = meta.noTemporalSupport || meta.lowConfidenceTemporal || Boolean(perf().error);
    const tail = meta.noTemporalSupport
      ? 'Not enough trustworthy day/time evidence for this view yet.'
      : meta.lowConfidenceTemporal
        ? 'Small temporal sample — read it cautiously.'
        : `${utils.formatCount(records.length)} filtered rows.`;
    setStatus(`Comparing ${criterionDisplayName().toLowerCase()} using ${metricLabel().toLowerCase()}. ${tail}`, warn ? 'warn' : '');
  }

  async function refreshData(options = {}) {
    if (!state.client) return;
    perf().loading = true;
    perf().error = '';
    if (!options.silent) setStatus('Loading performance history…');
    try {
      const inputs = await App.data.fetchPerformanceInputs();
      buildPerformanceRecords(inputs);
      perf().ready = true;
      populateControls();
    } catch (error) {
      console.error(error);
      perf().ready = false;
      perf().records = [];
      perf().groups = [];
      perf().error = error?.message || 'Performance load failed.';
      setStatus(perf().error, 'warn');
      if (!options.silent) setNotice(perf().error, 'warn');
    } finally {
      perf().loading = false;
    }
  }

  async function ensureReady() {
    if (perf().loading) return;
    if (!perf().ready) await refreshData();
    renderAll();
  }

  function reset() {
    perf().ready = false;
    perf().records = [];
    perf().filteredRecords = [];
    perf().groups = [];
    perf().warnings = [];
    perf().lastLoadedAt = '';
    perf().analysisMeta = {};
  }

  function exportChartSvg() {
    const svg = els.performanceChart?.querySelector('svg');
    if (!svg) {
      setNotice('There is no chart to export yet.', 'warn');
      return;
    }
    const blob = new Blob([svg.outerHTML], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pledge-performance-${perf().criterion}-${effectiveChartType()}.svg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function bindEvents() {
    const rerender = () => renderAll();
    els.performanceCriterionSelect?.addEventListener('change', (event) => { perf().criterion = event.target.value || 'topic'; rerender(); });
    els.performanceMetricSelect?.addEventListener('change', (event) => { perf().metric = event.target.value || 'avg_dollars'; rerender(); });
    els.performanceChartTypeSelect?.addEventListener('change', (event) => { perf().chartType = event.target.value || 'auto'; rerender(); });
    els.performanceTopnSelect?.addEventListener('change', (event) => { perf().topN = Number(event.target.value || 12); rerender(); });
    els.performanceFilterInput?.addEventListener('input', (event) => { perf().labelFilter = event.target.value || ''; rerender(); });
    els.performanceStartDate?.addEventListener('change', (event) => { perf().startDate = event.target.value || ''; rerender(); });
    els.performanceEndDate?.addEventListener('change', (event) => { perf().endDate = event.target.value || ''; rerender(); });
    els.performanceMonthSelect?.addEventListener('change', (event) => { perf().monthFilter = event.target.value; rerender(); });
    els.performanceTopicSelect?.addEventListener('change', (event) => { perf().topicFilter = event.target.value || ''; rerender(); });
    els.performanceRefreshButton?.addEventListener('click', async () => { await refreshData(); renderAll(); });
    els.performanceExportButton?.addEventListener('click', exportChartSvg);
  }

  App.performanceUi = { ensureReady, refreshData, renderAll, bindEvents, reset, populateControls };
})();
