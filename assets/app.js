(function () {
  const el = document.getElementById('config-status');
  const cfg = window.PLEDGE_MANAGER_CONFIG || {};
  const hasUrl = typeof cfg.SUPABASE_URL === 'string' && cfg.SUPABASE_URL.trim().length > 0;
  const hasKey = typeof cfg.SUPABASE_ANON_KEY === 'string' && cfg.SUPABASE_ANON_KEY.trim().length > 0;

  if (hasUrl && hasKey) {
    el.textContent = 'Config found. Supabase URL and anon key are present.';
    el.classList.add('good');
  } else {
    el.innerHTML = 'Config is not filled in yet. Edit <code>config.js</code> and add your Supabase URL and anon key.';
    el.classList.add('warn');
  }
})();
