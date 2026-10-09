/* Note e promemoria (icona nella barra): testo, data/ora facoltativa, collegamento a una scheda o a una US */
(() => {
  "use strict";
  const PS = window.__ps;
  if (!PS || PS.ready) return;
  const { el, fail, chk, store, getEnv, TASK, SPRINT_FIELD, sprintValue } = PS;

  // nota = { id, text, due: "AAAA-MM-GGTHH:MM" | "", important, done, notified, created,
  //          link: null | { type: "card", model, id, name } | { type: "us", label } }
  const STORE = store("ps-notes-v1", { items: [] }, (v) => v && Array.isArray(v.items));
  // rilegge a ogni modifica: un'altra scheda del browser può aver cambiato le note
  const load = () => STORE.load().items;
  function mutate(fn) {
    const items = load();
    fn(items);
    STORE.save({ items });
    afterChange();
  }

  const dueAt = (n) => (n.due ? new Date(n.due).getTime() : NaN);  // "AAAA-MM-GGTHH:MM" = ora locale
  const isDue = (n) => !n.done && dueAt(n) <= Date.now();
  const dueCount = () => load().filter(isDue).length;
  // da guardare = scadute o importanti (non fatte): il numero sull'icona delle note
  const notesBadge = () => {
    const open = load().filter((n) => !n.done);
    return { count: open.filter((n) => isDue(n) || n.important).length, due: open.filter(isDue).length };
  };
  const pad = (x) => String(x).padStart(2, "0");
  const toLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const fmtDue = (s) => new Date(s).toLocaleString("it-IT", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const linkLabel = (l) => (l?.type === "card" ? `#${l.id} ${l.name}` : l?.type === "us" ? l.label : "");

  /* ---------- apertura del collegamento ---------- */
  function openLink(l) {
    if (!l) return;
    if (l.type === "card") {
      getEnv()?.services.action.doAction({ type: "ir.actions.act_window", res_model: l.model, res_id: l.id,
        views: [[false, "form"]], target: "current" }).catch(fail);
    } else if (l.type === "us") {
      if (!document.querySelector(".o_kanban_renderer")) return PS.say(`Apri una vista kanban per cercare le schede di ${l.label}.`);
      PS.togglePanel("notes").catch(fail);  // chiude il pannello
      PS.openSearch(l.label);
    }
  }

  /* ---------- suono dei promemoria: un breve "din-don" sintetizzato (nessun file audio) ---------- */
  const OPTS = store("ps-notes-opts-v1", { sound: true }, (v) => v && typeof v.sound === "boolean");
  const opts = OPTS.load();
  let audio = null;
  // il browser lo lascia suonare solo dopo un'interazione con la pagina: se è bloccato, resta la notifica
  function chime() {
    try {
      audio ||= new AudioContext();
      if (audio.state === "suspended") audio.resume().catch(() => {});
      const t0 = audio.currentTime + 0.02;
      [[880, 0], [1318.5, 0.18], [1760, 0.36]].forEach(([freq, dt]) => {
        const osc = audio.createOscillator(), gain = audio.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t0 + dt);
        gain.gain.exponentialRampToValueAtTime(0.25, t0 + dt + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.6);
        osc.connect(gain).connect(audio.destination);
        osc.start(t0 + dt);
        osc.stop(t0 + dt + 0.65);
      });
    } catch (e) { console.warn("[pulsantiera] suono del promemoria:", e); }
  }
  // sblocca l'audio al primo clic o tasto (poi il suono può partire anche da solo, allo scadere)
  const unlock = () => {
    try { audio ||= new AudioContext(); if (audio.state === "suspended") audio.resume().catch(() => {}); } catch { /* niente audio */ }
  };
  addEventListener("pointerdown", unlock, { once: true, capture: true });
  addEventListener("keydown", unlock, { once: true, capture: true });

  /* ---------- promemoria: controllo ogni 30 s, una notifica per scadenza ---------- */
  let lastBadge = "";
  function afterChange() {
    const b = JSON.stringify(notesBadge());
    if (b !== lastBadge) { lastBadge = b; PS.renderBar?.(); }  // numero sull'icona delle note
  }
  function checkReminders() {
    const notification = getEnv()?.services?.notification;
    if (!notification) return;
    const fire = load().filter((n) => isDue(n) && !n.notified);
    if (fire.length) {
      // segno subito come notificate, così un'altra scheda del browser non ripete l'avviso
      mutate((items) => { for (const n of items) if (fire.some((f) => f.id === n.id)) n.notified = true; });
      for (const n of fire) notifyNote(notification, n);
      if (opts.sound) chime();  // un solo suono anche se scadono più note insieme
    }
    afterChange();
  }
  function notifyNote(notification, n) {
    let close = null;
    const done = () => { close?.(); mutate((items) => { const x = items.find((i) => i.id === n.id); if (x) x.done = true; }); };
    const snooze = () => {
      close?.();
      mutate((items) => {
        const x = items.find((i) => i.id === n.id);
        if (x) { x.due = toLocal(new Date(Date.now() + 10 * 60000)); x.notified = false; }
      });
    };
    close = notification.add(n.text + (n.link ? `\n→ ${linkLabel(n.link)}` : ""), {
      title: "Promemoria", type: "warning", sticky: true,
      buttons: [
        { name: "Fatto", primary: true, onClick: done },
        { name: "Tra 10 minuti", onClick: snooze },
        n.link ? { name: "Apri", onClick: () => { close?.(); openLink(n.link); } } : null,
      ].filter(Boolean),
    });
  }
  setInterval(checkReminders, 30000);
  setTimeout(checkReminders, 3000);
  addEventListener("storage", (e) => { if (e.key === "ps-notes-v1") afterChange(); });

  /* ---------- collegamento: scheda di progetto (sprint corrente o precedente) o ticket helpdesk ----------
     Cerca sempre sul server, da qualsiasi pagina. A campo vuoto mostra le schede dei due sprint
     o i ticket aperti più recenti; il nome di un team helpdesk ("Supporto") porta tutti i suoi ticket. */
  const TICKET = "helpdesk.ticket";
  const kindOf = (l) => (l?.type === "us" ? "US" : l?.model === TICKET ? "Ticket" : "Scheda");
  let sprints = null;  // Promise<[corrente, precedente]>, calcolata una volta per pagina

  async function findTasks(orm, q) {
    sprints ||= Promise.all([sprintValue(orm, 0), sprintValue(orm, 1)]).catch(() => [null, null]);
    const [cur, prev] = await sprints;
    const vals = [cur, prev].filter((v) => v != null);
    if (!vals.length) return [];
    const id = /^#?\d+$/.test(q) ? Number(q.replace("#", "")) : null;
    const dom = [[SPRINT_FIELD, "in", vals]];
    if (q) dom.push(...(id ? ["|", ["id", "=", id], ["name", "ilike", q]] : [["name", "ilike", q]]));
    const rows = await orm.searchRead(TASK, dom, ["display_name", SPRINT_FIELD, "project_id"],
        { limit: 80, order: `${SPRINT_FIELD} desc, id desc` });
    const label = (v) => `Sprint ${v}${v === cur ? " · corrente" : v === prev ? " · precedente" : ""}`;
    return rows.map((r) => ({ group: label(r[SPRINT_FIELD]), meta: r.project_id?.[1] || "",
      link: { type: "card", model: TASK, id: r.id, name: r.display_name } }));
  }

  async function findTickets(orm, q) {
    const id = /^#?\d+$/.test(q) ? Number(q.replace("#", "")) : null;
    // vuoto: ticket aperti (fase non chiusa); con testo: titolo, numero o nome del team, anche chiusi
    const dom = !q ? [["stage_id.fold", "=", false]]
      : id ? ["|", ["id", "=", id], ["name", "ilike", q]]
      : ["|", ["name", "ilike", q], ["team_id.name", "ilike", q]];
    const rows = await orm.searchRead(TICKET, dom, ["display_name", "team_id", "stage_id"], { limit: 80, order: "id desc" });
    return rows.map((r) => ({ group: `Team · ${r.team_id?.[1] || "senza team"}`, meta: r.stage_id?.[1] || "",
      link: { type: "card", model: TICKET, id: r.id, name: r.display_name } }));
  }

  function linkPicker(onPick) {
    const MODES = { task: ["Scheda di progetto", "Cerca nello sprint corrente e precedente: titolo o #numero"],
      ticket: ["Ticket", "Cerca un ticket: titolo, #numero o nome del team"] };
    let mode = "task", timer = null, seq = 0, opts = [], active = -1;
    const input = el("input", { autocomplete: "off", spellcheck: false });
    const list = el("div", { className: "ps-combo-list", hidden: true });
    list.addEventListener("mousedown", (e) => e.preventDefault());  // il campo non perde il focus
    const tabs = el("div", { className: "ps-seg", role: "tablist" });
    function drawTabs() {
      PS.fill(tabs, ...Object.entries(MODES).map(([k, [label]]) => {
        const b = el("button", { type: "button", className: k === mode ? "on" : "", textContent: label,
          onclick: () => { if (mode === k) return; mode = k; drawTabs(); input.value = ""; input.focus(); search().catch(fail); } });
        b.setAttribute("aria-selected", String(k === mode));
        return b;
      }));
      input.placeholder = MODES[mode][1];
    }

    const pick = (l) => { list.hidden = true; onPick(l); };
    function setActive(i) {
      active = i;
      opts.forEach((o, j) => o.node.classList.toggle("on", j === i));
      opts[i]?.node.scrollIntoView({ block: "nearest" });
    }
    function draw(items, msg) {
      opts = [];
      const nodes = [];
      let group = null;
      for (const it of items) {
        if (it.group !== group) { group = it.group; nodes.push(el("div", { className: "grp", textContent: group })); }
        const node = el("div", { className: "opt", title: `#${it.link.id} ${it.link.name}${it.meta ? " · " + it.meta : ""}`,
          onclick: () => pick(it.link) },
            el("span", { textContent: `#${it.link.id} ${it.link.name}` }),
            it.meta ? el("small", { textContent: it.meta }) : null);
        opts.push({ l: it.link, node });
        nodes.push(node);
      }
      if (msg) nodes.push(el("div", { className: "empty", textContent: msg }));
      PS.fill(list, ...nodes);
      list.hidden = false;
      setActive(opts.length ? 0 : -1);
    }
    async function search() {
      const q = input.value.trim(), my = ++seq, m = mode;
      if (!opts.length) draw([], "Cerco…");
      const orm = getEnv()?.services.orm;
      if (!orm) return draw([], "Odoo non ancora caricato.");
      let items;
      try { items = await (m === "task" ? findTasks(orm, q) : findTickets(orm, q)); }
      catch (e) {
        if (my !== seq) return;
        return draw([], m === "ticket" ? "Ticket non disponibili (modulo helpdesk assente o senza accesso)."
            : "Ricerca non riuscita: " + (e?.data?.message || e.message));
      }
      if (my !== seq) return;  // risposta di una ricerca vecchia
      draw(items, items.length ? null : m === "task" ? "Nessuna scheda negli ultimi due sprint." : "Nessun ticket trovato.");
    }
    input.addEventListener("focus", () => search().catch(fail));
    input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => search().catch(fail), 250); });
    input.addEventListener("blur", () => { list.hidden = true; });
    input.addEventListener("keydown", (e) => {
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !list.hidden && opts.length) {
        e.preventDefault();
        setActive((active + (e.key === "ArrowDown" ? 1 : -1) + opts.length) % opts.length);
      } else if (e.key === "Enter" && !list.hidden && opts[active]) {
        e.preventDefault();
        pick(opts[active].l);
      } else if (e.key === "Escape" && !list.hidden) {
        e.preventDefault();
        list.hidden = true;
      }
    });
    drawTabs();
    return el("div", {}, tabs, el("div", { className: "ps-combo" }, input, list));
  }

  // scheda o ticket aperto in form, per collegarlo con un clic
  function openCard() {
    const p = getEnv()?.services.action?.currentController?.props;
    if (![TASK, TICKET].includes(p?.resModel) || !p.resId) return null;
    const name = document.querySelector(".o_breadcrumb .active, .o_last_breadcrumb_item")?.textContent.trim() || `#${p.resId}`;
    return { type: "card", model: p.resModel, id: p.resId, name };
  }

  /* ---------- giorno in formato italiano: gg/mm/aaaa, calendario con settimana da lunedì ----------
     (input type=date segue la lingua del browser: in inglese mostra mm/dd/yyyy) */
  const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre",
    "ottobre", "novembre", "dicembre"];
  const GIORNI = ["lu", "ma", "me", "gi", "ve", "sa", "do"];
  const isoOf = (d) => toLocal(d).slice(0, 10);
  const itOf = (iso) => (iso ? iso.split("-").reverse().join("/") : "");
  // "8/10/2026", "08.10.26", "8-10" (anno corrente) → "2026-10-08"; null se non valida
  function parseIt(str) {
    const m = str.trim().match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/);
    if (!m) return null;
    const [dd, mm] = [Number(m[1]), Number(m[2])];
    let yy = m[3] ? Number(m[3]) : new Date().getFullYear();
    if (yy < 100) yy += 2000;
    const d = new Date(yy, mm - 1, dd);
    return d.getMonth() === mm - 1 && d.getDate() === dd ? isoOf(d) : null;
  }

  function datePicker(onChange) {
    let iso = "", view = null;  // view = primo giorno del mese mostrato
    const input = el("input", { placeholder: "gg/mm/aaaa", autocomplete: "off", title: "Giorno del promemoria (gg/mm/aaaa)" });
    const btn = el("button", { type: "button", className: "icon", textContent: "📅", title: "Apri il calendario" });
    const cal = el("div", { className: "ps-cal", hidden: true });
    const node = el("div", { className: "ps-date" }, input, btn, cal);
    cal.addEventListener("mousedown", (e) => e.preventDefault());  // il campo non perde il focus cliccando nel calendario

    const set = (v, fire) => { iso = v || ""; input.value = itOf(iso); if (fire) onChange(iso); };
    const close = () => { cal.hidden = true; };
    function draw() {
      const y = view.getFullYear(), m = view.getMonth();
      const offset = (new Date(y, m, 1).getDay() + 6) % 7;  // lunedì = 0
      const days = new Date(y, m + 1, 0).getDate();
      const today = isoOf(new Date());
      const nav = (dm) => el("button", { type: "button", className: "nav", textContent: dm < 0 ? "‹" : "›",
        title: dm < 0 ? "Mese precedente" : "Mese successivo", onclick: () => { view = new Date(y, m + dm, 1); draw(); } });
      const cells = Array.from({ length: offset }, () => el("span"));
      for (let d = 1; d <= days; d++) {
        const v = isoOf(new Date(y, m, d));
        cells.push(el("button", { type: "button", className: `d${v === iso ? " on" : ""}${v === today ? " today" : ""}`,
          textContent: String(d), onclick: () => { set(v, true); close(); } }));
      }
      PS.fill(cal,
          el("div", { className: "head" }, nav(-1), el("strong", { textContent: `${MESI[m]} ${y}` }), nav(1)),
          el("div", { className: "grid" }, ...GIORNI.map((g) => el("span", { className: "wd", textContent: g })), ...cells),
          el("div", { className: "foot" },
              el("button", { type: "button", textContent: "Oggi", onclick: () => { set(today, true); close(); } }),
              el("button", { type: "button", textContent: "Cancella", onclick: () => { set("", true); close(); } })));
    }
    function open() {
      const base = iso ? new Date(`${iso}T00:00`) : new Date();
      view = new Date(base.getFullYear(), base.getMonth(), 1);
      draw();
      cal.hidden = false;
    }
    btn.onclick = () => (cal.hidden ? open() : close());
    input.addEventListener("focus", open);
    input.addEventListener("blur", close);
    input.addEventListener("change", () => {
      const t = input.value.trim();
      if (!t) return set("", true);
      const v = parseIt(t);
      if (v) set(v, true);
      else { input.value = itOf(iso); PS.say("Data non valida: usa gg/mm/aaaa (es. 8/10/2026)."); }
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !cal.hidden) { e.preventDefault(); close(); }
      else if (e.key === "Enter") { e.preventDefault(); input.dispatchEvent(new Event("change")); close(); }
    });
    // clic fuori: si chiude (il listener si toglie da solo quando il pannello non c'è più)
    const outside = (e) => {
      if (!node.isConnected) return document.removeEventListener("mousedown", outside, true);
      if (!cal.hidden && !node.contains(e.target)) close();
    };
    document.addEventListener("mousedown", outside, true);
    return { node, get value() { return iso; }, set value(v) { set(v, false); } };
  }

  /* ---------- data e ora del promemoria, sempre a 24 ore ----------
     (datetime-local segue la lingua del browser e in inglese mostra AM/PM): data + tendine ora 00–23 e minuti.
     value = "AAAA-MM-GGTHH:MM" oppure "" (come datetime-local) */
  function dueField() {
    const opt = (v) => el("option", { value: v, textContent: v });
    const dateIn = datePicker((v) => { if (v && !hourSel.value) { hourSel.value = "09"; setMin("00"); } });
    const hourSel = el("select", { title: "Ora (00–23)" }, el("option", { value: "", textContent: "--" }),
        ...Array.from({ length: 24 }, (_, h) => opt(pad(h))));
    const minSel = el("select", { title: "Minuti" }, el("option", { value: "", textContent: "--" }),
        ...Array.from({ length: 12 }, (_, i) => opt(pad(i * 5))));
    // un minuto fuori dai multipli di 5 (es. da "Tra 1 ora") si aggiunge all'elenco al suo posto
    const setMin = (m) => {
      if (m && ![...minSel.options].some((o) => o.value === m)) {
        const after = [...minSel.options].find((o) => o.value && o.value > m);
        minSel.insertBefore(opt(m), after || null);
      }
      minSel.value = m;
    };
    // scelta la data senza ora: 09:00 (in datePicker); scelta l'ora senza data: oggi
    for (const sel of [hourSel, minSel]) {
      sel.addEventListener("change", () => {
        if (!sel.value) return;
        if (!dateIn.value) dateIn.value = toLocal(new Date()).slice(0, 10);
        if (!hourSel.value) hourSel.value = "09";
        if (!minSel.value) setMin("00");
      });
    }
    const node = el("div", { className: "ps-due" }, dateIn.node, hourSel, el("span", { textContent: ":" }), minSel);
    return {
      node,
      get value() { return dateIn.value ? `${dateIn.value}T${hourSel.value || "09"}:${minSel.value || "00"}` : ""; },
      set value(v) {
        const [d = "", t = ""] = String(v || "").split("T");
        dateIn.value = d;
        hourSel.value = d ? t.slice(0, 2) : "";
        setMin(d ? t.slice(3, 5) : "");
      },
    };
  }

  /* ---------- pannello ---------- */
  let showDone = false;

  function renderNotes(panel) {
    let editing = null;   // id della nota in modifica
    let link = null;      // collegamento scelto nel modulo

    const textIn = el("textarea", { rows: 3, placeholder: "Scrivi una nota o un promemoria…" });
    const dueIn = dueField();
    const quick = (label, fn) => el("button", { type: "button", textContent: label, onclick: () => { dueIn.value = toLocal(fn()); } });
    const at = (days, h, m = 0) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(h, m, 0, 0); return d; };
    const quickRow = el("div", { className: "acts tight" },
        quick("Tra 1 ora", () => new Date(Date.now() + 3600000)),
        quick("Oggi 17:00", () => at(0, 17)),
        quick("Domani 9:00", () => at(1, 9)),
        el("button", { type: "button", textContent: "Nessuno", onclick: () => { dueIn.value = ""; } }));

    const linkBox = el("div");
    function drawLink() {
      if (link) {
        PS.fill(linkBox, el("div", { className: "ps-note-link" },
            el("span", { textContent: `${kindOf(link)} ${linkLabel(link)}` }),
            el("button", { type: "button", className: "icon", textContent: "×", title: "Togli il collegamento",
              onclick: () => { link = null; drawLink(); } })));
        return;
      }
      const cur = openCard();
      PS.fill(linkBox, ...[
          linkPicker((l) => { link = l; drawLink(); }),
          cur ? el("div", { className: "acts tight" }, el("button", { type: "button", textContent: `${kindOf(cur)} ${cur.model === TICKET ? "aperto" : "aperta"}: ${cur.name}`,
            onclick: () => { link = cur; drawLink(); } })) : null,
      ].filter(Boolean));
    }

    const impL = chk("★ Importante (conta nel numero sull'icona)", false);
    const saveBtn = el("button", { className: "primary", textContent: "Aggiungi nota" });
    const cancelBtn = el("button", { textContent: "Annulla modifica", hidden: true });
    function resetForm() {
      editing = null; link = null;
      textIn.value = ""; dueIn.value = ""; impL.control.checked = false;
      saveBtn.textContent = "Aggiungi nota"; cancelBtn.hidden = true;
      form.open = false;
      drawLink();
    }
    cancelBtn.onclick = resetForm;
    saveBtn.onclick = () => {
      const text = textIn.value.trim();
      if (!text) return PS.say("Scrivi il testo della nota.");
      const due = dueIn.value || "", important = impL.control.checked;
      mutate((items) => {
        const old = editing && items.find((i) => i.id === editing);
        if (old) Object.assign(old, { text, due, link, important, notified: old.due === due ? old.notified : false });
        else items.push({ id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
          text, due, link, important, done: false, notified: false, created: Date.now() });
      });
      resetForm();
      drawList();
    };

    const listBox = el("div", { className: "ps-notes" });
    function noteRow(n) {
      const overdue = isDue(n);
      const doneBox = el("input", { type: "checkbox", checked: n.done, title: n.done ? "Riapri" : "Segna come fatta" });
      doneBox.onchange = () => {
        mutate((items) => { const x = items.find((i) => i.id === n.id); if (x) x.done = doneBox.checked; });
        drawList();
      };
      return el("div", { className: `ps-note${n.done ? " done" : ""}${overdue ? " due" : ""}${n.important ? " imp" : ""}` },
          doneBox,
          el("div", { className: "body" },
              el("div", { className: "text", textContent: n.text }),
              n.due || n.link ? el("div", { className: "meta" },
                  n.due ? el("span", { className: "when", textContent: `⏰ ${fmtDue(n.due)}${overdue ? " · scaduto" : ""}` }) : null,
                  n.link ? el("button", { type: "button", className: "chip", textContent: `${kindOf(n.link)} ${linkLabel(n.link)}`,
                    title: n.link.type === "us" ? "Cerca le schede di questa US nel kanban" : `Apri ${n.link.model === TICKET ? "il ticket" : "la scheda"}`,
                    onclick: () => openLink(n.link) }) : null) : null),
          el("span", { className: "tools" },
              el("button", { type: "button", className: `icon star${n.important ? " on" : ""}`, textContent: n.important ? "★" : "☆",
                title: n.important ? "Togli da importanti" : "Segna come importante", onclick: () => {
                  mutate((items) => { const x = items.find((i) => i.id === n.id); if (x) x.important = !x.important; });
                  drawList();
                } }),
              el("button", { type: "button", className: "icon", textContent: "✎", title: "Modifica", onclick: () => {
                editing = n.id; link = n.link || null;
                textIn.value = n.text; dueIn.value = n.due || ""; impL.control.checked = !!n.important;
                saveBtn.textContent = "Salva modifiche"; cancelBtn.hidden = false;
                drawLink();
                form.open = true;
                textIn.focus();
              } }),
              el("button", { type: "button", className: "icon del", textContent: "×", title: "Elimina", onclick: async () => {
                if (!(await PS.ask("Eliminare la nota?", { ok: "Elimina", danger: true }))) return;
                mutate((items) => { const i = items.findIndex((x) => x.id === n.id); if (i >= 0) items.splice(i, 1); });
                if (editing === n.id) resetForm();
                drawList();
              } })));
    }
    // scaduti in cima, poi importanti, poi per scadenza, poi le più recenti; le completate in fondo
    const order = (a, b) => (a.done - b.done) || (isDue(b) - isDue(a)) || (!!b.important - !!a.important)
        || ((dueAt(a) || Infinity) - (dueAt(b) || Infinity)) || (b.created - a.created);
    function drawList() {
      const all = load();
      const doneN = all.filter((n) => n.done).length;
      const shown = all.filter((n) => showDone || !n.done).sort(order);
      PS.fill(listBox, ...[
        ...(shown.length ? shown.map(noteRow) : [el("p", { className: "hint", textContent: all.length ? "Nessuna nota da fare." : "Ancora nessuna nota: aggiungine una qui sopra." })]),
        doneN ? chk(`Mostra completate (${doneN})`, showDone, (v) => { showDone = v; drawList(); }) : null,
      ].filter(Boolean));
      const open = all.filter((n) => !n.done).length;
      listTitle.textContent = open ? `Le tue note (${open})` : "Le tue note";
    }

    // modulo richiudibile: chiuso di default, così in primo piano ci sono le note già scritte
    const form = el("details", { className: "ps-note-new" },
        el("summary", { textContent: "＋ Nuova nota" }),
        textIn,
        el("label", { textContent: "Promemoria (facoltativo)" }), dueIn.node, quickRow,
        impL,
        el("label", { textContent: "Collega a una scheda o a un ticket (facoltativo)" }), linkBox,
        el("div", { className: "acts" }, saveBtn, cancelBtn));
    form.addEventListener("toggle", () => { if (form.open) textIn.focus(); });
    const listTitle = el("h4", { className: "sep" });

    drawLink();
    drawList();
    form.open = !load().length;  // nessuna nota: il modulo parte aperto
    PS.fill(panel,
        el("h4", { textContent: "Note e promemoria" }),
        form,
        listTitle,
        listBox,
        el("div", { className: "inline ps-note-sound" },
            chk("Suono quando scade un promemoria", opts.sound, (v) => { opts.sound = v; OPTS.save(opts); if (v) chime(); }),
            el("button", { type: "button", textContent: "🔊 Prova", onclick: chime })),
        el("p", { className: "hint", textContent: "Le note restano solo in questo browser (incluse nel backup della configurazione). Il promemoria arriva come notifica di Odoo se una sua pagina è aperta." }),
        el("div", { className: "acts" }, el("button", { textContent: "Chiudi", onclick: () => PS.togglePanel("notes") })));
  }

  Object.assign(PS, { renderNotes, notesDue: dueCount, notesBadge });
})();
