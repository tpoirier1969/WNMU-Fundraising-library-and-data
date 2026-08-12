from pathlib import Path
import json

path = Path('assets/js/ui-scheduling.js')
text = path.read_text(encoding='utf-8')
old = """  function ensureCurrentScheduleApplied() {
    const ordered = sortSchedulesNewestFirst(state.schedules || []);
    if (!ordered.length) {
      state.activeScheduleId = '';
      return null;
    }
    let activeSchedule = getActiveSchedule();
    const activeInfo = activeSchedule ? getScheduleDateSpanInfo(activeSchedule) : null;
    if (!state.activeScheduleId || !activeSchedule || !activeInfo?.ok) {
      activeSchedule = ordered.find((item) => getScheduleDateSpanInfo(item).ok) || ordered[0] || null;
      state.activeScheduleId = activeSchedule?.id || '';
    }
    if (activeSchedule && getScheduleDateSpanInfo(activeSchedule).ok) applyScheduleToView(activeSchedule);
    return activeSchedule;
  }
"""
new = """  function scheduleDistanceFromToday(schedule = {}, todayKey = utils.dateKeyFromDate(new Date())) {
    const info = getScheduleDateSpanInfo(schedule);
    if (!info.ok) return Number.POSITIVE_INFINITY;
    const start = utils.normalizeText(schedule.startDate);
    const end = utils.normalizeText(schedule.endDate || start);
    if (!todayKey || !start || !end) return Number.POSITIVE_INFINITY;
    if (todayKey >= start && todayKey <= end) return 0;
    if (todayKey < start) {
      const distance = daysBetweenDateKeys(todayKey, start);
      return Number.isFinite(distance) ? Math.abs(distance) : Number.POSITIVE_INFINITY;
    }
    const distance = daysBetweenDateKeys(end, todayKey);
    return Number.isFinite(distance) ? Math.abs(distance) : Number.POSITIVE_INFINITY;
  }

  function closestScheduleToToday(items = [], todayKey = utils.dateKeyFromDate(new Date())) {
    return [...(Array.isArray(items) ? items : [])]
      .filter((item) => getScheduleDateSpanInfo(item).ok)
      .sort((a, b) => {
        const aDistance = scheduleDistanceFromToday(a, todayKey);
        const bDistance = scheduleDistanceFromToday(b, todayKey);
        if (aDistance !== bDistance) return aDistance - bDistance;
        const aUpcoming = utils.normalizeText(a.startDate) > todayKey;
        const bUpcoming = utils.normalizeText(b.startDate) > todayKey;
        if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1;
        if (aUpcoming && bUpcoming) return utils.normalizeText(a.startDate).localeCompare(utils.normalizeText(b.startDate));
        return utils.normalizeText(b.endDate).localeCompare(utils.normalizeText(a.endDate));
      })[0] || null;
  }

  function ensureCurrentScheduleApplied() {
    const ordered = sortSchedulesNewestFirst(state.schedules || []);
    if (!ordered.length) {
      state.activeScheduleId = '';
      return null;
    }
    let activeSchedule = getActiveSchedule();
    const activeInfo = activeSchedule ? getScheduleDateSpanInfo(activeSchedule) : null;
    if (!state.activeScheduleId || !activeSchedule || !activeInfo?.ok) {
      activeSchedule = closestScheduleToToday(ordered) || ordered.find((item) => getScheduleDateSpanInfo(item).ok) || ordered[0] || null;
      state.activeScheduleId = activeSchedule?.id || '';
    }
    if (activeSchedule && getScheduleDateSpanInfo(activeSchedule).ok) applyScheduleToView(activeSchedule);
    return activeSchedule;
  }
"""
if text.count(old) != 1:
    raise SystemExit(f'ensureCurrentScheduleApplied block expected once, found {text.count(old)}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')

version_path = Path('version.json')
version = json.loads(version_path.read_text(encoding='utf-8'))
if version.get('appVersion') != '0.22.61':
    raise SystemExit(f"Expected 0.22.61, found {version.get('appVersion')!r}")
version['appVersion'] = '0.22.62'
version['releasedAt'] = '2026-08-12'
version_path.write_text(json.dumps(version, separators=(',', ':')) + '\n', encoding='utf-8')
