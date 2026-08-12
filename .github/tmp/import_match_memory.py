from pathlib import Path
import json
from datetime import date


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


data_path = Path('assets/js/data.js')
data = data_path.read_text(encoding='utf-8')
data = replace_once(
    data,
    """  async function fetchImportedAirings() {
    return fetchAllRows(constants.AIRINGS_TABLE);
  }

  async function fetchUnlinkedImportedAirings() {
""",
    """  async function fetchImportedAirings() {
    return fetchAllRows(constants.AIRINGS_TABLE);
  }

  async function fetchImportedMatchMemoryRows() {
    const pageSize = 1000;
    let from = 0;
    const rows = [];
    try {
      while (true) {
        const { data, error } = await state.client
          .from(constants.AIRINGS_TABLE)
          .select('*')
          .in('match_method', ['manual_library', 'saved_title_rule'])
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const chunk = data || [];
        rows.push(...chunk);
        if (chunk.length < pageSize) break;
        from += pageSize;
      }
      return rows;
    } catch (error) {
      console.warn('Filtered import match-memory query failed; falling back to the imported airing history.', error);
      const allRows = await fetchAllRows(constants.AIRINGS_TABLE);
      return (allRows || []).filter((row) => ['manual_library', 'saved_title_rule'].includes(String(row?.match_method || '').trim().toLowerCase()));
    }
  }

  async function fetchUnlinkedImportedAirings() {
""",
    'insert shared import match-memory reader'
)
data = replace_once(
    data,
    """    fetchPerformanceInputs,
    fetchImportedAirings,
    fetchUnlinkedImportedAirings,
""",
    """    fetchPerformanceInputs,
    fetchImportedAirings,
    fetchImportedMatchMemoryRows,
    fetchUnlinkedImportedAirings,
""",
    'export shared import match-memory reader'
)
data_path.write_text(data, encoding='utf-8')

ui_path = Path('assets/js/ui-imports.js')
ui = ui_path.read_text(encoding='utf-8')

ui = replace_once(
    ui,
    """  function saveStoredAliasRules(rules = []) {
    imp().aliasRules = Array.isArray(rules) ? rules : [];
    utils.storageSet(IMPORT_MATCH_RULES_STORAGE_KEY, imp().aliasRules);
  }

""",
    """  function saveStoredAliasRules(rules = []) {
    imp().aliasRules = Array.isArray(rules) ? rules : [];
    utils.storageSet(IMPORT_MATCH_RULES_STORAGE_KEY, imp().aliasRules);
  }

  function aliasRuleTimestamp(rule = {}) {
    const stamp = Date.parse(rule.updatedAt || rule.updated_at || rule.createdAt || rule.created_at || '');
    return Number.isFinite(stamp) ? stamp : 0;
  }

  function mergeAliasRuleSets(...ruleSets) {
    const merged = new Map();
    ruleSets.flat().forEach((rule) => {
      if (!rule || rule.active === false) return;
      const importedTitle = utils.normalizeText(rule.importedTitle || '');
      const targetProgramId = String(rule.targetProgramId || '').trim();
      if (!importedTitle || !targetProgramId) return;
      const key = aliasRuleKey(rule.station || '', importedTitle, rule.importedNola || rule.nola_code || '');
      const current = merged.get(key);
      if (!current || aliasRuleTimestamp(rule) >= aliasRuleTimestamp(current)) merged.set(key, rule);
    });
    return [...merged.values()];
  }

  function historicalImportedNola(row = {}) {
    const raw = row?.raw_payload && typeof row.raw_payload === 'object' ? row.raw_payload : {};
    return utils.normalizeText(utils.firstNonEmpty(
      row?.source_report_code,
      row?.imported_report_code,
      row?.imported_nola_code,
      raw?.nola_code,
      raw?.nola,
      raw?.program_nola,
      raw?.program_code,
      raw?.episode_code,
      ''
    ) || '');
  }

  function historicalAliasRulesFromAirings(rows = []) {
    const latestByRule = new Map();
    const addRule = ({ station = '', importedTitle = '', importedNola = '', targetProgramId = '', matchScope = 'title', updatedAt = '', stamp = 0 } = {}) => {
      const title = utils.normalizeText(importedTitle || '');
      const targetId = String(targetProgramId || '').trim();
      if (!title || !targetId) return;
      const targetProgram = (state.rawRows || []).find((candidate) => String(derive.programId(candidate) || '').trim() === targetId) || null;
      if (!targetProgram) return;
      const nola = matchScope === 'title_nola' ? utils.normalizeText(importedNola || '') : '';
      const rule = {
        id: `history:${importStationKey(station)}:${importTitleKey(title)}:${importNolaCodeKey(nola)}:${targetId}`,
        station: utils.normalizeText(station || ''),
        importedTitle: title,
        importedTitleKey: importTitleKey(title),
        importedCompactTitleKey: compactImportTitleKey(title, nola),
        importedNola: nola,
        importedNolaKey: importNolaCodeKey(nola),
        targetProgramId: targetId,
        targetProgramTitle: derive.title(targetProgram) || title,
        targetProgramNola: derive.nola(targetProgram) || '',
        matchScope,
        active: true,
        updatedAt: updatedAt || ''
      };
      const key = aliasRuleKey(rule.station, rule.importedTitle, rule.importedNola);
      const current = latestByRule.get(key);
      if (!current || stamp >= current.stamp) latestByRule.set(key, { stamp, rule });
    };

    (Array.isArray(rows) ? rows : []).forEach((row, index) => {
      const method = String(row?.match_method || '').trim().toLowerCase();
      if (!['manual_library', 'saved_title_rule'].includes(method)) return;
      const importedTitle = utils.normalizeText(row?.imported_program_title || '');
      const targetProgramId = String(utils.firstNonEmpty(row?.program_id, row?.pledge_program_id, '') || '').trim();
      if (!importedTitle || !targetProgramId) return;
      const station = utils.normalizeText(row?.station || '');
      const importedNola = historicalImportedNola(row);
      const updatedAt = utils.normalizeText(utils.firstNonEmpty(row?.updated_at, row?.created_at, row?.imported_at, row?.aired_at, '') || '');
      const parsedStamp = Date.parse(updatedAt);
      const stamp = Number.isFinite(parsedStamp) ? parsedStamp : index + 1;
      if (importedNola) addRule({ station, importedTitle, importedNola, targetProgramId, matchScope: 'title_nola', updatedAt, stamp });
      addRule({ station, importedTitle, targetProgramId, matchScope: 'title', updatedAt, stamp });
    });

    return [...latestByRule.values()].map((entry) => entry.rule);
  }

  async function loadRememberedAliasRules() {
    const localRules = utils.storageGet(IMPORT_MATCH_RULES_STORAGE_KEY, []);
    let historicalRules = [];
    try {
      const historicalRows = App.data.fetchImportedMatchMemoryRows
        ? await App.data.fetchImportedMatchMemoryRows()
        : await App.data.fetchImportedAirings();
      historicalRules = historicalAliasRulesFromAirings(historicalRows);
    } catch (error) {
      console.warn('Could not refresh remembered import matches from Supabase. Browser memory remains available.', error);
    }
    const merged = mergeAliasRuleSets(historicalRules, localRules);
    saveStoredAliasRules(merged);
    return merged;
  }

""",
    'insert shared remembered-match loader'
)

