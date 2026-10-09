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
  //   task:   project: [id, nome] | null, stage: [_, nome colonna] | null (si confronta il nome), sprint: "any" | "cur" | "curprev", us, mine,
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
    // colonna per nome: ogni sprint ha le sue colonne con gli stessi nomi, così la regola vale anche per i prossimi
    if (r.stage) dom.push(["stage_id.name", "=", r.stage[1]]);
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

  /* ---------- Google Chat: webhook in arrivo di uno spazio, inviato dall'estensione (bridge.js → sw.js) ---------- */
  const CHAT_RE = /^https:\/\/chat\.googleapis\.com\/v1\/spaces\/[^/?#]+\/messages\?\S+$/;
  const OPTS = store("ps-watch-opts-v1", { chatUrl: "" }, (v) => v && typeof v.chatUrl === "string");
  let chatSeq = 0;
  const chatWait = new Map();
  addEventListener("message", (e) => {
    if (e.source !== window || e.data?.__ps !== "gchat:res") return;
    const done = chatWait.get(e.data.id);
    if (done) { chatWait.delete(e.data.id); done(e.data); }
  });
  // → { ok, status?, error? }
  function sendChat(url, text) {
    return new Promise((resolve) => {
      const id = `c${++chatSeq}-${Date.now()}`;
      const timer = setTimeout(() => {
        chatWait.delete(id);
        resolve({ ok: false, error: "l'estensione non risponde: ricaricala da chrome://extensions e poi ricarica la pagina" });
      }, 15000);
      chatWait.set(id, (r) => { clearTimeout(timer); resolve(r); });
      window.postMessage({ __ps: "gchat", id, url, text }, location.origin);
    });
  }
  // testo per Google Chat: *grassetto* e link <url|testo> alle schede
  function chatText(r, fresh) {
    const model = r.kind === "ticket" ? TICKET : TASK;
    const what = r.kind === "ticket"
      ? (fresh.length === 1 ? "Nuovo ticket" : `${fresh.length} nuovi ticket`)
      : (fresh.length === 1 ? "Nuova scheda" : `${fresh.length} nuove schede`);
    const clean = (t) => String(t).replace(/[<>|]/g, " ");
    const lines = fresh.slice(0, 15).map((x) =>
      `• <${location.origin}/web#id=${x.id}&model=${model}&view_type=form|#${x.id} ${clean(x.display_name)}>`);
    if (fresh.length > 15) lines.push(`… e altre ${fresh.length - 15}`);
    return `🔔 *${what} · ${clean(r.name)}*\n_${clean(describe(r))}_\n${lines.join("\n")}`;
  }
  let chatErrShown = 0;
  async function notifyChat(r, fresh) {
    const res = await sendChat(r.chat, chatText(r, fresh));
    if (res.ok) return;
    console.warn(`[pulsantiera] Google Chat, avviso "${r.name}":`, res);
    if (Date.now() - chatErrShown > 600000) {  // al massimo un avviso di errore ogni 10 minuti
      chatErrShown = Date.now();
      getEnv()?.services.notification?.add(`Invio a Google Chat non riuscito per "${r.name}": ${res.error || res.status}`, { type: "danger" });
    }
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
          if (!r.chatOnly) { notify(r, res.fresh); rang = true; }
          if (r.chat) notifyChat(r, res.fresh).catch(() => {});
        }
      }
      if (rang && PS.soundOn?.()) PS.chime?.();
    } finally { running = false; }
  }
  setInterval(() => poll().catch((e) => console.warn("[pulsantiera] avvisi:", e)), POLL_MS);
  setTimeout(() => poll().catch(() => {}), 8000);

  /* ---------- pezzi comuni a scheda "Avvisi" e campanella 🔔 delle colonne ---------- */
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
  const taskPrioToggles = () => prioToggles(PRIO_ORDER.map((k) => [k, PRIO[k].label, prioHex(k)]));
  function everySel() {
    const sel = el("select", { title: "Ogni quanto controllare su Odoo" },
        ...EVERY.map((m) => el("option", { value: String(m), textContent: everyText(m) })));
    sel.value = String(DEFAULT_EVERY);
    return sel;
  }
  const sprintSelect = (value = "any") => {
    const sel = el("select", {},
        el("option", { value: "any", textContent: "Qualsiasi sprint" }),
        el("option", { value: "cur", textContent: "Sprint corrente" }),
        el("option", { value: "curprev", textContent: "Sprint corrente o precedente" }));
    sel.value = value;
    return sel;
  };

  // Google Chat: casella + webhook + prova; apply(r) aggiunge chat/chatOnly alla regola (false se il link non va)
  function chatFields() {
    const chatL = chk("Avvisa anche su Google Chat", false);
    const chatIn = el("input", { placeholder: "https://chat.googleapis.com/v1/spaces/…/messages?key=…&token=…",
      value: OPTS.load().chatUrl, spellcheck: false });
    const chatOnlyL = chk("Solo su Google Chat (niente notifica in Odoo)", false);
    const chatTest = el("button", { type: "button", textContent: "Invia prova", onclick: async () => {
      const url = chatIn.value.trim();
      if (!CHAT_RE.test(url)) return PS.say("Incolla il link del webhook di Google Chat: inizia con https://chat.googleapis.com/v1/spaces/");
      chatTest.disabled = true;
      const res = await sendChat(url, "✅ *Odoo Enhancer*: prova del webhook riuscita. Qui arriveranno gli avvisi automatici.");
      chatTest.disabled = false;
      if (res.ok) getEnv()?.services.notification?.add("Messaggio di prova inviato su Google Chat.", { type: "success" });
      else PS.say("Invio non riuscito: " + (res.error || `HTTP ${res.status}`));
    } });
    const chatBox = el("div", { hidden: true, className: "ps-chat" },
        el("div", { className: "inline" }, chatIn, chatTest),
        chatOnlyL,
        el("p", { className: "hint", textContent: "Il link si trova nello spazio di Google Chat: nome dello spazio → App e integrazioni → Webhook → Aggiungi. Chi ha il link può scrivere nello spazio: tienilo riservato." }));
    chatL.control.addEventListener("change", () => { chatBox.hidden = !chatL.control.checked; if (chatL.control.checked) chatIn.focus(); });
    return {
      node: el("div", {}, chatL, chatBox),
      apply(r) {
        if (!chatL.control.checked) return true;
        const url = chatIn.value.trim();
        if (!CHAT_RE.test(url)) { PS.say("Il webhook di Google Chat deve iniziare con https://chat.googleapis.com/v1/spaces/"); return false; }
        Object.assign(r, { chat: url, chatOnly: chatOnlyL.control.checked });
        OPTS.save({ ...OPTS.load(), chatUrl: url });  // proposto per il prossimo avviso
        return true;
      },
    };
  }

  const newRule = (kind, every) => ({ id: `w${Date.now().toString(36)}`, kind, on: true, every, seen: null, since: null });
  function addRule(r) {
    r.name ||= describe(r).replace(/^Nuov[ao] (scheda|ticket) · /, "");
    mutate((rules) => rules.push(r));
    PS.decorate?.();  // aggiorna le campanelle delle colonne
    poll(r.id).catch(() => {});  // fotografia iniziale subito: gli avvisi partono dalle prossime novità
    getEnv()?.services.notification?.add(`Avviso "${r.name}" attivo: controllo ${everyText(r.every)}.`, { type: "success" });
  }

  const ago = (t) => {
    if (!t) return "non ancora controllato";
    const m = Math.round((Date.now() - t) / 60000);
    return m < 1 ? "controllato ora" : `controllato ${m} min fa`;
  };
  // riga di un avviso: attivo/sospeso, frequenza, elimina; onChange() dopo ogni modifica
  function ruleRow(r, onChange) {
    const onBox = el("input", { type: "checkbox", checked: r.on, title: r.on ? "Sospendi" : "Riattiva" });
    onBox.onchange = () => {
      // riattivando riparte dalla situazione attuale: niente avvisi per ciò che è successo mentre era sospeso
      mutate((all) => { const x = all.find((y) => y.id === r.id); if (x) { x.on = onBox.checked; x.seen = null; x.since = null; } });
      PS.decorate?.();
      onChange();
      if (onBox.checked) poll(r.id).catch(() => {});
    };
    const rowEvery = everySel();
    rowEvery.className = "mini";
    rowEvery.value = String(everyOf(r));
    rowEvery.onchange = () => {
      mutate((all) => { const x = all.find((y) => y.id === r.id); if (x) x.every = Number(rowEvery.value); });
      onChange();
    };
    return el("div", { className: `ps-note${r.on ? "" : " done"}` },
        onBox,
        el("div", { className: "body" },
            el("div", { className: "text", textContent: `${r.kind === "ticket" ? "🎫" : "📋"} ${r.name}` }),
            el("div", { className: "meta" }, el("span", { textContent: `${describe(r)}${r.chat ? (r.chatOnly ? " · 💬 solo Google Chat" : " · 💬 anche Google Chat") : ""} · ${r.on ? ago(r.checked) : "sospeso"}` }))),
        el("span", { className: "tools" },
            rowEvery,
            el("button", { type: "button", className: "icon del", textContent: "×", title: "Elimina l'avviso", onclick: async () => {
              if (!(await PS.ask(`Eliminare l'avviso "${r.name}"?`, { ok: "Elimina", danger: true }))) return;
              mutate((all) => { const i = all.findIndex((y) => y.id === r.id); if (i >= 0) all.splice(i, 1); });
              PS.decorate?.();
              onChange();
            } })));
  }

  /* ---------- scheda "Avvisi automatici" nel pannello note ---------- */
  function renderWatch(box, onCount) {
    const orm = getEnv()?.services.orm;
    let kind = "task";
    let teamsOk = true;

    const nameIn = el("input", { placeholder: "Nome dell'avviso (facoltativo)" });
    const chat = chatFields();
    // progetto: campo con ricerca come nei fogli ore (Omnibus in cima, poi "Progetto…"); vuoto = tutti
    const projSel = PS.projectPicker([], () => loadStages().catch(fail), { placeholder: "Tutti i progetti (scrivi per cercare)" });
    const stageSel = el("select", {}, el("option", { value: "", textContent: "Qualsiasi colonna" }));
    const sprintSel = sprintSelect();
    const usIn = el("input", { placeholder: "User story (facoltativa, es. US612.1)" });
    const mineL = chk("Solo schede assegnate a me", false);
    const teamSel = el("select", {}, el("option", { value: "", textContent: "Tutti i team" }));
    const unassL = chk("Solo ticket non assegnati", false);

    const taskPrio = taskPrioToggles();
    const TICKET_HEX = ["#9aa0b0", "#30C381", "#F7CD1F", "#F06050"];
    const ticketPrioOpts = () => ticketPrios.map(([k, label], i) => [k, label, TICKET_HEX[Math.min(i, 3)]]);
    const ticketPrio = prioToggles(ticketPrioOpts());
    orm?.call(TICKET, "fields_get", [["priority"]], { attributes: ["selection"] })
        .then((f) => { if (f?.priority?.selection?.length) { ticketPrios = f.priority.selection; ticketPrio.redraw(ticketPrioOpts()); } })
        .catch(() => {});
    const everyIn = everySel();

    const opt = (r) => el("option", { value: String(r.id), textContent: r.display_name || r.name });
    orm?.searchRead("project.project", [], ["display_name"], { order: "name" })
        .then((rows) => projSel.setProjects(rows)).catch(() => {});
    orm?.searchRead("helpdesk.team", [], ["name"], { order: "name" })
        .then((rows) => teamSel.append(...rows.map(opt))).catch(() => { teamsOk = false; });
    // Colonne: solo quelle in cui ci sono schede dello sprint (e del progetto) scelti, una per nome.
    // Le colonne hanno lo stesso nome in ogni sprint: l'avviso le riconosce per nome, non per id.
    // Senza sprint né progetto: le colonne delle schede che hanno uno sprint.
    let stageSeq = 0;
    async function loadStages() {
      const my = ++stageSeq;
      const p = projSel.value, sprint = sprintSel.value, keep = stageSel.value;
      const taskDom = [];
      if (p) taskDom.push(["project_id", "=", p.id]);
      if (sprint !== "any") {
        const [cur, prev] = await sprints(orm);
        const vals = (sprint === "curprev" ? [cur, prev] : [cur]).filter((v) => v != null);
        taskDom.push([SPRINT_FIELD, "in", vals.length ? vals : [-1]]);
      } else if (!p) {
        taskDom.push([SPRINT_FIELD, "!=", false]);
      }
      PS.fill(stageSel, el("option", { value: "", textContent: "Carico le colonne…" }));
      const used = await orm.searchRead(TASK, taskDom, ["stage_id"], { limit: 5000, order: "id desc" }).catch(() => []);
      const ids = [...new Set(used.map((t) => t.stage_id?.[0]).filter(Boolean))];
      const stages = ids.length
        ? await orm.searchRead("project.task.type", [["id", "in", ids]], ["name"], { order: "sequence, id" }).catch(() => [])
        : [];
      if (my !== stageSeq) return;  // nel frattempo sono cambiati progetto o sprint
      const names = [...new Set(stages.map((x) => x.name))];  // ordine del kanban, un nome una volta sola
      PS.fill(stageSel,
          el("option", { value: "", textContent: names.length ? "Qualsiasi colonna" : "Qualsiasi colonna (nessuna scheda trovata)" }),
          ...names.map((n) => el("option", { value: n, textContent: n })));
      stageSel.value = names.includes(keep) ? keep : "";
    }
    sprintSel.addEventListener("change", () => loadStages().catch(fail));
    loadStages().catch((e) => console.warn("[pulsantiera] colonne degli avvisi:", e));

    const taskPart = el("div", {},
        el("label", { textContent: "Progetto" }), projSel.node,
        el("label", { textContent: "Sprint" }), sprintSel,
        el("label", { textContent: "Colonna" }), stageSel,  // dopo lo sprint: le colonne in cima dipendono da lui
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
      const r = newRule(kind, Number(everyIn.value));
      if (!chat.apply(r)) return;
      if (kind === "task") {
        Object.assign(r, { project: projSel.value ? [projSel.value.id, projSel.value.display_name] : null, stage: stageSel.value ? [null, stageSel.value] : null, sprint: sprintSel.value,
          us: usIn.value.trim().toUpperCase(), mine: mineL.control.checked, usField: PS.usFieldName?.() || null,
          prios: taskPrio.value });
        if (!r.project && !r.stage && r.sprint === "any" && !r.us && !r.mine && !r.prios.length &&
            !(await PS.ask("L'avviso scatterà per ogni nuova scheda di tutti i progetti. Continuare?", { ok: "Crea" }))) return;
      } else {
        Object.assign(r, { team: selected(teamSel), unassigned: unassL.control.checked, tprios: ticketPrio.value });
      }
      r.name = nameIn.value.trim();
      addRule(r);
      nameIn.value = ""; usIn.value = "";
      form.open = false;
      drawList();
      onCount?.();
    } });

    const form = el("details", { className: "ps-note-new" },
        el("summary", { textContent: "＋ Nuovo avviso" }),
        seg, taskPart, ticketPart,
        el("label", { textContent: "Nome" }), nameIn,
        el("label", { textContent: "Controlla" }), everyIn,
        chat.node,
        el("p", { className: "hint", textContent: "Ogni controllo è una chiamata a Odoo: per colonne che cambiano di rado bastano 15–30 minuti." }),
        el("div", { className: "acts" }, addBtn));

    const listBox = el("div", { className: "ps-notes" });
    function drawList() {
      const rules = load();
      PS.fill(listBox, ...(rules.length ? rules.map((r) => ruleRow(r, () => { drawList(); onCount?.(); }))
        : [el("p", { className: "hint", textContent: "Nessun avviso: usa la 🔔 sull'intestazione di una colonna del kanban, oppure creane uno qui sopra." })]));
    }

    drawList();
    form.open = !load().length;
    PS.fill(box,
        form,
        el("h4", { className: "sep", textContent: "I tuoi avvisi" }),
        listBox,
        el("p", { className: "hint", textContent: "Ogni regola attiva si controlla con la frequenza scelta (cambiala dalla tendina accanto all'avviso): una scheda che entra nella colonna (creata o spostata lì) o un nuovo ticket fanno arrivare una notifica di Odoo, con il suono se attivo. Non avvisano le schede spostate da te né i ticket aperti da te. Serve una pagina di Odoo aperta." }));
  }

  /* ---------- campanella 🔔 sull'intestazione di ogni colonna del kanban delle schede ---------- */
  // many2one del record Owl: [id, nome] sia nel formato vecchio (array) sia nel nuovo ({ id, display_name })
  const m2o = (v) => (Array.isArray(v) ? [v[0], v[1]] : v?.id ? [v.id, v.display_name] : null);
  const sameText = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

  // progetto della vista: dal contesto dell'azione, altrimenti se tutte le schede sono dello stesso progetto
  function viewProject(records) {
    const act = getEnv()?.services.action?.currentController?.action;
    const ctx = act?.context || {};
    const id = ctx.default_project_id || (ctx.active_model === "project.project" && ctx.active_id) || null;
    let found = null;
    for (const [, rec] of records) {
      const p = m2o(rec.data?.project_id);
      if (!p) continue;
      if (id && p[0] === id) return p;
      if (found && found[0] !== p[0]) { found = null; break; }
      found ||= p;
    }
    return found || (id ? [id, `progetto #${id}`] : null);
  }
  // avvisi su questa colonna: stessa colonna (per nome) e progetto compatibile con la vista
  const columnRules = (name, proj) => load().filter((r) => r.kind === "task" && sameText(r.stage?.[1], name)
      && (!r.project || !proj || r.project[0] === proj[0]));

  // chiamata da decorateColumns() per ogni colonna; records = tutte le schede della vista
  function watchBell(g, name, records) {
    const head = g.querySelector(".o_kanban_header_title") || g.querySelector(".o_kanban_header");
    if (!head) return;
    const viewModel = records[0]?.[1]?.resModel;
    let b = head.querySelector(".ps-bellbtn");
    if (viewModel && viewModel !== TASK) { b?.remove(); return; }  // solo kanban delle schede di progetto
    if (!b) {
      b = el("button", { type: "button", className: "ps-colbtn ps-bellbtn" });
      b.innerHTML = PS.svg("bell");
      b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); openBellPop(g, b); });
      PS.isolate(b);
      const ref = head.querySelector(".ps-colbtn:not(.ps-bellbtn)") || head.querySelector(".o_kanban_config");
      if (ref) ref.parentElement.insertBefore(b, ref); else head.append(b);
    }
    const n = columnRules(name, viewProject(records)).filter((r) => r.on).length;
    b.classList.toggle("on", n > 0);
    const t = n ? `Avvisi su "${name}": ${n} attiv${n === 1 ? "o" : "i"}` : `Avvisami quando arriva una scheda in "${name}"`;
    if (b.title !== t) b.title = t;
  }

  let bellPop = null;
  function openBellPop(g, btn) {
    const name = PS.colName(g);
    if (!name) return;
    if (bellPop?.node.dataset.col === name) { bellPop.close(); return; }
    bellPop?.close();
    const p = PS.popover("ps-bellpop", { ignore: ".ps-bellbtn", onClose: () => { if (bellPop === p) bellPop = null; } });
    bellPop = p;
    p.node.dataset.col = name;

    const records = PS.kanbanRecords();
    const proj = viewProject(records);
    const inCol = records.filter(([c]) => c.closest(".o_kanban_group") === g);
    // US presenti nella colonna (e nella vista), per sceglierne una senza scriverla
    const usList = [...new Map([...inCol, ...records].map(([, r]) => PS.usOf(r)).filter(Boolean)
        .map((v) => [PS.usKey(v), v])).values()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const hasSprint = records.some(([, r]) => r.data?.[SPRINT_FIELD]);

    function draw() {
      const projL = proj ? chk(`Solo ${proj[1]}`, true) : null;
      const sprintSel = sprintSelect(hasSprint ? "cur" : "any");
      const usSel = el("select", {}, el("option", { value: "", textContent: "Qualsiasi user story" }),
          ...usList.map((v) => el("option", { value: v, textContent: v })));
      const prio = taskPrioToggles();
      const mineL = chk("Solo schede assegnate a me", false);
      const everyIn = everySel();
      const chat = chatFields();
      const existing = columnRules(name, proj);
      const addBtn = el("button", { type: "button", className: "primary", textContent: "Crea avviso", onclick: () => {
        const r = newRule("task", Number(everyIn.value));
        if (!chat.apply(r)) return;
        Object.assign(r, { project: projL?.control.checked ? proj : null, stage: [null, name], sprint: sprintSel.value,
          us: usSel.value.toUpperCase(), mine: mineL.control.checked, usField: PS.usFieldName?.() || null, prios: prio.value });
        addRule(r);
        draw();
      } });
      PS.fill(p.node,
          el("h4", { textContent: `🔔 Avvisi · ${name}` }),
          ...(existing.length ? existing.map((r) => ruleRow(r, draw))
            : [el("p", { className: "hint", textContent: "Nessun avviso su questa colonna." })]),
          el("h4", { className: "sep", textContent: existing.length ? "Aggiungi un altro avviso" : "Avvisami quando arriva una scheda qui" }),
          el("p", { className: "hint", textContent: "Vale per le schede create in questa colonna o spostate qui da altri (non da te)." }),
          projL,
          el("label", { className: "lbl", textContent: "Sprint" }), sprintSel,
          el("label", { className: "lbl", textContent: "User story" }), usSel,
          el("label", { className: "lbl", textContent: "Priorità (più di una; nessuna = tutte)" }), prio.node,
          mineL,
          el("label", { className: "lbl", textContent: "Controlla" }), everyIn,
          chat.node,
          el("div", { className: "acts" }, addBtn,
              el("button", { type: "button", textContent: "Tutti gli avvisi", title: "Pannello note → Avvisi automatici",
                onclick: () => { p.close(); PS.openWatchTab?.(); } }),
              el("button", { type: "button", textContent: "Chiudi", onclick: () => p.close() })));
    }
    draw();
    const r = btn.getBoundingClientRect();
    p.node.style.left = Math.max(8, Math.min(r.left - 20, innerWidth - p.node.offsetWidth - 8)) + "px";
    p.node.style.top = Math.max(8, Math.min(r.bottom + 6, innerHeight - p.node.offsetHeight - 8)) + "px";
  }

  Object.assign(PS, { renderWatch, watchCount, watchBell });
})();
