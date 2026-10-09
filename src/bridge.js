/* Ponte tra la pagina di Odoo (world MAIN, senza API dell'estensione) e il service worker (sw.js):
   inoltra solo le richieste di invio a un webhook di Google Chat e restituisce l'esito. */
(() => {
  "use strict";
  const CHAT_RE = /^https:\/\/chat\.googleapis\.com\/v1\/spaces\/[^/?#]+\/messages\?\S+$/;
  addEventListener("message", (e) => {
    if (e.source !== window || e.origin !== location.origin || e.data?.__ps !== "gchat") return;
    const { id, url, text } = e.data;
    const reply = (r) => window.postMessage({ __ps: "gchat:res", id, ...r }, location.origin);
    if (typeof url !== "string" || !CHAT_RE.test(url) || typeof text !== "string" || text.length > 4000) {
      reply({ ok: false, error: "webhook non valido: deve iniziare con https://chat.googleapis.com/v1/spaces/" });
      return;
    }
    try {
      chrome.runtime.sendMessage({ type: "gchat", url, text }, (r) => {
        reply(chrome.runtime.lastError ? { ok: false, error: chrome.runtime.lastError.message } : r || { ok: false, error: "nessuna risposta" });
      });
    } catch (err) {
      reply({ ok: false, error: "estensione aggiornata: ricarica la pagina (" + (err?.message || err) + ")" });
    }
  });
})();
