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
  let panel = null, panelKind = null;
  async function togglePanel(kind = "buttons") {
    const same = panel && panelKind === kind;
    if (panel) { panel.remove(); panel = null; panelKind = null; }
    if (same) return;
    const env = getEnv();
    if (!env) return alert("Odoo non ancora caricato: riprova tra un secondo.");
    panel = el("div", { id: "ps-panel" });
    panelKind = kind;
    document.body.append(panel);
    await (kind === "ts" ? renderTs(env) : renderPanel(env));
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
            el("button", { textContent: "Chiudi", onclick: () => togglePanel("buttons") })));
  }

  /* ---------- fogli ore ---------- */
  const TS_MODEL = "account.analytic.line";
  const TS_ACTION = 508;          // menu Fogli ore (action= nell'URL); null per non riaprirlo
  const TS_KEY = "ps-timesheet-v1";
  // Festivi nazionali (MM-GG). Il 4 ottobre vale dal 2026. Pasquetta è calcolata.
  const IT_HOLIDAYS = ["01-01", "01-06", "04-25", "05-01", "06-02", "08-15", "10-04", "11-01", "12-08", "12-25", "12-26"];

  let templates = (() => {
    try { const v = JSON.parse(localStorage.getItem(TS_KEY)); return Array.isArray(v) ? v : []; }
    catch { return []; }
  })();
  const tsSave = () => {
    try { localStorage.setItem(TS_KEY, JSON.stringify(templates)); }
    catch (e) { alert("Salvataggio non riuscito: " + e.message); }
  };

  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const parseIso = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const fmtDay = (s) => parseIso(s).toLocaleDateString("it-IT",
      { weekday: "short", day: "numeric", month: "numeric", timeZone: "UTC" });
  const fmtHours = (h) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)}:${pad(m % 60)}`; };
  function* eachDay(from, to) {
    for (let d = parseIso(from); iso(d) <= to; d.setUTCDate(d.getUTCDate() + 1)) yield iso(d);
  }

  function easter(y) { // algoritmo di Meeus/Jones/Butcher
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    return new Date(Date.UTC(y, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1));
  }
  function isHoliday(s) {
    const year = Number(s.slice(0, 4)), md = s.slice(5);
    if (md === "10-04" && year < 2026) return false;
    if (IT_HOLIDAYS.includes(md)) return true;
    const pasquetta = easter(year);
    pasquetta.setUTCDate(pasquetta.getUTCDate() + 1);
    return iso(pasquetta) === s;
  }
  function parseHours(str) {
    const s = String(str).trim().replace(",", ".");
    const m = s.match(/^(\d{1,2}):([0-5]\d)$/);
    const h = m ? Number(m[1]) + Number(m[2]) / 60 : Number(s);
    return s && Number.isFinite(h) && h > 0 && h <= 24 ? h : null;
  }

  async function planDays(env, o) {
    const { orm } = env.services;
    const uid = evalCtx(env).uid;
    const days = [...eachDay(o.from, o.to)];
    if (days.length > 93) throw new Error("intervallo troppo lungo (massimo 3 mesi)");

    const leaveDays = new Set(), filledDays = new Set();
    let leaveError = null;
    if (o.skipLeaves) {
      try {
        const leaves = await orm.searchRead("hr.leave", [
          ["employee_id.user_id", "=", uid], ["state", "=", "validate"],
          ["request_date_from", "<=", o.to], ["request_date_to", ">=", o.from],
        ], ["request_date_from", "request_date_to"]);
        for (const l of leaves) for (const d of eachDay(l.request_date_from, l.request_date_to)) leaveDays.add(d);
      } catch (e) { leaveError = e?.data?.message || e.message; }
    }
    if (o.skipFilled) {
      const lines = await orm.searchRead(TS_MODEL, [
        ["user_id", "=", uid], ["project_id", "!=", false], ["date", ">=", o.from], ["date", "<=", o.to],
      ], ["date"]);
      lines.forEach((l) => filledDays.add(l.date));
    }

    const skipped = { weekend: [], holiday: [], leave: [], filled: [] };
    const todo = [];
    for (const s of days) {
      const wd = parseIso(s).getUTCDay();
      if (o.skipWeekend && (wd === 0 || wd === 6)) skipped.weekend.push(s);
      else if (o.skipHolidays && isHoliday(s)) skipped.holiday.push(s);
      else if (leaveDays.has(s)) skipped.leave.push(s);
      else if (filledDays.has(s)) skipped.filled.push(s);
      else todo.push(s);
    }
    return { todo, skipped, leaveError };
  }

  async function renderTs(env) {
    const { orm, action } = env.services;
    panel.replaceChildren(el("p", { className: "hint", textContent: "Carico i progetti…" }));
    let projects = [];
    try {
      projects = await orm.searchRead("project.project", [["allow_timesheets", "=", true]],
          ["display_name"], { order: "name" });
    } catch (e) { fail(e); }

    /* riga */
    const tplSel = el("select");
    const fillTpl = () => tplSel.replaceChildren(
        el("option", { value: "", textContent: templates.length ? "Scegli una riga salvata" : "Nessuna riga salvata" }),
        ...templates.map((t, i) => el("option", { value: String(i), textContent: t.label })));
    fillTpl();
    const delTpl = el("button", {
      className: "icon", textContent: "×", title: "Elimina la riga salvata",
      onclick: () => {
        const t = templates[tplSel.value];
        if (t && confirm(`Eliminare "${t.label}"?`)) { templates.splice(Number(tplSel.value), 1); tsSave(); fillTpl(); }
      },
    });
    const projSel = el("select", {},
        el("option", { value: "", textContent: "Scegli un progetto" }),
        ...projects.map((p) => el("option", { value: String(p.id), textContent: p.display_name })));
    const taskSel = el("select", { disabled: true }, el("option", { value: "", textContent: "Nessuna attività" }));
    const descIn = el("input", { placeholder: "Descrizione" });
    const hoursIn = el("input", { placeholder: "8, 7,5 oppure 7:30", value: "8" });

    async function loadTasks(pid, keep = null) {
      taskSel.replaceChildren(el("option", { value: "", textContent: "Nessuna attività" }));
      taskSel.disabled = !pid;
      if (!pid) return;
      const tasks = await orm.searchRead(TASK, [["project_id", "=", pid], ["stage_id.fold", "=", false]],
          ["display_name"], { order: "id desc", limit: 300 });
      if (keep && !tasks.some((t) => t.id === keep[0])) tasks.unshift({ id: keep[0], display_name: keep[1] });
      taskSel.append(...tasks.map((t) => el("option", { value: String(t.id), textContent: t.display_name })));
      taskSel.value = keep ? String(keep[0]) : "";
    }
    projSel.onchange = () => loadTasks(Number(projSel.value) || null).catch(fail);
    tplSel.onchange = () => {
      const t = templates[tplSel.value];
      if (!t) return;
      if (!projects.some((p) => p.id === t.project[0]))
        projSel.append(el("option", { value: String(t.project[0]), textContent: t.project[1] }));
      projSel.value = String(t.project[0]);
      descIn.value = t.name || "";
      hoursIn.value = String(t.hours).replace(".", ",");
      loadTasks(t.project[0], t.task).catch(fail);
    };

    function currentRow() {
      const pid = Number(projSel.value);
      if (!pid) throw new Error("scegli un progetto");
      const hours = parseHours(hoursIn.value);
      if (!hours) throw new Error("ore non valide (es. 8, 7,5 o 7:30)");
      const tid = Number(taskSel.value) || null;
      return {
        project: [pid, projSel.selectedOptions[0].textContent],
        task: tid ? [tid, taskSel.selectedOptions[0].textContent] : null,
        name: descIn.value.trim(),
        hours,
      };
    }
    const saveTpl = el("button", {
      textContent: "Salva come riga predefinita",
      onclick: () => {
        try {
          const r = currentRow();
          const label = prompt("Nome della riga", r.task?.[1] || r.project[1]);
          if (!label?.trim()) return;
          templates.push({ label: label.trim(), ...r });
          tsSave(); fillTpl();
          tplSel.value = String(templates.length - 1);
        } catch (e) { alert("Impossibile salvare: " + e.message); }
      },
    });

    /* giorni */
    const now = new Date();
    const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const monday = new Date(today);
    monday.setUTCDate(today.getUTCDate() - ((today.getUTCDay() + 6) % 7));
    const friday = new Date(monday);
    friday.setUTCDate(monday.getUTCDate() + 4);
    const fromIn = el("input", { type: "date", value: iso(monday) });
    const toIn = el("input", { type: "date", value: iso(friday) });
    const chk = (text, checked) => {
      const i = el("input", { type: "checkbox", checked });
      return [i, el("label", { className: "chk" }, i, text)];
    };
    const [wkIn, wkL] = chk("Salta sabato e domenica", true);
    const [hoIn, hoL] = chk("Salta festivi nazionali", true);
    const [lvIn, lvL] = chk("Salta ferie e permessi approvati", true);
    const [flIn, flL] = chk("Salta giorni con ore già registrate", false);

    const preview = el("div");
    const createBtn = el("button", { className: "primary", textContent: "Crea righe", disabled: true });
    let plan = null, row = null, lastIds = null;

    const invalidate = () => { plan = null; createBtn.disabled = true; createBtn.textContent = "Crea righe"; };

    const previewBtn = el("button", {
      textContent: "Anteprima",
      onclick: async () => {
        try {
          row = currentRow();
          if (!fromIn.value || !toIn.value || fromIn.value > toIn.value) throw new Error("intervallo di date non valido");
          plan = await planDays(env, {
            from: fromIn.value, to: toIn.value,
            skipWeekend: wkIn.checked, skipHolidays: hoIn.checked, skipLeaves: lvIn.checked, skipFilled: flIn.checked,
          });
          const s = plan.skipped;
          const skippedTxt = [[s.weekend, "weekend"], [s.holiday, "festivi"], [s.leave, "ferie"], [s.filled, "già compilati"]]
              .filter(([a]) => a.length).map(([a, t]) => `${a.length} ${t}`).join(", ");
          preview.replaceChildren(
              el("p", { className: "hint", textContent:
                    `${plan.todo.length} righe da ${fmtHours(row.hours)} h, totale ${fmtHours(row.hours * plan.todo.length)} h.` +
                    (skippedTxt ? ` Saltati: ${skippedTxt}.` : "") }),
              plan.leaveError ? el("p", { className: "warn", textContent: "Ferie non verificate: " + plan.leaveError }) : null,
              el("div", { className: "days" }, ...plan.todo.map((d) => el("span", { textContent: fmtDay(d) }))));
          createBtn.disabled = !plan.todo.length;
          createBtn.textContent = plan.todo.length ? `Crea ${plan.todo.length} righe` : "Nessun giorno da compilare";
        } catch (e) {
          invalidate();
          alert("Anteprima non riuscita: " + (e?.data?.message || e.message));
        }
      },
    });

    const reopen = () => (TS_ACTION ? action.doAction(TS_ACTION, { viewType: "grid", clearBreadcrumbs: true }) : null);

    async function undo() {
      if (!lastIds?.length || !confirm(`Eliminare le ${lastIds.length} righe appena create?`)) return;
      try {
        await orm.unlink(TS_MODEL, lastIds);
        lastIds = null;
        preview.replaceChildren(el("p", { className: "hint", textContent: "Inserimento annullato." }));
        await reopen();
      } catch (e) { fail(e); }
    }

    createBtn.onclick = async () => {
      if (!plan?.todo.length || !row) return;
      if (!confirm(`Creare ${plan.todo.length} righe di foglio ore?`)) return;
      createBtn.disabled = true;
      try {
        lastIds = await orm.create(TS_MODEL, plan.todo.map((date) => ({
          date,
          project_id: row.project[0],
          task_id: row.task?.[0] || false,
          name: row.name || "/",
          unit_amount: row.hours,
        })));
        preview.replaceChildren(
            el("p", { className: "hint", textContent: `Create ${lastIds.length} righe.` }),
            el("div", { className: "acts" }, el("button", { textContent: "Annulla inserimento", onclick: undo })));
        invalidate();
        await reopen();
      } catch (e) { fail(e); createBtn.disabled = false; }
    };

    panel.replaceChildren(
        el("h4", { textContent: "Fogli ore" }),
        el("label", { textContent: "Riga salvata" }), el("div", { className: "inline" }, tplSel, delTpl),
        el("label", { textContent: "Progetto" }), projSel,
        el("label", { textContent: "Attività" }), taskSel,
        el("label", { textContent: "Descrizione" }), descIn,
        el("label", { textContent: "Ore al giorno" }), hoursIn,
        el("div", { className: "acts" }, saveTpl),
        el("h4", { className: "sep", textContent: "Giorni" }),
        el("div", { className: "two" },
            el("div", {}, el("label", { textContent: "Dal" }), fromIn),
            el("div", {}, el("label", { textContent: "Al" }), toIn)),
        wkL, hoL, lvL, flL,
        el("div", { className: "acts" }, previewBtn, createBtn),
        preview,
        el("div", { className: "acts" }, el("button", { textContent: "Chiudi", onclick: () => togglePanel("ts") })));

    for (const n of [tplSel, projSel, taskSel, descIn, hoursIn, fromIn, toIn, wkIn, hoIn, lvIn, flIn]) {
      n.addEventListener("input", invalidate);
      n.addEventListener("change", invalidate);
    }
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
    #ps-panel{color-scheme:dark}
    #ps-panel label.chk{display:flex;align-items:center;gap:8px;margin:6px 0;color:#e6e6ea;cursor:pointer}
    #ps-panel label.chk input{width:auto;margin:0}
    #ps-panel .inline{display:flex;gap:6px}
    #ps-panel .inline select{flex:1}
    #ps-panel .two{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    #ps-panel .days{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
    #ps-panel .days span{padding:2px 7px;border-radius:4px;background:#1d2029;font-size:12px}
    #ps-panel .warn{margin:6px 0 0;color:#e5a55d;font-size:12px}
  ` }));

  const bar = el("div", { id: "ps-bar" });
  function render() {
    bar.replaceChildren(
        el("button", { className: "ps-toggle", textContent: "☰", title: "Mostra/nascondi (Alt+P)",
          onclick: () => bar.classList.toggle("min") }),
        ...buttons.map((b) => el("button", { textContent: b.label, onclick: () => open(b).catch(fail) })),
        el("button", { className: "ps-manage", textContent: "⏱", title: "Compila fogli ore",
          onclick: () => togglePanel("ts").catch(fail) }),
        el("button", { className: "ps-manage", textContent: "+", title: "Aggiungi o gestisci pulsanti",
          onclick: () => togglePanel("buttons").catch(fail) }));
  }
  render();
  document.body.append(bar);
  document.addEventListener("keydown", (e) => {
    if (e.altKey && e.key.toLowerCase() === "p") bar.classList.toggle("min");
  });
  console.log("[pulsantiera] caricata", location.href);
})();