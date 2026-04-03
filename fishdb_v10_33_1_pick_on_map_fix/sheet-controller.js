window.SheetController = (function(){
  function resolve(elOrId){
    if(!elOrId) return null;
    return typeof elOrId === 'string' ? document.getElementById(elOrId) : elOrId;
  }
  function open(elOrId){
    const el=resolve(elOrId);
    if(!el) return;
    el.classList.add('visible');
    el.setAttribute('aria-hidden','false');
    el.style.pointerEvents='auto';
  }
  function close(elOrId){
    const el=resolve(elOrId);
    if(!el) return;
    el.classList.remove('visible');
    el.setAttribute('aria-hidden','true');
    el.style.pointerEvents='none';
  }
  function closeAll(ids){ (ids || []).forEach(close); }
  function bindGenericCloseButtons(options){
    const onLogClose = options && options.onLogClose;
    document.querySelectorAll('.sheetClose').forEach(btn=>{
      const clone=btn.cloneNode(true);
      btn.replaceWith(clone);
      clone.addEventListener('click', event=>{
        event.preventDefault();
        event.stopPropagation();
        const sheet=clone.closest('.sheet');
        if(sheet) close(sheet);
        if(sheet && sheet.id==='logSheet' && typeof onLogClose === 'function') onLogClose();
      });
    });
  }
  return { open, close, closeAll, bindGenericCloseButtons };
})();
