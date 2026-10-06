(() => {
  "use strict";
  if (document.getElementById("ps-bar")) return;

  /* ================= CONFIGURAZIONE ================= */
  const SPRINT_FIELD = "sprint";   // campo intero su project.task
  const TASK = "project.task";
  const KEY = "ps-buttons-v1";     // chiave localStorage
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

  const getEnv = () => window.odoo?.__WOWL_DEBUG__?.root?.env;
  const mod = (name) => window.odoo?.loader?.modules?.get(name);
  const Domain = () => mod("@web/core/domain").Domain;
  const el = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    n.append(...kids.filter((k) => k != null));
    return n;
  };
  const sprintLabel = (s) => ({ 0: "sprint corrente", 1: "sprint precedente" }[s] ?? `${s} sprint fa`);
  const viewName = (m) => VIEW_NAMES[m] || m;
  const fail = (e) => alert("Errore: " + (e?.data?.message || e?.message || e));

  /* ---------- persistenza ---------- */
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY));
      return Array.isArray(v) ? v : structuredClone(DEFAULTS);
    } catch { return structuredClone(DEFAULTS); }
  }
  let buttons = load();
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(buttons)); }
    catch (e) { alert("Salvataggio non riuscito: " + e.message); }
    render();
  }

  /* ---------- logica Odoo ---------- */
  function evalCtx(env, b = {}) {
    const uid = env.services.user?.userId ?? odoo.__session_info__?.uid;
    const c = { ...(env.services.user?.context || {}), uid };
    if (b.activeId) Object.assign(c, { active_id: b.activeId, active_ids: [b.activeId] });
    return c;
  }

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

  // n-esimo valore distinto di sprint partendo dal più alto
  async function sprintValue(orm, offset) {
    let val;
    for (let i = 0; i <= offset; i++) {
      const dom = [[SPRINT_FIELD, "!=", false]];
      if (val !== undefined) dom.push([SPRINT_FIELD, "<", val]);
      const r = await orm.searchRead(TASK, dom, [SPRINT_FIELD], { order: `${SPRINT_FIELD} desc`, limit: 1 });
      if (!r.length) return null;
      val = r[0][SPRINT_FIELD];
    }
    return val;
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
  let panel = null;
  async function togglePanel() {
    if (panel) { panel.remove(); panel = null; return; }
    const env = getEnv();
    if (!env) return alert("Odoo non ancora caricato: riprova tra un secondo.");
    panel = el("div", { id: "ps-panel" });
    document.body.append(panel);
    await renderPanel(env);
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
          save(); renderPanel(env);
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
          onclick: () => { [buttons[i - 1], buttons[i]] = [buttons[i], buttons[i - 1]]; save(); renderPanel(env); },
        }),
        el("button", {
          className: "icon", textContent: "✎", title: "Rinomina",
          onclick: () => {
            const v = prompt("Nuovo nome", b.label);
            if (v?.trim()) { b.label = v.trim(); save(); renderPanel(env); }
          },
        }),
        el("button", {
          className: "icon", textContent: "×", title: "Elimina",
          onclick: () => { if (confirm(`Eliminare "${b.label}"?`)) { buttons.splice(i, 1); save(); renderPanel(env); } },
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
          buttons = v; save(); renderPanel(env);
        } catch (e) { alert("Importazione non riuscita: " + e.message); }
      },
    });
    const resetBtn = el("button", {
      textContent: "Ripristina predefiniti",
      onclick: () => {
        if (confirm("Sostituire tutti i pulsanti con quelli predefiniti?")) {
          buttons = structuredClone(DEFAULTS); save(); renderPanel(env);
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
        el("button", { textContent: "Chiudi", onclick: togglePanel })));
  }

  /* ---------- barra ---------- */
  document.head.append(el("style", { textContent: `
    #ps-bar{position:fixed;left:12px;bottom:12px;z-index:9999;display:flex;flex-wrap:wrap;gap:6px;
      max-width:calc(100vw - 24px);padding:6px;border-radius:10px;background:#262a36;
      box-shadow:0 2px 10px #0006;font:500 13px/1 system-ui,sans-serif}
    #ps-bar button,#ps-panel button{border:0;border-radius:6px;padding:8px 12px;cursor:pointer;
      background:#3a3f4d;color:#e6e6ea;font:inherit}
    #ps-bar button:hover,#ps-panel button:hover:not(:disabled){background:#714b67;color:#fff}
    #ps-bar button:focus-visible,#ps-panel :focus-visible{outline:2px solid #017e84;outline-offset:1px}
    #ps-bar .ps-toggle,#ps-bar .ps-manage{background:transparent;padding:8px 8px}
    #ps-bar.min button:not(.ps-toggle){display:none}
    #ps-panel{position:fixed;left:12px;bottom:64px;z-index:9999;width:420px;max-width:calc(100vw - 24px);
      max-height:70vh;overflow:auto;box-sizing:border-box;padding:14px;border-radius:10px;
      background:#262a36;color:#e6e6ea;box-shadow:0 4px 18px #0009;font:13px/1.4 system-ui,sans-serif}
    #ps-panel h4{margin:0 0 6px;font-size:14px;font-weight:600;color:#fff}
    #ps-panel h4.sep{margin-top:16px}
    #ps-panel label{display:block;margin:8px 0 3px;color:#b8bac4}
    #ps-panel select,#ps-panel input{width:100%;box-sizing:border-box;padding:7px;border-radius:6px;
      border:1px solid #4a5060;background:#1d2029;color:#e6e6ea;font:inherit}
    #ps-panel select.mini{width:auto;padding:4px 6px}
    #ps-panel select:disabled{opacity:.5}
    #ps-panel .hint{margin:6px 0 0;color:#8d90a0;font-size:12px}
    #ps-panel .acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
    #ps-panel .primary{background:#714b67;color:#fff}
    #ps-panel .row{display:flex;align-items:center;gap:4px;padding:5px 0;border-top:1px solid #3a3f4d}
    #ps-panel .row span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #ps-panel .icon{padding:4px 9px}
    #ps-panel button:disabled{opacity:.35;cursor:default}
  ` }));

  const bar = el("div", { id: "ps-bar" });
  function render() {
    bar.replaceChildren(
      el("button", { className: "ps-toggle", textContent: "☰", title: "Mostra/nascondi (Alt+P)",
        onclick: () => bar.classList.toggle("min") }),
      ...buttons.map((b) => el("button", { textContent: b.label, onclick: () => open(b).catch(fail) })),
      el("button", { className: "ps-manage", textContent: "+", title: "Aggiungi o gestisci pulsanti",
        onclick: () => togglePanel().catch(fail) }));
  }
  render();
  document.body.append(bar);
  document.addEventListener("keydown", (e) => {
    if (e.altKey && e.key.toLowerCase() === "p") bar.classList.toggle("min");
  });
  console.log("[pulsantiera] caricata", location.href);
})();
