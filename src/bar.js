/* Barra in basso a sinistra e pannello di gestione dei pulsanti */
(() => {
  "use strict";
  const PS = window.__ps;
  if (!PS || PS.ready) return;
  const { TASK, SPRINT_FIELD, getEnv, mod, Domain, el, fail, svg, store, evalCtx, sprintValue } = PS;

  /* ================= CONFIGURAZIONE ================= */
  const DEFAULTS = [
    { label: "Sprint corrente", model: TASK, domain: "[]", context: "{}", sprint: 0, view: "kanban" },
    { label: "Sprint precedente", model: TASK, domain: "[]", context: "{}", sprint: 1, view: "kanban" },
    { label: "Miei – sprint corrente", model: TASK, domain: "[('user_ids', 'in', [uid])]", context: "{}", sprint: 0, view: "kanban" },
  ];
  const VIEW_NAMES = {
    kanban: "Kanban", list: "Elenco", calendar: "Calendario", pivot: "Pivot", graph: "Grafico",
    activity: "Attività", map: "Mappa", gantt: "Gantt", cohort: "Coorte", hierarchy: "Gerarchia",
  };
  /* ================================================== */

  const sprintLabel = (s) => ({ 0: "sprint corrente", 1: "sprint precedente" }[s] ?? `${s} sprint fa`);
  const viewName = (m) => VIEW_NAMES[m] || m;

  /* ---------- persistenza ---------- */
  const STORE = store("ps-buttons-v1", DEFAULTS, Array.isArray);
  let buttons = STORE.load();
  const save = () => { STORE.save(buttons); render(); };

  /* ---------- logica Odoo ---------- */
  // URL Odoo 17: /web#action=123&active_id=5&model=project.task&view_type=kanban&menu_id=45
  function parseOdooUrl(str) {
    const u = new URL(str.trim(), location.origin);
    const p = new URLSearchParams(u.hash.replace(/^#/, "") || u.search);
    const num = (k) => (/^\d+$/.test(p.get(k) || "") ? Number(p.get(k)) : null);
    const action = num("action");
    if (!action) throw new Error("nell'URL manca action=<numero>");
    return {
      action,
      model: p.get("model") || null,
      view_type: p.get("view_type") || null,
      active_id: num("active_id"),
      menu_id: num("menu_id"),
    };
  }
  // URL nel formato di parseOdooUrl per la pagina aperta, letto dallo stato di Odoo (vale anche
  // quando l'indirizzo non contiene action=); null se l'azione corrente non ha un id
  function currentPageUrl(env) {
    const ctrl = env?.services.action?.currentController;
    const act = ctrl?.action;
    const hash = new URLSearchParams(location.hash.slice(1));
    const action = (typeof act?.id === "number" && act.id) || Number(hash.get("action")) || null;
    if (!action) return null;
    let menu = null;
    try { menu = env.services.menu?.getCurrentApp?.()?.id || null; } catch { /* menu non pronto */ }
    const p = new URLSearchParams({ action: String(action) });
    const model = act?.res_model || hash.get("model");
    const viewType = ctrl?.view?.type || ctrl?.props?.type || hash.get("view_type");
    const activeId = act?.context?.active_id || Number(hash.get("active_id")) || null;
    menu ||= Number(hash.get("menu_id")) || null;
    if (model) p.set("model", model);
    if (viewType) p.set("view_type", viewType);
    if (activeId) p.set("active_id", String(activeId));
    if (menu) p.set("menu_id", String(menu));
    return `${location.origin}/web#${p}`;
  }
  const parseDomain = (str, ctx) => new (Domain())(str || "[]").toList(ctx);
  const parseContext = (str, ctx) =>
      str && str.trim() !== "{}" ? mod("@web/core/py_js/py").evaluateExpr(str, ctx) : {};

  // Azione da cui è stato salvato il preferito: viste (anche personalizzate), dominio, contesto
  const actionCache = new Map();
  function actionInfo(orm, actionId) {
    if (!actionId) return Promise.resolve(null);
    if (!actionCache.has(actionId)) {
      actionCache.set(actionId, orm
          .read("ir.actions.act_window", [actionId], ["views", "domain", "context", "res_model", "name"])
          .then((r) => r[0] || null)
          .catch(() => null));
    }
    return actionCache.get(actionId);
  }

  const fallbackModes = (model) => (model === TASK ? ["kanban", "list"] : ["list"]);
  const modesOf = (info, model) => {
    const m = (info?.views || []).map(([, mode]) => mode).filter((x) => x !== "form" && x !== "search");
    return m.length ? m : fallbackModes(model);
  };

  function buildViews(info, model, preferred) {
    const views = info?.views?.length
        ? info.views.map(([id, mode]) => [id, mode])
        : [...fallbackModes(model).map((m) => [false, m]), [false, "form"]];
    const i = views.findIndex(([, m]) => m === preferred);
    if (i > 0) views.unshift(...views.splice(i, 1));
    if (!views.some(([, m]) => m === "form")) views.push([false, "form"]);
    return views;
  }

  // sostituisce le condizioni sullo sprint del preferito, o la aggiunge
  function withSprint(list, n) {
    let found = false;
    const out = list.map((t) => {
      if (Array.isArray(t) && t[0] === SPRINT_FIELD) { found = true; return [SPRINT_FIELD, "=", n]; }
      return t;
    });
    return found ? out : Domain().and([out, [[SPRINT_FIELD, "=", n]]]).toList();
  }

  // Odoo mostra le fasi vuote (colonne senza schede) solo se il contesto dice a quale progetto/team appartiene
  // la vista. Se tutte le schede del pulsante stanno in un solo progetto/team, lo aggiungo io al contesto.
  const EXPAND_CTX = {
    [TASK]: ["default_project_id", "project_id"],
    "helpdesk.ticket": ["default_team_id", "team_id"],
  };
  async function withExpandContext(orm, model, domain, context) {
    const cfg = EXPAND_CTX[model];
    if (!cfg || context[cfg[0]]) return context;
    const [ctxKey, field] = cfg;
    try {
      const groups = await orm.readGroup(model, domain, [field], [field], { lazy: true });
      const ids = groups.map((g) => g[field]?.[0]).filter(Boolean);
      if (ids.length === 1) return { ...context, [ctxKey]: ids[0] };
    } catch (e) { console.warn("[pulsantiera] colonne vuote: contesto non calcolato:", e); }
    return context;
  }

  async function open(b) {
    const env = getEnv();
    if (!env || !mod("@web/core/domain")) return alert("Odoo non ancora caricato: riprova tra un secondo.");
    const { orm, action } = env.services;
    const ctx = evalCtx(env, b);
    const info = await actionInfo(orm, b.actionId);

    let domain = parseDomain(b.domain, ctx);
    let context = parseContext(b.context, ctx);
    if (info) {
      try {
        if (info.domain) domain = Domain().and([parseDomain(info.domain, ctx), domain]).toList();
      } catch (e) { console.warn("[pulsantiera] dominio azione ignorato:", e); }
      try {
        const ac = parseContext(info.context, ctx);
        for (const k of Object.keys(ac)) if (k.startsWith("search_default_")) delete ac[k];
        context = { ...ac, ...context };
      } catch (e) { console.warn("[pulsantiera] contesto azione ignorato:", e); }
    }
    if (b.activeId) context = { active_id: b.activeId, active_ids: [b.activeId], ...context };

    let name = b.label;
    if (b.sprint != null && b.model === TASK) {
      const n = await sprintValue(orm, b.sprint);
      if (n === null) return alert("Nessuno sprint trovato.");
      domain = withSprint(domain, n);
      name += ` (#${n})`;
    }
    context = await withExpandContext(orm, b.model, domain, context);

    await action.doAction({
      type: "ir.actions.act_window",
      name,
      res_model: b.model,
      domain,
      views: buildViews(info, b.model, b.view),
      context,
      target: "current",
    }, { clearBreadcrumbs: true });
    if (b.menuId) { try { env.services.menu.setCurrentMenu(b.menuId); } catch { /* opzionale */ } }
  }

  const favorites = (env) => env.services.orm.searchRead(
      "ir.filters", [], ["name", "model_id", "domain", "context", "action_id"], { order: "model_id, name" });

  /* ---------- pannello di gestione ---------- */
  let panel = null, panelKind = null;
  // evidenzia nella barra il pulsante del pannello aperto
  const syncActive = () => {
    for (const b of document.querySelectorAll("#ps-bar [data-panel], #ps-tray [data-panel]")) {
      const on = b.dataset.panel === panelKind;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    }
  };
  function closePanel() {
    if (!panel) return;
    panel.remove();
    panel = null;
    panelKind = null;
    syncActive();
  }
  async function togglePanel(kind = "buttons") {
    const same = panel && panelKind === kind;
    closePanel();
    if (same) return;
    const env = getEnv();
    if (!env) return alert("Odoo non ancora caricato: riprova tra un secondo.");
    panel = el("div", { id: "ps-panel" });
    panelKind = kind;
    document.body.append(panel);
    placePanel();
    syncActive();
    await (kind === "ts" ? PS.renderTs(env, panel) : kind === "bg" ? PS.renderBg(panel)
        : kind === "news" ? PS.renderNews(panel) : renderPanel(env));
  }

  const fillViewSelect = (sel, modes, current) => {
    sel.replaceChildren(...modes.map((m) => el("option", { value: m, textContent: viewName(m) })));
    sel.value = modes.includes(current) ? current : modes[0];
  };

  async function renderPanel(env) {
    if (!panel) return;
    const { orm } = env.services;
    panel.replaceChildren(el("p", { className: "hint", textContent: "Carico i preferiti…" }));
    let favs = [];
    try { favs = await favorites(env); } catch (e) { fail(e); }

    const favSel = el("select", {},
        el("option", { value: "", textContent: "Scegli un preferito" }),
        ...favs.map((f, i) => el("option", { value: String(i), textContent: `${f.name} (${f.model_id})` })));
    const nameIn = el("input", { placeholder: "Nome del pulsante" });
    const viewSel = el("select", { disabled: true }, el("option", { value: "", textContent: "Scegli prima un preferito" }));
    const sprintSel = el("select", { disabled: true },
        el("option", { value: "", textContent: "Come nel preferito" }),
        el("option", { value: "0", textContent: "Sprint corrente" }),
        el("option", { value: "1", textContent: "Sprint precedente" }),
        el("option", { value: "2", textContent: "Due sprint fa" }));

    const urlIn = el("input", { placeholder: "Incolla l'URL della vista (facoltativo)" });
    let urlData = null;
    let modes = [];

    // URL e preferito si combinano: l'URL decide menu, vista e progetto; il preferito i filtri
    async function resolve() {
      const f = favs[favSel.value];
      const actionId = urlData?.action || f?.action_id?.[0] || null;
      const info = await actionInfo(orm, actionId);
      const model = urlData?.model || info?.res_model || f?.model_id || null;
      return { f, actionId, info, model };
    }

    async function refresh() {
      const { f, info, model } = await resolve();
      sprintSel.disabled = model !== TASK;
      if (sprintSel.disabled) sprintSel.value = "";
      if (!model) { viewSel.disabled = true; return; }
      modes = modesOf(info, model);
      if (urlData?.view_type && !modes.includes(urlData.view_type)) modes.unshift(urlData.view_type);
      fillViewSelect(viewSel, modes, urlData?.view_type || modes[0]);
      viewSel.disabled = false;
      if (!nameIn.value) nameIn.value = f?.name || info?.name || "";
    }

    favSel.onchange = () => {
      const f = favs[favSel.value];
      if (f) nameIn.value = f.name;
      refresh().catch(fail);
    };
    urlIn.onchange = () => {
      urlData = null;
      if (urlIn.value.trim()) {
        try { urlData = parseOdooUrl(urlIn.value); }
        catch (e) { return alert("URL non valido: " + e.message); }
      }
      refresh().catch(fail);
    };
    const hereBtn = el("button", { type: "button", textContent: "Usa pagina corrente",
      title: "Compila l'URL con menu, vista e progetto della pagina aperta",
      onclick: () => {
        const u = currentPageUrl(env);
        if (!u) return alert("La pagina corrente non è una vista salvabile: aprila dal menu di Odoo e riprova.");
        urlIn.value = u;
        urlIn.onchange();
      } });

    // salva e ridisegna il pannello
    const commit = () => { save(); renderPanel(env); };

    const addBtn = el("button", {
      className: "primary", textContent: "Aggiungi pulsante",
      onclick: async () => {
        try {
          const { f, actionId, info, model } = await resolve();
          if (!f && !urlData) return alert("Scegli un preferito, incolla un URL o entrambi.");
          if (!model) return alert("Non riesco a capire il modello: controlla l'URL.");
          if (f && f.model_id !== model &&
              !confirm(`Il preferito è su ${f.model_id}, l'URL su ${model}. Continuare?`)) return;
          buttons.push({
            label: nameIn.value.trim() || f?.name || info?.name || model,
            model,
            domain: f?.domain || "[]",
            context: f?.context || "{}",
            sprint: sprintSel.value === "" ? null : Number(sprintSel.value),
            actionId,
            activeId: urlData?.active_id || null,
            menuId: urlData?.menu_id || null,
            view: viewSel.value || null,
            modes,
          });
          commit();
        } catch (e) { fail(e); }
      },
    });

    const rows = buttons.map((b, i) => {
      const rowModes = b.modes?.length ? b.modes : fallbackModes(b.model);
      const vSel = el("select", { className: "mini", title: "Vista iniziale",
        onchange: () => { b.view = vSel.value; save(); } });
      fillViewSelect(vSel, rowModes, b.view);
      const swap = (j) => { [buttons[j], buttons[i]] = [buttons[i], buttons[j]]; commit(); };
      // "row" no: in Odoo è la griglia di Bootstrap e mette ogni figlio a tutta larghezza
      return el("div", { className: "ps-btnrow" },
          el("span", { className: "num", textContent: String(i + 1) }),
          el("span", { className: "name" },
              el("span", { className: "label", textContent: b.label }),
              el("span", { className: "meta", textContent: `${b.model}${b.sprint != null ? " · " + sprintLabel(b.sprint) : ""}` })),
          vSel,
          el("span", { className: "tools" },
              el("button", { className: "icon", textContent: "↑", title: "Sposta su", disabled: i === 0,
                onclick: () => swap(i - 1) }),
              el("button", { className: "icon", textContent: "↓", title: "Sposta giù", disabled: i === buttons.length - 1,
                onclick: () => swap(i + 1) }),
              el("button", { className: "icon", textContent: "✎", title: "Rinomina",
                onclick: () => {
                  const v = prompt("Nuovo nome", b.label);
                  if (v?.trim()) { b.label = v.trim(); commit(); }
                } }),
              el("button", { className: "icon del", textContent: "×", title: "Elimina",
                onclick: () => { if (confirm(`Eliminare "${b.label}"?`)) { buttons.splice(i, 1); commit(); } } })));
    });

    const exportBtn = el("button", {
      textContent: "Esporta pulsanti",
      onclick: async () => {
        const j = JSON.stringify(buttons, null, 2);
        try { await navigator.clipboard.writeText(j); alert("Configurazione copiata negli appunti."); }
        catch { prompt("Copia la configurazione:", j); }
      },
    });
    const importBtn = el("button", {
      textContent: "Importa pulsanti",
      onclick: () => {
        const j = prompt("Incolla la configurazione esportata:");
        if (!j) return;
        try {
          const v = JSON.parse(j);
          if (!Array.isArray(v) || !v.every((x) => typeof x?.label === "string" && typeof x?.model === "string"))
            throw new Error("formato non valido");
          buttons = v; commit();
        } catch (e) { alert("Importazione non riuscita: " + e.message); }
      },
    });
    const resetBtn = el("button", {
      textContent: "Ripristina predefiniti",
      onclick: () => {
        if (confirm("Sostituire tutti i pulsanti con quelli predefiniti?")) {
          buttons = structuredClone(DEFAULTS); commit();
        }
      },
    });

    panel.replaceChildren(
        el("h4", { textContent: "Nuovo pulsante" }),
        el("label", { textContent: "URL della vista" }), el("div", { className: "inline" }, urlIn, hereBtn),
        el("label", { textContent: "Preferito (filtri)" }), favSel,
        el("label", { textContent: "Nome" }), nameIn,
        el("label", { textContent: "Vista iniziale" }), viewSel,
        el("label", { textContent: "Sprint" }), sprintSel,
        el("p", { className: "hint", textContent: "L’URL indica menu, vista e progetto; il preferito aggiunge i filtri. Puoi usarli anche da soli. Con Sprint corrente o precedente, il numero salvato nel preferito viene sostituito da quello calcolato al clic." }),
        el("div", { className: "acts" }, addBtn),
        el("h4", { className: "sep", textContent: "Pulsanti" }),
        rows.length ? el("div", { className: "ps-btnlist" }, ...rows)
            : el("p", { className: "hint", textContent: "Nessun pulsante: aggiungine uno qui sopra." }),
        el("div", { className: "acts" }, exportBtn, importBtn, resetBtn),
        ...trayPosSection(),
        ...PS.backupSection(),
        el("div", { className: "acts" }, el("button", { textContent: "Chiudi", onclick: () => togglePanel("buttons") })));
  }

  // con gli strumenti nella barra di Odoo il pannello si apre sotto di essi; altrimenti in basso a sinistra
  function placePanel() {
    const nav = inTray && document.querySelector(".o_main_navbar");
    panel.classList.toggle("top", !!nav);
    panel.classList.toggle("center", !!nav && placed === "center");
    panel.classList.toggle("left", !!nav && placed === "left");
    panel.style.top = nav ? Math.round(nav.getBoundingClientRect().bottom + 6) + "px" : "";
    // a sinistra il pannello si allinea alle icone
    panel.style.left = nav && placed === "left" ? Math.round(tray.getBoundingClientRect().left) + "px" : "";
  }

  /* ---------- strumenti (icone) ---------- */
  const iconBtn = (icon, title, onclick) => {
    const b = el("button", { type: "button", className: "ps-tool", title, onclick });
    b.setAttribute("aria-label", title);
    b.innerHTML = svg(icon);
    return b;
  };
  const panelBtn = (kind, icon, title) => {
    const b = iconBtn(icon, title, () => togglePanel(kind).catch(fail));
    b.dataset.panel = kind;
    return b;
  };
  const toolButtons = () => {
    const news = panelBtn("news", "sparkle", PS.hasNews() ? "Novità (da leggere)" : "Novità");
    news.classList.toggle("ps-new", PS.hasNews());
    return [
      iconBtn("search", "Cerca nelle schede (/)", () => PS.openSearch()),
      panelBtn("bg", "image", "Sfondo"),
      panelBtn("ts", "hours", "Compila fogli ore"),
      panelBtn("buttons", "plus", "Aggiungi o gestisci pulsanti"),
      news,
    ];
  };

  /* gruppo nella barra in alto di Odoo: aperto sta al centro, compresso diventa una freccia a destra accanto alla chat */
  // pos = dove stanno le icone aperte: "left" (dopo i menu di Odoo), "center" o "right" (accanto alla chat)
  const TRAY_POS = { left: "A sinistra, dopo i menu", center: "Al centro", right: "A destra, accanto alla chat" };
  const TRAY = store("ps-tray-v1", { open: true, pos: "center" }, (v) => v && typeof v.open === "boolean");
  const trayState = TRAY.load();
  if (!TRAY_POS[trayState.pos]) trayState.pos = "center";
  const tray = el("div", { id: "ps-tray" });
  let inTray = false;  // strumenti nella barra di Odoo (true) o nella barra in basso (false)
  /* animazione apri/comprimi: le icone svaniscono o compaiono in sequenza, il gruppo scivola tra centro e chat */
  const motionOk = () => !matchMedia("(prefers-reduced-motion: reduce)").matches;
  const toolsOf = () => [...tray.querySelectorAll("button:not(.ps-tray-toggle)")];
  const fadeTools = (out) => Promise.all(toolsOf().map((b, i, all) => b.animate(
      out ? [{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(.5)" }]
          : [{ opacity: 0, transform: "scale(.5)" }, { opacity: 1, transform: "scale(1)" }],
      { duration: 160, delay: (out ? i : all.length - 1 - i) * 30, easing: out ? "ease-in" : "ease-out", fill: out ? "forwards" : "backwards" },
  ).finished.catch(() => {})));
  // FLIP: il gruppo parte da dove si trovava la freccia e scivola nella nuova posizione
  function slideFrom(oldRect) {
    const t = tray.querySelector(".ps-tray-toggle");
    if (!oldRect || !t) return;
    const r = t.getBoundingClientRect();
    const dx = oldRect.left - r.left, dy = oldRect.top - r.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    // "translate" si somma al transform che centra il gruppo
    tray.animate([{ translate: `${dx}px ${dy}px` }, { translate: "0 0" }],
        { duration: 340, easing: "cubic-bezier(.2,.8,.2,1)" });
  }

  let toggling = false;
  async function toggleTray() {
    if (toggling) return;
    toggling = true;
    try {
      const open = trayState.open;
      const animate = motionOk() && inTray;
      if (animate && open) {
        tray.style.pointerEvents = "none";
        await fadeTools(true);
      }
      const oldRect = tray.querySelector(".ps-tray-toggle")?.getBoundingClientRect();
      trayState.open = !open;
      TRAY.save(trayState);
      renderTray();
      ensureTray(true);
      syncActive();
      if (animate) {
        slideFrom(oldRect);
        if (!open) fadeTools(false);
      }
    } finally {
      tray.style.pointerEvents = "";
      toggling = false;
    }
  }

  function renderTray() {
    const open = trayState.open;
    tray.classList.toggle("collapsed", !open);
    tray.classList.toggle("ps-has-new", PS.hasNews());
    const toggle = iconBtn(open ? "chevronRight" : "chevronLeft",
        open ? "Comprimi gli strumenti di Odoo Enhancer" : "Mostra gli strumenti di Odoo Enhancer",
        () => toggleTray().catch(fail));
    toggle.classList.add("ps-tray-toggle");
    toggle.setAttribute("aria-expanded", String(open));
    tray.replaceChildren(...(open ? toolButtons() : []), toggle);
  }

  /* ---------- barra in basso: scorciatoie (e strumenti se la barra di Odoo non c'è) ---------- */
  const bar = el("div", { id: "ps-bar" });
  // riducendo la barra si chiude anche il pannello aperto
  const toggleBar = () => { if (bar.classList.toggle("min")) closePanel(); };
  function render() {
    const fallback = !inTray;
    bar.classList.toggle("ps-has-new", fallback && PS.hasNews());  // pallino anche sul ☰ quando la barra è ridotta
    bar.classList.toggle("empty", !fallback && !buttons.length);
    bar.replaceChildren(
        el("button", { className: "ps-toggle", textContent: "☰", title: "Mostra/nascondi (Alt+P)", onclick: toggleBar }),
        ...buttons.map((b) => el("button", { textContent: b.label, onclick: () => open(b).catch(fail) })),
        ...(fallback ? toolButtons() : []));
    if (!fallback) renderTray();
    syncActive();
  }

  // Al centro c'è posto? Stima la posizione senza spostare nulla (spostare genererebbe mutazioni a ogni giro)
  // Spazio libero nella barra di Odoo tra i menu (sinistra) e le icone di sistema (destra)
  function freeSpace(nav, systray) {
    const n = nav.getBoundingClientRect();
    const w = (tray.isConnected && !tray.classList.contains("collapsed") && tray.offsetWidth) || 220;
    let leftEdge = n.left;
    for (const e of nav.querySelectorAll(".o_menu_toggle, .o_menu_brand, .o_menu_sections > *")) {
      const r = e.getBoundingClientRect();
      if (r.width) leftEdge = Math.max(leftEdge, r.right);
    }
    let rightEdge = n.right;
    for (const e of systray.children) {
      if (e === tray) continue;
      const r = e.getBoundingClientRect();
      if (r.width) rightEdge = Math.min(rightEdge, r.left);
    }
    return { n, w, leftEdge, rightEdge };
  }
  // Posizione effettiva: quella scelta se c'è spazio, altrimenti a destra. Compresse stanno sempre a destra.
  // Stima senza spostare nulla (spostare genererebbe mutazioni a ogni giro).
  function choosePlace(nav, systray) {
    if (!trayState.open || trayState.pos === "right") return { place: "right" };
    const { n, w, leftEdge, rightEdge } = freeSpace(nav, systray);
    if (trayState.pos === "center") {
      const left = n.left + n.width / 2 - w / 2;
      return left > leftEdge + 16 && left + w < rightEdge - 16 ? { place: "center" } : { place: "right" };
    }
    const left = leftEdge + 12;
    return left + w < rightEdge - 16 ? { place: "left", x: Math.round(left - n.left) } : { place: "right" };
  }

  // Odoo ridisegna la barra in alto cambiando app: l'observer di main.js richiama questa funzione.
  // Con force (apri/comprimi, cambio posizione o vista, ridimensionamento) ricalcola anche la posizione.
  let placed = "right";
  function ensureTray(force = false) {
    const nav = document.querySelector(".o_main_navbar");
    const systray = nav?.querySelector(".o_menu_systray");
    const floating = placed !== "right";
    const misplaced = !systray || tray.parentElement !== (floating ? nav : systray);
    if (systray && (force || misplaced)) {
      const c = choosePlace(nav, systray);
      placed = c.place;
      tray.style.left = c.place === "left" ? `${c.x}px` : "";
    }
    const target = !systray ? null : placed !== "right" ? nav : systray;
    if (!target) tray.remove();
    else if (tray.parentElement !== target) { if (target === nav) nav.append(tray); else systray.prepend(tray); }
    tray.dataset.place = target ? placed : "";
    if (tray.isConnected !== inTray) {
      inTray = tray.isConnected;
      render();
    }
  }
  function setTrayPos(pos) {
    trayState.pos = pos;
    trayState.open = true;
    TRAY.save(trayState);
    renderTray();
    ensureTray(true);
    syncActive();
    if (panel) placePanel();
  }

  // sezione del pannello "+": dove mettere le icone
  function trayPosSection() {
    const sel = el("select", {}, ...Object.entries(TRAY_POS).map(([v, t]) => el("option", { value: v, textContent: t })));
    sel.value = trayState.pos;
    sel.onchange = () => setTrayPos(sel.value);
    return [
      el("h4", { className: "sep", textContent: "Icone degli strumenti" }),
      el("label", { textContent: "Posizione nella barra in alto" }), sel,
      el("p", { className: "hint", textContent: "Compresse con la freccia stanno sempre a destra, accanto alla chat. Se nella posizione scelta non c'è spazio, si spostano a destra." }),
    ];
  }

  ensureTray();
  render();
  document.body.append(bar);
  let resizeTimer = null;
  addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => ensureTray(true), 150);
  });
  document.addEventListener("keydown", (e) => {
    if (e.altKey && e.key.toLowerCase() === "p") toggleBar();
  });

  Object.assign(PS, { togglePanel, renderBar: render, ensureTray });
})();
