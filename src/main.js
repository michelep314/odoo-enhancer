/* Avvio: un solo MutationObserver per menu "Duplica scheda", decorazioni kanban e cambio vista */
(() => {
  "use strict";
  const PS = window.__ps;
  if (!PS || PS.ready) return;

  const MENU = ".dropdown-menu, .o-dropdown--menu";
  // nodi creati da noi: le loro modifiche non devono rilanciare decorate()
  const OURS = ".ps-labels, .ps-usgroup, .ps-prio-sum, .ps-colbtn, .ps-dup";
  const isOurs = (n) => n.nodeType === 1 && n.matches(OURS);

  function touchesKanban(m) {
    if (m.target.closest?.(OURS)) return false;
    const changed = [...m.addedNodes, ...m.removedNodes];
    if (changed.length && changed.every(isOurs)) return false;
    return !!m.target.closest?.(".o_kanban_renderer") || [...m.addedNodes].some((n) => n.nodeType === 1 &&
        (n.matches(".o_kanban_renderer, .o_kanban_record") || n.querySelector(".o_kanban_record")));
  }

  // Odoo cambia vista senza ricaricare: lo sfondo dipende dall'URL
  let lastHref = location.href;
  const checkUrl = () => {
    if (location.href === lastHref) return;
    lastHref = location.href;
    PS.applyBg();
  };

  new MutationObserver((muts) => {
    let deco = false;
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.matches(MENU)) PS.injectDup(n);
        else for (const menu of n.querySelectorAll(MENU)) PS.injectDup(menu);
      }
      if (!deco && touchesKanban(m)) deco = true;
    }
    if (deco) PS.scheduleDecorate();
    checkUrl();
  }).observe(document.body, { childList: true, subtree: true });
  addEventListener("hashchange", checkUrl);
  addEventListener("popstate", checkUrl);

  PS.applyBg();
  PS.applyLook();
  PS.scheduleDecorate();
  PS.ready = true;
  console.log("[pulsantiera] caricata", location.href);
})();
