from pathlib import Path
import json
import re

ROOT = Path('.')
LAB = ROOT / 'pledge-performance-lab-shell.html'
APP_SHELL = ROOT / 'app-shell.html'
CORE = ROOT / 'assets/js/core.js'
WORKSPACE = ROOT / 'assets/js/ui-workspace.js'
LIST_UI = ROOT / 'assets/js/ui-list.js'
AUTH = ROOT / 'assets/js/auth.js'
APP_INIT = ROOT / 'assets/js/app-init.js'
VERSION = ROOT / 'version.json'
ANALYTICS_FRAGMENT = ROOT / 'assets/analytics-workspace.html'
ANALYTICS_JS = ROOT / 'assets/js/ui-analytics.js'
LEGACY_LAB = ROOT / 'pledge-performance-lab.html'


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


def regex_once(text, pattern, replacement, label, flags=0):
    out, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one regex match, found {count}')
    return out


def balanced_section(text, start_marker):
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit(f'Could not find section marker: {start_marker}')
    depth = 0
    end = None
    for match in re.finditer(r'<section\b|</section\s*>', text[start:], flags=re.I):
        token = match.group(0).lower()
        if token.startswith('<section'):
            depth += 1
        else:
            depth -= 1
            if depth == 0:
                end = start + match.end()
                break
    if end is None:
        raise SystemExit(f'Could not balance section: {start_marker}')
    return start, end, text[start:end]


version_payload = json.loads(VERSION.read_text(encoding='utf-8'))
if version_payload.get('appVersion') != '0.22.74':
    raise SystemExit(f"Expected v0.22.74 before integration, found {version_payload.get('appVersion')}")

lab = LAB.read_text(encoding='utf-8')
style_match = re.search(r'<style>(.*?)</style>', lab, flags=re.S)
if not style_match:
    raise SystemExit('Could not extract Analytics styles.')
styles = style_match.group(1).strip()
styles = styles.replace(':root {', ':host {', 1)
styles = styles.replace(
    'body { margin: 0; background: var(--bg); color: var(--ink); }',
    ':host { display: block; background: var(--bg); color: var(--ink); }',
    1
)
styles += '''\n    .analytics-root { display: block; padding: 4px 0 30px; }\n    .analytics-workspace-intro { margin: 0 0 14px; padding: 14px 16px; border: 1px solid var(--line); border-radius: 18px; background: var(--card); }\n    .analytics-workspace-intro h2 { margin: 2px 0 4px; }\n    .analytics-workspace-intro p { margin: 0; }\n'''

lab_start, lab_end, lab_section = balanced_section(lab, '<section id="lab" class="hidden">')
lab_inner = re.sub(r'^<section id="lab" class="hidden">\s*', '', lab_section, count=1)
lab_inner = re.sub(r'\s*</section>$', '', lab_inner, count=1)
modal_start = lab.find('<div id="trend-modal"', lab_end)
script_start = lab.rfind('<script>')
if modal_start < 0 or script_start < 0 or script_start <= modal_start:
    raise SystemExit('Could not extract Analytics modal markup.')
modals = lab[modal_start:script_start].strip()

fragment = f'''<style>\n{styles}\n</style>\n<div class="analytics-root">\n  <div class="analytics-workspace-intro">\n    <div class="eyebrow">Pledge Program Library</div>\n    <h2>Performance Analytics</h2>\n    <p>Explore pledge performance without leaving the main Pledge Program Library workspace.</p>\n  </div>\n  <div id="notice" class="notice">Performance Analytics loads when this workspace opens.</div>\n  <section id="lab">\n{lab_inner}\n  </section>\n{modals}\n</div>\n'''
ANALYTICS_FRAGMENT.write_text(fragment, encoding='utf-8')

scripts = re.findall(r'<script>(.*?)</script>', lab, flags=re.S)
if not scripts:
    raise SystemExit('Could not extract Analytics JavaScript.')
body = scripts[-1].strip()
if not body.startswith('(() => {') or not body.endswith('})();'):
    raise SystemExit('Unexpected Analytics script wrapper.')
body = body[len('(() => {'): -len('})();')].strip('\n')

body = replace_once(
    body,
    "  const ANALYTICS_COHORT_STORAGE_KEY = 'wnmuPledgeAnalyticsCohortV1';",
    "  const ANALYTICS_COHORT_STORAGE_KEY = App.constants.ANALYTICS_COHORT_STORAGE_KEY || 'wnmuPledgeAnalyticsCohortV1';",
    'shared cohort storage key'
)
body = replace_once(
    body,
    "  const el = (id) => document.getElementById(id);",
    "  const el = (id) => root?.getElementById(id) || null;",
    'shadow-root element lookup'
)

