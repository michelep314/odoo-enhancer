/* Ricerca rapida tra le schede kanban visibili (tasto / o 🔍 nella barra) */
(() => {
  "use strict";
  const PS = window.__ps;
  if (!PS || PS.ready) return;
  const { el, setFlag, recText, prioOf, PRIO, getEnv } = PS;

  // minuscole e senza accenti: "Attività" trova "attivita"
  const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  let query = "", terms = [];
  let box = null, input = null, countEl = null, timer = null;

  // "@mario" = solo tra le persone, "#123" = numero della scheda, "due parole" tra virgolette = frase esatta,
  // il resto ovunque; tutte le parole in AND (come Trello: "alunno sospeso" trova le schede con entrambe)
  function parse(q) {
    return [...q.matchAll(/"([^"]+)"?|(\S+)/g)].map(([, phrase, w]) => {
      if (phrase !== undefined) return { kind: "text", value: norm(phrase.trim().replace(/\s+/g, " ")) };
      if (/^#\d+$/.test(w)) return { kind: "id", value: w.slice(1) };
      if (w.startsWith("@") && w.length > 1) return { kind: "user", value: norm(w.slice(1)) };
      return { kind: "text", value: norm(w) };
    }).filter((t) => t.value);
  }

  /* Testi lunghi (descrizione, note, criteri di accettazione) non sono caricati nelle schede:
     li leggo dal server alla prima ricerca e li tengo finché la ricerca resta aperta */
  const LONG_RE = /descr|note|acceptance|criteri/i;
  const longFields = new Map();  // modello → Promise<[nomi dei campi html/text]>
  const longText = new Map();    // "modello:id" → testo normalizzato
  let loading = null, gen = 0;  // gen cambia a ogni chiusura: i risultati arrivati dopo vengono scartati

  function fieldsOf(orm, model) {
    if (!longFields.has(model)) {
      longFields.set(model, orm.call(model, "fields_get", [], { attributes: ["type", "string"] })
          .then((fs) => Object.entries(fs)
              .filter(([k, f]) => ["html", "text"].includes(f.type) && (LONG_RE.test(k) || LONG_RE.test(f.string || "")))
              .map(([k]) => k))
          .catch(() => []));
    }
    return longFields.get(model);
  }
  // HTML → testo (DOMParser non esegue script né carica immagini)
  const plain = (v) => (typeof v !== "string" ? ""
      : /<[a-z!]/i.test(v) ? new DOMParser().parseFromString(v, "text/html").body.textContent : v);

  async function loadLong(records) {
    const orm = getEnv()?.services.orm;
    if (!orm) return false;
    const g = gen, byModel = new Map();
    for (const [, r] of records) {
      if (!r.resId || longText.has(`${r.resModel}:${r.resId}`)) continue;
      if (!byModel.has(r.resModel)) byModel.set(r.resModel, []);
      byModel.get(r.resModel).push(r.resId);
    }
    for (const [model, ids] of byModel) {
      const fs = await fieldsOf(orm, model);
      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200);
        const rows = fs.length ? await orm.read(model, chunk, fs).catch(() => []) : [];
        if (g !== gen) return false;
        const byId = new Map(rows.map((row) => [row.id, row]));
        for (const id of chunk) {
          const row = byId.get(id);  // in caso di errore resta vuoto: non riprovo a ogni giro
          longText.set(`${model}:${id}`, row ? norm(fs.map((f) => plain(row[f])).join("\n")) : "");
        }
      }
    }
    return byModel.size > 0;
  }

  // avvia (una volta) la lettura dei testi lunghi mancanti; al termine ridisegna con i risultati completi
  function ensureLong(records) {
    if (loading || !terms.some((t) => t.kind === "text")) return !!loading;
    if (records.every(([, r]) => !r.resId || longText.has(`${r.resModel}:${r.resId}`))) return false;
    loading = loadLong(records)
        .catch((e) => console.warn("[pulsantiera] ricerca nelle descrizioni:", e))
        .then((changed) => { loading = null; if (changed && terms.length) redecorate(); });
    return true;
  }

  // testo ricercabile di una scheda: campi testo/relazione, etichette, persone, US, priorità
  function haystack(rec) {
    const d = rec.data || {}, f = rec.fields || {};
    const all = [], users = [];
    for (const k of Object.keys(d)) {
      const fd = f[k];
      let parts = [];
      if (fd?.type === "many2many") {
        parts = (d[k]?.records || []).map((r) => r.data?.display_name || r.data?.name).filter((s) => typeof s === "string");
      } else if (fd?.type === "selection") {
        const label = fd.selection?.find(([v]) => v === d[k])?.[1];
        if (label) parts = [label];
      } else if (fd?.type === "char" || fd?.type === "many2one") {
        const t = recText(rec, k);
        if (t) parts = [t];
      }
      all.push(...parts);
      if (fd?.relation === "res.users") users.push(...parts);
    }
    const us = PS.usOf(rec);
    if (us) all.push(us);
    const pk = prioOf(rec);
    if (pk) all.push(PRIO[pk].label);
    return { all: norm(all.join("\n")), users: norm(users.join("\n")) };
  }

  function matches(rec) {
    let h = null;
    return terms.every((t) => {
      if (t.kind === "id") return String(rec.resId).startsWith(t.value);
      h ??= haystack(rec);
      if (t.kind === "user") return h.users.includes(t.value);
      return h.all.includes(t.value) || !!longText.get(`${rec.resModel}:${rec.resId}`)?.includes(t.value);
    });
  }

  // chiamata da decorate() a ogni giro, prima delle colonne (così i conteggi dei gruppi US ne tengono conto)
  function applySearch(records) {
    const busy = terms.length > 0 && ensureLong(records);
    let shown = 0;
    for (const [card, rec] of records) {
      const hide = terms.length > 0 && !matches(rec);
      setFlag(card, "psSearch", hide);
      if (!hide) shown++;
    }
    if (!countEl) return;
    countEl.textContent = !records.length ? "Nessuna scheda kanban"
        : terms.length ? `${shown} di ${records.length} schede${busy ? " · cerco nelle descrizioni…" : ""}`
        : `${records.length} schede`;
  }

  const redecorate = () => {
    try { PS.decorate(); } catch (e) { console.warn("[pulsantiera] ricerca:", e); }
  };

  function openSearch() {
    if (!box) {
      input = el("input", { type: "search", placeholder: "Cerca: testo, descrizione, note, US, @persona, #numero, \"frase\"",
        value: query, spellcheck: false });
      input.setAttribute("aria-label", "Cerca nelle schede");
      countEl = el("span", { className: "count" });
      box = el("div", { id: "ps-search", role: "search" },
          el("span", { className: "ic", textContent: "🔍" }), input, countEl,
          el("button", { type: "button", className: "x", textContent: "×", title: "Azzera la ricerca (Esc)",
            onclick: () => closeSearch() }));
      input.addEventListener("input", () => {
        query = input.value;
        terms = parse(query);
        clearTimeout(timer);
        timer = setTimeout(redecorate, 100);
      });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeSearch(); }
        else if (e.key === "Enter") { e.preventDefault(); input.blur(); }
      });
      // senza testo la casella si chiude appena perde il focus
      input.addEventListener("blur", () => setTimeout(() => { if (box && !query.trim()) closeSearch(); }, 150));
      document.body.append(box);
      redecorate();  // aggiorna subito il conteggio
    }
    input.focus();
    input.select();
  }

  function closeSearch() {
    clearTimeout(timer);
    const had = terms.length > 0;
    query = "";
    terms = [];
    longText.clear();
    gen++;  // alla prossima ricerca rilegge descrizioni e note, magari modificate nel frattempo
    box?.remove();
    box = input = countEl = null;
    if (had) redecorate();
  }

  // "/" apre la ricerca, tranne mentre si scrive in un campo
  document.addEventListener("keydown", (e) => {
    if (e.key !== "/" || e.ctrlKey || e.altKey || e.metaKey) return;
    const t = e.target;
    if (t.isContentEditable || t.closest?.("input, textarea, select, [contenteditable]")) return;
    if (!document.querySelector(".o_kanban_renderer")) return;
    e.preventDefault();
    openSearch();
  });

  Object.assign(PS, { applySearch, openSearch, clearSearch: closeSearch });
})();
