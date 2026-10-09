/* Backup e ripristino di tutta la configurazione dell'estensione in un unico file JSON */
(() => {
  "use strict";
  const PS = window.__ps;
  if (!PS || PS.ready) return;
  const { el, fail, chk, storeKeys } = PS;

  const FORMAT = 1;
  const SECTIONS = {
    "ps-buttons-v1": "Pulsanti della barra",
    "ps-timesheet-v1": "Righe salvate dei fogli ore",
    "ps-us-colors-v1": "Colori delle US",
    "ps-prio-v1": "Priorità",
    "ps-cols-v1": "Colonne e aspetto",
    "ps-bg-v1": "Sfondo",
    "ps-whatsnew-v1": "Novità già lette",
    "ps-tray-v1": "Strumenti compressi o aperti",
  };
  const sectionName = (k) => SECTIONS[k] || k;

  const blobToDataUrl = (b) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });
  // decodifica locale: fetch("data:…") può essere bloccato dalla CSP di Odoo
  function dataUrlToBlob(u) {
    const m = /^data:([^;,]*);base64,(.*)$/s.exec(u);
    if (!m) throw new Error("immagine non valida nel backup");
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: m[1] || "application/octet-stream" });
  }

  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = el("a", { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportConfig(withImages) {
    const data = {};
    for (const k of storeKeys.keys()) {
      const raw = localStorage.getItem(k);
      if (raw == null) continue;
      try { data[k] = JSON.parse(raw); } catch { /* valore corrotto: non lo esporto */ }
    }
    const images = {};
    if (withImages) {
      for (const k of await PS.idb.keys()) {
        const b = await PS.idb.get(k);
        if (b instanceof Blob) images[k] = await blobToDataUrl(b);
      }
    }
    const file = { app: "odoo-enhancer", format: FORMAT, exportedAt: new Date().toISOString(), data, images };
    download(`odoo-enhancer-backup-${new Date().toLocaleDateString("sv")}.json`, JSON.stringify(file, null, 2));
  }

  async function importConfig(file) {
    let parsed;
    try { parsed = JSON.parse(await file.text()); } catch { throw new Error("il file non è un JSON valido"); }
    if (parsed?.app !== "odoo-enhancer" || !parsed.data || typeof parsed.data !== "object")
      throw new Error("il file non è un backup di Odoo Enhancer");
    if (parsed.format !== FORMAT) throw new Error(`formato ${parsed.format} non supportato`);

    // ogni sezione deve superare lo stesso controllo usato al caricamento
    const ok = [], skipped = [];
    for (const [k, v] of Object.entries(parsed.data)) {
      const valid = storeKeys.get(k);
      if (valid && valid(v)) ok.push([k, v]); else skipped.push(sectionName(k));
    }
    const images = Object.entries(parsed.images || {})
        .filter(([, v]) => typeof v === "string" && v.startsWith("data:image/"))
        .map(([k, v]) => [k, dataUrlToBlob(v)]);  // decodifico tutto prima di scrivere qualcosa
    if (!ok.length && !images.length) throw new Error("nel file non ci sono impostazioni valide");

    const list = ok.map(([k]) => sectionName(k));
    if (images.length) list.push(images.length === 1 ? "1 immagine di sfondo" : `${images.length} immagini di sfondo`);
    if (!(await PS.ask(`Ripristinare da questo backup?\n\n• ${list.join("\n• ")}` +
        (skipped.length ? `\n\nSaltate perché non valide: ${skipped.join(", ")}.` : "") +
        "\n\nQueste sezioni sostituiranno quelle attuali (le altre restano come sono) e la pagina verrà ricaricata.",
        { ok: "Ripristina", danger: true }))) return;

    for (const [k, b] of images) await PS.idb.set(k, b);
    for (const [k, v] of ok) localStorage.setItem(k, JSON.stringify(v));
    location.reload();
  }

  // sezione del pannello "+"
  function backupSection() {
    const imgChk = chk("Includi le immagini di sfondo (file più grande)", false);
    const fileIn = el("input", { type: "file", accept: ".json,application/json", hidden: true });
    fileIn.onchange = () => {
      const f = fileIn.files?.[0];
      fileIn.value = "";
      if (f) importConfig(f).catch((e) => PS.say("Ripristino non riuscito: " + (e?.message || e)));
    };
    return [
      el("h4", { className: "sep", textContent: "Backup di tutta la configurazione" }),
      el("p", { className: "hint", textContent: "Pulsanti, righe dei fogli ore, colori delle US, priorità, colonne e sfondo in un unico file: utile per cambiare PC o condividere le impostazioni con i colleghi." }),
      imgChk,
      el("div", { className: "acts" },
          el("button", { textContent: "Scarica backup", onclick: () => exportConfig(imgChk.control.checked).catch(fail) }),
          el("button", { textContent: "Ripristina da file", onclick: () => fileIn.click() }),
          fileIn),
    ];
  }

  Object.assign(PS, { backupSection });
})();
