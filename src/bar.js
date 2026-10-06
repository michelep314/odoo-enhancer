/* Barra in basso a sinistra e pannello di gestione dei pulsanti */
(() => {
  "use strict";
  const PS = window.__ps;
  if (!PS || PS.ready) return;
  const { TASK, SPRINT_FIELD, getEnv, mod, Domain, el, fail, store, evalCtx, sprintValue } = PS;

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
    for (const b of document.querySelectorAll("#ps-bar [data-panel]")) {
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
    syncActive();
    await (kind === "ts" ? PS.renderTs(env, panel) : kind === "bg" ? PS.renderBg(panel) : renderPanel(env));
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
      return el("div", { className: "row" },
          el("span", {
            textContent: b.label,
            title: `${b.model} ${b.domain}${b.sprint != null ? " + " + sprintLabel(b.sprint) : ""}`,
          }),
          vSel,
          el("button", {
            className: "icon", textContent: "↑", title: "Sposta su", disabled: i === 0,
            onclick: () => { [buttons[i - 1], buttons[i]] = [buttons[i], buttons[i - 1]]; commit(); },
          }),
          el("button", {
            className: "icon", textContent: "✎", title: "Rinomina",
            onclick: () => {
              const v = prompt("Nuovo nome", b.label);
              if (v?.trim()) { b.label = v.trim(); commit(); }
            },
          }),
          el("button", {
            className: "icon", textContent: "×", title: "Elimina",
            onclick: () => { if (confirm(`Eliminare "${b.label}"?`)) { buttons.splice(i, 1); commit(); } },
          }));
    });

    const exportBtn = el("button", {
      textContent: "Esporta",
      onclick: async () => {
        const j = JSON.stringify(buttons, null, 2);
        try { await navigator.clipboard.writeText(j); alert("Configurazione copiata negli appunti."); }
        catch { prompt("Copia la configurazione:", j); }
      },
    });
    const importBtn = el("button", {
      textContent: "Importa",
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
        el("label", { textContent: "URL della vista" }), urlIn,
        el("label", { textContent: "Preferito (filtri)" }), favSel,
        el("label", { textContent: "Nome" }), nameIn,
        el("label", { textContent: "Vista iniziale" }), viewSel,
        el("label", { textContent: "Sprint" }), sprintSel,
        el("p", { className: "hint", textContent: "L’URL indica menu, vista e progetto; il preferito aggiunge i filtri. Puoi usarli anche da soli. Con Sprint corrente o precedente, il numero salvato nel preferito viene sostituito da quello calcolato al clic." }),
        el("div", { className: "acts" }, addBtn),
        el("h4", { className: "sep", textContent: "Pulsanti" }),
        ...rows,
        el("div", { className: "acts" }, exportBtn, importBtn, resetBtn,
            el("button", { textContent: "Chiudi", onclick: () => togglePanel("buttons") })));
  }

  /* ---------- barra ---------- */
  const bar = el("div", { id: "ps-bar" });
  // riducendo la barra si chiude anche il pannello aperto
  const toggleBar = () => { if (bar.classList.toggle("min")) closePanel(); };
  const panelBtn = (kind, text, title) => {
    const b = el("button", { className: "ps-manage", textContent: text, title,
      onclick: () => togglePanel(kind).catch(fail) });
    b.dataset.panel = kind;
    return b;
  };
  function render() {
    bar.replaceChildren(
        el("button", { className: "ps-toggle", textContent: "☰", title: "Mostra/nascondi (Alt+P)", onclick: toggleBar }),
        ...buttons.map((b) => el("button", { textContent: b.label, onclick: () => open(b).catch(fail) })),
        panelBtn("bg", "🖼", "Sfondo"),
        panelBtn("ts", "⏱", "Compila fogli ore"),
        panelBtn("buttons", "+", "Aggiungi o gestisci pulsanti"));
    syncActive();
  }
  render();
  document.body.append(bar);
  document.addEventListener("keydown", (e) => {
    if (e.altKey && e.key.toLowerCase() === "p") toggleBar();
  });

  Object.assign(PS, { togglePanel });
})();
