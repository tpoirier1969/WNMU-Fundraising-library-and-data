(() => {
  const App = window.PledgeLib;
  const { state, utils, derive } = App;
  const { els, setNotice, renderSelectOptions } = App.dom;

  const DATETIME_KEYS = ['aired_at', 'air_datetime', 'air_date', 'drive_date', 'broadcast_at', 'scheduled_at', 'date_time', 'datetime', 'airing_at', 'airing_date'];
  const TIME_ONLY_KEYS = ['air_time', 'time_of_day', 'scheduled_time', 'slot_time', 'airtime', 'broadcast_time'];
  const AIRING_MONEY_KEYS = ['dollars'];
  const DRIVE_MONEY_KEYS = ['total_dollars', 'dollars'];
  const LOCAL_BREAK_KEYS = ['local_breaks', 'local_break_count', 'local_cutins_count', 'local_cutin_count', 'local_cutins', 'legacy_has_local_cutins_raw'];
  const LIVE_BREAK_KEYS = ['live_breaks', 'live_break_count', 'live_break_flag', 'live_break_notes', 'live_break_note'];
  const PREMIUM_KEYS = ['premium_summary', 'premiums', 'premium_notes', 'premium_offer', 'premium_description'];
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAY_ORDER = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const TEMPORAL_CRITERIA = new Set(['date', 'day', 'time', 'daypart', 'weekpart', 'topic_time']);
  const MIN_SAMPLE_DEFAULT = 1;
  const MIN_SAMPLE_TOPIC_AVERAGE = 2;

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

  function topicTimeSortKey(record) {
    if (!record?.hasDate || !record?.hasExplicitTime || !(record.when instanceof Date) || Number.isNaN(record.when.getTime())) return Number.MAX_SAFE_INTEGER;
    const dayIndex = DAY_ORDER.indexOf(dayLabel(record));
    const hour = record.when.getHours();
    return ((dayIndex < 0 ? 99 : dayIndex) * 24) + hour;
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

  function daypartLabel(record) {
    if (!record?.hasExplicitTime || !(record.when instanceof Date) || Number.isNaN(record.when.getTime())) return 'Unknown day-part';
    const hour = record.when.getHours();
    if (hour < 9) return 'Overnight / early morning';
    if (hour < 17) return 'Daytime';
    if (hour < 19) return 'Early evening';
    if (hour < 23) return 'Prime time';
    return 'Late night';
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
    const importedTitle = utils.firstNonEmpty(row?.imported_program_title, row?.title, row?.program_title, row?.name, '');
    const matchedLibraryTitle = utils.firstNonEmpty(row?.matched_library_title, '');
    const id = utils.normalizeLookupKey(utils.firstNonEmpty(row?.program_id, row?.pledge_program_id, row?.id));
    if (id && indexes.byId.has(id)) {
      return { programRow: indexes.byId.get(id), matchSource: 'program_id', trusted: true, importedTitle, matchedLibraryTitle };
    }
    const nola = utils.normalizeLookupKey(utils.firstNonEmpty(row?.nola_code, row?.nola, row?.program_nola));
    if (nola && indexes.byNola.has(nola)) {
      return { programRow: indexes.byNola.get(nola), matchSource: 'nola', trusted: true, importedTitle, matchedLibraryTitle };
    }
    const titleCandidates = [matchedLibraryTitle, utils.firstNonEmpty(row?.title, row?.program_title, row?.name), importedTitle]
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
      matchSource: utils.normalizeText(row?.match_method) || 'unmatched',
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
    return utils.normalizeLookupKey(
      utils.firstNonEmpty(
        programRow ? derive.programId(programRow) : '',
        fallback?.programId,
        fallback?.program_id,
        fallback?.pledge_program_id,
        programRow ? derive.nola(programRow) : '',
        fallback?.nola_code,
        fallback?.nola,
        programRow ? derive.title(programRow) : '',
        fallback?.programTitle,
        fallback?.program_title,
        fallback?.title,
        fallback?.name
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
        const liveBreak = placement?.liveBreakFlag === true;
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
    const dateKey = localDateKey(record.when);
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
    const dateKey = record?.hasDate && record.when instanceof Date && !Number.isNaN(record.when.getTime()) ? localDateKey(record.when) : '';
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
          driveRows: 0,
          airingRows: 0,
          matchedDriveRows: 0,
          estimatedOnly: false,
          when: null,
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
          nolaCode: '',
          signature: '',
          matchSource: 'unmatched',
          identityTrusted: false,
          moneyTrusted: false,
          moneySources: [],
          integrityFlags: [],
          titleAnnotated: false,
          isNonSpecific: false,
          sourceFiles: new Set()
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
      if (!record.when && temporal?.when) record.when = temporal.when;
      if (temporal?.hasDate) record.hasDate = true;
      if (temporal?.hasExplicitTime) record.hasExplicitTime = true;
      record.day = dayLabel(record);
      record.date = dateLabel(record);
      record.time = timeBucketLabel(record);
      record.hour = hourBucketLabel(record);
      record.topicTime = topicTimeLabel(record);
      record.topicTimeSortKey = topicTimeSortKey(record);
      record.monthIndex = record.hasDate && record.when instanceof Date && !Number.isNaN(record.when.getTime()) ? record.when.getMonth() : null;
    }

    airingRows.forEach((row) => {
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

    driveRows.forEach((row, index) => {
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
      topicDisplay: record.topicDisplay || 'Unspecified topic',
      topic: record.topicDisplay || 'Unspecified topic',
      time: timeBucketLabel(record),
      hour: hourBucketLabel(record),
      day: dayLabel(record),
      date: dateLabel(record),
      topicTime: topicTimeLabel(record),
      topicTimeSortKey: topicTimeSortKey(record),
      moneySource: record.moneySources[0] || 'missing',
      sourceFiles: [...record.sourceFiles].sort((a, b) => utils.compareText(a, b))
    }));

    if (!driveRows.length && !airingRows.length) warnings.push('No drive-results or airings rows were available yet, so Pledge Performance has no records to compare.');
    if (!records.some((record) => record.topicTokens.length)) warnings.push('Topic matching is still sparse. Some performance rows do not inherit library topics cleanly yet.');
    if (records.length && !records.some((record) => record.scheduleMatched)) warnings.push('Live-break comparisons currently have no imported airings matched back to scheduled placements yet. Those rows will show as Unknown / not matched to schedule.');
    if (scheduleMismatchRows) warnings.push(`${utils.formatCount(scheduleMismatchRows)} normalized events were quarantined because they fall inside a saved schedule window but do not reconcile to any scheduled placement.`);
    if (weakIdentityRows) warnings.push(`${utils.formatCount(weakIdentityRows)} imported airings rows had weak program identity and will not drive program/topic analytics unless they reconcile cleanly.`);

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
      identityTrustedRows,
      weakIdentityRows,
      moneyTrustedRows,
      missingMoneyRows,
      annotatedTitleRows,
      scheduleMismatchRows,
      nonSpecificRows: records.filter((record) => isNonSpecificRecord(record)).length,
      quarantinedEvents: records.filter((record) => record.excludedForIntegrity).length,
      recordsWithMoney: records.filter((record) => record.moneyTrusted).length,
      recordsWithDateTime: records.filter((record) => record.hasDate).length,
      recordsWithExplicitTime: records.filter((record) => record.hasExplicitTime).length,
      recordsWithTopic: records.filter((record) => record.topicTokens.length).length,
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
    if (criterion === 'weekpart') return group.label === 'Weekday' ? 0 : group.label === 'Weekend' ? 1 : 99;
    if (criterion === 'daypart') return ['Overnight / early morning','Daytime','Early evening','Prime time','Late night','Unknown day-part'].indexOf(group.label);
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
    if ((criterion === 'topic' || criterion === 'topic_time') && metric === 'avg_dollars') return MIN_SAMPLE_TOPIC_AVERAGE;
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
      case 'bar': return 'Bar chart';
      default: return 'Auto';
    }
  }

  function isLineFriendly(criterion) {
    return ['date', 'day', 'time', 'daypart', 'weekpart'].includes(criterion);
  }

  function effectiveChartType() {
    if (perf().chartType === 'auto') return isLineFriendly(perf().criterion) ? 'line' : 'bar';
    if (perf().chartType === 'line' && !isLineFriendly(perf().criterion)) return 'bar';
    return perf().chartType;
  }

  function isNonSpecificRecord(record) {
    return utils.isNonSpecificRow(record);
  }

  function temporalEligibility(record, criterion) {
    if (criterion === 'time') return record.hasExplicitTime && !record.estimatedOnly;
    if (criterion === 'topic_time') return record.hasDate && record.hasExplicitTime && !record.estimatedOnly;
    if (criterion === 'date' || criterion === 'day') return record.hasDate && !record.estimatedOnly;
    return true;
  }

  function integrityEligible(record, criterion) {
    if (!record?.moneyTrusted) return false;
    if (record?.excludedForIntegrity) return false;
    if ((criterion === 'program' || criterion === 'topic' || criterion === 'topic_time') && !record?.identityTrusted) return false;
    if ((criterion === 'topic' || criterion === 'topic_time') && !(record?.topicTokens || []).length) return false;
    return true;
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
      if (perf().daypartScope && daypartLabel(record) !== perf().daypartScope) return false;
      if (perf().weekpartScope && weekpartLabel(record) !== perf().weekpartScope) return false;
      if (startDate && (!(record.when instanceof Date) || record.when < startDate)) return false;
      if (endDate && (!(record.when instanceof Date) || record.when > endDate)) return false;
      if (perf().quickFilter === 'live_break_impact' && !record.scheduleMatched) return false;
      return true;
    });

    const integrityFiltered = scopedRecords.filter((record) => integrityEligible(record, criterion));
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
        groups.set(label, { label, airingCount: 0, totalDollars: 0, moneyCount: 0, avgDollars: 0, titles: new Set(), programIds: new Set(), minTime: null, minMinutes: null, topicTimeSortKey: null, dayIndex: null, hourOfDay: null });
      }
      const group = groups.get(label);
      group.airingCount += 1;
      group.totalDollars += Number.isFinite(record.amount) ? record.amount : 0;
      group.moneyCount += 1;
      group.titles.add(record.title || 'Unknown title');
      if (record.programId) group.programIds.add(String(record.programId));
      if (Number.isFinite(record.topicTimeSortKey)) {
        group.topicTimeSortKey = group.topicTimeSortKey == null ? record.topicTimeSortKey : Math.min(group.topicTimeSortKey, record.topicTimeSortKey);
      }
      if (record.when instanceof Date && !Number.isNaN(record.when.getTime())) {
        const ts = record.when.getTime();
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


    if (perf().quickFilter === 'weak_returns') {
      sorted = sorted
        .filter((group) => group.airingCount >= 2)
        .sort((a, b) => {
          const diff = metricValue(a) - metricValue(b);
          if (diff !== 0) return diff;
          return utils.compareText(a.label, b.label);
        });
    }
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
    perf().groups = limited;
    const nonSpecificScoped = scopedRecords.filter((record) => isNonSpecificRecord(record));
    perf().analysisMeta = {
      minGroupAirings,
      hiddenSmallSampleGroupCount: 0,
      lowSampleGroupCount: grouped.filter((group) => group.belowSampleThreshold).length,
      criterion,
      postFilterCount: scopedRecords.length,
      integrityEligibleCount: integrityFiltered.length,
      eligibleTemporalCount: eligibleTemporal.length,
      excludedWeakTemporalCount: Math.max(0, integrityFiltered.length - eligibleTemporal.length),
      excludedIntegrityCount: scopedRecords.filter((record) => !isNonSpecificRecord(record) && !integrityEligible(record, criterion)).length,
      excludedScheduleMismatchCount: scopedRecords.filter((record) => !isNonSpecificRecord(record) && record.excludedForIntegrity).length,
      excludedWeakIdentityCount: scopedRecords.filter((record) => !isNonSpecificRecord(record) && !record.identityTrusted).length,
      excludedMissingMoneyCount: scopedRecords.filter((record) => !isNonSpecificRecord(record) && !record.moneyTrusted).length,
      excludedMissingTopicCount: scopedRecords.filter((record) => !isNonSpecificRecord(record) && !(record.topicTokens || []).length).length,
      nonSpecificRevenueCount: nonSpecificScoped.length,
      lowConfidenceTemporal: TEMPORAL_CRITERIA.has(criterion) && eligibleTemporal.length > 0 && eligibleTemporal.length < 12,
      noTemporalSupport: TEMPORAL_CRITERIA.has(criterion) && eligibleTemporal.length === 0 && integrityFiltered.length > 0
    };
    return { records, grouped: limited, postFilter: scopedRecords, integrityFiltered };
  }

  function renderStats(records) {
    if (!els.performanceStatGrid) return;
    const programs = new Set(records.map((record) => utils.normalizeLookupKey(utils.firstNonEmpty(record.programId, record.nolaCode, record.title))).filter(Boolean));
    const dollars = records.reduce((sum, record) => sum + (Number.isFinite(record.amount) ? record.amount : 0), 0);
    const moneyCount = records.filter((record) => record.moneyTrusted).length;
    const datedCount = records.filter((record) => record.hasDate).length;
    const stats = [
      ['Airings used', utils.formatCount(records.length)],
      ['Programs represented', utils.formatCount(programs.size)],
      ['Dollars represented', utils.formatMoney(dollars)],
      ['Airings with dollars / dates', `${utils.formatCount(moneyCount)} / ${utils.formatCount(datedCount)}`]
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
      <text x="${left - 8}" y="${tick.y + 4}" font-size="11" text-anchor="end" fill="#526174">${utils.escapeHtml(perf().metric === 'airings' ? utils.formatCount(Math.round(tick.value)) : utils.formatMoney(tick.value))}</text>
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
        <rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="6" fill="${group.belowSampleThreshold ? '#6f879f' : '#123e6b'}"><title>${utils.escapeHtml(title)}</title></rect>
        <text x="${x + barW / 2}" y="${y - 8}" font-size="11" text-anchor="middle" fill="#183a5f">${utils.escapeHtml(display)}</text>
        ${labelNode}
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
      <circle cx="${point.x}" cy="${point.y}" r="4" fill="${point.group.belowSampleThreshold ? '#6f879f' : '#123e6b'}"><title>${utils.escapeHtml(`${point.label}: ${metricDisplay(point.group, { includeCount: true })} · ${utils.formatCount(point.group.titleCount)} titles${point.group.belowSampleThreshold ? ' · Low sample' : ''}`)}</title></circle>
      <text x="${point.x}" y="${point.y - 10}" font-size="11" text-anchor="middle" fill="#173a5e">${utils.escapeHtml(metricDisplay(point.group, { includeCount: true }))}</text>
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
        return `<div class="${cellClass}" style="background: rgba(18, 62, 107, ${alpha});" title="${utils.escapeHtml(title)}"><span>${utils.escapeHtml(metricDisplay(group))}</span><small>${utils.escapeHtml(utils.formatCount(group.airingCount))}${group.belowSampleThreshold ? ' · low sample' : ''}</small></div>`;
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
    if (perf().criterion === 'topic_time') {
      els.performanceChart.innerHTML = buildTopicTimeHeatmap(groups);
      return;
    }
    const chartType = effectiveChartType();
    const svg = chartType === 'line' ? buildLineSvg(groups) : buildBarSvg(groups);
    const note = chartType === 'line'
      ? '<div class="performance-chart-note">Line chart works best for date, day, or time because those labels have a natural order.</div>'
      : '<div class="performance-chart-note">Vertical bar chart is the safer choice for categories like program, topic, day-part, break flags, and premium metadata.</div>';
    els.performanceChart.innerHTML = `${svg}${note}`;
  }

  function renderTable(groups) {
    if (!els.performanceTableBody) return;
    if (els.performanceTableGroupHeader) els.performanceTableGroupHeader.textContent = criterionDisplayName();
    if (!groups.length) {
      els.performanceTableBody.innerHTML = '<tr><td colspan="5" class="placeholder-row">No comparison groups match this filter yet.</td></tr>';
      return;
    }
    els.performanceTableBody.innerHTML = groups.map((group) => {
      const labelHtml = perf().criterion === 'program'
        ? App.programLinks.render({ programId: group.programOpenId, title: group.label, className: 'performance-program-link' })
        : utils.escapeHtml(group.label);
      const sampleNote = group.belowSampleThreshold
        ? `<div class="sample-warning-inline">Low sample</div>`
        : '';
      return `
      <tr>
        <td>${labelHtml}${sampleNote}</td>
        <td>${utils.escapeHtml(utils.formatCount(group.airingCount))}</td>
        <td>${utils.escapeHtml(utils.formatMoney(group.totalDollars))}</td>
        <td>${utils.escapeHtml(metricDisplay(group, { includeCount: true }))}</td>
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
    const start = perf().useAllDates ? 'Earliest available' : (perf().startDate ? utils.formatDate(perf().startDate) : 'Earliest available');
    const end = perf().useAllDates ? 'Latest available' : (perf().endDate ? utils.formatDate(perf().endDate) : 'Latest available');
    const month = perf().monthFilter === '' ? 'All months' : MONTH_NAMES[Number(perf().monthFilter)] || 'Unknown month';
    const topic = perf().topicFilter || 'All topics';
    const quick = quickFilterLabel() || 'None';
    const shape = perf().dataShape || {};
    const analysisMeta = perf().analysisMeta || {};
    const source = `Strict airings view · ${utils.formatCount(shape.airingRows || 0)} airings rows`;
    perf().criteriaSummary = [
      ['Date window', perf().useAllDates ? 'All available dates' : `${start} to ${end}`],
      ['Fundraiser month', month],
      ['Topic filter', topic],
      ['Quick filter', quick],
      ['Compare by', criterionDisplayName()],
      ['Metric', metricLabel()],
      ['Chart', perf().criterion === 'topic_time' ? 'Heatmap' : chartTypeLabel(effectiveChartType())],
      ['Integrity-eligible', utils.formatCount(analysisMeta.integrityEligibleCount || records.length)]
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
    if (analysisMeta.excludedScheduleMismatchCount) {
      els.performanceCriteriaBar.innerHTML += `
        <div class="performance-criteria-pill warn"><span class="label">Unreconciled to saved schedule</span><span>${utils.escapeHtml(utils.formatCount(analysisMeta.excludedScheduleMismatchCount))}</span></div>
      `;
    }
    if (analysisMeta.nonSpecificRevenueCount) {
      els.performanceCriteriaBar.innerHTML += `
        <div class="performance-criteria-pill info"><span class="label">Non-specific fundraiser rows</span><span>${utils.escapeHtml(utils.formatCount(analysisMeta.nonSpecificRevenueCount))}</span></div>
      `;
    }
    if ((analysisMeta.lowSampleGroupCount || analysisMeta.hiddenSmallSampleGroupCount)) {
      els.performanceCriteriaBar.innerHTML += `
        <div class="performance-criteria-pill warn"><span class="label">Low-sample groups</span><span>${utils.escapeHtml(utils.formatCount(analysisMeta.lowSampleGroupCount || analysisMeta.hiddenSmallSampleGroupCount))}</span></div>
      `;
    }
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
      ['Date window', perf().useAllDates ? 'All available dates' : (perf().startDate || perf().endDate ? `${utils.formatDate(perf().startDate || perf().dataShape?.oldestDate || null, 'Earliest available')} to ${utils.formatDate(perf().endDate || perf().dataShape?.newestDate || null, 'Latest available')}` : 'All available dates'), 'Only records whose usable date falls inside this window are included.'],
      ['Quick filter', quickFilterLabel() || 'None', quickFilterExplanation() || 'No quick-filter-specific interpretation is active.'],
      ['Fundraiser month', perf().monthFilter === '' ? 'All months' : MONTH_NAMES[Number(perf().monthFilter)] || 'Unknown month', 'This cuts across years. “December” means every included row that lands in December.'],
      ['Topic filter', perf().topicFilter || 'All topics', perf().criterion === 'topic_time' ? 'Pick one main topic here to answer the real scheduling question: when does that topic perform best?' : 'Checks both primary and secondary topic text from the library where available.'],
      ['Compare by', criterionDisplayName(), perf().criterion === 'topic_time' ? 'Each row in the table is one day-and-hour slot. The chart becomes a weekly heatmap so the strongest slots stand out fast.' : `Each row in the comparison table is one ${criterionDisplayName().toLowerCase()} bucket.`],
      ['Metric', metricLabel(), perf().metric === 'avg_dollars' ? 'This is total dollars divided by the number of normalized events in the comparison group. It is safer than raw totals when sample sizes differ.' : perf().metric === 'total_dollars' ? 'This is raw dollars represented by the filtered events, so groups with more events can dominate.' : 'This is the count of normalized events used in the comparison.'],
      ['Minimum airing warning', meta.minGroupAirings > 1 ? `${utils.formatCount(meta.minGroupAirings)} airings` : 'None', minSampleExplanation()],
      ['Source basis', 'Strict imported airings layer', `The app is reading ${utils.formatCount((perf().dataShape || {}).airingRows || 0)} imported airings rows, but analytics now trust only rows with an explicit per-airing dollars field. Report totals are not allowed to masquerade as airing dollars.`],
      ['Program identity rule', 'Strict only', `Program/topic analytics now require a trustworthy identity path (program id, NOLA, or exact title match). Fuzzy title rematching is disabled.`],
      ['Schedule reconciliation', meta.excludedScheduleMismatchCount ? `${utils.formatCount(meta.excludedScheduleMismatchCount)} rows excluded` : 'No known schedule mismatches in this filter', 'Rows marked as non-specific fundraiser revenue are not counted as schedule mismatches. Only title-attributed rows that fall inside a saved schedule window and still fail to reconcile are excluded here.'],
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
    notes.push(`${utils.formatCount(shape.identityTrustedRows || 0)} imported airings rows had trustworthy program identity. ${utils.formatCount(shape.weakIdentityRows || 0)} had weak identity and are blocked from program/topic analytics.`);
    notes.push(`${utils.formatCount(shape.recordsWithTopic || 0)} events inherited topic metadata from the library. ${utils.formatCount(shape.scheduleMismatchRows || 0)} normalized events were quarantined because they do not reconcile to a saved schedule placement.`);
    if (shape.annotatedTitleRows) notes.push(`${utils.formatCount(shape.annotatedTitleRows || 0)} imported rows look like they contain title annotations or notes. Those rows are still allowed if their identity matches cleanly, but they are called out here because they deserve eyeballs.`);
    notes.push('Average dollars per airing is the safest headline metric for comparisons like local breaks vs no local breaks because it reduces the distortion from unequal sample sizes.');
    notes.push('Premium analysis is metadata-only for now. It does not know which premium item viewers actually chose.');
    notes.push('Letter campaign pledges and online pledges are not wired into this performance layer yet, so they are not included in these totals.');
    if (meta.noTemporalSupport) notes.push('Day/date/time views are intentionally cautious now: weak unmatched rows are excluded, and if nothing trustworthy remains the comparison is marked unavailable instead of pretending to know.');
    if (perf().criterion === 'topic_time') {
      if (perf().topicFilter) {
        const best = [...groups].sort((a, b) => metricValue(b) - metricValue(a))[0];
        if (best) notes.push(`${perf().topicFilter} is currently strongest at ${best.label} based on ${utils.formatCount(best.airingCount)} airing${best.airingCount === 1 ? '' : 's'} in the active filter window.`);
      } else {
        notes.push('Topic Time Performance is most useful with a main topic selected. Without that, it blends all topics into one weekly pattern.');
      }
    }
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
    const addOption = (value, label) => {
      const safeValue = utils.normalizeLookupKey(value || '');
      const safeLabel = utils.normalizeText(label || '');
      if (!safeValue || !safeLabel) return;
      if (!labels.has(safeValue)) labels.set(safeValue, safeLabel);
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
      weak_returns: 'Weak returns',
      live_break_impact: 'Live break impact',
      repeat_fatigue: 'Repeat fatigue',
      topic_winners: 'Top Topics',
      topic_time_performance: 'Topic Time Performance',
      recent_momentum: 'Recent momentum',
      weekend_weekday: 'Weekend vs weekday earnings',
      day_of_week: 'Day of week comparisons',
      daypart: 'Day-part comparisons',
      best_daytime: 'Best daytime performers'
    };
    return labels[name] || '';
  }

  function quickFilterExplanation(name = perf().quickFilter) {
    const endText = perf().endDate ? utils.formatDate(perf().endDate) : 'the latest available date';
    switch (name) {
      case 'weak_returns':
        return 'Sorted from the lowest average dollars per airing upward, so weak performers appear first instead of the strongest titles.';
      case 'live_break_impact':
        return 'Compares only rows that cleanly matched a schedule placement with a live-break flag. Unmatched rows are excluded so “Unknown” does not swamp the result.';
      case 'repeat_fatigue':
        return 'Shows only programs with at least 2 airings in the current filter window. Use it as a “repeated titles only” view, not a first-vs-repeat earnings delta yet.';
      case 'recent_momentum':
        return `“Recent” means the trailing 90 days ending on ${endText}. This is a recency-focused view, not yet a true prior-period momentum delta.`;
      case 'topic_time_performance':
        return perf().topicFilter
          ? 'This view ranks day/hour slots for the selected main topic and also draws a weekly heatmap so you can see when that topic performs best.'
          : 'Pick a main topic to make this view useful. Without a topic filter, the heatmap blends every topic together.';
      case 'topic_winners':
        return 'Ranks main topics by average dollars per qualified airing. This is not the same thing as top individual programs.';
      default:
        return '';
    }
  }

  function populateControls() {
    renderSelectOptions(els.performanceTopicSelect, collectTopicOptions(), perf().topicFilter, 'All main topics');
    if (els.performanceCriterionSelect) els.performanceCriterionSelect.value = perf().criterion;
    if (els.performanceMetricSelect) els.performanceMetricSelect.value = perf().metric;
    if (els.performanceChartTypeSelect) els.performanceChartTypeSelect.value = perf().chartType;
    if (els.performanceTopnSelect) {
      els.performanceTopnSelect.value = String(perf().topN);
      const usesTemporalAxis = TEMPORAL_CRITERIA.has(perf().criterion);
      els.performanceTopnSelect.disabled = usesTemporalAxis;
      els.performanceTopnSelect.title = usesTemporalAxis ? 'All groups are shown for date/day/time comparisons.' : '';
    }
    if (els.performanceFilterInput) els.performanceFilterInput.value = perf().labelFilter || '';
    if (els.performanceUseAllDates) els.performanceUseAllDates.checked = Boolean(perf().useAllDates);
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
    populateControls();
    const { records, grouped, postFilter, integrityFiltered } = filterAndGroupRecords();
    renderStats(records);
    buildCriteriaSummary(records);
    renderExplainTable(records, postFilter);
    renderChart(perf().groups);
    renderTable(perf().groups);
    renderNotes(records, perf().groups);
    if (els.performanceChartTitle) {
      const focus = perf().criterion === 'topic_time' && perf().topicFilter ? ` · ${perf().topicFilter}` : '';
      els.performanceChartTitle.textContent = `${metricLabel()} by ${criterionDisplayName()}${focus}`;
    }
    if (els.performanceChartPill) {
      const vizLabel = perf().criterion === 'topic_time' ? 'Heatmap' : chartTypeLabel(effectiveChartType());
      els.performanceChartPill.textContent = perf().ready ? `${vizLabel} · ${criterionDisplayName()}` : 'Awaiting data';
    }
    if (els.performanceTablePill) els.performanceTablePill.textContent = `${utils.formatCount(perf().groups.length)} groups shown`;
    if (els.performanceNotesPill) els.performanceNotesPill.textContent = perf().lastLoadedAt ? `Loaded ${utils.formatDateTime(perf().lastLoadedAt)}` : 'Starter framework';
    const meta = perf().analysisMeta || {};
    const warn = meta.noTemporalSupport || meta.lowConfidenceTemporal || Boolean(perf().error);
    const tail = meta.noTemporalSupport
      ? 'Not enough trustworthy day/time evidence for this view yet.'
      : meta.lowConfidenceTemporal
        ? 'Small temporal sample — read it cautiously.'
        : `${utils.formatCount(records.length)} filtered rows after excluding ${utils.formatCount(meta.excludedIntegrityCount || 0)} suspect rows${meta.nonSpecificRevenueCount ? ` while tracking ${utils.formatCount(meta.nonSpecificRevenueCount)} non-specific fundraiser rows separately` : ''}.`;
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


  const QUICK_FILTERS = {
    top_earners: { criterion: 'program', metric: 'total_dollars', chartType: 'bar', topN: 12, monthFilter: '', topicFilter: '', labelFilter: '', programFilter: '', daypartScope: '', weekpartScope: '' },
    best_average: { criterion: 'program', metric: 'avg_dollars', chartType: 'bar', topN: 12, monthFilter: '', topicFilter: '', labelFilter: '', programFilter: '', daypartScope: '', weekpartScope: '' },
    prime_time: { criterion: 'program', metric: 'avg_dollars', chartType: 'bar', topN: 12, monthFilter: '', topicFilter: '', labelFilter: '', programFilter: '', daypartScope: 'Prime time', weekpartScope: '' },
    weak_returns: { criterion: 'program', metric: 'avg_dollars', chartType: 'bar', topN: 12, monthFilter: '', topicFilter: '', programFilter: '', labelFilter: '', daypartScope: '', weekpartScope: '' },
    live_break_impact: { criterion: 'live_breaks', metric: 'avg_dollars', chartType: 'bar', topN: 8, monthFilter: '', topicFilter: '', labelFilter: '', programFilter: '', daypartScope: '', weekpartScope: '' },
    repeat_fatigue: { criterion: 'program', metric: 'avg_dollars', chartType: 'bar', topN: 12, monthFilter: '', topicFilter: '', labelFilter: '', programFilter: '', daypartScope: '', weekpartScope: '' },
    topic_winners: { criterion: 'topic', metric: 'avg_dollars', chartType: 'bar', topN: 10, monthFilter: '', topicFilter: '', labelFilter: '', programFilter: '', daypartScope: '', weekpartScope: '' },
    topic_time_performance: { criterion: 'topic_time', metric: 'avg_dollars', chartType: 'auto', topN: 999, monthFilter: '', labelFilter: '', programFilter: '', daypartScope: '', weekpartScope: '' },
    recent_momentum: { criterion: 'program', metric: 'avg_dollars', chartType: 'bar', topN: 10, monthFilter: '', topicFilter: '', labelFilter: '', programFilter: '', daypartScope: '', weekpartScope: '' },
    weekend_weekday: { criterion: 'weekpart', metric: 'avg_dollars', chartType: 'bar', topN: 8, monthFilter: '', topicFilter: '', labelFilter: '', programFilter: '', daypartScope: '', weekpartScope: '' },
    day_of_week: { criterion: 'day', metric: 'avg_dollars', chartType: 'bar', topN: 8, monthFilter: '', topicFilter: '', labelFilter: '', programFilter: '', daypartScope: '', weekpartScope: '' },
    daypart: { criterion: 'daypart', metric: 'avg_dollars', chartType: 'bar', topN: 8, monthFilter: '', topicFilter: '', labelFilter: '', programFilter: '', daypartScope: '', weekpartScope: '' },
    best_daytime: { criterion: 'program', metric: 'avg_dollars', chartType: 'bar', topN: 10, monthFilter: '', topicFilter: '', labelFilter: '', programFilter: '', daypartScope: 'Daytime', weekpartScope: '' }
  };

  function quickFiltersEnabled() {
    return Boolean(perf().useAllDates || (perf().startDate && perf().endDate));
  }

  function updateQuickFilterUi() {
    const enabled = quickFiltersEnabled();
    const active = perf().quickFilter || '';
    document.querySelectorAll('[data-performance-quick-filter]').forEach((button) => {
      button.disabled = !enabled;
      button.classList.toggle('active', button.dataset.performanceQuickFilter === active);
    });
    if (els.performanceQuickFilterPill) els.performanceQuickFilterPill.textContent = enabled ? (active ? quickFilterLabel(active) : 'Ready') : 'Set a date range first';
  }

  function applyQuickFilter(name) {
    const cfg = QUICK_FILTERS[name];
    if (!cfg || !quickFiltersEnabled()) return;
    Object.assign(perf(), cfg, { quickFilter: name });
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
    els.performanceTopnSelect?.addEventListener('change', (event) => { perf().topN = Number(event.target.value || 12); perf().quickFilter = ''; rerender(); });
    els.performanceFilterInput?.addEventListener('input', (event) => { perf().labelFilter = event.target.value || ''; perf().quickFilter = ''; rerender(); });
    els.performanceStartDate?.addEventListener('change', (event) => { perf().startDate = event.target.value || ''; perf().useAllDates = false; perf().quickFilter = ''; rerender(); });
    els.performanceEndDate?.addEventListener('change', (event) => { perf().endDate = event.target.value || ''; perf().useAllDates = false; perf().quickFilter = ''; rerender(); });
    els.performanceUseAllDates?.addEventListener('change', (event) => { perf().useAllDates = Boolean(event.target.checked); perf().quickFilter = ''; rerender(); });
    els.performanceMonthSelect?.addEventListener('change', (event) => { perf().monthFilter = event.target.value; perf().quickFilter = ''; rerender(); });
    els.performanceTopicSelect?.addEventListener('change', (event) => { perf().topicFilter = event.target.value || ''; perf().quickFilter = ''; rerender(); });
    els.performanceProgramSelect?.addEventListener('change', (event) => {
      perf().programFilter = event.target.value || '';
      perf().quickFilter = '';
      if (perf().programFilter && perf().criterion === 'program') perf().criterion = 'date';
      rerender();
    });
    els.performanceRefreshButton?.addEventListener('click', async () => { await refreshData(); renderAll(); });
    els.performanceExportButton?.addEventListener('click', exportChartSvg);
    document.querySelectorAll('[data-performance-quick-filter]').forEach((button) => {
      button.addEventListener('click', () => applyQuickFilter(button.dataset.performanceQuickFilter || ''));
    });
  }

  App.performanceUi = { ensureReady, refreshData, renderAll, bindEvents, reset, populateControls };
})();
