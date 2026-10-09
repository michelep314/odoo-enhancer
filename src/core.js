/* Odoo Enhancer — nucleo condiviso.
 * Ogni file è uno script classico eseguito nella pagina (world MAIN) e condivide lo stato tramite window.__ps.
 * Se l'estensione viene iniettata due volte, core.js non ricrea il namespace e gli altri file si fermano su PS.ready. */
(() => {
  "use strict";
  if (window.__ps) return;
  const PS = (window.__ps = {});

  /* ================= CONFIGURAZIONE ================= */
  const SPRINT_FIELD = "sprint";   // campo intero su project.task
  const TASK = "project.task";
  const TS_MODEL = "account.analytic.line";
  /* ================================================== */

  const getEnv = () => window.odoo?.__WOWL_DEBUG__?.root?.env;
  const mod = (name) => window.odoo?.loader?.modules?.get(name);
  const Domain = () => mod("@web/core/domain").Domain;
  const el = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    n.append(...kids.filter((k) => k != null));
    return n;
  };
  // come node.replaceChildren(...), ma scarta null/undefined (replaceChildren li scriverebbe come testo "null")
  const fill = (node, ...kids) => { node.replaceChildren(...kids.filter((k) => k != null)); return node; };
  const fail = (e) => say("Errore: " + (e?.data?.message || e?.message || e));

  // impedisce che Odoo avvii il trascinamento della scheda/colonna
  const isolate = (node) => {
    for (const ev of ["mousedown", "pointerdown"]) node.addEventListener(ev, (e) => e.stopPropagation());
    return node;
  };
  // casella con etichetta; l'input è raggiungibile con label.control
  const chk = (text, checked, onchange) => {
    const i = el("input", { type: "checkbox", checked });
    if (onchange) i.onchange = () => onchange(i.checked);
    return el("label", { className: "chk" }, i, text);
  };

  // attributo data-* booleano, scritto solo quando cambia
  const setFlag = (node, key, on) => {
    if (on) { if (!node.dataset[key]) node.dataset[key] = "1"; }
    else if (node.dataset[key]) delete node.dataset[key];
  };

  /* ---------- persistenza in localStorage ---------- */
  const storeKeys = new Map();  // chiave → validatore: usato dal backup della configurazione
  function store(key, fallback, valid) {
    storeKeys.set(key, valid);
    return {
      load() {
        try {
          const v = JSON.parse(localStorage.getItem(key));
          if (valid(v)) return v;
        } catch { /* predefinito */ }
        return structuredClone(fallback);
      },
      save(v) {
        try { localStorage.setItem(key, JSON.stringify(v)); }
        catch (e) { say("Salvataggio non riuscito: " + e.message); }
      },
    };
  }

  /* ---------- finestre di dialogo interne (al posto di alert/confirm/prompt del browser) ----------
     Restituiscono una Promise: say → true, ask → true/false, askText → testo o null (Annulla) */
  function dialog({ title = "", message = "", input = null, ok = "OK", cancel = null, danger = false }) {
    return new Promise((resolve) => {
      const prev = document.activeElement;
      let field = null;
      if (input) {
        field = el(input.multiline ? "textarea" : "input",
            { value: input.value ?? "", placeholder: input.placeholder || "", spellcheck: false, readOnly: !!input.readOnly });
        if (input.multiline) field.rows = 6;
      }
      const cancelValue = field && !input.readOnly ? null : !cancel;
      function done(v) {
        overlay.remove();
        document.removeEventListener("keydown", key, true);
        prev?.focus?.({ preventScroll: true });
        resolve(v);
      }
      const okBtn = el("button", { type: "button", className: danger ? "danger" : "primary", textContent: ok,
        onclick: () => done(field && !input.readOnly ? field.value : true) });
      const box = el("div", { className: "box" },
          title ? el("h4", { textContent: title }) : null,
          message ? el("p", { className: "msg", textContent: message }) : null,
          field,
          el("div", { className: "acts" },
              cancel ? el("button", { type: "button", textContent: cancel, onclick: () => done(cancelValue) }) : null, okBtn));
      box.setAttribute("role", cancel ? "alertdialog" : "dialog");
      box.setAttribute("aria-modal", "true");
      const overlay = el("div", { id: "ps-dialog" }, box);
      // clic sullo sfondo = Annulla (o chiude un semplice avviso)
      overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) done(cancel ? cancelValue : true); });
      // Esc annulla, Invio conferma (non dentro un testo su più righe); il resto della pagina non riceve i tasti
      const key = (e) => {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(cancel ? cancelValue : true); }
        else if (e.key === "Enter" && !(e.target.tagName === "TEXTAREA" && !e.ctrlKey)) { e.preventDefault(); e.stopPropagation(); okBtn.click(); }
      };
      document.addEventListener("keydown", key, true);
      document.body.append(overlay);
      if (field) { field.focus(); field.select(); } else okBtn.focus();
    });
  }
  const say = (message, title = "") => dialog({ title, message });
  const ask = (message, { ok = "OK", danger = false, title = "" } = {}) => dialog({ title, message, ok, danger, cancel: "Annulla" });
  const askText = (message, value = "", { ok = "OK", multiline = false, placeholder = "", title = "" } = {}) =>
    dialog({ title, message, ok, cancel: "Annulla", input: { value, multiline, placeholder } });
  // testo da copiare a mano (quando gli appunti non sono disponibili)
  const showText = (message, value) => dialog({ message, ok: "Chiudi", input: { value, readOnly: true, multiline: value.length > 80 } });

  /* ---------- popover flottante: si chiude con clic esterno o Esc ---------- */
  function popover(id, { ignore = null, onClose = null } = {}) {
    const node = el("div", { id });
    let open = true;
    // le finestre di dialogo aperte dal popover non lo chiudono
    const outside = (e) => {
      if (!node.contains(e.target) && !e.target.closest?.("#ps-dialog") && !(ignore && e.target.closest?.(ignore))) close();
    };
    const key = (e) => { if (e.key === "Escape" && !document.getElementById("ps-dialog")) close(); };
    function close() {
      if (!open) return;
      open = false;
      node.remove();
      document.removeEventListener("mousedown", outside, true);
      document.removeEventListener("keydown", key, true);
      onClose?.();
    }
    document.body.append(node);
    setTimeout(() => {
      if (!open) return;
      document.addEventListener("mousedown", outside, true);
      document.addEventListener("keydown", key, true);
    });
    return { node, close };
  }

  /* ---------- date e ore ---------- */
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const parseIso = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const fmtDay = (s) => parseIso(s).toLocaleDateString("it-IT",
      { weekday: "short", day: "numeric", month: "numeric", timeZone: "UTC" });
  const fmtHours = (h) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)}:${pad(m % 60)}`; };
  function* eachDay(from, to) {
    for (let d = parseIso(from); iso(d) <= to; d.setUTCDate(d.getUTCDate() + 1)) yield iso(d);
  }
  function parseHours(str) {
    const s = String(str).trim().replace(",", ".");
    const m = /^(\d{1,2}):([0-5]\d)$/.exec(s);
    const h = m ? Number(m[1]) + Number(m[2]) / 60 : Number(s);
    return s && Number.isFinite(h) && h > 0 && h <= 24 ? h : null;
  }

  /* ---------- Odoo ---------- */
  function evalCtx(env, b = {}) {
    const uid = env.services.user?.userId ?? odoo.__session_info__?.uid;
    const c = { ...env.services.user?.context, uid };
    if (b.activeId) Object.assign(c, { active_id: b.activeId, active_ids: [b.activeId] });
    return c;
  }

  // n-esimo valore distinto di sprint partendo dal più alto
  async function sprintValue(orm, offset) {
    let val;
    for (let i = 0; i <= offset; i++) {
      const dom = [[SPRINT_FIELD, "!=", false]];
      if (val !== undefined) dom.push([SPRINT_FIELD, "<", val]);
      const r = await orm.searchRead(TASK, dom, [SPRINT_FIELD], { order: `${SPRINT_FIELD} desc`, limit: 1 });
      if (!r.length) return null;
      val = r[0][SPRINT_FIELD];
    }
    return val;
  }

  // testo di un campo del record (char, many2one, relazione con display_name)
  const recText = (rec, k) => {
    const v = rec.data?.[k];
    if (typeof v === "string") return v.trim() || null;
    if (Array.isArray(v) && typeof v[1] === "string") return v[1];
    if (v && typeof v.display_name === "string") return v.display_name;
    return null;
  };

  /* ---------- schede kanban ↔ record Owl ---------- */
  const recIndex = new WeakMap();  // scheda DOM → record, aggiornata a ogni giro di kanbanRecords()

  function walkOwl(visit) {
    const root = getEnv() && odoo.__WOWL_DEBUG__.root.__owl__;
    const stack = root ? [root] : [];
    while (stack.length) {
      const n = stack.pop();
      if (n.component && visit(n.component)) return;
      for (const k in n.children) stack.push(n.children[k]);
    }
  }

  // Tutte le schede kanban visibili con il loro record (un solo giro dell'albero Owl)
  function kanbanRecords() {
    const out = [];
    walkOwl((c) => {
      const rec = c.props?.record, node = c.rootRef?.el;
      if (rec?.resId && node?.classList?.contains("o_kanban_record")) {
        out.push([node, rec]);
        recIndex.set(node, rec);
      }
    });
    return out;
  }

  // Record di una scheda: prima dall'indice, altrimenti risalendo l'albero Owl
  function findRecord(card) {
    const hit = recIndex.get(card);
    if (hit?.resId && card.isConnected) return hit;
    const dataId = card.dataset.id;
    let found = null;
    walkOwl((c) => {
      const rec = c.props?.record;
      if (rec?.resId && (c.rootRef?.el === card || (dataId && rec.id === dataId))) { found = rec; return true; }
      return false;
    });
    if (found) recIndex.set(card, found);
    return found;
  }

  /* ---------- icone ---------- */
  const ICONS = {
    open: "M4 4h16v16H4z M4 9h16",
    tag: "M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z M7.5 7.5h.01",
    user: "M20 21a8 8 0 0 0-16 0 M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10z",
    image: "M3 3h18v18H3z M8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M21 15l-5-5L5 21",
    clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 6v6l4 2",
    move: "M5 12h14 M13 6l6 6-6 6",
    zap: "M13 2L3 14h9l-1 8 10-12h-9l1-8z",
    copy: "M8 8h12v12H8z M4 16V4h12",
    link: "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7 M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7",
    archive: "M3 4h18v4H3z M5 8v12h14V8 M10 12h4",
    pencil: "M17 3l4 4L8 20H4v-4L17 3z",
    filter: "M3 4h18l-7 8v6l-4 2v-8L3 4z",
    hours: "M12 22a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 9v4l2 2 M10 2h4",
    palette: "M12 22a10 10 0 1 1 0-20c5.5 0 10 4 10 9 0 3-2.5 5-5 5h-2a2 2 0 0 0-1 3.7A2 2 0 0 1 12 22z M7.5 10.5h.01 M12 7.5h.01 M16.5 10.5h.01",
    search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M21 21l-5-5",
    plus: "M12 5v14 M5 12h14",
    sparkle: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z",
    note: "M14 3H5v18h14V8l-5-5z M14 3v5h5 M8 13h8 M8 17h5",
    bell: "M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9 M13.7 21a2 2 0 0 1-3.4 0",
    chevronLeft: "M15 18l-6-6 6-6",
    chevronRight: "M9 18l6-6-6-6",
  };
  const svg = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[k]}"/></svg>`;

  /* ---------- colori ---------- */
  // Tavolozza di Odoo 17: indice = valore del campo color. [esadecimale, nome, testo scuro]
  const PALETTE = [null,
    ["#F06050", "Rosso", false], ["#F4A460", "Arancione", true], ["#F7CD1F", "Giallo", true],
    ["#6CC1ED", "Celeste", true], ["#814968", "Viola scuro", false], ["#EB7E7F", "Salmone", true],
    ["#2C8397", "Verde acqua", false], ["#475577", "Blu scuro", false], ["#D6145F", "Fucsia", false],
    ["#30C381", "Verde", true], ["#9365B8", "Viola", false]];
  const hexRgb = (hex) => { const n = Number.parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const rgba = (hex, a) => `rgba(${hexRgb(hex).join(", ")}, ${a})`;
  const darkText = (hex) => { const [r, g, b] = hexRgb(hex); return 0.299 * r + 0.587 * g + 0.114 * b > 150; };
  const colorHex = (c) => {
    if (typeof c === "number") return PALETTE[c]?.[0];
    return typeof c === "string" ? c : null;
  };

  // Priorità dei bug ricavata dal colore della scheda in Odoo.
  // colors = indici della tavolozza che valgono quella priorità; il primo è quello scritto quando la si sceglie.
  const PRIO_ORDER = ["high", "medium", "low", "none"];
  const PRIO_DEFAULTS = {
    high: { label: "Alta", colors: [1] },
    medium: { label: "Media", colors: [3, 2] },  // giallo e arancione
    low: { label: "Bassa", colors: [10] },
    none: { label: "Da valutare", colors: [0] },
  };
  const PRIO_FIXED = {
    high: { rank: 1, bars: 3 }, medium: { rank: 2, bars: 2 }, low: { rank: 3, bars: 1 }, none: { rank: 4, bars: 0 },
  };
  const PRIO_STORE = store("ps-prio-v1", PRIO_DEFAULTS, (v) => v && typeof v === "object");
  const PRIO = {};
  const validColors = (cs) => Array.isArray(cs) && cs.length > 0 && cs.every((c) => Number.isInteger(c) && PALETTE[c]);
  function loadPrio(saved) {
    for (const k of PRIO_ORDER) {
      const s = saved[k] || {}, d = PRIO_DEFAULTS[k];
      let colors = [0];
      if (k !== "none") colors = validColors(s.colors) ? [...s.colors] : [...d.colors];
      PRIO[k] = {
        ...PRIO_FIXED[k],
        label: typeof s.label === "string" && s.label.trim() ? s.label.trim() : d.label,
        colors,
        get color() { return this.colors[0]; },
      };
    }
  }
  loadPrio(PRIO_STORE.load());
  const savePrio = () => PRIO_STORE.save(Object.fromEntries(PRIO_ORDER.map((k) =>
      [k, { label: PRIO[k].label, colors: PRIO[k].colors }])));
  const resetPrio = () => { loadPrio(PRIO_DEFAULTS); savePrio(); };
  // firma della configurazione: cambia quando cambiano nomi o colori
  const prioSig = () => JSON.stringify(PRIO_ORDER.map((k) => [PRIO[k].label, PRIO[k].colors]));
  const prioHex = (k) => (k === "none" ? "#9aa0b0" : PALETTE[PRIO[k].color][0]);

  const prioOf = (rec) => {
    const c = rec.data?.color || 0;
    return PRIO_ORDER.find((k) => PRIO[k].colors.includes(c)) || null;  // altri colori: nessuna priorità riconosciuta
  };
  const barRect = (i, on) =>
    `<rect x="${i * 4 + 0.5}" y="${8 - i * 3}" width="3" height="${4 + i * 3}" rx="0.8" fill="currentColor" opacity="${on ? 1 : 0.28}"/>`;
  const barsSvg = (k) => {
    const bars = [0, 1, 2].map((i) => barRect(i, i < PRIO[k].bars)).join("");
    return `<svg viewBox="0 0 12 12" aria-hidden="true">${bars}</svg>`;
  };
  function prioButton(k, on) {
    const b = el("button", { type: "button", className: `ps-prio ps-prio-${k}${on ? " on" : ""}` });
    b.style.setProperty("--pc", prioHex(k));
    b.innerHTML = barsSvg(k);
    b.append(PRIO[k].label);
    return b;
  }

  Object.assign(PS, {
    SPRINT_FIELD, TASK, TS_MODEL,
    getEnv, mod, Domain, el, fill, fail, dialog, say, ask, askText, showText, isolate, chk, setFlag, store, storeKeys, popover,
    pad, iso, parseIso, fmtDay, fmtHours, eachDay, parseHours,
    evalCtx, sprintValue, recText, kanbanRecords, findRecord, walkOwl,
    ICONS, svg, PALETTE, rgba, darkText, colorHex, PRIO, PRIO_ORDER, prioOf, prioButton,
    savePrio, resetPrio, prioSig, prioHex,
  });
})();