dom_match = re.search(r"  const dom = \{\n(.*?)\n  \};", body, flags=re.S)
if not dom_match:
    raise SystemExit('Could not isolate Analytics DOM map.')
dom_content = dom_match.group(1)
dom_content = dom_content.replace(
    "    notice: el('notice'), lab: el('lab'), signIn: el('sign-in'), signOut: el('sign-out'),",
    "    notice: el('notice'), lab: el('lab'),"
)
dom_content = dom_content.replace("detail: document.querySelector('.detail')", "detail: root?.querySelector('.detail')")
dom_replacement = "  let dom = {};\n  function bindDom() {\n    dom = {\n" + dom_content + "\n    };\n  }"
body = body[:dom_match.start()] + dom_replacement + body[dom_match.end():]

body = body.replace('document.querySelectorAll(', 'root.querySelectorAll(')
body = body.replace('document.querySelector(', 'root.querySelector(')

body = regex_once(
    body,
    r"\n  async function waitForConfig\(\) \{.*?\n  async function fetchAll",
    "\n  async function fetchAll",
    'remove standalone config/auth bootstrap',
    flags=re.S
)

integrated_init = '''  async function init() {
    if (!initialized) {
      state.cohort = readAnalyticsCohort();
      if (state.cohort?.keySet) {
        state.question = 'programs';
        state.metric = 'avg';
      }
      initialized = true;
    }
    state.client = App.state.client || App.data?.createClient?.() || null;
    if (!state.client) {
      note('Performance Analytics could not access the Pledge Program Library data connection.', 'bad');
      return false;
    }
    note('Loading live pledge performance records…');
    return true;
  }


  async function fetchAiringsForAnalytics'''
body = regex_once(
    body,
    r"  async function init\(\) \{.*?\n  async function fetchAiringsForAnalytics",
    integrated_init,
    'integrated analytics init',
    flags=re.S
)

body = regex_once(
    body,
    r"(  function bindEvents\(\) \{\n).*?(    dom\.reload\.addEventListener)",
    r"\1\2",
    'remove standalone sign-in event handlers',
    flags=re.S
)

body = regex_once(
    body,
    r"\n  window\.addEventListener\('DOMContentLoaded', async \(\) => \{.*?\n  \}\);\s*$",
    '',
    'remove standalone DOMContentLoaded boot',
    flags=re.S
)

module_prefix = '''(() => {
  const App = window.PledgeLib;
  if (!App) return;

  let host = null;
  let root = null;
  let mounted = false;
  let initialized = false;
  let loaded = false;
  let loadPromise = null;

  async function mountAnalyticsWorkspace() {
    host = document.getElementById('performance-analytics-root');
    if (!host) throw new Error('Performance Analytics workspace host is missing.');
    root = host.shadowRoot || host.attachShadow({ mode: 'open' });
    if (mounted) return root;
    const version = String(App.constants?.APP_VERSION || '').replace(/^v/i, '');
    const response = await window.fetch(`assets/analytics-workspace.html?v=${encodeURIComponent(version)}&_=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Performance Analytics workspace could not load (${response.status}).`);
    root.innerHTML = await response.text();
    bindDom();
    bindEvents();
    mounted = true;
    return root;
  }

'''

module_suffix = '''

  async function ensureReady(options = {}) {
    await mountAnalyticsWorkspace();
    const wantsCohort = Boolean(options.cohort);
    if (wantsCohort) {
      state.cohort = readAnalyticsCohort();
      if (state.cohort?.keySet) {
        state.question = 'programs';
        state.metric = 'avg';
      }
    }
    if (loaded && !options.force) {
      if (wantsCohort) {
        rebuildFilterOptions();
        render();
      }
      return true;
    }
    if (!loadPromise) {
      loadPromise = (async () => {
        if (!(await init())) return false;
        await load();
        loaded = true;
        return true;
      })().catch((error) => {
        console.error(error);
        note(error.message || 'Performance Analytics failed to load.', 'bad');
        return false;
      }).finally(() => {
        loadPromise = null;
      });
    }
    return loadPromise;
  }

  async function openCohort() {
    return ensureReady({ cohort: true });
  }

  async function reload() {
    return ensureReady({ force: true });
  }

  App.analyticsUi = { ensureReady, openCohort, reload };
})();
'''
ANALYTICS_JS.write_text(module_prefix + body + module_suffix, encoding='utf-8')

