/* Pannello "Fogli ore": crea righe ripetute su un intervallo di giorni */
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

  async function renderTs(env, panel) {
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
    const wkL = chk("Salta sabato e domenica", true);
    const hoL = chk("Salta festivi nazionali", true);
    const lvL = chk("Salta ferie e permessi approvati", true);
    const flL = chk("Salta giorni con ore già registrate", false);

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
            skipWeekend: wkL.control.checked, skipHolidays: hoL.control.checked,
            skipLeaves: lvL.control.checked, skipFilled: flL.control.checked,
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
        el("div", { className: "acts" }, el("button", { textContent: "Chiudi", onclick: () => PS.togglePanel("ts") })));

    for (const n of [tplSel, projSel, taskSel, descIn, hoursIn, fromIn, toIn,
      wkL.control, hoL.control, lvL.control, flL.control]) {
      n.addEventListener("input", invalidate);
      n.addEventListener("change", invalidate);
    }
  }

  Object.assign(PS, { renderTs });
})();
