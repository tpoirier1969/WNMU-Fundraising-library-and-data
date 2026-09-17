from pathlib import Path

ROOT = Path('.')

def read(path):
    return (ROOT / path).read_text()

def write(path, text):
    (ROOT / path).write_text(text)

def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)

# Analysis module
path = 'assets/js/programming-strategy-analysis.js'
s = read(path)
s = replace_once(s,
"  const HOLIDAY_PATTERN = /\\b(?:christmas|holiday|holidays|noel|yuletide|nativity)\\b/i;\n",
"""  const HOLIDAY_PATTERN = /\\b(?:christmas|holiday|holidays|noel|yuletide|nativity|hanukkah|chanukah|ramadan|eid|new year|new year's|new years|kwanzaa)\\b/i;
  const CHRISTMAS_PATTERN = /\\b(?:christmas|xmas|noel|yuletide|nativity)\\b/i;
  const JEWISH_HOLIDAY_PATTERN = /\\b(?:hanukkah|chanukah)\\b/i;
  const MUSLIM_HOLIDAY_PATTERN = /\\b(?:ramadan|eid(?:\\s+al[- ](?:fitr|adha))?)\\b/i;
  const NEW_YEAR_PATTERN = /\\bnew year(?:'s|s)?\\b/i;
""", 'holiday constants')

needle = """  function programTitle(program = {}) {
    return text(first(program.title, program.program_title, program.name, program.matched_library_title, 'Untitled program'));
  }

"""
s = replace_once(s, needle, needle + """  function programNola(program = {}) {
    return text(first(program.nola_code, program.nola, program.program_nola, ''));
  }

""", 'program NOLA helper')

old = """  function isHoliday(program = {}) {
    return HOLIDAY_PATTERN.test(programText(program));
  }

"""
new = """  function holidayCategory(program = {}) {
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
      const wantsRamadan = /\\bramadan\\b/i.test(textValue);
      const wantsEid = /\\beid\\b/i.test(textValue);
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

"""
s = replace_once(s, old, new, 'holiday functions')

needle = """  function rowProgramId(row = {}) {
    return text(first(row.programId, row.program_id, row.pledge_program_id, row.manual_match_program_id, ''));
  }

"""
s = replace_once(s, needle, needle + """  function rowNola(row = {}) {
    return text(first(row.nola_code, row.nola, row.program_nola, row.matched_nola_code, ''));
  }

""", 'row NOLA helper')

s = replace_once(s, """  function programMatchesRow(program = {}, row = {}) {
    const id = programId(program);
    const rowId = rowProgramId(row);
    if (id && rowId && id === rowId) return true;
    const title = lookupKey(programTitle(program));
    return Boolean(title && title === lookupKey(rowTitle(row)));
  }
""", """  function programMatchesRow(program = {}, row = {}) {
    const id = programId(program);
    const rowId = rowProgramId(row);
    if (id && rowId) return id === rowId;
    const nola = lookupKey(programNola(program));
    const rowCode = lookupKey(rowNola(row));
    if (nola && rowCode) return nola === rowCode;
    const title = lookupKey(programTitle(program));
    return Boolean(title && title === lookupKey(rowTitle(row)));
  }
""", 'program row matching')

s = replace_once(s, """    const holiday = isHoliday(program);
    if (holiday) {
      const explicit = targetSeason === 'December' ? 14 : -18;
      adjustment += explicit;
      notes.push(targetSeason === 'December' ? 'Christmas / holiday fit for December.' : `Christmas / holiday title is out of season for ${targetSeason}.`);
    }
    return { targetSeason, holiday, same: sameSummary, other: otherSummary, adjustment, notes };
""", """    const holidayInfo = holidaySeasonAdjustment(program, schedule);
    const holiday = Boolean(holidayInfo.category);
    if (holiday) {
      adjustment += holidayInfo.adjustment;
      if (holidayInfo.note) notes.push(holidayInfo.note);
    }
    return { targetSeason, holiday, holidayCategory: holidayInfo.category, holidayInWindow: holidayInfo.inWindow, holidayOutOfSeason: holidayInfo.outOfSeason, same: sameSummary, other: otherSummary, adjustment, notes };
""", 'seasonal holiday logic')

s = replace_once(s,
"    if (season.holiday && season.targetSeason !== 'December' && programmer.rating !== 'must_air') fit = 'Save for December';\n",
"""    if (season.holidayOutOfSeason && programmer.rating !== 'must_air') {
      fit = season.holidayCategory === 'Holiday - Christmas' ? 'Save for Christmas season' : 'Out of seasonal window';
    }
""", 'holiday fit label')

