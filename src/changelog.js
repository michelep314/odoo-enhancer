/* Novità per versione, mostrate nel pannello ✨ della barra.
 * Quando si pubblica una versione aggiornare INSIEME: manifest.json ("version"), questo file e CHANGELOG.md.
 * (Nel world MAIN chrome.runtime.getManifest() non è disponibile: la versione mostrata viene da qui.) */
(() => {
  "use strict";
  const PS = window.__ps;
  if (!PS || PS.ready) return;

  // dalla più recente alla più vecchia; "how" (facoltativo) dice dove trovare la funzione
  const CHANGELOG = [
    {
      version: "1.19", date: "2026-10-08",
      items: [
        { title: "Note e promemoria", text: "Appunta cose da fare e, se vuoi, imposta un promemoria: all'ora scelta arriva una notifica in Odoo, con un breve suono (disattivabile). Ogni nota si può collegare a una scheda o a una user story e aprirla con un clic. Il numero sull'icona ti dice quante note scadute o importanti (★) ti aspettano.",
          how: "Icona 📄 nella barra in alto" },
      ],
    },
    {
      version: "1.18", date: "2026-10-08",
      items: [
        { title: "Sposta un'intera user story", text: "Con il raggruppamento per user story, trascina la testata di una US su un'altra colonna: tutte le sue schede si spostano insieme, dopo una conferma.",
          how: "Filtro della colonna → Raggruppa per user story, poi trascina la testata" },
        { title: "Pannelli più comodi", text: "I pannelli degli strumenti si chiudono cliccando fuori o premendo Esc." },
      ],
    },
    {
      version: "1.17", date: "2026-10-08",
      items: [
        { title: "Ricerca nelle descrizioni", text: "La ricerca rapida guarda anche descrizione, note e criteri di accettazione. Più parole vanno tutte trovate, anche in campi diversi: \"alunno sospeso\" trova le schede con alunno e sospeso, come in Trello. Tra virgolette cerchi la frase esatta.",
          how: "Premi / in una vista kanban, oppure 🔍 nella barra" },
        { title: "Usa pagina corrente", text: "Per creare un pulsante non serve più copiare l'URL: un clic prende menu, vista e progetto della pagina che hai aperto.",
          how: "Pannello + → Nuovo pulsante → URL della vista" },
        { title: "Cerca il progetto nei fogli ore", text: "Scrivi parte del nome e scegli dall'elenco, anche con frecce e Invio. I progetti che iniziano con \"Progetto\" compaiono per primi.",
          how: "Pannello Fogli ore → Progetto" },
        { title: "Elenco dei pulsanti più ordinato", text: "Ogni pulsante sta su una riga compatta, con modello e sprint sotto il nome e gli strumenti in linea. Ora puoi anche spostarlo giù, oltre che su.",
          how: "Pannello + → Pulsanti" },
      ],
    },
    {
      version: "1.16", date: "2026-10-08",
      items: [
        { title: "Sfondo per app o per vista", text: "Puoi dare uno sfondo diverso a ogni app (Helpdesk, Progetti, Fogli ore…) o a una singola vista; la vista vince sull'app, l'app su tutte le pagine. Il ● nell'elenco indica dove c'è già uno sfondo.",
          how: "Pannello Sfondo → Applica a" },
        { title: "Sbiancamento o oscuramento", text: "Un solo cursore: verso sinistra schiarisce l'immagine di sfondo, verso destra la scurisce.",
          how: "Pannello Sfondo" },
        { title: "Posizione delle icone", text: "Scegli se tenere le icone degli strumenti a sinistra (dopo i menu di Odoo), al centro o a destra accanto alla chat. Compresse restano sempre a destra.",
          how: "Pannello + → Icone degli strumenti" },
        { title: "Angoli delle schede", text: "Gli angoli arrotondati si regolano a parte, indipendenti dall'ombra e dallo stile delle colonne, e ritagliano anche copertine e strisce colorate. Con spazio 0 px le schede formano una pila: si arrotondano solo la prima e l'ultima.",
          how: "Pannello Sfondo → Schede e colonne" },
        { title: "Intestazioni liquid glass", text: "Una fascia di vetro smerigliato su tutte le intestazioni: sfoca lo sfondo e il testo resta leggibile su qualsiasi immagine.",
          how: "Filtro della colonna → Colore intestazioni → casella di vetro" },
        { title: "User story attaccate alle schede", text: "Con il raggruppamento per user story la testata della US è unita alle sue schede, con gli angoli squadrati dove si toccano." },
        { title: "Intestazioni sempre allineate e leggibili", text: "Le schede partono alla stessa altezza in ogni colonna anche senza colore delle intestazioni, e il testo delle intestazioni si legge su qualsiasi sfondo." },
        { title: "Colonne vuote visibili", text: "Aprendo un pulsante della barra, le fasi senza schede restano visibili quando tutte le schede appartengono allo stesso progetto o team." },
      ],
    },
    {
      version: "1.15", date: "2026-10-07",
      items: [
        { title: "Strumenti nella barra di Odoo", text: "Ricerca, sfondo, fogli ore, gestione pulsanti e novità ora sono icone al centro della barra in alto. La freccia le comprime in un solo pulsante a destra, accanto alla chat; in basso restano solo le tue scorciatoie.",
          how: "Barra in alto, al centro" },
        { title: "Novità", text: "Questo pannello: racconta cosa è cambiato a ogni aggiornamento. Un pallino sull'icona ✨ segnala le novità non ancora lette.",
          how: "Icona ✨ nella barra in alto (o la freccia accanto alla chat, se compressa)" },
        { title: "Intestazioni allineate", text: "La fascia colorata delle intestazioni non crea più un gradino quando alcune colonne mostrano il riepilogo delle priorità." },
      ],
    },
    {
      version: "1.14", date: "2026-10-07",
      items: [
        { title: "Ricerca rapida", text: "Filtra subito le schede visibili per titolo, US, etichetta o priorità. Usa @nome per cercare tra le persone e #123 per il numero della scheda; più parole si combinano.",
          how: "Premi / in una vista kanban, oppure 🔍 nella barra" },
        { title: "Backup della configurazione", text: "Scarica in un unico file pulsanti, righe dei fogli ore, colori delle US, priorità, colonne e sfondo, e ripristinali su un altro PC o da un collega.",
          how: "Pannello + → Backup di tutta la configurazione" },
      ],
    },
    {
      version: "1.13", date: "2026-10-06",
      items: [
        { title: "Più veloce", text: "L'estensione è stata riorganizzata in moduli e lavora molto meno a ogni modifica della pagina: il kanban resta fluido anche con molte schede." },
        { title: "Priorità personalizzabili", text: "Nome e colori di ogni livello di priorità, con il colore principale usato quando la scegli. L'arancione ora vale come priorità media.",
          how: "Filtro della colonna → Personalizza priorità…" },
        { title: "Testate delle user story leggibili", text: "Con \"Raggruppa per user story\" le testate sono piene nel colore della US, leggibili su ogni sfondo; il colore di ogni US si cambia dal pallino nella testata.",
          how: "Filtro della colonna → Raggruppa per user story" },
      ],
    },
    {
      version: "1.12", date: "", label: "1.12 e precedenti",
      items: [
        { title: "Barra dei pulsanti", text: "Viste preferite a portata di clic, con lo sprint corrente o precedente calcolato al momento." },
        { title: "Fogli ore", text: "Compila più giorni in una volta, saltando weekend, festivi, ferie e giorni già registrati." },
        { title: "Modifica rapida", text: "Matita o tasto destro su una scheda: titolo, ore, etichette, membri, copertina, date, sprint, priorità e altro. Nel menu ⋮ c'è anche \"Duplica scheda\"." },
        { title: "Schede e colonne", text: "Etichetta US in evidenza, priorità dal colore con ordinamento, filtri e raggruppamenti per colonna, campi nascosti." },
        { title: "Sfondo e aspetto", text: "Sfondo personalizzato per vista o globale, colonne semitrasparenti, angoli e ombre regolabili." },
        { title: "Tutti i sottodomini", text: "Funziona su qualsiasi istanza *.odoo.com." },
      ],
    },
  ];

  Object.assign(PS, { CHANGELOG, VERSION: CHANGELOG[0].version });
})();
