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

  // solo il numero di versione: le date restano in changelog.js ma non si mostrano
  const heading = (v) => v.label || `Versione ${v.version}`;
  const itemNode = (it) => el("div", { className: "news-item" },
      el("strong", { textContent: it.title }),
      el("p", { textContent: it.text }),
      it.how ? el("p", { className: "hint", textContent: "Dove: " + it.how }) : null);

  // "1.9" < "1.12" < "1.20": confronto numerico parte per parte
  const cmpVer = (a, b) => {
    const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
    return 0;
  };

  // L'ultima versione è sempre aperta; restano aperte anche quelle non ancora lette (più recenti dell'ultima vista).
  // Le versioni già lette sono compattate in "Versioni precedenti", ognuna richiudibile.
  function renderNews(panel) {
    const [cur, ...old] = CHANGELOG;
    const seen = state.seen;  // prima di markSeen()
    const unread = seen ? old.filter((v) => cmpVer(v.version, seen) > 0) : [];
    const read = old.filter((v) => !unread.includes(v));
    PS.fill(panel,
        el("h4", { textContent: `Novità di Odoo Enhancer · versione ${VERSION}` }),
        ...cur.items.map(itemNode),
        ...unread.flatMap((v) => [el("h4", { className: "sep", textContent: `${heading(v)} · non ancora letta` }), ...v.items.map(itemNode)]),
        read.length ? el("details", { className: "news-old news-all" },
            el("summary", { textContent: `Versioni precedenti (${read.length})` }),
            ...read.map((v) => el("details", { className: "news-old" },
                el("summary", { textContent: `${heading(v)} · ${v.items.length} novità` }),
                ...v.items.map(itemNode)))) : null,
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