s = replace_once(s, """    const list = [...points.values()].map((item) => ({ ...item, averageScore: mean(item.scores) || 0 }));
    const total = list.reduce((sum, item) => sum + item.points, 0);
    return list.sort((a, b) => b.points - a.points || b.averageScore - a.averageScore || a.topic.localeCompare(b.topic)).map((item, index) => {
      let strength = 'Situational';
      if (index <= 1 || item.averageScore >= 72) strength = 'Stronger';
      else if (item.averageScore >= 60 || item.appearances >= 3) strength = 'Moderate';
      const share = total > 0 && slots.filter((slot) => !slot.experimental && !slot.blocked).length >= 6 ? Math.round((item.points / total) * 20) * 5 : null;
      return { ...item, strength, approximateShare: share };
    });
""", """    const list = [...points.values()].map((item) => ({ ...item, averageScore: mean(item.scores) || 0 }));
    return list.sort((a, b) => b.points - a.points || b.averageScore - a.averageScore || a.topic.localeCompare(b.topic)).map((item, index) => {
      let strength = 'Situational';
      if (index <= 1 || item.averageScore >= 72) strength = 'Stronger';
      else if (item.averageScore >= 60 || item.appearances >= 3) strength = 'Moderate';
      return { ...item, strength, approximateShare: null };
    });
""", 'qualitative mix')

s = replace_once(s,
"      if (season.holiday && season.targetSeason !== 'December') reasons.push('Holiday title out of season');\n",
"      if (season.holidayOutOfSeason) reasons.push(`${season.holidayCategory || 'Holiday'} title out of seasonal window`);\n",
'avoid holiday reason')

s = replace_once(s,
"        'Experimental windows are labeled separately from established planning windows.',\n",
"""        'Holiday scoring is category-aware: Christmas is seasonal, New Year is narrow, and Jewish/Muslim holidays use movable-calendar windows when a specific holiday is identifiable.',
        'Islamic-calendar holiday windows are planning approximations and may differ by local moon sighting.',
        'Experimental windows are labeled separately from established planning windows.',
""", 'holiday limitations')

s = replace_once(s, "    programTitle,\n    programTopic,\n", "    programTitle,\n    programNola,\n    programTopic,\n", 'program NOLA export')
s = replace_once(s, "    isLocal,\n    isHoliday,\n", "    isLocal,\n    holidayCategory,\n    holidaySeasonAdjustment,\n    isHoliday,\n", 'holiday exports')
write(path, s)

# Report renderer
path = 'assets/js/programming-strategy-report.js'
s = read(path)
s = replace_once(s, """    if (allowed) {
      const role = $('#strategy-role');
      if (role) role.textContent = email ? `Admin · ${email}` : 'Admin';
      return true;
    }
""", """    if (allowed) {
      $('#strategy-app')?.classList.remove('hidden');
      const role = $('#strategy-role');
      if (role) role.textContent = email ? `Admin · ${email}` : 'Admin';
      return true;
    }
""", 'admin unhide')
s = replace_once(s,
"    if (item.season?.holiday && item.season.targetSeason === 'December') flags.push('Seasonal fit');\n",
"    if (item.season?.holidayInWindow) flags.push(item.season.holidayCategory || 'Seasonal fit');\n",
'seasonal flag')
s = replace_once(s,
"""    return `<section class="sheet-section"><h2>Overall recommended mix</h2><p>Planning signal from the strongest eligible titles across normal pledge windows. Shares are approximate signals, not quotas.</p><div class="strategy-mix-grid">${strategy.mix.slice(0, 10).map((item) => `<div class="strategy-mix-card"><strong>${escapeHtml(item.topic)}</strong><span class="strategy-strength strength-${escapeHtml(item.strength.toLowerCase())}">${escapeHtml(item.strength)}</span><small>${item.appearances} strong-slot appearance${item.appearances === 1 ? '' : 's'} · avg score ${Math.round(item.averageScore)}${item.approximateShare != null ? ` · ~${item.approximateShare}% mix signal` : ''}</small></div>`).join('')}</div></section>`;
""",
"""    return `<section class="sheet-section"><h2>Overall recommended mix</h2><p>Qualitative planning signal from the strongest eligible titles across normal pledge windows. No percentage quotas are implied.</p><div class="strategy-mix-grid">${strategy.mix.slice(0, 10).map((item) => `<div class="strategy-mix-card"><strong>${escapeHtml(item.topic)}</strong><span class="strategy-strength strength-${escapeHtml(item.strength.toLowerCase())}">${escapeHtml(item.strength)}</span><small>${item.appearances} strong-slot appearance${item.appearances === 1 ? '' : 's'} · avg score ${Math.round(item.averageScore)}</small></div>`).join('')}</div></section>`;
""", 'mix copy')
write(path, s)

# Standalone page
path = 'programming-strategy.html'
s = read(path)
s = s.replace('v=0.22.167', 'v=0.22.172')
s = replace_once(s, '<div id="strategy-app" class="report-shell">', '<div id="strategy-app" class="report-shell hidden">', 'strategy app hidden gate')
write(path, s)

