(() => {
  const App = window.PledgeLib;
  const { state, utils, derive } = App;
  const { els, setNotice, renderSelectOptions } = App.dom;

  const DATETIME_KEYS = ['aired_at', 'air_datetime', 'air_date', 'drive_date', 'broadcast_at', 'scheduled_at', 'date_time', 'datetime', 'airing_at', 'airing_date'];
  const TIME_ONLY_KEYS = ['air_time', 'time_of_day', 'scheduled_time', 'slot_time', 'airtime', 'broadcast_time'];
  const AIRING_MONEY_KEYS = ['dollars'];
  const AIRING_PLEDGE_KEYS = ['pledge_count', 'pledges'];
  const AIRING_SUSTAINER_KEYS = ['sustainer_count', 'sustainers'];
  const AIRING_MINUTES_KEYS = ['program_minutes', 'minutes'];
  const DRIVE_MONEY_KEYS = ['total_dollars', 'dollars'];
  const LOCAL_BREAK_KEYS = ['local_breaks', 'local_break_count', 'local_cutins_count', 'local_cutin_count', 'local_cutins', 'legacy_has_local_cutins_raw'];
  const LIVE_BREAK_KEYS = ['live_breaks', 'live_break_count', 'live_break_flag', 'live_break_notes', 'live_break_note'];
  const PREMIUM_KEYS = ['premium_summary', 'premiums', 'premium_notes', 'premium_offer', 'premium_description'];
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAY_ORDER = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const DAYPART_DEFS = [
    { key: 'overnight', label: 'Overnight / early morning', range: '12:00 AM–8:59 AM', startHour: 0, endHour: 9 },
    { key: 'daytime', label: 'Daytime', range: '9:00 AM–4:59 PM', startHour: 9, endHour: 17 },
    { key: 'early_evening', label: 'Early evening', range: '5:00 PM–6:59 PM', startHour: 17, endHour: 19 },
    { key: 'prime_time', label: 'Prime time', range: '7:00 PM–10:59 PM', startHour: 19, endHour: 23 },
    { key: 'late_night', label: 'Late night', range: '11:00 PM–11:59 PM', startHour: 23, endHour: 24 }
  ];
  const TEMPORAL_CRITERIA = new Set(['date', 'day', 'time', 'daypart', 'weekpart', 'topic_time', 'topic_dayset']);
  const MIN_SAMPLE_DEFAULT = 1;
  const MIN_SAMPLE_TOPIC_AVERAGE = 2;

  function perf() { return state.performance; }

  function broadcastDayStartHour() {
    const hour = Number(perf().broadcastDayStartHour);
    return Number.isFinite(hour) ? hour : 7;
  }

  function broadcastAnchorDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
    const shifted = new Date(date.getTime());
    if (shifted.getHours() < broadcastDayStartHour()) shifted.setDate(shifted.getDate() - 1);
    return shifted;
  }

  function recordFilterDate(record) {
    return record?.broadcastWhen instanceof Date && !Number.isNaN(record.broadcastWhen.getTime())
      ? record.broadcastWhen
      : (record?.when instanceof Date && !Number.isNaN(record.when.getTime()) ? record.when : null);
  }

  function scheduleDateKeyForRecord(record) {
    const date = record?.broadcastWhen instanceof Date && !Number.isNaN(record.broadcastWhen.getTime())
      ? record.broadcastWhen
      : (record?.when instanceof Date && !Number.isNaN(record.when.getTime()) ? record.when : null);
    return date ? localDateKey(date) : '';
  }

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

  function placementLiveBreakFlag(placement = {}) {
    const parsed = parseBooleanish(placement?.liveBreakFlag);
    if (parsed === true) return true;
    if (parsed === false) return false;
    const notesText = utils.normalizeText(placement?.liveBreakNotes || placement?.live_break_notes || placement?.liveBreakNote || '');
    return Boolean(notesText);
  }

  function parseTemporal(row) {
    const rawDateTime = candidateValue(row, DATETIME_KEYS, /(aired_?at|air_?date|drive_?date|date_?time|datetime|broadcast_?at|scheduled_?at|airing_?date)/i);
    const rawTimeOnly = candidateValue(row, TIME_ONLY_KEYS, /(air_?time|slot_?time|scheduled_?time|time_?of_?day|airtime|broadcast_?time)/i);
    const explicitAirDate = utils.normalizeText(utils.firstNonEmpty(row?.air_date, row?.broadcast_date, row?.date_key, row?.airing_date));
    const explicitAirTime = utils.normalizeText(rawTimeOnly);
    const out = {
      when: null,
      broadcastWhen: null,
      hasDate: false,
      hasExplicitTime: false,
      rawDateText: '',
      rawTimeText: ''
    };

    const applyLocalDateTime = (dateText, timeText = '') => {
      const parsedDate = utils.parseFlexibleDateInput(dateText);
      if (!parsedDate.valid || !parsedDate.iso) return false;
      out.rawDateText = parsedDate.iso;
      const normalizedTime = utils.normalizeText(timeText);
      if (normalizedTime) out.rawTimeText = normalizedTime;
      const timeMatch = normalizedTime.match(/^(\d{1,2})(?::?(\d{2}))?(?::?(\d{2}))?$/);
      const hour = timeMatch ? Number(timeMatch[1] || 0) : 12;
      const minute = timeMatch ? Number(timeMatch[2] || 0) : 0;
      const second = timeMatch ? Number(timeMatch[3] || 0) : 0;
      const [year, month, day] = parsedDate.iso.split('-').map((part) => Number(part));
      const local = new Date(year, month - 1, day, hour, minute, second || 0, 0);
      if (Number.isNaN(local.getTime())) return false;
      out.when = local;
      out.broadcastWhen = broadcastAnchorDate(local);
      out.hasDate = true;
      out.hasExplicitTime = Boolean(normalizedTime && timeMatch);
      return true;
    };

    if (explicitAirDate && applyLocalDateTime(explicitAirDate, explicitAirTime)) return out;

    if (!utils.isBlank(rawDateTime)) {
      const textValue = String(rawDateTime).trim();
      out.rawDateText = textValue;
      if (/^\d{4}-\d{2}-\d{2}$/.test(textValue) && applyLocalDateTime(textValue, explicitAirTime)) return out;
      const hasExplicitTime = /\d{1,2}:\d{2}/.test(textValue) || /T\d{2}:\d{2}/i.test(textValue);
      const parsed = new Date(textValue);
      if (!Number.isNaN(parsed.getTime())) {
        out.when = parsed;
        out.broadcastWhen = broadcastAnchorDate(parsed);
        out.hasDate = true;
        out.hasExplicitTime = hasExplicitTime;
        return out;
      }
    }

    if (!utils.isBlank(rawTimeOnly)) out.rawTimeText = String(rawTimeOnly).trim();
    return out;
  }

  function timeBucketLabel(record) {
    if (!record?.hasExplicitTime || !(record.when instanceof Date) || Number.isNaN(record.when.getTime())) return 'Unknown time';
    const minutes = (record.when.getHours() * 60) + record.when.getMinutes();
    const bucketMinutes = Math.floor(minutes / 30) * 30;
    return utils.minutesToLabel(bucketMinutes);
  }

  function hourBucketLabel(record) {
    if (!record?.hasExplicitTime || !(record.when instanceof Date) || Number.isNaN(record.when.getTime())) return 'Unknown hour';
    const minutes = record.when.getHours() * 60;
    return utils.minutesToLabel(minutes);
  }

  function topicTimeLabel(record) {
    const day = dayLabel(record);
    const hour = hourBucketLabel(record);
    if (day === 'Unknown day' || hour === 'Unknown hour') return 'Unknown topic time slot';
    return `${day} · ${hour}`;
  }

  function topicWeekSplitLabel(record) {
    const topic = record?.topicDisplay || record?.topic || 'Unassigned';
    const slice = daySetLabel(daySetKeyForRecord(record));
    if (!topic || slice === 'All week') return 'Unknown topic week split';
    return `${topic} · ${slice}`;
  }

  function topicTimeSortKey(record) {
    if (!record?.hasDate || !record?.hasExplicitTime || !(record.when instanceof Date) || Number.isNaN(record.when.getTime())) return Number.MAX_SAFE_INTEGER;
    const dayIndex = DAY_ORDER.indexOf(dayLabel(record));
    const hour = record.when.getHours();
    return ((dayIndex < 0 ? 99 : dayIndex) * 24) + hour;
  }

  function dayLabel(record) {
    const date = record?.broadcastWhen instanceof Date && !Number.isNaN(record.broadcastWhen.getTime())
      ? record.broadcastWhen
      : (record?.when instanceof Date && !Number.isNaN(record.when.getTime()) ? record.when : null);
    if (!record?.hasDate || !date) return 'Unknown day';
    return date.toLocaleDateString(undefined, { weekday: 'long' });
  }

  function dateLabel(record) {
    const date = record?.broadcastWhen instanceof Date && !Number.isNaN(record.broadcastWhen.getTime())
      ? record.broadcastWhen
      : (record?.when instanceof Date && !Number.isNaN(record.when.getTime()) ? record.when : null);
    if (!record?.hasDate || !date) return 'Unknown date';
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function formatRecordDateTime(record) {
    if (record?.hasDate && record?.hasExplicitTime && record?.when instanceof Date && !Number.isNaN(record.when.getTime())) {
      return record.when.toLocaleString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    }
    if (record?.hasDate) return dateLabel(record);
    return 'Unknown date';
  }

  function recordFundraiserLabel(record) {
    const firstSource = Array.isArray(record?.sampleSourceRows) ? (record.sampleSourceRows[0] || {}) : {};
    return utils.firstNonEmpty(firstSource.fundraiser_label, firstSource.drive_label, firstSource.fundraiser_name, firstSource.source_file_name, 'Unknown fundraiser');
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

  function primaryTopicFrom(programRow, row) {
    const direct = utils.normalizeText(programRow ? derive.topicPrimary(programRow) : utils.firstNonEmpty(row?.topic_primary, row?.topic, ''));
    return direct || 'Unassigned';
  }

  function programDisplay(programRow, row) {
    return utils.firstNonEmpty(programRow ? derive.title(programRow) : '', row?.program_title, row?.title, row?.name, 'Unknown title');
  }

  function weekpartLabel(record) {
    const day = dayLabel(record);
    if (day === 'Saturday' || day === 'Sunday') return 'Weekend';
    if (DAY_ORDER.includes(day)) return 'Weekday';
    return 'Unknown weekpart';
  }

  function daySetKeyForRecord(record) {
    const day = dayLabel(record);
    if (['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].includes(day)) return 'mon_fri';
    if (day === 'Saturday') return 'saturday';
    if (day === 'Sunday') return 'sunday';
    return '';
  }

  function daySetLabel(value) {
    switch (value) {
      case 'mon_fri': return 'Mon-Fri';
      case 'saturday': return 'Saturday';
      case 'sunday': return 'Sunday';
      case 'weekend': return 'Weekend';
      default: return 'All week';
    }
  }

  function localTodayKey() {
    return localDateKey(new Date());
  }

  function normalizedRightsEndValue(programRow) {
    if (!programRow) return '';
    const parsed = utils.parseFlexibleDateInput(derive.rightsEnd(programRow));
    if (parsed?.valid && parsed?.iso) return parsed.iso;
    const raw = utils.normalizeText(derive.rightsEnd(programRow));
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    return '';
  }

  function programIsExpired(programRow) {
    const rightsEnd = normalizedRightsEndValue(programRow);
    return Boolean(rightsEnd && rightsEnd < localTodayKey());
  }

  function recordIncludedByProgramScope(record) {
    if (perf().includeExpiredPrograms) return true;
    if (!record || record.isNonSpecific) return true;
    if (record.libraryProgramKnown) return Boolean(record.libraryProgramActive && !record.libraryRightsExpired);
    return true;
  }

  function matchesDaySet(record, value) {
    if (!value) return true;
    const key = daySetKeyForRecord(record);
    if (value === 'weekend') return key === 'saturday' || key === 'sunday';
    return key === value;
  }

  function daypartBaseLabel(record) {
    if (!record?.hasExplicitTime || !(record.when instanceof Date) || Number.isNaN(record.when.getTime())) return 'Unknown day-part';
    const hour = record.when.getHours();
    const found = DAYPART_DEFS.find((entry) => hour >= entry.startHour && hour < entry.endHour);
    return found ? found.label : 'Unknown day-part';
  }

  function daypartRangeForLabel(label) {
    const found = DAYPART_DEFS.find((entry) => entry.label === label);
    return found ? found.range : '';
  }

  function daypartLabel(record) {
    const label = daypartBaseLabel(record);
    if (label === 'Unknown day-part') return label;
    const range = daypartRangeForLabel(label);
    return range ? `${label} (${range})` : label;
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
    (rows || []).forEach((row) => {
      const id = utils.normalizeLookupKey(derive.programId(row));
      const nola = utils.normalizeLookupKey(derive.nola(row));
      const title = utils.normalizeLookupKey(derive.title(row));
      if (id && !byId.has(id)) byId.set(id, row);
      if (nola && !byNola.has(nola)) byNola.set(nola, row);
      if (title && !byTitle.has(title)) byTitle.set(title, row);
    });
    return { byId, byNola, byTitle };
  }

  function importedTitleLooksAnnotated(value) {
    const text = utils.normalizeText(value).toLowerCase();
    if (!text) return false;
    return /(break time|was off by|seconds?|timing note|runtime note|note)/i.test(text);
  }

  function resolveProgramIdentity(row, indexes) {
    const normalizedRow = utils.isNonSpecificRow(row || {}) ? utils.canonicalizeNonSpecificRow(row || {}) : (row || {});
    const importedTitle = utils.firstNonEmpty(normalizedRow?.imported_program_title, normalizedRow?.title, normalizedRow?.program_title, normalizedRow?.name, '');
    const matchedLibraryTitle = utils.firstNonEmpty(normalizedRow?.matched_library_title, '');
    if (utils.isNonSpecificRow(normalizedRow)) {
      return {
        programRow: null,
        matchSource: 'non_specific',
        trusted: true,
        importedTitle: utils.canonicalNonSpecificTitle(),
        matchedLibraryTitle: utils.canonicalNonSpecificTitle()
      };
    }
    const id = utils.normalizeLookupKey(utils.firstNonEmpty(normalizedRow?.program_id, normalizedRow?.pledge_program_id, normalizedRow?.id));
    if (id && indexes.byId.has(id)) {
      return { programRow: indexes.byId.get(id), matchSource: 'program_id', trusted: true, importedTitle, matchedLibraryTitle };
    }
    const nola = utils.normalizeLookupKey(utils.firstNonEmpty(normalizedRow?.nola_code, normalizedRow?.nola, normalizedRow?.program_nola));
    if (nola && indexes.byNola.has(nola)) {
      return { programRow: indexes.byNola.get(nola), matchSource: 'nola', trusted: true, importedTitle, matchedLibraryTitle };
    }
    const titleCandidates = [matchedLibraryTitle, utils.firstNonEmpty(normalizedRow?.title, normalizedRow?.program_title, normalizedRow?.name), importedTitle]
      .map((value) => utils.normalizeLookupKey(value))
      .filter(Boolean);
    for (const titleKey of titleCandidates) {
      if (indexes.byTitle.has(titleKey)) {
        return {
          programRow: indexes.byTitle.get(titleKey),
          matchSource: titleKey === utils.normalizeLookupKey(matchedLibraryTitle) && matchedLibraryTitle ? 'matched_library_title' : 'title_exact',
          trusted: true,
          importedTitle,
          matchedLibraryTitle
        };
      }
    }
    return {
      programRow: null,
      matchSource: utils.normalizeText(normalizedRow?.match_method) || 'unmatched',
      trusted: false,
      importedTitle,
      matchedLibraryTitle
    };
  }

  function resolveMoney(row, kind = 'airing') {
    const keys = kind === 'drive' ? DRIVE_MONEY_KEYS : AIRING_MONEY_KEYS;
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(row || {}, key)) {
        const amount = parseMoney(row?.[key]);
        if (amount != null) return { amount, source: key, trusted: true };
      }
    }
    return { amount: null, source: 'missing', trusted: false };
  }

  function resolveAggregateValue(row, keys = [], parser = parseInteger) {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(row || {}, key)) {
        const value = parser(row?.[key]);
        if (value != null) return value;
      }
    }
    return null;
  }

  function pushIntegrityFlag(record, flag) {
    if (!flag) return;
    if (!Array.isArray(record.integrityFlags)) record.integrityFlags = [];
    if (!record.integrityFlags.includes(flag)) record.integrityFlags.push(flag);
  }

  function localDateKey(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function signatureForProgram(programRow, fallback = {}) {
    const candidate = utils.isNonSpecificRow(programRow || {})
      ? utils.canonicalizeNonSpecificRow(programRow || {})
      : (utils.isNonSpecificRow(fallback || {}) ? utils.canonicalizeNonSpecificRow(fallback || {}) : (fallback || {}));
    if (utils.isNonSpecificRow(candidate)) return 'non_specific';
    return utils.normalizeLookupKey(
      utils.firstNonEmpty(
        programRow ? derive.programId(programRow) : '',
        candidate?.programId,
        candidate?.program_id,
        candidate?.pledge_program_id,
        programRow ? derive.nola(programRow) : '',
        candidate?.nola_code,
        candidate?.nola,
        programRow ? derive.title(programRow) : '',
        candidate?.programTitle,
        candidate?.program_title,
        candidate?.title,
        candidate?.name
      )
    );
  }

  function buildSchedulePlacementIndex(indexes) {
    const exact = new Map();
    const byDate = new Map();
    const coveredDates = new Set();
    const datesWithPlacements = new Set();
    const schedules = Array.isArray(state.schedules) ? state.schedules : [];
    const getProgramRowById = (programId) => {
      const key = String(programId || '');
      return [...(state.rawRows || []), ...(state.nonPledgeRows || [])]
        .find((row) => String(derive.programId(row)) === key) || null;
    };
    const push = (map, key, value) => {
      if (!key) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(value);
    };
    schedules.forEach((schedule) => {
      utils.datesBetween(utils.normalizeText(schedule?.startDate), utils.normalizeText(schedule?.endDate)).forEach((dateKey) => {
        if (dateKey) coveredDates.add(dateKey);
      });
      (schedule?.placements || []).forEach((placement) => {
        const programRow = getProgramRowById(placement.programId) || null;
        const signature = signatureForProgram(programRow, placement);
        const dateKey = String(placement.dateKey || '');
        const startMinutes = Number(placement.startMinutes || 0);
        const endMinutes = Number(placement.endMinutes || startMinutes);
        const liveBreak = placementLiveBreakFlag(placement);
        const entry = { scheduleId: schedule?.id || '', placementId: placement?.id || '', signature, dateKey, startMinutes, endMinutes, liveBreak, placement, programRow };
        if (dateKey) datesWithPlacements.add(dateKey);
        push(exact, `${signature}|${dateKey}|${startMinutes}`, entry);
        push(byDate, `${signature}|${dateKey}`, entry);
      });
    });
    return { exact, byDate, coveredDates, datesWithPlacements };
  }

  function scheduleLiveBreakLabelForRecord(record, placementIndex) {
    if (!(record?.when instanceof Date) || Number.isNaN(record.when.getTime()) || !record?.hasDate || !record?.hasExplicitTime) {
      return { label: 'Unknown / not matched to schedule', matched: false };
    }
    const signature = record.signature || signatureForProgram(null, record);
    if (!signature) return { label: 'Unknown / not matched to schedule', matched: false };
    const dateKey = scheduleDateKeyForRecord(record);
    const minutes = (record.when.getHours() * 60) + record.when.getMinutes();
    const exactMatches = placementIndex?.exact?.get(`${signature}|${dateKey}|${minutes}`) || [];
    if (exactMatches.length) {
      const live = exactMatches.some((item) => item.liveBreak);
      return { label: live ? 'Live break' : 'No live break', matched: true };
    }
    const dateMatches = placementIndex?.byDate?.get(`${signature}|${dateKey}`) || [];
    const overlapping = dateMatches.filter((item) => minutes >= item.startMinutes && minutes < item.endMinutes);
    if (overlapping.length) {
      const live = overlapping.some((item) => item.liveBreak);
      return { label: live ? 'Live break' : 'No live break', matched: true };
    }
    return { label: 'Unknown / not matched to schedule', matched: false };
  }


  function scheduleIntegrityForRecord(record, placementIndex) {
    if (isNonSpecificRecord(record)) {
      return {
        coveredBySchedule: false,
        shouldExclude: false,
        reason: 'non_specific_revenue',
        label: 'Non-specific fundraiser revenue'
      };
    }
    const dateKey = record?.hasDate ? scheduleDateKeyForRecord(record) : '';
    const coveredBySchedule = Boolean(dateKey && placementIndex?.coveredDates?.has(dateKey));
    if (!dateKey || !(record?.when instanceof Date) || Number.isNaN(record.when.getTime()) || !record?.hasExplicitTime) {
      return {
        coveredBySchedule,
        shouldExclude: false,
        reason: coveredBySchedule ? 'known_schedule_date_without_explicit_time' : 'no_explicit_time',
        label: coveredBySchedule ? 'Known schedule date, but row has no explicit time' : 'No explicit time to reconcile'
      };
    }
    const signature = record.signature || signatureForProgram(null, record);
    if (!signature) {
      return {
        coveredBySchedule,
        shouldExclude: coveredBySchedule,
        reason: coveredBySchedule ? 'known_schedule_date_without_signature' : 'no_signature',
        label: coveredBySchedule ? 'Inside a saved schedule window, but missing a trustworthy program signature' : 'Missing signature'
      };
    }
    const minutes = (record.when.getHours() * 60) + record.when.getMinutes();
    const exactMatches = placementIndex?.exact?.get(`${signature}|${dateKey}|${minutes}`) || [];
    if (exactMatches.length) {
      return { coveredBySchedule, shouldExclude: false, reason: 'schedule_exact', label: 'Matched to saved schedule exactly' };
    }
    const dateMatches = placementIndex?.byDate?.get(`${signature}|${dateKey}`) || [];
    const overlapping = dateMatches.filter((item) => minutes >= item.startMinutes && minutes < item.endMinutes);
    if (overlapping.length) {
      return { coveredBySchedule, shouldExclude: false, reason: 'schedule_overlap', label: 'Matched to saved schedule block' };
    }
    if (coveredBySchedule) {
      return {
        coveredBySchedule,
        shouldExclude: true,
        reason: 'known_schedule_date_not_reconciled',
        label: 'Inside a saved schedule window, but not reconciled to a scheduled placement'
      };
    }
    return { coveredBySchedule, shouldExclude: false, reason: 'outside_saved_schedules', label: 'Outside saved schedule windows' };
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
    let identityTrustedRows = 0;
    let weakIdentityRows = 0;
    let moneyTrustedRows = 0;
    let missingMoneyRows = 0;
    let annotatedTitleRows = 0;
    let scheduleMismatchRows = 0;

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
          pledges: 0,
          sustainers: 0,
          minutes: 0,
          driveRows: 0,
          airingRows: 0,
          matchedDriveRows: 0,
          estimatedOnly: false,
          when: null,
          broadcastWhen: null,
          hasDate: false,
          hasExplicitTime: false,
          programId: '',
          importedTitle: '',
          matchedLibraryTitle: '',
          title: 'Unknown title',
          topic: 'Unspecified topic',
          topicDisplay: 'Unspecified topic',
          topicTokens: [],
          distributor: 'Unspecified distributor',
          premiums: 'No premium metadata',
          localBreaks: 'No local breaks',
          liveBreaks: 'Unknown / not matched to schedule',
          liveBreakSource: 'schedule',
          scheduleMatched: false,
          scheduleCovered: false,
          scheduleIntegrityLabel: '',
          scheduleIntegrityReason: '',
          excludedForIntegrity: false,
          libraryProgramKnown: false,
          libraryProgramActive: true,
          libraryRightsEnd: '',
          libraryRightsExpired: false,
          nolaCode: '',
          signature: '',
          matchSource: 'unmatched',
          identityTrusted: false,
          moneyTrusted: false,
          moneySources: [],
          integrityFlags: [],
          runtimeMinutes: 0,
          titleAnnotated: false,
          isNonSpecific: false,
          approvedOverride: false,
          sourceFiles: new Set(),
          sourceRowHashes: new Set(),
          sampleSourceRows: []
        });
      }
      return events.get(id);
    }

    function applyMetadata(record, row, identity, temporal) {
      const programRow = identity?.programRow || null;
      record.programId = record.programId || (programRow ? derive.programId(programRow) : utils.firstNonEmpty(row?.program_id, row?.pledge_program_id, ''));
      record.nolaCode = record.nolaCode || (programRow ? derive.nola(programRow) : utils.firstNonEmpty(row?.nola_code, row?.nola, row?.program_nola, ''));
      record.signature = record.signature || signatureForProgram(programRow, row);
      record.importedTitle = record.importedTitle || utils.normalizeText(identity?.importedTitle || utils.firstNonEmpty(row?.imported_program_title, row?.title, row?.program_title, row?.name, ''));
      record.matchedLibraryTitle = record.matchedLibraryTitle || utils.normalizeText(identity?.matchedLibraryTitle || (programRow ? derive.title(programRow) : ''));
      record.matchSource = record.matchSource === 'unmatched' ? (identity?.matchSource || record.matchSource) : record.matchSource;
      record.identityTrusted = Boolean(record.identityTrusted || identity?.trusted);
      record.titleAnnotated = Boolean(record.titleAnnotated || importedTitleLooksAnnotated(record.importedTitle));
      record.isNonSpecific = Boolean(record.isNonSpecific || isNonSpecificRecord(row));
      record.approvedOverride = Boolean(record.approvedOverride || row?.approved_unlinked === true || String(row?.review_status || '').toLowerCase() === 'approved_unlinked');
      if (programRow) {
        record.libraryProgramKnown = true;
        record.libraryProgramActive = derive.isActive(programRow);
        record.libraryRightsEnd = record.libraryRightsEnd || normalizedRightsEndValue(programRow);
        record.libraryRightsExpired = Boolean(record.libraryRightsExpired || programIsExpired(programRow));
      }
      if (record.isNonSpecific) {
        record.importedTitle = utils.canonicalNonSpecificTitle();
        record.matchedLibraryTitle = utils.canonicalNonSpecificTitle();
        record.nolaCode = utils.canonicalNonSpecificNola();
        record.signature = 'non_specific';
      }
      if (row?.source_file_name) record.sourceFiles.add(String(row.source_file_name));
      if (record.isNonSpecific) {
        record.title = utils.canonicalNonSpecificTitle();
      } else if (record.identityTrusted && programRow) {
        record.title = derive.title(programRow);
      } else if (!record.title || record.title === 'Unknown title') {
        record.title = utils.firstNonEmpty(record.importedTitle, record.matchedLibraryTitle, row?.title, row?.program_title, row?.name, 'Unknown title');
      }
      const primaryTopic = record.identityTrusted && programRow
        ? primaryTopicFrom(programRow, row)
        : utils.normalizeText(utils.firstNonEmpty(row?.topic_primary, row?.topic, '')) || 'Unassigned';
      const topicTokens = primaryTopic && primaryTopic !== 'Unassigned' ? [primaryTopic] : [];
      if (!record.topicTokens.length && topicTokens.length) record.topicTokens = topicTokens;
      record.topicDisplay = record.topicTokens.length ? topicDisplayFromTokens(record.topicTokens) : primaryTopic;
      record.topic = record.topicDisplay || 'Unassigned';
      const distributor = record.identityTrusted && programRow
        ? derive.distributor(programRow)
        : utils.firstNonEmpty(row?.distributor, row?.distributor_name, 'Unspecified distributor');
      record.distributor = normalizeDistributor((!record.distributor || record.distributor === 'Unspecified distributor') ? distributor : record.distributor);
      record.premiums = record.premiums === 'No premium metadata' ? premiumLabel(row, programRow) : record.premiums;
      record.localBreaks = record.localBreaks === 'No local breaks' ? localBreakLabel(row, programRow) : record.localBreaks;
      const runtimeCandidate = Number(utils.firstNonEmpty(row?.program_minutes, row?.minutes, row?.runtime_minutes, row?.actual_runtime_minutes, (programRow ? derive.runtimeMinutes(programRow) : null)));
      if (Number.isFinite(runtimeCandidate) && runtimeCandidate > 0) {
        record.runtimeMinutes = Math.max(Number(record.runtimeMinutes) || 0, Math.round(runtimeCandidate));
      }
      if (!record.when && temporal?.when) record.when = temporal.when;
      if (!record.broadcastWhen && temporal?.broadcastWhen) record.broadcastWhen = temporal.broadcastWhen;
      if (temporal?.hasDate) record.hasDate = true;
      if (temporal?.hasExplicitTime) record.hasExplicitTime = true;
      record.day = dayLabel(record);
      record.date = dateLabel(record);
      record.time = timeBucketLabel(record);
      record.hour = hourBucketLabel(record);
      record.topicTime = topicTimeLabel(record);
      record.topicWeekSplit = topicWeekSplitLabel(record);
      record.topicTimeSortKey = topicTimeSortKey(record);
      const dateForMonth = record.broadcastWhen instanceof Date && !Number.isNaN(record.broadcastWhen.getTime()) ? record.broadcastWhen : record.when;
      record.monthIndex = record.hasDate && dateForMonth instanceof Date && !Number.isNaN(dateForMonth.getTime()) ? dateForMonth.getMonth() : null;
    }

    airingRows.forEach((sourceRow) => {
      const row = utils.isNonSpecificRow(sourceRow || {}) ? utils.canonicalizeNonSpecificRow(sourceRow || {}) : sourceRow;
      const identity = resolveProgramIdentity(row, indexes);
      if (identity.trusted) identityTrustedRows += 1;
      else weakIdentityRows += 1;
      if (importedTitleLooksAnnotated(identity.importedTitle)) annotatedTitleRows += 1;
      const temporal = parseTemporal(row);
      const signature = signatureForProgram(identity.programRow, row);
      const dateKey = temporal.hasDate ? localDateKey(temporal.when) : '';
      const timeKey = temporal.hasExplicitTime ? timeBucketLabel({ when: temporal.when, hasExplicitTime: true }) : 'unknown-time';
      const record = getOrCreate(signature || utils.makeId('perf-airing'), dateKey, timeKey);
      record.airingRows += 1;
      record.estimatedOnly = false;
      if (row?.row_hash) record.sourceRowHashes.add(String(row.row_hash));
      if (record.sampleSourceRows.length < 6) record.sampleSourceRows.push({ ...row });
      const money = resolveMoney(row, 'airing');
      if (money.trusted) {
        moneyTrustedRows += 1;
        record.amount += Number.isFinite(money.amount) ? money.amount : 0;
        record.moneyTrusted = true;
        if (!record.moneySources.includes(money.source)) record.moneySources.push(money.source);
      } else {
        missingMoneyRows += 1;
        pushIntegrityFlag(record, 'missing_explicit_dollars');
      }
      const pledges = resolveAggregateValue(row, AIRING_PLEDGE_KEYS);
      const sustainers = resolveAggregateValue(row, AIRING_SUSTAINER_KEYS);
      const minutes = resolveAggregateValue(row, AIRING_MINUTES_KEYS);
      record.pledges += Number.isFinite(pledges) ? pledges : 0;
      record.sustainers += Number.isFinite(sustainers) ? sustainers : 0;
      record.minutes += Number.isFinite(minutes) ? minutes : 0;
      applyMetadata(record, row, identity, temporal);
      if (!identity.trusted && !record.isNonSpecific) pushIntegrityFlag(record, 'weak_program_identity');
      if (record.titleAnnotated) pushIntegrityFlag(record, 'annotated_import_title');
      if (temporal.hasDate) {
        const exactKey = eventId(signature, dateKey, timeKey);
        exactAiringKeys.set(exactKey, record.id);
        const dateOnlyKey = [signature || 'unknown', dateKey || 'unknown-date'].join('|');
        if (!dateOnlyAiringKeys.has(dateOnlyKey)) dateOnlyAiringKeys.set(dateOnlyKey, []);
        dateOnlyAiringKeys.get(dateOnlyKey).push(record.id);
      }
    });

    driveRows.forEach((sourceRow, index) => {
      const row = utils.isNonSpecificRow(sourceRow || {}) ? utils.canonicalizeNonSpecificRow(sourceRow || {}) : sourceRow;
      const identity = resolveProgramIdentity(row, indexes);
      const temporal = parseTemporal(row);
      const signature = signatureForProgram(identity.programRow, row);
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
      const money = resolveMoney(row, 'drive');
      if (money.trusted) {
        record.amount += Number.isFinite(money.amount) ? money.amount : 0;
        record.moneyTrusted = true;
        if (!record.moneySources.includes(money.source)) record.moneySources.push(money.source);
      }
      record.driveRows += 1;
      applyMetadata(record, row, identity, temporal);
    });

    const placementIndex = buildSchedulePlacementIndex(indexes);
    for (const record of events.values()) {
      const scheduleLive = scheduleLiveBreakLabelForRecord(record, placementIndex);
      record.liveBreaks = scheduleLive.label;
      record.scheduleMatched = scheduleLive.matched;
      const integrity = scheduleIntegrityForRecord(record, placementIndex);
      record.scheduleCovered = integrity.coveredBySchedule;
      record.scheduleIntegrityLabel = integrity.label;
      record.scheduleIntegrityReason = integrity.reason;
      record.excludedForIntegrity = Boolean(integrity.shouldExclude);
      if (record.excludedForIntegrity) {
        scheduleMismatchRows += 1;
        pushIntegrityFlag(record, integrity.reason || 'schedule_not_reconciled');
      }
      if (!record.moneyTrusted) pushIntegrityFlag(record, 'money_not_trusted');
    }

    const records = [...events.values()].map((record) => ({
      ...record,
      amount: Number.isFinite(record.amount) ? record.amount : 0,
      pledges: Number.isFinite(record.pledges) ? record.pledges : 0,
      sustainers: Number.isFinite(record.sustainers) ? record.sustainers : 0,
      minutes: Number.isFinite(record.minutes) ? record.minutes : 0,
      topicDisplay: record.topicDisplay || 'Unspecified topic',
      topic: record.topicDisplay || 'Unspecified topic',
      time: timeBucketLabel(record),
      hour: hourBucketLabel(record),
      day: dayLabel(record),
      date: dateLabel(record),
      topicTime: topicTimeLabel(record),
      topicWeekSplit: topicWeekSplitLabel(record),
      topicTimeSortKey: topicTimeSortKey(record),
      moneySource: record.moneySources[0] || 'missing',
      sourceFiles: [...record.sourceFiles].sort((a, b) => utils.compareText(a, b)),
      sourceRowHashes: [...record.sourceRowHashes],
      sampleSourceRows: [...record.sampleSourceRows],
      approvedOverride: Boolean(record.approvedOverride)
    }));

    if (!driveRows.length && !airingRows.length) warnings.push('No drive-results or airings rows were available yet, so Pledge Performance has no records to compare.');
    if (!records.some((record) => record.topicTokens.length)) warnings.push('Topic matching is still sparse. Some performance rows do not inherit library topics cleanly yet.');
    if (records.length && !records.some((record) => record.scheduleMatched)) warnings.push('Live-break schedule matching is still sparse. Those labels may show as Unknown / not matched to schedule, but the rows still count in broad analytics.');
    if (scheduleMismatchRows) warnings.push(`${utils.formatCount(scheduleMismatchRows)} normalized events were quarantined because they fall inside a saved schedule window but do not reconcile to any scheduled placement.`);
    if (weakIdentityRows) warnings.push(`${utils.formatCount(weakIdentityRows)} imported airings rows had weak program identity and will not drive program/topic analytics unless they reconcile cleanly.`);

    const datedRecords = records
      .filter((record) => record.hasDate && recordFilterDate(record))
      .sort((a, b) => recordFilterDate(a).getTime() - recordFilterDate(b).getTime());
    const oldestDate = datedRecords.length ? localDateKey(recordFilterDate(datedRecords[0])) : '';
    const newestDate = datedRecords.length ? localDateKey(recordFilterDate(datedRecords[datedRecords.length - 1])) : '';

    perf().dataShape = {
      driveRows: driveRows.length,
      airingRows: airingRows.length,
      normalizedEvents: records.length,
      matchedDriveRows,
      unmatchedDriveRows,
      identityTrustedRows,
      weakIdentityRows,
      moneyTrustedRows,
      missingMoneyRows,
      annotatedTitleRows,
      scheduleMismatchRows,
      nonSpecificRows: records.filter((record) => isNonSpecificRecord(record)).length,
      quarantinedEvents: records.filter((record) => record.excludedForIntegrity).length,
      recordsWithMoney: records.filter((record) => record.moneyTrusted).length,
      recordsWithDateTime: records.filter((record) => record.hasDate && recordFilterDate(record)).length,
      recordsWithExplicitTime: records.filter((record) => record.hasExplicitTime).length,
      recordsWithTopic: records.filter((record) => record.topicTokens.length).length,
      totalPledges: records.reduce((sum, record) => sum + (Number(record.pledges || 0) || 0), 0),
      totalSustainers: records.reduce((sum, record) => sum + (Number(record.sustainers || 0) || 0), 0),
      totalMinutes: records.reduce((sum, record) => sum + (Number(record.minutes || 0) || 0), 0),
      recordsMatchedToSchedule: records.filter((record) => record.scheduleMatched).length,
      temporalEligibleDayDate: records.filter((record) => record.hasDate && !record.estimatedOnly && !record.excludedForIntegrity).length,
      temporalEligibleTime: records.filter((record) => record.hasExplicitTime && !record.estimatedOnly && !record.excludedForIntegrity).length,
      oldestDate,
      newestDate
    };
    if (!perf().startDate && oldestDate) perf().startDate = oldestDate;
    if (!perf().endDate && newestDate) perf().endDate = newestDate;
    if (typeof perf().useAllDates !== 'boolean') perf().useAllDates = false;
    perf().warnings = warnings;
    perf().records = records;
    perf().lastLoadedAt = new Date().toISOString();
  }

  function criterionDisplayName(criterion = perf().criterion) {
    switch (criterion) {
      case 'program': return 'Program';
      case 'date': return 'Date';
      case 'day': return 'Day of week';
      case 'daypart': return 'Day-part';
      case 'weekpart': return 'Weekend vs weekday';
      case 'time': return 'Time';
      case 'topic_time': return 'Topic time slot';
      case 'topic_dayset': return 'Topic week split';
      case 'topic': return 'Main topic';
      case 'local_breaks': return 'Local cut-ins';
      case 'live_breaks': return 'Live breaks';
      case 'premiums': return 'Premium metadata';
      case 'distributor': return 'Distributor';
      default: return 'Group';
    }
  }

  function criterionLabel(record, criterion) {
    switch (criterion) {
      case 'program': return isNonSpecificRecord(record) ? utils.canonicalNonSpecificTitle() : (record.title || 'Unknown title');
      case 'date': return record.date || 'Unknown date';
      case 'day': return record.day || 'Unknown day';
      case 'daypart': return daypartLabel(record);
      case 'weekpart': return weekpartLabel(record);
      case 'time': return record.time || 'Unknown time';
      case 'topic_time': return record.topicTime || 'Unknown topic time slot';
      case 'topic_dayset': return topicWeekSplitLabel(record);
      case 'topic': return record.topicDisplay || 'Unassigned';
      case 'local_breaks': return record.localBreaks || 'No local cut-ins';
      case 'live_breaks': return record.liveBreaks || 'Unknown / not matched to schedule';
      case 'premiums': return record.premiums || 'No premium metadata';
      case 'distributor': return record.distributor || 'Unspecified distributor';
      default: return 'Unknown';
    }
  }

  function criterionOrderKey(group, criterion) {
    if (criterion === 'date') return group.minTime || Number.MAX_SAFE_INTEGER;
    if (criterion === 'time') return group.minMinutes ?? Number.MAX_SAFE_INTEGER;
    if (criterion === 'day') return DAY_ORDER.indexOf(group.label);
    if (criterion === 'topic_time') return group.topicTimeSortKey ?? Number.MAX_SAFE_INTEGER;
    if (criterion === 'topic_dayset') return group.topicDaySetSortKey ?? Number.MAX_SAFE_INTEGER;
    if (criterion === 'weekpart') return group.label === 'Weekday' ? 0 : group.label === 'Weekend' ? 1 : 99;
    if (criterion === 'daypart') return [...DAYPART_DEFS.map((entry) => `${entry.label} (${entry.range})`), 'Unknown day-part'].indexOf(group.label);
    return group.label;
  }

  function metricLabel(metric = perf().metric) {
    switch (metric) {
      case 'total_dollars': return 'Total dollars';
      case 'airings': return 'Airing count';
      case 'avg_pledges': return 'Average pledges / airing';
      case 'total_pledges': return 'Total pledges';
      case 'avg_sustainers': return 'Average sustainers / airing';
      case 'total_sustainers': return 'Total sustainers';
      case 'dollars_per_pledge': return 'Dollars / pledge';
      case 'dollars_per_minute': return 'Dollars / minute';
      case 'pledges_per_minute': return 'Pledges / minute';
      case 'avg_dollars':
      default: return 'Average dollars / airing';
    }
  }

  function metricValue(group, metric = perf().metric) {
    switch (metric) {
      case 'total_dollars': return group.totalDollars;
      case 'airings': return group.airingCount;
      case 'avg_pledges': return group.avgPledges;
      case 'total_pledges': return group.totalPledges;
      case 'avg_sustainers': return group.avgSustainers;
      case 'total_sustainers': return group.totalSustainers;
      case 'dollars_per_pledge': return group.dollarsPerPledge;
      case 'dollars_per_minute': return group.dollarsPerMinute;
      case 'pledges_per_minute': return group.pledgesPerMinute;
      case 'avg_dollars':
      default: return group.avgDollars;
    }
  }

  function formatMetricValue(value, metric = perf().metric) {
    const num = Number(value);
    switch (metric) {
      case 'total_dollars':
      case 'avg_dollars':
      case 'dollars_per_pledge':
      case 'dollars_per_minute':
        return utils.formatMoney(num);
      case 'airings':
      case 'total_pledges':
      case 'total_sustainers':
        return utils.formatCount(Math.round(num || 0));
      case 'avg_pledges':
      case 'avg_sustainers':
      case 'pledges_per_minute':
        return Number.isFinite(num) ? num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 1 }) : '—';
      default:
        return Number.isFinite(num) ? String(num) : '—';
    }
  }

  function metricDisplay(group, options = {}) {
    const includeCount = !!options.includeCount;
    const metric = options.metric || perf().metric;
    let value;
    switch (metric) {
      case 'total_dollars':
        value = utils.formatMoney(group.totalDollars);
        break;
      case 'airings':
        value = utils.formatCount(group.airingCount);
        break;
      case 'avg_pledges':
        value = formatMetricValue(group.avgPledges, metric);
        break;
      case 'total_pledges':
        value = utils.formatCount(group.totalPledges);
        break;
      case 'avg_sustainers':
        value = formatMetricValue(group.avgSustainers, metric);
        break;
      case 'total_sustainers':
        value = utils.formatCount(group.totalSustainers);
        break;
      case 'dollars_per_pledge':
        value = group.totalPledges > 0 ? utils.formatMoney(group.dollarsPerPledge) : 'N/A';
        break;
      case 'dollars_per_minute':
        value = group.totalMinutes > 0 ? utils.formatMoney(group.dollarsPerMinute) : 'N/A';
        break;
      case 'pledges_per_minute':
        value = group.totalMinutes > 0 ? formatMetricValue(group.pledgesPerMinute, metric) : 'N/A';
        break;
      case 'avg_dollars':
      default:
        value = utils.formatMoney(group.avgDollars);
        break;
    }
    if (!includeCount || metric === 'airings') return value;
    return `${value} (${utils.formatCount(group.airingCount)})`;
  }


  function minSampleThreshold() {
    const criterion = perf().criterion;
    const metric = perf().metric;
    if ((criterion === 'topic' || criterion === 'topic_time' || criterion === 'topic_dayset') && ['avg_dollars', 'avg_pledges', 'avg_sustainers', 'dollars_per_pledge', 'dollars_per_minute', 'pledges_per_minute'].includes(metric)) return MIN_SAMPLE_TOPIC_AVERAGE;
    return MIN_SAMPLE_DEFAULT;
  }

  function confidenceForGroup(group) {
    const count = Number(group?.airingCount || 0);
    if (count >= 6) return 'High';
    if (count >= 3) return 'Medium';
    if (count >= 2) return 'Low';
    if (count >= 1) return 'Very low';
    return 'None';
  }

  function confidenceClassForGroup(group) {
    const label = confidenceForGroup(group).toLowerCase().replace(/\s+/g, '-');
    return `confidence-${label}`;
  }

  function minSampleExplanation() {
    const threshold = minSampleThreshold();
    if (threshold <= 1) return 'No minimum group-size warning is active for this comparison.';
    return `Average-based topic views flag groups with fewer than ${utils.formatCount(threshold)} airings so one-offs stay visible without pretending to be stable winners.`;
  }
  function chartTypeLabel(type) {
    switch (type) {
      case 'line': return 'Line chart';
      case 'split_line': return 'Split-line chart';
      case 'heatmap': return 'Heatmap';
      case 'bar': return 'Bar chart';
      default: return 'Auto';
    }
  }

  function isLineFriendly(criterion) {
    return ['date', 'day', 'time', 'daypart', 'weekpart'].includes(criterion);
  }

  function effectiveChartType() {
    if (perf().criterion === 'topic_time' || perf().criterion === 'topic_dayset') return 'heatmap';
    if (perf().chartType === 'auto') return perf().criterion === 'daypart' ? 'split_line' : (isLineFriendly(perf().criterion) ? 'line' : 'bar');
    if (perf().chartType === 'line' && !isLineFriendly(perf().criterion)) return 'bar';
    if ((perf().chartType === 'split_line' || perf().chartType === 'heatmap') && !['daypart', 'topic_time', 'topic_dayset'].includes(perf().criterion)) {
      return isLineFriendly(perf().criterion) ? 'line' : 'bar';
    }
    return perf().chartType;
  }

  function isNonSpecificRecord(record) {
    return utils.isNonSpecificRow(record);
  }

  function temporalEligibility(record, criterion) {
    if (criterion === 'time') return record.hasExplicitTime && !record.estimatedOnly;
    if (criterion === 'topic_time') return record.hasDate && record.hasExplicitTime && !record.estimatedOnly;
    if (criterion === 'topic_dayset') return record.hasDate && !record.estimatedOnly;
    if (criterion === 'date' || criterion === 'day') return record.hasDate && !record.estimatedOnly;
    return true;
  }

  function integrityEligible(record, criterion) {
    if (record?.approvedOverride) return true;
    if (!record?.moneyTrusted) return false;
    const needsTrustedIdentity = criterion === 'program' || criterion === 'topic' || criterion === 'topic_time' || criterion === 'topic_dayset';
    const needsMainTopic = criterion === 'topic' || criterion === 'topic_time' || criterion === 'topic_dayset';
    if (needsTrustedIdentity && !record?.identityTrusted) return false;
    if (needsMainTopic && !(record?.topicTokens || []).length) return false;
    return true;
  }


  function exclusionReasons(record, criterion) {
    const reasons = [];
    if (!record?.moneyTrusted) reasons.push('Missing trusted dollars');
    if ((criterion === 'program' || criterion === 'topic' || criterion === 'topic_time' || criterion === 'topic_dayset') && !record?.identityTrusted) reasons.push('Weak program identity');
    if ((criterion === 'topic' || criterion === 'topic_time' || criterion === 'topic_dayset') && !(record?.topicTokens || []).length) reasons.push('Missing main topic');
    return [...new Set(reasons.filter(Boolean))];
  }

  function buildExcludedReviewRows(scopedRecords, criterion) {
    return (scopedRecords || [])
      .filter((record) => !isNonSpecificRecord(record) && !record?.approvedOverride && !integrityEligible(record, criterion))
      .map((record, index) => {
        const sample = Array.isArray(record.sampleSourceRows) ? record.sampleSourceRows.filter(Boolean) : [];
        const first = sample[0] || {};
        const rowHashes = Array.isArray(record.sourceRowHashes) ? record.sourceRowHashes.filter(Boolean) : [];
        const reasons = exclusionReasons(record, criterion);
        return {
          id: record.id || `suspect-${index}`,
          row_hashes: rowHashes,
          imported_program_title: record.importedTitle || record.title || first.imported_program_title || first.title || 'Untitled imported row',
          matched_library_title: record.matchedLibraryTitle || first.matched_library_title || '',
          nola_code: record.nolaCode || first.nola_code || first.nola || '',
          air_date: first.air_date || record.date || '',
          air_time: first.air_time || (record.hasExplicitTime && record.when instanceof Date ? utils.formatTime(record.when) : ''),
          dollars: Number.isFinite(record.amount) ? record.amount : Number(first.dollars || 0) || 0,
          reason_text: reasons.join(' · ') || 'Excluded by analytics integrity rules',
          source_file_name: (record.sourceFiles || [])[0] || first.source_file_name || '',
          sample_source_rows: sample,
          raw: first,
          program_id: record.programId || first.program_id || first.pledge_program_id || null,
          pending_link_program_id: ''
        };
      });
  }

  function filterAndGroupRecords() {
    const labelFilter = utils.normalizeLookupKey(perf().labelFilter || '');
    const startDate = perf().useAllDates ? null : (perf().startDate ? new Date(`${perf().startDate}T00:00:00`) : null);
    const endDate = perf().useAllDates ? null : (perf().endDate ? new Date(`${perf().endDate}T23:59:59`) : null);
    const criterion = perf().criterion;
    const sourceRecords = perf().records || [];
    const selectedProgramKey = utils.normalizeLookupKey(perf().programFilter || '');
    const scopedRecords = sourceRecords.filter((record) => {
      if (perf().monthFilter !== '' && record.monthIndex !== Number(perf().monthFilter)) return false;
      if (perf().topicFilter && !topicMatches(record, perf().topicFilter)) return false;
      if (selectedProgramKey && utils.normalizeLookupKey(record.programId || record.nolaCode || record.title) !== selectedProgramKey) return false;
      if (perf().daySetFilter && !matchesDaySet(record, perf().daySetFilter)) return false;
      if (perf().daypartScope && daypartBaseLabel(record) !== perf().daypartScope) return false;
      if (perf().weekpartScope && weekpartLabel(record) !== perf().weekpartScope) return false;
      const filterDate = recordFilterDate(record);
      if (startDate && (!filterDate || filterDate < startDate)) return false;
      if (endDate && (!filterDate || filterDate > endDate)) return false;
      if (!recordIncludedByProgramScope(record)) return false;
      return true;
    });

    const analyticsScopedRecords = scopedRecords.filter((record) => !isNonSpecificRecord(record));
    const integrityFiltered = analyticsScopedRecords.filter((record) => integrityEligible(record, criterion));
    const eligibleTemporal = TEMPORAL_CRITERIA.has(criterion)
      ? integrityFiltered.filter((record) => temporalEligibility(record, criterion))
      : integrityFiltered;

    const records = eligibleTemporal.filter((record) => {
      if (labelFilter && !utils.normalizeLookupKey(criterionLabel(record, criterion)).includes(labelFilter)) return false;
      return true;
    });

    const groups = new Map();
    records.forEach((record) => {
      const label = criterionLabel(record, criterion);
      if (!groups.has(label)) {
        groups.set(label, {
          label,
          airingCount: 0,
          totalDollars: 0,
          totalPledges: 0,
          totalSustainers: 0,
          totalMinutes: 0,
          moneyCount: 0,
          avgDollars: 0,
          avgPledges: 0,
          avgSustainers: 0,
          dollarsPerPledge: 0,
          dollarsPerMinute: 0,
          pledgesPerMinute: 0,
          titles: new Set(),
          programIds: new Set(),
          minTime: null,
          minMinutes: null,
          topicTimeSortKey: null,
          topicDaySetSortKey: null,
          dayIndex: null,
          hourOfDay: null
        });
      }
      const group = groups.get(label);
      group.airingCount += 1;
      group.totalDollars += Number.isFinite(record.amount) ? record.amount : 0;
      group.totalPledges += Number.isFinite(record.pledges) ? record.pledges : 0;
      group.totalSustainers += Number.isFinite(record.sustainers) ? record.sustainers : 0;
      group.totalMinutes += Number.isFinite(record.minutes) ? record.minutes : 0;
      group.moneyCount += 1;
      group.titles.add(record.title || 'Unknown title');
      if (record.programId) group.programIds.add(String(record.programId));
      if (Number.isFinite(record.topicTimeSortKey)) {
        group.topicTimeSortKey = group.topicTimeSortKey == null ? record.topicTimeSortKey : Math.min(group.topicTimeSortKey, record.topicTimeSortKey);
      }
      const topicDaySetOrder = ['Mon-Fri', 'Saturday', 'Sunday'];
      const slice = daySetLabel(daySetKeyForRecord(record));
      const sliceIndex = topicDaySetOrder.indexOf(slice);
      if (sliceIndex >= 0) group.topicDaySetSortKey = group.topicDaySetSortKey == null ? sliceIndex : Math.min(group.topicDaySetSortKey, sliceIndex);
      if (record.when instanceof Date && !Number.isNaN(record.when.getTime())) {
        const filterDate = recordFilterDate(record) || record.when;
        const ts = filterDate.getTime();
        group.minTime = group.minTime == null ? ts : Math.min(group.minTime, ts);
        const minutes = (record.when.getHours() * 60) + record.when.getMinutes();
        group.minMinutes = group.minMinutes == null ? minutes : Math.min(group.minMinutes, minutes);
        const dayIndex = DAY_ORDER.indexOf(dayLabel(record));
        if (dayIndex >= 0) group.dayIndex = group.dayIndex == null ? dayIndex : Math.min(group.dayIndex, dayIndex);
        group.hourOfDay = group.hourOfDay == null ? record.when.getHours() : Math.min(group.hourOfDay, record.when.getHours());
      }
    });

    const minGroupAirings = minSampleThreshold();
    const grouped = [...groups.values()].map((group) => ({
      ...group,
      avgDollars: group.airingCount ? group.totalDollars / group.airingCount : 0,
      avgPledges: group.airingCount ? group.totalPledges / group.airingCount : 0,
      avgSustainers: group.airingCount ? group.totalSustainers / group.airingCount : 0,
      dollarsPerPledge: group.totalPledges > 0 ? group.totalDollars / group.totalPledges : 0,
      dollarsPerMinute: group.totalMinutes > 0 ? group.totalDollars / group.totalMinutes : 0,
      pledgesPerMinute: group.totalMinutes > 0 ? group.totalPledges / group.totalMinutes : 0,
      titleCount: group.titles.size,
      titles: [...group.titles].sort((a, b) => utils.compareText(a, b)),
      programOpenId: group.programIds.size === 1 ? [...group.programIds][0] : '',
      belowSampleThreshold: minGroupAirings > 1 && group.airingCount < minGroupAirings
    }));

    let sorted = grouped.sort((a, b) => {
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

    if (perf().quickFilter === 'live_break_impact') {
      const order = { 'Live break': 0, 'No live break': 1 };
      sorted = sorted
        .filter((group) => ['Live break', 'No live break'].includes(group.label))
        .sort((a, b) => {
          const aOrder = order[a.label] ?? 99;
          const bOrder = order[b.label] ?? 99;
          if (aOrder !== bOrder) return aOrder - bOrder;
          return utils.compareText(a.label, b.label);
        });
    }
    if (perf().quickFilter === 'repeat_fatigue') {
      sorted = sorted.filter((group) => group.airingCount >= 2);
    }

    const usesTemporalAxis = TEMPORAL_CRITERIA.has(criterion);
    const limit = Math.max(1, Number(perf().topN) || 12);
    const limited = usesTemporalAxis ? sorted : (limit >= 999 ? sorted : sorted.slice(0, limit));
    perf().filteredRecords = records;
    perf().scopedRecords = analyticsScopedRecords;
    perf().groups = limited;
    const nonSpecificScoped = scopedRecords.filter((record) => isNonSpecificRecord(record));
    perf().excludedReviewRows = buildExcludedReviewRows(analyticsScopedRecords, criterion);
    perf().analysisMeta = {
      minGroupAirings,
      hiddenSmallSampleGroupCount: 0,
      lowSampleGroupCount: grouped.filter((group) => group.belowSampleThreshold).length,
      criterion,
      postFilterCount: scopedRecords.length,
      integrityEligibleCount: integrityFiltered.length,
      eligibleTemporalCount: eligibleTemporal.length,
      excludedWeakTemporalCount: Math.max(0, integrityFiltered.length - eligibleTemporal.length),
      excludedIntegrityCount: analyticsScopedRecords.filter((record) => !integrityEligible(record, criterion)).length,
      excludedScheduleMismatchCount: analyticsScopedRecords.filter((record) => record.excludedForIntegrity).length,
      excludedWeakIdentityCount: analyticsScopedRecords.filter((record) => !record.identityTrusted).length,
      excludedMissingMoneyCount: analyticsScopedRecords.filter((record) => !record.moneyTrusted).length,
      excludedMissingTopicCount: analyticsScopedRecords.filter((record) => !(record.topicTokens || []).length).length,
      nonSpecificRevenueCount: nonSpecificScoped.length,
      activeProgramScope: perf().includeExpiredPrograms ? 'all_programming' : 'active_only',
      scopedExpiredProgramCount: scopedRecords.filter((record) => record.libraryProgramKnown && (!record.libraryProgramActive || record.libraryRightsExpired)).length,
      lowConfidenceTemporal: TEMPORAL_CRITERIA.has(criterion) && eligibleTemporal.length > 0 && eligibleTemporal.length < 12,
      noTemporalSupport: TEMPORAL_CRITERIA.has(criterion) && eligibleTemporal.length === 0 && integrityFiltered.length > 0
    };
    return { records, grouped: limited, postFilter: scopedRecords, integrityFiltered };
  }

  function renderStats(records) {
    if (!els.performanceStatGrid) return;
    const programs = new Set(records.map((record) => utils.normalizeLookupKey(utils.firstNonEmpty(record.programId, record.nolaCode, record.title))).filter(Boolean));
    const dollars = records.reduce((sum, record) => sum + (Number.isFinite(record.amount) ? record.amount : 0), 0);
    const pledges = records.reduce((sum, record) => sum + (Number(record.pledges || 0) || 0), 0);
    const sustainers = records.reduce((sum, record) => sum + (Number(record.sustainers || 0) || 0), 0);
    const stats = [
      ['Airings used', utils.formatCount(records.length)],
      ['Programs represented', utils.formatCount(programs.size)],
      ['Dollars represented', utils.formatMoney(dollars)],
      ['Pledges / sustainers', `${utils.formatCount(pledges)} / ${utils.formatCount(sustainers)}`]
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
    const height = 380;
    const left = 56;
    const right = 18;
    const top = 20;
    const bottom = 116;
    const chartW = width - left - right;
    const chartH = height - top - bottom;
    const max = Math.max(...groups.map((group) => metricValue(group)), 1);
    const colW = chartW / Math.max(groups.length, 1);
    const barW = Math.max(12, Math.min(56, colW * 0.65));
    const ticks = [0, .25, .5, .75, 1].map((ratio) => ({ y: top + chartH - (ratio * chartH), value: max * ratio }));
    const grid = ticks.map((tick) => `
      <line x1="${left}" y1="${tick.y}" x2="${left + chartW}" y2="${tick.y}" stroke="#dce8f6" stroke-width="1"></line>
      <text x="${left - 8}" y="${tick.y + 4}" font-size="11" text-anchor="end" fill="#526174">${utils.escapeHtml(formatMetricValue(tick.value))}</text>
    `).join('');
    const bars = groups.map((group, index) => {
      const value = metricValue(group);
      const h = Math.max(2, Math.round((value / max) * chartH));
      const x = left + (index * colW) + ((colW - barW) / 2);
      const y = top + chartH - h;
      const display = metricDisplay(group, { includeCount: true });
      const label = String(group.label || '').length > 16 ? `${String(group.label).slice(0, 13)}…` : String(group.label || '');
      const title = `${group.label}: ${display} · ${utils.formatCount(group.titleCount)} titles${group.belowSampleThreshold ? ' · Low sample' : ''}`;
      const labelNode = perf().criterion === 'program' && group.programOpenId
        ? `<g class="svg-program-link" data-program-open-id="${utils.escapeHtml(group.programOpenId)}" tabindex="0" role="button" aria-label="${utils.escapeHtml(`Open details for ${group.label}`)}"><text x="${x + barW / 2}" y="${top + chartH + 16}" font-size="11" text-anchor="end" transform="rotate(-35 ${x + barW / 2} ${top + chartH + 16})" fill="#14314f">${utils.escapeHtml(label)}</text></g>`
        : `<text x="${x + barW / 2}" y="${top + chartH + 16}" font-size="11" text-anchor="end" transform="rotate(-35 ${x + barW / 2} ${top + chartH + 16})" fill="#14314f">${utils.escapeHtml(label)}</text>`;
      return `
        <g class="performance-drill-trigger" data-performance-drill-key="${utils.escapeHtml(group.label || '')}" tabindex="0" role="button" aria-label="${utils.escapeHtml(`Inspect ${group.label}`)}">\n        <rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="6" fill="${group.belowSampleThreshold ? '#6f879f' : '#123e6b'}"><title>${utils.escapeHtml(title)}</title></rect>\n        <text x="${x + barW / 2}" y="${y - 8}" font-size="11" text-anchor="middle" fill="#183a5f">${utils.escapeHtml(display)}</text>\n        </g>\n        ${labelNode}
      `;
    }).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${utils.escapeHtml(metricLabel())} by ${utils.escapeHtml(criterionDisplayName())}">${grid}${bars}</svg>`;
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
      return { x, y, label: group.label, value: metricValue(group), group };
    });
    const path = points.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({ y: top + chartH - (ratio * chartH), value: max * ratio }));
    const labels = points.map((point) => {
      if (perf().criterion === 'program' && point.group.programOpenId) {
        return `<g class="svg-program-link" data-program-open-id="${utils.escapeHtml(point.group.programOpenId)}" tabindex="0" role="button" aria-label="${utils.escapeHtml(`Open details for ${point.label}`)}"><text x="${point.x}" y="${height - 18}" font-size="11" text-anchor="middle" fill="#526174">${utils.escapeHtml(point.label)}</text></g>`;
      }
      return `<text x="${point.x}" y="${height - 18}" font-size="11" text-anchor="middle" fill="#526174">${utils.escapeHtml(point.label)}</text>`;
    }).join('');
    const dots = points.map((point) => `
      <g class="performance-drill-trigger" data-performance-drill-key="${utils.escapeHtml(point.group.label || '')}" tabindex="0" role="button" aria-label="${utils.escapeHtml(`Inspect ${point.label}`)}">\n      <circle cx="${point.x}" cy="${point.y}" r="4" fill="${point.group.belowSampleThreshold ? '#6f879f' : '#123e6b'}"><title>${utils.escapeHtml(`${point.label}: ${metricDisplay(point.group, { includeCount: true })} · ${utils.formatCount(point.group.titleCount)} titles${point.group.belowSampleThreshold ? ' · Low sample' : ''}`)}</title></circle>\n      <text x="${point.x}" y="${point.y - 10}" font-size="11" text-anchor="middle" fill="#173a5e">${utils.escapeHtml(metricDisplay(point.group, { includeCount: true }))}</text>\n      </g>
    `).join('');
    const grid = yTicks.map((tick) => `
      <line x1="${left}" y1="${tick.y}" x2="${left + chartW}" y2="${tick.y}" stroke="#dce8f6" stroke-width="1"></line>
      <text x="${left - 8}" y="${tick.y + 4}" font-size="11" text-anchor="end" fill="#526174">${utils.escapeHtml(formatMetricValue(tick.value))}</text>
    `).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${utils.escapeHtml(metricLabel())} by ${utils.escapeHtml(criterionDisplayName())}">
      ${grid}
      <path d="${path}" fill="none" stroke="#123e6b" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>
      ${dots}
      ${labels}
    </svg>`;
  }

  function buildTopicTimeHeatmap(groups) {
    const ordered = [...groups]
      .filter((group) => Number.isFinite(group.dayIndex) && Number.isFinite(group.hourOfDay))
      .sort((a, b) => {
        const aKey = (groupKey => ((groupKey.dayIndex ?? 99) * 24) + (groupKey.hourOfDay ?? 99))(a);
        const bKey = (groupKey => ((groupKey.dayIndex ?? 99) * 24) + (groupKey.hourOfDay ?? 99))(b);
        return aKey - bKey;
      });
    if (!ordered.length) {
      return '<div class="performance-chart-empty">Topic Time Performance needs rows with both a real air date and a real air time.</div>';
    }
    const hourSet = new Set(ordered.map((group) => group.hourOfDay));
    const hours = [...hourSet].sort((a, b) => a - b);
    const matrix = new Map();
    ordered.forEach((group) => {
      matrix.set(`${group.dayIndex}|${group.hourOfDay}`, group);
    });
    const maxMetric = Math.max(...ordered.map((group) => metricValue(group)), 1);
    const header = hours.map((hour) => `<div class="topic-time-header-cell">${utils.escapeHtml(utils.minutesToLabel(hour * 60))}</div>`).join('');
    const rows = DAY_ORDER.map((day, dayIndex) => {
      const cells = hours.map((hour) => {
        const group = matrix.get(`${dayIndex}|${hour}`) || null;
        if (!group) return '<div class="topic-time-cell empty">—</div>';
        const intensity = Math.max(0.12, Math.min(0.92, metricValue(group) / maxMetric));
        const alpha = intensity.toFixed(3);
        const title = `${group.label}: ${metricDisplay(group, { includeCount: true })}${group.belowSampleThreshold ? ' · Low sample' : ''}`;
        const cellClass = group.belowSampleThreshold ? 'topic-time-cell low-sample' : 'topic-time-cell';
        return `<button type="button" class="${cellClass} slot-drill-trigger${perf().slotDrillKey === group.label ? ' active-drill' : ''}" data-performance-drill-key="${utils.escapeHtml(group.label)}" style="background: rgba(18, 62, 107, ${alpha});" title="${utils.escapeHtml(title)}"><span>${utils.escapeHtml(metricDisplay(group))}</span><small>${utils.escapeHtml(utils.formatCount(group.airingCount))}${group.belowSampleThreshold ? ' · low sample' : ''}</small></button>`;
      }).join('');
      return `<div class="topic-time-row"><div class="topic-time-day">${utils.escapeHtml(day)}</div>${cells}</div>`;
    }).join('');
    return `
      <div class="topic-time-heatmap-wrap">
        <div class="topic-time-header"><div class="topic-time-corner">Day / hour</div>${header}</div>
        <div class="topic-time-grid">${rows}</div>
      </div>
      <div class="performance-chart-note">Each filled cell is one day-and-hour slot for the current topic filter. Darker cells indicate stronger ${utils.escapeHtml(metricLabel().toLowerCase())}.</div>
    `;
  }

  function aggregateMetricCell(target, record) {
    target.airingCount += 1;
    target.totalDollars += Number.isFinite(record.amount) ? record.amount : 0;
    target.totalPledges += Number.isFinite(record.pledges) ? record.pledges : 0;
    target.totalSustainers += Number.isFinite(record.sustainers) ? record.sustainers : 0;
    target.totalMinutes += Number.isFinite(record.minutes) ? record.minutes : 0;
  }

  function finalizeMetricCell(cell) {
    return {
      ...cell,
      avgDollars: cell.airingCount ? (cell.totalDollars / cell.airingCount) : 0,
      avgPledges: cell.airingCount ? (cell.totalPledges / cell.airingCount) : 0,
      avgSustainers: cell.airingCount ? (cell.totalSustainers / cell.airingCount) : 0,
      dollarsPerPledge: cell.totalPledges > 0 ? (cell.totalDollars / cell.totalPledges) : 0,
      dollarsPerMinute: cell.totalMinutes > 0 ? (cell.totalDollars / cell.totalMinutes) : 0,
      pledgesPerMinute: cell.totalMinutes > 0 ? (cell.totalPledges / cell.totalMinutes) : 0
    };
  }

  function emptyMetricCell(label = '') {
    return { label, airingCount: 0, totalDollars: 0, totalPledges: 0, totalSustainers: 0, totalMinutes: 0, avgDollars: 0, avgPledges: 0, avgSustainers: 0, dollarsPerPledge: 0, dollarsPerMinute: 0, pledgesPerMinute: 0 };
  }

  function buildDaypartDaySetGroups(records) {
    const rowDefs = perf().daySetFilter
      ? [{ key: perf().daySetFilter, label: daySetLabel(perf().daySetFilter) }]
      : [
          { key: 'mon_fri', label: 'Mon-Fri' },
          { key: 'saturday', label: 'Saturday' },
          { key: 'sunday', label: 'Sunday' }
        ];
    const matrix = new Map();
    const bucketOrder = DAYPART_DEFS.map((entry) => `${entry.label} (${entry.range})`);
    (records || []).forEach((record) => {
      if (!record?.moneyTrusted || record?.excludedForIntegrity) return;
      if (!record?.hasDate || !record?.hasExplicitTime || record?.estimatedOnly) return;
      const rowKey = perf().daySetFilter ? perf().daySetFilter : daySetKeyForRecord(record);
      if (!rowDefs.some((entry) => entry.key === rowKey)) return;
      const bucket = daypartLabel(record);
      if (bucket === 'Unknown day-part') return;
      const key = `${rowKey}|${bucket}`;
      if (!matrix.has(key)) matrix.set(key, emptyMetricCell(bucket));
      aggregateMetricCell(matrix.get(key), record);
    });
    const rows = rowDefs.map((row) => ({
      key: row.key,
      label: row.label,
      cells: bucketOrder.map((bucket) => finalizeMetricCell(matrix.get(`${row.key}|${bucket}`) || emptyMetricCell(bucket)))
    }));
    return { rows, bucketOrder };
  }

  function buildDaypartHeatmap(records) {
    const { rows, bucketOrder } = buildDaypartDaySetGroups(records);
    if (!rows.some((row) => row.cells.some((cell) => cell.airingCount > 0))) {
      return '<div class="performance-chart-empty">Day-part heatmap needs trustworthy dated rows in the active filter window.</div>';
    }
    const maxMetric = Math.max(1, ...rows.flatMap((row) => row.cells.map((cell) => metricValue(cell))));
    const header = bucketOrder.map((label) => `<div class="topic-time-header-cell">${utils.escapeHtml(label)}</div>`).join('');
    const body = rows.map((row) => {
      const cells = row.cells.map((cell) => {
        if (!cell.airingCount) return '<div class="topic-time-cell empty">—</div>';
        const value = metricValue(cell);
        const alpha = Math.max(0.12, Math.min(0.92, value / maxMetric)).toFixed(3);
        const display = metricDisplay(cell);
        const title = `${row.label} · ${cell.label}: ${display} (${utils.formatCount(cell.airingCount)} airings)`;
        return `<button type="button" class="topic-time-cell slot-drill-trigger${perf().slotDrillKey === `${row.label} · ${cell.label}` ? ' active-drill' : ''}" data-performance-drill-key="${utils.escapeHtml(`${row.label} · ${cell.label}`)}" style="background: rgba(18, 62, 107, ${alpha});" title="${utils.escapeHtml(title)}"><span>${utils.escapeHtml(display)}</span><small>${utils.escapeHtml(utils.formatCount(cell.airingCount))}</small></button>`;
      }).join('');
      return `<div class="topic-time-row"><div class="topic-time-day">${utils.escapeHtml(row.label)}</div>${cells}</div>`;
    }).join('');
    return `
      <div class="topic-time-heatmap-wrap">
        <div class="topic-time-header"><div class="topic-time-corner">Day set / day-part</div>${header}</div>
        <div class="topic-time-grid">${body}</div>
      </div>
      <div class="performance-chart-note">This heatmap splits day-parts into Mon-Fri, Saturday, and Sunday so weekend behavior does not get mashed into the weekday pattern.</div>
    `;
  }

  function buildTopicDaySetHeatmap(groups) {
    const orderedRows = [];
    const rowMap = new Map();
    const colOrder = ['Mon-Fri', 'Saturday', 'Sunday'];
    (groups || []).forEach((group) => {
      const bits = String(group.label || '').split(' · ');
      const col = bits.pop();
      const topic = bits.join(' · ') || group.label;
      if (!colOrder.includes(col)) return;
      if (!rowMap.has(topic)) rowMap.set(topic, { topic, cells: new Map() });
      rowMap.get(topic).cells.set(col, group);
    });
    orderedRows.push(...[...rowMap.values()].sort((a, b) => {
      const aBest = Math.max(...colOrder.map((col) => metricValue(a.cells.get(col) || emptyMetricCell())));
      const bBest = Math.max(...colOrder.map((col) => metricValue(b.cells.get(col) || emptyMetricCell())));
      if (bBest !== aBest) return bBest - aBest;
      return utils.compareText(a.topic, b.topic);
    }));
    if (!orderedRows.length) return '<div class="performance-chart-empty">Topic week split needs trustworthy dated rows with topic metadata in the active filter window.</div>';
    const maxMetric = Math.max(1, ...orderedRows.flatMap((row) => colOrder.map((col) => metricValue(row.cells.get(col) || emptyMetricCell()))));
    const header = colOrder.map((label) => `<div class="topic-time-header-cell">${utils.escapeHtml(label)}</div>`).join('');
    const body = orderedRows.map((row) => {
      const cells = colOrder.map((col) => {
        const group = row.cells.get(col) || null;
        if (!group) return '<div class="topic-time-cell empty">—</div>';
        const alpha = Math.max(0.12, Math.min(0.92, metricValue(group) / maxMetric)).toFixed(3);
        const title = `${row.topic} · ${col}: ${metricDisplay(group, { includeCount: true })}`;
        const badge = group.belowSampleThreshold ? ' · low sample' : '';
        return `<button type="button" class="topic-time-cell${group.belowSampleThreshold ? ' low-sample' : ''} slot-drill-trigger${perf().slotDrillKey === group.label ? ' active-drill' : ''}" data-performance-drill-key="${utils.escapeHtml(group.label)}" style="background: rgba(18, 62, 107, ${alpha});" title="${utils.escapeHtml(title)}"><span>${utils.escapeHtml(metricDisplay(group))}</span><small>${utils.escapeHtml(utils.formatCount(group.airingCount))}${badge}</small></button>`;
      }).join('');
      return `<div class="topic-time-row"><div class="topic-time-day">${utils.escapeHtml(row.topic)}</div>${cells}</div>`;
    }).join('');
    return `
      <div class="topic-time-heatmap-wrap">
        <div class="topic-time-header"><div class="topic-time-corner">Topic / week slice</div>${header}</div>
        <div class="topic-time-grid">${body}</div>
      </div>
      <div class="performance-chart-note">This view splits each topic into Mon-Fri, Saturday, and Sunday so you can see where each topic actually breathes.</div>
    `;
  }

  function buildDaypartSplitLineSvg(records) {
    const { rows, bucketOrder } = buildDaypartDaySetGroups(records);
    const activeRows = rows.filter((row) => row.cells.some((cell) => cell.airingCount > 0));
    if (!activeRows.length) {
      return '<div class="performance-chart-empty">Day-part split-line view needs trustworthy dated rows in the active filter window.</div>';
    }
    const width = 980;
    const height = 360;
    const left = 76;
    const right = 24;
    const top = 20;
    const bottom = 88;
    const chartW = width - left - right;
    const chartH = height - top - bottom;
    const metricFor = (cell) => metricValue(cell);
    const max = Math.max(1, ...activeRows.flatMap((row) => row.cells.map(metricFor)));
    const palette = ['#123e6b', '#2a7a45', '#8a3f0f'];
    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({ y: top + chartH - (ratio * chartH), value: max * ratio }));
    const grid = yTicks.map((tick) => `
      <line x1="${left}" y1="${tick.y}" x2="${left + chartW}" y2="${tick.y}" stroke="#dce8f6" stroke-width="1"></line>
      <text x="${left - 8}" y="${tick.y + 4}" font-size="11" text-anchor="end" fill="#526174">${utils.escapeHtml(formatMetricValue(tick.value))}</text>
    `).join('');
    const xPoints = bucketOrder.map((label, index) => ({ label, x: left + (bucketOrder.length <= 1 ? chartW / 2 : (index * chartW / (bucketOrder.length - 1))) }));
    const seriesSvg = activeRows.map((row, rowIndex) => {
      const color = palette[rowIndex % palette.length];
      const pts = row.cells.map((cell, index) => {
        const x = xPoints[index].x;
        const y = top + chartH - ((metricFor(cell) / max) * chartH);
        return { x, y, cell, label: xPoints[index].label };
      });
      const path = pts.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
      const dots = pts.map((point) => `
        <circle cx="${point.x}" cy="${point.y}" r="4" fill="${color}">
          <title>${utils.escapeHtml(`${row.label} · ${point.label}: ${metricDisplay(point.cell)} (${utils.formatCount(point.cell.airingCount)} airings)`)}</title>
        </circle>
      `).join('');
      return `<path d="${path}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>${dots}`;
    }).join('');
    const labels = xPoints.map((point) => `<text x="${point.x}" y="${height - 24}" font-size="11" text-anchor="middle" fill="#526174">${utils.escapeHtml(point.label)}</text>`).join('');
    const legend = activeRows.map((row, rowIndex) => `<span class="split-line-legend-item"><span class="swatch swatch-${rowIndex % palette.length}"></span>${utils.escapeHtml(row.label)}</span>`).join('');
    return `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${utils.escapeHtml(metricLabel())} by day-part and day set">
        ${grid}
        ${seriesSvg}
        ${labels}
      </svg>
      <div class="performance-chart-note"><div class="split-line-legend">${legend}</div>Split lines separate Mon-Fri, Saturday, and Sunday so the day-part story is not flattened into one weekly average.</div>
    `;
  }


  function setPerformanceTableHeaders(headers = []) {
    const ths = els.performanceTableBody?.closest('table')?.querySelectorAll('thead th') || [];
    headers.forEach((value, index) => {
      if (ths[index]) ths[index].textContent = value;
    });
  }

  function truncateTopicLabel(label = '', max = 18) {
    const text = utils.normalizeText(label);
    if (!text) return '—';
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  function buildOccupiedHalfHourSlots(record) {
    if (!record?.hasDate || !record?.hasExplicitTime || !(record.when instanceof Date) || Number.isNaN(record.when.getTime())) return [];
    const rawMinutes = Number(record?.minutes);
    const runtimeFallback = Number(utils.firstNonEmpty(record?.runtimeMinutes, record?.libraryRuntimeMinutes, 0));
    const durationMinutes = Math.max(30,
      Number.isFinite(rawMinutes) && rawMinutes > 0 ? rawMinutes : 0,
      Number.isFinite(runtimeFallback) && runtimeFallback > 0 ? runtimeFallback : 0
    );
    const start = new Date(record.when.getTime());
    const end = new Date(start.getTime() + (durationMinutes * 60000));
    const slots = [];
    let cursor = new Date(start.getTime());
    while (cursor < end) {
      const bucketMinutes = Math.floor(((cursor.getHours() * 60) + cursor.getMinutes()) / 30) * 30;
      const slotStart = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), Math.floor(bucketMinutes / 60), bucketMinutes % 60, 0, 0);
      const slotEnd = new Date(slotStart.getTime() + (30 * 60000));
      const overlapStart = Math.max(start.getTime(), slotStart.getTime());
      const overlapEnd = Math.min(end.getTime(), slotEnd.getTime());
      const overlapMinutes = Math.max(0, (overlapEnd - overlapStart) / 60000);
      if (overlapMinutes > 0) {
        const anchor = broadcastAnchorDate(slotStart) || slotStart;
        const dayName = anchor.toLocaleDateString(undefined, { weekday: 'long' });
        const dayIndex = DAY_ORDER.indexOf(dayName);
        if (dayIndex >= 0) {
          slots.push({
            dayIndex,
            slotMinutes: bucketMinutes,
            hourOfDay: Math.floor(bucketMinutes / 60),
            label: `${dayName} · ${utils.minutesToLabel(bucketMinutes)}`,
            overlapMinutes
          });
        }
      }
      cursor = slotEnd;
    }
    return slots;
  }

  function slotTopicLabel(record) {
    return utils.normalizeText(record?.topicDisplay || record?.topic || '') || 'Unassigned topic';
  }

  function buildTitleSlotExpectationIndex(records) {
    const slotMap = new Map();
    const source = Array.isArray(records) ? records : [];
    source.forEach((record) => {
      if (!record?.moneyTrusted) return;
      if (!record?.hasDate || !record?.hasExplicitTime || record?.estimatedOnly) return;
      const signature = signatureForProgram(null, record);
      if (!signature || signature === 'non_specific') return;
      const occupiedSlots = buildOccupiedHalfHourSlots(record);
      if (!occupiedSlots.length) return;
      const totalOverlapMinutes = occupiedSlots.reduce((sum, slot) => sum + (Number(slot.overlapMinutes) || 0), 0) || 30;
      occupiedSlots.forEach((slotPart) => {
        const slotKey = `${slotPart.dayIndex}|${slotPart.slotMinutes}`;
        if (!slotMap.has(slotKey)) {
          slotMap.set(slotKey, {
            key: slotKey,
            label: slotPart.label,
            dayIndex: slotPart.dayIndex,
            slotMinutes: slotPart.slotMinutes,
            totalDollars: 0,
            airingCount: 0,
            bySignature: new Map()
          });
        }
        const slot = slotMap.get(slotKey);
        const share = Math.max(0, (Number(slotPart.overlapMinutes) || 0) / totalOverlapMinutes);
        const allocatedAmount = (Number(record.amount) || 0) * share;
        slot.totalDollars += allocatedAmount;
        slot.airingCount += 1;
        if (!slot.bySignature.has(signature)) {
          slot.bySignature.set(signature, {
            signature,
            title: record.title || 'Unknown title',
            totalDollars: 0,
            airingCount: 0
          });
        }
        const entry = slot.bySignature.get(signature);
        entry.totalDollars += allocatedAmount;
        entry.airingCount += 1;
      });
    });
    return slotMap;
  }

  function buildTitleOverallExpectationIndex(records) {
    const titleMap = new Map();
    const source = Array.isArray(records) ? records : [];
    source.forEach((record) => {
      if (!record?.moneyTrusted) return;
      const signature = signatureForProgram(null, record);
      if (!signature || signature === 'non_specific') return;
      if (!titleMap.has(signature)) {
        titleMap.set(signature, {
          signature,
          title: record.title || 'Unknown title',
          totalDollars: 0,
          airingCount: 0,
          slotPartCount: 0
        });
      }
      const entry = titleMap.get(signature);
      const occupiedSlots = buildOccupiedHalfHourSlots(record);
      if (occupiedSlots.length) {
        const totalOverlapMinutes = occupiedSlots.reduce((sum, slot) => sum + (Number(slot.overlapMinutes) || 0), 0) || 30;
        occupiedSlots.forEach((slotPart) => {
          const share = Math.max(0, (Number(slotPart.overlapMinutes) || 0) / totalOverlapMinutes);
          const allocatedAmount = (Number(record.amount) || 0) * share;
          entry.totalDollars += allocatedAmount;
          entry.slotPartCount += 1;
        });
      } else {
        entry.totalDollars += Number(record.amount) || 0;
        entry.slotPartCount += 1;
      }
      entry.airingCount += 1;
    });
    return titleMap;
  }

  function scheduleSlotKey(dateKey, startMinutes) {
    const safeDateKey = utils.normalizeText(dateKey);
    const safeMinutes = Number(startMinutes);
    if (!safeDateKey || !Number.isFinite(safeMinutes)) return '';
    const [year, month, day] = safeDateKey.split('-').map((part) => Number(part));
    if (![year, month, day].every(Number.isFinite)) return '';
    const slotDate = new Date(year, month - 1, day, Math.floor(safeMinutes / 60), safeMinutes % 60, 0, 0);
    if (Number.isNaN(slotDate.getTime())) return '';
    const anchor = broadcastAnchorDate(slotDate) || slotDate;
    const dayName = anchor.toLocaleDateString(undefined, { weekday: 'long' });
    const dayIndex = DAY_ORDER.indexOf(dayName);
    if (dayIndex < 0) return '';
    const slotMinutes = Math.floor(safeMinutes / 30) * 30;
    return `${dayIndex}|${slotMinutes}`;
  }

  function slotExpectationTone(titleAvg, slotAvg) {
    if (!Number.isFinite(titleAvg) || !Number.isFinite(slotAvg)) return 'neutral';
    if (slotAvg <= 0) {
      if (titleAvg > 0) return 'positive';
      if (titleAvg < 0) return 'negative';
      return 'neutral';
    }
    const ratio = (titleAvg - slotAvg) / slotAvg;
    if (ratio >= 0.15) return 'positive';
    if (ratio <= -0.15) return 'negative';
    return 'neutral';
  }

  function scheduleExpectationSymbol(tone) {
    if (tone === 'positive') return '+';
    if (tone === 'negative') return '-';
    return '=';
  }

  function getScheduleExpectationForPlacement(placement, dateKey, startMinutes) {
    if (!perf().ready || !Array.isArray(perf().records) || !perf().records.length) return null;
    const signature = signatureForProgram(null, placement || {});
    if (!signature || signature === 'non_specific') return null;
    if (!perf().titleSlotExpectationIndex) perf().titleSlotExpectationIndex = buildTitleSlotExpectationIndex(perf().records || []);
    if (!perf().titleOverallExpectationIndex) perf().titleOverallExpectationIndex = buildTitleOverallExpectationIndex(perf().records || []);
    const slotKey = scheduleSlotKey(dateKey, startMinutes);
    if (!slotKey) return null;
    const slot = perf().titleSlotExpectationIndex.get(slotKey);
    if (!slot || !slot.airingCount || !slot.bySignature?.size) return null;
    const exactTitleStats = slot.bySignature.get(signature) || null;
    const overallTitleStats = perf().titleOverallExpectationIndex.get(signature) || null;
    if ((!exactTitleStats && !overallTitleStats) || (slot.airingCount || 0) < 2) return null;
    const exactAirings = Number(exactTitleStats?.airingCount || 0);
    const overallAirings = Number(overallTitleStats?.airingCount || 0);
    const overallSlotParts = Number(overallTitleStats?.slotPartCount || 0);
    const useExact = exactAirings >= 2;
    if (!useExact && overallAirings < 2) return null;
    const slotAvg = slot.airingCount ? slot.totalDollars / slot.airingCount : 0;
    const titleAvg = useExact
      ? (exactTitleStats.airingCount ? exactTitleStats.totalDollars / exactTitleStats.airingCount : 0)
      : (overallSlotParts ? overallTitleStats.totalDollars / overallSlotParts : 0);
    const tone = slotExpectationTone(titleAvg, slotAvg);
    const symbol = scheduleExpectationSymbol(tone);
    const relationText = tone === 'positive'
      ? 'expected to outperform this slot'
      : tone === 'negative'
        ? 'expected to underperform this slot'
        : 'expected to perform about average for this slot';
    const evidenceText = useExact
      ? `based on ${utils.formatCount(exactAirings)} prior airing${exactAirings === 1 ? '' : 's'} in this exact slot`
      : `based on ${utils.formatCount(overallAirings)} prior airing${overallAirings === 1 ? '' : 's'} overall for this title`;
    const titleLabel = (useExact ? exactTitleStats?.title : overallTitleStats?.title) || placement?.programTitle || 'This title';
    return {
      slotKey,
      tone,
      symbol,
      title: titleLabel,
      titleAvg,
      slotAvg,
      airingCount: useExact ? exactAirings : overallAirings,
      slotCount: slot.airingCount || 0,
      evidenceMode: useExact ? 'exact_slot' : 'overall_title',
      tooltip: `${titleLabel} is ${relationText}, ${evidenceText}. Avg $${titleAvg.toFixed(0)} vs slot avg $${slotAvg.toFixed(0)} across ${utils.formatCount(slot.airingCount || 0)} airings.`
    };
  }

  function buildTopicSlotWinnerGroups(records) {
    const slotMap = new Map();
    (records || []).forEach((record) => {
      if (!record?.moneyTrusted) return;
      if (!record?.hasDate || !record?.hasExplicitTime || record?.estimatedOnly) return;
      const topic = slotTopicLabel(record);
      const occupiedSlots = buildOccupiedHalfHourSlots(record);
      if (!occupiedSlots.length) return;
      const totalOverlapMinutes = occupiedSlots.reduce((sum, slot) => sum + (Number(slot.overlapMinutes) || 0), 0) || 30;
      occupiedSlots.forEach((slotPart) => {
        const slotKey = `${slotPart.dayIndex}|${slotPart.slotMinutes}`;
        if (!slotMap.has(slotKey)) {
          slotMap.set(slotKey, {
            key: slotKey,
            label: slotPart.label,
            dayIndex: slotPart.dayIndex,
            hourOfDay: slotPart.hourOfDay,
            slotMinutes: slotPart.slotMinutes,
            topics: new Map(),
            totalSlotAirings: 0,
            zeroIncomeAirings: 0,
            contributions: []
          });
        }
        const slot = slotMap.get(slotKey);
        if (!slot.topics.has(topic)) {
          const cell = emptyMetricCell(topic);
          cell.titles = new Set();
          cell.entries = [];
          slot.topics.set(topic, cell);
        }
        const share = Math.max(0, (Number(slotPart.overlapMinutes) || 0) / totalOverlapMinutes);
        const allocatedAmount = (Number(record.amount) || 0) * share;
        const allocatedPledges = (Number(record.pledges) || 0) * share;
        const allocatedSustainers = (Number(record.sustainers) || 0) * share;
        const allocatedMinutes = Number(slotPart.overlapMinutes) || 0;
        const cell = slot.topics.get(topic);
        aggregateMetricCell(cell, { amount: allocatedAmount, pledges: allocatedPledges, sustainers: allocatedSustainers, minutes: allocatedMinutes });
        cell.titles.add(record.title || 'Unknown title');
        const contribution = {
          topic,
          record,
          allocatedDollars: allocatedAmount,
          allocatedPledges,
          allocatedSustainers,
          allocatedMinutes,
          share
        };
        cell.entries.push(contribution);
        slot.contributions.push(contribution);
        slot.totalSlotAirings += 1;
        if ((Number(record.amount) || 0) <= 0) slot.zeroIncomeAirings += 1;
      });
    });
    return [...slotMap.values()].map((slot) => {
      const topicGroups = [...slot.topics.entries()].map(([topic, cell]) => ({
        topic,
        ...finalizeMetricCell(cell),
        titles: [...(cell.titles || [])].sort((a, b) => utils.compareText(a, b)),
        entries: [...(cell.entries || [])].sort((a, b) => {
          const at = a?.record?.when instanceof Date && !Number.isNaN(a.record.when.getTime()) ? a.record.when.getTime() : Number.MAX_SAFE_INTEGER;
          const bt = b?.record?.when instanceof Date && !Number.isNaN(b.record.when.getTime()) ? b.record.when.getTime() : Number.MAX_SAFE_INTEGER;
          if (at !== bt) return at - bt;
          return utils.compareText(a?.record?.title || '', b?.record?.title || '');
        }),
        belowSampleThreshold: minSampleThreshold() > 1 && cell.airingCount < minSampleThreshold()
      })).sort((a, b) => {
        const diff = metricValue(b) - metricValue(a);
        if (diff !== 0) return diff;
        if (b.airingCount !== a.airingCount) return b.airingCount - a.airingCount;
        return utils.compareText(a.topic, b.topic);
      });
      const positiveTopics = topicGroups.filter((topicGroup) => (Number(topicGroup.totalDollars) || 0) > 0);
      return {
        ...slot,
        topicGroups,
        winner: positiveTopics[0] || null,
        runnerUp: positiveTopics[1] || null,
        hasOnlyZeroIncome: !positiveTopics.length && slot.totalSlotAirings > 0,
        zeroIncomeSummary: slot.zeroIncomeAirings > 0 ? `${utils.formatCount(slot.zeroIncomeAirings)} airings, no income` : '',
        contributions: [...slot.contributions].sort((a, b) => {
          const at = a?.record?.when instanceof Date && !Number.isNaN(a.record.when.getTime()) ? a.record.when.getTime() : Number.MAX_SAFE_INTEGER;
          const bt = b?.record?.when instanceof Date && !Number.isNaN(b.record.when.getTime()) ? b.record.when.getTime() : Number.MAX_SAFE_INTEGER;
          if (at !== bt) return at - bt;
          return utils.compareText(a?.record?.title || '', b?.record?.title || '');
        })
      };
    }).sort((a, b) => {
      if (a.dayIndex !== b.dayIndex) return a.dayIndex - b.dayIndex;
      return a.slotMinutes - b.slotMinutes;
    });
  }

  function buildTopicSlotWinnerHeatmap(records, precomputedSlots = null) {
    const slots = Array.isArray(precomputedSlots) ? precomputedSlots : buildTopicSlotWinnerGroups(records);
    if (!slots.length) return '<div class="performance-chart-empty">Topic winners by slot needs trustworthy dated rows with topic metadata and real air times.</div>';
    const occupiedSlotMinutes = [...new Set(slots.map((slot) => slot.slotMinutes))].sort((a, b) => a - b);
    const slotMinutes = occupiedSlotMinutes.length
      ? Array.from({ length: Math.round((occupiedSlotMinutes[occupiedSlotMinutes.length - 1] - occupiedSlotMinutes[0]) / 30) + 1 }, (_, index) => occupiedSlotMinutes[0] + (index * 30))
      : [];
    const matrix = new Map(slots.map((slot) => [`${slot.dayIndex}|${slot.slotMinutes}`, slot]));
    const positiveSlots = slots.filter((slot) => slot.winner);
    const maxMetric = Math.max(1, ...positiveSlots.map((slot) => metricValue(slot.winner || emptyMetricCell())));
    const header = slotMinutes.map((minutes) => `<div class="topic-time-header-cell">${utils.escapeHtml(utils.minutesToLabel(minutes))}</div>`).join('');
    const body = DAY_ORDER.map((day, dayIndex) => {
      const cells = slotMinutes.map((minutes) => {
        const slot = matrix.get(`${dayIndex}|${minutes}`) || null;
        if (!slot) return '<div class="topic-time-cell empty">—</div>';
        if (!slot.winner && slot.hasOnlyZeroIncome) {
          const title = `${slot.label}: ${slot.zeroIncomeSummary}`;
          return `<button type="button" class="topic-time-cell topic-winner-cell zero-income slot-drill-trigger${perf().slotDrillKey === slot.key ? ' active-drill' : ''}" data-performance-drill-key="${utils.escapeHtml(slot.key)}" title="${utils.escapeHtml(title)}"><span>${utils.escapeHtml(utils.formatCount(slot.zeroIncomeAirings))} airings</span><small>No income</small></button>`;
        }
        if (!slot.winner) return '<div class="topic-time-cell empty">—</div>';
        const value = metricValue(slot.winner);
        const alpha = Math.max(0.12, Math.min(0.92, value / maxMetric)).toFixed(3);
        const runnerText = slot.runnerUp ? ` | Runner-up: ${slot.runnerUp.topic} (${metricDisplay(slot.runnerUp, { includeCount: true })})` : '';
        const title = `${slot.label}: ${slot.winner.topic} wins with ${metricDisplay(slot.winner, { includeCount: true })}${runnerText}`;
        const lowClass = slot.winner.belowSampleThreshold ? ' low-sample' : '';
        return `<button type="button" class="topic-time-cell topic-winner-cell${lowClass} slot-drill-trigger${perf().slotDrillKey === slot.key ? ' active-drill' : ''}" data-performance-drill-key="${utils.escapeHtml(slot.key)}" style="background: rgba(18, 62, 107, ${alpha});" title="${utils.escapeHtml(title)}"><span>${utils.escapeHtml(truncateTopicLabel(slot.winner.topic, 16))}</span><small>${utils.escapeHtml(metricDisplay(slot.winner))}</small></button>`;
      }).join('');
      return `<div class="topic-time-row"><div class="topic-time-day">${utils.escapeHtml(day)}</div>${cells}</div>`;
    }).join('');
    return `
      <div class="topic-time-heatmap-wrap">
        <div class="topic-time-header"><div class="topic-time-corner">Day / time</div>${header}</div>
        <div class="topic-time-grid">${body}</div>
      </div>
      <div class="performance-chart-note">Each cell shows the top-performing topic for that day-and-30-minute slot in the current filter window. Long programs are split across the half-hour blocks they actually occupy. Click a filled cell to see the exact titles, fundraisers, and allocated dollars behind it.</div>
    `;
  }

  function renderTopicSlotWinnerTable(records) {
    if (!els.performanceTableBody) return false;
    const slots = buildTopicSlotWinnerGroups(records).filter((slot) => slot.winner || slot.hasOnlyZeroIncome);
    setPerformanceTableHeaders(['Day + time', 'Winner airings', 'Winner total $', metricLabel(), 'Runner-up', 'Notes']);
    if (!slots.length) {
      els.performanceTableBody.innerHTML = '<tr><td colspan="6" class="placeholder-row">No trustworthy topic-by-time winners match this filter yet.</td></tr>';
      return true;
    }
    els.performanceTableBody.innerHTML = slots.map((slot) => {
      if (!slot.winner && slot.hasOnlyZeroIncome) {
        return `
          <tr>
            <td><button type="button" class="performance-slot-link-btn" data-performance-drill-key="${utils.escapeHtml(slot.key)}">${utils.escapeHtml(slot.label)}</button></td>
            <td>${utils.escapeHtml(utils.formatCount(slot.zeroIncomeAirings))}</td>
            <td>${utils.escapeHtml(utils.formatMoney(0))}</td>
            <td>No positive winner</td>
            <td>—</td>
            <td>${utils.escapeHtml(slot.zeroIncomeSummary || 'Airings ran here with no income.')}</td>
          </tr>
        `;
      }
      const winner = slot.winner;
      const runner = slot.runnerUp;
      const runnerText = runner ? `${runner.topic} · ${metricDisplay(runner, { includeCount: true })}` : '—';
      const note = winner.belowSampleThreshold ? 'Low sample winner' : `${winner.topic} is the current slot leader`;
      return `
        <tr>
          <td><button type="button" class="performance-slot-link-btn" data-performance-drill-key="${utils.escapeHtml(slot.key)}">${utils.escapeHtml(slot.label)}</button></td>
          <td>${utils.escapeHtml(utils.formatCount(winner.airingCount))}</td>
          <td>${utils.escapeHtml(utils.formatMoney(winner.totalDollars))}</td>
          <td>${utils.escapeHtml(`${winner.topic} · ${metricDisplay(winner, { includeCount: true })}`)}</td>
          <td>${utils.escapeHtml(runnerText)}</td>
          <td>${utils.escapeHtml(note)}</td>
        </tr>
      `;
    }).join('');
    return true;
  }

  function buildDaypartDrillGroups(records) {
    const { rows } = buildDaypartDaySetGroups(records || []);
    return rows.flatMap((row) => row.cells
      .filter((cell) => cell.airingCount > 0)
      .map((cell) => ({
        key: `${row.label} · ${cell.label}`,
        label: `${row.label} · ${cell.label}`,
        airingCount: cell.airingCount,
        totalDollars: cell.totalDollars,
        totalPledges: cell.totalPledges,
        totalSustainers: cell.totalSustainers,
        totalMinutes: cell.totalMinutes,
        avgDollars: cell.avgDollars,
        avgPledges: cell.avgPledges,
        avgSustainers: cell.avgSustainers,
        dollarsPerPledge: cell.dollarsPerPledge,
        dollarsPerMinute: cell.dollarsPerMinute,
        pledgesPerMinute: cell.pledgesPerMinute,
        titleCount: 0,
        titles: [],
        belowSampleThreshold: minSampleThreshold() > 1 && cell.airingCount < minSampleThreshold()
      })));
  }

  function currentDrillGroups() {
    if (perf().quickFilter === 'topic_slot_winners') return currentTopicSlotWinnerGroups(perf().filteredRecords || []).filter((slot) => slot.winner || slot.hasOnlyZeroIncome);
    if (perf().criterion === 'daypart' && ['split_line', 'heatmap'].includes(effectiveChartType())) return buildDaypartDrillGroups(perf().filteredRecords || []);
    return Array.isArray(perf().groups) ? perf().groups : [];
  }

  function recordsForDrillLabel(label) {
    const criterion = perf().criterion;
    return (perf().filteredRecords || []).filter((record) => {
      if (perf().criterion === 'daypart' && ['split_line', 'heatmap'].includes(effectiveChartType())) {
        return `${daySetLabel(daySetKeyForRecord(record))} · ${daypartLabel(record)}` === label;
      }
      return criterionLabel(record, criterion) === label;
    });
  }

  function buildStandardDrillContext(selected) {
    const records = recordsForDrillLabel(selected.label).slice().sort((a, b) => {
      const at = a?.when instanceof Date && !Number.isNaN(a.when.getTime()) ? a.when.getTime() : Number.MAX_SAFE_INTEGER;
      const bt = b?.when instanceof Date && !Number.isNaN(b.when.getTime()) ? b.when.getTime() : Number.MAX_SAFE_INTEGER;
      if (at !== bt) return at - bt;
      return utils.compareText(a?.title || '', b?.title || '');
    });
    const titleMap = new Map();
    const topicMap = new Map();
    records.forEach((record) => {
      const key = `${record.programId || 'na'}|${utils.normalizeText(record.title || 'Unknown title') || 'unknown'}`;
      if (!titleMap.has(key)) {
        titleMap.set(key, {
          programId: record.programId,
          title: record.title || 'Unknown title',
          topic: slotTopicLabel(record),
          airings: 0,
          totalDollars: 0,
          firstWhen: record.when instanceof Date && !Number.isNaN(record.when.getTime()) ? record.when : null,
          lastWhen: record.when instanceof Date && !Number.isNaN(record.when.getTime()) ? record.when : null,
          fundraisers: new Set()
        });
      }
      const bucket = titleMap.get(key);
      bucket.airings += 1;
      bucket.totalDollars += Number(record.amount) || 0;
      const rowWhen = record.when instanceof Date && !Number.isNaN(record.when.getTime()) ? record.when : null;
      if (rowWhen && (!bucket.firstWhen || rowWhen.getTime() < bucket.firstWhen.getTime())) bucket.firstWhen = rowWhen;
      if (rowWhen && (!bucket.lastWhen || rowWhen.getTime() > bucket.lastWhen.getTime())) bucket.lastWhen = rowWhen;
      bucket.fundraisers.add(recordFundraiserLabel(record));

      const topic = slotTopicLabel(record);
      if (!topicMap.has(topic)) topicMap.set(topic, emptyMetricCell(topic));
      aggregateMetricCell(topicMap.get(topic), record);
    });
    const titleRows = [...titleMap.values()].sort((a, b) => {
      const diff = (Number(b.totalDollars) || 0) - (Number(a.totalDollars) || 0);
      if (diff !== 0) return diff;
      return utils.compareText(a.title, b.title);
    }).map((bucket) => {
      const titleHtml = App.programLinks?.render
        ? App.programLinks.render({ programId: bucket.programId, title: bucket.title || 'Unknown title', className: 'performance-program-link' })
        : utils.escapeHtml(bucket.title || 'Unknown title');
      const fundraisers = [...bucket.fundraisers].slice(0, 2);
      const extraCount = Math.max(0, bucket.fundraisers.size - fundraisers.length);
      const fundraiserText = fundraisers.length ? `${fundraisers.join(' · ')}${extraCount ? ` +${extraCount} more` : ''}` : 'Unknown fundraiser';
      const spanText = bucket.firstWhen && bucket.lastWhen
        ? (bucket.firstWhen.getTime() === bucket.lastWhen.getTime()
          ? formatRecordDateTime({ hasDate:true, hasExplicitTime:true, when: bucket.firstWhen })
          : `${bucket.firstWhen.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} → ${bucket.lastWhen.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`)
        : 'Date unknown';
      const avg = bucket.airings ? bucket.totalDollars / bucket.airings : 0;
      return `
        <tr>
          <td>${titleHtml}<span class="performance-slot-airing-meta">${utils.escapeHtml(bucket.topic || 'Unassigned topic')}</span></td>
          <td>${utils.escapeHtml(utils.formatCount(bucket.airings))}</td>
          <td>${utils.escapeHtml(utils.formatMoney(bucket.totalDollars))}</td>
          <td>${utils.escapeHtml(utils.formatMoney(avg))}</td>
          <td>${utils.escapeHtml(fundraiserText)}<span class="performance-slot-airing-meta">${utils.escapeHtml(spanText)}</span></td>
        </tr>
      `;
    }).join('');
    const airingRows = records.map((record) => {
      const titleHtml = App.programLinks?.render
        ? App.programLinks.render({ programId: record.programId, title: record.title || 'Unknown title', className: 'performance-program-link' })
        : utils.escapeHtml(record.title || 'Unknown title');
      return `
        <tr>
          <td>${utils.escapeHtml(formatRecordDateTime(record))}</td>
          <td>${utils.escapeHtml(recordFundraiserLabel(record))}</td>
          <td>${titleHtml}<span class="performance-slot-airing-meta">${utils.escapeHtml(slotTopicLabel(record))}</span></td>
          <td>${utils.escapeHtml(utils.formatMoney(record.amount || 0))}</td>
          <td>${utils.escapeHtml(utils.formatCount(record.pledges || 0))}</td>
        </tr>
      `;
    }).join('');
    const topicRows = [...topicMap.entries()].map(([topic, cell]) => ({ topic, ...finalizeMetricCell(cell) })).sort((a, b) => {
      const diff = metricValue(b) - metricValue(a);
      if (diff !== 0) return diff;
      return utils.compareText(a.topic, b.topic);
    }).map((group) => `
      <tr>
        <td>${utils.escapeHtml(group.topic)}</td>
        <td>${utils.escapeHtml(utils.formatCount(group.airingCount))}</td>
        <td>${utils.escapeHtml(utils.formatMoney(group.totalDollars))}</td>
        <td>${utils.escapeHtml(metricDisplay(group, { includeCount: true }))}</td>
      </tr>
    `).join('');
    return {
      pill: selected.label,
      empty: false,
      summary: [
        ['Focus', selected.label],
        [criterionDisplayName(), selected.label],
        ['Airings', utils.formatCount(selected.airingCount || records.length)],
        ['Current metric', metricDisplay(selected, { includeCount: true })]
      ],
      note: `This drill-down shows the actual titles, airings, and topic mix behind ${selected.label}.`,
      subnote: `Built from ${utils.formatCount(records.length)} contributing airings in the current filter window.`,
      titleHeaders: ['Program title', 'Airings', 'Total $', 'Avg $ / airing', 'Fundraisers / dates'],
      titleRows: titleRows || '<tr><td colspan="5" class="placeholder-row">No program titles are attached to this result yet.</td></tr>',
      airingHeaders: ['Date / time', 'Fundraiser', 'Title', 'Dollars', 'Pledges'],
      airingRows: airingRows || '<tr><td colspan="5" class="placeholder-row">No actual airings are attached to this result yet.</td></tr>',
      topicHeaders: ['Topic', 'Airings', 'Total dollars', metricLabel()],
      topicRows: topicRows || '<tr><td colspan="4" class="placeholder-row">No topic totals found for this result.</td></tr>',
      controls: '',
      titleClass: 'performance-slot-drill-primary',
      airingClass: 'performance-slot-drill-secondary',
      topicClass: 'performance-slot-drill-topics'
    };
  }

  function renderDrillContext(context) {
    els.performanceSlotDrillPill.textContent = context.pill || 'Analytics drill-down';
    els.performanceSlotDrilldown.innerHTML = `
      <div class="performance-slot-drill-summary">
        ${context.summary.map(([label, value]) => `<div class="performance-slot-drill-stat"><span class="label">${utils.escapeHtml(label)}</span><span class="value">${utils.escapeHtml(String(value))}</span></div>`).join('')}
      </div>
      <div class="performance-slot-drill-note">${utils.escapeHtml(context.note || '')}</div>
      ${context.controls || ''}
      ${context.subnote ? `<div class="performance-slot-drill-subnote">${utils.escapeHtml(context.subnote)}</div>` : ''}
      <div class="performance-slot-drill-grid">
        <div class="table-wrap ${context.titleClass || 'performance-slot-drill-primary'}">
          <table class="programs-table">
            <thead><tr>${(context.titleHeaders || []).map((header) => `<th>${utils.escapeHtml(header)}</th>`).join('')}</tr></thead>
            <tbody>${context.titleRows || ''}</tbody>
          </table>
        </div>
        <div class="table-wrap ${context.airingClass || 'performance-slot-drill-secondary'}">
          <table class="programs-table">
            <thead><tr>${(context.airingHeaders || []).map((header) => `<th>${utils.escapeHtml(header)}</th>`).join('')}</tr></thead>
            <tbody>${context.airingRows || ''}</tbody>
          </table>
        </div>
        <div class="table-wrap ${context.topicClass || 'performance-slot-drill-topics'}">
          <table class="programs-table">
            <thead><tr>${(context.topicHeaders || []).map((header) => `<th>${utils.escapeHtml(header)}</th>`).join('')}</tr></thead>
            <tbody>${context.topicRows || ''}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  function currentTopicSlotWinnerGroups(records = null) {
    if (Array.isArray(perf().topicSlotWinnerGroups)) return perf().topicSlotWinnerGroups;
    const built = buildTopicSlotWinnerGroups(records || perf().filteredRecords || []);
    perf().topicSlotWinnerGroups = built;
    return built;
  }

  function renderSlotDrilldown() {
    if (!els.performanceSlotDrilldown || !els.performanceSlotDrillPill) return;
    if (perf().quickFilter === 'topic_slot_winners') {
      const slots = currentTopicSlotWinnerGroups(perf().filteredRecords || []).filter((slot) => slot.winner || slot.hasOnlyZeroIncome);
      if (!slots.length) {
        els.performanceSlotDrillPill.textContent = 'No slot data';
        els.performanceSlotDrilldown.innerHTML = '<div class="performance-slot-drill-empty">No slot-level rows match the current filter window yet.</div>';
        return;
      }
      const selected = slots.find((slot) => slot.key === perf().slotDrillKey) || null;
      if (!selected) {
        els.performanceSlotDrillPill.textContent = 'Click a result';
        els.performanceSlotDrilldown.innerHTML = '<div class="performance-slot-drill-empty">Click a filled slot in the heatmap or its row in the comparison table to see the exact titles, fundraisers, and slot-level dollars behind it.</div>';
        return;
      }
      const topicGroups = (selected.topicGroups || []).filter((group) => group.airingCount > 0);
      const availableModes = [];
      if (selected.winner && Array.isArray(selected.winner.entries) && selected.winner.entries.length) availableModes.push('winner');
      availableModes.push('all');
      if (!availableModes.includes(perf().slotDrillMode)) perf().slotDrillMode = availableModes[0] || 'all';
      const drillMode = perf().slotDrillMode || 'all';
      const visibleEntries = ((drillMode === 'winner' && selected.winner) ? (selected.winner.entries || []) : (selected.contributions || [])).slice().sort((a, b) => {
        const at = a?.record?.when instanceof Date && !Number.isNaN(a.record.when.getTime()) ? a.record.when.getTime() : Number.MAX_SAFE_INTEGER;
        const bt = b?.record?.when instanceof Date && !Number.isNaN(b.record.when.getTime()) ? b.record.when.getTime() : Number.MAX_SAFE_INTEGER;
        if (at !== bt) return at - bt;
        return utils.compareText(a?.record?.title || '', b?.record?.title || '');
      });
      const modeSummary = drillMode === 'winner' && selected.winner ? `Showing only the current winning topic: ${selected.winner.topic}.` : 'Showing all topics that competed in this slot.';
      const topicRows = topicGroups.map((group) => `
        <tr>
          <td>${utils.escapeHtml(group.topic)}</td>
          <td>${utils.escapeHtml(utils.formatCount(group.airingCount))}</td>
          <td>${utils.escapeHtml(utils.formatMoney(group.totalDollars))}</td>
          <td>${utils.escapeHtml(metricDisplay(group, { includeCount: true }))}</td>
        </tr>
      `).join('');
      const titleMap = new Map();
      visibleEntries.forEach((entry) => {
        const record = entry.record || {};
        const key = `${record.programId || 'na'}|${utils.normalizeText(record.title || 'Unknown title') || 'unknown'}`;
        if (!titleMap.has(key)) {
          titleMap.set(key, {
            programId: record.programId,
            title: record.title || 'Unknown title',
            topic: entry.topic || slotTopicLabel(record),
            airings: 0,
            allocatedDollars: 0,
            totalDollars: 0,
            firstWhen: record.when instanceof Date && !Number.isNaN(record.when.getTime()) ? record.when : null,
            lastWhen: record.when instanceof Date && !Number.isNaN(record.when.getTime()) ? record.when : null,
            fundraisers: new Set()
          });
        }
        const bucket = titleMap.get(key);
        bucket.airings += 1;
        bucket.allocatedDollars += Number(entry.allocatedDollars) || 0;
        bucket.totalDollars += Number(record.amount) || 0;
        const rowWhen = record.when instanceof Date && !Number.isNaN(record.when.getTime()) ? record.when : null;
        if (rowWhen && (!bucket.firstWhen || rowWhen.getTime() < bucket.firstWhen.getTime())) bucket.firstWhen = rowWhen;
        if (rowWhen && (!bucket.lastWhen || rowWhen.getTime() > bucket.lastWhen.getTime())) bucket.lastWhen = rowWhen;
        bucket.fundraisers.add(recordFundraiserLabel(record));
      });
      const titleRows = [...titleMap.values()].sort((a, b) => {
        const diff = (Number(b.allocatedDollars) || 0) - (Number(a.allocatedDollars) || 0);
        if (diff !== 0) return diff;
        if (b.airings !== a.airings) return b.airings - a.airings;
        return utils.compareText(a.title, b.title);
      }).map((bucket) => {
        const titleHtml = App.programLinks?.render ? App.programLinks.render({ programId: bucket.programId, title: bucket.title || 'Unknown title', className: 'performance-program-link' }) : utils.escapeHtml(bucket.title || 'Unknown title');
        const fundraisers = [...bucket.fundraisers].slice(0, 2);
        const extraCount = Math.max(0, bucket.fundraisers.size - fundraisers.length);
        const fundraiserText = fundraisers.length ? `${fundraisers.join(' · ')}${extraCount ? ` +${extraCount} more` : ''}` : 'Unknown fundraiser';
        const spanText = bucket.firstWhen && bucket.lastWhen
          ? (bucket.firstWhen.getTime() === bucket.lastWhen.getTime() ? formatRecordDateTime({ hasDate: true, hasExplicitTime: true, when: bucket.firstWhen }) : `${bucket.firstWhen.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} → ${bucket.lastWhen.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`)
          : 'Date unknown';
        return `
          <tr>
            <td>${titleHtml}<span class="performance-slot-airing-meta">${utils.escapeHtml(bucket.topic || 'Unassigned topic')}</span></td>
            <td>${utils.escapeHtml(utils.formatCount(bucket.airings))}</td>
            <td>${utils.escapeHtml(utils.formatMoney(bucket.allocatedDollars))}</td>
            <td>${utils.escapeHtml(utils.formatMoney(bucket.totalDollars))}</td>
            <td>${utils.escapeHtml(fundraiserText)}<span class="performance-slot-airing-meta">${utils.escapeHtml(spanText)}</span></td>
          </tr>
        `;
      }).join('');
      const airingRows = visibleEntries.map((entry) => {
        const record = entry.record || {};
        const titleHtml = App.programLinks?.render ? App.programLinks.render({ programId: record.programId, title: record.title || 'Unknown title', className: 'performance-program-link' }) : utils.escapeHtml(record.title || 'Unknown title');
        return `
          <tr>
            <td>${utils.escapeHtml(formatRecordDateTime(record))}</td>
            <td>${utils.escapeHtml(recordFundraiserLabel(record))}</td>
            <td>${titleHtml}<span class="performance-slot-airing-meta">${utils.escapeHtml(entry.topic || 'Unassigned topic')}</span></td>
            <td>${utils.escapeHtml(utils.formatMoney(entry.allocatedDollars))}</td>
            <td>${utils.escapeHtml(utils.formatMoney(record.amount || 0))}</td>
          </tr>
        `;
      }).join('');
      const summaryWinner = selected.winner ? `${selected.winner.topic} · ${metricDisplay(selected.winner, { includeCount: true })}` : (selected.zeroIncomeSummary || 'No positive winner');
      return renderDrillContext({
        pill: selected.label,
        summary: [['Slot', selected.label], ['Current winner', summaryWinner], ['Airings in slot', utils.formatCount(selected.totalSlotAirings)], ['Topics represented', utils.formatCount(topicGroups.length)]],
        note: 'These dollars are the amounts allocated to this specific 30-minute slot, not always the full-airing totals. Long programs are split across each half-hour block they occupy.',
        controls: `<div class="performance-slot-drill-controls" role="group" aria-label="Analytics drill-down view">${selected.winner ? `<button type="button" class="performance-slot-mode-btn${drillMode === 'winner' ? ' active' : ''}" data-slot-drill-mode="winner">Winner only</button>` : ''}<button type="button" class="performance-slot-mode-btn${drillMode === 'all' ? ' active' : ''}" data-slot-drill-mode="all">All topics in this slot</button></div>`,
        subnote: modeSummary,
        titleHeaders: ['Program title', 'Airings', 'Allocated to slot', 'Full-airing $', 'Fundraisers / dates'],
        titleRows: titleRows || '<tr><td colspan="5" class="placeholder-row">No program titles are attached to this slot yet.</td></tr>',
        airingHeaders: ['Date / time', 'Fundraiser', 'Title', 'Allocated to slot', 'Total airing $'],
        airingRows: airingRows || '<tr><td colspan="5" class="placeholder-row">No actual airings are attached to this slot yet.</td></tr>',
        topicHeaders: ['Topic', 'Airings', 'Allocated dollars', metricLabel()],
        topicRows: topicRows || '<tr><td colspan="4" class="placeholder-row">No topic totals found for this slot.</td></tr>'
      });
    }

    const groups = currentDrillGroups();
    if (!groups.length) {
      els.performanceSlotDrillPill.textContent = 'Analytics drill-down';
      els.performanceSlotDrilldown.innerHTML = '<div class="performance-slot-drill-empty">Open an analytics view and click a chart element or a comparison-table row to inspect the exact titles, fundraisers, and airings behind that result.</div>';
      return;
    }
    const selected = groups.find((group) => (group.key || group.label) === perf().slotDrillKey) || null;
    if (!selected) {
      els.performanceSlotDrillPill.textContent = 'Click a result';
      els.performanceSlotDrilldown.innerHTML = '<div class="performance-slot-drill-empty">Click a bar, point, heatmap cell, or table row to see the exact titles, fundraisers, and airings behind that result.</div>';
      return;
    }
    renderDrillContext(buildStandardDrillContext(selected));
  }


  function renderChart(groups) {
    if (!els.performanceChart) return;
    if (perf().quickFilter === 'topic_slot_winners') {
      const records = perf().filteredRecords || [];
      if (!records.length) {
        perf().topicSlotWinnerGroups = [];
        els.performanceChart.innerHTML = '<div class="performance-chart-empty">No filtered rows match this topic-slot winner view yet.</div>';
        return;
      }
      const slots = buildTopicSlotWinnerGroups(records);
      perf().topicSlotWinnerGroups = slots;
      if (perf().slotDrillKey && !slots.some((slot) => slot.key === perf().slotDrillKey)) perf().slotDrillKey = '';
      els.performanceChart.innerHTML = buildTopicSlotWinnerHeatmap(records, slots);
      return;
    }
    if (!groups.length) {
      const analysisMeta = perf().analysisMeta || {};
      const msg = analysisMeta.noTemporalSupport
        ? 'No reliable date/time-backed events match this filter yet. Day/date/time analytics need imported airing/report data or clean matched airings rows.'
        : 'No comparison groups match this filter yet.';
      els.performanceChart.innerHTML = `<div class="performance-chart-empty">${utils.escapeHtml(msg)}</div>`;
      return;
    }
    if (perf().criterion === 'topic_time') {
      els.performanceChart.innerHTML = buildTopicTimeHeatmap(groups);
      return;
    }
    if (perf().criterion === 'topic_dayset') {
      els.performanceChart.innerHTML = buildTopicDaySetHeatmap(groups);
      return;
    }
    const chartType = effectiveChartType();
    if (perf().criterion === 'daypart' && chartType === 'heatmap') {
      els.performanceChart.innerHTML = buildDaypartHeatmap(perf().filteredRecords || []);
      return;
    }
    if (perf().criterion === 'daypart' && chartType === 'split_line') {
      els.performanceChart.innerHTML = buildDaypartSplitLineSvg(perf().filteredRecords || []);
      return;
    }
    const svg = chartType === 'line' ? buildLineSvg(groups) : buildBarSvg(groups);
    const note = chartType === 'line'
      ? '<div class="performance-chart-note">Line chart works best for date, day, or time because those labels have a natural order.</div>'
      : '<div class="performance-chart-note">Vertical bar chart is the safer choice for categories like program, topic, day-part, break flags, and premium metadata.</div>';
    els.performanceChart.innerHTML = `${svg}${note}`;
  }

  function renderDaypartComparisonTable(records) {
    if (!els.performanceTableBody) return false;
    const { rows } = buildDaypartDaySetGroups(records || []);
    const flat = rows.flatMap((row) => row.cells
      .filter((cell) => cell.airingCount > 0)
      .map((cell) => ({
        label: `${row.label} · ${cell.label}`,
        airingCount: cell.airingCount,
        totalDollars: cell.totalDollars,
        titleCount: 0,
        belowSampleThreshold: minSampleThreshold() > 1 && cell.airingCount < minSampleThreshold(),
        avgDollars: cell.avgDollars,
        avgPledges: cell.avgPledges,
        avgSustainers: cell.avgSustainers,
        dollarsPerPledge: cell.dollarsPerPledge,
        dollarsPerMinute: cell.dollarsPerMinute,
        pledgesPerMinute: cell.pledgesPerMinute,
        totalPledges: cell.totalPledges,
        totalSustainers: cell.totalSustainers,
        totalMinutes: cell.totalMinutes
      })));
    setPerformanceTableHeaders(['Day set · day-part', 'Airings', 'Total dollars', metricLabel(), 'Confidence', 'Titles']);
    if (!flat.length) {
      els.performanceTableBody.innerHTML = '<tr><td colspan="6" class="placeholder-row">No day-part slices match this filter yet.</td></tr>';
      return true;
    }
    els.performanceTableBody.innerHTML = flat.map((group) => {
      const sampleNote = group.belowSampleThreshold
        ? `<div class="sample-warning-inline">Low sample</div>`
        : '';
      const confidence = confidenceForGroup(group);
      return `
      <tr class="performance-drill-row" data-performance-drill-key="${utils.escapeHtml(group.label)}">
        <td>${utils.escapeHtml(group.label)}${sampleNote}</td>
        <td>${utils.escapeHtml(utils.formatCount(group.airingCount))}</td>
        <td>${utils.escapeHtml(utils.formatMoney(group.totalDollars))}</td>
        <td>${utils.escapeHtml(metricDisplay(group, { includeCount: true }))}</td>
        <td><span class="performance-confidence-badge ${utils.escapeHtml(confidenceClassForGroup(group))}">${utils.escapeHtml(confidence)}</span></td>
        <td>—</td>
      </tr>
    `;
    }).join('');
    return true;
  }

  function renderTable(groups) {
    if (!els.performanceTableBody) return;
    if (perf().quickFilter === 'topic_slot_winners') {
      if (renderTopicSlotWinnerTable(perf().filteredRecords || [], currentTopicSlotWinnerGroups(perf().filteredRecords || []))) return;
    }
    if (perf().criterion === 'daypart' && ['split_line', 'heatmap'].includes(effectiveChartType())) {
      if (renderDaypartComparisonTable(perf().filteredRecords || [])) return;
    }
    setPerformanceTableHeaders([criterionDisplayName(), 'Airings', 'Total dollars', metricLabel(), 'Confidence', 'Titles']);
    if (!groups.length) {
      els.performanceTableBody.innerHTML = '<tr><td colspan="6" class="placeholder-row">No comparison groups match this filter yet.</td></tr>';
      return;
    }
    els.performanceTableBody.innerHTML = groups.map((group) => {
      const labelHtml = perf().criterion === 'program'
        ? App.programLinks.render({ programId: group.programOpenId, title: group.label, className: 'performance-program-link' })
        : utils.escapeHtml(group.label);
      const sampleNote = group.belowSampleThreshold
        ? `<div class="sample-warning-inline">Low sample</div>`
        : '';
      const confidence = confidenceForGroup(group);
      return `
      <tr class="performance-drill-row" data-performance-drill-key="${utils.escapeHtml(group.label)}">
        <td>${labelHtml}${sampleNote}</td>
        <td>${utils.escapeHtml(utils.formatCount(group.airingCount))}</td>
        <td>${utils.escapeHtml(utils.formatMoney(group.totalDollars))}</td>
        <td>${utils.escapeHtml(metricDisplay(group, { includeCount: true }))}</td>
        <td><span class="performance-confidence-badge ${utils.escapeHtml(confidenceClassForGroup(group))}">${utils.escapeHtml(confidence)}</span></td>
        <td>${utils.escapeHtml(utils.formatCount(group.titleCount))}</td>
      </tr>
    `;
    }).join('');
  }

  function confidenceLabel() {
    const meta = perf().analysisMeta || {};
    if (meta.noTemporalSupport) return 'Unavailable until report/airing date data is imported';
    if (meta.lowConfidenceTemporal) return 'Low confidence';
    return 'Working comparison';
  }

  function buildCriteriaSummary(records) {
    const quick = quickFilterLabel() || 'None';
    const analysisMeta = perf().analysisMeta || {};
    perf().criteriaSummary = [
      ['Broadcast day', `Starts ${utils.minutesToLabel(broadcastDayStartHour() * 60)}`],
      ['Quick filter', quick],
      ['Compare by', criterionDisplayName()],
      ['Metric', metricLabel()]
    ];
    if (!els.performanceCriteriaBar) return;
    els.performanceCriteriaBar.innerHTML = perf().criteriaSummary.map(([label, value]) => `
      <div class="performance-criteria-pill"><span class="label">${utils.escapeHtml(label)}</span><span>${utils.escapeHtml(value)}</span></div>
    `).join('');
    if (analysisMeta.excludedIntegrityCount) {
      els.performanceCriteriaBar.innerHTML += `
        <div class="performance-criteria-pill warn"><span class="label">Excluded suspect rows</span><span>${utils.escapeHtml(utils.formatCount(analysisMeta.excludedIntegrityCount))}</span></div>
      `;
    }
    if (analysisMeta.excludedWeakTemporalCount && TEMPORAL_CRITERIA.has(perf().criterion)) {
      els.performanceCriteriaBar.innerHTML += `
        <div class="performance-criteria-pill warn"><span class="label">Excluded weak temporal rows</span><span>${utils.escapeHtml(utils.formatCount(analysisMeta.excludedWeakTemporalCount))}</span></div>
      `;
    }
  }

  function metricReadText() {
    switch (perf().metric) {
      case 'avg_dollars': return 'This is total dollars divided by the number of normalized events in the comparison group. It is safer than raw totals when sample sizes differ.';
      case 'total_dollars': return 'This is raw dollars represented by the filtered events, so groups with more events can dominate.';
      case 'airings': return 'This is the count of normalized events used in the comparison.';
      case 'avg_pledges': return 'This is total pledges divided by airings, useful when you care more about response volume than dollars alone.';
      case 'total_pledges': return 'This is raw pledge count represented by the filtered events.';
      case 'avg_sustainers': return 'This is total sustainers divided by airings, useful when you want to spot sustained giving strength.';
      case 'total_sustainers': return 'This is raw sustainer count represented by the filtered events.';
      case 'dollars_per_pledge': return 'This shows how much money each pledge was worth on average. Small pledge counts can make this wobble.';
      case 'dollars_per_minute': return 'This shows revenue efficiency by on-air minute, using imported program_minutes values.';
      case 'pledges_per_minute': return 'This shows response-rate efficiency by on-air minute.';
      default: return 'This is the selected metric for the current comparison.';
    }
  }

  function renderExplainTable(records, postFilter) {
    if (!els.performanceExplainBody) return;
    const meta = perf().analysisMeta || {};
    const rows = [
      ['Date window', perf().useAllDates ? 'All available dates' : (perf().startDate || perf().endDate ? `${utils.formatDate(perf().startDate || perf().dataShape?.oldestDate || null, 'Earliest available')} to ${utils.formatDate(perf().endDate || perf().dataShape?.newestDate || null, 'Latest available')}` : 'All available dates'), 'Filters use broadcast-day dates, so overnight hours before the boundary roll into the prior TV day.'],
      ['Broadcast day', `Starts ${utils.minutesToLabel(broadcastDayStartHour() * 60)}`, 'Anything before this hour is treated as part of the previous broadcast day for weekday/weekend and topic-slot logic.'],
      ['Quick filter', quickFilterLabel() || 'None', quickFilterExplanation() || 'No quick-filter-specific interpretation is active.'],
      ['Fundraiser month', perf().monthFilter === '' ? 'All months' : MONTH_NAMES[Number(perf().monthFilter)] || 'Unknown month', 'This cuts across years. “December” means every included row whose broadcast date lands in December.'],
      ['Day set', daySetLabel(perf().daySetFilter), perf().daySetFilter ? 'This limits the comparison to the selected slice of the week.' : 'Leave this on All week to see the full filter window. For day-part or topic timing work, split Mon-Fri, Saturday, and Sunday when the weekly average is too coarse.'],
      ['Topic filter', perf().topicFilter || 'All topics', perf().criterion === 'topic_time' ? 'Pick one main topic here to answer the real scheduling question: when does that topic perform best?' : perf().criterion === 'topic_dayset' ? 'This view becomes especially useful with no topic filter because it compares each topic across Mon-Fri, Saturday, and Sunday.' : 'Checks primary topic metadata inherited from the library.'],
      ['Compare by', criterionDisplayName(), perf().criterion === 'topic_time' ? 'Each row in the table is one broadcast-day and hour slot. The chart becomes a weekly heatmap so strong slots stand out fast.' : perf().criterion === 'topic_dayset' ? 'Each row in the heatmap is one topic split into Mon-Fri, Saturday, and Sunday.' : `Each row in the comparison table is one ${criterionDisplayName().toLowerCase()} bucket.`],
      ['Metric', metricLabel(), metricReadText()],
      ['Minimum airing warning', meta.minGroupAirings > 1 ? `${utils.formatCount(meta.minGroupAirings)} airings` : 'None', minSampleExplanation()],
      ['Source basis', 'Strict imported airings layer', `The app is reading ${utils.formatCount((perf().dataShape || {}).airingRows || 0)} imported airings rows, analytics trust only rows with explicit per-airing dollars, and non-specific fundraiser revenue is excluded from general analytics. Report totals are not allowed to masquerade as airing dollars.`],
      ['Program identity rule', 'Strict only', 'Program and topic analytics require a trustworthy identity path such as program id, NOLA, or exact title match. Fuzzy rematching is disabled.'],
      ['Schedule reconciliation', meta.excludedScheduleMismatchCount ? `${utils.formatCount(meta.excludedScheduleMismatchCount)} rows excluded` : 'No known schedule mismatches in this filter', 'Non-specific fundraiser revenue is not counted as a schedule mismatch. Only title-attributed rows inside a saved schedule window that still fail to reconcile are excluded here.'],
      ['Temporal confidence', confidenceLabel(), meta.noTemporalSupport ? 'Day/date/time comparisons do not have enough trustworthy airing-date evidence for this filter yet.' : meta.lowConfidenceTemporal ? 'There are some temporal matches, but the sample is small enough that the result can wobble.' : 'This comparison has enough temporal support to be usable, but still read the airing count.'],
      ['Premium metadata', 'Not actual viewer choice data', 'Premium comparisons currently mean “programs carrying premium metadata,” not which premium item viewers actually chose.'],
      ['How sturdy is this?', `${utils.formatCount(records.length)} rows from ${utils.formatCount(postFilter.length)} rows after non-label filters`, 'Small counts can make a result look dramatic while still being flimsy. Read the airing count and confidence badge next to every value.']
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
    notes.push(`${utils.formatCount(shape.recordsWithDateTime || 0)} normalized events include a usable broadcast date. ${utils.formatCount(shape.recordsWithExplicitTime || 0)} include an explicit time.`);
    notes.push(`${utils.formatCount(shape.identityTrustedRows || 0)} imported airings rows had trustworthy program identity. ${utils.formatCount(shape.weakIdentityRows || 0)} had weak identity and are blocked from program/topic analytics.`);
    notes.push(`${utils.formatCount(shape.recordsWithTopic || 0)} events inherited topic metadata from the library. ${utils.formatCount(shape.scheduleMismatchRows || 0)} normalized events were quarantined because they do not reconcile to a saved schedule placement.`);
    notes.push(`Imported airings currently represent ${utils.formatCount(shape.totalPledges || 0)} pledges, ${utils.formatCount(shape.totalSustainers || 0)} sustainers, and ${utils.formatCount(shape.totalMinutes || 0)} program minutes in this analytics layer.`);
    notes.push(`Broadcast-day logic starts at ${utils.minutesToLabel(broadcastDayStartHour() * 60)}, so post-midnight airings before that time are treated as part of the previous TV day.`);
    if (shape.annotatedTitleRows) notes.push(`${utils.formatCount(shape.annotatedTitleRows || 0)} imported rows look like they contain title annotations or notes. Those rows are still allowed if their identity matches cleanly, but they are called out here because they deserve eyeballs.`);
    notes.push('Average dollars per airing is still the safest headline metric when sample sizes differ, but the added pledge, sustainer, and per-minute metrics help expose cases where dollars alone lie by omission.');
    notes.push('Premium analysis is metadata-only for now. It does not know which premium item viewers actually chose.');
    notes.push('Letter campaign pledges and online pledges are not wired into this performance layer yet, so they are not included in these totals.');
    if (meta.noTemporalSupport) notes.push('Day/date/time views are intentionally cautious now: weak unmatched rows are excluded, and if nothing trustworthy remains the comparison is marked unavailable instead of pretending to know.');
    if (perf().criterion === 'topic_time') {
      if (perf().topicFilter) {
        const best = [...groups].sort((a, b) => metricValue(b) - metricValue(a))[0];
        if (best) notes.push(`${perf().topicFilter} is currently strongest at ${best.label} based on ${utils.formatCount(best.airingCount)} airing${best.airingCount === 1 ? '' : 's'} in the active filter window.`);
      } else {
        notes.push('Topic Time Performance is most useful with a main topic selected. Without a topic filter, the heatmap blends every topic together.');
      }
    }
    if (perf().criterion === 'topic_dayset') notes.push('Topic week split is the fast read for whether a topic behaves differently on weekdays, Saturday, and Sunday.');
    if (perf().warnings?.length) notes.push(...perf().warnings);
    els.performanceSourceNotes.innerHTML = `
      <ul class="performance-note-list">
        ${notes.map((note) => `<li>${utils.escapeHtml(note)}</li>`).join('')}
      </ul>
      <div class="performance-footnote"><strong>Filtered scope:</strong> ${utils.escapeHtml(utils.formatCount(records.length))} events feeding ${utils.escapeHtml(utils.formatCount(groups.length))} comparison groups.</div>
    `;
  }

  function buildTopicIntelligenceGroups() {
    const source = (perf().scopedRecords || []).filter((record) => integrityEligible(record, 'topic_time') && temporalEligibility(record, 'topic_time'));
    const slotMap = new Map();
    const daySetMap = new Map();
    source.forEach((record) => {
      const slotLabel = topicTimeLabel(record);
      if (!slotMap.has(slotLabel)) slotMap.set(slotLabel, { label: slotLabel, airingCount: 0, totalDollars: 0, totalPledges: 0, totalSustainers: 0, totalMinutes: 0, titles: new Set(), titleCount: 0, dayIndex: DAY_ORDER.indexOf(dayLabel(record)), hourOfDay: record.when?.getHours?.() ?? null, topicTimeSortKey: topicTimeSortKey(record), belowSampleThreshold: false });
      const slot = slotMap.get(slotLabel);
      slot.airingCount += 1;
      slot.totalDollars += Number(record.amount || 0) || 0;
      slot.totalPledges += Number(record.pledges || 0) || 0;
      slot.totalSustainers += Number(record.sustainers || 0) || 0;
      slot.totalMinutes += Number(record.minutes || 0) || 0;
      slot.titles.add(record.title || 'Unknown title');
      const slice = daySetLabel(daySetKeyForRecord(record));
      if (!daySetMap.has(slice)) daySetMap.set(slice, { label: slice, airingCount: 0, totalDollars: 0, totalPledges: 0, totalSustainers: 0, totalMinutes: 0, titles: new Set(), titleCount: 0 });
      const bucket = daySetMap.get(slice);
      bucket.airingCount += 1;
      bucket.totalDollars += Number(record.amount || 0) || 0;
      bucket.totalPledges += Number(record.pledges || 0) || 0;
      bucket.totalSustainers += Number(record.sustainers || 0) || 0;
      bucket.totalMinutes += Number(record.minutes || 0) || 0;
      bucket.titles.add(record.title || 'Unknown title');
    });
    const finalize = (group) => ({
      ...group,
      avgDollars: group.airingCount ? group.totalDollars / group.airingCount : 0,
      avgPledges: group.airingCount ? group.totalPledges / group.airingCount : 0,
      avgSustainers: group.airingCount ? group.totalSustainers / group.airingCount : 0,
      dollarsPerPledge: group.totalPledges > 0 ? group.totalDollars / group.totalPledges : 0,
      dollarsPerMinute: group.totalMinutes > 0 ? group.totalDollars / group.totalMinutes : 0,
      pledgesPerMinute: group.totalMinutes > 0 ? group.totalPledges / group.totalMinutes : 0,
      titleCount: group.titles.size,
      titles: [...group.titles],
      belowSampleThreshold: minSampleThreshold() > 1 && group.airingCount < minSampleThreshold()
    });
    return {
      slotGroups: [...slotMap.values()].map(finalize).sort((a, b) => {
        const diff = metricValue(b) - metricValue(a);
        if (diff !== 0) return diff;
        return (a.topicTimeSortKey ?? 9999) - (b.topicTimeSortKey ?? 9999);
      }),
      daySetGroups: [...daySetMap.values()].map(finalize).sort((a, b) => {
        const order = { 'Mon-Fri': 0, 'Saturday': 1, 'Sunday': 2 };
        return (order[a.label] ?? 99) - (order[b.label] ?? 99);
      })
    };
  }

  function renderSchedulingIntelligence() {
    if (!els.performanceIntelligence) return;
    const toggleCompareControls = (show) => {
      if (els.performanceSlotCompareControls) els.performanceSlotCompareControls.classList.toggle('hidden', !show);
      if (els.performanceSlotCompareA) els.performanceSlotCompareA.disabled = !show;
      if (els.performanceSlotCompareB) els.performanceSlotCompareB.disabled = !show;
    };
    if (els.performanceIntelligencePill) els.performanceIntelligencePill.textContent = perf().topicFilter ? `For ${perf().topicFilter}` : 'Choose a main topic';
    if (!perf().topicFilter) {
      toggleCompareControls(false);
      renderSelectOptions(els.performanceSlotCompareA, [], '', 'Choose a main topic above');
      renderSelectOptions(els.performanceSlotCompareB, [], '', 'Choose a main topic above');
      els.performanceIntelligence.innerHTML = '<div class="performance-intelligence-empty">Choose a main topic above to see the best slot overall, the best Mon-Fri/Saturday/Sunday slices, and a head-to-head slot comparison.</div>';
      return;
    }
    const { slotGroups, daySetGroups } = buildTopicIntelligenceGroups();
    if (!slotGroups.length) {
      toggleCompareControls(false);
      renderSelectOptions(els.performanceSlotCompareA, [], '', 'No slot data');
      renderSelectOptions(els.performanceSlotCompareB, [], '', 'No slot data');
      els.performanceIntelligence.innerHTML = '<div class="performance-intelligence-empty">Not enough trustworthy dated rows are available for this topic in the current filter window.</div>';
      return;
    }
    toggleCompareControls(true);
    const options = slotGroups.map((group) => ({ value: group.label, label: `${group.label} · ${metricDisplay(group)}` }));
    if (!perf().slotCompareA || !slotGroups.some((group) => group.label === perf().slotCompareA)) perf().slotCompareA = slotGroups[0]?.label || '';
    if (!perf().slotCompareB || !slotGroups.some((group) => group.label === perf().slotCompareB) || perf().slotCompareB === perf().slotCompareA) perf().slotCompareB = slotGroups[1]?.label || slotGroups[0]?.label || '';
    renderSelectOptions(els.performanceSlotCompareA, options, perf().slotCompareA, 'Choose slot');
    renderSelectOptions(els.performanceSlotCompareB, options, perf().slotCompareB, 'Choose slot');
    const bestOverall = slotGroups[0];
    const bySlice = {
      weekday: daySetGroups.find((group) => group.label === 'Mon-Fri') || null,
      saturday: daySetGroups.find((group) => group.label === 'Saturday') || null,
      sunday: daySetGroups.find((group) => group.label === 'Sunday') || null
    };
    const slotA = slotGroups.find((group) => group.label === perf().slotCompareA) || bestOverall;
    const slotB = slotGroups.find((group) => group.label === perf().slotCompareB) || slotGroups[1] || bestOverall;
    const insightCard = (title, group, extra = '') => {
      if (!group) return `<article class="performance-insight-card"><h4>${utils.escapeHtml(title)}</h4><div class="performance-insight-value">No data</div><div class="performance-insight-meta">Nothing trustworthy in this slice yet.</div></article>`;
      return `<article class="performance-insight-card"><h4>${utils.escapeHtml(title)}</h4><div class="performance-insight-value">${utils.escapeHtml(group.label)}</div><div class="performance-insight-meta">${utils.escapeHtml(metricDisplay(group, { includeCount: true }))}${extra ? ` · ${utils.escapeHtml(extra)}` : ''}</div></article>`;
    };
    const compareRows = [
      ['Airings', utils.formatCount(slotA.airingCount), utils.formatCount(slotB.airingCount)],
      ['Total dollars', utils.formatMoney(slotA.totalDollars), utils.formatMoney(slotB.totalDollars)],
      ['Total pledges', utils.formatCount(slotA.totalPledges), utils.formatCount(slotB.totalPledges)],
      ['Total sustainers', utils.formatCount(slotA.totalSustainers), utils.formatCount(slotB.totalSustainers)],
      ['Program minutes', utils.formatCount(slotA.totalMinutes), utils.formatCount(slotB.totalMinutes)],
      [metricLabel(), metricDisplay(slotA), metricDisplay(slotB)],
      ['Confidence', confidenceForGroup(slotA), confidenceForGroup(slotB)]
    ];
    const delta = metricValue(slotA) - metricValue(slotB);
    const winnerText = delta === 0 ? 'These two slots are tied on the selected metric in the current filter window.' : `${delta > 0 ? slotA.label : slotB.label} is currently ahead on ${metricLabel().toLowerCase()}.`;
    els.performanceIntelligence.innerHTML = `
      <div class="performance-mini-note">Scheduling intelligence respects the current date window, month filter, and broadcast-day boundary. Overnight airings before ${utils.escapeHtml(utils.minutesToLabel(broadcastDayStartHour() * 60))} are rolled into the previous TV day.</div>
      <div class="performance-intelligence-grid">
        ${insightCard('Best slot overall', bestOverall, confidenceForGroup(bestOverall))}
        ${insightCard('Best Mon-Fri slice', bySlice.weekday, confidenceForGroup(bySlice.weekday || {}))}
        ${insightCard('Best Saturday slice', bySlice.saturday, confidenceForGroup(bySlice.saturday || {}))}
        ${insightCard('Best Sunday slice', bySlice.sunday, confidenceForGroup(bySlice.sunday || {}))}
      </div>
      <div class="performance-slot-compare-wrap table-wrap">
        <table class="programs-table performance-slot-compare-table">
          <thead>
            <tr>
              <th>Measure</th>
              <th>${utils.escapeHtml(slotA?.label || 'Slot A')}</th>
              <th>${utils.escapeHtml(slotB?.label || 'Slot B')}</th>
            </tr>
          </thead>
          <tbody>
            ${compareRows.map(([label, a, b]) => `<tr><td>${utils.escapeHtml(label)}</td><td>${utils.escapeHtml(String(a))}</td><td>${utils.escapeHtml(String(b))}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="performance-mini-note">${utils.escapeHtml(winnerText)}</div>
    `;
  }

  function collectTopicOptions() {
    const labels = new Map();
    (state.rawRows || []).forEach((row) => {
      const token = utils.normalizeText(derive.topicPrimary(row));
      const key = utils.normalizeLookupKey(token);
      if (key && !labels.has(key)) labels.set(key, token);
    });
    (perf().records || []).forEach((record) => {
      const token = utils.normalizeText(record.topicDisplay || record.topic || '');
      const key = utils.normalizeLookupKey(token);
      if (key && token !== 'Unassigned' && !labels.has(key)) labels.set(key, token);
    });
    return [...labels.values()].sort((a, b) => utils.compareText(a, b));
  }

  function collectProgramOptions() {
    const labels = new Map();
    const nonSpecificValue = utils.normalizeLookupKey(utils.canonicalNonSpecificNola());
    const addOption = (value, label) => {
      const safeLabel = utils.normalizeText(label || '');
      const normalizedNonSpecific = utils.isNonSpecificTitle(safeLabel) || utils.isNonSpecificNola(value || '');
      const safeValue = normalizedNonSpecific
        ? nonSpecificValue
        : utils.normalizeLookupKey(value || '');
      const finalLabel = normalizedNonSpecific ? utils.canonicalNonSpecificTitle() : safeLabel;
      if (!safeValue || !finalLabel) return;
      if (!labels.has(safeValue)) labels.set(safeValue, finalLabel);
    };
    (perf().records || []).forEach((record) => {
      addOption(record.programId || record.nolaCode || record.title || '', record.title || 'Unknown title');
      addOption(record.title || '', record.title || 'Unknown title');
    });
    (state.rawRows || []).forEach((row) => {
      addOption(derive.programId(row) || derive.nola(row) || derive.title(row) || '', derive.title(row) || 'Unknown title');
      addOption(derive.title(row) || '', derive.title(row) || 'Unknown title');
    });
    return [...labels.entries()]
      .sort((a, b) => utils.compareText(a[1], b[1]))
      .map(([value, label]) => ({ value, label }));
  }

  function quickFilterLabel(name = perf().quickFilter) {
    const labels = {
      top_earners: 'Top earners',
      best_average: 'Best average earners',
      prime_time: 'Prime time winners',
      live_break_impact: 'Live break impact',
      repeat_fatigue: 'Repeat fatigue',
      topic_winners: 'Top Topics',
      topic_time_performance: 'Topic Time Performance',
      topic_slot_winners: 'Topic winners by slot',
      topic_week_split: 'Topic week split',
      recent_momentum: 'Recent momentum',
      weekend_weekday: 'Weekend vs weekday earnings',
      day_of_week: 'Day of week comparisons',
      daypart: 'Day-part comparisons',
      weekday_dayparts: 'Weekday day-parts',
      saturday_dayparts: 'Saturday day-parts',
      sunday_dayparts: 'Sunday day-parts',
      daypart_heatmap: 'Day-part heatmap',
      best_daytime: 'Best daytime performers'
    };
    return labels[name] || '';
  }

  function quickFilterExplanation(name = perf().quickFilter) {
    const endText = perf().endDate ? utils.formatDate(perf().endDate) : 'the latest available date';
    switch (name) {
      case 'top_earners':
        return 'Ranks titles by total dollars in the selected window, so the programs that brought in the most money overall rise to the top.';
      case 'best_average':
        return 'Ranks titles by average dollars per airing, which helps separate efficient earners from titles that only look big because they aired a lot.';
      case 'prime_time':
        return 'Limits the comparison to Prime time airings and then ranks the titles by average dollars per airing inside that slice.';
      case 'live_break_impact':
        return 'Compares only rows that cleanly matched a schedule placement with a live-break flag. Unmatched rows are excluded so “Unknown” does not swamp the result.';
      case 'repeat_fatigue':
        return 'Shows only programs with at least 2 airings in the current filter window. Use it as a repeated-titles view for now; it still is not a true first-vs-repeat decay curve.';
      case 'recent_momentum':
        return `“Recent” means the trailing 90 days ending on ${endText}. This is a recent-results slice, not yet a full prior-period momentum comparison.`;
      case 'topic_time_performance':
        return perf().topicFilter
          ? 'This view ranks day/hour slots for the selected main topic and also draws a weekly heatmap so you can see when that topic performs best.'
          : 'Pick a main topic to make this view useful. Without a topic filter, the heatmap blends every topic together.';
      case 'topic_winners':
        return 'Ranks main topics by average dollars per qualified airing. This is not the same thing as top individual programs.';
      case 'topic_slot_winners':
        return 'Shows which main topic currently wins each day-and-30-minute slot, with long programs split across the half-hour blocks they actually occupy, so you can stop guessing whether Thursday at 7:00 AM wants Health, Science, or something else.';
      case 'topic_week_split':
        return 'Splits topics into Mon-Fri, Saturday, and Sunday buckets so you can stop pretending the whole week behaves the same way.';
      case 'weekend_weekday':
        return 'Compares weekday versus weekend earnings so you can see whether the broad weekly pattern shifts before drilling down to exact days or times.';
      case 'day_of_week':
        return 'Compares Monday through Sunday directly so you can see whether certain days consistently pull better numbers than others.';
      case 'daypart':
        return 'Compares major day-parts with separate Mon-Fri, Saturday, and Sunday lines so broad averages do not hide the weekend pattern.';
      case 'weekday_dayparts':
      case 'saturday_dayparts':
      case 'sunday_dayparts':
        return 'These quick filters narrow day-part analysis to one slice of the week so Saturday and Sunday do not get blended into the weekday pattern.';
      case 'daypart_heatmap':
        return 'This heatmap splits day-parts into separate Mon-Fri, Saturday, and Sunday rows so broad weekly day-part averages stop hiding the weekend story.';
      case 'best_daytime':
        return 'Limits the view to Daytime airings, then ranks titles by average dollars per airing inside that daytime slice.';
      default:
        return '';
    }
  }

  function quickFilterPresetSummary(name) {
    const cfg = QUICK_FILTERS[name];
    if (!cfg) return '';
    const parts = [];
    if (cfg.criterion) parts.push(`Compare by ${criterionLabel(cfg.criterion).toLowerCase()}`);
    if (cfg.metric) parts.push(`metric ${metricLabel(cfg.metric).toLowerCase()}`);
    if (cfg.chartType && cfg.chartType !== 'auto') parts.push(`${chartTypeLabel(cfg.chartType).toLowerCase()} chart`);
    if (cfg.topN && cfg.topN < 999) parts.push(`show top ${cfg.topN}`);
    if (cfg.daySetFilter) parts.push(`starts with ${daySetLabel(cfg.daySetFilter)}`);
    if (cfg.daypartScope) parts.push(`${cfg.daypartScope.toLowerCase()} only`);
    if (cfg.weekpartScope) parts.push(`${cfg.weekpartScope.toLowerCase()} only`);
    return parts.length ? `${parts.join(', ')}.` : '';
  }

  function quickFilterLearningSummary(name) {
    switch (name) {
      case 'top_earners':
        return 'Use this when you want the biggest total money-makers, even if they got there by airing more often.';
      case 'best_average':
        return 'Use this when you want the most efficient titles per airing instead of the biggest grossers.';
      case 'prime_time':
        return 'Use this to see which titles really deserve a strong evening slot.';
      case 'live_break_impact':
        return 'Use this to see whether live-break placements are helping or hurting the money.';
      case 'repeat_fatigue':
        return 'Use this to look for repeated titles that may be wearing out their welcome.';
      case 'topic_winners':
        return 'Use this for broad strategy: which topics tend to win, regardless of individual title.';
      case 'topic_time_performance':
        return 'Use this when you want to know when a selected topic tends to work best during the week.';
      case 'topic_slot_winners':
        return 'Use this to answer “what topic should own this 30-minute slot?” instead of “what single title happened to do well there?”';
      case 'topic_week_split':
        return 'Use this to see whether a topic behaves differently on weekdays, Saturdays, and Sundays.';
      case 'recent_momentum':
        return 'Use this when you care more about what is working lately than long-run library history.';
      case 'weekend_weekday':
        return 'Use this for a first pass on whether the whole weekend behaves differently from weekdays.';
      case 'day_of_week':
        return 'Use this when day choice matters more than exact time choice.';
      case 'daypart':
        return 'Use this for broad “morning/daytime/prime” strategy before getting down to exact hours.';
      case 'weekday_dayparts':
      case 'saturday_dayparts':
      case 'sunday_dayparts':
        return 'Use these when you want the day-part story for one slice of the week without the others polluting it.';
      case 'daypart_heatmap':
        return 'Use this when you want a compact visual of where the strongest day-parts live across the week slices.';
      case 'best_daytime':
        return 'Use this to see which titles are worth protecting in daytime hours.';
      default:
        return quickFilterExplanation(name) || 'Use this quick filter to jump straight to a preset comparison without manually setting every control.';
    }
  }

  function quickFilterControlImpact(name) {
    const notes = [
      'Changing the date range or turning on Use all available dates changes which fundraiser airings are included.',
      'Changing Fundraiser month, Day set, Main topic, Program, or the label search narrows the same quick filter instead of turning it off.',
      'Changing Compare by, Metric, or Chart type turns this back into a custom view because those settings replace the quick-filter preset.'
    ];
    if (name === 'topic_time_performance' && !perf().topicFilter) {
      notes.splice(1, 0, 'This one becomes much more useful after you pick a Main topic, because otherwise every topic is blended together.');
    }
    if (name === 'topic_slot_winners') {
      notes.splice(1, 0, 'Main topic usually stays blank here on purpose, because the whole point is to compare topics against each other for each slot.');
    }
    if (['weekday_dayparts', 'saturday_dayparts', 'sunday_dayparts'].includes(name)) {
      notes.splice(1, 0, 'The Day set starts prefilled for this quick filter, but you can still change it if you want to pivot to a different week slice.');
    }
    return notes;
  }

  function quickFilterTooltipData(name) {
    const label = quickFilterLabel(name) || 'Quick filter';
    return {
      title: label,
      learn: quickFilterLearningSummary(name),
      preset: quickFilterPresetSummary(name),
      explain: quickFilterExplanation(name),
      effects: quickFilterControlImpact(name)
    };
  }

  let quickFilterTooltipEl = null;

  function ensureQuickFilterTooltipEl() {
    if (quickFilterTooltipEl && document.body.contains(quickFilterTooltipEl)) return quickFilterTooltipEl;
    quickFilterTooltipEl = document.createElement('div');
    quickFilterTooltipEl.className = 'quick-filter-tooltip hidden';
    quickFilterTooltipEl.setAttribute('role', 'tooltip');
    document.body.appendChild(quickFilterTooltipEl);
    return quickFilterTooltipEl;
  }

  function updateQuickFilterTooltips() {
    document.querySelectorAll('[data-performance-quick-filter]').forEach((button) => {
      const name = button.dataset.performanceQuickFilter || '';
      const tip = quickFilterTooltipData(name);
      button.removeAttribute('title');
      button.setAttribute('aria-label', `${tip.title}. ${tip.learn}`);
    });
  }

  function renderQuickFilterTooltipHtml(name) {
    const tip = quickFilterTooltipData(name);
    const effectItems = tip.effects.map((line) => `<li>${utils.escapeHtml(line)}</li>`).join('');
    return `
      <div class="quick-filter-tooltip-title">${utils.escapeHtml(tip.title)}</div>
      <div class="quick-filter-tooltip-block"><strong>What you can learn</strong><p>${utils.escapeHtml(tip.learn)}</p></div>
      ${tip.preset ? `<div class="quick-filter-tooltip-block"><strong>Preset</strong><p>${utils.escapeHtml(tip.preset)}</p></div>` : ''}
      ${tip.explain ? `<div class="quick-filter-tooltip-block"><strong>What it shows</strong><p>${utils.escapeHtml(tip.explain)}</p></div>` : ''}
      <div class="quick-filter-tooltip-block"><strong>Changing other filters</strong><ul>${effectItems}</ul></div>
    `;
  }

  function positionQuickFilterTooltip(button) {
    const tooltip = ensureQuickFilterTooltipEl();
    const rect = button.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const top = Math.max(8, rect.bottom + 10 + window.scrollY);
    let left = rect.left + window.scrollX;
    const maxLeft = window.scrollX + window.innerWidth - tooltipRect.width - 10;
    left = Math.min(Math.max(window.scrollX + 10, left), Math.max(window.scrollX + 10, maxLeft));
    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;
  }

  function showQuickFilterTooltip(button) {
    if (!button || button.disabled) return;
    const tooltip = ensureQuickFilterTooltipEl();
    const name = button.dataset.performanceQuickFilter || '';
    tooltip.innerHTML = renderQuickFilterTooltipHtml(name);
    tooltip.classList.remove('hidden');
    positionQuickFilterTooltip(button);
  }

  function hideQuickFilterTooltip() {
    if (quickFilterTooltipEl) quickFilterTooltipEl.classList.add('hidden');
  }

  function populateControls() {
    renderSelectOptions(els.performanceTopicSelect, collectTopicOptions(), perf().topicFilter, 'All main topics');
    if (els.performanceCriterionSelect) els.performanceCriterionSelect.value = perf().criterion;
    if (els.performanceMetricSelect) els.performanceMetricSelect.value = perf().metric;
    if (els.performanceDaySetSelect) els.performanceDaySetSelect.value = perf().daySetFilter || '';
    if (els.performanceChartTypeSelect) els.performanceChartTypeSelect.value = perf().chartType;
    if (els.performanceTopnSelect) {
      els.performanceTopnSelect.value = String(perf().topN);
      const usesTemporalAxis = TEMPORAL_CRITERIA.has(perf().criterion);
      els.performanceTopnSelect.disabled = usesTemporalAxis;
      els.performanceTopnSelect.title = usesTemporalAxis ? 'All groups are shown for date/day/time comparisons.' : '';
    }
    if (els.performanceFilterInput) els.performanceFilterInput.value = perf().labelFilter || '';
    if (els.performanceUseAllDates) els.performanceUseAllDates.checked = Boolean(perf().useAllDates);
    perf().includeExpiredPrograms = true;
    updateQuickFilterTooltips();
    const oldestDate = perf().dataShape?.oldestDate || '';
    const newestDate = perf().dataShape?.newestDate || '';
    if (els.performanceStartDate) {
      els.performanceStartDate.min = oldestDate || '';
      els.performanceStartDate.max = newestDate || '';
      els.performanceStartDate.value = perf().startDate || oldestDate || '';
      els.performanceStartDate.disabled = Boolean(perf().useAllDates);
    }
    if (els.performanceEndDate) {
      els.performanceEndDate.min = oldestDate || '';
      els.performanceEndDate.max = newestDate || '';
      els.performanceEndDate.value = perf().endDate || newestDate || '';
      els.performanceEndDate.disabled = Boolean(perf().useAllDates);
    }
    if (els.performanceMonthSelect) els.performanceMonthSelect.value = perf().monthFilter;
    if (els.performanceTopicSelect) els.performanceTopicSelect.value = perf().topicFilter;
    updateQuickFilterUi();
  }

  function renderAll() {
    if (!els.performanceChart || !els.performanceTableBody) return;
    normalizeQuickFilterSelection();
    populateControls();
    const { records, grouped, postFilter, integrityFiltered } = filterAndGroupRecords();
    renderStats(records);
    buildCriteriaSummary(records);
    renderExplainTable(records, postFilter);
    perf().topicSlotWinnerGroups = null;
    renderChart(perf().groups);
    renderTable(perf().groups);
    renderSlotDrilldown();
    renderSchedulingIntelligence();
    renderNotes(records, perf().groups);
    if (els.performanceChartTitle) {
      const focus = (['topic_time', 'topic_dayset'].includes(perf().criterion) && perf().topicFilter)
        ? ` · ${perf().topicFilter}`
        : (perf().criterion === 'daypart' && perf().daySetFilter ? ` · ${daySetLabel(perf().daySetFilter)}` : '');
      els.performanceChartTitle.textContent = perf().quickFilter === 'topic_slot_winners'
        ? 'Top topic by day + time slot'
        : `${metricLabel()} by ${criterionDisplayName()}${focus}`;
    }
    if (els.performanceChartPill) {
      const vizLabel = (['topic_time', 'topic_dayset'].includes(perf().criterion) || perf().quickFilter === 'topic_slot_winners') ? 'Heatmap' : chartTypeLabel(effectiveChartType());
      els.performanceChartPill.textContent = perf().ready ? `${vizLabel} · ${perf().quickFilter === 'topic_slot_winners' ? 'Topic winners' : criterionDisplayName()}` : 'Awaiting data';
    }
    if (els.performanceTablePill) els.performanceTablePill.textContent = `${utils.formatCount(perf().groups.length)} groups shown`;
    if (els.performanceNotesPill) els.performanceNotesPill.textContent = perf().lastLoadedAt ? `Loaded ${utils.formatDateTime(perf().lastLoadedAt)}` : 'Starter framework';
    const meta = perf().analysisMeta || {};
    const warn = meta.noTemporalSupport || meta.lowConfidenceTemporal || Boolean(perf().error);
    const tail = meta.noTemporalSupport
      ? 'Not enough trustworthy day/time evidence for this view yet.'
      : meta.lowConfidenceTemporal
        ? 'Small temporal sample — read it cautiously.'
        : `${utils.formatCount(records.length)} filtered rows after excluding ${utils.formatCount(meta.excludedIntegrityCount || 0)} suspect rows.`;
    const quickTail = quickFilterExplanation();
    setStatus(`Comparing ${criterionDisplayName().toLowerCase()} using ${metricLabel().toLowerCase()}. ${tail}${quickTail ? ` ${quickTail}` : ''}`, warn ? 'warn' : '');
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
      perf().titleSlotExpectationIndex = null;
      perf().titleOverallExpectationIndex = null;
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
    perf().excludedReviewRows = [];
    perf().topicSlotWinnerGroups = null;
    perf().titleSlotExpectationIndex = null;
    perf().titleOverallExpectationIndex = null;
    perf().slotDrillKey = '';
    perf().slotDrillMode = 'winner';
  }


  const QUICK_FILTERS = {
    top_earners: { criterion: 'program', metric: 'total_dollars', chartType: 'bar', topN: 12, monthFilter: '', topicFilter: '', labelFilter: '', programFilter: '', daySetFilter: '', daypartScope: '', weekpartScope: '' },
    best_average: { criterion: 'program', metric: 'avg_dollars', chartType: 'bar', topN: 12, monthFilter: '', topicFilter: '', labelFilter: '', programFilter: '', daySetFilter: '', daypartScope: '', weekpartScope: '' },
    prime_time: { criterion: 'program', metric: 'avg_dollars', chartType: 'bar', topN: 12, monthFilter: '', topicFilter: '', labelFilter: '', programFilter: '', daySetFilter: '', daypartScope: 'Prime time', weekpartScope: '' },
    live_break_impact: { criterion: 'live_breaks', metric: 'avg_dollars', chartType: 'bar', topN: 8, monthFilter: '', topicFilter: '', labelFilter: '', programFilter: '', daySetFilter: '', daypartScope: '', weekpartScope: '' },
    repeat_fatigue: { criterion: 'program', metric: 'avg_dollars', chartType: 'bar', topN: 12, monthFilter: '', topicFilter: '', labelFilter: '', programFilter: '', daySetFilter: '', daypartScope: '', weekpartScope: '' },
    topic_winners: { criterion: 'topic', metric: 'avg_dollars', chartType: 'bar', topN: 10, monthFilter: '', topicFilter: '', labelFilter: '', programFilter: '', daySetFilter: '', daypartScope: '', weekpartScope: '' },
    topic_time_performance: { criterion: 'topic_time', metric: 'avg_dollars', chartType: 'auto', topN: 999, monthFilter: '', labelFilter: '', programFilter: '', daySetFilter: '', daypartScope: '', weekpartScope: '' },
    topic_slot_winners: { criterion: 'time', metric: 'avg_dollars', chartType: 'heatmap', topN: 999, monthFilter: '', topicFilter: '', labelFilter: '', programFilter: '', daySetFilter: '', daypartScope: '', weekpartScope: '' },
    topic_week_split: { criterion: 'topic_dayset', metric: 'avg_dollars', chartType: 'auto', topN: 999, monthFilter: '', topicFilter: '', labelFilter: '', programFilter: '', daySetFilter: '', daypartScope: '', weekpartScope: '' },
    recent_momentum: { criterion: 'program', metric: 'avg_dollars', chartType: 'bar', topN: 10, monthFilter: '', topicFilter: '', labelFilter: '', programFilter: '', daySetFilter: '', daypartScope: '', weekpartScope: '' },
    weekend_weekday: { criterion: 'weekpart', metric: 'avg_dollars', chartType: 'bar', topN: 8, monthFilter: '', topicFilter: '', labelFilter: '', programFilter: '', daySetFilter: '', daypartScope: '', weekpartScope: '' },
    day_of_week: { criterion: 'day', metric: 'avg_dollars', chartType: 'bar', topN: 8, monthFilter: '', topicFilter: '', labelFilter: '', programFilter: '', daySetFilter: '', daypartScope: '', weekpartScope: '' },
    daypart: { criterion: 'daypart', metric: 'avg_dollars', chartType: 'split_line', topN: 8, monthFilter: '', topicFilter: '', labelFilter: '', programFilter: '', daySetFilter: '', daypartScope: '', weekpartScope: '' },
    weekday_dayparts: { criterion: 'daypart', metric: 'avg_dollars', chartType: 'bar', topN: 8, monthFilter: '', topicFilter: '', labelFilter: '', programFilter: '', daySetFilter: 'mon_fri', daypartScope: '', weekpartScope: '' },
    saturday_dayparts: { criterion: 'daypart', metric: 'avg_dollars', chartType: 'bar', topN: 8, monthFilter: '', topicFilter: '', labelFilter: '', programFilter: '', daySetFilter: 'saturday', daypartScope: '', weekpartScope: '' },
    sunday_dayparts: { criterion: 'daypart', metric: 'avg_dollars', chartType: 'bar', topN: 8, monthFilter: '', topicFilter: '', labelFilter: '', programFilter: '', daySetFilter: 'sunday', daypartScope: '', weekpartScope: '' },
    daypart_heatmap: { criterion: 'daypart', metric: 'avg_dollars', chartType: 'heatmap', topN: 8, monthFilter: '', topicFilter: '', labelFilter: '', programFilter: '', daySetFilter: '', daypartScope: '', weekpartScope: '' },
    best_daytime: { criterion: 'program', metric: 'avg_dollars', chartType: 'bar', topN: 10, monthFilter: '', topicFilter: '', labelFilter: '', programFilter: '', daySetFilter: '', daypartScope: 'Daytime', weekpartScope: '' }
  };

  function normalizeQuickFilterSelection() {
    const active = perf().quickFilter || '';
    if (active && !QUICK_FILTERS[active]) perf().quickFilter = '';
  }


  function quickFiltersEnabled() {
    return Boolean(perf().useAllDates || (perf().startDate && perf().endDate));
  }

  function updateQuickFilterUi() {
    normalizeQuickFilterSelection();
    const enabled = quickFiltersEnabled();
    const active = perf().quickFilter || '';
    document.querySelectorAll('[data-performance-quick-filter]').forEach((button) => {
      button.disabled = !enabled;
      button.classList.toggle('active', button.dataset.performanceQuickFilter === active);
    });
    if (els.performanceQuickFilterPill) els.performanceQuickFilterPill.textContent = enabled ? (active ? quickFilterLabel(active) : 'Ready') : 'Set a date range first';
    updateQuickFilterTooltips();
  }

  function applyQuickFilter(name) {
    normalizeQuickFilterSelection();
    const cfg = QUICK_FILTERS[name];
    if (!cfg || !quickFiltersEnabled()) return;
    Object.assign(perf(), cfg, { quickFilter: name });
    perf().slotDrillKey = '';
    perf().slotDrillMode = 'winner';
    if (name === 'recent_momentum' && perf().endDate) {
      const end = new Date(`${perf().endDate}T12:00:00`);
      const start = new Date(end.getTime());
      start.setDate(end.getDate() - 89);
      perf().startDate = localDateKey(start);
    }
    renderAll();
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
    els.performanceCriterionSelect?.addEventListener('change', (event) => { perf().criterion = event.target.value || 'topic'; perf().quickFilter = ''; rerender(); });
    els.performanceMetricSelect?.addEventListener('change', (event) => { perf().metric = event.target.value || 'avg_dollars'; perf().quickFilter = ''; rerender(); });
    els.performanceChartTypeSelect?.addEventListener('change', (event) => { perf().chartType = event.target.value || 'auto'; perf().quickFilter = ''; rerender(); });
    els.performanceTopnSelect?.addEventListener('change', (event) => { perf().topN = Number(event.target.value || 12); rerender(); });
    els.performanceFilterInput?.addEventListener('input', (event) => { perf().labelFilter = event.target.value || ''; rerender(); });
    els.performanceStartDate?.addEventListener('change', (event) => { perf().startDate = event.target.value || ''; perf().useAllDates = false; rerender(); });
    els.performanceEndDate?.addEventListener('change', (event) => { perf().endDate = event.target.value || ''; perf().useAllDates = false; rerender(); });
    els.performanceUseAllDates?.addEventListener('change', (event) => { perf().useAllDates = Boolean(event.target.checked); rerender(); });
    els.performanceMonthSelect?.addEventListener('change', (event) => { perf().monthFilter = event.target.value; rerender(); });
    els.performanceDaySetSelect?.addEventListener('change', (event) => { perf().daySetFilter = event.target.value || ''; rerender(); });
    els.performanceTopicSelect?.addEventListener('change', (event) => { perf().topicFilter = event.target.value || ''; rerender(); });
    els.performanceSlotCompareA?.addEventListener('change', (event) => { perf().slotCompareA = event.target.value || ''; renderSchedulingIntelligence(); });
    els.performanceSlotCompareB?.addEventListener('change', (event) => { perf().slotCompareB = event.target.value || ''; renderSchedulingIntelligence(); });
    els.performanceProgramSelect?.addEventListener('change', (event) => {
      perf().programFilter = event.target.value || '';
      if (perf().programFilter && perf().criterion === 'program') perf().criterion = 'date';
      rerender();
    });
    els.performanceRefreshButton?.addEventListener('click', async () => { await refreshData(); renderAll(); });
    els.performanceExportButton?.addEventListener('click', exportChartSvg);
    document.querySelectorAll('[data-performance-quick-filter]').forEach((button) => {
      button.addEventListener('click', () => applyQuickFilter(button.dataset.performanceQuickFilter || ''));
      button.addEventListener('mouseenter', () => showQuickFilterTooltip(button));
      button.addEventListener('focus', () => showQuickFilterTooltip(button));
      button.addEventListener('mouseleave', hideQuickFilterTooltip);
      button.addEventListener('blur', hideQuickFilterTooltip);
    });
    const handleSlotDrillClick = (event) => {
      if (event.target?.closest?.('[data-program-open-id], a')) return;
      const trigger = event.target?.closest?.('[data-performance-drill-key], [data-slot-drill-key]');
      if (!trigger) return;
      perf().slotDrillKey = trigger.dataset.performanceDrillKey || trigger.dataset.slotDrillKey || '';
      perf().slotDrillMode = 'winner';
      renderAll();
    };
    els.performanceChart?.addEventListener('click', handleSlotDrillClick);
    els.performanceTableBody?.addEventListener('click', handleSlotDrillClick);
    els.performanceSlotDrilldown?.addEventListener('click', (event) => {
      const modeButton = event.target?.closest?.('[data-slot-drill-mode]');
      if (!modeButton) return;
      perf().slotDrillMode = modeButton.dataset.slotDrillMode || 'all';
      renderSlotDrilldown();
    });
    window.addEventListener('scroll', hideQuickFilterTooltip, { passive: true });
    window.addEventListener('resize', hideQuickFilterTooltip);
  }

  function getExcludedReviewRows() {
    if (!perf().ready) return [];
    filterAndGroupRecords();
    return [...(perf().excludedReviewRows || [])];
  }

  App.performanceUi = { ensureReady, refreshData, renderAll, bindEvents, reset, populateControls, getExcludedReviewRows, getScheduleExpectationForPlacement };
})();
