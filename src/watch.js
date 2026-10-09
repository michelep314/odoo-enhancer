/* Avvisi automatici (scheda "Avvisi" nel pannello note): notifica quando una scheda di progetto entra in una
   colonna (creata lì o spostata lì: progetto, colonna, sprint, US facoltativi) o quando si apre un nuovo ticket */
(() => {
  "use strict";
  const PS = window.__ps;
  if (!PS || PS.ready) return;
  const { el, fail, chk, store, getEnv, evalCtx, TASK, SPRINT_FIELD, sprintValue, PRIO, PRIO_ORDER, prioHex } = PS;

  const TICKET = "helpdesk.ticket";
  const POLL_MS = 60000;  // giro dell'orologio: ogni regola però si controlla solo ogni "every" minuti
  const EVERY = [1, 5, 15, 30, 60];
  const DEFAULT_EVERY = 5;
  const everyOf = (r) => (EVERY.includes(r.every) ? r.every : DEFAULT_EVERY);
  const everyText = (m) => (m === 60 ? "ogni ora" : m === 1 ? "ogni minuto" : `ogni ${m} min`);
  const MAX_IDS = 2000;  // schede ricordate per regola (le più recenti)

  // regola = { id, kind: "task" | "ticket", on, name, every (minuti tra un controllo e l'altro),
  //   task:   project: [id, nome] | null, stage: [id, nome] | null, sprint: "any" | "cur" | "curprev", us, mine,
  //           prios: ["high", "medium", …] (priorità dell'estensione, dal colore; vuoto = tutte)
  //   ticket: team: [id, nome] | null, unassigned, tprios: ["2", "3", …] (campo priority del ticket; vuoto = tutte)
  //   stato:  seen: [id] (schede già nella colonna) | null, since: "AAAA-MM-GG HH:MM:SS" (ultimo ticket visto) | null }
  const STORE = store("ps-watch-v1", { rules: [] }, (v) => v && Array.isArray(v.rules));
  const load = () => STORE.load().rules;
  function mutate(fn) {
    const rules = load();
    fn(rules);
    STORE.save({ rules });
  }
  const watchCount = () => load().filter((r) => r.on).length;

  const sprintText = { any: "", cur: "sprint corrente", curprev: "sprint corrente o precedente" };
  // priorità dei ticket: etichette lette da Odoo (fields_get), con queste come riserva
  let ticketPrios = [["0", "Bassa"], ["1", "Media"], ["2", "Alta"], ["3", "Urgente"]];
  const orList = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} o ${xs[xs.length - 1]}` : xs[0]);
  const prioText = (r) => {
    if (r.kind === "ticket") {
      const names = (r.tprios || []).map((v) => ticketPrios.find(([k]) => k === v)?.[1] || v);
      return names.length ? `priorità ${orList(names)}` : null;
    }
    const names = (r.prios || []).filter((k) => PRIO[k]).map((k) => PRIO[k].label);
    return names.length ? `priorità ${orList(names)}` : null;
  };
  function describe(r) {
    if (r.kind === "ticket") {
      return ["Nuovo ticket", r.team ? `team ${r.team[1]}` : "tutti i team", r.unassigned ? "non assegnato" : null, prioText(r)]
          .filter(Boolean).join(" · ");
    }
    return ["Nuova scheda", r.project?.[1] || "tutti i progetti", r.stage ? `colonna ${r.stage[1]}` : null,
      sprintText[r.sprint] || null, r.us ? `US ${r.us}` : null, prioText(r), r.mine ? "assegnata a me" : null].filter(Boolean).join(" · ");
  }

  /* ---------- controllo periodico (una sola scheda del browser alla volta) ---------- */
  const LOCK = "ps-watch-lock";
  function takeLock() {
    const now = Date.now();
    try {
      if (now - Number(localStorage.getItem(LOCK) || 0) < POLL_MS - 5000) return false;
      localStorage.setItem(LOCK, String(now));
    } catch { /* senza localStorage controllo comunque */ }
    return true;
  }

  // sprint corrente e precedente: ricalcolati al massimo ogni 10 minuti (cambiano di rado, risparmio chiamate)
  let sprintCache = null;
  function sprints(orm) {
    if (!sprintCache || Date.now() - sprintCache.t > 600000) {
      sprintCache = { t: Date.now(), p: Promise.all([sprintValue(orm, 0), sprintValue(orm, 1)]) };
      sprintCache.p.catch(() => { sprintCache = null; });
    }
    return sprintCache.p;
  }

  async function taskDomain(orm, r) {
    const dom = [];
    if (r.project) dom.push(["project_id", "=", r.project[0]]);
    if (r.stage) dom.push(["stage_id", "=", r.stage[0]]);
    if (r.sprint !== "any") {
      const [cur, prev] = await sprints(orm);
      const ok = (r.sprint === "curprev" ? [cur, prev] : [cur]).filter((v) => v != null);
      if (!ok.length) return null;
      dom.push([SPRINT_FIELD, "in", ok]);
    }
    if (r.us) {
      // la US può stare in un campo della scheda (se noto), tra le etichette o nel titolo
      const alts = [["tag_ids.name", "=ilike", r.us], ["name", "ilike", r.us]];
      if (r.usField) alts.push([r.usField, "ilike", r.us]);
      dom.push(...Array(alts.length - 1).fill("|"), ...alts);
    }
    if (r.mine) dom.push(["user_ids", "in", [evalCtx(getEnv()).uid]]);
    // priorità = colori della scheda (letti adesso: valgono anche le priorità personalizzate dopo)
    const prios = (r.prios || []).filter((k) => PRIO[k]);
    if (prios.length) dom.push(["color", "in", [...new Set(prios.flatMap((k) => PRIO[k].colors))]]);
    return dom;
  }

  // schede ora nella colonna: quelle non viste al giro prima sono "nuove" (create o spostate lì)
  async function checkTask(orm, r, uid) {
    const dom = await taskDomain(orm, r);
    if (!dom) return null;
    const rows = await orm.searchRead(TASK, dom, ["display_name", "write_uid"], { limit: MAX_IDS, order: "id desc" });
    const ids = rows.map((x) => x.id);
    if (!r.seen) return { seen: ids, fresh: [] };  // primo giro: solo la fotografia, nessun avviso
    const before = new Set(r.seen);
    // quelle portate lì da me non fanno avviso (ma si ricordano)
    const fresh = rows.filter((x) => !before.has(x.id) && x.write_uid?.[0] !== uid);
    return { seen: ids, fresh };
  }

  // ticket creati dopo l'ultimo visto (data del server, così l'orologio del PC non conta)
  async function checkTicket(orm, r, uid) {
    const dom = [];
    if (r.team) dom.push(["team_id", "=", r.team[0]]);
    if (r.unassigned) dom.push(["user_id", "=", false]);
    if (r.tprios?.length) dom.push(["priority", "in", r.tprios]);
    if (!r.since) {
      const last = await orm.searchRead(TICKET, dom, ["create_date"], { limit: 1, order: "create_date desc" });
      return { since: last[0]?.create_date || "1970-01-01 00:00:00", fresh: [] };
    }
    const rows = await orm.searchRead(TICKET, [...dom, ["create_date", ">", r.since]],
        ["display_name", "create_date", "create_uid"], { limit: 50, order: "create_date desc" });
    return { since: rows[0]?.create_date || r.since, fresh: rows.filter((x) => x.create_uid?.[0] !== uid) };
  }

  function openRecords(model, ids, name) {
    const action = getEnv()?.services.action;
    if (!action || !ids.length) return;
    const p = ids.length === 1
      ? { type: "ir.actions.act_window", res_model: model, res_id: ids[0], views: [[false, "form"]], target: "current" }
      : { type: "ir.actions.act_window", res_model: model, name, domain: [["id", "in", ids]],
        views: [[false, "list"], [false, "kanban"], [false, "form"]], target: "current" };
    action.doAction(p).catch(fail);
  }

  function notify(r, fresh) {
    const notification = getEnv()?.services.notification;
    if (!notification || !fresh.length) return;
    const model = r.kind === "ticket" ? TICKET : TASK;
    const what = r.kind === "ticket"
      ? (fresh.length === 1 ? "Nuovo ticket" : `${fresh.length} nuovi ticket`)
      : (fresh.length === 1 ? "Nuova scheda" : `${fresh.length} nuove schede`);
    const list = fresh.slice(0, 3).map((x) => `#${x.id} ${x.display_name}`).join("\n")
        + (fresh.length > 3 ? `\n… e altre ${fresh.length - 3}` : "");
    let close = null;
    close = notification.add(list, {
      title: `🔔 ${what} · ${r.name}`, type: "info", sticky: true,
      buttons: [{ name: fresh.length === 1 ? "Apri" : "Apri elenco", primary: true,
        onClick: () => { close?.(); openRecords(model, fresh.map((x) => x.id), r.name); } }],
    });
  }

  // una regola va controllata se è passato il suo intervallo (5 s di margine per il giro dell'orologio)
  const isDue = (r) => !r.checked || Date.now() - r.checked >= everyOf(r) * 60000 - 5000;

  let running = false;
  // onlyId: controlla subito solo quella regola (appena creata o riattivata), senza aspettare il turno
  async function poll(onlyId = null) {
    if (running) return;
    const rules = load().filter((r) => r.on && (onlyId ? r.id === onlyId : isDue(r)));
    if (!rules.length || (!onlyId && !takeLock())) return;
    const env = getEnv();
    if (!env?.services?.orm) return;
    running = true;
    try {
      const orm = env.services.orm, uid = evalCtx(env).uid;
      let rang = false;
      for (const r of rules) {
        let res;
        try { res = await (r.kind === "ticket" ? checkTicket(orm, r, uid) : checkTask(orm, r, uid)); }
        catch (e) { console.warn(`[pulsantiera] avviso "${r.name}":`, e); continue; }
        if (!res) continue;
        // salvo sulla versione più recente delle regole (potrebbero essere cambiate nel frattempo)
        mutate((all) => {
          const x = all.find((y) => y.id === r.id);
          if (!x) return;
          if (res.seen) x.seen = res.seen;
          if (res.since) x.since = res.since;
          x.checked = Date.now();
        });
        if (res.fresh.length) {
          notify(r, res.fresh);
          rang = true;
        }
      }
      if (rang && PS.soundOn?.()) PS.chime?.();
    } finally { running = false; }
  }
  setInterval(() => poll().catch((e) => console.warn("[pulsantiera] avvisi:", e)), POLL_MS);
  setTimeout(() => poll().catch(() => {}), 8000);

  /* ---------- scheda "Avvisi automatici" nel pannello note ---------- */
  function renderWatch(box, onCount) {
    const orm = getEnv()?.services.orm;
    let kind = "task";
    let teamsOk = true;

    const nameIn = el("input", { placeholder: "Nome dell'avviso (facoltativo)" });
    // progetto: campo con ricerca come nei fogli ore (Omnibus in cima, poi "Progetto…"); vuoto = tutti
    const projSel = PS.projectPicker([], () => loadStages().catch(fail), { placeholder: "Tutti i progetti (scrivi per cercare)" });
    const stageSel = el("select", { disabled: true }, el("option", { value: "", textContent: "Qualsiasi colonna" }));
    const sprintSel = el("select", {},
        el("option", { value: "any", textContent: "Qualsiasi sprint" }),
        el("option", { value: "cur", textContent: "Sprint corrente" }),
        el("option", { value: "curprev", textContent: "Sprint corrente o precedente" }));
    const usIn = el("input", { placeholder: "User story (facoltativa, es. US612.1)" });
    const mineL = chk("Solo schede assegnate a me", false);
    const teamSel = el("select", {}, el("option", { value: "", textContent: "Tutti i team" }));
    const unassL = chk("Solo ticket non assegnati", false);

    // priorità a scelta multipla: pulsanti da accendere/spegnere (nessuno acceso = tutte)
    function prioToggles(options) {
      const on = new Set();
      const box = el("div", { className: "ps-prio-pick" });
      function draw(opts) {
        PS.fill(box, ...opts.map(([k, label, hex]) => {
          const b = el("button", { type: "button", className: `ps-prio${on.has(k) ? " on" : ""}`, textContent: label,
            onclick: () => { if (on.has(k)) on.delete(k); else on.add(k); draw(opts); } });
          b.style.setProperty("--pc", hex);
          b.setAttribute("aria-pressed", String(on.has(k)));
          return b;
        }));
      }
      draw(options);
      return { node: box, get value() { return [...on]; }, redraw: draw };
    }
    const taskPrio = prioToggles(PRIO_ORDER.map((k) => [k, PRIO[k].label, prioHex(k)]));
    const TICKET_HEX = ["#9aa0b0", "#30C381", "#F7CD1F", "#F06050"];
    const ticketPrioOpts = () => ticketPrios.map(([k, label], i) => [k, label, TICKET_HEX[Math.min(i, 3)]]);
    const ticketPrio = prioToggles(ticketPrioOpts());
    orm?.call(TICKET, "fields_get", [["priority"]], { attributes: ["selection"] })
        .then((f) => { if (f?.priority?.selection?.length) { ticketPrios = f.priority.selection; ticketPrio.redraw(ticketPrioOpts()); } })
        .catch(() => {});
    const everySel = () => {
      const sel = el("select", { title: "Ogni quanto controllare su Odoo" },
          ...EVERY.map((m) => el("option", { value: String(m), textContent: everyText(m) })));
      sel.value = String(DEFAULT_EVERY);
      return sel;
    };
    const everyIn = everySel();

    const opt = (r) => el("option", { value: String(r.id), textContent: r.display_name || r.name });
    orm?.searchRead("project.project", [], ["display_name"], { order: "name" })
        .then((rows) => projSel.setProjects(rows)).catch(() => {});
    orm?.searchRead("helpdesk.team", [], ["name"], { order: "name" })
        .then((rows) => teamSel.append(...rows.map(opt))).catch(() => { teamsOk = false; });
    async function loadStages() {
      PS.fill(stageSel, el("option", { value: "", textContent: "Qualsiasi colonna" }));
      const p = projSel.value;
      stageSel.disabled = !p;
      if (!p) return;
      const rows = await orm.searchRead("project.task.type", [["project_ids", "in", [p.id]]], ["name"], { order: "sequence, id" });
      if (projSel.value?.id === p.id) stageSel.append(...rows.map(opt));  // risposta ancora valida
    }

    const taskPart = el("div", {},
        el("label", { textContent: "Progetto" }), projSel.node,
        el("label", { textContent: "Colonna" }), stageSel,
        el("label", { textContent: "Sprint" }), sprintSel,
        el("label", { textContent: "User story" }), usIn,
        el("label", { textContent: "Priorità (più di una; nessuna = tutte)" }), taskPrio.node,
        mineL);
    const ticketPart = el("div", { hidden: true },
        el("label", { textContent: "Team helpdesk" }), teamSel,
        el("label", { textContent: "Priorità (più di una; nessuna = tutte)" }), ticketPrio.node,
        unassL);
    const seg = el("div", { className: "ps-seg" });
    function drawSeg() {
      taskPart.hidden = kind !== "task";
      ticketPart.hidden = kind !== "ticket";
      PS.fill(seg, ...[["task", "Scheda di progetto"], ["ticket", "Nuovo ticket"]].map(([k, label]) =>
        el("button", { type: "button", className: k === kind ? "on" : "", textContent: label,
          onclick: () => { kind = k; drawSeg(); } })));
    }
    drawSeg();

    const selected = (sel) => (sel.value ? [Number(sel.value), sel.selectedOptions[0].textContent] : null);
    const addBtn = el("button", { className: "primary", textContent: "Crea avviso", onclick: async () => {
      if (kind === "ticket" && !teamsOk) return PS.say("Helpdesk non disponibile: modulo assente o senza accesso ai ticket.");
      const r = { id: `w${Date.now().toString(36)}`, kind, on: true, every: Number(everyIn.value), seen: null, since: null };
      if (kind === "task") {
        Object.assign(r, { project: projSel.value ? [projSel.value.id, projSel.value.display_name] : null, stage: selected(stageSel), sprint: sprintSel.value,
          us: usIn.value.trim().toUpperCase(), mine: mineL.control.checked, usField: PS.usFieldName?.() || null,
          prios: taskPrio.value });
        if (!r.project && !r.stage && r.sprint === "any" && !r.us && !r.mine && !r.prios.length &&
            !(await PS.ask("L'avviso scatterà per ogni nuova scheda di tutti i progetti. Continuare?", { ok: "Crea" }))) return;
      } else {
        Object.assign(r, { team: selected(teamSel), unassigned: unassL.control.checked, tprios: ticketPrio.value });
      }
      r.name = nameIn.value.trim() || describe(r).replace(/^Nuov[ao] (scheda|ticket) · /, "");
      mutate((rules) => rules.push(r));
      nameIn.value = ""; usIn.value = "";
      form.open = false;
      drawList();
      onCount?.();
      poll(r.id).catch(() => {});  // fotografia iniziale subito: gli avvisi partono dalle prossime novità
      getEnv()?.services.notification?.add(`Avviso "${r.name}" attivo: controllo ${everyText(r.every)}.`, { type: "success" });
    } });

    const form = el("details", { className: "ps-note-new" },
        el("summary", { textContent: "＋ Nuovo avviso" }),
        seg, taskPart, ticketPart,
        el("label", { textContent: "Nome" }), nameIn,
        el("label", { textContent: "Controlla" }), everyIn,
        el("p", { className: "hint", textContent: "Ogni controllo è una chiamata a Odoo: per colonne che cambiano di rado bastano 15–30 minuti." }),
        el("div", { className: "acts" }, addBtn));

    const listBox = el("div", { className: "ps-notes" });
    const ago = (t) => {
      if (!t) return "non ancora controllato";
      const m = Math.round((Date.now() - t) / 60000);
      return m < 1 ? "controllato ora" : `controllato ${m} min fa`;
    };
    function drawList() {
      const rules = load();
      PS.fill(listBox, ...(rules.length ? rules.map((r) => {
        const onBox = el("input", { type: "checkbox", checked: r.on, title: r.on ? "Sospendi" : "Riattiva" });
        onBox.onchange = () => {
          // riattivando riparte dalla situazione attuale: niente avvisi per ciò che è successo mentre era sospeso
          mutate((all) => { const x = all.find((y) => y.id === r.id); if (x) { x.on = onBox.checked; x.seen = null; x.since = null; } });
          drawList();
          onCount?.();
          if (onBox.checked) poll(r.id).catch(() => {});
        };
        const rowEvery = everySel();
        rowEvery.className = "mini";
        rowEvery.value = String(everyOf(r));
        rowEvery.onchange = () => {
          mutate((all) => { const x = all.find((y) => y.id === r.id); if (x) x.every = Number(rowEvery.value); });
          drawList();
        };
        return el("div", { className: `ps-note${r.on ? "" : " done"}` },
            onBox,
            el("div", { className: "body" },
                el("div", { className: "text", textContent: `${r.kind === "ticket" ? "🎫" : "📋"} ${r.name}` }),
                el("div", { className: "meta" }, el("span", { textContent: `${describe(r)} · ${r.on ? ago(r.checked) : "sospeso"}` }))),
            el("span", { className: "tools" },
                rowEvery,
                el("button", { type: "button", className: "icon del", textContent: "×", title: "Elimina l'avviso", onclick: async () => {
                  if (!(await PS.ask(`Eliminare l'avviso "${r.name}"?`, { ok: "Elimina", danger: true }))) return;
                  mutate((all) => { const i = all.findIndex((y) => y.id === r.id); if (i >= 0) all.splice(i, 1); });
                  drawList();
                  onCount?.();
                } })));
      }) : [el("p", { className: "hint", textContent: "Nessun avviso: creane uno qui sopra." })]));
    }

    drawList();
    form.open = !load().length;
    PS.fill(box,
        form,
        el("h4", { className: "sep", textContent: "I tuoi avvisi" }),
        listBox,
        el("p", { className: "hint", textContent: "Ogni regola attiva si controlla con la frequenza scelta (cambiala dalla tendina accanto all'avviso): una scheda che entra nella colonna (creata o spostata lì) o un nuovo ticket fanno arrivare una notifica di Odoo, con il suono se attivo. Non avvisano le schede spostate da te né i ticket aperti da te. Serve una pagina di Odoo aperta." }));
  }

  Object.assign(PS, { renderWatch, watchCount });
})();
