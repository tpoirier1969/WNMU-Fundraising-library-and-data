(() => {
  'use strict';

  const DAY_MS = 86400000;
  const HOLIDAY_PATTERN = /\b(?:christmas|holiday|holidays|noel|yuletide|nativity|hanukkah|chanukah|ramadan|eid|new year|new year's|new years|kwanzaa)\b/i;
  const CHRISTMAS_PATTERN = /\b(?:christmas|xmas|noel|yuletide|nativity)\b/i;
  const JEWISH_HOLIDAY_PATTERN = /\b(?:hanukkah|chanukah)\b/i;
  const MUSLIM_HOLIDAY_PATTERN = /\b(?:ramadan|eid(?:\s+al[- ](?:fitr|adha))?)\b/i;
  const NEW_YEAR_PATTERN = /\bnew year(?:'s|s)?\b/i;
  const LOCAL_WORD_PATTERN = /\b(?:michigan|upper peninsula|yooper|marquette|negaunee|ishpeming|keweenaw|mackinac|lake superior|great lakes|pelkie)\b/i;
  const LOCAL_UP_PATTERN = /(?:^|\W)(?:UP|U\.P\.?)(?=\W|$)/;
  const FIXED_SCHEDULE_TITLE_PATTERN = /\b(?:pbs\s*newshour(?:\s+weekend)?|michigan\s+out\s+of\s+doors|high\s+school\s+bowl)\b/i;
  const PROGRAMMER_WEIGHTS = Object.freeze({
    dont_air: -30,
    low_confidence: -14,
    neutral: 0,
    viable: 8,
    promising: 14,
    must_air: 28
  });
  const PROGRAMMER_LABELS = Object.freeze({
    dont_air: "Don't air",
    low_confidence: 'Low confidence',
    neutral: 'Neutral',
    viable: 'Viable',
    promising: 'Promising',
    must_air: 'Must Air'
  });
  const CORE_TOPICS = new Set([
    'drama', 'drama doc', 'documentary', 'history', 'nature', 'science',
    'public affairs', 'news', 'arts', 'arts culture'
  ]);

  function text(value) {
    return String(value ?? '').trim();
  }

  function lookupKey(value) {
    return text(value)
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function first(...values) {
    for (const value of values) {
      if (value === 0 || value === false) return value;
      if (value != null && text(value) !== '') return value;
    }
    return null;
  }

  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function parseDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return new Date(value.getTime());
    const raw = text(value);
    if (!raw) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const [year, month, day] = raw.split('-').map(Number);
      const parsed = new Date(year, month - 1, day, 12, 0, 0, 0);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function dateKey(value) {
    const date = parseDate(value);
    if (!date) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function addDays(value, days) {
    const date = parseDate(value);
    if (!date) return null;
    const next = new Date(date.getTime());
    next.setDate(next.getDate() + Number(days || 0));
    return next;
  }

  function daysBetween(earlier, later) {
    const a = parseDate(earlier);
    const b = parseDate(later);
    if (!a || !b) return null;
    return Math.max(0, Math.floor((b.getTime() - a.getTime()) / DAY_MS));
  }

  function scheduleStart(schedule = {}) {
    return text(first(schedule.startDate, schedule.start_date, schedule?.schedule_data?.startDate, schedule?.schedule_data?.start_date, ''));
  }

  function scheduleEnd(schedule = {}) {
    return text(first(schedule.endDate, schedule.end_date, schedule?.schedule_data?.endDate, schedule?.schedule_data?.end_date, scheduleStart(schedule), ''));
  }

  function evidenceCutoff(schedule = {}, nowValue = new Date()) {
    const start = parseDate(scheduleStart(schedule));
    const today = parseDate(nowValue);
    if (!start || !today) return '';
    const dayBeforeStart = addDays(start, -1);
    return dateKey(dayBeforeStart < today ? dayBeforeStart : today);
  }

  function airingDate(row = {}) {
    return text(first(row.dateKey, row.air_date, row.drive_date, row.date_key, row.aired_at, row.drive_start_date, ''));
  }

  function rowSeason(row = {}) {
    return seasonForDate(first(row.driveStartDate, row.drive_start_date, row.fundraiserStartDate, row.fundraiser_start_date, airingDate(row)));
  }

  function filterEvidenceAirings(rows = [], cutoffValue = '') {
    const cutoff = parseDate(cutoffValue);
    if (!cutoff) return [];
    return (rows || []).filter((row) => {
      const when = parseDate(airingDate(row));
      return Boolean(when && when <= cutoff);
    });
  }

  function seasonForDate(value) {
    const date = parseDate(value);
    if (!date) return 'Special';
    const month = date.getMonth() + 1;
    if (month === 2 || month === 3) return 'March';
    if (month === 5 || month === 6) return 'June';
    if (month === 8 || month === 9) return 'August';
    if (month === 11 || month === 12) return 'December';
    return 'Special';
  }

  function programId(program = {}) {
    return text(first(program.id, program.program_id, program.pledge_program_id, ''));
  }

  function programTitle(program = {}) {
    return text(first(program.title, program.program_title, program.name, program.matched_library_title, 'Untitled program'));
  }

  function programNola(program = {}) {
    return text(first(program.nola_code, program.nola, program.program_nola, ''));
  }

  function programTopic(program = {}) {
    return text(first(program.__resolved_topic_primary, program.topic_primary, program.topic, program.primary_topic, 'Uncategorized'));
  }

  function programSecondary(program = {}) {
    return text(first(program.__resolved_topic_secondary, program.topic_secondary, program.secondary, program.secondary_topic, ''));
  }

  function programDescription(program = {}) {
    return text(first(program.description, program.program_description, program.program_notes, program.notes, program.rights_notes, ''));
  }

  function programDistributor(program = {}) {
    return text(first(program.__resolved_distributor, program.distributor, program.supplier, ''));
  }

  function rightsStart(program = {}) {
    return text(first(program.rights_start, program.rights_begin, program.rights_start_date, ''));
  }

  function rightsEnd(program = {}) {
    return text(first(program.rights_end, program.rights_end_date, ''));
  }

  function programRuntimeMinutes(program = {}) {
    const seconds = number(first(program.actual_runtime_seconds, program.runtime_seconds, program.actual_runtime), 0);
    if (seconds > 0) return seconds / 60;
    const minutes = number(first(program.actual_runtime_minutes, program.runtime_minutes, program.length_minutes, program.length_bucket_minutes), 0);
    return minutes > 0 ? minutes : null;
  }

  function premiumSummary(program = {}) {
    return text(first(program.premium_summary, program.premiums, program.premium, ''));
  }

  function programText(program = {}) {
    return [programTitle(program), programDescription(program), programTopic(program), programSecondary(program)]
      .filter(Boolean)
      .join(' ');
  }

  function isLocal(program = {}) {
    const primary = lookupKey(programTopic(program));
    if (['michigan', 'wnmu', 'loukinen'].includes(primary)) return true;

    const explicitText = [programTitle(program), programDescription(program)]
      .filter(Boolean)
      .join(' ');
    if (LOCAL_WORD_PATTERN.test(explicitText) || LOCAL_UP_PATTERN.test(explicitText)) return true;

    const secondary = lookupKey(programSecondary(program));
    const distributor = lookupKey(programDistributor(program));
    return secondary === 'michigan' && Boolean(distributor) && distributor !== 'pbs';
  }

  function excludedFromAvoidList(program = {}, history = {}, drama = {}, baselineRate = null, rating = '', fixedProgramIds = new Set(), fixedTitleKeys = new Set()) {
    // Explicit editorial cautions remain visible even when performance is healthy.
    if (rating === 'dont_air' || rating === 'low_confidence') return false;

    const title = programTitle(program);
    const id = programId(program);
    if ((id && fixedProgramIds.has(id)) || fixedTitleKeys.has(lookupKey(title)) || FIXED_SCHEDULE_TITLE_PATTERN.test(title)) return true;
    if (drama?.isDramaDoc) return true;

    const averageRate = Number(history?.averageRate);
    if (Number.isFinite(averageRate) && Number.isFinite(Number(baselineRate)) && Number(baselineRate) > 0 && averageRate >= Number(baselineRate)) {
      return true;
    }

    return false;
  }

  function holidayCategory(program = {}) {
    const primary = lookupKey(programTopic(program));
    const secondary = lookupKey(programSecondary(program));
    const value = programText(program);
    if (primary === 'holiday jewish' || JEWISH_HOLIDAY_PATTERN.test(value)) return 'Holiday - Jewish';
    if (primary === 'holiday muslim' || MUSLIM_HOLIDAY_PATTERN.test(value)) return 'Holiday - Muslim';
    if (primary === 'holiday new year' || NEW_YEAR_PATTERN.test(value)) return 'Holiday - New Year';
    if (primary === 'holiday christmas' || CHRISTMAS_PATTERN.test(value) || (primary === 'holiday' && secondary.includes('christmas'))) return 'Holiday - Christmas';
    if (primary === 'holiday general' || primary === 'holiday' || primary.startsWith('holiday ')) return 'Holiday - General';
    return HOLIDAY_PATTERN.test(value) ? 'Holiday - General' : '';
  }

  function isHoliday(program = {}) {
    return Boolean(holidayCategory(program));
  }

  function calendarMonthDay(value, calendar) {
    const date = parseDate(value);
    if (!date || !globalThis.Intl?.DateTimeFormat) return null;
    try {
      const parts = new Intl.DateTimeFormat(`en-US-u-ca-${calendar}`, { month: 'long', day: 'numeric' }).formatToParts(date);
      const month = text(parts.find((part) => part.type === 'month')?.value).toLowerCase();
      const day = Number(parts.find((part) => part.type === 'day')?.value);
      return month && Number.isFinite(day) ? { month, day } : null;
    } catch {
      return null;
    }
  }

  function driveOverlaps(schedule = {}, predicate = () => false) {
    return dateRange(schedule).some((date) => predicate(date));
  }

  function holidaySeasonAdjustment(program = {}, schedule = {}) {
    const category = holidayCategory(program);
    if (!category) return { category: '', adjustment: 0, inWindow: false, outOfSeason: false, note: '' };
    const range = dateRange(schedule);
    if (!range.length) return { category, adjustment: 0, inWindow: false, outOfSeason: false, note: `${category}: fundraiser dates unavailable for seasonal fit.` };
    const textValue = programText(program);
    let inWindow = false;
    let adjustment = 0;
    let note = '';

    if (category === 'Holiday - Christmas') {
      inWindow = driveOverlaps(schedule, (date) => {
        const month = date.getMonth();
        const day = date.getDate();
        return (month === 10 && day >= 15) || (month === 11 && day <= 26);
      });
      adjustment = inWindow ? 14 : -18;
      note = inWindow ? 'Christmas seasonal window fits this fundraiser.' : 'Christmas title is outside its normal seasonal window.';
    } else if (category === 'Holiday - New Year') {
      inWindow = driveOverlaps(schedule, (date) => {
        const month = date.getMonth();
        const day = date.getDate();
        return (month === 11 && day >= 27) || (month === 0 && day <= 3);
      });
      adjustment = inWindow ? 14 : -14;
      note = inWindow ? 'New Year seasonal window overlaps this fundraiser.' : 'New Year title is outside the late-December / early-January window.';
    } else if (category === 'Holiday - Jewish') {
      const isHanukkah = JEWISH_HOLIDAY_PATTERN.test(textValue) || lookupKey(programSecondary(program)).includes('hanukkah');
      if (isHanukkah) {
        inWindow = driveOverlaps(schedule, (date) => {
          const parts = calendarMonthDay(date, 'hebrew');
          return Boolean(parts && ((parts.month.includes('kislev') && parts.day >= 25) || (parts.month.includes('tevet') && parts.day <= 3)));
        });
        adjustment = inWindow ? 14 : -14;
        note = inWindow ? 'Hanukkah overlaps this fundraiser.' : 'Hanukkah title is outside the Hanukkah window for this year.';
      } else {
        note = 'Jewish holiday title: no specific holiday keyword is stored, so no automatic seasonal boost is applied.';
      }
    } else if (category === 'Holiday - Muslim') {
      const wantsRamadan = /\bramadan\b/i.test(textValue);
      const wantsEid = /\beid\b/i.test(textValue);
      inWindow = driveOverlaps(schedule, (date) => {
        const parts = calendarMonthDay(date, 'islamic');
        if (!parts) return false;
        const ramadan = parts.month.includes('ramadan');
        const fitr = parts.month.includes('shawwal') && parts.day <= 3;
        const adha = (parts.month.includes('dhu al-hijjah') || parts.month.includes('dhul-hijjah') || parts.month.includes('dhuʻl-hijjah')) && parts.day >= 9 && parts.day <= 13;
        if (wantsRamadan && !wantsEid) return ramadan;
        if (wantsEid && !wantsRamadan) return fitr || adha;
        return ramadan || fitr || adha;
      });
      adjustment = inWindow ? 12 : -10;
      note = inWindow ? 'Muslim holiday window overlaps this fundraiser.' : 'Muslim holiday title is outside the relevant movable holiday window; it is not treated as a generic December title.';
    } else {
      const decemberish = driveOverlaps(schedule, (date) => date.getMonth() === 11);
      adjustment = decemberish ? 6 : 0;
      inWindow = decemberish;
      note = decemberish ? 'General holiday programming gets a modest December-season lift.' : 'General holiday programming has no automatic out-of-season penalty.';
    }

    return { category, adjustment, inWindow, outOfSeason: adjustment < 0, note };
  }

  function isBiography(program = {}) {
    const primary = lookupKey(programTopic(program));
    const secondary = lookupKey(programSecondary(program));
    return primary.includes('biograph') || secondary.includes('biograph');
  }

  function isCorePbs(program = {}) {
    const topic = lookupKey(programTopic(program));
    const distributor = lookupKey(programDistributor(program));
    if (CORE_TOPICS.has(topic)) return true;
    return distributor === 'pbs' && /^(?:drama|documentary|history|nature|science|public affairs|news)/.test(topic);
  }

  const DRAMA_SEASON_WORDS = Object.freeze({
    one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,
    eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15
  });

  function dramaSeasonTokenNumber(value = '') {
    const raw = lookupKey(value);
    if (!raw) return null;
    if (/^\d{1,2}$/.test(raw)) return Number(raw);
    return Number.isFinite(DRAMA_SEASON_WORDS[raw]) ? DRAMA_SEASON_WORDS[raw] : null;
  }

  function dramaSeasonNumbers(program = {}) {
    const found = new Set();
    const addToken = (value) => {
      const num = dramaSeasonTokenNumber(value);
      if (Number.isFinite(num) && num > 0 && num < 50) found.add(num);
    };
    const explicit = text(first(
      program.episode_season,
      program.series_season,
      program.season_number,
      program.season,
      ''
    ));
    (explicit.match(/\b\d{1,2}\b/g) || []).forEach(addToken);

    const source = `${programTitle(program)} ${programDescription(program)}`;
    const wordPattern = Object.keys(DRAMA_SEASON_WORDS).join('|');
    const tokenPattern = new RegExp(`\\b(?:\\d{1,2}|${wordPattern})\\b`, 'gi');
    const seasonPattern = /\bseasons?\s+([^.;:!?]{0,80})/gi;
    let match;
    while ((match = seasonPattern.exec(source))) {
      const segment = match[1] || '';
      const tokens = segment.match(tokenPattern) || [];
      tokens.slice(0, 6).forEach(addToken);
    }
    const trailingPattern = new RegExp(`\\b(\\d{1,2}|${wordPattern})\\s+seasons?\\b`, 'gi');
    while ((match = trailingPattern.exec(source))) addToken(match[1]);

    const chapterPattern = new RegExp(`\\bchapter\\s+(\\d{1,2}|${wordPattern})\\b`, 'gi');
    while ((match = chapterPattern.exec(programTitle(program)))) addToken(match[1]);

    return [...found].sort((a,b)=>a-b);
  }

  function dramaSeriesKey(program = {}) {
    const explicit = text(first(
      program.series_name,
      program.series_title,
      program.parent_series,
      program.parent_title,
      ''
    ));
    if (explicit) return lookupKey(explicit);

    const title = programTitle(program);
    if (title.includes(':')) {
      const prefix = text(title.split(':')[0]);
      if (prefix.length >= 4) return lookupKey(prefix);
    }

    const patterns = [
      /\bour favorite things about\s+(.+)$/i,
      /\bsolving the puzzles of\s+(?:the\s+)?(.+)$/i,
      /^inside\s+(.+)$/i,
      /^(?:tribute|salute)\s+to\s+(.+)$/i,
      /^weddings\s+of\s+(.+)$/i,
      /^i\s+miss\s+(.+)$/i
    ];
    for (const pattern of patterns) {
      const match = title.match(pattern);
      if (match?.[1]) return lookupKey(match[1]);
    }
    return '';
  }

  function buildDramaCycleIndex(library = [], schedule = {}) {
    const target = parseDate(scheduleStart(schedule));
    if (!target) return new Map();
    const activityFloor = addDays(target, -365);
    const futureCeiling = addDays(target, 31);
    const index = new Map();

    (library || []).forEach((program) => {
      if (lookupKey(programTopic(program)) !== 'drama doc') return;
      if (!eligibleSomewhereInFundraiser(program, schedule)) return;
      const seriesKey = dramaSeriesKey(program);
      if (!seriesKey) return;
      const began = parseDate(rightsStart(program));
      const seasons = dramaSeasonNumbers(program);
      const current = index.get(seriesKey) || {
        seriesKey,
        latestRightsBegin:null,
        currentSeason:null,
        seasonEvidenceCount:0
      };
      if (began && (!current.latestRightsBegin || began > current.latestRightsBegin)) current.latestRightsBegin = began;
      seasons.forEach((season) => {
        current.currentSeason = current.currentSeason == null ? season : Math.max(current.currentSeason, season);
        current.seasonEvidenceCount += 1;
      });
      index.set(seriesKey,current);
    });

    index.forEach((entry) => {
      entry.seriesCurrent = Boolean(
        entry.latestRightsBegin &&
        entry.latestRightsBegin >= activityFloor &&
        entry.latestRightsBegin <= futureCeiling
      );
    });
    return index;
  }

  function dramaInfo(program = {}, schedule = {}, cycleIndex = null) {
    const isDramaDoc = lookupKey(programTopic(program)) === 'drama doc';
    if (!isDramaDoc) return { isDramaDoc:false,currentCycle:false,olderCycle:false,cycleUnknown:false };

    const explicitCycle = text(first(
      program.drama_cycle_status,
      program.dramaCycleStatus,
      program.drama_cycle,
      ''
    )).toLowerCase();
    if (explicitCycle === 'current' || explicitCycle === 'older') {
      return {
        isDramaDoc:true,
        currentCycle:explicitCycle === 'current',
        olderCycle:explicitCycle === 'older',
        cycleUnknown:false,
        basis:'explicit',
        explicitCycle
      };
    }

    const seriesKey = dramaSeriesKey(program);
    const seasons = dramaSeasonNumbers(program);
    const ownSeason = seasons.length ? Math.max(...seasons) : null;
    const entry = seriesKey && cycleIndex?.get ? cycleIndex.get(seriesKey) : null;

    if (entry && Number.isFinite(ownSeason) && Number.isFinite(entry.currentSeason)) {
      const currentCycle = Boolean(entry.seriesCurrent && ownSeason === entry.currentSeason);
      return {
        isDramaDoc:true,
        currentCycle,
        olderCycle:!currentCycle,
        cycleUnknown:false,
        basis:'series-season',
        seriesKey,
        seasonNumber:ownSeason,
        currentSeriesSeason:entry.currentSeason,
        seriesCurrent:Boolean(entry.seriesCurrent),
        latestSeriesRightsBegin:entry.latestRightsBegin || null
      };
    }

    const target = parseDate(scheduleStart(schedule));
    const began = parseDate(rightsStart(program));
    if (!target || !began) {
      return {
        isDramaDoc:true,
        currentCycle:false,
        olderCycle:false,
        cycleUnknown:true,
        basis:'unknown',
        seriesKey,
        seasonNumber:ownSeason,
        currentSeriesSeason:entry?.currentSeason ?? null,
        seriesCurrent:Boolean(entry?.seriesCurrent)
      };
    }
    const cycleFloor = addDays(target, -365);
    const recentRightsStart = began >= cycleFloor && began <= addDays(target, 31);
    return {
      isDramaDoc:true,
      currentCycle:false,
      olderCycle:false,
      cycleUnknown:true,
      basis:'rights-start-only',
      recentRightsStart,
      seriesKey,
      seasonNumber:ownSeason,
      currentSeriesSeason:entry?.currentSeason ?? null,
      seriesCurrent:Boolean(entry?.seriesCurrent),
      rightsBegin:began
    };
  }

  function titleEligibleForDate(program = {}, slotDate) {
    const date = parseDate(slotDate);
    if (!date) return false;
    const begin = parseDate(rightsStart(program));
    const end = parseDate(rightsEnd(program));
    if (begin && date < begin) return false;
    if (end && date > end) return false;
    return true;
  }

  function eligibleSomewhereInFundraiser(program = {}, schedule = {}) {
    const start = parseDate(scheduleStart(schedule));
    const end = parseDate(scheduleEnd(schedule));
    if (!start || !end) return false;
    const begin = parseDate(rightsStart(program));
    const rightsFinish = parseDate(rightsEnd(program));
    if (rightsFinish && rightsFinish < start) return false;
    if (begin && begin > end) return false;
    return true;
  }

  function normalizeRating(value) {
    const rating = text(value).toLowerCase();
    if (rating === 'high') return 'must_air';
    if (rating === 'medium') return 'promising';
    if (rating === 'low') return 'low_confidence';
    return Object.prototype.hasOwnProperty.call(PROGRAMMER_WEIGHTS, rating) ? rating : '';
  }

  function overrideIndex(overrides = []) {
    const index = new Map();
    (overrides || []).forEach((row) => {
      const id = text(first(row.program_id, row.id, ''));
      const rating = normalizeRating(row.rating);
      if (id && rating) index.set(id, { ...row, program_id: id, rating });
    });
    return index;
  }

  function rowProgramId(row = {}) {
    return text(first(row.programId, row.program_id, row.pledge_program_id, row.manual_match_program_id, ''));
  }

  function rowNola(row = {}) {
    return text(first(row.nola_code, row.nola, row.program_nola, row.matched_nola_code, ''));
  }

  function rowTitle(row = {}) {
    return text(first(row.title, row.plannedTitle, row.program_title, row.matched_library_title, row.imported_program_title, ''));
  }

  function rowTopic(row = {}) {
    return text(first(row.topic, row.topic_primary, row.__resolved_topic_primary, 'Uncategorized'));
  }

  function rowSecondary(row = {}) {
    return text(first(row.secondary, row.topic_secondary, row.__resolved_topic_secondary, ''));
  }

  function rowMinutes(row = {}, program = null) {
    const direct = number(first(row.minutes, row.program_minutes, row.lengthMinutes, row.length_minutes), 0);
    if (direct > 0) return direct;
    return program ? programRuntimeMinutes(program) : null;
  }

  function rowDollars(row = {}) {
    return number(first(row.dollars, row.contribution_amount, row.broadcast_dollars, row.total_dollars, row.total_contributions), 0);
  }

  function rowRate(row = {}, program = null) {
    const minutes = rowMinutes(row, program);
    return minutes > 0 ? rowDollars(row) * 60 / minutes : null;
  }

  function rowStartMinutes(row = {}) {
    const direct = Number(first(row.startMinutes, row.start_minutes, row.air_start_minutes));
    if (Number.isFinite(direct)) return ((direct % 1440) + 1440) % 1440;
    const raw = text(first(row.air_time, row.start_time, ''));
    const match = raw.match(/^(\d{1,2}):(\d{2})/);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? hour * 60 + minute : null;
  }

  function rowWeekpart(row = {}) {
    const date = parseDate(airingDate(row));
    if (!date) return 'Unknown';
    if (date.getDay() === 6) return 'Saturday';
    if (date.getDay() === 0) return 'Sunday';
    return 'Weekday';
  }

  function daypartForMinutes(minutes) {
    const value = Number(minutes);
    if (!Number.isFinite(value)) return 'Unknown';
    const normalized = ((value % 1440) + 1440) % 1440;
    if (normalized >= 19 * 60 && normalized < 23 * 60) return 'Prime';
    if (normalized >= 17 * 60 && normalized < 19 * 60) return 'Early evening';
    if (normalized >= 12 * 60 && normalized < 17 * 60) return 'Afternoon';
    if (normalized >= 7 * 60 && normalized < 12 * 60) return 'Morning';
    return 'Overnight';
  }

  function median(values = []) {
    const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function mean(values = []) {
    const clean = values.map(Number).filter(Number.isFinite);
    return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
  }

  function clamp(value, min = 0, max = 100) {
    return Math.max(min, Math.min(max, Number(value) || 0));
  }

  function dateRange(schedule = {}) {
    const start = parseDate(scheduleStart(schedule));
    const end = parseDate(scheduleEnd(schedule));
    if (!start || !end || end < start) return [];
    const days = [];
    for (let current = new Date(start.getTime()); current <= end; current = addDays(current, 1)) days.push(current);
    return days;
  }

  function planningPriority(value = '') {
    const raw = text(value).toLowerCase();
    return ['open', 'prefer', 'commit'].includes(raw) ? raw : 'open';
  }

  function planningPriorityLabel(value = '') {
    const priority = planningPriority(value);
    if (priority === 'commit') return 'Commit to pledge';
    if (priority === 'prefer') return 'Prefer pledge';
    return 'Open to pledge';
  }

  function planningPriorityThreshold(value = '') {
    const priority = planningPriority(value);
    if (priority === 'commit') return 48;
    if (priority === 'prefer') return 56;
    return 60;
  }

  function userFundraisingWindows(schedule = {}) {
    const source = Array.isArray(schedule?.fundraisingWindows)
      ? schedule.fundraisingWindows
      : (Array.isArray(schedule?.fundraising_windows) ? schedule.fundraising_windows : []);
    const startKey = dateKey(scheduleStart(schedule));
    const endKey = dateKey(scheduleEnd(schedule));
    return source.map((window, index) => {
      const date = text(first(window.dateKey, window.date_key, ''));
      const startMinutes = number(first(window.startMinutes, window.start_minutes), NaN);
      const endMinutes = number(first(window.endMinutes, window.end_minutes), NaN);
      return {
        id: text(window.id) || `fundraising-window-${index + 1}`,
        date,
        startMinutes,
        endMinutes,
        priority: planningPriority(first(window.priority, window.intent, 'open')),
        note: text(first(window.note, window.notes, ''))
      };
    }).filter((window) =>
      window.date
      && Number.isFinite(window.startMinutes)
      && Number.isFinite(window.endMinutes)
      && window.endMinutes > window.startMinutes
      && window.startMinutes >= 0
      && window.endMinutes <= 1440
      && (!startKey || window.date >= startKey)
      && (!endKey || window.date <= endKey)
    ).sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes);
  }

  function customPlanningWindows(schedule = {}) {
    const targetStart = parseDate(scheduleStart(schedule));
    const webOnlyExperiment = seasonForDate(scheduleStart(schedule)) === 'December' && targetStart?.getFullYear() === 2026;
    const result = [];
    const makeSegment = (window, startMinutes, endMinutes, suffix = '', blocked = false) => {
      const date = parseDate(window.date);
      if (!date || endMinutes <= startMinutes) return;
      const day = date.getDay();
      const entirelyWebOnly = !blocked && webOnlyExperiment && startMinutes >= 17 * 60 && endMinutes <= 19 * 60;
      result.push({
        id: `${window.id}${suffix}`,
        sourceWindowId: window.id,
        date: window.date,
        weekday: date.toLocaleDateString('en-US', { weekday: 'long' }),
        weekpart: day === 6 ? 'Saturday' : day === 0 ? 'Sunday' : 'Weekday',
        label: blocked ? 'Protected regular programming' : 'Fundraising window',
        startMinutes,
        endMinutes,
        priority: window.priority,
        priorityLabel: planningPriorityLabel(window.priority),
        note: window.note,
        userDefined: true,
        confidenceClass: blocked ? 'blocked' : (entirelyWebOnly ? 'experimental' : 'normal'),
        experimental: entirelyWebOnly,
        webOnlyExperimental: entirelyWebOnly,
        fundraisingMode: entirelyWebOnly ? 'web-only' : 'staffed',
        blocked
      });
    };

    userFundraisingWindows(schedule).forEach((window) => {
      const date = parseDate(window.date);
      if (!date) return;
      const cuts = new Set([window.startMinutes, window.endMinutes]);
      if (webOnlyExperiment) {
        [17 * 60, 19 * 60].forEach((boundary) => {
          if (boundary > window.startMinutes && boundary < window.endMinutes) cuts.add(boundary);
        });
      }
      if (date.getDay() === 5) {
        [20 * 60, 21 * 60].forEach((boundary) => {
          if (boundary > window.startMinutes && boundary < window.endMinutes) cuts.add(boundary);
        });
      }
      const points = [...cuts].sort((a, b) => a - b);
      for (let index = 0; index < points.length - 1; index += 1) {
        const segmentStart = points[index];
        const segmentEnd = points[index + 1];
        const blocked = date.getDay() === 5
          && segmentStart >= 20 * 60
          && segmentEnd <= 21 * 60;
        makeSegment(window, segmentStart, segmentEnd, `-segment-${index + 1}`, blocked);
      }
    });
    return result.sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes || Number(a.blocked) - Number(b.blocked));
  }

  function planningWindows(schedule = {}) {
    const custom = customPlanningWindows(schedule);
    const windowDriven = custom.length > 0
      || schedule?.meta?.fundraisingWindowPlanning === true
      || schedule?.fundraisingWindowPlanning === true;
    if (windowDriven) return custom;

    const windows = [];
    const experimentalDates = new Set();
    dateRange(schedule).forEach((date) => {
      const day = date.getDay();
      const base = {
        date: dateKey(date),
        weekday: date.toLocaleDateString('en-US', { weekday: 'long' }),
        weekpart: day === 6 ? 'Saturday' : day === 0 ? 'Sunday' : 'Weekday'
      };
      if (day === 6 && experimentalDates.size < 2) {
        windows.push({ ...base, id: `${base.date}-1500`, label: 'Late afternoon', startMinutes: 15 * 60, endMinutes: 17 * 60, confidenceClass: 'experimental', experimental: true });
        experimentalDates.add(base.date);
      }
      const targetStart = parseDate(scheduleStart(schedule));
      const webOnlyEarlyEvening = seasonForDate(scheduleStart(schedule)) === 'December' && targetStart?.getFullYear() === 2026;
      windows.push({
        ...base,
        id: `${base.date}-1700`,
        label: 'Early evening',
        startMinutes: 17 * 60,
        endMinutes: 19 * 60,
        confidenceClass: webOnlyEarlyEvening ? 'experimental' : 'normal',
        experimental: webOnlyEarlyEvening,
        webOnlyExperimental: webOnlyEarlyEvening,
        fundraisingMode: webOnlyEarlyEvening ? 'web-only' : 'staffed',
        blocked: false
      });
      if (day === 5) {
        windows.push({ ...base, id: `${base.date}-1900`, label: 'Prime', startMinutes: 19 * 60, endMinutes: 20 * 60, confidenceClass: 'normal', experimental: false, blocked: false });
        windows.push({ ...base, id: `${base.date}-2000-protected`, label: 'Protected regular programming', startMinutes: 20 * 60, endMinutes: 21 * 60, confidenceClass: 'blocked', experimental: false, blocked: true });
        windows.push({ ...base, id: `${base.date}-2100`, label: 'Prime', startMinutes: 21 * 60, endMinutes: 22 * 60 + 30, confidenceClass: 'normal', experimental: false, blocked: false });
      } else {
        windows.push({ ...base, id: `${base.date}-1900`, label: 'Prime', startMinutes: 19 * 60, endMinutes: day === 0 ? 22 * 60 : 22 * 60 + 30, confidenceClass: 'normal', experimental: false, blocked: false });
      }
    });
    return windows;
  }

  function programMatchesRow(program = {}, row = {}) {
    const id = programId(program);
    const rowId = rowProgramId(row);
    if (id && rowId) return id === rowId;
    const nola = lookupKey(programNola(program));
    const rowCode = lookupKey(rowNola(row));
    if (nola && rowCode) return nola === rowCode;
    const title = lookupKey(programTitle(program));
    return Boolean(title && title === lookupKey(rowTitle(row)));
  }

  function rowsForProgram(program = {}, evidenceRows = []) {
    return (evidenceRows || []).filter((row) => programMatchesRow(program, row));
  }

  function fundraiserKey(row = {}) {
    const direct = text(first(row.fundraiserId, row.fundraiser_id, row.drive_id, ''));
    if (direct) return direct;
    const start = text(first(row.driveStartDate, row.drive_start_date, row.fundraiser_start_date, '')).slice(0, 10);
    const end = text(first(row.driveEndDate, row.drive_end_date, row.fundraiser_end_date, '')).slice(0, 10);
    if (start || end) return `range:${start}|${end}`;
    const label = text(first(row.fundraiserTitle, row.fundraiser_label, row.fundraiser_name, ''));
    if (label) return `label:${lookupKey(label)}`;
    const when = parseDate(airingDate(row));
    return when ? `month:${dateKey(when).slice(0, 7)}` : '';
  }

  function fundraiserCount(rows = []) {
    return new Set((rows || []).map(fundraiserKey).filter(Boolean)).size;
  }

  function rowSummary(rows = [], program = null) {
    const rates = [];
    const byFundraiser = new Map();
    let totalDollars = 0;
    let earliest = null;
    let latest = null;

    for (const row of (rows || [])) {
      const rate = rowRate(row, program);
      if (Number.isFinite(rate)) rates.push(rate);
      totalDollars += rowDollars(row);

      const key = fundraiserKey(row);
      if (key) {
        if (!byFundraiser.has(key)) byFundraiser.set(key, { dollars: 0, minutes: 0, valid: true });
        const group = byFundraiser.get(key);
        const minutes = rowMinutes(row, program);
        if (!(minutes > 0)) group.valid = false;
        else {
          group.dollars += rowDollars(row);
          group.minutes += minutes;
        }
      }

      const when = parseDate(airingDate(row));
      if (when) {
        if (!earliest || when < earliest) earliest = when;
        if (!latest || when > latest) latest = when;
      }
    }

    const fundraiserRates = [...byFundraiser.values()]
      .filter((group) => group.valid && group.minutes > 0)
      .map((group) => group.dollars * 60 / group.minutes)
      .filter(Number.isFinite);

    return {
      rows: (rows || []).length,
      fundraisers: fundraiserRates.length,
      rates,
      fundraiserRates,
      medianRate: median(rates),
      averageRate: mean(fundraiserRates),
      totalDollars,
      latest,
      earliest
    };
  }

  function comparableRows(rows = [], slot = {}, { topic = '', exactWeekday = false } = {}) {
    const targetTopic = lookupKey(topic);
    const targetDate = parseDate(slot.date);
    const targetWeekday = targetDate?.getDay();
    const targetPart = slot.weekpart || (targetWeekday === 6 ? 'Saturday' : targetWeekday === 0 ? 'Sunday' : 'Weekday');
    const windowStart = number(slot.startMinutes, 0);
    const windowEnd = number(slot.endMinutes, windowStart + 60);
    return (rows || []).filter((row) => {
      if (targetTopic && lookupKey(rowTopic(row)) !== targetTopic) return false;
      const start = rowStartMinutes(row);
      const date = parseDate(airingDate(row));
      if (!date || !Number.isFinite(start)) return false;
      if (exactWeekday && date.getDay() !== targetWeekday) return false;
      if (!exactWeekday && rowWeekpart(row) !== targetPart) return false;
      return start >= windowStart && start < windowEnd;
    });
  }

  function programEvidenceCacheKey(program = {}) {
    const id = programId(program);
    if (id) return `id:${id}`;
    return `nola:${lookupKey(programNola(program))}|title:${lookupKey(programTitle(program))}`;
  }

  function companionProgramStatus(program = {}) {
    const value = lookupKey(first(program.companion_program_status, program.companionProgramStatus, ''));
    return value === 'current' || value === 'dated' ? value : '';
  }

  function buildProgramRowIndex(rows = []) {
    const byId = new Map();
    const withoutId = [];
    for (const row of (rows || [])) {
      const id = rowProgramId(row);
      if (!id) {
        withoutId.push(row);
        continue;
      }
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(row);
    }
    return { byId, withoutId };
  }

  function cachedRowsForProgram(program = {}, context = {}) {
    const cache = context.programRowsCache;
    if (!cache) return rowsForProgram(program, context.evidenceRows || []);
    const key = programEvidenceCacheKey(program);
    if (cache.has(key)) return cache.get(key);

    const id = programId(program);
    const index = context.programRowIndex;
    let matches;
    if (id && index) {
      const direct = index.byId.get(id) || [];
      const fallback = index.withoutId.length
        ? index.withoutId.filter((row) => programMatchesRow(program, row))
        : [];
      matches = fallback.length ? [...direct, ...fallback] : direct;
    } else {
      matches = rowsForProgram(program, context.evidenceRows || []);
    }
    cache.set(key, matches);
    return matches;
  }

  function slotEvidenceCacheKey(slot = {}) {
    return text(slot.id || `${slot.date}|${slot.startMinutes}|${slot.endMinutes}|${slot.label}`);
  }

  function buildSlotEvidenceIndex(rows = []) {
    const byWeekday = new Map();
    const byWeekpart = new Map();
    for (const row of (rows || [])) {
      const date = parseDate(airingDate(row));
      const start = rowStartMinutes(row);
      if (!date || !Number.isFinite(start)) continue;
      const weekday = date.getDay();
      const weekpart = weekday === 6 ? 'Saturday' : weekday === 0 ? 'Sunday' : 'Weekday';
      const meta = {
        row,
        weekday,
        weekpart,
        start,
        daypart: daypartForMinutes(start),
        topicKey: lookupKey(rowTopic(row))
      };
      if (!byWeekday.has(weekday)) byWeekday.set(weekday, []);
      byWeekday.get(weekday).push(meta);
      if (!byWeekpart.has(weekpart)) byWeekpart.set(weekpart, []);
      byWeekpart.get(weekpart).push(meta);
    }
    return { byWeekday, byWeekpart };
  }

  function cachedSlotEvidence(slot = {}, context = {}) {
    const cache = context.slotEvidenceCache;
    const key = slotEvidenceCacheKey(slot);
    if (cache?.has(key)) return cache.get(key);

    const targetDate = parseDate(slot.date);
    const targetWeekday = targetDate?.getDay();
    const targetPart = slot.weekpart || (targetWeekday === 6 ? 'Saturday' : targetWeekday === 0 ? 'Sunday' : 'Weekday');
    const windowStart = number(slot.startMinutes, 0);
    const windowEnd = number(slot.endMinutes, windowStart + 60);
    const indexed = context.slotEvidenceIndex;

    let exactRows;
    let broadRows;
    let exactMeta;
    let broadMeta;
    if (indexed && Number.isFinite(targetWeekday)) {
      const matchesWindow = (meta) => meta.start >= windowStart && meta.start < windowEnd;
      exactMeta = (indexed.byWeekday.get(targetWeekday) || []).filter(matchesWindow);
      broadMeta = (indexed.byWeekpart.get(targetPart) || []).filter(matchesWindow);
      exactRows = exactMeta.map((meta) => meta.row);
      broadRows = broadMeta.map((meta) => meta.row);
    } else {
      const rows = context.evidenceRows || [];
      exactRows = comparableRows(rows, slot, { exactWeekday: true });
      broadRows = comparableRows(rows, slot, { exactWeekday: false });
      exactMeta = exactRows.map((row) => ({ row, topicKey: lookupKey(rowTopic(row)) }));
      broadMeta = broadRows.map((row) => ({ row, topicKey: lookupKey(rowTopic(row)) }));
    }

    const exactByTopic = new Map();
    const broadByTopic = new Map();
    const add = (map, meta) => {
      if (!map.has(meta.topicKey)) map.set(meta.topicKey, []);
      map.get(meta.topicKey).push(meta.row);
    };
    exactMeta.forEach((meta) => add(exactByTopic, meta));
    broadMeta.forEach((meta) => add(broadByTopic, meta));

    const exactTopicSummaries = new Map();
    const broadTopicSummaries = new Map();
    exactByTopic.forEach((topicRows, topicKey) => exactTopicSummaries.set(topicKey, rowSummary(topicRows)));
    broadByTopic.forEach((topicRows, topicKey) => broadTopicSummaries.set(topicKey, rowSummary(topicRows)));
    const value = {
      exactRows,
      broadRows,
      exactByTopic,
      broadByTopic,
      exactTopicSummaries,
      broadTopicSummaries,
      exactSummary: rowSummary(exactRows),
      broadSummary: rowSummary(broadRows)
    };
    cache?.set(key, value);
    return value;
  }

  function cachedSeasonSlotEvidence(slot = {}, context = {}) {
    const cache = context.seasonSlotEvidenceCache;
    const key = slotEvidenceCacheKey(slot);
    if (cache?.has(key)) return cache.get(key);

    const targetDate = parseDate(slot.date);
    const targetWeekday = targetDate?.getDay();
    const targetPart = slot.weekpart || (targetWeekday === 6 ? 'Saturday' : targetWeekday === 0 ? 'Sunday' : 'Weekday');
    const windowStart = number(slot.startMinutes, 0);
    const windowEnd = number(slot.endMinutes, windowStart + 60);
    const indexed = context.seasonSlotEvidenceIndex;
    const matchesWindow = (meta) => meta.start >= windowStart && meta.start < windowEnd;
    let exactMeta;
    let broadMeta;
    if (indexed && Number.isFinite(targetWeekday)) {
      exactMeta = (indexed.byWeekday.get(targetWeekday) || []).filter(matchesWindow);
      broadMeta = (indexed.byWeekpart.get(targetPart) || []).filter(matchesWindow);
    } else {
      const seasonRows = context.seasonRows || (context.evidenceRows || []).filter((row) => rowSeason(row) === seasonForDate(scheduleStart(context.schedule || {})));
      const exactRowsFallback = comparableRows(seasonRows, slot, { exactWeekday: true });
      const broadRowsFallback = comparableRows(seasonRows, slot, { exactWeekday: false });
      exactMeta = exactRowsFallback.map((row) => ({ row, topicKey: lookupKey(rowTopic(row)) }));
      broadMeta = broadRowsFallback.map((row) => ({ row, topicKey: lookupKey(rowTopic(row)) }));
    }
    const exactRows = exactMeta.map((meta) => meta.row);
    const broadRows = broadMeta.map((meta) => meta.row);
    const exactByTopic = new Map();
    const broadByTopic = new Map();
    const add = (map, meta) => {
      if (!map.has(meta.topicKey)) map.set(meta.topicKey, []);
      map.get(meta.topicKey).push(meta.row);
    };
    exactMeta.forEach((meta) => add(exactByTopic, meta));
    broadMeta.forEach((meta) => add(broadByTopic, meta));
    const exactTopicSummaries = new Map();
    const broadTopicSummaries = new Map();
    exactByTopic.forEach((topicRows, topicKey) => exactTopicSummaries.set(topicKey, rowSummary(topicRows)));
    broadByTopic.forEach((topicRows, topicKey) => broadTopicSummaries.set(topicKey, rowSummary(topicRows)));
    const value = {
      exactRows,
      broadRows,
      exactByTopic,
      broadByTopic,
      exactTopicSummaries,
      broadTopicSummaries,
      exactSummary: rowSummary(exactRows),
      broadSummary: rowSummary(broadRows)
    };
    cache?.set(key, value);
    return value;
  }

  function cachedProgramEvidence(program = {}, context = {}) {
    const cache = context.programEvidenceCache;
    const key = programEvidenceCacheKey(program);
    if (cache?.has(key)) return cache.get(key);

    const schedule = context.schedule || {};
    const titleRows = cachedRowsForProgram(program, context);
    const override = context.overrideByProgramId?.get(programId(program)) || null;
    const value = {
      titleRows,
      titleHistory: rowSummary(titleRows, program),
      season: seasonEvidence(program, titleRows, schedule),
      drama: dramaInfo(program, schedule, context.dramaCycleIndex),
      override,
      programmer: programmerEvidence(program, titleRows, override, context.evidenceRows || []),
      companionStatus: companionProgramStatus(program),
      local: isLocal(program),
      biography: isBiography(program),
      corePbs: isCorePbs(program)
    };
    cache?.set(key, value);
    return value;
  }

  function rateAdjustment(rate) {
    if (!Number.isFinite(rate)) return 0;
    if (rate >= 1000) return 18;
    if (rate >= 500) return 12;
    if (rate >= 250) return 7;
    if (rate >= 150) return 3;
    if (rate > 0) return -2;
    return -8;
  }

  function topicWindowAdjustment(summary, baselineRate) {
    if (!summary || summary.fundraisers < 2 || !Number.isFinite(summary.averageRate)) return 0;
    if (!Number.isFinite(baselineRate) || baselineRate <= 0) {
      if (summary.averageRate >= 500) return 6;
      if (summary.averageRate < 150) return -4;
      return 0;
    }
    const ratio = summary.averageRate / baselineRate;
    if (ratio >= 1.35) return 8;
    if (ratio >= 1.1) return 4;
    if (ratio <= 0.65) return -8;
    if (ratio <= 0.85) return -4;
    return 0;
  }

  function ratioAdjustment(summary, baseline, strong = 8, weak = -10) {
    if (!summary || summary.fundraisers < 2 || !Number.isFinite(summary.averageRate) || !Number.isFinite(baseline) || baseline <= 0) return 0;
    const ratio = summary.averageRate / baseline;
    if (ratio >= 1.35) return strong;
    if (ratio >= 1.1) return Math.round(strong / 2);
    if (ratio <= 0.55) return weak;
    if (ratio <= 0.75) return Math.round(weak * 0.65);
    if (ratio <= 0.9) return Math.round(weak * 0.35);
    return 0;
  }

  function seasonEvidence(program = {}, historyRows = [], schedule = {}) {
    const targetSeason = seasonForDate(scheduleStart(schedule));
    const same = historyRows.filter((row) => rowSeason(row) === targetSeason);
    const other = historyRows.filter((row) => rowSeason(row) !== targetSeason);
    const sameSummary = rowSummary(same, program);
    const otherSummary = rowSummary(other, program);
    let adjustment = 0;
    const notes = [];
    if (sameSummary.fundraisers >= 2 && otherSummary.fundraisers >= 2 && Number.isFinite(otherSummary.averageRate) && otherSummary.averageRate > 0) {
      const ratio = sameSummary.averageRate / otherSummary.averageRate;
      if (ratio >= 1.35) adjustment += 6;
      else if (ratio <= 0.65) adjustment -= 6;
      notes.push(`${targetSeason} title history: ${sameSummary.fundraisers} fundraiser samples, average ${Math.round(sameSummary.averageRate)}/pledge hr.`);
    } else if (sameSummary.fundraisers >= 2) {
      if (sameSummary.averageRate >= 600) adjustment += 4;
      else if (sameSummary.averageRate === 0) adjustment -= 5;
      else if (sameSummary.averageRate < 150) adjustment -= 3;
      notes.push(`${targetSeason} title history: ${sameSummary.fundraisers} fundraiser samples.`);
    } else if (sameSummary.fundraisers === 1) {
      if (sameSummary.averageRate >= 500) adjustment += 2;
      notes.push(`Only one ${targetSeason} fundraiser sample is available; it is not used as negative evidence by itself.`);
    }
    const holidayInfo = holidaySeasonAdjustment(program, schedule);
    const holiday = Boolean(holidayInfo.category);
    if (holiday) {
      adjustment += holidayInfo.adjustment;
      if (holidayInfo.note) notes.push(holidayInfo.note);
    }
    return { targetSeason, holiday, holidayCategory: holidayInfo.category, holidayInWindow: holidayInfo.inWindow, holidayOutOfSeason: holidayInfo.outOfSeason, same: sameSummary, other: otherSummary, adjustment, notes };
  }

  function postRatingAirings(program = {}, historyRows = [], override = null) {
    if (!override || normalizeRating(override.rating) !== 'must_air') return [];
    const ratedAt = parseDate(first(override.rated_at, override.updated_at, ''));
    if (!ratedAt) return [];
    const seen = new Set();
    return (historyRows || [])
      .map((row) => ({ row, when: parseDate(airingDate(row)), start: rowStartMinutes(row) }))
      .filter((entry) => entry.when && entry.when > ratedAt)
      .sort((a, b) => a.when - b.when || number(a.start, 99999) - number(b.start, 99999))
      .filter((entry) => {
        const key = `${dateKey(entry.when)}|${Number.isFinite(entry.start) ? entry.start : ''}|${text(first(entry.row.fundraiserId, entry.row.drive_start_date, entry.row.fundraiserTitle, ''))}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((entry) => entry.row);
  }

  function mustAirTestContext(program = {}, row = {}, allRows = []) {
    const rate = rowRate(row, program);
    const when = parseDate(airingDate(row));
    const day = dateKey(when);
    const start = rowStartMinutes(row);
    const historicalDays = new Map();
    for (const item of (allRows || [])) {
      const itemDay = dateKey(parseDate(airingDate(item)));
      const itemRate = rowRate(item);
      if (!itemDay || itemDay === day || !Number.isFinite(itemRate)) continue;
      if (!historicalDays.has(itemDay)) historicalDays.set(itemDay, []);
      historicalDays.get(itemDay).push(itemRate);
    }
    const historicalDayRates = [...historicalDays.values()].map((rates) => median(rates)).filter(Number.isFinite);
    const baseline = historicalDayRates.length
      ? median(historicalDayRates)
      : median((allRows || []).filter((item) => dateKey(parseDate(airingDate(item))) !== day).map((item) => rowRate(item)).filter(Number.isFinite));
    const sameDay = (allRows || []).filter((item) => {
      if (programMatchesRow(program, item)) return false;
      if (dateKey(parseDate(airingDate(item))) !== day) return false;
      return Number.isFinite(rowRate(item));
    });
    const nearby = Number.isFinite(start)
      ? sameDay.filter((item) => {
        const candidateStart = rowStartMinutes(item);
        return Number.isFinite(candidateStart) && Math.abs(candidateStart - start) <= 180;
      })
      : [];
    const contextRows = nearby.length >= 2 ? nearby : sameDay;
    const contextRate = median(contextRows.map((item) => rowRate(item)).filter(Number.isFinite));
    const baselineRatio = Number.isFinite(rate) && Number.isFinite(baseline) && baseline > 0 ? rate / baseline : null;
    const contextRatio = Number.isFinite(contextRate) && Number.isFinite(baseline) && baseline > 0 ? contextRate / baseline : null;
    const relativeRatio = Number.isFinite(rate) && Number.isFinite(contextRate) && contextRate > 0 ? rate / contextRate : null;
    const badNight = contextRows.length >= 2 && Number.isFinite(contextRatio) && contextRatio < 0.75;
    let qualityRatio = baselineRatio;
    if (badNight && Number.isFinite(relativeRatio)) qualityRatio = Math.max(Number.isFinite(qualityRatio) ? qualityRatio : 0, relativeRatio * 0.9);
    let outcome = 'inconclusive';
    if (Number.isFinite(qualityRatio)) {
      if (qualityRatio >= 1.1) outcome = 'promising';
      else if (qualityRatio >= 0.78) outcome = 'viable';
      else if (qualityRatio >= 0.55) outcome = 'neutral';
      else outcome = 'low_confidence';
    }
    return {
      row,
      rate,
      baseline,
      contextRate,
      contextSamples: contextRows.length,
      baselineRatio,
      contextRatio,
      relativeRatio,
      qualityRatio,
      badNight,
      outcome
    };
  }

  function resolvedMustAirRating(testContexts = []) {
    const usable = (testContexts || []).map((test) => test.qualityRatio).filter(Number.isFinite);
    if (!usable.length) return 'neutral';
    const combined = median(usable);
    if (combined >= 1.1) return 'promising';
    if (combined >= 0.78) return 'viable';
    if (combined >= 0.55) return 'neutral';
    return 'low_confidence';
  }

  function programmerEvidence(program = {}, historyRows = [], override = null, allRows = []) {
    const storedRating = normalizeRating(override?.rating);
    if (!storedRating) return { rating: '', storedRating: '', label: 'Neutral', adjustment: 0, weakCount: 0, activeProtection: false, secondChance: false, tests: [] };
    if (storedRating !== 'must_air') {
      return {
        rating: storedRating,
        storedRating,
        label: PROGRAMMER_LABELS[storedRating],
        adjustment: PROGRAMMER_WEIGHTS[storedRating] || 0,
        weakCount: 0,
        activeProtection: false,
        secondChance: false,
        tests: []
      };
    }

    const postAirings = postRatingAirings(program, historyRows, override);
    const tests = postAirings.map((row) => mustAirTestContext(program, row, allRows));
    if (!tests.length) {
      return {
        rating: 'must_air',
        storedRating,
        label: 'Must Air',
        adjustment: PROGRAMMER_WEIGHTS.must_air,
        weakCount: 0,
        activeProtection: true,
        secondChance: false,
        tests
      };
    }

    const firstTest = tests[0];
    const deservesSecondChance = tests.length === 1
      && (firstTest.outcome === 'inconclusive' || (firstTest.badNight && !['promising', 'viable'].includes(firstTest.outcome)));

    if (deservesSecondChance) {
      return {
        rating: 'must_air',
        storedRating,
        label: 'Must Air · second chance',
        adjustment: PROGRAMMER_WEIGHTS.promising,
        weakCount: firstTest.outcome === 'low_confidence' ? 1 : 0,
        activeProtection: true,
        secondChance: true,
        tests
      };
    }

    const effectiveRating = resolvedMustAirRating(tests.slice(0, 2));
    return {
      rating: effectiveRating,
      storedRating,
      effectiveRating,
      label: `Must Air → ${PROGRAMMER_LABELS[effectiveRating]}`,
      adjustment: PROGRAMMER_WEIGHTS[effectiveRating] || 0,
      weakCount: tests.filter((test) => test.outcome === 'low_confidence').length,
      activeProtection: false,
      secondChance: false,
      resolvedAfterAirings: Math.min(2, tests.length),
      tests
    };
  }

  function baseHistoricalRate(evidenceRows = []) {
    return rowSummary(evidenceRows).averageRate;
  }

  function scoreProgramForSlot(program = {}, slot = {}, context = {}){
const schedule = context.schedule || {};
const programKey = programEvidenceCacheKey(program);
const slotKey = slotEvidenceCacheKey(slot);
const scoreKey = `${programKey}|${slotKey}`;
if(context.scoreCache?.has(scoreKey))return context.scoreCache.get(scoreKey);
if(!titleEligibleForDate(program, slot.date)){context.scoreCache?.set(scoreKey,null);return null;}
const rows = context.evidenceRows || [];
const cachedProgram = cachedProgramEvidence(program, context);
const titleRows = cachedProgram.titleRows;
const titleHistory = cachedProgram.titleHistory;
const useSeasonWindowEvidence = Number(context.seasonFundraiserCount || 0) >= 2;
const windowTitleRows = useSeasonWindowEvidence
  ? titleRows.filter((row) => rowSeason(row) === context.targetSeason)
  : titleRows;
const exactTitle = rowSummary(comparableRows(windowTitleRows,slot,{exactWeekday:true}),program);
const broadTitle = rowSummary(comparableRows(windowTitleRows,slot,{exactWeekday:false}),program);
const topic = programTopic(program);
const slotEvidence = useSeasonWindowEvidence
  ? cachedSeasonSlotEvidence(slot, context)
  : cachedSlotEvidence(slot, context);
const topicKey = lookupKey(topic);
const exactTopic = slotEvidence.exactTopicSummaries.get(topicKey) || rowSummary([]);
const broadTopic = slotEvidence.broadTopicSummaries.get(topicKey) || rowSummary([]);
const dayHistory = slotEvidence.exactSummary;
const season = cachedProgram.season;
const drama = cachedProgram.drama;
const override = cachedProgram.override;
const programmer = cachedProgram.programmer;
const companionStatus = cachedProgram.companionStatus;
const baseline = Number.isFinite(context.baselineRate)?context.baselineRate:baseHistoricalRate(useSeasonWindowEvidence?context.seasonRows:rows);let score=50;const reasons=[],cautions=[],adjustments=[];
if(titleHistory.rows){let a=rateAdjustment(titleHistory.averageRate);const titleAgeDays=titleHistory.latest?daysBetween(titleHistory.latest,scheduleStart(schedule)):null;if(titleHistory.rows===1&&Number.isFinite(titleAgeDays)&&titleAgeDays>=730&&a>4)a=4;score+=a;adjustments.push(['titleHistory',a]);reasons.push(`WNMU title history: ${titleHistory.rows} airing${titleHistory.rows===1?'':'s'}${Number.isFinite(titleHistory.averageRate)?`, Avg ${Math.round(titleHistory.averageRate)}/pledge hr`:''}.`);if(titleHistory.rows===1&&Number.isFinite(titleAgeDays)&&titleAgeDays>=730)cautions.push(`Only one prior title airing, ${titleAgeDays} days old; stale single-airing evidence is capped.`);}else reasons.push('No prior WNMU title airing before the evidence cutoff.');
if(exactTitle.rates.length){const a=Math.max(-8,Math.min(8,Math.round(rateAdjustment(exactTitle.averageRate)*.5)));score+=a;adjustments.push(['exactTitleSlot',a]);reasons.push(`${exactTitle.rates.length} title airing${exactTitle.rates.length===1?'':'s'} in this weekday/window.`);}else if(broadTitle.rates.length)reasons.push(`${broadTitle.rates.length} comparable title result${broadTitle.rates.length===1?'':'s'} elsewhere, but none in this exact weekday/window.`);
const dayAdj=ratioAdjustment(dayHistory,baseline,8,-16);score+=dayAdj;adjustments.push(['weekdayWindow',dayAdj]);if(dayHistory.fundraisers>=2&&Number.isFinite(dayHistory.averageRate))reasons.push(`${slot.weekday} ${slot.label.toLowerCase()} history: ${dayHistory.fundraisers} fundraiser samples, Avg ${Math.round(dayHistory.averageRate)}/pledge hr.`);if(dayAdj<=-6)cautions.push(`${slot.weekday} ${slot.label.toLowerCase()} is historically weaker than WNMU's ${useSeasonWindowEvidence?context.targetSeason+' season':'overall'} pledge baseline.`);
let topicAdj=0;if(exactTopic.rates.length>=2){topicAdj=ratioAdjustment(exactTopic,baseline,9,-10);reasons.push(`${topic} has ${exactTopic.rates.length} rate-valid airing${exactTopic.rates.length===1?'':'s'} in this weekday/window${Number.isFinite(exactTopic.averageRate)?`, Avg ${Math.round(exactTopic.averageRate)}/pledge hr`:''}.`);}else if(!slot.experimental){topicAdj=exactTopic.rates.length===1?-4:-9;cautions.push(exactTopic.rates.length?`Only one ${topic} result exists in this weekday/window.`:`No WNMU ${topic} evidence exists in this weekday/window; treat this as exploratory.`);if(broadTopic.rates.length)reasons.push(`${topic} has ${broadTopic.rates.length} comparable results elsewhere, but not enough here.`);}score+=topicAdj;adjustments.push(['exactTopicWindow',topicAdj]);
if(titleHistory.latest){const d=daysBetween(titleHistory.latest,scheduleStart(schedule));let a=0;if(d>=730)a=titleHistory.rows===1?2:8;else if(d>=365)a=6;else if(d>=180)a=2;else if(d<90)a=-10;else if(d<180)a=-5;score+=a;adjustments.push(['rest',a]);if(a>0)reasons.push(`Rested ${d} days since the latest known airing.`);if(a<0)cautions.push(`Short rest: ${d} days since the latest known airing.`);}
let fatigue=0;if(titleHistory.rows>=12)fatigue=-8;else if(titleHistory.rows>=8)fatigue=-5;else if(titleHistory.rows>=5)fatigue=-2;else if(titleHistory.rows>0&&titleHistory.rows<=2)fatigue=3;score+=fatigue;adjustments.push(['lifetimeExposure',fatigue]);if(titleHistory.rows>=8)cautions.push(`Heavy lifetime exposure: ${titleHistory.rows} known airings.`);
score+=season.adjustment;adjustments.push(['season',season.adjustment]);reasons.push(...season.notes);const local=cachedProgram.local;if(local){score+=8;adjustments.push(['local',8]);reasons.push('Local / U.P. relevance.');}if(drama.currentCycle){score+=8;adjustments.push(['dramaDoc',8]);reasons.push(drama.basis==='series-season'?('Current Drama Doc series/season'+(drama.seasonNumber?' (Season '+drama.seasonNumber+')':'')+'.'):'Current-cycle Drama Doc fallback based on rights-start timing.');}else if(drama.olderCycle){score-=12;adjustments.push(['dramaDoc',-12]);cautions.push(drama.basis==='series-season'?('Drama Doc is not in the current series/season'+(drama.currentSeriesSeason?' (current library season '+drama.currentSeriesSeason+')':'')+'.'):'Older Drama Doc cycle receives a priority penalty.');}else if(drama.cycleUnknown)cautions.push('Drama Doc current-series/season status is unknown.');if(cachedProgram.biography){score-=4;adjustments.push(['biography',-4]);}if(cachedProgram.corePbs){score+=4;adjustments.push(['corePbs',4]);}
if(companionStatus==='dated'){
  const a=-8;
  score+=a;
  adjustments.push(['datedCompanion',a]);
  if(slot.webOnlyExperimental)reasons.push('Dated companion title: eligible here only as a lower-risk 5–7 PM Web-only test.');
  else cautions.push('Dated companion title: exclude from prime and staffed recommendation windows.');
}else if(companionStatus==='current'){
  reasons.push('Companion title is explicitly marked current.');
}
score+=programmer.adjustment;adjustments.push(['programmer',programmer.adjustment]);if(programmer.rating){reasons.push(`Programmer rating: ${programmer.label} (${programmer.adjustment>=0?'+':''}${programmer.adjustment}).`);if(programmer.rating==='low_confidence')cautions.push('Programmer rating is Low confidence; cap recommendation posture accordingly.');if(programmer.rating==='dont_air')cautions.push("Programmer rating says Don't air; strong negative input, not a rights exclusion.");}
const newTitle=titleHistory.rows===0;
const reviewedNew=newTitle&&['neutral','viable','promising','must_air'].includes(programmer.rating);
if(drama.isDramaDoc&&newTitle){score+=8;adjustments.push(['newDramaDoc',8]);reasons.push('New / unaired Drama Doc receives first-run priority.');}
if(reviewedNew){
  const a=5;
  score+=a;
  adjustments.push(['reviewedNewTitle',a]);
  reasons.push(`New / unaired title with programmer review: ${programmer.label}. Prioritize for a first WNMU pledge test.`);
}
const finish=parseDate(rightsEnd(program)),slotDate=parseDate(slot.date);if(finish&&slotDate){const d=daysBetween(slotDate,finish);if(d!=null&&d<=90){const a=titleHistory.rows?3:1;score+=a;adjustments.push(['rightsUrgency',a]);}}
if(!slot.experimental&&exactTopic.rates.length===0)score=Math.min(score,64);else if(!slot.experimental&&exactTopic.rates.length===1)score=Math.min(score,70);if(programmer.rating==='low_confidence')score=Math.min(score,58);if(programmer.rating==='dont_air')score=Math.min(score,35);score=clamp(score);
let confidence='Low';if(exactTopic.rates.length>=4&&titleHistory.fundraisers>=3&&titleHistory.rates.length>=5)confidence='High';else if(newTitle?exactTopic.fundraisers>=3:(exactTopic.fundraisers>=2||exactTitle.fundraisers>=2))confidence='Medium';if(programmer.activeProtection&&confidence==='Low')confidence='Editorial';if(newTitle&&confidence==='Low'&&exactTopic.rates.length>=2){cautions.push(`Comparable ${topic} evidence is concentrated in only ${exactTopic.fundraisers} fundraiser${exactTopic.fundraisers===1?'':'s'}; treat this as a fresh-title test, not a proven pattern.`);}let fit='Situational';if(score>=78)fit='Strong fit';else if(score>=65)fit='Good candidate';else if(score>=56)fit='Supported option';else if(score<40)fit='Rest / caution';else if(score<48)fit='Mixed evidence';if(newTitle&&confidence==='Low'&&score>=48)fit='Exploratory new title';if(programmer.rating==='low_confidence'&&score>=48)fit='Programmer caution';if(programmer.rating==='dont_air')fit="Don't air / caution";if (season.holidayOutOfSeason) {
  fit = season.holidayCategory === 'Holiday - Christmas' ? 'Save for Christmas season' : 'Out of seasonal window';
  if (programmer.storedRating === 'must_air') cautions.push('Must Air is an editorial priority for a suitable placement; it does not override seasonal fit.');
}
const result={program,programId:programId(program),title:programTitle(program),topic,secondary:programSecondary(program),score,fit,confidence,reasons:[...new Set(reasons.filter(Boolean))],cautions:[...new Set(cautions.filter(Boolean))],adjustments,titleHistory,comparableHistory:exactTitle.rates.length?exactTitle:broadTitle,exactTitleHistory:exactTitle,topicHistory:exactTopic,broadTopicHistory:broadTopic,dayHistory,season,local,drama,programmer,companionStatus,premiumPresent:!!premiumSummary(program),newTitle,reviewedNew,rights:{start:rightsStart(program),end:rightsEnd(program)},evidenceCount:titleHistory.rates.length+exactTopic.rates.length};
context.scoreCache?.set(scoreKey,result);
return result;}
  function rankProgramsForSlot(library = [], slot = {}, context = {}) {
    const ranked = (library || [])
      .map((program) => scoreProgramForSlot(program, slot, context))
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || b.evidenceCount - a.evidenceCount || a.title.localeCompare(b.title));

    const seenTitles = new Set();
    return ranked.filter((item) => {
      const key = lookupKey(item.title) || `id:${item.programId}`;
      if (seenTitles.has(key)) return false;
      seenTitles.add(key);
      return true;
    });
  }

  function dramaDocRecommendationAllowed(item = {}) {
    if (!item?.drama?.isDramaDoc) return true;
    if (item.newTitle) return true;
    const basis = text(item.drama.basis);
    if (!basis || basis === 'rights-start-fallback' || basis === 'unknown') return false;
    return item.drama.currentCycle === true;
  }

  function recommendationAllowed(item = {}, slot = null) {
    if (item?.companionStatus === 'dated') return slot?.webOnlyExperimental === true;
    return dramaDocRecommendationAllowed(item);
  }

  function selectWebOnlyRecommendationsForSlot(ranked = [], staffedBestByProgram = new Map(), slot = {}, limit = 8) {
    const keyFor = (item) => text(item?.programId || lookupKey(item?.title || ''));
    const acceptable = (ranked || []).filter((item) =>
      recommendationAllowed(item, slot) &&
      !['low_confidence', 'dont_air'].includes(item.programmer?.rating) &&
      !item.season?.holidayOutOfSeason &&
      item.score >= 40
    );

    const prepared = acceptable.map((item) => {
      const key = keyFor(item);
      const staffedBest = staffedBestByProgram.get(key);
      const staffedScore = Number(staffedBest?.score);
      const restDays = item.titleHistory?.latest ? daysBetween(item.titleHistory.latest, slot.date) : null;
      const protectedForStaffed = item.companionStatus !== 'dated'
        && Number.isFinite(staffedScore)
        && staffedScore >= 65
        && staffedScore >= Number(item.score || 0) - 5;
      let webOnlyPriority = 4;
      let webOnlyReason = 'Lower-opportunity-cost test';

      if (!item.newTitle && Number.isFinite(restDays) && restDays >= 180 && !protectedForStaffed) {
        webOnlyPriority = 0;
        webOnlyReason = `Rested repeat · ${restDays} days since last airing`;
      } else if (!item.newTitle && !protectedForStaffed) {
        webOnlyPriority = 1;
        webOnlyReason = 'Repeat / lower-opportunity-cost inventory';
      } else if (item.newTitle && item.score < 65 && !protectedForStaffed) {
        webOnlyPriority = 2;
        webOnlyReason = 'Exploratory title better suited to a low-risk test';
      } else if (!protectedForStaffed) {
        webOnlyPriority = 3;
        webOnlyReason = 'Supported option without a stronger staffed-slot claim';
      } else {
        webOnlyPriority = 5;
        webOnlyReason = 'Also has a stronger staffed-slot opportunity';
      }

      return { ...item, webOnlyPriority, webOnlyReason, staffedBestScore: Number.isFinite(staffedScore) ? staffedScore : null };
    });

    const lowCost = prepared
      .filter((item) => item.webOnlyPriority < 5)
      .sort((a, b) =>
        a.webOnlyPriority - b.webOnlyPriority ||
        Number(b.score || 0) - Number(a.score || 0) ||
        Number(b.titleHistory?.rows || 0) - Number(a.titleHistory?.rows || 0) ||
        a.title.localeCompare(b.title)
      );

    // Protected titles are fallbacks only. They remain available if the web-only
    // window otherwise has too few reasonable choices, but are deliberately pushed
    // behind repeats and lower-opportunity-cost tests.
    const protectedFallback = prepared
      .filter((item) => item.webOnlyPriority === 5)
      .sort((a, b) => Number(b.score || 0) - Number(a.score || 0) || a.title.localeCompare(b.title));

    return [...lowCost, ...protectedFallback].slice(0, limit);
  }

  function selectRecommendationsForSlot(ranked = [], limit = 4, slot = null) {
    const acceptableNew = ranked.filter((item) =>
      recommendationAllowed(item, slot) &&
      item.newTitle &&
      !['low_confidence', 'dont_air'].includes(item.programmer?.rating) &&
      !item.season?.holidayOutOfSeason &&
      item.score >= 40
    );
    const reviewedNew = acceptableNew.filter((item) => item.reviewedNew);
    const unreviewedNew = acceptableNew.filter((item) => !item.reviewedNew);
    const chosen = [];
    const seen = new Set();
    const add = (item) => {
      if (!item || seen.has(item.programId)) return false;
      chosen.push(item);
      seen.add(item.programId);
      return true;
    };

    // Favor reviewed new titles first, then other credible unaired titles.
    for (const item of reviewedNew) {
      if (chosen.length >= Math.min(3, limit)) break;
      add(item);
    }
    for (const item of unreviewedNew) {
      if (chosen.length >= Math.min(3, limit)) break;
      add(item);
    }

    // A previously aired standby is an anchor, not the bulk of the plan.
    // Add one only when at least two new titles are already present:
    // 2 new + 1 old = 33%, 3 new + 1 old = 25%.
    if (chosen.length >= 2 && chosen.length < limit) {
      const anchor = ranked.find((item) =>
        !item.newTitle &&
        recommendationAllowed(item, slot) &&
        item.score >= 48 &&
        !['low_confidence', 'dont_air'].includes(item.programmer?.rating) &&
        !item.season?.holidayOutOfSeason
      );
      add(anchor);
    }

    // If there are more strong new titles and room remains, keep the remainder new.
    if (chosen.length < limit) {
      for (const item of acceptableNew) {
        if (chosen.length >= limit) break;
        add(item);
      }
    }

    // Untested, unrated titles can collapse into large same-score clusters because
    // their evidence is topic/window level rather than title-specific. Surface that
    // uncertainty instead of implying the alphabetical tie-break is meaningful.
    return chosen.map((item) => {
      if (!item?.newTitle || item?.reviewedNew) return item;
      const topicKey = lookupKey(item.topic);
      const tied = unreviewedNew.filter((peer) =>
        lookupKey(peer.topic) === topicKey
        && Number(peer.score) === Number(item.score)
      );
      if (tied.length < 3) return item;
      const caution = `${tied.length} unrated new ${item.topic || 'program'} titles share this score in this window; their individual order is not title-specific. Add a programmer rating to distinguish them.`;
      return {
        ...item,
        cautions: [...new Set([...(item.cautions || []), caution])],
        newTitleTieCount: tied.length,
        newTitleTieExamples: tied.slice(0, 8).map((peer) => peer.title)
      };
    });
  }

  const MAX_AUTOMATED_TITLE_APPEARANCES = 4;
  const MAX_AUTOMATED_TITLE_DAYPART_APPEARANCES = 2;

  function planningSlotKey(slot = {}) {
    return text(slot.id) || `${dateKey(slot.date)}|${number(slot.startMinutes, -1)}|${number(slot.endMinutes, -1)}|${text(slot.label)}`;
  }

  function absoluteDayGap(a, b) {
    const firstDate = parseDate(a);
    const secondDate = parseDate(b);
    if (!firstDate || !secondDate) return null;
    return Math.abs(Math.round((secondDate.getTime() - firstDate.getTime()) / DAY_MS));
  }

  function buildFundraiserTitleAssignments(rankedWindows = [], maxAppearances = MAX_AUTOMATED_TITLE_APPEARANCES) {
    const cap = Math.max(1, Math.trunc(Number(maxAppearances) || MAX_AUTOMATED_TITLE_APPEARANCES));
    const byProgram = new Map();

    (rankedWindows || []).forEach(({ slot, ranked }) => {
      if (!slot || slot.blocked) return;
      const slotKey = planningSlotKey(slot);
      (ranked || []).forEach((item) => {
        if (!item || !recommendationAllowed(item, slot)) return;
        if (['low_confidence', 'dont_air'].includes(item.programmer?.rating)) return;
        if (item.season?.holidayOutOfSeason) return;
        if (Number(item.score || 0) < 40) return;
        const key = text(item.programId || lookupKey(item.title));
        if (!key) return;
        if (!byProgram.has(key)) byProgram.set(key, []);
        byProgram.get(key).push({
          key,
          slotKey,
          date: dateKey(slot.date),
          daypart: daypartForMinutes(slot.startMinutes),
          score: Number(item.score || 0),
          evidenceCount: Number(item.evidenceCount || 0),
          experimental: Boolean(slot.experimental),
          webOnlyExperimental: Boolean(slot.webOnlyExperimental),
          newTitle: Boolean(item.newTitle),
          title: item.title || key
        });
      });
    });

    const slotLoad = new Map();
    const assignments = new Map();
    const programs = [...byProgram.entries()]
      .map(([key, rows]) => ({
        key,
        rows,
        bestScore: Math.max(...rows.map((row) => Number(row.score || 0)))
      }))
      .sort((a, b) => b.bestScore - a.bestScore || a.key.localeCompare(b.key));

    const loadFor = (slotKey) => Number(slotLoad.get(slotKey) || 0);
    const choose = (rows = [], tolerance = 0) => {
      if (!rows.length) return null;
      const bestScore = Math.max(...rows.map((row) => Number(row.score || 0)));
      return rows
        .filter((row) => Number(row.score || 0) >= bestScore - tolerance)
        .sort((a, b) =>
          loadFor(a.slotKey) - loadFor(b.slotKey) ||
          Number(b.score || 0) - Number(a.score || 0) ||
          Number(b.evidenceCount || 0) - Number(a.evidenceCount || 0) ||
          String(a.date || '').localeCompare(String(b.date || ''))
        )[0] || null;
    };

    for (const program of programs) {
      const rows = [...program.rows]
        .sort((a, b) =>
          Number(b.score || 0) - Number(a.score || 0) ||
          Number(b.evidenceCount || 0) - Number(a.evidenceCount || 0) ||
          String(a.date || '').localeCompare(String(b.date || ''))
        );
      const selected = [];
      const selectedDates = new Set();
      const selectedSlotKeys = new Set();
      const daypartCounts = new Map();
      const addSelected = (row) => {
        if (!row || selectedSlotKeys.has(row.slotKey) || selectedDates.has(row.date)) return false;
        const daypart = text(row.daypart) || 'Unknown';
        if (Number(daypartCounts.get(daypart) || 0) >= MAX_AUTOMATED_TITLE_DAYPART_APPEARANCES) return false;
        selected.push(row);
        selectedSlotKeys.add(row.slotKey);
        selectedDates.add(row.date);
        daypartCounts.set(daypart, Number(daypartCounts.get(daypart) || 0) + 1);
        return true;
      };

      const staffedRows = rows.filter((row) => !row.experimental);
      // Give the main staffed plan first claim. Experimental windows can still
      // receive the title when they are the only viable inventory or after the
      // stronger staffed opportunities have been allocated.
      const primaryPool = staffedRows.length ? staffedRows : rows;
      const primary = choose(primaryPool, 0);
      addSelected(primary);

      if (primary) {
        const repeatFloor = Math.max(40, Number(primary.score || 0) - 6);
        while (selected.length < cap) {
          const eligible = rows.filter((row) => {
            const daypart = text(row.daypart) || 'Unknown';
            return !selectedSlotKeys.has(row.slotKey)
              && !selectedDates.has(row.date)
              && Number(row.score || 0) >= repeatFloor
              && Number(daypartCounts.get(daypart) || 0) < MAX_AUTOMATED_TITLE_DAYPART_APPEARANCES;
          });
          if (!eligible.length) break;

          const staffedEligible = eligible.filter((row) => !row.experimental);
          const pool = staffedEligible.length ? staffedEligible : eligible;
          const wellSpaced = pool.filter((row) => selected.every((existing) => {
            const gap = absoluteDayGap(existing.date, row.date);
            return gap == null || gap >= 2;
          }));
          const next = choose(wellSpaced.length ? wellSpaced : pool, 2);
          if (!addSelected(next)) break;
        }
      }

      const slotKeys = new Set();
      selected.slice(0, cap).forEach((row) => {
        slotKeys.add(row.slotKey);
        slotLoad.set(row.slotKey, loadFor(row.slotKey) + 1);
      });
      if (slotKeys.size) assignments.set(program.key, slotKeys);
    }

    return assignments;
  }

  function programScheduleMinutes(program = {}) {
    const bucket = number(first(program.length_bucket_minutes, program.lengthBucketMinutes, program.scheduled_minutes, program.schedule_minutes), 0);
    const raw = bucket > 0 ? bucket : programRuntimeMinutes(program);
    if (!(raw > 0)) return 60;
    return Math.max(30, Math.ceil(raw / 30) * 30);
  }

  function optimizeFundraisingWindowCandidates(candidates = [], capacityUnits = 0) {
    const capacity = Math.max(0, Math.trunc(Number(capacityUnits) || 0));
    if (!capacity) return { items: [], usedUnits: 0, value: 0 };
    const byStart = new Map();
    (candidates || []).forEach((candidate) => {
      const startUnit = Math.max(0, Math.trunc(Number(candidate.startUnit) || 0));
      if (startUnit >= capacity || !(Number(candidate.units) > 0) || startUnit + Number(candidate.units) > capacity) return;
      if (!byStart.has(startUnit)) byStart.set(startUnit, []);
      byStart.get(startUnit).push(candidate);
    });
    byStart.forEach((rows) => rows.sort((a, b) => Number(b.value || 0) - Number(a.value || 0) || Number(b.score || 0) - Number(a.score || 0)));

    const states = Array.from({ length: capacity + 1 }, () => []);
    states[0].push({ value: 0, usedUnits: 0, items: [], keys: new Set() });
    const addState = (unit, state) => {
      const rows = states[unit];
      const signature = [...state.keys].sort().join('|') + '::' + state.items.map((item) => `${item.startUnit}:${item.key}`).join(',');
      if (rows.some((entry) => entry.signature === signature)) return;
      rows.push({ ...state, signature });
      rows.sort((a, b) => b.value - a.value || b.usedUnits - a.usedUnits || b.items.length - a.items.length);
      if (rows.length > 36) rows.length = 36;
    };

    for (let unit = 0; unit < capacity; unit += 1) {
      const currentStates = [...states[unit]];
      currentStates.forEach((state) => {
        addState(unit + 1, { value: state.value, usedUnits: state.usedUnits, items: state.items, keys: new Set(state.keys) });
        (byStart.get(unit) || []).slice(0, 10).forEach((candidate) => {
          if (state.keys.has(candidate.key)) return;
          const nextUnit = unit + Number(candidate.units);
          if (nextUnit > capacity) return;
          const keys = new Set(state.keys);
          keys.add(candidate.key);
          addState(nextUnit, {
            value: state.value + Number(candidate.value || 0),
            usedUnits: state.usedUnits + Number(candidate.units),
            items: [...state.items, candidate],
            keys
          });
        });
      });
    }

    const finalists = states.flat();
    finalists.sort((a, b) => b.value - a.value || b.usedUnits - a.usedUnits || b.items.length - a.items.length);
    const best = finalists[0] || { value: 0, usedUnits: 0, items: [] };
    return { items: best.items || [], usedUnits: best.usedUnits || 0, value: best.value || 0 };
  }

  function buildFundraisingWindowLineup(ranked = [], slot = {}, context = {}, excludedProgramKeys = new Set()) {
    if (!slot.userDefined || slot.blocked) return { items: [], usedMinutes: 0, unusedMinutes: Math.max(0, Number(slot.endMinutes || 0) - Number(slot.startMinutes || 0)), threshold: null };
    const windowMinutes = Math.max(0, Number(slot.endMinutes || 0) - Number(slot.startMinutes || 0));
    const capacityUnits = Math.floor(windowMinutes / 30);
    const threshold = planningPriorityThreshold(slot.priority);
    if (!capacityUnits) return { items: [], usedMinutes: 0, unusedMinutes: windowMinutes, threshold };

    const broadPool = (ranked || []).filter((item) =>
      item?.program
      && recommendationAllowed(item, slot)
      && !['low_confidence', 'dont_air'].includes(item.programmer?.rating)
      && !item.season?.holidayOutOfSeason
    ).slice(0, 60);
    const candidates = [];

    for (let startUnit = 0; startUnit < capacityUnits; startUnit += 1) {
      const plannedStart = Number(slot.startMinutes) + (startUnit * 30);
      const exactSlot = {
        ...slot,
        id: `${slot.id}-start-${plannedStart}`,
        label: 'Fundraising window start',
        startMinutes: plannedStart,
        endMinutes: plannedStart + 30
      };
      const exact = broadPool.map((base) => scoreProgramForSlot(base.program, exactSlot, context))
        .filter((item) =>
          item
          && recommendationAllowed(item, exactSlot)
          && !['low_confidence', 'dont_air'].includes(item.programmer?.rating)
          && !item.season?.holidayOutOfSeason
          && Number(item.score) >= threshold
        )
        .sort((a, b) => Number(b.score || 0) - Number(a.score || 0) || Number(b.evidenceCount || 0) - Number(a.evidenceCount || 0))
        .slice(0, 10);

      exact.forEach((item) => {
        const scheduleMinutes = programScheduleMinutes(item.program);
        const units = Math.max(1, Math.ceil(scheduleMinutes / 30));
        if (startUnit + units > capacityUnits) return;
        const key = text(item.programId || lookupKey(item.title));
        if (!key || excludedProgramKeys.has(key)) return;
        const value = Math.max(1, Number(item.score || 0) - 40) * units
          + (item.newTitle ? 2 : 0)
          + (item.reviewedNew ? 2 : 0);
        candidates.push({
          startUnit,
          units,
          key,
          score: Number(item.score || 0),
          value,
          item,
          scheduleMinutes
        });
      });
    }

    const optimized = optimizeFundraisingWindowCandidates(candidates, capacityUnits);
    const items = (optimized.items || []).map((candidate) => ({
      ...candidate.item,
      plannedStartMinutes: Number(slot.startMinutes) + (candidate.startUnit * 30),
      plannedEndMinutes: Number(slot.startMinutes) + ((candidate.startUnit + candidate.units) * 30),
      scheduleMinutes: candidate.units * 30
    })).sort((a, b) => a.plannedStartMinutes - b.plannedStartMinutes || Number(b.score || 0) - Number(a.score || 0));
    const usedMinutes = (optimized.usedUnits || 0) * 30;
    return {
      items,
      usedMinutes,
      unusedMinutes: Math.max(0, windowMinutes - usedMinutes),
      threshold
    };
  }

  function topicChoicesForSlot(ranked = []) {
    const seen = new Set();
    const choices = [];
    for (const item of ranked) {
      const key = lookupKey(item.topic);
      if (!key || seen.has(key) || (!item.topicHistory?.rates?.length && !item.local)) continue;
      seen.add(key);
      choices.push({
        topic: item.topic,
        score: item.score,
        title: item.title,
        confidence: item.confidence,
        evidenceRows: item.topicHistory?.rates?.length || 0
      });
    }
    return choices;
  }

  function mixFromSlots(slots = []) {
    const points = new Map();
    slots.filter((slot) => !slot.experimental && !slot.blocked).forEach((slot) => {
      (slot.recommendations || []).slice(0, 3).forEach((item, index) => {
        const key = lookupKey(item.topic);
        if (!key) return;
        const current = points.get(key) || { topic: item.topic, points: 0, appearances: 0, scores: [] };
        current.points += 3 - index;
        current.appearances += 1;
        current.scores.push(item.score);
        points.set(key, current);
      });
    });
    const list = [...points.values()].map((item) => ({ ...item, averageScore: mean(item.scores) || 0 }));
    return list.sort((a, b) => b.points - a.points || b.averageScore - a.averageScore || a.topic.localeCompare(b.topic)).map((item, index) => {
      let strength = 'Situational';
      if (index <= 1 || item.averageScore >= 72) strength = 'Stronger';
      else if (item.averageScore >= 60 || item.appearances >= 3) strength = 'Moderate';
      return { ...item, strength, approximateShare: null };
    });
  }

  function topicComparison(library = [], windows = [], context = {}) {
    const groups = new Map();
    const targetSeason = seasonForDate(scheduleStart(context.schedule || {}));
    const seasonRows = context.seasonRows || (context.evidenceRows || []).filter((row) => rowSeason(row) === targetSeason);
    const reportableSeasonRows = seasonRows.filter((row) => lookupKey(rowTopic(row)) !== 'uncategorized');
    const seasonBaseline = rowSummary(reportableSeasonRows).averageRate;
    const fallbackBaseline = Number.isFinite(context.baselineRate) ? context.baselineRate : seasonBaseline;
    const rankingBaseline = Number.isFinite(seasonBaseline) && seasonBaseline > 0 ? seasonBaseline : fallbackBaseline;

    for (const program of (library || [])) {
      const topic = programTopic(program);
      const key = lookupKey(topic);
      if (!key || key === 'uncategorized') continue;
      if (!groups.has(key)) groups.set(key, { topic, programs: [], eligiblePrograms: [] });
      const group = groups.get(key);
      group.programs.push(program);
      if (eligibleSomewhereInFundraiser(program, context.schedule || {})) group.eligiblePrograms.push(program);
    }

    const titleKeyForRow = (row) => {
      const id = rowProgramId(row);
      if (id) return `id:${id}`;
      const nola = lookupKey(rowNola(row));
      if (nola) return `nola:${nola}`;
      return `title:${lookupKey(rowTitle(row))}`;
    };

    const evidenceMetrics = (rows, summary, baseline = rankingBaseline, seasonalStats = null, reliabilityStats = null) => {
      const testedTitles = new Set();
      const titleFundraiserGroups = new Map();

      for (const row of (rows || [])) {
        const titleKey = titleKeyForRow(row);
        if (titleKey && titleKey !== 'title:') testedTitles.add(titleKey);
        const fundraiser = fundraiserKey(row);
        if (!titleKey || !fundraiser) continue;
        const key = `${titleKey}|${fundraiser}`;
        if (!titleFundraiserGroups.has(key)) titleFundraiserGroups.set(key, { dollars: 0, minutes: 0 });
        const group = titleFundraiserGroups.get(key);
        const minutes = rowMinutes(row);
        if (minutes > 0) {
          group.dollars += rowDollars(row);
          group.minutes += minutes;
        }
      }

      const tests = [...titleFundraiserGroups.values()]
        .filter((group) => group.minutes > 0)
        .map((group) => group.dollars * 60 / group.minutes)
        .filter(Number.isFinite);
      const positiveTests = tests.filter((rate) => rate > 0).length;
      const successRate = tests.length ? positiveTests / tests.length : 0;
      const seasonalTestedTitleCount = Number(seasonalStats?.testedTitleCount ?? testedTitles.size);
      const seasonalFundraiserSamples = Number(seasonalStats?.fundraiserSamples ?? summary?.fundraisers ?? 0);
      const confidenceTitleCount = Number(reliabilityStats?.testedTitleCount ?? seasonalTestedTitleCount);
      const confidenceFundraiserSamples = Number(reliabilityStats?.fundraiserSamples ?? seasonalFundraiserSamples);

      // Performance and consistency remain season-specific. Reliability asks a
      // different question: has this topic been tested broadly enough anywhere
      // in WNMU pledge history to trust the seasonal result?
      const titleDepth = Math.min(1, confidenceTitleCount / 10);
      const fundraiserDepth = Math.min(1, confidenceFundraiserSamples / 6);
      const evidenceReliability = titleDepth * fundraiserDepth;

      // A strong all-season record should rescue a well-tested topic from being
      // treated as "thin" just because fewer tests landed in this pledge season.
      // But the seasonal rate still needs some seasonal support of its own so a
      // couple of unusually strong seasonal titles cannot represent the whole topic.
      const seasonalTitleSupport = Math.min(1, seasonalTestedTitleCount / 6);
      const seasonalFundraiserSupport = Math.min(1, seasonalFundraiserSamples / 4);
      const seasonalSupport = seasonalTitleSupport * seasonalFundraiserSupport;

      const consistencyFactor = 0.5 + (0.5 * successRate);
      const averageRate = Number(seasonalStats?.averageRate ?? summary?.averageRate);
      const ratio = Number.isFinite(averageRate) && Number.isFinite(baseline) && baseline > 0
        ? averageRate / baseline
        : null;
      const planningRankScore = Number.isFinite(ratio)
        ? ratio * evidenceReliability * seasonalSupport * consistencyFactor
        : -1;

      return {
        testedTitleCount: seasonalTestedTitleCount,
        seasonalFundraiserSamples,
        confidenceTitleCount,
        confidenceFundraiserSamples,
        titleFundraiserTests: tests.length,
        positiveTests,
        successRate,
        evidenceReliability,
        seasonalSupport,
        planningRankScore
      };
    };

    return [...groups.entries()]
      .map(([topicKey, group]) => {
        // Eligibility decides whether the topic belongs in this planning report.
        // Performance itself uses the full historical topic record, including
        // expired titles, because this section is measuring topic performance.
        const topicRows = seasonRows.filter((row) => lookupKey(rowTopic(row)) === topicKey);
        const rawHistory = rowSummary(topicRows);
        const sharedTopicStats = context.performanceStats?.topic?.get?.(topicKey) || null;
        const history = {
          ...rawHistory,
          averageRate: Number.isFinite(Number(sharedTopicStats?.averageRate)) ? Number(sharedTopicStats.averageRate) : rawHistory.averageRate,
          fundraisers: Number(sharedTopicStats?.fundraiserSamples ?? rawHistory.fundraisers)
        };
        const sharedReliabilityStats = context.performanceStats?.topicReliability?.get?.(topicKey) || sharedTopicStats;
        const metrics = evidenceMetrics(topicRows, history, rankingBaseline, sharedTopicStats, sharedReliabilityStats);

        let subtopicDetails = [];
        {
          const subgroups = new Map();
          for (const program of group.programs) {
            const label = programSecondary(program) || 'Unassigned';
            const key = lookupKey(label) || 'unassigned';
            if (!subgroups.has(key)) subgroups.set(key, { label, programs: [], eligiblePrograms: [] });
            const sub = subgroups.get(key);
            sub.programs.push(program);
            if (eligibleSomewhereInFundraiser(program, context.schedule || {})) sub.eligiblePrograms.push(program);
          }

          const subtopicBaseline = Number.isFinite(history.averageRate) && history.averageRate > 0
            ? history.averageRate
            : rankingBaseline;

          subtopicDetails = [...subgroups.entries()]
            .map(([subKey, sub]) => {
              const rows = topicRows.filter((row) => {
                const secondary = rowSecondary(row) || 'Unassigned';
                return (lookupKey(secondary) || 'unassigned') === subKey;
              });
              const rawSummary = rowSummary(rows);
              const sharedSubtopicStats = context.performanceStats?.subtopicByTopic?.get?.(topicKey)?.get?.(subKey) || null;
              const summary = {
                ...rawSummary,
                averageRate: Number.isFinite(Number(sharedSubtopicStats?.averageRate)) ? Number(sharedSubtopicStats.averageRate) : rawSummary.averageRate,
                fundraisers: Number(sharedSubtopicStats?.fundraiserSamples ?? rawSummary.fundraisers)
              };
              const sharedSubtopicReliabilityStats = context.performanceStats?.subtopicReliabilityByTopic?.get?.(topicKey)?.get?.(subKey) || sharedSubtopicStats;
              const metrics = evidenceMetrics(rows, summary, subtopicBaseline, sharedSubtopicStats, sharedSubtopicReliabilityStats);
              return {
                label: sub.label,
                programCount: sub.programs.length,
                eligibleProgramCount: sub.eligiblePrograms.length,
                testedTitleCount: metrics.testedTitleCount,
                confidenceTitleCount: metrics.confidenceTitleCount,
                confidenceFundraiserSamples: metrics.confidenceFundraiserSamples,
                fundraiserSamples: summary.fundraisers,
                averageRate: summary.averageRate,
                titleFundraiserTests: metrics.titleFundraiserTests,
                successRate: metrics.successRate,
                evidenceReliability: metrics.evidenceReliability,
                seasonalSupport: metrics.seasonalSupport,
                planningRankScore: metrics.planningRankScore
              };
            })
            .sort((a, b) => {
              const ar = Number.isFinite(a.averageRate) ? a.averageRate : -1;
              const br = Number.isFinite(b.averageRate) ? b.averageRate : -1;
              return br - ar
                || b.fundraiserSamples - a.fundraiserSamples
                || b.testedTitleCount - a.testedTitleCount
                || a.label.localeCompare(b.label);
            });
        }

        return {
          topic: group.topic,
          season: targetSeason,
          historyRows: Number(sharedTopicStats?.historyRows ?? history.rates.length),
          fundraiserSamples: history.fundraisers,
          averageRate: history.averageRate,
          programCount: group.programs.length,
          eligibleProgramCount: group.eligiblePrograms.length,
          testedTitleCount: metrics.testedTitleCount,
          confidenceTitleCount: metrics.confidenceTitleCount,
          confidenceFundraiserSamples: metrics.confidenceFundraiserSamples,
          titleFundraiserTests: metrics.titleFundraiserTests,
          successRate: metrics.successRate,
          evidenceReliability: metrics.evidenceReliability,
          seasonalSupport: metrics.seasonalSupport,
          planningRankScore: metrics.planningRankScore,
          subtopicDetails
        };
      })
      .sort((a, b) =>
        b.planningRankScore - a.planningRankScore
        || (b.averageRate || 0) - (a.averageRate || 0)
        || b.fundraiserSamples - a.fundraiserSamples
        || a.topic.localeCompare(b.topic)
      );
  }

  function experimentalEvidence(slot = {}, evidenceRows = [], baselineRate = null, precomputed = null, allFundraisersValue = null) {
    const directRows = precomputed?.exactRows || comparableRows(evidenceRows, slot, { exactWeekday: true });
    const summary = precomputed?.exactSummary || rowSummary(directRows);
    const fundraiserUses = fundraiserCount(directRows);
    const allFundraisers = Number.isFinite(allFundraisersValue) ? allFundraisersValue : fundraiserCount(evidenceRows);
    const ratio = Number.isFinite(summary.averageRate) && Number.isFinite(baselineRate) && baselineRate > 0
      ? summary.averageRate / baselineRate
      : null;
    let verdict = 'Hypothesis only';
    let rationale = 'WNMU has no direct rate-valid history in this exact weekday/time window.';
    if (summary.rates.length >= 3 && Number.isFinite(ratio) && ratio >= 1.1) {
      const underused = allFundraisers >= 4 && fundraiserUses <= Math.max(2, Math.floor(allFundraisers * 0.35));
      verdict = underused ? 'Productive but underused at WNMU' : 'Historically productive at WNMU';
      rationale = `${summary.rates.length} rate-valid WNMU airings across ${fundraiserUses} fundraiser${fundraiserUses === 1 ? '' : 's'}, average $${Math.round(summary.averageRate)}/hr (${Math.round((ratio - 1) * 100)}% above the overall pledge baseline).`;
    } else if (summary.rates.length >= 2) {
      verdict = Number.isFinite(ratio) && ratio >= 1 ? 'Some encouraging WNMU evidence' : 'Mixed WNMU evidence';
      rationale = `${summary.rates.length} rate-valid WNMU airings across ${fundraiserUses} fundraiser${fundraiserUses === 1 ? '' : 's'}${Number.isFinite(summary.averageRate) ? `, average $${Math.round(summary.averageRate)}/hr` : ''}.`;
    } else if (summary.rates.length === 1) {
      verdict = 'Thin WNMU evidence';
      rationale = 'Only one rate-valid WNMU airing exists for this exact weekday/time, so this remains experimental.';
    }
    return {
      verdict,
      rationale,
      rows: summary.rates.length,
      averageRate: summary.averageRate,
      fundraiserUses,
      allFundraisers,
      peerEvidence: 'No structured peer-station day/time evidence is currently loaded, so no peer-station claim is used.'
    };
  }

  function repeatCandidates(slots = []) {
    const byProgram = new Map();
    slots.filter((slot) => !slot.experimental && !slot.blocked && slot.label === 'Prime').forEach((slot) => {
      (slot.recommendations || []).slice(0, 4).forEach((item) => {
        if (!item.programId) return;
        const current = byProgram.get(item.programId) || { ...item, slots: [] };
        current.slots.push(slot);
        byProgram.set(item.programId, current);
      });
    });
    return [...byProgram.values()].filter((item) => {
      if (item.slots.length < 2 || item.score < 60) return false;
      const dates = item.slots.map((slot) => parseDate(slot.date)).filter(Boolean).sort((a, b) => a - b);
      return dates.length >= 2 && daysBetween(dates[0], dates[dates.length - 1]) >= 3;
    }).sort((a, b) => b.score - a.score).slice(0, 8);
  }

  function rightsConstraints(library = [], schedule = {}) {
    const start = parseDate(scheduleStart(schedule));
    const end = parseDate(scheduleEnd(schedule));
    if (!start || !end) return { unavailable: [], partial: [] };
    const unavailable = [];
    const partial = [];
    (library || []).forEach((program) => {
      const begin = parseDate(rightsStart(program));
      const finish = parseDate(rightsEnd(program));
      if ((finish && finish < start) || (begin && begin > end)) {
        unavailable.push({ title: programTitle(program), programId: programId(program), rightsStart: rightsStart(program), rightsEnd: rightsEnd(program) });
      } else if ((begin && begin > start) || (finish && finish < end)) {
        partial.push({ title: programTitle(program), programId: programId(program), rightsStart: rightsStart(program), rightsEnd: rightsEnd(program) });
      }
    });
    return { unavailable, partial };
  }

  function buildStrategy({ schedule = {}, library = [], evidenceRows = [], overrides = [], performanceStats = null, fixedScheduleProgramIds = [], fixedScheduleTitles = [], now = new Date() } = {}) {
    const cutoff = evidenceCutoff(schedule, now);
    const historicalRows = filterEvidenceAirings(evidenceRows, cutoff);
    const overrideByProgramId = overrideIndex(overrides);
    const fixedProgramIds = new Set((fixedScheduleProgramIds || []).map(text).filter(Boolean));
    const fixedTitleKeys = new Set((fixedScheduleTitles || []).map(lookupKey).filter(Boolean));
    const targetSeason = seasonForDate(scheduleStart(schedule));
    const seasonRows = historicalRows.filter((row) => rowSeason(row) === targetSeason);
    const seasonFundraiserCount = fundraiserCount(seasonRows);
    const baselineRows = seasonFundraiserCount >= 2 ? seasonRows : historicalRows;
    const baselineRate = baseHistoricalRate(baselineRows);
    const viable = (library || []).filter((program) => eligibleSomewhereInFundraiser(program, schedule));
    const dramaCycleIndex = buildDramaCycleIndex(viable, schedule);
    const context = {
      schedule,
      dramaCycleIndex,
      evidenceRows: historicalRows,
      overrideByProgramId,
      baselineRate,
      performanceStats,
      targetSeason,
      seasonFundraiserCount,
      programRowIndex: buildProgramRowIndex(historicalRows),
      slotEvidenceIndex: buildSlotEvidenceIndex(historicalRows),
      seasonRows,
      programRowsCache: new Map(),
      programEvidenceCache: new Map(),
      slotEvidenceCache: new Map(),
      scoreCache: new Map(),
      seasonSlotEvidenceIndex: null,
      seasonSlotEvidenceCache: new Map(),
      seasonTopicSummaryCache: new Map(),
      evidenceFundraiserCount: fundraiserCount(historicalRows)
    };
    context.seasonSlotEvidenceIndex = buildSlotEvidenceIndex(context.seasonRows);
    const plannedWindows = planningWindows(schedule);
    const rankedWindows = plannedWindows.map((slot) => ({
      slot,
      ranked: slot.blocked ? [] : rankProgramsForSlot(viable, slot, context)
    }));

    const staffedBestByProgram = new Map();
    rankedWindows.forEach(({ slot, ranked }) => {
      if (slot.blocked || slot.webOnlyExperimental) return;
      ranked.forEach((item) => {
        if (!recommendationAllowed(item, slot)) return;
        const key = text(item?.programId || lookupKey(item?.title || ''));
        if (!key) return;
        const current = staffedBestByProgram.get(key);
        if (!current || Number(item.score || 0) > Number(current.score || 0)) staffedBestByProgram.set(key, item);
      });
    });

    const fundraiserTitleAssignments = buildFundraiserTitleAssignments(rankedWindows);
    const lineupUsedByDate = new Map();
    const windows = rankedWindows.map(({ slot, ranked }) => {
      const requestedMinutes = Math.max(0, Number(slot.endMinutes || 0) - Number(slot.startMinutes || 0));
      if (slot.blocked) return { ...slot, recommendations: [], lineup: [], recommendedMinutes: 0, unusedMinutes: requestedMinutes, recommendationThreshold: null, strongestTopics: [], alternativeTopics: [], evidenceRows: 0, experimentalEvidence: null };
      const topics = topicChoicesForSlot(ranked);
      const slotEvidence = seasonFundraiserCount >= 2
        ? cachedSeasonSlotEvidence(slot, context)
        : cachedSlotEvidence(slot, context);
      const exactRows = slotEvidence.exactRows;
      const experimentalRows = seasonFundraiserCount >= 2 ? seasonRows : historicalRows;
      const slotKey = planningSlotKey(slot);
      const allocatedRanked = ranked.filter((item) => {
        const key = text(item?.programId || lookupKey(item?.title || ''));
        const assigned = fundraiserTitleAssignments.get(key);
        return Boolean(assigned && assigned.has(slotKey));
      });
      const recommendations = slot.webOnlyExperimental
        ? selectWebOnlyRecommendationsForSlot(allocatedRanked, staffedBestByProgram, slot, 8)
        : selectRecommendationsForSlot(allocatedRanked, slot.userDefined ? 8 : 4, slot);
      const lineupPool = slot.webOnlyExperimental
        ? selectWebOnlyRecommendationsForSlot(allocatedRanked, staffedBestByProgram, slot, 60)
        : allocatedRanked;
      const usedKeys = lineupUsedByDate.get(slot.date) || new Set();
      const lineupPlan = slot.userDefined
        ? buildFundraisingWindowLineup(lineupPool, slot, context, usedKeys)
        : { items: [], usedMinutes: 0, unusedMinutes: 0, threshold: null };
      if (slot.userDefined) {
        lineupPlan.items.forEach((item) => {
          const key = text(item.programId || lookupKey(item.title));
          if (key) usedKeys.add(key);
        });
        lineupUsedByDate.set(slot.date, usedKeys);
      }
      return {
        ...slot,
        recommendations,
        lineup: lineupPlan.items,
        recommendedMinutes: lineupPlan.usedMinutes,
        unusedMinutes: lineupPlan.unusedMinutes,
        recommendationThreshold: lineupPlan.threshold,
        requestedMinutes,
        windowHistory: slotEvidence.exactSummary,
        strongestTopics: topics.slice(0, 3),
        alternativeTopics: topics.slice(3, 6),
        evidenceRows: exactRows.length,
        experimentalEvidence: slot.experimental ? experimentalEvidence(slot, experimentalRows, baselineRate, slotEvidence, fundraiserCount(experimentalRows)) : null
      };
    });
    const rights = rightsConstraints(library, schedule);
    const seasonal = viable.map((program) => {
      const cached = cachedProgramEvidence(program, context);
      const season = cached.season;
      const drama = cached.drama;
      const newTitle = cached.titleHistory.rows === 0;
      return { program, title: programTitle(program), programId: programId(program), topic: programTopic(program), season, drama, newTitle };
    }).filter((item) => item.season.adjustment > 0 && recommendationAllowed(item))
      .sort((a, b) => b.season.adjustment - a.season.adjustment || a.title.localeCompare(b.title)).slice(0, 10);
    const local = viable.filter(isLocal).map((program) => windows.filter((slot) => !slot.experimental && !slot.blocked)
      .map((slot) => scoreProgramForSlot(program, slot, context)).filter(Boolean)
      .sort((a, b) => b.score - a.score)[0] || null)
      .filter((item) => Boolean(item) && recommendationAllowed(item))
      .sort((a, b) => b.score - a.score).slice(0, 10);
    const avoid = viable.map((program) => {
      const cached = cachedProgramEvidence(program, context);
      const rows = cached.titleRows;
      const history = cached.titleHistory;
      const rating = normalizeRating(overrideByProgramId.get(programId(program))?.rating);
      const drama = cached.drama;
      const season = cached.season;

      if (excludedFromAvoidList(program, history, drama, baselineRate, rating, fixedProgramIds, fixedTitleKeys)) return null;

      const rest = history.latest ? daysBetween(history.latest, scheduleStart(schedule)) : null;
      const reasons = [];
      if (rating === 'dont_air') reasons.push("Programmer rating: Don't air");
      if (rating === 'low_confidence') reasons.push('Programmer rating: Low confidence');
      if (history.rows >= 8 && (rest == null || rest < 730)) reasons.push(`Heavy lifetime exposure (${history.rows} airings)`);
      if (rest != null && rest < 90) reasons.push(`Very quick return (${rest} days)`);
      else if (rest != null && rest < 180) reasons.push(`Short rest (${rest} days)`);
      if (season.holidayOutOfSeason) reasons.push(`${season.holidayCategory || 'Holiday'} title out of seasonal window`);
      return reasons.length ? {
        program,
        title: programTitle(program),
        programId: programId(program),
        topic: programTopic(program),
        reasons,
        history,
        rating,
        drama,
        season,
        baselineRate
      } : null;
    }).filter(Boolean).sort((a, b) => b.reasons.length - a.reasons.length || b.history.rows - a.history.rows || a.title.localeCompare(b.title)).slice(0, 20);
    return {
      schedule,
      cutoff,
      evidenceRows: historicalRows.length,
      evidenceFundraisers: fundraiserCount(historicalRows),
      libraryTitles: library.length,
      eligibleTitles: viable.length,
      baselineRate,
      windows,
      titleAppearanceCap: MAX_AUTOMATED_TITLE_APPEARANCES,
      titleDaypartAppearanceCap: MAX_AUTOMATED_TITLE_DAYPART_APPEARANCES,
      mix: mixFromSlots(windows),
      topicComparison: topicComparison(library, windows, context),
      repeats: repeatCandidates(windows),
      seasonal,
      local,
      avoid,
      rights,
      limitations: [
        'Report 5 uses the same schedule-reconciled historical program evidence as Historical Analytics: superseded imports, unmatched program results, out-of-period rows, and rows without a reliable duration do not enter performance rates.',
        'For a future fundraiser, evidence is capped at today. Only completed historical fundraiser schedules are used by the report worker.',
        'Visible performance rates use fundraiser-balanced Avg $ / Pledge Hour so one heavily scheduled drive does not dominate the history.',
        'Topic performance is season-specific and its displayed average matches the Historical Analytics fundraiser-balanced average for that topic; Uncategorized / incidental pledge activity is excluded from programming rankings.',
        'Day/time performance uses the same reconciled history in half-hour program-start buckets from 6 AM through late evening; exact half-hour starts stay distinct.',
        'Time-window recommendation evidence uses starts inside the actual planning window rather than the former ±90-minute / broad-daypart approximation.',
        'Programmer ratings are weighted inputs. For new / unaired titles, an explicit Neutral, Viable, Promising, or Must Air rating increases first-test priority; Low confidence and Don\'t air do not.',
        'Drama Doc repeat eligibility uses series/season references found in title or program notes when available; rights-start recency is only the fallback when the pledge record does not identify a season.',
        'Day-by-day recommendations favor new / unaired titles. Previously aired standbys are limited to one anchor only when at least two credible new titles are available, keeping old titles at about 25–33% of that slot list.',
        'The automated Fundraiser Plan allocates titles across the entire drive before rendering individual days. A title can appear at most four times, no more than twice in the same daypart, and repeat use is reserved for its strongest distinct-date opportunities rather than simply the first chronological windows.',
        'Scheduling-opportunity flags are shown once per weekly timeslot. Weak results dominated by one programming type are treated as a narrow test, not proof that the clock time itself is bad.',
        'The avoid/rest list is limited to discretionary pledge titles: fixed-schedule programs, Drama Docs, and titles whose own WNMU average is still at or above the relevant pledge baseline are excluded unless a programmer explicitly marked them Don\'t air or Low confidence.',
        'Holiday scoring is category-aware: Christmas is seasonal, New Year is narrow, and Jewish/Muslim holidays use movable-calendar windows when a specific holiday is identifiable.',
        'Islamic-calendar holiday windows are planning approximations and may differ by local moon sighting.',
        'Friday 8–9 PM is protected regular programming and excluded from pledge recommendations.'
      ]
    };
  }

  const api = {
    PROGRAMMER_WEIGHTS,
    PROGRAMMER_LABELS,
    text,
    lookupKey,
    parseDate,
    dateKey,
    scheduleStart,
    scheduleEnd,
    evidenceCutoff,
    filterEvidenceAirings,
    seasonForDate,
    rowSeason,
    programId,
    programTitle,
    programNola,
    programTopic,
    programSecondary,
    programRuntimeMinutes,
    rightsStart,
    rightsEnd,
    premiumSummary,
    companionProgramStatus,
    isLocal,
    holidayCategory,
    holidaySeasonAdjustment,
    isHoliday,
    dramaInfo,
    titleEligibleForDate,
    eligibleSomewhereInFundraiser,
    normalizeRating,
    overrideIndex,
    rowRate,
    rowStartMinutes,
    rowWeekpart,
    daypartForMinutes,
    median,
    mean,
    fundraiserKey,
    planningPriority,
    planningPriorityLabel,
    planningPriorityThreshold,
    userFundraisingWindows,
    customPlanningWindows,
    planningWindows,
    programScheduleMinutes,
    optimizeFundraisingWindowCandidates,
    buildFundraisingWindowLineup,
    rowsForProgram,
    rowSummary,
    comparableRows,
    seasonEvidence,
    programmerEvidence,
    scoreProgramForSlot,
    rankProgramsForSlot,
    selectRecommendationsForSlot,
    selectWebOnlyRecommendationsForSlot,
    planningSlotKey,
    buildFundraiserTitleAssignments,
    dramaDocRecommendationAllowed,
    recommendationAllowed,
    dramaSeasonNumbers,
    dramaSeriesKey,
    buildDramaCycleIndex,
    dramaInfo,
    mixFromSlots,
    topicComparison,
    experimentalEvidence,
    repeatCandidates,
    rightsConstraints,
    buildStrategy
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof globalThis !== 'undefined') globalThis.WNMUProgrammingStrategyAnalysis = api;
})();
