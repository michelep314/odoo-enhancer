/* Colonne: filtro, raggruppamento, colore intestazione, campi nascosti, azioni; aspetto delle schede */
(() => {
  "use strict";
  const PS = window.__ps;
  if (!PS || PS.ready) return;
  const { el, isolate, chk, setFlag, store, popover, svg, recText, kanbanRecords,
    PALETTE, darkText, colorHex, PRIO, PRIO_ORDER, prioOf, prioButton, prioHex, prioSig, savePrio, resetPrio, DECO_MODELS, TAG_FIELDS, usOf, usKey, usColor } = PS;

  const QE_LABELS = {
    open: "Apri scheda", hours: "Registra ore", tag: "Modifica etichette", user: "Modifica membri",
    image: "Cambia copertina", clock: "Modifica le date", palette: "Colore scheda / Priorità", move: "Sposta",
    zap: "Sprint", copy: "Copia scheda", link: "Copia link", archive: "Archivia",
  };
  // "*" = tutte le colonne; le altre chiavi sono i nomi delle colonne in minuscolo
  const COLS_DEFAULT = {
    cols: {
      "*": { qeHidden: ["hours"] },
      backlog: { hide: ["project_id", "milestone_id"], qeHidden: [] },
    },
    look: { on: true, radius: 10, colRadius: 12, gap: 8, shadow: true },
  };
  const STORE = store("ps-cols-v1", COLS_DEFAULT, (v) => v?.cols && v.look);
  const colCfg = STORE.load();
  const saveCols = () => STORE.save(colCfg);
  const HEAD_GLASS = "glass";  // valore di look.header per le intestazioni "liquid glass"
  const colFilters = {};    // filtri attivi, per colonna (fino al ricaricamento della pagina)
  const colCollapsed = {};  // gruppi US chiusi, per colonna

  const colName = (g) => (g && !g.classList.contains("o_column_folded")
      ? g.querySelector(".o_column_title")?.textContent.trim() || null : null);
  const colSettings = (name) => {
    const r = { ...colCfg.cols["*"], ...(name && colCfg.cols[name.toLowerCase()]) };
    if (r.prio === undefined) r.prio = !!name && /bug/i.test(name);  // colonne "bug": priorità attiva di default
    return r;
  };

  const tagNames = (rec) => TAG_FIELDS.flatMap((f) =>
      (rec.data?.[f]?.records || []).map((r) => String(r.data?.display_name || r.data?.name || "").trim()).filter(Boolean));
  const natCmp = (a, b) => {
    const x = (a.match(/\d+/g) || []).map(Number), y = (b.match(/\d+/g) || []).map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const d = (x[i] ?? -1) - (y[i] ?? -1);
      if (d) return d;
    }
    return a.localeCompare(b);
  };

  // nasconde l'elemento più esterno che contiene esattamente quei testi (icona compresa).
  // Ricorda cosa ha nascosto: se testi ed elementi sono invariati non riscansiona la scheda.
  const colHidden = new WeakMap();
  function hideTexts(card, values) {
    const sig = values.join("\u0000");
    const prev = colHidden.get(card);
    if (prev?.sig === sig && prev.nodes.every((n) => n.isConnected && n.dataset.psColhide && card.contains(n))) return;
    for (const e of card.querySelectorAll("[data-ps-colhide]")) delete e.dataset.psColhide;
    const nodes = [];
    if (values.length) {
      const want = new Set(values);
      for (const e of card.querySelectorAll("*")) {
        if (e.closest(".ps-labels, .ps-colbtn")) continue;
        const t = e.textContent.trim();
        if (!want.has(t) || e.parentElement?.textContent.trim() === t) continue;
        e.dataset.psColhide = "1";
        nodes.push(e);
      }
    }
    colHidden.set(card, { sig, nodes });
  }

  // filtro = { us: chiave US | "__none" | null, tag: nome etichetta | null, prio }, in AND
  const usOk = (rec, f) => {
    if (!f?.us) return true;
    const v = usOf(rec);
    return f.us === "__none" ? !v : !!v && usKey(v) === f.us;
  };
  const tagOk = (rec, f) => !f?.tag || tagNames(rec).includes(f.tag);
  const prioOk = (rec, f) => !f?.prio || (prioOf(rec) || "none") === f.prio;
  const matchFilter = (rec, f) => usOk(rec, f) && tagOk(rec, f) && prioOk(rec, f);
  const setColFilter = (lname, patch) => {
    const nf = { ...colFilters[lname], ...patch };
    if (!nf.us && !nf.tag && !nf.prio) delete colFilters[lname]; else colFilters[lname] = nf;
  };

  // fascia delle intestazioni: estende il colore anche negli spazi tra le colonne
  function measureHeadExt() {
    const gs = document.querySelectorAll(".o_kanban_view .o_kanban_group:not(.o_column_folded)");
    const h = gs[0]?.querySelector(":scope > .o_kanban_header");
    if (!h) return;
    const gr = gs[0].getBoundingClientRect(), hr = h.getBoundingClientRect();
    const gap = gs[1] ? Math.max(0, gs[1].getBoundingClientRect().left - gr.right) : 0;
    const ext = `${Math.max(0, Math.ceil(gap / 2 + (hr.left - gr.left))) + 1}px`;
    const root = document.documentElement;
    if (root.style.getPropertyValue("--ps-head-ext") !== ext) root.style.setProperty("--ps-head-ext", ext);
  }

  // intestazioni tutte alte come la più alta (con o senza colore): il riepilogo priorità
  // non crea più un gradino né nella fascia né all'inizio delle schede
  function equalizeHeads() {
    const root = document.documentElement;
    root.style.removeProperty("--ps-head-h");  // misuro l'altezza naturale
    const heads = document.querySelectorAll(".o_kanban_view .o_kanban_group:not(.o_column_folded) > .o_kanban_header");
    if (heads.length < 2) return;
    let max = 0;
    for (const h of heads) max = Math.max(max, h.getBoundingClientRect().height);
    root.style.setProperty("--ps-head-h", `${Math.ceil(max)}px`);
  }
  let resizeTimer = null;
  addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(equalizeHeads, 150);
  });

  const setOrder = (node, o) => { if (node.style.order !== o) node.style.order = o; };
  const clickOnly = (node, fn) => {
    node.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
    return isolate(node);
  };
  const prioCounts = (recs) => {
    const counts = { high: 0, medium: 0, low: 0, none: 0 };
    for (const [, r] of recs) counts[prioOf(r) || "none"]++;
    return counts;
  };
  const rankFn = (prioSort) => (rec) => (prioSort ? PRIO[prioOf(rec) || "none"].rank : 0);

  function groupByColumn(records) {
    const byGroup = new Map();
    for (const [card, rec] of records) {
      const g = card.closest(".o_kanban_group");
      if (!g || !DECO_MODELS.includes(rec.resModel)) continue;
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push([card, rec]);
    }
    return byGroup;
  }

  // campi nascosti + filtro
  function applyHideAndFilter(recs, cfg, flt) {
    for (const [card, rec] of recs) {
      hideTexts(card, (cfg.hide || []).map((f) => recText(rec, f)).filter(Boolean));
      setFlag(card, "psFiltered", !!flt && !matchFilter(rec, flt));
    }
  }

  function prioDot(k, n, lname, on) {
    const b = el("button", { type: "button", className: `ps-prio-dot ps-prio-${k}${on ? " on" : ""}`,
      title: `${PRIO[k].label}: ${n} (clic per filtrare)` }, el("span", { className: "d" }), String(n));
    b.style.setProperty("--pc", prioHex(k));
    b.setAttribute("aria-pressed", String(on));
    return clickOnly(b, () => {
      setColFilter(lname, { prio: colFilters[lname]?.prio === k ? null : k });
      PS.decorate();
    });
  }

  // riepilogo priorità nell'intestazione (clic = filtro)
  function renderPrioSummary(g, cfg, lname, recs) {
    const head = g.querySelector(":scope > .o_kanban_header");
    let sum = head?.querySelector(".ps-prio-sum");
    if (!cfg.prio || !head) { sum?.remove(); return; }
    const counts = prioCounts(recs);
    if (!sum) {
      sum = isolate(el("div", { className: "ps-prio-sum" }));
      head.append(sum);
    }
    const active = colFilters[lname]?.prio || "";
    const sig = JSON.stringify([counts, active, prioSig()]);
    if (sum.dataset.sig === sig) return;
    sum.dataset.sig = sig;
    sum.replaceChildren(...PRIO_ORDER.filter((k) => counts[k]).map((k) => prioDot(k, counts[k], lname, active === k)));
  }

  // [chiave US, { label, items }] in ordine naturale, con "Senza US" in fondo
  function usGroups(recs) {
    const groups = new Map();
    const none = { label: "Senza US", items: [] };
    for (const item of recs) {
      const v = usOf(item[1]);
      if (!v) { none.items.push(item); continue; }
      const k = usKey(v);
      if (!groups.has(k)) groups.set(k, { label: v, items: [] });
      groups.get(k).items.push(item);
    }
    const list = [...groups].sort((a, b) => natCmp(a[0], b[0]));
    if (none.items.length && list.length) list.push(["__none", none]);
    return list;
  }

  function createUsSep(g, k, closed) {
    const sep = clickOnly(el("button", { type: "button", className: "ps-usgroup" }), () => {
      if (closed.has(k)) closed.delete(k); else closed.add(k);
      PS.decorate();
    });
    sep.dataset.key = k;
    // trascinando la testata si sposta tutto il blocco in un'altra colonna (isolate blocca il trascinamento di Odoo)
    sep.draggable = true;
    sep.addEventListener("dragstart", (e) => {
      usDrag = { g, k };
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", sep.querySelector(".name")?.textContent || k);
      sep.classList.add("ps-dragging");
      document.documentElement.dataset.psUsdrag = "1";
    });
    sep.addEventListener("dragend", () => { sep.classList.remove("ps-dragging"); endUsDrag(); });
    g.append(sep);
    return sep;
  }

  /* spostamento di un blocco US: trascino la testata su un'altra colonna (anche chiusa) */
  let usDrag = null, overCol = null;
  const markOver = (t) => {
    if (overCol === t) return;
    overCol?.classList.remove("ps-usdrop");
    t?.classList.add("ps-usdrop");
    overCol = t;
  };
  function endUsDrag() {
    usDrag = null;
    markOver(null);
    delete document.documentElement.dataset.psUsdrag;
  }
  const dropCol = (e) => {
    const t = usDrag && e.target.closest?.(".o_kanban_view .o_kanban_group");
    return t && t !== usDrag.g ? t : null;
  };
  document.addEventListener("dragover", (e) => {
    if (!usDrag) return;
    const t = dropCol(e);
    markOver(t);
    if (t) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }
  });
  document.addEventListener("drop", (e) => {
    const t = dropCol(e);
    if (!t) return;
    e.preventDefault();
    e.stopPropagation();
    const { g, k } = usDrag;
    endUsDrag();
    moveUsBlock(g, k, t).catch(PS.fail);
  });

  // lista raggruppata del kanban (modello Owl) e gruppo che corrisponde a una colonna del DOM
  function kanbanList() {
    let list = null;
    PS.walkOwl((c) => {
      const l = c.props?.list;
      if (l && Array.isArray(l.groups) && l.groupBy?.length) { list = l; return true; }
      return false;
    });
    return list;
  }
  function groupOf(list, g) {
    const title = g.querySelector(".o_column_title")?.textContent.trim();
    const byName = list.groups.filter((gr) => String(gr.displayName ?? "").trim() === title);
    if (byName.length === 1) return byName[0];
    const cols = [...g.parentElement.querySelectorAll(":scope > .o_kanban_group")];
    return list.groups[cols.indexOf(g)] || null;  // nomi doppi: stesso ordine di Odoo
  }

  async function moveUsBlock(fromG, k, toG) {
    const list = kanbanList();
    const by = String(list?.groupBy?.[0] || "");
    const field = by.split(":")[0];
    const src = list && groupOf(list, fromG), dst = list && groupOf(list, toG);
    const type = list?.fields?.[field]?.type;
    if (!src || !dst || !field || by.includes(":") || ["many2many", "one2many"].includes(type)) {
      return alert("In questa vista non riesco a spostare il blocco: le colonne non corrispondono a un campo modificabile.");
    }
    // le schede del blocco visibili (escluse quelle nascoste da filtro o ricerca; quelle del gruppo chiuso contano)
    const recs = kanbanRecords().filter(([c, r]) => c.closest(".o_kanban_group") === fromG && DECO_MODELS.includes(r.resModel)
        && !c.dataset.psFiltered && !c.dataset.psSearch && (k === "__none" ? !usOf(r) : !!usOf(r) && usKey(usOf(r)) === k));
    if (!recs.length) return;
    const label = k === "__none" ? "senza US" : `di ${usOf(recs[0][1])}`;
    const loaded = src.list?.records?.length ?? recs.length;
    const note = src.count > loaded ? "\n\nLa colonna non è caricata del tutto: vengono spostate solo le schede già visibili." : "";
    if (!confirm(`Spostare ${recs.length} ${recs.length === 1 ? "scheda" : "schede"} ${label} da "${src.displayName}" a "${dst.displayName}"?${note}`)) return;
    const { orm, notification } = PS.getEnv().services;
    const value = Array.isArray(dst.value) ? dst.value[0] : dst.value ?? false;
    await orm.write(recs[0][1].resModel, recs.map(([, r]) => r.resId), { [field]: value });
    await (list.model?.load ? list.model.load() : list.load());
    notification?.add(`${recs.length} ${recs.length === 1 ? "scheda spostata" : "schede spostate"} in "${dst.displayName}".`, { type: "success" });
  }

  function paintUsSep(sep, k, gr, visible, isClosed) {
    const total = gr.items.length;
    const ci = k === "__none" ? null : usColor(k);
    const hex = ci ? PALETTE[ci][0] : "#8d90a0";
    const fg = !ci || PALETTE[ci][2] ? "#1d2029" : "#fff";
    const sig = JSON.stringify([gr.label, visible, total, isClosed, hex]);
    if (sep.dataset.sig === sig) return;
    sep.dataset.sig = sig;
    sep.style.setProperty("--ps-us-c", hex);
    sep.style.setProperty("--ps-us-fg", fg);
    sep.setAttribute("aria-expanded", String(!isClosed));
    sep.title = `${isClosed ? "Clic per mostrare le schede" : "Clic per nascondere le schede"}; trascina per spostare il blocco in un'altra colonna`;
    sep.replaceChildren(
        el("span", { className: "chev", textContent: isClosed ? "▸" : "▾" }),
        el("span", { className: "name", textContent: gr.label }),
        k === "__none" ? null : colorDot(k, gr.label),
        el("span", { className: "count", textContent: visible === total ? String(visible) : `${visible}/${total}` }));
  }

  // pallino nella testata: apre il selettore del colore di quella US (senza chiudere il gruppo)
  function colorDot(k, label) {
    const dot = el("span", { className: "dot", role: "button", tabIndex: 0, title: `Cambia il colore di ${label}` });
    const openPicker = (e) => {
      e.preventDefault();
      e.stopPropagation();
      PS.openUsColorPicker(dot, k, label);
    };
    dot.addEventListener("click", openPicker);
    dot.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") openPicker(e); });
    return dot;
  }

  function sortByUs(g, lname, recs, rankOf, seps) {
    const list = usGroups(recs);
    const closed = colCollapsed[lname] || (colCollapsed[lname] = new Set());
    const sepByKey = new Map(seps.map((s) => [s.dataset.key, s]));
    list.forEach(([k, gr], i) => {
      const sep = sepByKey.get(k) || createUsSep(g, k, closed);
      const visible = gr.items.filter(([c]) => !c.dataset.psFiltered && !c.dataset.psSearch).length;
      const isClosed = closed.has(k);
      paintUsSep(sep, k, gr, visible, isClosed);
      setOrder(sep, String(i * 10));
      sep.hidden = visible === 0;
      for (const [c, r] of gr.items) {
        setOrder(c, String(i * 10 + 1 + rankOf(r)));
        setFlag(c, "psCollapsed", isClosed);
      }
    });
    if (!list.length) for (const [card, rec] of recs) setOrder(card, String(rankOf(rec)));
    const seen = new Set(list.map(([k]) => k));
    for (const sep of seps) if (!seen.has(sep.dataset.key)) sep.remove();
  }

  // ordine: gruppi per US e/o priorità (alta → bassa)
  function applyOrder(g, cfg, lname, recs) {
    const prioSort = !!(cfg.prio && cfg.prioSort);
    const rankOf = rankFn(prioSort);
    const seps = [...g.querySelectorAll(":scope > .ps-usgroup")];
    if (cfg.groupUs) {
      setFlag(g, "psSort", true);
      sortByUs(g, lname, recs, rankOf, seps);
    } else if (prioSort) {
      setFlag(g, "psSort", true);
      for (const sep of seps) sep.remove();
      for (const [card, rec] of recs) {
        setOrder(card, String(rankOf(rec)));
        setFlag(card, "psCollapsed", false);
      }
    } else if (g.dataset.psSort) {
      delete g.dataset.psSort;
      for (const [card] of recs) { card.style.removeProperty("order"); delete card.dataset.psCollapsed; }
      for (const sep of seps) sep.remove();
    }
  }

  // Con spazio 0 le schede visibili formano pile (separate dalle testate US):
  // segno la prima e l'ultima di ogni pila, le sole con gli angoli arrotondati
  const isCard = (n) => n.classList.contains("o_kanban_record") && !n.classList.contains("o_kanban_ghost");
  const isShown = (n) => !n.hidden && !n.dataset.psFiltered && !n.dataset.psSearch && !n.dataset.psCollapsed;
  // Testata US e prima scheda del gruppo aperto sono attaccate: si squadrano gli angoli che si toccano
  function markStackEnds(g) {
    const cards = [...g.children].filter(isCard);
    const seps = [...g.children].filter((n) => n.classList.contains("ps-usgroup"));
    const stack = !!document.documentElement.dataset.psStack;
    const sorted = !!g.dataset.psSort;  // con l'ordinamento attivo gli elementi senza order vanno in fondo
    const seq = !stack && !seps.length ? [] : [...g.children]
        .filter((n) => (isCard(n) || n.classList.contains("ps-usgroup")) && isShown(n))
        .map((n, i) => [n, n.style.order !== "" ? Number(n.style.order) : sorted ? 100000 : 0, i])
        .sort((a, b) => a[1] - b[1] || a[2] - b[2])
        .map(([n]) => n);
    const first = new Set(), last = new Set(), usFirst = new Set(), joined = new Set();
    let prev = null;
    seq.forEach((n, i) => {
      if (!isCard(n)) {
        if (prev) last.add(prev);
        prev = null;
        if (seq[i + 1] && isCard(seq[i + 1])) { joined.add(n); usFirst.add(seq[i + 1]); }
        return;
      }
      if (!prev) first.add(n);
      prev = n;
    });
    if (prev) last.add(prev);
    for (const c of cards) {
      setFlag(c, "psFirst", stack && first.has(c));
      setFlag(c, "psLast", stack && last.has(c));
      setFlag(c, "psUsfirst", usFirst.has(c));
    }
    for (const s of seps) setFlag(s, "psJoined", joined.has(s));
  }

  function decorateColumn(g, name, recs) {
    const lname = name.toLowerCase(), cfg = colSettings(name);
    ensureColBtn(g, name, !!colFilters[lname] || !!cfg.groupUs);
    applyHideAndFilter(recs, cfg, colFilters[lname]);
    renderPrioSummary(g, cfg, lname, recs);
    applyOrder(g, cfg, lname, recs);
    markStackEnds(g);
  }

  function decorateColumns(records) {
    if (document.documentElement.dataset.psHeadall) measureHeadExt();
    const byGroup = groupByColumn(records);
    for (const g of document.querySelectorAll(".o_kanban_group")) {
      const name = colName(g);
      if (!name) continue;
      const recs = byGroup.get(g) || [];
      if (!recs.length && !g.querySelector(".o_kanban_record") && !byGroup.size) continue;
      decorateColumn(g, name, recs);
    }
    equalizeHeads();
  }

  function ensureColBtn(g, name, active) {
    const head = g.querySelector(".o_kanban_header_title") || g.querySelector(".o_kanban_header");
    if (!head) return;
    let b = head.querySelector(".ps-colbtn");
    if (!b) {
      b = el("button", { type: "button", className: "ps-colbtn" });
      b.innerHTML = svg("filter");
      clickOnly(b, () => openColPop(g, b));
      const cfgBtn = head.querySelector(".o_kanban_config");
      if (cfgBtn) cfgBtn.parentElement.insertBefore(b, cfgBtn); else head.append(b);
    }
    b.classList.toggle("on", active);
    const t = active ? `Colonna "${name}": filtro o raggruppamento attivo` : `Personalizza la colonna "${name}"`;
    if (b.title !== t) b.title = t;
  }

  /* priorità personalizzate: nome e colori di ogni livello (valgono per tutte le colonne) */
  const colorName = (c) => PALETTE[c][1].toLowerCase();
  const prioLegend = () => PRIO_ORDER.map((k) =>
      `${k === "none" ? "nessun colore" : PRIO[k].colors.map(colorName).join(" o ")} = ${PRIO[k].label.toLowerCase()}`)
      .join(", ").replace(/^./, (c) => c.toUpperCase()) + ".";

  // clic su un colore: libero → si aggiunge; secondario → diventa principale; principale → si toglie
  function cyclePrioColor(k, c) {
    const own = PRIO[k].colors, pos = own.indexOf(c);
    if (pos === -1) {
      const other = PRIO_ORDER.find((o) => o !== k && PRIO[o].colors.includes(c));
      if (other) {
        if (PRIO[other].colors.length === 1) {
          alert(`${PALETTE[c][1]} è l'unico colore di "${PRIO[other].label}": aggiungi prima un altro colore a quella priorità.`);
          return false;
        }
        PRIO[other].colors = PRIO[other].colors.filter((x) => x !== c);
      }
      own.push(c);
    } else if (pos > 0) {
      own.splice(pos, 1);
      own.unshift(c);
    } else if (own.length > 1) {
      own.shift();
    } else {
      alert("Ogni priorità deve avere almeno un colore.");
      return false;
    }
    return true;
  }

  // stato di un colore nell'editor della priorità k: classe del pulsante e suggerimento
  function swatchState(k, c, nm) {
    const pos = PRIO[k].colors.indexOf(c);
    if (pos === 0) return { className: "on main", title: `${nm}: colore usato quando scegli "${PRIO[k].label}" (clic per toglierlo)` };
    if (pos > 0) return { className: "on", title: `${nm}: vale anche come "${PRIO[k].label}" (clic per renderlo principale)` };
    const owner = PRIO_ORDER.find((o) => o !== k && PRIO[o].colors.includes(c));
    if (owner) return { className: "taken", title: `${nm}: ora vale "${PRIO[owner].label}" (clic per spostarlo qui)` };
    return { className: "", title: `${nm}: clic per aggiungerlo` };
  }

  function prioSwatches(k, commit) {
    if (k === "none") return el("p", { className: "hint", textContent: "Schede senza colore." });
    return el("div", { className: "sw" }, ...PALETTE.slice(1).map(([hx, nm], i) => {
      const c = i + 1;
      const b = el("button", { type: "button", ...swatchState(k, c, nm),
        onclick: () => { if (cyclePrioColor(k, c)) commit(); } });
      b.style.background = hx;
      return b;
    }));
  }

  function prioEditor(onChange) {
    const commit = () => { savePrio(); onChange(); };
    const rows = PRIO_ORDER.map((k) => {
      const preview = prioButton(k, false);
      preview.classList.add("pv");
      preview.tabIndex = -1;
      const name = el("input", { value: PRIO[k].label, maxLength: 24, title: "Nome della priorità" });
      name.onchange = () => {
        const v = name.value.trim();
        if (v && v !== PRIO[k].label) { PRIO[k].label = v; commit(); } else name.value = PRIO[k].label;
      };
      const colors = prioSwatches(k, commit);
      return el("div", { className: "prio-row" }, el("div", { className: "prio-head" }, preview, name), colors);
    });
    return [
      ...rows,
      el("p", { className: "hint", textContent: "Clic su un colore per aggiungerlo; di nuovo per renderlo principale (quello scritto quando scegli la priorità, con il punto); ancora per toglierlo." }),
      el("div", { className: "acts tight" }, el("button", { type: "button", textContent: "Ripristina priorità predefinite",
        onclick: () => { if (confirm("Ripristinare nomi e colori predefiniti delle priorità?")) { resetPrio(); onChange(); } } })),
    ];
  }

  /* sezioni del popover della colonna */
  const toggled = (list, k, add) => {
    const set = new Set(list || []);
    if (add) set.add(k); else set.delete(k);
    return [...set];
  };
  const scopeCfg = (scope, name) => (scope === "*" ? colCfg.cols["*"] || {} : colSettings(name));
  function editColCfg(scope, name, fn) {
    if (scope !== "*" && !colCfg.cols[scope]) colCfg.cols[scope] = structuredClone(colSettings(name));
    fn(colCfg.cols[scope] || (colCfg.cols[scope] = {}));
    saveCols();
  }

  // options = [[valore, testo]]; onPick riceve il valore scelto o null per "tutte"
  function filterSelect(title, allLabel, options, value, onPick) {
    const sel = el("select", { title },
        el("option", { value: "", textContent: allLabel }),
        ...options.map(([v, text]) => el("option", { value: v, textContent: text })));
    sel.value = value || "";
    sel.onchange = () => onPick(sel.value || null);
    return sel;
  }

  function usSelect(recs, fl, setFilter) {
    const counts = new Map();
    let noUs = 0, tot = 0;
    for (const [, r] of recs) {
      if (!tagOk(r, fl)) continue;
      tot++;
      const v = usOf(r);
      if (!v) { noUs++; continue; }
      const k = usKey(v);
      counts.set(k, [v, (counts.get(k)?.[1] || 0) + 1]);
    }
    if (fl.us && fl.us !== "__none" && !counts.has(fl.us)) counts.set(fl.us, [fl.us, 0]);
    const options = [...counts].sort((a, b) => natCmp(a[0], b[0])).map(([k, [v, n]]) => [k, `${v} (${n})`]);
    if (noUs || fl.us === "__none") options.push(["__none", `Senza US (${noUs})`]);
    return filterSelect("User story", `Tutte le US (${tot})`, options, fl.us, (us) => setFilter({ us }));
  }

  function tagSelect(recs, fl, setFilter) {
    const counts = new Map();
    let tot = 0;
    for (const [, r] of recs) {
      if (!usOk(r, fl)) continue;
      tot++;
      for (const t of tagNames(r)) counts.set(t, (counts.get(t) || 0) + 1);
    }
    if (fl.tag && !counts.has(fl.tag)) counts.set(fl.tag, 0);
    const options = [...counts].sort((a, b) => a[0].localeCompare(b[0])).map(([t, n]) => [t, `${t} (${n})`]);
    return filterSelect("Etichetta", `Tutte le etichette (${tot})`, options, fl.tag, (tag) => setFilter({ tag }));
  }

  function prioSelect(recs, fl, setFilter) {
    const sub = recs.filter(([, r]) => usOk(r, fl) && tagOk(r, fl));
    const pc = prioCounts(sub);
    const options = PRIO_ORDER.map((k) => [k, `${PRIO[k].label} (${pc[k]})`]);
    return filterSelect("Priorità", `Tutte le priorità (${sub.length})`, options, fl.prio, (prio) => setFilter({ prio }));
  }

  // filtro: US, etichetta e priorità insieme (solo questa colonna, temporaneo)
  function filterSection(recs, active, withPrio, setFilter, clear) {
    const fl = active || {};
    const shown = recs.filter(([, r]) => matchFilter(r, fl)).length;
    const hint = active ? `Visibili ${shown} di ${recs.length} schede.` : "Puoi combinare user story ed etichetta.";
    return [
      el("label", { className: "lbl", textContent: "Filtra le schede (temporaneo)" }),
      el("div", { className: "fl" }, usSelect(recs, fl, setFilter), tagSelect(recs, fl, setFilter)),
      withPrio ? el("div", { className: "fl one" }, prioSelect(recs, fl, setFilter)) : null,
      el("p", { className: "hint", textContent: hint }),
      active ? el("div", { className: "acts tight" },
          el("button", { type: "button", textContent: "Azzera filtri", onclick: clear })) : null,
    ];
  }

  function prioSettings(cur, edit, open, onToggle, refresh) {
    if (!cur.prio) return [];
    return [
      chk("Ordina per priorità (alta → bassa)", !!cur.prioSort, (v) => edit((c) => { c.prioSort = v; })),
      el("p", { className: "hint", textContent: prioLegend() }),
      el("div", { className: "acts tight" }, el("button", {
        type: "button", textContent: open ? "Chiudi personalizzazione priorità" : "Personalizza priorità…",
        ariaExpanded: String(open), onclick: onToggle,
      })),
      open ? el("div", { className: "prio-edit" }, ...prioEditor(refresh)) : null,
    ];
  }

  // colore della fascia intestazioni (vale per tutte le colonne)
  function headerColorSection(setHead) {
    const header = colCfg.look.header;
    const sw = el("div", { className: "sw" },
        el("button", { type: "button", className: header == null ? "on none" : "none", title: "Nessun colore", textContent: "∅",
          onclick: () => setHead(null) }),
        el("button", { type: "button", className: header === HEAD_GLASS ? "on glass" : "glass",
          title: "Liquid glass: vetro smerigliato trasparente", onclick: () => setHead(HEAD_GLASS) }),
        ...PALETTE.slice(1).map(([hx, nm], i) => {
          const b = el("button", { type: "button", title: nm, className: header === i + 1 ? "on" : "",
            onclick: () => setHead(i + 1) });
          b.style.background = hx;
          return b;
        }));
    const custom = el("input", { type: "color", value: (header !== HEAD_GLASS && colorHex(header)) || "#714b67",
      title: "Colore personalizzato" });
    custom.onchange = () => setHead(custom.value);
    return [
      el("label", { className: "lbl", textContent: "Colore intestazioni (fascia su tutte le colonne)" }),
      el("div", { className: "inline" }, sw, custom),
    ];
  }

  // campi testo/relazione presenti nelle schede della colonna, più quelli già nascosti
  function hideCandidates(recs, hidden) {
    const usField = PS.usFieldName();
    const cand = new Map();
    for (const [, r] of recs) {
      for (const k of Object.keys(r.data || {})) {
        if (k === "name" || k === usField || !["many2one", "char"].includes(r.fields?.[k]?.type)) continue;
        if (recText(r, k)) cand.set(k, r.fields[k].string || k);
      }
    }
    for (const k of hidden) if (!cand.has(k)) cand.set(k, k);
    return [...cand].sort((a, b) => a[1].localeCompare(b[1]));
  }

  function hideSection(recs, cur, editToggle) {
    const hidden = cur.hide || [];
    const list = hideCandidates(recs, hidden).map(([k, label]) =>
        chk(label, hidden.includes(k), (v) => editToggle("hide", k, v)));
    return [
      el("label", { className: "lbl", textContent: "Nascondi nelle schede" }),
      list.length ? el("div", { className: "list" }, ...list)
          : el("p", { className: "hint", textContent: "Nessun campo testuale da nascondere in questa colonna." }),
    ];
  }

  // azioni della modifica rapida
  function qeSection(cur, editToggle) {
    const hidden = cur.qeHidden || [];
    const list = Object.entries(QE_LABELS).map(([k, label]) =>
        chk(label, !hidden.includes(k), (v) => editToggle("qeHidden", k, !v)));
    return [
      el("label", { className: "lbl", textContent: "Azioni della modifica rapida" }),
      el("div", { className: "list two" }, ...list),
    ];
  }

  function resetScopeButton(scope, refresh) {
    if (scope === "*" || !colCfg.cols[scope]) return null;
    return el("button", { type: "button", textContent: "Usa impostazioni generali",
      onclick: () => { delete colCfg.cols[scope]; saveCols(); refresh(); } });
  }

  // stile delle testate dei gruppi US (vale per tutte le colonne)
  function usHeadSection(refresh) {
    const sel = el("select", { title: "Stile delle testate delle user story" },
        el("option", { value: "solid", textContent: "Testate piene, nel colore della US" }),
        el("option", { value: "soft", textContent: "Testate leggere, solo bordo colorato" }));
    sel.value = colCfg.look.usHead || "solid";
    sel.onchange = () => { colCfg.look.usHead = sel.value; saveCols(); applyLook(); refresh(); };
    return el("div", { className: "sub" }, sel,
        el("p", { className: "hint", textContent: "Il colore di ogni US si cambia dal pallino nella sua testata." }));
  }

  /* popover della colonna */
  let colPop = null;
  const closeColPop = () => colPop?.close();

  function openColPop(g, btn) {
    const name = colName(g);
    if (!name) return;
    if (colPop?.node.dataset.col === name) return closeColPop();
    closeColPop();
    const lname = name.toLowerCase();
    let scope = lname;
    let prioOpen = false;  // editor delle priorità aperto
    const p = popover("ps-colpop", { ignore: ".ps-colbtn", onClose: () => { if (colPop === p) colPop = null; } });
    colPop = p;
    const pop = p.node;
    pop.dataset.col = name;

    function draw() {
      const recs = kanbanRecords().filter(([c, r]) => c.closest(".o_kanban_group") === g && DECO_MODELS.includes(r.resModel));
      const cur = scopeCfg(scope, name);
      const refresh = () => { PS.decorate(); draw(); };
      const edit = (fn) => { editColCfg(scope, name, fn); refresh(); };
      const editToggle = (prop, k, add) => edit((c) => { c[prop] = toggled(c[prop], k, add); });
      const setFilter = (patch) => { setColFilter(lname, patch); refresh(); };
      const clearFilter = () => { delete colFilters[lname]; refresh(); };
      const setHead = (v) => { colCfg.look.header = v; saveCols(); applyLook(); refresh(); };
      const togglePrio = () => { prioOpen = !prioOpen; draw(); };

      const scopeSel = el("select", {},
          el("option", { value: lname, textContent: `Solo la colonna "${name}"` }),
          el("option", { value: "*", textContent: "Tutte le colonne (predefinito)" }));
      scopeSel.value = scope;
      scopeSel.onchange = () => { scope = scopeSel.value; draw(); };

      pop.replaceChildren(...[
        el("h4", { textContent: name }),
        ...filterSection(recs, colFilters[lname], colSettings(name).prio, setFilter, clearFilter),
        el("h4", { className: "sep", textContent: "Impostazioni" }),
        scopeSel,
        chk("Raggruppa per user story", !!cur.groupUs, (v) => edit((c) => { c.groupUs = v; })),
        cur.groupUs ? usHeadSection(refresh) : null,
        chk("Priorità dal colore della scheda", !!cur.prio, (v) => edit((c) => { c.prio = v; })),
        ...prioSettings(cur, edit, prioOpen, togglePrio, refresh),
        ...headerColorSection(setHead),
        ...hideSection(recs, cur, editToggle),
        ...qeSection(cur, editToggle),
        el("div", { className: "acts" }, resetScopeButton(scope, refresh),
            el("button", { type: "button", textContent: "Chiudi", onclick: closeColPop })),
      ].filter(Boolean));
    }

    draw();
    const r = btn.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(r.left - 20, innerWidth - pop.offsetWidth - 8)) + "px";
    pop.style.top = Math.max(8, Math.min(r.bottom + 6, innerHeight - pop.offsetHeight - 8)) + "px";
  }

  /* aspetto: angoli arrotondati, spazio, ombra (regolabili dal pannello Sfondo) */
  function applyLook() {
    const l = colCfg.look, root = document.documentElement;
    root.dataset.psHeaders = "1";
    root.dataset.psUshead = l.usHead || "solid";  // testate dei gruppi US: piene o leggere
    const glass = l.header === HEAD_GLASS;
    const hh = glass ? null : colorHex(l.header);
    setFlag(root, "psHeadglass", glass);
    if (hh || glass) {
      root.style.setProperty("--ps-head", hh || "transparent");
      root.style.setProperty("--ps-head-fg", hh && darkText(hh) ? "#1d2029" : "#fff");
      root.dataset.psHeadall = "1";
      measureHeadExt();
      equalizeHeads();
    } else if (root.dataset.psHeadall) {
      delete root.dataset.psHeadall;
      root.style.removeProperty("--ps-head");
      root.style.removeProperty("--ps-head-fg");
      equalizeHeads();
    }
    // angoli e ombra delle schede sono indipendenti; "on" regola spazio e angoli delle colonne
    setFlag(root, "psRound", l.round !== false && Number(l.radius) > 0);
    setFlag(root, "psShadow", !!l.shadow);
    root.style.setProperty("--ps-radius", `${l.radius}px`);
    setFlag(root, "psLook", !!l.on);
    setFlag(root, "psStack", !!l.on && Number(l.gap) === 0);  // schede attaccate: si arrotondano solo le estremità
    if (!l.on) return;
    root.style.setProperty("--ps-col-radius", `${l.colRadius}px`);
    root.style.setProperty("--ps-gap", `${l.gap}px`);
  }
  function lookControls() {
    const l = colCfg.look;
    const upd = () => { saveCols(); applyLook(); PS.decorate(); };
    const rng = (label, key, max) => {
      const out = el("span", { className: "hint", textContent: ` ${l[key]} px` });
      const i = el("input", { type: "range", min: "0", max: String(max), step: "1", value: String(l[key]) });
      i.oninput = () => { l[key] = Number(i.value); out.textContent = ` ${i.value} px`; upd(); };
      return [el("label", {}, label, out), i];
    };
    return [
      el("h4", { className: "sep", textContent: "Schede e colonne" }),
      chk("Angoli arrotondati delle schede", l.round !== false, (v) => { l.round = v; upd(); }),
      ...rng("Raggio degli angoli delle schede", "radius", 20),
      chk("Ombra sotto le schede", l.shadow, (v) => { l.shadow = v; upd(); }),
      chk("Spazio e colonne personalizzati (tipo Trello)", l.on, (v) => { l.on = v; upd(); }),
      ...rng("Spazio tra le schede", "gap", 20),
      ...rng("Angoli delle colonne", "colRadius", 24),
      el("p", { className: "hint", textContent: "Con spazio 0 px le schede formano una pila: si arrotondano solo la prima e l'ultima." }),
    ];
  }

  Object.assign(PS, { colName, colSettings, decorateColumns, applyLook, lookControls });
})();
