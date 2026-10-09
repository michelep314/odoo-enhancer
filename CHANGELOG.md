# Changelog

Tutte le modifiche rilevanti di Odoo Enhancer. Il formato segue [Keep a Changelog](https://keepachangelog.com/it-IT/1.1.0/).

> Quando si pubblica una versione aggiornare **insieme**: `manifest.json` (`version`), `src/changelog.js` (pannello ✨ Novità) e questo file.

## [1.23] - 2026-10-09

### Aggiunto
- **🔔 Campanella sulle colonne** del kanban delle schede (accanto al filtro della colonna, `PS.watchBell` in `src/watch.js`): crea l'avviso automatico già legato a quella colonna, senza cercarla nel pannello. Propone il progetto della vista (dal contesto dell'azione o se tutte le schede sono dello stesso progetto), lo sprint corrente se le schede hanno uno sprint, e una tendina con le US presenti nella colonna; restano da scegliere priorità, "solo assegnate a me", frequenza e Google Chat. La campanella diventa colorata quando sulla colonna c'è almeno un avviso attivo e il popover mostra gli avvisi esistenti, sospendibili, con frequenza modificabile ed eliminabili; "Tutti gli avvisi" apre la scheda nel pannello note. Solo nei kanban delle schede di progetto.

### Modificato
- Icone nell'intestazione delle colonne (filtro e campanella) più visibili: 16 px su una pastiglia leggera invece di 14 px semitrasparenti; sopra un'immagine di sfondo bianche con alone su pastiglia scura. Filtro attivo viola, campanella con avviso attivo gialla; con le intestazioni colorate lo stato attivo mantiene i suoi colori.
- `src/watch.js`: priorità, frequenza, Google Chat, creazione e riga degli avvisi diventano funzioni comuni a campanella e pannello note.

## [1.22] - 2026-10-09

### Aggiunto
- **Avvisi automatici** (pannello note → scheda "Avvisi automatici", `src/watch.js`): regole che fanno arrivare una notifica di Odoo, con il suono delle note, quando una **scheda di progetto** entra in una colonna (creata lì o spostata lì; filtri facoltativi: progetto, colonna (scelta dopo lo sprint: solo le colonne in cui ci sono schede dello sprint e del progetto scelti, una per nome; la regola riconosce la colonna per nome, così vale anche per gli sprint successivi, che hanno colonne con gli stessi nomi), sprint corrente o corrente e precedente, user story, solo assegnate a me, una o più priorità dell'estensione ricavate dal colore della scheda) o quando si apre un **nuovo ticket** (tutti i team o uno solo, eventualmente solo non assegnati, una o più priorità del ticket con le etichette di Odoo). Una scheda già nella colonna che passa a una priorità sorvegliata conta come nuova. Frequenza del controllo scelta per ogni regola (ogni minuto, 5, 15, 30 minuti o ogni ora; predefinita 5 minuti, modificabile anche dalla tendina accanto all'avviso) per non interrogare Odoo più del necessario; lo sprint corrente si ricalcola al massimo ogni 10 minuti. Il controllo avviene da una sola scheda del browser; alla creazione o riattivazione la regola fotografa la situazione attuale e avvisa solo delle novità successive. Non avvisano le schede spostate da te né i ticket aperti da te. La notifica ha "Apri" (una scheda) o "Apri elenco" (più schede). Ogni avviso può arrivare anche (o solo) in uno spazio di **Google Chat** tramite webhook in arrivo, con l'elenco delle schede o dei ticket come link e un pulsante "Invia prova"; l'invio passa dall'estensione (nuovi `src/bridge.js` e service worker `src/sw.js`, permesso solo per `https://chat.googleapis.com/*`) perché dalla pagina di Odoo sarebbe bloccato. In caso di errore compare una notifica in Odoo (al massimo una ogni 10 minuti). Regole sospendibili ed eliminabili, salvate in `ps-watch-v1` e incluse nel backup.

### Modificato
- Scelta del progetto (fogli ore e avvisi automatici): campo con ricerca condiviso (`PS.projectPicker`), con come prima voce esattamente **"Progetto Omnibus"**, poi quelli che iniziano con "Progetto"/"Progetti", poi gli altri, ognuno in ordine alfabetico. Negli avvisi sostituisce la tendina; lasciarlo vuoto vale "tutti i progetti".

## [1.21] - 2026-10-09

