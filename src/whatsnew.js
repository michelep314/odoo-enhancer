/* Pannello "Novità" (✨): cosa è cambiato in ogni versione, con avviso per le novità non lette */
(() => {
  "use strict";
  const PS = window.__ps;
  if (!PS || PS.ready) return;
  const { el, fail, store, getEnv, CHANGELOG, VERSION } = PS;

  // seen = ultima versione letta nel pannello; notified = ultima versione annunciata con la notifica
  const STORE = store("ps-whatsnew-v1", {}, (v) => v && typeof v === "object" && !Array.isArray(v));
  const state = STORE.load();
  const hasNews = () => state.seen !== VERSION;

  function markSeen() {
    if (!hasNews()) return;
    state.seen = VERSION;
    STORE.save(state);
    PS.renderBar();  // toglie il pallino dal pulsante ✨
  }

  const fmtDate = (d) => new Date(d + "T00:00:00").toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" });
  const heading = (v) => v.label || `Versione ${v.version}${v.date ? " · " + fmtDate(v.date) : ""}`;
  const itemNode = (it) => el("div", { className: "news-item" },
      el("strong", { textContent: it.title }),
      el("p", { textContent: it.text }),
      it.how ? el("p", { className: "hint", textContent: "Dove: " + it.how }) : null);

  function renderNews(panel) {
    const [cur, ...old] = CHANGELOG;
    PS.fill(panel,
        el("h4", { textContent: `Novità di Odoo Enhancer · versione ${VERSION}` }),
        cur.date ? el("p", { className: "hint", textContent: fmtDate(cur.date) }) : null,
        ...cur.items.map(itemNode),
        old.length ? el("h4", { className: "sep", textContent: "Versioni precedenti" }) : null,
        ...old.map((v) => el("details", { className: "news-old" },
            el("summary", { textContent: heading(v) }), ...v.items.map(itemNode))),
        el("div", { className: "acts" }, el("button", { textContent: "Chiudi", onclick: () => PS.togglePanel("news") })));
    markSeen();
  }

  // Una notifica per versione, solo per chi aveva già letto una versione precedente
  // (a chi non ha mai aperto il pannello basta il pallino su ✨)
  function notifyNews(tries = 0) {
    if (!state.seen || !hasNews() || state.notified === VERSION) return;
    const notification = getEnv()?.services?.notification;
    if (!notification) {
      if (tries < 20) setTimeout(() => notifyNews(tries + 1), 500);
      return;
    }
    state.notified = VERSION;
    STORE.save(state);
    const close = notification.add(`Odoo Enhancer è stato aggiornato alla versione ${VERSION}.`, {
      type: "info",
      buttons: [{
        name: "Scopri le novità", primary: true,
        onClick: () => { close?.(); PS.togglePanel("news").catch(fail); },
      }],
    });
  }

  Object.assign(PS, { renderNews, hasNews, notifyNews });
})();
