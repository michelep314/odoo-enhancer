/* Ricerca rapida tra le schede kanban visibili (tasto / o 🔍 nella barra) */
(() => {
  "use strict";
  const PS = window.__ps;
  if (!PS || PS.ready) return;
  const { el, setFlag, recText, prioOf, PRIO } = PS;

  // minuscole e senza accenti: "Attività" trova "attivita"
  const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  let query = "", terms = [];
  let box = null, input = null, countEl = null, timer = null;

  // "@mario" = solo tra le persone, "#123" = numero della scheda, il resto ovunque; tutte le parole in AND
  function parse(q) {
    return q.trim().split(/\s+/).filter(Boolean).map((w) => {
      if (/^#\d+$/.test(w)) return { kind: "id", value: w.slice(1) };
      if (w.startsWith("@") && w.length > 1) return { kind: "user", value: norm(w.slice(1)) };
      return { kind: "text", value: norm(w) };
    });
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
      return (t.kind === "user" ? h.users : h.all).includes(t.value);
    });
  }

  // chiamata da decorate() a ogni giro, prima delle colonne (così i conteggi dei gruppi US ne tengono conto)
  function applySearch(records) {
    let shown = 0;
    for (const [card, rec] of records) {
      const hide = terms.length > 0 && !matches(rec);
      setFlag(card, "psSearch", hide);
      if (!hide) shown++;
    }
    if (!countEl) return;
    countEl.textContent = !records.length ? "Nessuna scheda kanban"
        : terms.length ? `${shown} di ${records.length} schede` : `${records.length} schede`;
  }

  const redecorate = () => {
    try { PS.decorate(); } catch (e) { console.warn("[pulsantiera] ricerca:", e); }
  };

  function openSearch() {
    if (!box) {
      input = el("input", { type: "search", placeholder: "Cerca: testo, US, etichetta, @persona, #numero",
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