### Aggiunto
- Fogli ore, **copia un giorno**: in cima al pannello si sceglie tra "Una riga" e "Copia un giorno". Nella seconda modalità si sceglie il giorno di origine, le sue righe (progetto, attività, descrizione, ore) vengono lette da Odoo e si spuntano quelle da copiare; vengono create in ogni giorno dell'intervallo "Giorni", con le stesse regole per saltare weekend, festivi, ferie e giorni già compilati. Il giorno di origine non si ricopia su se stesso.
- Fogli ore, **giorni esclusi a mano**: nell'anteprima ogni giorno ha una ×; un clic lo esclude (barrato, non viene compilato), un altro clic lo rimette. Conteggi e pulsante "Crea" si aggiornano.
- Fogli ore, **modifica di una riga salvata**: scelta una riga salvata compare "Aggiorna riga salvata", che la sovrascrive con progetto, attività, descrizione e ore attuali e permette di cambiarle il nome. L'altro pulsante diventa "Salva come nuova riga predefinita".

## [1.20] - 2026-10-09

### Modificato
- **Finestre di dialogo interne** al posto di `alert`, `confirm` e `prompt` del browser (riquadro "…dice" in cima alla pagina): stesse domande e avvisi, ma in una finestra nello stile dei pannelli, al centro dello schermo. Invio conferma, Esc o clic sullo sfondo annullano; le azioni distruttive (elimina, archivia, ripristina) hanno il pulsante rosso con il verbo dell'azione. Le finestre aperte da un pannello o da un popover non li chiudono. Il testo da copiare a mano (link, configurazione) compare in un campo già selezionato. API in `core.js`: `PS.say`, `PS.ask`, `PS.askText`, `PS.showText`.

## [1.19] - 2026-10-08

