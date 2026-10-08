# Changelog

Tutte le modifiche rilevanti di Odoo Enhancer. Il formato segue [Keep a Changelog](https://keepachangelog.com/it-IT/1.1.0/).

> Quando si pubblica una versione aggiornare **insieme**: `manifest.json` (`version`), `src/changelog.js` (pannello ✨ Novità) e questo file.

## [1.16] - 2026-10-07

### Aggiunto
- Sfondo **per app** (Helpdesk, Progetti, Fogli ore…) oltre che per singola vista e per tutte le pagine. La vista vince sull'app, l'app su tutte le pagine. App e vista corrente si leggono dallo stato di Odoo, non più solo da `action=` nell'URL: ora l'opzione "Solo questa vista" compare anche nelle pagine dove prima mancava.
- **Sbiancamento** dello sfondo: il cursore va da −80% (velo bianco) a +80% (velo nero).
- **Angoli arrotondati delle schede**, indipendenti dall'ombra e da "Spazio e colonne personalizzati". Il contenuto della scheda (copertina, striscia di colore) viene ritagliato sugli angoli, tranne quando è aperto il menu ⋮. Con spazio 0 px tra le schede, si arrotondano solo la prima e l'ultima di ogni pila (colonna o gruppo US).
- **Posizione delle icone degli strumenti** (pannello + → Icone degli strumenti): sinistra (dopo i menu di Odoo), centro o destra. Compresse stanno sempre a destra, accanto alla chat. Se nella posizione scelta non c'è spazio, si spostano a destra.

### Corretto
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
