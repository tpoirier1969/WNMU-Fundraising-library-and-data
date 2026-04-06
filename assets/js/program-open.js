(() => {
  const App = window.PledgeLib;
  if (!App) return;

  function programOpenTrigger(target) {
    return target?.closest?.('[data-program-open-id], [data-open-id]') || null;
  }

  function resolveProgramOpenId(trigger) {
    if (!trigger) return '';
    const direct = String(trigger.dataset?.programOpenId || trigger.dataset?.openId || '').trim();
    if (direct) return direct;
    return App.programLinks?.resolveId?.(trigger) || '';
  }

  function openProgramFromTrigger(trigger, event = null) {
    const programId = resolveProgramOpenId(trigger);
    if (!programId) return false;
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (!App.detailUi?.loadProgramDetail) return false;
    void App.detailUi.loadProgramDetail(programId);
    return true;
  }

  function handleClick(event) {
    const trigger = programOpenTrigger(event.target);
    if (!trigger) return;
    openProgramFromTrigger(trigger, event);
  }

  function handleKeydown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const trigger = programOpenTrigger(event.target);
    if (!trigger) return;
    const isKeyboardTarget = trigger.hasAttribute('tabindex') || trigger.tagName === 'A' || trigger.tagName === 'BUTTON' || trigger.getAttribute('role') === 'button';
    if (!isKeyboardTarget) return;
    openProgramFromTrigger(trigger, event);
  }

  function bindDelegation(root = document) {
    root.addEventListener('click', handleClick, true);
    root.addEventListener('keydown', handleKeydown, true);
  }

  App.programOpen = {
    bindDelegation,
    openProgramFromTrigger,
    resolveProgramOpenId,
    programOpenTrigger
  };
})();
