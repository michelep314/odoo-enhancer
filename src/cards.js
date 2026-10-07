/* Schede: etichetta US in alto colorata, chip di priorità, colore Odoo su tutta la scheda */
(() => {
  "use strict";
  const PS = window.__ps;
  if (!PS || PS.ready) return;
  const { TASK, getEnv, el, fail, isolate, store, popover, recText, kanbanRecords,
    PALETTE, rgba, PRIO, PRIO_ORDER, prioOf, prioButton, prioHex } = PS;

  /* ================= CONFIGURAZIONE ================= */
  const DECO_MODELS = [TASK];
  const TINT_CARDS = true;        // colora tutta la scheda con il colore impostato in Odoo
  const TINT_ALPHA = 0.2;         // intensità (0–1)
  const US_BADGE = true;          // mostra la US in alto
  const HIDE_ORIGINAL_US = true;  // nasconde la US nella posizione originale
  const TAG_BADGES = false;       // true = sposta in alto anche le altre etichette
  const TAG_FIELDS = ["tag_ids"]; // campi etichetta da spostare in alto
  const HIDE_ORIGINAL_TAGS = true;
  const US_RE = /^\s*US\s*-?\s*\d+(?:[.,]\d+)*\s*$/i;
  /* ================================================== */

  const COLORS = store("ps-us-colors-v1", {}, (v) => v && typeof v === "object");
  const usColors = COLORS.load();
  const saveUsColors = () => COLORS.save(usColors);

  const usKey = (v) => v.toUpperCase().replace(/\s+/g, "").replace(",", ".");
  const hashColor = (text) => {
    let h = 0;
    for (const ch of text.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return (h % 11) + 1;  // colore automatico, stabile per lo stesso testo
  };
  const usColor = (key) => usColors[key] || hashColor(key);
  // etichette: scelta locale > colore impostato in Odoo > automatico
  const tagColor = (key, text, odooColor) =>
      usColors[key] || (Number.isInteger(odooColor) && PALETTE[odooColor] ? odooColor : hashColor(text));

  // Trova la US: prima in un campo testo/relazione della scheda, poi tra le etichette
  let usField = null;
  function usValue(rec) {
    const d = rec.data || {}, f = rec.fields || {};
    if (usField) { const t = recText(rec, usField); if (t && US_RE.test(t)) return t.trim(); }
    for (const k of Object.keys(d)) {
      if (!["char", "many2one", "selection"].includes(f[k]?.type)) continue;
      const t = recText(rec, k);
      if (t && US_RE.test(t)) {
        if (usField !== k) console.log("[pulsantiera] US letta dal campo", k);
        usField = k;
        return t.trim();
      }
    }
    for (const k of Object.keys(d)) {
      if (f[k]?.type !== "many2many") continue;
      for (const r of d[k]?.records || []) {
        const t = r.data?.display_name || r.data?.name;
        if (typeof t === "string" && US_RE.test(t)) return t.trim();
      }
    }
    return null;
  }
  // durante un giro di decorate() la US di ogni record si calcola una volta sola
  let usMemo = null;
  const usOf = (rec) => {
    if (!usMemo) return usValue(rec);
    if (!usMemo.has(rec)) usMemo.set(rec, usValue(rec));
    return usMemo.get(rec);
  };

  // nasconde la US nella posizione originale; ricorda l'elemento per non riscansionare la scheda
  const usHidden = new WeakMap();
  function hideOriginal(card, value) {
    const prev = usHidden.get(card);
    if (prev?.value === value && prev.node.isConnected && card.contains(prev.node) && prev.node.dataset.psHidden) return;
    const hits = [...card.querySelectorAll("span, div, a, li")].filter((e) =>
        !e.closest(".ps-us") && e.children.length === 0 && e.textContent.trim() === value);
    if (hits.length !== 1) return;
    const t = hits[0].closest(".o_field_widget") || hits[0];
    if (t === card) return;
    if (!t.dataset.psHidden) t.dataset.psHidden = "1";
    usHidden.set(card, { value, node: t });
  }

  function badgeContainer(card) {
    const cs = getComputedStyle(card);
    if (cs.display.includes("flex") && cs.flexDirection.startsWith("row"))
      return card.querySelector(".oe_kanban_content, .oe_kanban_details") || card;
    return card;
  }

  function decorate() {
    if (!getEnv()) return;
    usMemo = new Map();
    try {
      const records = kanbanRecords();
      const cfgByGroup = new Map();
      const cfgOf = (g) => {
        if (!cfgByGroup.has(g)) cfgByGroup.set(g, PS.colSettings(PS.colName(g)));
        return cfgByGroup.get(g);
      };
      for (const [card, rec] of records) {
        if (!DECO_MODELS.includes(rec.resModel)) continue;
        const ccfg = cfgOf(card.closest(".o_kanban_group"));

        const c = rec.data?.color;
        const tint = TINT_CARDS && !ccfg.prio && Number.isInteger(c) && PALETTE[c] ? rgba(PALETTE[c][0], TINT_ALPHA) : null;
        if (tint) {
          if (card.style.getPropertyValue("--ps-tint") !== tint) card.style.setProperty("--ps-tint", tint);
          if (!card.dataset.psTint) card.dataset.psTint = "1";
        } else if (card.dataset.psTint) {
          delete card.dataset.psTint;
          card.style.removeProperty("--ps-tint");
        }

        const labels = [];
        const pk = ccfg.prio ? prioOf(rec) : null;
        if (pk) labels.push({ key: "prio:" + pk, text: PRIO[pk].label, ci: prioHex(pk), prio: pk });
        const v = US_BADGE ? usOf(rec) : null;
        if (v) labels.push({ key: usKey(v), text: v, ci: usColor(usKey(v)) });
        if (TAG_BADGES) {
          for (const f of TAG_FIELDS) {
            for (const r of rec.data?.[f]?.records || []) {
              const text = String(r.data?.display_name || r.data?.name || "").trim();
              if (!text || text === v) continue;
              const key = `tag:${r.resModel}:${r.resId}`;
              labels.push({ key, text, ci: tagColor(key, text, r.data?.color), tagModel: r.resModel, tagId: r.resId });
            }
          }
        }

        let box = card.querySelector(".ps-labels");
        if (!labels.length) { box?.remove(); continue; }
        if (!box) {
          box = el("div", { className: "ps-labels" });
          badgeContainer(card).prepend(box);
        }
        const sig = JSON.stringify(labels.map((l) => [l.key, l.text, l.ci]));
        if (box.dataset.sig !== sig) {
          box.dataset.sig = sig;
          box.replaceChildren(...labels.map((l) => makeChip(l, rec)));
        }
        if (v && HIDE_ORIGINAL_US) hideOriginal(card, v);
        if (TAG_BADGES && HIDE_ORIGINAL_TAGS) {
          for (const f of TAG_FIELDS) {
            const w = card.querySelector(`.o_field_widget[name="${f}"]`);
            if (w && !w.dataset.psHidden && !w.contains(box)) w.dataset.psHidden = "1";
          }
        }
      }
      PS.decorateColumns(records);
    } finally {
      usMemo = null;
    }
  }

  function makeChip(l, rec) {
    if (l.prio) {
      const pb = prioButton(l.prio, false);
      pb.title = `Priorità ${PRIO[l.prio].label.toLowerCase()}: clic per cambiarla`;
      pb.addEventListener("click", (e) => onPrioClick(e, rec));
      return isolate(pb);
    }
    const b = el("button", { type: "button", className: "ps-us", textContent: l.text,
      title: "Clic per cambiare il colore" });
    b.style.background = PALETTE[l.ci][0];
    b.style.color = PALETTE[l.ci][2] ? "#1d2029" : "#fff";
    b.addEventListener("click", (e) => onLabelClick(e, l, rec));
    return isolate(b);
  }

  /* selettore colore della US e della priorità */
  let picker = null;
  const closePicker = () => picker?.close();
  function openPicker(anchor, ...kids) {
    closePicker();
    const p = popover("ps-us-picker", { onClose: () => { if (picker === p) picker = null; } });
    picker = p;
    const n = p.node;
    n.append(...kids.filter(Boolean));
    const r = anchor.getBoundingClientRect();
    n.style.left = Math.max(8, Math.min(r.left, innerWidth - n.offsetWidth - 8)) + "px";
    n.style.top = (r.bottom + 6 + n.offsetHeight > innerHeight ? r.top - n.offsetHeight - 6 : r.bottom + 6) + "px";
  }

  async function setLabelColor(l, rec, ci, toOdoo) {
    closePicker();
    try {
      if (toOdoo && l.tagId && ci != null) {
        await getEnv().services.orm.write(l.tagModel, [l.tagId], { color: ci });
        delete usColors[l.key];
        saveUsColors();
        await rec.model.load().catch(() => {});
      } else {
        if (ci == null) delete usColors[l.key]; else usColors[l.key] = ci;
        saveUsColors();
      }
    } catch (e) { fail(e); }
    decorate();
  }

  function onPrioClick(e, rec) {
    e.preventDefault();
    e.stopPropagation();
    const cur = prioOf(rec);
    openPicker(e.currentTarget,
        el("div", { className: "t", textContent: "Priorità" }),
        el("div", { className: "prio-list" }, ...PRIO_ORDER.map((k) => {
          const o = prioButton(k, cur === k);
          o.onclick = async () => {
            closePicker();
            try {
              await getEnv().services.orm.write(rec.resModel, [rec.resId], { color: PRIO[k].color });
              await rec.model.load();
            } catch (err) { fail(err); }
          };
          return o;
        })));
  }

  function onLabelClick(e, l, rec) {
    e.preventDefault();
    e.stopPropagation();
    const odooChk = l.tagId ? el("input", { type: "checkbox" }) : null;
    openPicker(e.currentTarget,
        el("div", { className: "t", textContent: `Colore per ${l.text}` }),
        el("div", { className: "sw" }, ...PALETTE.slice(1).map(([hex, name], i) => {
          const s2 = el("button", { type: "button", title: name, className: l.ci === i + 1 ? "on" : "",
            onclick: () => setLabelColor(l, rec, i + 1, odooChk?.checked) });
          s2.style.background = hex;
          return s2;
        })),
        odooChk ? el("label", { className: "odoo" }, odooChk, "Salva in Odoo (lo vedono tutti)") : null,
        el("button", { type: "button", className: "auto", textContent: l.tagId ? "Colore di Odoo / automatico" : "Automatico",
          onclick: () => setLabelColor(l, rec, null, false) }));
  }

  let decoTimer = null;
  const scheduleDecorate = () => {
    clearTimeout(decoTimer);
    decoTimer = setTimeout(() => {
      try { decorate(); } catch (e) { console.warn("[pulsantiera] decorazione schede:", e); }
    }, 120);
  };

  Object.assign(PS, {
    DECO_MODELS, TAG_FIELDS, usValue, usOf, usKey, usColor, decorate, scheduleDecorate,
    usFieldName: () => usField,
  });
})();
