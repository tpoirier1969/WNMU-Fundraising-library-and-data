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
    const month = date.getMonth();
    if (month === 0 || month >= 9) return 'December';
    if (month <= 3) return 'March';
    if (month <= 5) return 'June';
    if (month <= 8) return 'August';
    return 'December';
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
    const value = programText(program);
    return LOCAL_WORD_PATTERN.test(value) || LOCAL_UP_PATTERN.test(value);
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

  function dramaInfo(program = {}, schedule = {}) {
    const isDramaDoc = lookupKey(programTopic(program)) === 'drama doc';
    if (!isDramaDoc) return { isDramaDoc: false, currentCycle: false, olderCycle: false, cycleUnknown: false };
    const target = parseDate(scheduleStart(schedule));
    const began = parseDate(rightsStart(program));
    if (!target || !began) return { isDramaDoc: true, currentCycle: false, olderCycle: false, cycleUnknown: true };
    const cycleFloor = addDays(target, -365);
    const currentCycle = began >= cycleFloor && began <= addDays(target, 31);
    return { isDramaDoc: true, currentCycle, olderCycle: !currentCycle, cycleUnknown: false, rightsBegin: began };
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

  function planningWindows(schedule = {}) {
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
      windows.push({ ...base, id: `${base.date}-1700`, label: 'Early evening', startMinutes: 17 * 60, endMinutes: 19 * 60, confidenceClass: 'normal', experimental: false, blocked: false });
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

  function fundraiserCount(rows = []) {
    return new Set(rows.map((row) => text(first(row.fundraiserId, row.fundraiser_id, row.fundraiserTitle, row.fundraiser_label, airingDate(row)))).filter(Boolean)).size;
  }

  function rowSummary(rows = [], program = null) {
    const rates = [];
    const fundraisers = new Set();
    let totalDollars = 0;
    let earliest = null;
    let latest = null;
    for (const row of (rows || [])) {
      const rate = rowRate(row, program);
      if (Number.isFinite(rate)) rates.push(rate);
      totalDollars += rowDollars(row);
      const fundraiser = text(first(row.fundraiserId, row.fundraiser_id, row.fundraiserTitle, row.fundraiser_label, airingDate(row)));
      if (fundraiser) fundraisers.add(fundraiser);
      const when = parseDate(airingDate(row));
      if (when) {
        if (!earliest || when < earliest) earliest = when;
        if (!latest || when > latest) latest = when;
      }
    }
    return {
      rows: (rows || []).length,
      fundraisers: fundraisers.size,
      rates,
      medianRate: median(rates),
      averageRate: mean(rates),
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
    const targetDaypart = daypartForMinutes(slot.startMinutes);
    return (rows || []).filter((row) => {
      if (targetTopic && lookupKey(rowTopic(row)) !== targetTopic) return false;
      const start = rowStartMinutes(row);
      const date = parseDate(airingDate(row));
      if (!date || !Number.isFinite(start)) return false;
      if (exactWeekday && date.getDay() !== targetWeekday) return false;
      if (!exactWeekday && rowWeekpart(row) !== targetPart) return false;
      return Math.abs(start - slot.startMinutes) <= 90 || daypartForMinutes(start) === targetDaypart;
    });
  }

  function programEvidenceCacheKey(program = {}) {
    const id = programId(program);
    if (id) return `id:${id}`;
    return `nola:${lookupKey(programNola(program))}|title:${lookupKey(programTitle(program))}`;
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
    const targetDaypart = daypartForMinutes(slot.startMinutes);
    const indexed = context.slotEvidenceIndex;

    let exactRows;
    let broadRows;
    let exactMeta;
    let broadMeta;
    if (indexed && Number.isFinite(targetWeekday)) {
      const matchesWindow = (meta) => Math.abs(meta.start - slot.startMinutes) <= 90 || meta.daypart === targetDaypart;
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
    const targetDaypart = daypartForMinutes(slot.startMinutes);
    const indexed = context.seasonSlotEvidenceIndex;
    const matchesWindow = (meta) => Math.abs(meta.start - slot.startMinutes) <= 90 || meta.daypart === targetDaypart;
    const exactMeta = indexed && Number.isFinite(targetWeekday)
      ? (indexed.byWeekday.get(targetWeekday) || []).filter(matchesWindow)
      : [];
    const broadMeta = indexed
      ? (indexed.byWeekpart.get(targetPart) || []).filter(matchesWindow)
      : [];
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
      drama: dramaInfo(program, schedule),
      override,
      programmer: programmerEvidence(program, titleRows, override),
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
    if (!summary || summary.rates.length < 3 || !Number.isFinite(summary.medianRate)) return 0;
    if (!Number.isFinite(baselineRate) || baselineRate <= 0) {
      if (summary.medianRate >= 500) return 6;
      if (summary.medianRate < 150) return -4;
      return 0;
    }
    const ratio = summary.medianRate / baselineRate;
    if (ratio >= 1.35) return 8;
    if (ratio >= 1.1) return 4;
    if (ratio <= 0.65) return -8;
    if (ratio <= 0.85) return -4;
    return 0;
  }

  function ratioAdjustment(summary, baseline, strong = 8, weak = -10) {
    if (!summary || summary.rates.length < 2 || !Number.isFinite(summary.medianRate) || !Number.isFinite(baseline) || baseline <= 0) return 0;
    const ratio = summary.medianRate / baseline;
    if (ratio >= 1.35) return strong;
    if (ratio >= 1.1) return Math.round(strong / 2);
    if (ratio <= 0.55) return weak;
    if (ratio <= 0.75) return Math.round(weak * 0.65);
    if (ratio <= 0.9) return Math.round(weak * 0.35);
    return 0;
  }

  function seasonEvidence(program = {}, historyRows = [], schedule = {}) {
    const targetSeason = seasonForDate(scheduleStart(schedule));
    const same = historyRows.filter((row) => seasonForDate(airingDate(row)) === targetSeason);
    const other = historyRows.filter((row) => seasonForDate(airingDate(row)) !== targetSeason);
    const sameSummary = rowSummary(same, program);
    const otherSummary = rowSummary(other, program);
    let adjustment = 0;
    const notes = [];
    if (sameSummary.rates.length >= 2 && otherSummary.rates.length >= 2 && Number.isFinite(otherSummary.medianRate) && otherSummary.medianRate > 0) {
      const ratio = sameSummary.medianRate / otherSummary.medianRate;
      if (ratio >= 1.35) adjustment += 6;
      else if (ratio <= 0.65) adjustment -= 6;
      notes.push(`${targetSeason} title history: ${sameSummary.rates.length} rate-valid airings, median ${Math.round(sameSummary.medianRate)}/hr.`);
    } else if (sameSummary.rates.length >= 2) {
      if (sameSummary.medianRate >= 600) adjustment += 4;
      else if (sameSummary.medianRate === 0) adjustment -= 5;
      else if (sameSummary.medianRate < 150) adjustment -= 3;
      notes.push(`${targetSeason} title history: ${sameSummary.rates.length} rate-valid airings.`);
    } else if (sameSummary.rates.length === 1) {
      if (sameSummary.medianRate >= 500) adjustment += 2;
      notes.push(`Only one ${targetSeason} title airing is available; it is not used as negative evidence by itself.`);
    }
    const holidayInfo = holidaySeasonAdjustment(program, schedule);
    const holiday = Boolean(holidayInfo.category);
    if (holiday) {
      adjustment += holidayInfo.adjustment;
      if (holidayInfo.note) notes.push(holidayInfo.note);
    }
    return { targetSeason, holiday, holidayCategory: holidayInfo.category, holidayInWindow: holidayInfo.inWindow, holidayOutOfSeason: holidayInfo.outOfSeason, same: sameSummary, other: otherSummary, adjustment, notes };
  }

  function weakPrimeTestsSinceRating(program = {}, historyRows = [], override = null) {
    if (!override || normalizeRating(override.rating) !== 'must_air') return 0;
    const ratedAt = parseDate(first(override.rated_at, override.updated_at, ''));
    if (!ratedAt) return 0;
    return historyRows.filter((row) => {
      const when = parseDate(airingDate(row));
      const start = rowStartMinutes(row);
      const rate = rowRate(row, program);
      if (!when || when <= ratedAt || !Number.isFinite(start) || start < 19 * 60 || start >= 23 * 60) return false;
      return rowDollars(row) <= 0 || (Number.isFinite(rate) && rate < 150);
    }).length;
  }

  function programmerEvidence(program = {}, historyRows = [], override = null) {
    const rating = normalizeRating(override?.rating);
    if (!rating) return { rating: '', label: 'Neutral', adjustment: 0, weakCount: 0, activeProtection: false };
    const weakCount = weakPrimeTestsSinceRating(program, historyRows, override);
    let adjustment = PROGRAMMER_WEIGHTS[rating] || 0;
    const activeProtection = rating === 'must_air' && weakCount < 2;
    if (rating === 'must_air' && weakCount >= 2) adjustment = 8;
    return { rating, label: PROGRAMMER_LABELS[rating], adjustment, weakCount, activeProtection };
  }

  function baseHistoricalRate(evidenceRows = []) {
    return median((evidenceRows || []).map((row) => rowRate(row)).filter(Number.isFinite));
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
const exactTitle = rowSummary(comparableRows(titleRows,slot,{exactWeekday:true}),program);
const broadTitle = rowSummary(comparableRows(titleRows,slot,{exactWeekday:false}),program);
const topic = programTopic(program);
const slotEvidence = cachedSlotEvidence(slot, context);
const topicKey = lookupKey(topic);
const exactTopic = slotEvidence.exactTopicSummaries.get(topicKey) || rowSummary([]);
const broadTopic = slotEvidence.broadTopicSummaries.get(topicKey) || rowSummary([]);
const dayHistory = slotEvidence.exactSummary;
const season = cachedProgram.season;
const drama = cachedProgram.drama;
const override = cachedProgram.override;
const programmer = cachedProgram.programmer;
const baseline = Number.isFinite(context.baselineRate)?context.baselineRate:baseHistoricalRate(rows);let score=50;const reasons=[],cautions=[],adjustments=[];
if(titleHistory.rows){const a=rateAdjustment(titleHistory.medianRate);score+=a;adjustments.push(['titleHistory',a]);reasons.push(`WNMU title history: ${titleHistory.rows} airing${titleHistory.rows===1?'':'s'}${Number.isFinite(titleHistory.medianRate)?`, median $${Math.round(titleHistory.medianRate)}/hr`:''}.`);}else reasons.push('No prior WNMU title airing before the evidence cutoff.');
if(exactTitle.rates.length){const a=Math.max(-8,Math.min(8,Math.round(rateAdjustment(exactTitle.medianRate)*.5)));score+=a;adjustments.push(['exactTitleSlot',a]);reasons.push(`${exactTitle.rates.length} title airing${exactTitle.rates.length===1?'':'s'} on this weekday/time.`);}else if(broadTitle.rates.length)reasons.push(`${broadTitle.rates.length} comparable title result${broadTitle.rates.length===1?'':'s'} elsewhere, but none on this exact weekday/time.`);
const dayAdj=ratioAdjustment(dayHistory,baseline,8,-16);score+=dayAdj;adjustments.push(['weekdayWindow',dayAdj]);if(dayHistory.rates.length>=2&&Number.isFinite(dayHistory.medianRate))reasons.push(`${slot.weekday} ${slot.label.toLowerCase()} history: ${dayHistory.rates.length} rows, median $${Math.round(dayHistory.medianRate)}/hr.`);if(dayAdj<=-6)cautions.push(`${slot.weekday} ${slot.label.toLowerCase()} is historically weaker than WNMU's overall pledge baseline.`);
let topicAdj=0;if(exactTopic.rates.length>=2){topicAdj=ratioAdjustment(exactTopic,baseline,9,-10);reasons.push(`${topic} has ${exactTopic.rates.length} rate-valid airing${exactTopic.rates.length===1?'':'s'} on this weekday/time${Number.isFinite(exactTopic.medianRate)?`, median $${Math.round(exactTopic.medianRate)}/hr`:''}.`);}else if(!slot.experimental){topicAdj=exactTopic.rates.length===1?-4:-9;cautions.push(exactTopic.rates.length?`Only one ${topic} result exists on this weekday/time.`:`No WNMU ${topic} evidence exists on this weekday/time; treat this as exploratory.`);if(broadTopic.rates.length)reasons.push(`${topic} has ${broadTopic.rates.length} comparable results elsewhere, but not enough here.`);}score+=topicAdj;adjustments.push(['exactTopicWindow',topicAdj]);
if(titleHistory.latest){const d=daysBetween(titleHistory.latest,scheduleStart(schedule));let a=0;if(d>=730)a=8;else if(d>=365)a=6;else if(d>=180)a=2;else if(d<90)a=-10;else if(d<180)a=-5;score+=a;adjustments.push(['rest',a]);if(a>0)reasons.push(`Rested ${d} days since the latest known airing.`);if(a<0)cautions.push(`Short rest: ${d} days since the latest known airing.`);}
let fatigue=0;if(titleHistory.rows>=12)fatigue=-8;else if(titleHistory.rows>=8)fatigue=-5;else if(titleHistory.rows>=5)fatigue=-2;else if(titleHistory.rows>0&&titleHistory.rows<=2)fatigue=3;score+=fatigue;adjustments.push(['lifetimeExposure',fatigue]);if(titleHistory.rows>=8)cautions.push(`Heavy lifetime exposure: ${titleHistory.rows} known airings.`);
score+=season.adjustment;adjustments.push(['season',season.adjustment]);reasons.push(...season.notes);const local=cachedProgram.local;if(local){score+=8;adjustments.push(['local',8]);reasons.push('Local / U.P. relevance.');}if(drama.currentCycle){score+=8;adjustments.push(['dramaDoc',8]);reasons.push('Current-cycle Drama Doc proxy based on rights-start timing.');}else if(drama.olderCycle){score-=12;adjustments.push(['dramaDoc',-12]);cautions.push('Older Drama Doc cycle receives a priority penalty.');}else if(drama.cycleUnknown)cautions.push('Drama Doc cycle is unknown because rights-start timing is unavailable.');if(cachedProgram.biography){score-=4;adjustments.push(['biography',-4]);}if(cachedProgram.corePbs){score+=4;adjustments.push(['corePbs',4]);}
score+=programmer.adjustment;adjustments.push(['programmer',programmer.adjustment]);if(programmer.rating){reasons.push(`Programmer rating: ${programmer.label} (${programmer.adjustment>=0?'+':''}${programmer.adjustment}).`);if(programmer.rating==='low_confidence')cautions.push('Programmer rating is Low confidence; cap recommendation posture accordingly.');if(programmer.rating==='dont_air')cautions.push("Programmer rating says Don't air; strong negative input, not a rights exclusion.");}
const newTitle=titleHistory.rows===0;
const reviewedNew=newTitle&&['neutral','viable','promising','must_air'].includes(programmer.rating);
if(reviewedNew){
  const a=5;
  score+=a;
  adjustments.push(['reviewedNewTitle',a]);
  reasons.push(`New / unaired title with programmer review: ${programmer.label}. Prioritize for a first WNMU pledge test.`);
}
const finish=parseDate(rightsEnd(program)),slotDate=parseDate(slot.date);if(finish&&slotDate){const d=daysBetween(slotDate,finish);if(d!=null&&d<=90){const a=titleHistory.rows?3:1;score+=a;adjustments.push(['rightsUrgency',a]);}}
if(!slot.experimental&&exactTopic.rates.length===0)score=Math.min(score,64);else if(!slot.experimental&&exactTopic.rates.length===1)score=Math.min(score,70);if(programmer.rating==='low_confidence')score=Math.min(score,58);if(programmer.rating==='dont_air')score=Math.min(score,35);score=clamp(score);
let confidence='Low';if(exactTopic.rates.length>=4&&titleHistory.fundraisers>=3&&titleHistory.rates.length>=5)confidence='High';else if(exactTopic.rates.length>=2||exactTitle.rates.length>=2)confidence='Medium';if(programmer.activeProtection&&confidence==='Low')confidence='Editorial';let fit='Situational';if(score>=78)fit='Strong fit';else if(score>=65)fit='Good candidate';else if(score>=56)fit='Supported option';else if(score<40)fit='Rest / caution';else if(score<48)fit='Mixed evidence';if(programmer.rating==='low_confidence'&&score>=48)fit='Programmer caution';if(programmer.rating==='dont_air')fit="Don't air / caution";if (season.holidayOutOfSeason && programmer.rating !== 'must_air') {
  fit = season.holidayCategory === 'Holiday - Christmas' ? 'Save for Christmas season' : 'Out of seasonal window';
}
const result={program,programId:programId(program),title:programTitle(program),topic,secondary:programSecondary(program),score,fit,confidence,reasons:[...new Set(reasons.filter(Boolean))],cautions:[...new Set(cautions.filter(Boolean))],adjustments,titleHistory,comparableHistory:exactTitle.rates.length?exactTitle:broadTitle,exactTitleHistory:exactTitle,topicHistory:exactTopic,broadTopicHistory:broadTopic,dayHistory,season,local,drama,programmer,premiumPresent:!!premiumSummary(program),newTitle,reviewedNew,rights:{start:rightsStart(program),end:rightsEnd(program)},evidenceCount:titleHistory.rates.length+exactTopic.rates.length};
context.scoreCache?.set(scoreKey,result);
return result;}
  function rankProgramsForSlot(library = [], slot = {}, context = {}) {
    return (library || [])
      .map((program) => scoreProgramForSlot(program, slot, context))
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || b.evidenceCount - a.evidenceCount || a.title.localeCompare(b.title));
  }

  function selectRecommendationsForSlot(ranked = [], limit = 4) {
    const acceptableNew = ranked.filter((item) =>
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
    return chosen;
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
    const seasonRows = context.seasonRows || (context.evidenceRows || []).filter((row) => seasonForDate(airingDate(row)) === targetSeason);
    const seasonTopicSummaryCache = context.seasonTopicSummaryCache || new Map();

    for (const program of (library || [])) {
      const topic = programTopic(program);
      const key = lookupKey(topic);
      if (!groups.has(key)) groups.set(key, { topic, programs: [], eligiblePrograms: [], subtopics: new Set() });
      const group = groups.get(key);
      group.programs.push(program);
      if (eligibleSomewhereInFundraiser(program, context.schedule || {})) group.eligiblePrograms.push(program);
      const secondary = programSecondary(program);
      if (secondary) group.subtopics.add(secondary);
    }

    return [...groups.entries()].map(([topicKey, group]) => {
      let history = seasonTopicSummaryCache.get(topicKey);
      if (!history) {
        const topicRows = seasonRows.filter((row) => lookupKey(rowTopic(row)) === topicKey);
        history = rowSummary(topicRows);
        seasonTopicSummaryCache.set(topicKey, history);
      }

      const supported = new Map();
      for (const slot of windows) {
        if (slot.experimental || slot.blocked) continue;
        const slotEvidence = cachedSeasonSlotEvidence(slot, context);
        const exact = slotEvidence.exactTopicSummaries.get(topicKey) || rowSummary([]);
        if (!exact.rates.length) continue;
        const key = `${slot.weekday}|${slot.label}`;
        const item = { weekday: slot.weekday, label: slot.label, rows: exact.rates.length, medianRate: exact.medianRate };
        const current = supported.get(key);
        if (!current || item.rows > current.rows || (item.rows === current.rows && (item.medianRate || 0) > (current.medianRate || 0))) {
          supported.set(key, item);
        }
      }

      const bestWindows = [...supported.values()]
        .sort((a, b) => b.rows - a.rows || (b.medianRate || 0) - (a.medianRate || 0))
        .slice(0, 3);
      const signal = history.rates.length >= 6 ? 'Established'
        : history.rates.length >= 2 ? 'Some history'
        : history.rates.length === 1 ? 'Very thin'
        : 'No WNMU history';
      return {
        topic: group.topic,
        season: targetSeason,
        signal,
        historyRows: history.rates.length,
        medianRate: history.medianRate,
        bestWindows,
        subtopics: [...group.subtopics].sort(),
        programCount: group.programs.length,
        eligibleProgramCount: group.eligiblePrograms.length
      };
    }).sort((a, b) => b.historyRows - a.historyRows || (b.medianRate || 0) - (a.medianRate || 0) || a.topic.localeCompare(b.topic));
  }

  function experimentalEvidence(slot = {}, evidenceRows = [], baselineRate = null, precomputed = null, allFundraisersValue = null) {
    const directRows = precomputed?.exactRows || comparableRows(evidenceRows, slot, { exactWeekday: true });
    const summary = precomputed?.exactSummary || rowSummary(directRows);
    const fundraiserUses = fundraiserCount(directRows);
    const allFundraisers = Number.isFinite(allFundraisersValue) ? allFundraisersValue : fundraiserCount(evidenceRows);
    const ratio = Number.isFinite(summary.medianRate) && Number.isFinite(baselineRate) && baselineRate > 0
      ? summary.medianRate / baselineRate
      : null;
    let verdict = 'Hypothesis only';
    let rationale = 'WNMU has no direct rate-valid history in this exact weekday/time window.';
    if (summary.rates.length >= 3 && Number.isFinite(ratio) && ratio >= 1.1) {
      const underused = allFundraisers >= 4 && fundraiserUses <= Math.max(2, Math.floor(allFundraisers * 0.35));
      verdict = underused ? 'Productive but underused at WNMU' : 'Historically productive at WNMU';
      rationale = `${summary.rates.length} rate-valid WNMU airings across ${fundraiserUses} fundraiser${fundraiserUses === 1 ? '' : 's'}, median about $${Math.round(summary.medianRate)}/hr (${Math.round((ratio - 1) * 100)}% above the overall pledge baseline).`;
    } else if (summary.rates.length >= 2) {
      verdict = Number.isFinite(ratio) && ratio >= 1 ? 'Some encouraging WNMU evidence' : 'Mixed WNMU evidence';
      rationale = `${summary.rates.length} rate-valid WNMU airings across ${fundraiserUses} fundraiser${fundraiserUses === 1 ? '' : 's'}${Number.isFinite(summary.medianRate) ? `, median about $${Math.round(summary.medianRate)}/hr` : ''}.`;
    } else if (summary.rates.length === 1) {
      verdict = 'Thin WNMU evidence';
      rationale = 'Only one rate-valid WNMU airing exists for this exact weekday/time, so this remains experimental.';
    }
    return {
      verdict,
      rationale,
      rows: summary.rates.length,
      medianRate: summary.medianRate,
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

  function buildStrategy({ schedule = {}, library = [], evidenceRows = [], overrides = [], now = new Date() } = {}) {
    const cutoff = evidenceCutoff(schedule, now);
    const historicalRows = filterEvidenceAirings(evidenceRows, cutoff);
    const overrideByProgramId = overrideIndex(overrides);
    const baselineRate = baseHistoricalRate(historicalRows);
    const viable = (library || []).filter((program) => eligibleSomewhereInFundraiser(program, schedule));
    const context = {
      schedule,
      evidenceRows: historicalRows,
      overrideByProgramId,
      baselineRate,
      programRowIndex: buildProgramRowIndex(historicalRows),
      slotEvidenceIndex: buildSlotEvidenceIndex(historicalRows),
      seasonRows: historicalRows.filter((row) => seasonForDate(airingDate(row)) === seasonForDate(scheduleStart(schedule))),
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
    const windows = planningWindows(schedule).map((slot) => {
      if (slot.blocked) return { ...slot, recommendations: [], strongestTopics: [], alternativeTopics: [], evidenceRows: 0, experimentalEvidence: null };
      const ranked = rankProgramsForSlot(viable, slot, context);
      const topics = topicChoicesForSlot(ranked);
      const slotEvidence = cachedSlotEvidence(slot, context);
      const exactRows = slotEvidence.exactRows;
      return {
        ...slot,
        recommendations: selectRecommendationsForSlot(ranked, 4),
        windowHistory: slotEvidence.exactSummary,
        strongestTopics: topics.slice(0, 3),
        alternativeTopics: topics.slice(3, 6),
        evidenceRows: exactRows.length,
        experimentalEvidence: slot.experimental ? experimentalEvidence(slot, historicalRows, baselineRate, slotEvidence, context.evidenceFundraiserCount) : null
      };
    });
    const rights = rightsConstraints(library, schedule);
    const seasonal = viable.map((program) => {
      const season = cachedProgramEvidence(program, context).season;
      return { program, title: programTitle(program), programId: programId(program), topic: programTopic(program), season };
    }).filter((item) => item.season.adjustment > 0)
      .sort((a, b) => b.season.adjustment - a.season.adjustment || a.title.localeCompare(b.title)).slice(0, 10);
    const local = viable.filter(isLocal).map((program) => windows.filter((slot) => !slot.experimental && !slot.blocked)
      .map((slot) => scoreProgramForSlot(program, slot, context)).filter(Boolean)
      .sort((a, b) => b.score - a.score)[0] || null)
      .filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 10);
    const avoid = viable.map((program) => {
      const cached = cachedProgramEvidence(program, context);
      const rows = cached.titleRows;
      const history = cached.titleHistory;
      const rating = normalizeRating(overrideByProgramId.get(programId(program))?.rating);
      const drama = cached.drama;
      const season = cached.season;
      const rest = history.latest ? daysBetween(history.latest, scheduleStart(schedule)) : null;
      const reasons = [];
      if (rating === 'dont_air') reasons.push("Programmer rating: Don't air");
      if (rating === 'low_confidence') reasons.push('Programmer rating: Low confidence');
      if (history.rows >= 8) reasons.push(`Heavy lifetime exposure (${history.rows} airings)`);
      if (rest != null && rest < 90) reasons.push(`Very quick return (${rest} days)`);
      else if (rest != null && rest < 180) reasons.push(`Short rest (${rest} days)`);
      if (drama.olderCycle) reasons.push('Older Drama Doc cycle');
      if (season.holidayOutOfSeason) reasons.push(`${season.holidayCategory || 'Holiday'} title out of seasonal window`);
      return reasons.length ? { program, title: programTitle(program), programId: programId(program), topic: programTopic(program), reasons, history, rating, drama, season } : null;
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
      mix: mixFromSlots(windows),
      topicComparison: topicComparison(library, windows, context),
      repeats: repeatCandidates(windows),
      seasonal,
      local,
      avoid,
      rights,
      peerEvidence: {
        available: false,
        note: 'Peer-station evidence is not yet structured in the report dataset and is not used in these recommendations.'
      },
      limitations: [
        'For a future fundraiser, evidence is capped at today. For a historical fundraiser, evidence stops the day before that fundraiser began.',
        'Topic performance at the top of the report uses the selected fundraiser season and includes every eligible Library topic.',
        'Exact weekday/time evidence is required before a topic is presented as an established fit.',
        'Programmer ratings are weighted inputs. For new / unaired titles, an explicit Neutral, Viable, Promising, or Must Air rating increases first-test priority; Low confidence and Don\'t air do not.',
        'Drama Doc cycle is inferred from rights-start recency because exact related-series cycle metadata is not stored.',
        'Day-by-day recommendations favor new / unaired titles. Previously aired standbys are limited to one anchor only when at least two credible new titles are available, keeping old titles at about 25–33% of that slot list.',
        'Experimental windows are labeled separately and explain whether WNMU evidence supports the experiment; no peer-station claim is made without structured peer evidence.',
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
    programId,
    programTitle,
    programNola,
    programTopic,
    programSecondary,
    programRuntimeMinutes,
    rightsStart,
    rightsEnd,
    premiumSummary,
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
    planningWindows,
    rowsForProgram,
    rowSummary,
    comparableRows,
    seasonEvidence,
    programmerEvidence,
    scoreProgramForSlot,
    rankProgramsForSlot,
    selectRecommendationsForSlot,
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