ui = replace_once(
    ui,
    """  function syncVisiblePersistMatchControls(rowHash, shouldPersist = false) {
    const bodyEl = els.importUnmatchedBody;
    if (!bodyEl) return;
    rowsForUnmatchedTitleGroup(rowHash).forEach((row) => {
      const checkbox = bodyEl.querySelector(`.import-persist-match-check[data-row-hash=\"${cssEscape(row.row_hash || '')}\"]`);
      if (checkbox) checkbox.checked = Boolean(shouldPersist);
    });
  }

""",
    """""",
    'remove obsolete remember-checkbox UI sync'
)

ui = replace_once(
    ui,
    """  function syncPersistMatchRule(rowHash, shouldPersist = false) {
    const rows = rowsForUnmatchedTitleGroup(rowHash);
    rows.forEach((row) => {
      row.pending_persist_match_rule = Boolean(shouldPersist);
    });
  }

""",
    """""",
    'remove obsolete remember-checkbox state sync'
)

ui = replace_once(
    ui,
    """    const shouldPersist = options.persistRule ?? safeRows.some((row) => row.pending_persist_match_rule === true);
    const firstAliasNola = importedSourceCodeForRow(safeRows[0] || {});
""",
    """    const shouldPersist = options.persistRule !== false;
""",
    'make confirmed manual matches remembered by default'
)

ui = replace_once(
    ui,
    """    if (shouldPersist) storeAliasRule({ station: safeRows[0]?.station || '', importedTitle: safeRows[0]?.imported_program_title || safeRows[0]?.title || '', importedNola: firstAliasNola || '', targetProgram: targetRow });
""",
    """    if (shouldPersist) {
      const rememberedKeys = new Set();
      safeRows.forEach((airing) => {
        const importedTitle = airing?.imported_program_title || airing?.title || '';
        const importedNola = importedSourceCodeForRow(airing);
        const station = airing?.station || '';
        const key = aliasRuleKey(station, importedTitle, importedNola);
        if (!importedTitle || rememberedKeys.has(key)) return;
        rememberedKeys.add(key);
        storeAliasRule({ station, importedTitle, importedNola, targetProgram: targetRow });
      });
    }
""",
    'remember every distinct report identity in a confirmed title group'
)

