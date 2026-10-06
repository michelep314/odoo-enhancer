/* Colonne: filtro, raggruppamento, colore intestazione, campi nascosti, azioni; aspetto delle schede */
(() => {
  "use strict";
  const PS = window.__ps;
  if (!PS || PS.ready) return;
  const { el, isolate, chk, store, popover, svg, recText, kanbanRecords,
    PALETTE, darkText, colorHex, PRIO, PRIO_ORDER, prioOf, DECO_MODELS, TAG_FIELDS, usOf, usKey, usColor } = PS;

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
  const STORE = store("ps-cols-v1", COLS_DEFAULT, (v) => v && v.cols && v.look);
  const colCfg = STORE.load();
  const saveCols = () => STORE.save(colCfg);
  const colFilters = {};    // filtri attivi, per colonna (fino al ricaricamento della pagina)
  const colCollapsed = {};  // gruppi US chiusi, per colonna

  const colName = (g) => (g && !g.classList.contains("o_column_folded")
      ? g.querySelector(".o_column_title")?.textContent.trim() || null : null);
  const colSettings = (name) => {
    const r = { ...(colCfg.cols["*"] || {}), ...((name && colCfg.cols[name.toLowerCase()]) || {}) };
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
    const nf = { ...(colFilters[lname] || {}), ...patch };
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

  const setOrder = (node, o) => { if (node.style.order !== o) node.style.order = o; };
  const setCollapsed = (card, on) => {
    if (on) { if (!card.dataset.psCollapsed) card.dataset.psCollapsed = "1"; }
    else if (card.dataset.psCollapsed) delete card.dataset.psCollapsed;
  };
  const clickOnly = (node, fn) => {
    node.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
    return isolate(node);
  };

  function decorateColumns(records) {
    if (document.documentElement.dataset.psHeadall) measureHeadExt();
    const byGroup = new Map();
    for (const [card, rec] of records) {
      const g = card.closest(".o_kanban_group");
      if (!g || !DECO_MODELS.includes(rec.resModel)) continue;
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push([card, rec]);
    }
    for (const g of document.querySelectorAll(".o_kanban_group")) {
      const name = colName(g);
      if (!name) continue;
      const lname = name.toLowerCase(), cfg = colSettings(name), recs = byGroup.get(g) || [];
      if (!recs.length && !g.querySelector(".o_kanban_record") && !byGroup.size) continue;

      ensureColBtn(g, name, !!colFilters[lname] || !!cfg.groupUs);

      // campi nascosti + filtro
      const flt = colFilters[lname];
      for (const [card, rec] of recs) {
        hideTexts(card, (cfg.hide || []).map((f) => recText(rec, f)).filter(Boolean));
        const show = !flt || matchFilter(rec, flt);
        if (show) { if (card.dataset.psFiltered) delete card.dataset.psFiltered; }
        else if (!card.dataset.psFiltered) card.dataset.psFiltered = "1";
      }

      // riepilogo priorità nell'intestazione (clic = filtro)
      const head = g.querySelector(":scope > .o_kanban_header");
      let sum = head?.querySelector(".ps-prio-sum");
      if (cfg.prio && head) {
        const counts = { high: 0, medium: 0, low: 0, none: 0 };
        for (const [, r] of recs) counts[prioOf(r) || "none"]++;
        if (!sum) {
          sum = isolate(el("div", { className: "ps-prio-sum" }));
          head.append(sum);
        }
        const active = colFilters[lname]?.prio || "";
        const sig = JSON.stringify([counts, active]);
        if (sum.dataset.sig !== sig) {
          sum.dataset.sig = sig;
          sum.replaceChildren(...PRIO_ORDER.filter((k) => counts[k]).map((k) => {
            const b = el("button", { type: "button", className: `ps-prio-dot ps-prio-${k}${active === k ? " on" : ""}`,
              title: `${PRIO[k].label}: ${counts[k]} (clic per filtrare)` }, el("span", { className: "d" }), String(counts[k]));
            b.setAttribute("aria-pressed", String(active === k));
            b.addEventListener("click", (e) => {
              e.preventDefault();
              e.stopPropagation();
              setColFilter(lname, { prio: colFilters[lname]?.prio === k ? null : k });
              PS.decorate();
            });
            return b;
          }));
        }
      } else sum?.remove();

      // ordine: gruppi per US e/o priorità (alta → bassa)
      const prioSort = cfg.prio && cfg.prioSort;
      const rankOf = (rec) => (prioSort ? PRIO[prioOf(rec) || "none"].rank : 0);
      const seps = g.querySelectorAll(":scope > .ps-usgroup");
      if (cfg.groupUs) {
        if (!g.dataset.psSort) g.dataset.psSort = "1";
        const groups = new Map();
        const none = { label: "Senza US", items: [] };
        for (const [card, rec] of recs) {
          const v = usOf(rec);
          if (!v) { none.items.push([card, rec]); continue; }
          const k = usKey(v);
          if (!groups.has(k)) groups.set(k, { label: v, items: [] });
          groups.get(k).items.push([card, rec]);
        }
        const list = [...groups].sort((a, b) => natCmp(a[0], b[0]));
        if (none.items.length && list.length) list.push(["__none", none]);
        const closed = colCollapsed[lname] || (colCollapsed[lname] = new Set());
        const sepByKey = new Map([...seps].map((s) => [s.dataset.key, s]));
        const seen = new Set();
        list.forEach(([k, gr], i) => {
          seen.add(k);
          let sep = sepByKey.get(k);
          if (!sep) {
            sep = clickOnly(el("button", { type: "button", className: "ps-usgroup" }), () => {
              if (closed.has(k)) closed.delete(k); else closed.add(k);
              PS.decorate();
            });
            sep.dataset.key = k;
            g.append(sep);
          }
          const total = gr.items.length;
          const visible = gr.items.filter(([c]) => !c.dataset.psFiltered).length;
          const isClosed = closed.has(k);
          const ci = k === "__none" ? null : usColor(k);
          const hex = ci ? PALETTE[ci][0] : "#8d90a0";
          const fg = !ci || PALETTE[ci][2] ? "#1d2029" : "#fff";
          const sig = JSON.stringify([gr.label, visible, total, isClosed, hex]);
          if (sep.dataset.sig !== sig) {
            sep.dataset.sig = sig;
            sep.style.setProperty("--ps-us-c", hex);
            sep.style.setProperty("--ps-us-fg", fg);
            sep.setAttribute("aria-expanded", String(!isClosed));
            sep.title = isClosed ? "Clic per mostrare le schede" : "Clic per nascondere le schede";
            sep.replaceChildren(
                el("span", { className: "chev", textContent: isClosed ? "▸" : "▾" }),
                el("span", { className: "name", textContent: gr.label }),
                el("span", { className: "count", textContent: visible === total ? String(visible) : `${visible}/${total}` }));
          }
          setOrder(sep, String(i * 10));
          sep.hidden = visible === 0;
          for (const [c, r] of gr.items) {
            setOrder(c, String(i * 10 + 1 + rankOf(r)));
            setCollapsed(c, isClosed);
          }
        });
        if (!list.length) for (const [card, rec] of recs) setOrder(card, String(rankOf(rec)));
        for (const sep of seps) if (!seen.has(sep.dataset.key)) sep.remove();
      } else if (prioSort) {
        if (!g.dataset.psSort) g.dataset.psSort = "1";
        for (const sep of seps) sep.remove();
        for (const [card, rec] of recs) {
          setOrder(card, String(rankOf(rec)));
          setCollapsed(card, false);
        }
      } else if (g.dataset.psSort) {
        delete g.dataset.psSort;
        for (const [card] of recs) { card.style.removeProperty("order"); delete card.dataset.psCollapsed; }
        for (const sep of seps) sep.remove();
      }
    }
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
    const p = popover("ps-colpop", { ignore: ".ps-colbtn", onClose: () => { if (colPop === p) colPop = null; } });
    colPop = p;
    const pop = p.node;
    pop.dataset.col = name;

    function draw() {
      const recs = kanbanRecords().filter(([c, r]) => c.closest(".o_kanban_group") === g && DECO_MODELS.includes(r.resModel));
      const cur = scope === "*" ? (colCfg.cols["*"] || {}) : colSettings(name);
      const refresh = () => { PS.decorate(); draw(); };
      const edit = (fn) => {
        if (scope !== "*" && !colCfg.cols[scope]) colCfg.cols[scope] = structuredClone(colSettings(name));
        fn(colCfg.cols[scope] || (colCfg.cols[scope] = {}));
        saveCols();
        refresh();
      };

      /* filtro: US ed etichetta insieme (solo questa colonna, temporaneo) */
      const fl = colFilters[lname] || {};
      const usCount = new Map(), tagCount = new Map();
      let noUs = 0, usTot = 0, tagTot = 0;
      for (const [, r] of recs) {
        if (tagOk(r, fl)) {
          usTot++;
          const v = usOf(r);
          if (v) { const k = usKey(v); usCount.set(k, [v, (usCount.get(k)?.[1] || 0) + 1]); } else noUs++;
        }
        if (usOk(r, fl)) {
          tagTot++;
          for (const t of tagNames(r)) tagCount.set(t, (tagCount.get(t) || 0) + 1);
        }
      }
      if (fl.us && fl.us !== "__none" && !usCount.has(fl.us)) usCount.set(fl.us, [fl.us, 0]);
      if (fl.tag && !tagCount.has(fl.tag)) tagCount.set(fl.tag, 0);
      const setFilter = (patch) => { setColFilter(lname, patch); refresh(); };
      const usSel = el("select", { title: "User story" },
          el("option", { value: "", textContent: `Tutte le US (${usTot})` }),
          ...[...usCount].sort((a, b) => natCmp(a[0], b[0])).map(([k, [v, n]]) =>
              el("option", { value: k, textContent: `${v} (${n})` })),
          noUs || fl.us === "__none" ? el("option", { value: "__none", textContent: `Senza US (${noUs})` }) : null);
      usSel.value = fl.us || "";
      usSel.onchange = () => setFilter({ us: usSel.value || null });
      const tagSel = el("select", { title: "Etichetta" },
          el("option", { value: "", textContent: `Tutte le etichette (${tagTot})` }),
          ...[...tagCount].sort((a, b) => a[0].localeCompare(b[0])).map(([t, n]) =>
              el("option", { value: t, textContent: `${t} (${n})` })));
      tagSel.value = fl.tag || "";
      tagSel.onchange = () => setFilter({ tag: tagSel.value || null });
      const shown = recs.filter(([, r]) => matchFilter(r, fl)).length;
      let prioSel = null;
      if (colSettings(name).prio) {
        const pc = { high: 0, medium: 0, low: 0, none: 0 };
        let pTot = 0;
        for (const [, r] of recs) if (usOk(r, fl) && tagOk(r, fl)) { pTot++; pc[prioOf(r) || "none"]++; }
        prioSel = el("select", { title: "Priorità" },
            el("option", { value: "", textContent: `Tutte le priorità (${pTot})` }),
            ...PRIO_ORDER.map((k) => el("option", { value: k, textContent: `${PRIO[k].label} (${pc[k]})` })));
        prioSel.value = fl.prio || "";
        prioSel.onchange = () => setFilter({ prio: prioSel.value || null });
      }

      /* colore della fascia intestazioni (vale per tutte le colonne) */
      const look = colCfg.look;
      const setHead = (v) => { look.header = v; saveCols(); applyLook(); refresh(); };
      const curHex = colorHex(look.header);
      const sw = el("div", { className: "sw" },
          el("button", { type: "button", className: look.header == null ? "on none" : "none", title: "Nessun colore", textContent: "∅",
            onclick: () => setHead(null) }),
          ...PALETTE.slice(1).map(([hx, nm], i) => {
            const b = el("button", { type: "button", title: nm, className: look.header === i + 1 ? "on" : "",
              onclick: () => setHead(i + 1) });
            b.style.background = hx;
            return b;
          }));
      const custom = el("input", { type: "color", value: curHex || "#714b67", title: "Colore personalizzato" });
      custom.onchange = () => setHead(custom.value);

      /* campi nascosti: campi testo/relazione presenti nelle schede di questa colonna */
      const usField = PS.usFieldName();
      const cand = new Map();
      for (const [, r] of recs) {
        for (const k of Object.keys(r.data || {})) {
          if (k === "name" || k === usField || !["many2one", "char"].includes(r.fields?.[k]?.type)) continue;
          if (recText(r, k)) cand.set(k, r.fields[k].string || k);
        }
      }
      for (const k of cur.hide || []) if (!cand.has(k)) cand.set(k, k);
      const hideList = [...cand].sort((a, b) => a[1].localeCompare(b[1])).map(([k, label]) =>
          chk(label, (cur.hide || []).includes(k), (v) => edit((c) => {
            const set = new Set(c.hide || []);
            if (v) set.add(k); else set.delete(k);
            c.hide = [...set];
          })));

      /* azioni della modifica rapida */
      const qeList = Object.entries(QE_LABELS).map(([k, label]) =>
          chk(label, !(cur.qeHidden || []).includes(k), (v) => edit((c) => {
            const set = new Set(c.qeHidden || []);
            if (v) set.delete(k); else set.add(k);
            c.qeHidden = [...set];
          })));

      const scopeSel = el("select", {},
          el("option", { value: lname, textContent: `Solo la colonna "${name}"` }),
          el("option", { value: "*", textContent: "Tutte le colonne (predefinito)" }));
      scopeSel.value = scope;
      scopeSel.onchange = () => { scope = scopeSel.value; draw(); };

      pop.replaceChildren(
          el("h4", { textContent: name }),
          el("label", { className: "lbl", textContent: "Filtra le schede (temporaneo)" }),
          el("div", { className: "fl" }, usSel, tagSel),
          prioSel ? el("div", { className: "fl one" }, prioSel) : null,
          el("p", { className: "hint", textContent: colFilters[lname]
                ? `Visibili ${shown} di ${recs.length} schede.` : "Puoi combinare user story ed etichetta." }),
          colFilters[lname] ? el("div", { className: "acts tight" }, el("button", { type: "button", textContent: "Azzera filtri",
            onclick: () => { delete colFilters[lname]; refresh(); } })) : null,
          el("h4", { className: "sep", textContent: "Impostazioni" }),
          scopeSel,
          chk("Raggruppa per user story", !!cur.groupUs, (v) => edit((c) => { c.groupUs = v; })),
          chk("Priorità dal colore della scheda", !!cur.prio, (v) => edit((c) => { c.prio = v; })),
          cur.prio ? chk("Ordina per priorità (alta → bassa)", !!cur.prioSort, (v) => edit((c) => { c.prioSort = v; })) : null,
          cur.prio ? el("p", { className: "hint", textContent: "Rosso = alta, giallo = media, verde = bassa, nessun colore = da valutare." }) : null,
          el("label", { className: "lbl", textContent: "Colore intestazioni (fascia su tutte le colonne)" }),
          el("div", { className: "inline" }, sw, custom),
          el("label", { className: "lbl", textContent: "Nascondi nelle schede" }),
          hideList.length ? el("div", { className: "list" }, ...hideList)
              : el("p", { className: "hint", textContent: "Nessun campo testuale da nascondere in questa colonna." }),
          el("label", { className: "lbl", textContent: "Azioni della modifica rapida" }),
          el("div", { className: "list two" }, ...qeList),
          el("div", { className: "acts" },
              scope !== "*" && colCfg.cols[scope]
                  ? el("button", { type: "button", textContent: "Usa impostazioni generali",
                    onclick: () => { delete colCfg.cols[scope]; saveCols(); refresh(); } })
                  : null,
              el("button", { type: "button", textContent: "Chiudi", onclick: closeColPop })));
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
    const hh = colorHex(l.header);
    if (hh) {
      root.style.setProperty("--ps-head", hh);
      root.style.setProperty("--ps-head-fg", darkText(hh) ? "#1d2029" : "#fff");
      root.dataset.psHeadall = "1";
      measureHeadExt();
    } else if (root.dataset.psHeadall) {
      delete root.dataset.psHeadall;
      root.style.removeProperty("--ps-head");
      root.style.removeProperty("--ps-head-fg");
    }
    if (!l.on) { delete root.dataset.psLook; delete root.dataset.psShadow; return; }
    root.dataset.psLook = "1";
    root.style.setProperty("--ps-radius", `${l.radius}px`);
    root.style.setProperty("--ps-col-radius", `${l.colRadius}px`);
    root.style.setProperty("--ps-gap", `${l.gap}px`);
    if (l.shadow) root.dataset.psShadow = "1"; else delete root.dataset.psShadow;
  }
  function lookControls() {
    const l = colCfg.look;
    const upd = () => { saveCols(); applyLook(); };
    const rng = (label, key, max) => {
      const out = el("span", { className: "hint", textContent: ` ${l[key]} px` });
      const i = el("input", { type: "range", min: "0", max: String(max), step: "1", value: String(l[key]) });
      i.oninput = () => { l[key] = Number(i.value); out.textContent = ` ${i.value} px`; upd(); };
      return [el("label", {}, label, out), i];
    };
    return [
      el("h4", { className: "sep", textContent: "Schede e colonne" }),
      chk("Stile arrotondato (tipo Trello)", l.on, (v) => { l.on = v; upd(); }),
      ...rng("Angoli delle schede", "radius", 20),
      ...rng("Angoli delle colonne", "colRadius", 24),
      ...rng("Spazio tra le schede", "gap", 20),
      chk("Ombra sotto le schede", l.shadow, (v) => { l.shadow = v; upd(); }),
    ];
  }

  Object.assign(PS, { colName, colSettings, decorateColumns, applyLook, lookControls });
})();