app_shell = APP_SHELL.read_text(encoding='utf-8')
app_shell = replace_once(
    app_shell,
    '<script defer src="assets/js/ui-performance.js"></script>',
    '<script defer src="assets/js/ui-analytics.js"></script>',
    'load integrated analytics module'
)
app_shell = replace_once(
    app_shell,
    '<button type="button" class="workspace-tab" data-workspace-button="performance" aria-pressed="false">Pledge Performance</button>',
    '<button type="button" class="workspace-tab" data-workspace-button="performance" aria-pressed="false">Performance Analytics</button>',
    'rename performance workspace tab'
)
perf_start, perf_end, _ = balanced_section(app_shell, '<section class="workspace-pane hidden" data-workspace-pane="performance">')
performance_host = '''<section class="workspace-pane hidden analytics-workspace-pane" data-workspace-pane="performance">
      <div id="performance-analytics-root" class="performance-analytics-root" aria-live="polite"></div>
    </section>'''
app_shell = app_shell[:perf_start] + performance_host + app_shell[perf_end:]
APP_SHELL.write_text(app_shell, encoding='utf-8')

core = CORE.read_text(encoding='utf-8')
core = replace_once(
    core,
    "      { id: 'performance', label: 'Pledge Performance', live: true }",
    "      { id: 'performance', label: 'Performance Analytics', live: true }",
    'workspace label'
)
CORE.write_text(core, encoding='utf-8')

workspace = WORKSPACE.read_text(encoding='utf-8')
workspace = replace_once(
    workspace,
    "    if (workspace.id === 'performance') void App.performanceUi?.ensureReady();",
    "    if (workspace.id === 'performance') void App.analyticsUi?.ensureReady();",
    'workspace analytics lifecycle'
)
WORKSPACE.write_text(workspace, encoding='utf-8')

list_ui = LIST_UI.read_text(encoding='utf-8')
old_handoff = '''      window.sessionStorage.setItem(constants.ANALYTICS_COHORT_STORAGE_KEY, JSON.stringify(payload));
      setNotice(`Opening analytics for ${utils.formatCount(rows.length)} current-list title${rows.length === 1 ? '' : 's'}…`);
      window.location.href = 'pledge-performance-lab.html?cohort=current-list';'''
new_handoff = '''      window.sessionStorage.setItem(constants.ANALYTICS_COHORT_STORAGE_KEY, JSON.stringify(payload));
      setNotice(`Opening analytics for ${utils.formatCount(rows.length)} current-list title${rows.length === 1 ? '' : 's'}…`);
      App.workspaceUi?.setWorkspace?.('performance');
      void App.analyticsUi?.openCohort?.();'''
list_ui = replace_once(list_ui, old_handoff, new_handoff, 'Analyze Current List in-place handoff')
LIST_UI.write_text(list_ui, encoding='utf-8')

auth = AUTH.read_text(encoding='utf-8')
auth = regex_once(
    auth,
    r"\n  function ensurePerformanceLabButton\(\) \{.*?\n  \}\n\n  function computeAdmin",
    "\n  function computeAdmin",
    'remove standalone analytics topbar button',
    flags=re.S
)
auth = auth.replace("    ensurePerformanceLabButton()?.classList.toggle('hidden', !canEdit());\n", '', 1)
AUTH.write_text(auth, encoding='utf-8')

app_init = APP_INIT.read_text(encoding='utf-8')
workspace_query_fn = '''

  function openWorkspaceFromQuery() {
    try {
      const url = new URL(window.location.href);
      const workspaceId = (url.searchParams.get('workspace') || '').trim();
      if (!workspaceId) return;
      const exists = (constants.WORKSPACES || []).some((workspace) => workspace.id === workspaceId);
      if (!exists) return;
      state.activeWorkspace = workspaceId;
      App.workspaceUi?.setWorkspace?.(workspaceId);
    } catch (error) {
      console.warn('Could not open linked workspace.', error);
    }
  }
'''
app_init = replace_once(app_init, '\n  async function init() {', workspace_query_fn + '\n  async function init() {', 'workspace query helper')
app_init = replace_once(app_init, '    openProgramFromQuery();\n', '    openProgramFromQuery();\n    openWorkspaceFromQuery();\n', 'open linked workspace after load')
APP_INIT.write_text(app_init, encoding='utf-8')

LEGACY_LAB.write_text('''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Opening Performance Analytics…</title>
</head>
<body>
  <p>Opening Performance Analytics in the Pledge Program Library…</p>
  <script>
    (() => {
      const source = new URL(window.location.href);
      const next = new URL('./', window.location.href);
      next.searchParams.set('workspace', 'performance');
      const cohort = source.searchParams.get('cohort');
      if (cohort) next.searchParams.set('cohort', cohort);
      window.location.replace(next.toString());
    })();
  </script>
</body>
</html>
''', encoding='utf-8')

version_payload['appVersion'] = '0.22.75'
version_payload['releasedAt'] = '2026-08-19'
VERSION.write_text(json.dumps(version_payload, separators=(',', ':')) + '\n', encoding='utf-8')

print('Integrated Performance Analytics workspace generated successfully.')