### Aggiunto
- **Note e promemoria** (nuova icona 📄 nella barra, `src/notes.js`): note di testo con promemoria facoltativo (giorno in formato italiano gg/mm/aaaa, scrivibile o scelto da un calendario in italiano con settimana da lunedì, e ora sempre a 24 ore, 00:00–23:59, con tendine ora e minuti: i campi del browser in inglese mostrano mm/dd/yyyy e AM/PM; scorciatoie "Tra 1 ora", "Oggi 17:00", "Domani 9:00") e collegamento facoltativo a una scheda di progetto o a un ticket helpdesk, da qualsiasi pagina: due schede "Scheda di progetto" e "Ticket" cercano sul server. Le schede sono limitate allo sprint corrente e al precedente (a campo vuoto tutte, raggruppate per sprint, con il progetto accanto; poi per titolo o #numero). I ticket a campo vuoto sono quelli aperti più recenti; con testo si cercano per titolo, #numero o nome del team helpdesk (tutti i ticket del team), raggruppati per team con la fase accanto. Anche la scheda o il ticket aperto in form si collega con un clic. Alla scadenza arriva una notifica di Odoo con "Fatto", "Tra 10 minuti" e "Apri" (apre la scheda o cerca la US nel kanban); controllo ogni 30 s, una sola notifica per scadenza anche con più schede del browser aperte. Insieme alla notifica suona un breve "din-don" sintetizzato con Web Audio (nessun file audio), disattivabile dal pannello con "Suono quando scade un promemoria" e provabile con 🔊 Prova (`ps-notes-opts-v1`); il browser lo permette solo dopo almeno un clic o un tasto nella pagina. Sull'icona un numero indica le note da guardare (scadute o segnate ★ importanti): rosso se c'è un promemoria scaduto, giallo se sono solo importanti; pallino sulla freccia o sul ☰ quando compressi e c'è un promemoria scaduto. Il modulo "＋ Nuova nota" è richiudibile e parte chiuso (aperto solo se non ci sono note), così in primo piano c'è l'elenco: scaduti in cima, poi importanti, con ★ per segnarle al volo, modifica, eliminazione e completate nascoste a richiesta. Le note restano nel browser (`ps-notes-v1`) e sono incluse nel backup.

### Corretto
- Scritta "null" che compariva in alcuni pannelli (es. anteprima dei fogli ore, sotto il conteggio delle righe) quando un elemento facoltativo mancava: `replaceChildren` scrive `null` come testo. Tutti i moduli ora usano `PS.fill()`, che scarta gli elementi vuoti.
- Fogli ore: singolare corretto con una sola riga ("Crea 1 riga", "1 riga da…").

## [1.18] - 2026-10-08

### Aggiunto
- **Spostare un intero blocco US** in un'altra colonna: con "Raggruppa per user story", trascinando la testata della US su un'altra colonna (anche chiusa) si spostano tutte le schede visibili del blocco, con una sola scrittura sul campo di raggruppamento (es. `stage_id`) e conferma prima di procedere. La colonna di destinazione è evidenziata durante il trascinamento. Escluse le schede nascoste da filtri o ricerca; se la colonna non è caricata del tutto, lo dice la conferma. Non disponibile se le colonne sono date o campi many2many.

### Modificato
- I pannelli degli strumenti (pulsanti, sfondo, fogli ore, novità) si chiudono con un clic fuori dal pannello o con Esc. Un Esc usato da un campo del pannello (es. per chiudere l'elenco dei progetti) non chiude anche il pannello.

## [1.17] - 2026-10-08

### Aggiunto
- **Ricerca rapida nelle descrizioni**: cerca anche in descrizione, note e criteri di accettazione (campi html/testo il cui nome o etichetta contiene "descr", "note", "acceptance" o "criteri"). Non sono caricati nelle schede: vengono letti dal server alla prima ricerca, a blocchi di 200, e tenuti finché la ricerca resta aperta; nel frattempo il conteggio mostra "cerco nelle descrizioni…". Più parole restano in AND anche tra campi diversi (come Trello: `alunno sospeso` trova le schede che contengono entrambe le parole, ovunque); tra virgolette si cerca la frase esatta (`"alunno sospeso"`).
- **Usa pagina corrente** accanto a "URL della vista" (pannello +): compila l'URL con azione, modello, vista, progetto (`active_id`) e menu della pagina aperta, letti dallo stato di Odoo anche quando l'indirizzo non contiene `action=`.
- **Ricerca del progetto** nei fogli ore: al posto della tendina c'è un campo in cui scrivere, con elenco a discesa filtrato (tutte le parole, senza accenti) e navigabile con frecce, Invio ed Esc. I progetti che iniziano con "Progetto" stanno in cima, gli altri seguono in ordine alfabetico.
- Pulsante **↓ Sposta giù** nell'elenco dei pulsanti, accanto a ↑.

### Corretto
- Elenco dei pulsanti (pannello +): i pulsanti ↑ ✎ × finivano ognuno su una riga a tutta larghezza, perché la classe `row` coincideva con la griglia di Bootstrap di Odoo. Ora ogni riga è compatta: numero, nome con modello e sprint sotto, vista iniziale e strumenti in linea (× diventa rosso al passaggio del mouse).

## [1.16] - 2026-10-08

### Aggiunto
- Sfondo **per app** (Helpdesk, Progetti, Fogli ore…) oltre che per singola vista e per tutte le pagine. La vista vince sull'app, l'app su tutte le pagine. App e vista corrente si leggono dallo stato di Odoo, non più solo da `action=` nell'URL: ora l'opzione "Solo questa vista" compare anche nelle pagine dove prima mancava.
- **Sbiancamento** dello sfondo: il cursore va da −80% (velo bianco) a +80% (velo nero).
- **Angoli arrotondati delle schede**, indipendenti dall'ombra e da "Spazio e colonne personalizzati". Il contenuto della scheda (copertina, striscia di colore) viene ritagliato sugli angoli, tranne quando è aperto il menu ⋮. Con spazio 0 px tra le schede, si arrotondano solo la prima e l'ultima di ogni pila (colonna o gruppo US).
- **Posizione delle icone degli strumenti** (pannello + → Icone degli strumenti): sinistra (dopo i menu di Odoo), centro o destra. Compresse stanno sempre a destra, accanto alla chat. Se nella posizione scelta non c'è spazio, si spostano a destra.
- Intestazioni **liquid glass** (filtro della colonna → Colore intestazioni, casella di vetro dopo "∅"): fascia continua di vetro smerigliato su tutte le colonne, con sfocatura dello sfondo, riflesso sul bordo e testo chiaro con alone. Il vetro è un `::before` allargato negli spazi tra le colonne, senza sovrapposizioni tra i pezzi. Insieme a "Colonne semitrasparenti" le colonne perdono la sfocatura (restano semitrasparenti), altrimenti il vetro della fascia non sfocherebbe gli spazi tra le colonne.

### Modificato
- Con "Raggruppa per user story" la testata della US è attaccata alle sue schede (0 px di distanza): gli angoli inferiori della testata e quelli superiori della prima scheda visibile sono squadrati, anche nella modalità a pila. Gruppi chiusi o senza schede visibili restano arrotondati.

### Corretto
- Gradino nella colonna dei bug anche **senza colore delle intestazioni**: ora tutte le intestazioni hanno sempre la stessa altezza, così le schede partono alla stessa altezza in ogni colonna.
- Testo delle intestazioni leggibile su qualsiasi sfondo: senza colore, sopra un'immagine di sfondo, titolo, contatori, icone e riepilogo priorità diventano bianchi con alone scuro. Con un colore, anche i pallini delle priorità usano il colore di testo a contrasto.
- Colonne senza schede che sparivano nelle viste aperte dalla barra. Se tutte le schede appartengono a un solo progetto (task) o team (helpdesk), viene aggiunto `default_project_id` / `default_team_id` al contesto, così Odoo mostra tutte le fasi.

## [1.15] - 2026-10-07

### Aggiunto
- Pannello **✨ Novità**: descrive cosa è cambiato in ogni versione. Le versioni precedenti sono raccolte in sezioni espandibili.
- Pallino sull'icona ✨ (e sulla freccia quando gli strumenti sono compressi) quando ci sono novità non lette.
- Notifica Odoo una sola volta per versione, con il pulsante "Scopri le novità". Compare solo a chi aveva già letto una versione precedente.

### Modificato
- Le icone degli strumenti (ricerca, sfondo, fogli ore, gestione pulsanti, novità) sono passate al centro della barra in alto di Odoo.
  - Una freccia le comprime in un solo pulsante a destra, accanto alla chat, e la scelta viene ricordata (`ps-tray-v1`).
  - Se lo schermo è troppo stretto e al centro si sovrapporrebbero ai menu, restano a destra anche da aperte.
  - I pannelli si aprono sotto le icone.
  - In basso resta solo la barra delle scorciatoie, nascosta se non ce ne sono.
  - Se la barra di Odoo non è presente, gli strumenti tornano nella barra in basso.

### Corretto
- La fascia colorata delle intestazioni del kanban non crea più un gradino quando solo alcune colonne mostrano il riepilogo delle priorità: tutte le intestazioni hanno la stessa altezza, ricalcolata anche al ridimensionamento della finestra.

## [1.14] - 2026-10-07

### Aggiunto
- **Ricerca rapida** nelle viste kanban, con `/` o con 🔍 nella barra.
  - Filtra le schede visibili per titolo, campi, etichette, persone, US e priorità, ignorando maiuscole e accenti.
  - Prefissi: `@nome` cerca solo tra le persone, `#123` per numero della scheda. Più parole si combinano in AND.
  - Si combina con i filtri di colonna e con i gruppi per US. Si azzera al cambio di vista.
- **Backup di tutta la configurazione** (pannello + → Backup).
  - Un unico file JSON con pulsanti, righe dei fogli ore, colori delle US, priorità, colonne, aspetto, sfondo e, a scelta, le immagini di sfondo.
  - Il ripristino valida ogni sezione, chiede conferma e ricarica la pagina.

### Modificato
- "Esporta"/"Importa" del pannello pulsanti rinominati in "Esporta pulsanti"/"Importa pulsanti".

## [1.13] - 2026-10-06

### Modificato
- Codice diviso in moduli (`src/*.js`) e stili in `styles.css`, caricati dal manifest, senza passo di build. Chiavi di salvataggio e formati invariati.
- Prestazioni:
  - un solo `MutationObserver` al posto di due osservatori e di un timer da 700 ms;
  - indice scheda→record invece di percorrere tutto l'albero Owl a ogni passaggio del mouse;
  - impostazioni di colonna e US calcolate una volta per ogni giro di decorazione;
  - niente nuova scansione delle schede già sistemate.

### Aggiunto
- **Priorità personalizzabili**: nome di ogni livello, colori associati e colore principale (quello scritto quando scegli la priorità). L'arancione ora vale come priorità media.
- **Testate delle user story** piene nel colore della US, con testo a contrasto e leggibili su ogni sfondo, oppure leggere come prima. Il colore di ogni US si cambia dal pallino nella sua testata.

## [1.12] e precedenti

### Aggiunto
- Barra con pulsanti verso viste e preferiti, con lo sprint corrente o precedente calcolato al clic.
- Compilazione dei fogli ore su più giorni, saltando weekend, festivi, ferie e giorni già compilati.
- Modifica rapida stile Trello: matita o tasto destro sulla scheda. "Duplica scheda" nel menu ⋮.
- Etichetta US in evidenza, priorità ricavata dal colore con ordinamento e riepilogo, filtri e raggruppamenti per colonna, campi nascosti.
- Sfondo personalizzato, colonne semitrasparenti e aspetto arrotondato regolabile.
- Supporto a tutti i sottodomini `*.odoo.com`.
