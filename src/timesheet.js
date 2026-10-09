/* Pannello "Fogli ore": crea righe ripetute su un intervallo di giorni (da una riga o copiando un giorno) */
(() => {
  "use strict";
  const PS = window.__ps;
  if (!PS || PS.ready) return;
  const { TASK, TS_MODEL, el, fail, chk, store, evalCtx, iso, parseIso, fmtDay, fmtHours, eachDay, parseHours } = PS;

  /* ================= CONFIGURAZIONE ================= */
  const TS_ACTION = 508;          // menu Fogli ore (action= nell'URL); null per non riaprirlo
  // Festivi nazionali (MM-GG). Il 4 ottobre vale dal 2026. Pasquetta è calcolata.
  const IT_HOLIDAYS = ["01-01", "01-06", "04-25", "05-01", "06-02", "08-15", "10-04", "11-01", "12-08", "12-25", "12-26"];
  /* ================================================== */

  const STORE = store("ps-timesheet-v1", [], Array.isArray);
  const templates = STORE.load();
  const tsSave = () => STORE.save(templates);

  function easter(y) { // algoritmo di Meeus/Jones/Butcher
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    return new Date(Date.UTC(y, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1));
  }
  const pasquette = new Map();  // anno → data ISO di Pasquetta
  function isHoliday(s) {
    const year = Number(s.slice(0, 4)), md = s.slice(5);
    if (md === "10-04" && year < 2026) return false;
    if (IT_HOLIDAYS.includes(md)) return true;
    if (!pasquette.has(year)) {
      const d = easter(year);
      d.setUTCDate(d.getUTCDate() + 1);
      pasquette.set(year, iso(d));
    }
    return pasquette.get(year) === s;
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

  // ricerca dei progetti: tutte le parole, senza accenti. Primo esattamente "Progetto Omnibus",
  // poi quelli che iniziano con "Progetto"/"Progetti", poi gli altri (ognuno in ordine alfabetico)
  const FIRST_PROJECT = "progetto omnibus";
  const norm = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const projRank = (p) => {
    const n = norm(p.display_name).trim().replace(/\s+/g, " ");
    return n === FIRST_PROJECT ? 0 : /^progett[oi]\b/.test(n) ? 1 : 2;
  };
  const sortProjects = (list) => [...list].sort((a, b) => projRank(a) - projRank(b));  // stabile: resta l'ordine per nome
  const MAX_OPTS = 200;

  // campo con ricerca e elenco a discesa (frecce, Invio, Esc); onPick(progetto | null).
  // Usato anche dagli avvisi automatici (PS.projectPicker); setProjects() per un elenco caricato dopo
  function projectPicker(projects, onPick, { placeholder = "Cerca un progetto…" } = {}) {
    let sorted = sortProjects(projects);
    let cur = null, items = [], active = -1;
    const input = el("input", { placeholder, autocomplete: "off", spellcheck: false });
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-expanded", "false");
    const list = el("div", { className: "ps-combo-list", role: "listbox", hidden: true });
    const node = el("div", { className: "ps-combo" }, input, list);

    const open = (on) => { list.hidden = !on; input.setAttribute("aria-expanded", String(on)); };
    function setActive(i) {
      active = i;
      [...list.children].forEach((o, j) => o.classList.toggle("on", j === i));
      list.children[i]?.scrollIntoView({ block: "nearest" });
    }
    function pick(p, silent = false) {
      const changed = p?.id !== cur?.id;
      cur = p;
      input.value = p?.display_name || "";
      open(false);
      if (changed && !silent) onPick(p);
    }
    function render() {
      // con il nome del progetto scelto nel campo mostro tutto l'elenco
      const words = cur && input.value === cur.display_name ? [] : norm(input.value).split(/\s+/).filter(Boolean);
      items = sorted.filter((p) => words.every((w) => norm(p.display_name).includes(w))).slice(0, MAX_OPTS);
      PS.fill(list, ...(items.length
          ? items.map((p) => el("div", { className: "opt", role: "option", textContent: p.display_name,
            onmousedown: (e) => { e.preventDefault(); pick(p); } }))  // mousedown: prima che il campo perda il focus
          : [el("div", { className: "empty", textContent: "Nessun progetto trovato" })]));
      open(true);
      setActive(items.length ? Math.max(0, items.findIndex((p) => p.id === cur?.id)) : -1);
    }

    input.addEventListener("focus", () => { input.select(); render(); });
    input.addEventListener("input", render);
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (list.hidden) return render();
        if (items.length) setActive((active + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length);
      } else if (e.key === "Enter" && !list.hidden) {
        e.preventDefault();
        if (items[active]) pick(items[active]);
      } else if (e.key === "Escape" && !list.hidden) {
        e.preventDefault();
        e.stopPropagation();
        pick(cur, true);
      }
    });
    // uscendo dal campo: vuoto = nessun progetto, altrimenti torna al progetto scelto
    input.addEventListener("blur", () => { if (input.value.trim()) pick(cur, true); else pick(null); });

    return { node, get value() { return cur; }, set: (p) => pick(p, true), setProjects: (list) => { sorted = sortProjects(list); } };
  }

  const righe = (n) => `${n} ${n === 1 ? "riga" : "righe"}`;

  async function renderTs(env, panel) {
    const { orm, action } = env.services;
    PS.fill(panel, el("p", { className: "hint", textContent: "Carico i progetti…" }));
    let projects = [];
    try {
      projects = await orm.searchRead("project.project", [["allow_timesheets", "=", true]],
          ["display_name"], { order: "name" });
    } catch (e) { fail(e); }

    /* riga */
    const tplSel = el("select");
    const fillTpl = () => PS.fill(tplSel,
        el("option", { value: "", textContent: templates.length ? "Scegli una riga salvata" : "Nessuna riga salvata" }),
        ...templates.map((t, i) => el("option", { value: String(i), textContent: t.label })));
    fillTpl();
    const delTpl = el("button", {
      className: "icon", textContent: "×", title: "Elimina la riga salvata",
      onclick: async () => {
        const t = templates[tplSel.value];
        if (!t || !(await PS.ask(`Eliminare la riga salvata "${t.label}"?`, { ok: "Elimina", danger: true }))) return;
        const i = templates.indexOf(t);
        if (i >= 0) { templates.splice(i, 1); tsSave(); fillTpl(); updTpl.hidden = true; }
      },
    });
    const projSel = projectPicker(projects, (p) => { invalidate(); loadTasks(p?.id || null).catch(fail); });
    const taskSel = el("select", { disabled: true }, el("option", { value: "", textContent: "Nessuna attività" }));
    const descIn = el("input", { placeholder: "Descrizione" });
    const hoursIn = el("input", { placeholder: "8, 7,5 oppure 7:30", value: "8" });

    async function loadTasks(pid, keep = null) {
      PS.fill(taskSel, el("option", { value: "", textContent: "Nessuna attività" }));
      taskSel.disabled = !pid;
      if (!pid) return;
      const tasks = await orm.searchRead(TASK, [["project_id", "=", pid], ["stage_id.fold", "=", false]],
          ["display_name"], { order: "id desc", limit: 300 });
      if (keep && !tasks.some((t) => t.id === keep[0])) tasks.unshift({ id: keep[0], display_name: keep[1] });
      taskSel.append(...tasks.map((t) => el("option", { value: String(t.id), textContent: t.display_name })));
      taskSel.value = keep ? String(keep[0]) : "";
    }
    tplSel.onchange = () => {
      const t = templates[tplSel.value];
      updTpl.hidden = !t;
      if (!t) return;
      projSel.set(projects.find((p) => p.id === t.project[0]) || { id: t.project[0], display_name: t.project[1] });
      descIn.value = t.name || "";
      hoursIn.value = String(t.hours).replace(".", ",");
      loadTasks(t.project[0], t.task).catch(fail);
    };

    function currentRow() {
      const proj = projSel.value;
      if (!proj) throw new Error("scegli un progetto");
      const hours = parseHours(hoursIn.value);
      if (!hours) throw new Error("ore non valide (es. 8, 7,5 o 7:30)");
      const tid = Number(taskSel.value) || null;
      return {
        project: [proj.id, proj.display_name],
        task: tid ? [tid, taskSel.selectedOptions[0].textContent] : null,
        name: descIn.value.trim(),
        hours,
      };
    }
    // aggiorna la riga salvata scelta con i campi attuali (anche il nome)
    const updTpl = el("button", {
      textContent: "Aggiorna riga salvata", hidden: true,
      onclick: async () => {
        const t = templates[tplSel.value];
        if (!t) return;
        try {
          const r = currentRow();
          const label = await PS.askText(`Aggiornare "${t.label}" con progetto, attività, descrizione e ore attuali?\n\nNome della riga:`,
              t.label, { ok: "Aggiorna" });
          if (!label?.trim()) return;
          const i = templates.indexOf(t);
          if (i < 0) return;
          templates[i] = { label: label.trim(), ...r };
          tsSave(); fillTpl();
          tplSel.value = String(i);
          PS.getEnv()?.services.notification?.add(`Riga "${label.trim()}" aggiornata.`, { type: "success" });
        } catch (e) { PS.say("Impossibile aggiornare: " + e.message); }
      },
    });
    const saveTpl = el("button", {
      textContent: "Salva come nuova riga predefinita",
      onclick: async () => {
        try {
          const r = currentRow();
          const label = await PS.askText("Nome della riga", r.task?.[1] || r.project[1], { ok: "Salva" });
          if (!label?.trim()) return;
          templates.push({ label: label.trim(), ...r });
          tsSave(); fillTpl();
          tplSel.value = String(templates.length - 1);
          updTpl.hidden = false;
        } catch (e) { PS.say("Impossibile salvare: " + e.message); }
      },
    });

    /* copia un giorno: le righe di un giorno già compilato, da replicare nei giorni scelti */
    let mode = "row";  // "row" = la riga qui sopra, "copy" = le righe di un giorno
    let srcLines = [], srcSeq = 0;
    const srcIn = el("input", { type: "date", value: iso(new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()))) });
    const srcBox = el("div", { className: "ps-ts-src" });
    async function loadSource() {
      const my = ++srcSeq;
      srcLines = [];
      if (!srcIn.value) { PS.fill(srcBox, el("p", { className: "hint", textContent: "Scegli il giorno da copiare." })); return; }
      PS.fill(srcBox, el("p", { className: "hint", textContent: "Leggo le righe…" }));
      const lines = await orm.searchRead(TS_MODEL, [
        ["user_id", "=", evalCtx(env).uid], ["project_id", "!=", false], ["date", "=", srcIn.value],
      ], ["project_id", "task_id", "name", "unit_amount"], { order: "id" });
      if (my !== srcSeq) return;
      srcLines = lines.map((l) => ({ on: true, project: l.project_id, task: l.task_id || null,
        name: l.name && l.name !== "/" ? l.name : "", hours: l.unit_amount }));
      drawSource();
    }
    function drawSource() {
      if (!srcLines.length) {
        PS.fill(srcBox, el("p", { className: "hint", textContent: `Nessuna riga il ${fmtDay(srcIn.value)}.` }));
        return;
      }
      const tot = srcLines.filter((l) => l.on).reduce((a, l) => a + l.hours, 0);
      PS.fill(srcBox,
          ...srcLines.map((l) => {
            const c = el("input", { type: "checkbox", checked: l.on });
            c.onchange = () => { l.on = c.checked; invalidate(); drawSource(); };
            return el("label", { className: `ps-ts-line${l.on ? "" : " off"}` }, c,
                el("span", { className: "what" },
                    el("strong", { textContent: l.task?.[1] || l.project[1] }),
                    el("small", { textContent: [l.task ? l.project[1] : null, l.name].filter(Boolean).join(" · ") })),
                el("span", { className: "h", textContent: `${fmtHours(l.hours)} h` }));
          }),
          el("p", { className: "hint", textContent: `Da copiare: ${fmtHours(tot)} h al giorno.` }));
    }
    srcIn.addEventListener("change", () => { invalidate(); loadSource().catch(fail); });

    // righe da creare in ogni giorno, secondo la modalità
    function dayRows() {
      if (mode === "row") return [currentRow()];
      const rows = srcLines.filter((l) => l.on);
      if (!rows.length) throw new Error(srcLines.length ? "spunta almeno una riga da copiare" : "nel giorno scelto non ci sono righe da copiare");
      return rows;
    }

    /* giorni */
    const now = new Date();
    const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const monday = new Date(today);
    monday.setUTCDate(today.getUTCDate() - ((today.getUTCDay() + 6) % 7));
    const friday = new Date(monday);
    friday.setUTCDate(monday.getUTCDate() + 4);
    const fromIn = el("input", { type: "date", value: iso(monday) });
    const toIn = el("input", { type: "date", value: iso(friday) });
    const wkL = chk("Salta sabato e domenica", true);
    const hoL = chk("Salta festivi nazionali", true);
    const lvL = chk("Salta ferie e permessi approvati", true);
    const flL = chk("Salta giorni con ore già registrate", false);

    const preview = el("div");
    const createBtn = el("button", { className: "primary", textContent: "Crea righe", disabled: true });
    let plan = null, rows = null, lastIds = null;
    let excluded = new Set();  // giorni tolti a mano dall'anteprima (clic sulla ×)

    const invalidate = () => { plan = null; excluded = new Set(); createBtn.disabled = true; createBtn.textContent = "Crea righe"; };
    const activeDays = () => (plan ? plan.todo.filter((d) => !excluded.has(d)) : []);

    // anteprima: un chip per giorno con la × per escluderlo (di nuovo clic per rimetterlo)
    function drawPreview() {
      const days = activeDays(), perDay = rows.reduce((a, r) => a + r.hours, 0), n = days.length * rows.length;
      const s = plan.skipped;
      const skippedTxt = [[s.weekend, "weekend"], [s.holiday, "festivi"], [s.leave, "ferie"], [s.filled, "già compilati"],
        [s.source, "giorno copiato"], [[...excluded], "esclusi a mano"]]
          .filter(([a]) => a.length).map(([a, t]) => `${a.length} ${t}`).join(", ");
      const what = rows.length === 1 ? `${righe(n)} da ${fmtHours(perDay)} h`
        : `${days.length} ${days.length === 1 ? "giorno" : "giorni"} × ${righe(rows.length)} = ${righe(n)}`;
      PS.fill(preview,
          el("p", { className: "hint", textContent: `${what}, totale ${fmtHours(perDay * days.length)} h.` +
                (skippedTxt ? ` Saltati: ${skippedTxt}.` : "") }),
          plan.leaveError ? el("p", { className: "warn", textContent: "Ferie non verificate: " + plan.leaveError }) : null,
          el("div", { className: "days" }, ...plan.todo.map((d) => {
            const off = excluded.has(d);
            const b = el("button", { type: "button", className: `ps-day${off ? " off" : ""}`,
              title: off ? "Clic per rimetterlo" : "Clic per escludere questo giorno",
              onclick: () => {
                if (!plan) return;  // anteprima superata da una modifica: va rifatta
                if (off) excluded.delete(d); else excluded.add(d);
                drawPreview();
              } },
                el("span", { textContent: fmtDay(d) }), el("span", { className: "x", textContent: off ? "+" : "×" }));
            b.setAttribute("aria-pressed", String(!off));
            return b;
          })),
          days.length < plan.todo.length ? null
            : el("p", { className: "hint", textContent: "Clic sulla × di un giorno per escluderlo." }));
      createBtn.disabled = !n;
      createBtn.textContent = n ? `Crea ${righe(n)}` : "Nessun giorno da compilare";
    }

    const previewBtn = el("button", {
      textContent: "Anteprima",
      onclick: async () => {
        try {
          rows = dayRows();
          if (!fromIn.value || !toIn.value || fromIn.value > toIn.value) throw new Error("intervallo di date non valido");
          plan = await planDays(env, {
            from: fromIn.value, to: toIn.value,
            skipWeekend: wkL.control.checked, skipHolidays: hoL.control.checked,
            skipLeaves: lvL.control.checked, skipFilled: flL.control.checked,
          });
          // copiando, il giorno di origine non si ricopia su se stesso
          plan.skipped.source = mode === "copy" ? plan.todo.filter((d) => d === srcIn.value) : [];
          if (mode === "copy") plan.todo = plan.todo.filter((d) => d !== srcIn.value);
          excluded = new Set();
          drawPreview();
        } catch (e) {
          invalidate();
          PS.say("Anteprima non riuscita: " + (e?.data?.message || e.message));
        }
      },
    });

    const reopen = () => (TS_ACTION ? action.doAction(TS_ACTION, { viewType: "grid", clearBreadcrumbs: true }) : null);

    async function undo() {
      if (!lastIds?.length) return;
      const msg = lastIds.length === 1 ? "Eliminare la riga appena creata?" : `Eliminare le ${lastIds.length} righe appena create?`;
      if (!(await PS.ask(msg, { ok: "Elimina", danger: true }))) return;
      try {
        await orm.unlink(TS_MODEL, lastIds);
        lastIds = null;
        PS.fill(preview, el("p", { className: "hint", textContent: "Inserimento annullato." }));
        await reopen();
      } catch (e) { fail(e); }
    }

    createBtn.onclick = async () => {
      const days = activeDays();
      if (!days.length || !rows?.length) return;
      const n = days.length * rows.length;
      if (!(await PS.ask(`Creare ${righe(n)} di foglio ore?`, { ok: "Crea" }))) return;
      createBtn.disabled = true;
      try {
        lastIds = await orm.create(TS_MODEL, days.flatMap((date) => rows.map((r) => ({
          date,
          project_id: r.project[0],
          task_id: r.task?.[0] || false,
          name: r.name || "/",
          unit_amount: r.hours,
        }))));
        PS.fill(preview,
            el("p", { className: "hint", textContent: lastIds.length === 1 ? "Creata 1 riga." : `Create ${lastIds.length} righe.` }),
            el("div", { className: "acts" }, el("button", { textContent: "Annulla inserimento", onclick: undo })));
        invalidate();
        await reopen();
      } catch (e) { fail(e); createBtn.disabled = false; }
    };

    const rowPart = el("div", {},
        el("label", { textContent: "Riga salvata" }), el("div", { className: "inline" }, tplSel, delTpl),
        el("label", { textContent: "Progetto" }), projSel.node,
        el("label", { textContent: "Attività" }), taskSel,
        el("label", { textContent: "Descrizione" }), descIn,
        el("label", { textContent: "Ore al giorno" }), hoursIn,
        el("div", { className: "acts" }, updTpl, saveTpl));
    const copyPart = el("div", { hidden: true },
        el("label", { textContent: "Giorno da copiare" }), srcIn,
        srcBox,
        el("p", { className: "hint", textContent: "Le righe spuntate vengono copiate in ogni giorno scelto qui sotto." }));
    const seg = el("div", { className: "ps-seg" });
    function drawSeg() {
      PS.fill(seg, ...[["row", "Una riga"], ["copy", "Copia un giorno"]].map(([k, label]) => el("button", {
        type: "button", className: k === mode ? "on" : "", textContent: label,
        onclick: () => {
          if (mode === k) return;
          mode = k;
          rowPart.hidden = k !== "row";
          copyPart.hidden = k !== "copy";
          invalidate();
          PS.fill(preview);
          drawSeg();
          if (k === "copy" && !srcLines.length) loadSource().catch(fail);
        } })));
    }
    drawSeg();

    PS.fill(panel,
        el("h4", { textContent: "Fogli ore" }),
        seg,
        rowPart,
        copyPart,
        el("h4", { className: "sep", textContent: "Giorni" }),
        el("div", { className: "two" },
            el("div", {}, el("label", { textContent: "Dal" }), fromIn),
            el("div", {}, el("label", { textContent: "Al" }), toIn)),
        wkL, hoL, lvL, flL,
        el("div", { className: "acts" }, previewBtn, createBtn),
        preview,
        el("div", { className: "acts" }, el("button", { textContent: "Chiudi", onclick: () => PS.togglePanel("ts") })));

    for (const n of [tplSel, taskSel, descIn, hoursIn, fromIn, toIn,
      wkL.control, hoL.control, lvL.control, flL.control]) {
      n.addEventListener("input", invalidate);
      n.addEventListener("change", invalidate);
    }
  }

  Object.assign(PS, { renderTs, projectPicker });
})();
