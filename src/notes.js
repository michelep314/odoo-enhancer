/* Note e promemoria (icona nella barra): testo, data/ora facoltativa, collegamento a una scheda o a una US */
(() => {
  "use strict";
  const PS = window.__ps;
  if (!PS || PS.ready) return;
  const { el, fail, chk, store, getEnv, TASK, kanbanRecords } = PS;

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
      if (!document.querySelector(".o_kanban_renderer")) return alert(`Apri una vista kanban per cercare le schede di ${l.label}.`);
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

  /* ---------- scheda da collegare: ricerca per nome o #numero ---------- */
  function cardPicker(onPick) {
    const input = el("input", { placeholder: "Cerca una scheda: titolo o #numero", autocomplete: "off", spellcheck: false });
    const list = el("div", { className: "ps-combo-list", hidden: true });
    let timer = null, seq = 0;
    async function search() {
      const q = input.value.trim(), my = ++seq;
      if (!q) { list.hidden = true; return; }
      const { orm } = getEnv().services;
      let rows;
      if (/^#?\d+$/.test(q)) {
        rows = (await orm.read(TASK, [Number(q.replace("#", ""))], ["display_name"]).catch(() => []))
            .map((r) => [r.id, r.display_name]);
      } else {
        rows = await orm.call(TASK, "name_search", [], { name: q, limit: 15 });
      }
      if (my !== seq) return;  // risposta di una ricerca vecchia
      list.replaceChildren(...(rows.length ? rows.map(([id, name]) => el("div", { className: "opt", textContent: `#${id} ${name}`,
        onmousedown: (e) => { e.preventDefault(); list.hidden = true; onPick({ type: "card", model: TASK, id, name }); } }))
        : [el("div", { className: "empty", textContent: "Nessuna scheda trovata" })]));
      list.hidden = false;
    }
    input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => search().catch(fail), 250); });
    input.addEventListener("blur", () => { list.hidden = true; });
    input.addEventListener("keydown", (e) => { if (e.key === "Escape" && !list.hidden) { e.preventDefault(); list.hidden = true; } });
    return el("div", { className: "ps-combo" }, input, list);
  }

  // scheda aperta in form o US delle schede nel kanban, per collegarle con un clic
  function openCard() {
    const ctrl = getEnv()?.services.action?.currentController;
    const p = ctrl?.props;
    if (p?.resModel !== TASK || !p.resId) return null;
    const name = document.querySelector(".o_breadcrumb .active, .o_last_breadcrumb_item")?.textContent.trim() || `Scheda ${p.resId}`;
    return { type: "card", model: TASK, id: p.resId, name };
  }
  function visibleUs() {
    const seen = new Map();
    for (const [, r] of kanbanRecords()) {
      const v = PS.usOf(r);
      if (v && !seen.has(PS.usKey(v))) seen.set(PS.usKey(v), v);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }

  /* ---------- data e ora del promemoria, sempre a 24 ore ----------
     (datetime-local segue la lingua del browser e in inglese mostra AM/PM): data + tendine ora 00–23 e minuti.
     value = "AAAA-MM-GGTHH:MM" oppure "" (come datetime-local) */
  function dueField() {
    const opt = (v) => el("option", { value: v, textContent: v });
    const dateIn = el("input", { type: "date", title: "Giorno del promemoria" });
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
    // scelta la data senza ora: 09:00; scelta l'ora senza data: oggi
    dateIn.addEventListener("change", () => { if (dateIn.value && !hourSel.value) { hourSel.value = "09"; setMin("00"); } });
    for (const sel of [hourSel, minSel]) {
      sel.addEventListener("change", () => {
        if (!sel.value) return;
        if (!dateIn.value) dateIn.value = toLocal(new Date()).slice(0, 10);
        if (!hourSel.value) hourSel.value = "09";
        if (!minSel.value) setMin("00");
      });
    }
    const node = el("div", { className: "ps-due" }, dateIn, hourSel, el("span", { textContent: ":" }), minSel);
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
        linkBox.replaceChildren(el("div", { className: "ps-note-link" },
            el("span", { textContent: (link.type === "us" ? "US " : "Scheda ") + linkLabel(link) }),
            el("button", { type: "button", className: "icon", textContent: "×", title: "Togli il collegamento",
              onclick: () => { link = null; drawLink(); } })));
        return;
      }
      const cur = openCard();
      const usList = visibleUs();
      const usIn = el("input", { placeholder: "Oppure scrivi una US (es. US612.1)" });
      usIn.setAttribute("list", "ps-note-us");  // "list" è in sola lettura come proprietà
      const usBtn = el("button", { type: "button", textContent: "Collega US", onclick: () => {
        const v = usIn.value.trim();
        if (v) { link = { type: "us", label: v }; drawLink(); }
      } });
      usIn.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); usBtn.click(); } });
      linkBox.replaceChildren(...[  // replaceChildren scriverebbe "null" come testo
          cardPicker((l) => { link = l; drawLink(); }),
          cur ? el("div", { className: "acts tight" }, el("button", { type: "button", textContent: `Scheda aperta: ${cur.name}`,
            onclick: () => { link = cur; drawLink(); } })) : null,
          el("div", { className: "inline", style: "margin-top:6px" }, usIn, usBtn),
          el("datalist", { id: "ps-note-us" }, ...usList.map((v) => el("option", { value: v }))),
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
      if (!text) return alert("Scrivi il testo della nota.");
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
                  n.link ? el("button", { type: "button", className: "chip", textContent: (n.link.type === "us" ? "US " : "") + linkLabel(n.link),
                    title: n.link.type === "us" ? "Cerca le schede di questa US nel kanban" : "Apri la scheda",
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
              el("button", { type: "button", className: "icon del", textContent: "×", title: "Elimina", onclick: () => {
                if (!confirm("Eliminare la nota?")) return;
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
      listBox.replaceChildren(...[
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
        el("label", { textContent: "Collega a una scheda o a una user story (facoltativo)" }), linkBox,
        el("div", { className: "acts" }, saveBtn, cancelBtn));
    form.addEventListener("toggle", () => { if (form.open) textIn.focus(); });
    const listTitle = el("h4", { className: "sep" });

    drawLink();
    drawList();
    form.open = !load().length;  // nessuna nota: il modulo parte aperto
    panel.replaceChildren(
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
