/* Service worker dell'estensione: invia i messaggi ai webhook di Google Chat.
   La pagina di Odoo non può farlo da sola (CORS e regole di sicurezza di Odoo): passa da bridge.js. */
"use strict";

// solo webhook in arrivo di Google Chat: https://chat.googleapis.com/v1/spaces/<spazio>/messages?key=…&token=…
const CHAT_RE = /^https:\/\/chat\.googleapis\.com\/v1\/spaces\/[^/?#]+\/messages\?\S+$/;

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type !== "gchat") return false;
  if (typeof msg.url !== "string" || !CHAT_RE.test(msg.url) || typeof msg.text !== "string" || !msg.text.trim()) {
    reply({ ok: false, error: "webhook o testo non valido" });
    return false;
  }
  fetch(msg.url, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ text: msg.text.slice(0, 4000) }),
  })
      .then(async (r) => reply(r.ok ? { ok: true, status: r.status }
        : { ok: false, status: r.status, error: (await r.text().catch(() => "")).slice(0, 300) || `HTTP ${r.status}` }))
      .catch((e) => reply({ ok: false, error: String(e?.message || e) }));
  return true;  // risposta asincrona
});