ui = replace_once(
    ui,
    """        groups.set(key, { programId, persistRule: false, rows: [] });
""",
    """        groups.set(key, { programId, persistRule: true, rows: [] });
""",
    'make Apply All remember matches by default'
)

ui = replace_once(
    ui,
    """              <label class=\"import-rule-check\">
                <input type=\"checkbox\" class=\"import-persist-match-check\" data-row-hash=\"${escape(row.row_hash)}\" ${row.pending_persist_match_rule === true ? 'checked' : ''}>
                <span>Remember this match</span>
              </label>
""",
    """              <div class=\"muted import-rule-auto-note\">Confirmed matches are remembered automatically for future reports.</div>
""",
    'replace remember checkbox with automatic-memory note'
)

ui = replace_once(
    ui,
    """      const ruleToggle = event.target.closest('.import-persist-match-check');
      if (ruleToggle) {
        const rowHash = ruleToggle.getAttribute('data-row-hash') || '';
        const shouldPersist = Boolean(ruleToggle.checked);
        syncPersistMatchRule(rowHash, shouldPersist);
        syncVisiblePersistMatchControls(rowHash, shouldPersist);
        renderActions();
        return;
      }
""",
    """""",
    'remove remember-checkbox event handler'
)

ui = replace_once(
    ui,
    """    if (!imp().ready) {
      imp().aliasRules = utils.storageGet(IMPORT_MATCH_RULES_STORAGE_KEY, []);
      imp().reportTotalsByFile = utils.storageGet(IMPORT_REPORT_TOTALS_STORAGE_KEY, {});
""",
    """    if (!imp().ready) {
      await loadRememberedAliasRules();
      imp().reportTotalsByFile = utils.storageGet(IMPORT_REPORT_TOTALS_STORAGE_KEY, {});
""",
    'load shared remembered matches before report analysis'
)

ui = replace_once(
    ui,
    """  async function linkExistingUnlinkedRow(rowHash, programId) {
    const targetRow = selectedProgramRow(programId);
""",
    """  async function linkExistingUnlinkedRow(rowHash, programId) {
    const targetRow = selectedProgramRow(programId);
    const sourceRow = (imp().existingUnlinkedRows || []).find((row) => row.row_hash === rowHash) || null;
""",
    'capture quarantined row identity before linking'
)

ui = replace_once(
    ui,
    """    const response = await App.data.updateImportedAiringByHash(rowHash, payload);
    if (response.error) throw response.error;
    await refreshExistingUnlinkedRows({ silent: true });
""",
    """    const response = await App.data.updateImportedAiringByHash(rowHash, payload);
    if (response.error) throw response.error;
    if (sourceRow?.imported_program_title) {
      storeAliasRule({
        station: sourceRow?.raw?.station || '',
        importedTitle: sourceRow.imported_program_title,
        importedNola: historicalImportedNola(sourceRow.raw || sourceRow),
        targetProgram: targetRow
      });
    }
    await refreshExistingUnlinkedRows({ silent: true });
""",
    'remember quarantined manual links immediately'
)

ui = replace_once(
    ui,
    """    await updateImportedRowsByHashes(suspect.row_hashes, payload);
    if (imp().suspectLinkSelections) delete imp().suspectLinkSelections[suspectId];
""",
    """    await updateImportedRowsByHashes(suspect.row_hashes, payload);
    if (suspect.imported_program_title) {
      storeAliasRule({
        station: suspect?.raw?.station || '',
        importedTitle: suspect.imported_program_title,
        importedNola: historicalImportedNola(suspect.raw || suspect),
        targetProgram: targetRow
      });
    }
    if (imp().suspectLinkSelections) delete imp().suspectLinkSelections[suspectId];
""",
    'remember suspect-row manual links immediately'
)

ui = replace_once(
    ui,
    """      const linkedCount = applyManualMatchToGroup(rowHash, createdId, { persistRule: rowsForUnmatchedTitleGroup(rowHash).some((row) => row.pending_persist_match_rule === true) });
""",
    """      const linkedCount = applyManualMatchToGroup(rowHash, createdId);
""",
    'make Create + link remember automatically'
)

ui_path.write_text(ui, encoding='utf-8')

version_path = Path('version.json')
payload = json.loads(version_path.read_text(encoding='utf-8'))
parts = [int(part) for part in str(payload['appVersion']).split('.')]
if len(parts) != 3:
    raise SystemExit('version.json appVersion is not a three-part semantic version')
parts[2] += 1
payload['appVersion'] = '.'.join(map(str, parts))
payload['releasedAt'] = date.today().isoformat()
version_path.write_text(json.dumps(payload, separators=(',', ':')) + '\n', encoding='utf-8')
