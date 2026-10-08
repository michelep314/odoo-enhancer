/* Sfondo personalizzato (solo locale: niente viene caricato su Odoo) */
(() => {
  "use strict";
  const PS = window.__ps;
  if (!PS || PS.ready) return;
  const { el, fail, chk, store } = PS;

  const BG_PRESETS = {
    notte: ["Notte", "linear-gradient(135deg,#1e2a47 0%,#3a1f4d 100%)"],
    oceano: ["Oceano", "linear-gradient(135deg,#0f4c75 0%,#1b262c 100%)"],
    bosco: ["Bosco", "linear-gradient(135deg,#134e3a 0%,#1b2a24 100%)"],
    tramonto: ["Tramonto", "linear-gradient(135deg,#7a2e3a 0%,#2b1a3d 100%)"],
    aurora: ["Aurora", "linear-gradient(135deg,#0b3d3a 0%,#2a1e5c 55%,#5c1e4a 100%)"],
    grafite: ["Grafite", "linear-gradient(180deg,#2b2f38 0%,#16181d 100%)"],
  };

  // Le immagini stanno in IndexedDB del browser (più spazio di localStorage)
  const idb = (() => {
    let dbp = null;
    const db = () => dbp || (dbp = new Promise((res, rej) => {
      const r = indexedDB.open("ps-pulsantiera", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("files");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
    const tx = async (mode, fn) => {
      const d = await db();
      return new Promise((res, rej) => {
        const t = d.transaction("files", mode);
        const rq = fn(t.objectStore("files"));
        t.oncomplete = () => res(rq?.result);
        t.onerror = () => rej(t.error);
      });
    };
    return {
      get: (k) => tx("readonly", (st) => st.get(k)),
      set: (k, v) => tx("readwrite", (st) => st.put(v, k)),
      del: (k) => tx("readwrite", (st) => st.delete(k)),
      keys: () => tx("readonly", (st) => st.getAllKeys()),
    };
  })();

  const STORE = store("ps-bg-v1", { scopes: {}, kanbanOnly: true, glass: true },
      (v) => v && typeof v.scopes === "object");
  const bgCfg = STORE.load();
  const saveBg = () => STORE.save(bgCfg);

  // Dove sono: vista corrente e app corrente, letti dallo stato di Odoo (l'URL non sempre contiene action=).
  // Chiavi: "*" = tutte le pagine, "m<id>" = un'app, "a<azione>-<record>" o "x:<modello>:<nome>" = una vista.
  function currentPlace() {
    const env = PS.getEnv();
    const ctrl = env?.services.action?.currentController;
    const act = ctrl?.action;
    const hash = new URLSearchParams(location.hash.slice(1));
    const actionId = (typeof act?.id === "number" && act.id) || Number(hash.get("action")) || null;
    const activeId = act?.context?.active_id || Number(hash.get("active_id")) || 0;
    let view = null;
    if (actionId) view = `a${actionId}-${activeId}`;
    // azioni senza id (es. i pulsanti della barra): modello + nome, senza il numero di sprint
    else if (act?.res_model && act?.name) view = `x:${act.res_model}:${String(act.name).replace(/\s*\(#\d+\)$/, "")}`;
    const viewName = document.querySelector(".o_breadcrumb .active, .o_last_breadcrumb_item")?.textContent.trim()
        || ctrl?.displayName || act?.name || "questa vista";
    let app = null;
    try { app = env?.services.menu?.getCurrentApp?.() || null; } catch { /* menu non pronto */ }
    return { view, viewName, app: app ? `m${app.id}` : null, appName: app?.name || null };
  }
  // la vista vince sull'app, l'app su "tutte le pagine"
  const activeScope = (pl) => [pl.view, pl.app].find((k) => k && bgCfg.scopes[k]) || "*";

  // -80…80: negativo = sbiancamento (velo bianco), positivo = oscuramento (velo nero)
  const veilOf = (dim) => {
    const v = Math.max(-80, Math.min(80, Number(dim ?? 30))) / 100;
    return v < 0 ? `rgba(255,255,255,${-v})` : `rgba(0,0,0,${v})`;
  };
  const veilText = (v) => (v < 0 ? ` schiarisci ${-v}%` : v > 0 ? ` scurisci ${v}%` : " nessuno");

  // Risoluzione utile per questo schermo (tiene conto di HiDPI / zoom di sistema)
  const screenNeed = () => Math.ceil(Math.max(screen.width, screen.height) * (window.devicePixelRatio || 1));

  // Tiene l'originale se già adatto; altrimenti ridimensiona con ricampionamento di alta qualità
  async function prepareImage(file) {
    const probe = await createImageBitmap(file);
    const w = probe.width, h = probe.height;
    probe.close?.();
    const need = Math.max(2560, screenNeed());
    const long = Math.max(w, h);
    if (long <= need * 1.25 && file.size <= 15 * 1024 * 1024) return { blob: file, w, h, need, resized: false };
    const k = need / long;
    const bmp = await createImageBitmap(file, {
      resizeWidth: Math.round(w * k), resizeHeight: Math.round(h * k), resizeQuality: "high",
    });
    const c = document.createElement("canvas");
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, 0, 0);
    bmp.close?.();
    const blob = await new Promise((res, rej) =>
        c.toBlob((b) => (b ? res(b) : rej(new Error("conversione non riuscita"))), "image/webp", 0.93));
    return { blob, w, h, need, resized: true };
  }

  let bgSig = null, bgUrl = null;
  async function applyBg() {
    const scopeKey = activeScope(currentPlace());
    const sc = bgCfg.scopes[scopeKey];
    const sig = JSON.stringify([scopeKey, sc, bgCfg.kanbanOnly, bgCfg.glass]);
    if (sig === bgSig) return;
    bgSig = sig;
    const root = document.documentElement;
    let img = null;
    try {
      if (sc?.type === "preset") img = BG_PRESETS[sc.value]?.[1] || null;
      else if (sc?.type === "color") img = `linear-gradient(${sc.value}, ${sc.value})`;
      else if (sc?.type === "url") img = `url(${JSON.stringify(sc.value)})`;
      else if (sc?.type === "image") {
        const blob = await idb.get(sc.value);
        if (blob) {
          if (bgUrl) URL.revokeObjectURL(bgUrl);
          bgUrl = URL.createObjectURL(blob);
          img = `url(${JSON.stringify(bgUrl)})`;
        }
      }
    } catch (e) { console.warn("[pulsantiera] sfondo:", e); }
    if (!img) { delete root.dataset.psBg; delete root.dataset.psGlass; return; }
    root.style.setProperty("--ps-bg-img", img);
    root.style.setProperty("--ps-bg-veil", veilOf(sc.dim));
    root.dataset.psBg = bgCfg.kanbanOnly ? "kanban" : "all";
    if (bgCfg.glass) root.dataset.psGlass = "1"; else delete root.dataset.psGlass;
  }
  const reapplyBg = () => { bgSig = null; return applyBg(); };

  async function renderBg(panel) {
    const pl = currentPlace();
    const mark = (k) => (bgCfg.scopes[k] ? " ●" : "");  // ● = ha già uno sfondo
    const scopeSel = el("select", {},
        el("option", { value: "*", textContent: `Tutte le pagine${mark("*")}` }),
        pl.app ? el("option", { value: pl.app, textContent: `Tutta l'app "${pl.appName}"${mark(pl.app)}` }) : null,
        pl.view ? el("option", { value: pl.view, textContent: `Solo "${pl.viewName}"${mark(pl.view)}` }) : null);
    scopeSel.value = activeScope(pl);
    const cur = () => bgCfg.scopes[scopeSel.value];

    const dimIn = el("input", { type: "range", min: "-80", max: "80", step: "5" });
    dimIn.setAttribute("list", "ps-dim-ticks");
    const ticks = el("datalist", { id: "ps-dim-ticks" }, el("option", { value: "0" }));
    const dimOut = el("span", { className: "hint" });
    const syncDim = () => { dimIn.value = String(cur()?.dim ?? 30); dimOut.textContent = veilText(Number(dimIn.value)); };
    syncDim();

    async function setScope(sc) {
      const key = scopeSel.value, old = bgCfg.scopes[key];
      if (old?.type === "image" && (!sc || sc.value !== old.value)) await idb.del(old.value).catch(() => {});
      if (sc) bgCfg.scopes[key] = { ...sc, dim: Number(dimIn.value) };
      else delete bgCfg.scopes[key];
      saveBg();
      await reapplyBg();
    }
    const run = (p) => p.catch(fail);
    const toggle = (key) => (v) => { bgCfg[key] = v; saveBg(); reapplyBg(); };

    const tiles = el("div", { className: "bg-tiles" }, ...Object.entries(BG_PRESETS).map(([k, [name, css]]) => {
      const t = el("button", { type: "button", className: "bg-tile", title: name,
        onclick: () => run(setScope({ type: "preset", value: k })) }, el("span", { textContent: name }));
      t.style.backgroundImage = css;
      return t;
    }));

    const colorIn = el("input", { type: "color", value: cur()?.type === "color" ? cur().value : "#1e2a47" });
    colorIn.onchange = () => run(setScope({ type: "color", value: colorIn.value }));

    const fileIn = el("input", { type: "file", accept: "image/*" });
    fileIn.onchange = () => run((async () => {
      const f = fileIn.files?.[0];
      if (!f) return;
      const img = await prepareImage(f);
      const key = `bg:${scopeSel.value}`;
      await idb.set(key, img.blob);
      await setScope({ type: "image", value: key });
      fileIn.value = "";
      const need = screenNeed();
      if (Math.max(img.w, img.h) < need * 0.8) {
        alert(`L'immagine è ${img.w}×${img.h} px, ma il tuo schermo ne richiede circa ${need} sul lato lungo: apparirà sgranata. Usa un'immagine più grande.`);
      }
    })());

    const urlIn = el("input", { placeholder: "https://…/immagine.jpg" });
    const urlBtn = el("button", { textContent: "Usa link", onclick: () => run((async () => {
      let u;
      try { u = new URL(urlIn.value.trim()); } catch { return alert("Link non valido."); }
      if (!/^https?:$/.test(u.protocol)) return alert("Usa un link http o https.");
      const ok = await new Promise((res) => { const im = new Image(); im.onload = () => res(true); im.onerror = () => res(false); im.src = u.href; });
      if (!ok) return alert("Immagine non caricabile: link errato o bloccato dal sito che la ospita.");
      await setScope({ type: "url", value: u.href });
    })()) });

    dimIn.oninput = () => {
      dimOut.textContent = veilText(Number(dimIn.value));
      const c = cur();
      if (c) { c.dim = Number(dimIn.value); saveBg(); reapplyBg(); }
    };
    scopeSel.onchange = syncDim;

    panel.replaceChildren(
        el("h4", { textContent: "Sfondo" }),
        el("label", { textContent: "Applica a" }), scopeSel,
        el("p", { className: "hint", textContent: "La vista vince sull'app, l'app su tutte le pagine. ● = ha già uno sfondo." }),
        el("label", { textContent: "Sfumature" }), tiles,
        el("label", { textContent: "Tinta unita" }), colorIn,
        el("label", { textContent: "Immagine dal computer" }), fileIn,
        el("label", { textContent: "Immagine da link" }), el("div", { className: "inline" }, urlIn, urlBtn),
        el("label", {}, "Sbiancamento / oscuramento:", dimOut), dimIn, ticks,
        el("div", { className: "range-ends" }, el("span", { textContent: "Più chiaro" }), el("span", { textContent: "Più scuro" })),
        chk("Solo nelle viste kanban", bgCfg.kanbanOnly, toggle("kanbanOnly")),
        chk("Colonne semitrasparenti", bgCfg.glass, toggle("glass")),
        ...PS.lookControls(),
        el("p", { className: "hint", textContent: "L'immagine resta solo in questo browser: niente viene caricato su Odoo e i colleghi non la vedono." }),
        el("div", { className: "acts" },
            el("button", { textContent: "Rimuovi sfondo", onclick: () => run(setScope(null)) }),
            el("button", { textContent: "Chiudi", onclick: () => PS.togglePanel("bg") })));
  }

  Object.assign(PS, { applyBg, renderBg, idb });
})();