# Hub script cache buster
path = 'reports.html'
s = read(path)
s = replace_once(s, 'report-hub-programming-strategy.js?v=0.22.166', 'report-hub-programming-strategy.js?v=0.22.172', 'hub script version')
write(path, s)

# Version
write('version.json', '{"appVersion":"0.22.172","releasedAt":"2026-09-17"}')

# Tests
path = 'tests/programming-strategy-report.test.mjs'
s = read(path)
s = replace_once(s,
"""const row = (overrides = {}) => ({
  programId: overrides.programId || '1',
  title: overrides.title || 'Test Program',
""",
"""const row = (overrides = {}) => ({
  programId: overrides.programId === undefined ? '1' : overrides.programId,
  title: overrides.title || 'Test Program',
""", 'test row program id')
s = replace_once(s,
"""  fundraiserId: overrides.fundraiserId || 'aug26',
  ...overrides
});
""",
"""  fundraiserId: overrides.fundraiserId || 'aug26',
  nola_code: overrides.nola_code ?? '',
  ...overrides
});
""", 'test row NOLA')
s += r'''

test('holiday taxonomy distinguishes Christmas, Jewish, Muslim, and New Year programming', () => {
  assert.equal(S.holidayCategory(baseProgram({ title: 'A Classic Christmas', topic_primary: 'Holiday - Christmas' })), 'Holiday - Christmas');
  assert.equal(S.holidayCategory(baseProgram({ title: 'Hanukkah: A Festival of Delights', topic_primary: 'Holiday - Jewish' })), 'Holiday - Jewish');
  assert.equal(S.holidayCategory(baseProgram({ title: 'Ramadan Reflections', topic_primary: 'Holiday - Muslim' })), 'Holiday - Muslim');
  assert.equal(S.holidayCategory(baseProgram({ title: "New Year's Eve Celebration", topic_primary: 'Holiday - New Year' })), 'Holiday - New Year');
});

test('Jewish and Muslim holiday categories use movable holiday windows rather than a blanket December boost', () => {
  const hanukkah = baseProgram({ id: 'j', title: 'Hanukkah: A Festival of Delights', topic_primary: 'Holiday - Jewish' });
  const ramadan = baseProgram({ id: 'm', title: 'Ramadan Reflections', topic_primary: 'Holiday - Muslim' });
  const hanukkahFit = S.holidaySeasonAdjustment(hanukkah, schedule);
  const ramadanDecember = S.holidaySeasonAdjustment(ramadan, schedule);
  const ramadanFit = S.holidaySeasonAdjustment(ramadan, { startDate: '2026-02-18', endDate: '2026-02-25' });
  assert.equal(hanukkahFit.inWindow, true);
  assert.ok(hanukkahFit.adjustment > 0);
  assert.equal(ramadanDecember.inWindow, false);
  assert.ok(ramadanDecember.adjustment < 0);
  assert.equal(ramadanFit.inWindow, true);
  assert.ok(ramadanFit.adjustment > 0);
});

test('New Year programming gets a narrow late-December / early-January window', () => {
  const newYear = baseProgram({ id: 'ny', title: "New Year's Eve Celebration", topic_primary: 'Holiday - New Year' });
  const earlyDecember = S.holidaySeasonAdjustment(newYear, schedule);
  const newYearDrive = S.holidaySeasonAdjustment(newYear, { startDate: '2026-12-29', endDate: '2027-01-02' });
  assert.ok(earlyDecember.adjustment < 0);
  assert.equal(newYearDrive.inWindow, true);
  assert.ok(newYearDrive.adjustment > 0);
});

test('historical matching does not fall back to title when both program IDs disagree', () => {
  const program = baseProgram({ id: 'A', title: 'Shared Title', nola_code: 'AAAA' });
  const wrongId = row({ programId: 'B', title: 'Shared Title', nola_code: 'AAAA' });
  assert.equal(S.rowsForProgram(program, [wrongId]).length, 0);
  const nolaOnly = row({ programId: '', title: 'Different Imported Title', nola_code: 'AAAA' });
  assert.equal(S.rowsForProgram(program, [nolaOnly]).length, 1);
});

test('overall mix remains qualitative rather than inventing percentage quotas', () => {
  const strategy = S.buildStrategy({
    schedule,
    library: [
      baseProgram({ id: 'm1', title: 'Music One', topic_primary: 'Music' }),
      baseProgram({ id: 'h1', title: 'History One', topic_primary: 'History' })
    ],
    evidenceRows: []
  });
  assert.ok(strategy.mix.length > 0);
  assert.ok(strategy.mix.every((item) => item.approximateShare === null));
});
'''
write(path, s)
print('strategy source update applied')
