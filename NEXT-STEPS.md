Analizzo la skill come prodotto di developer experience, non solo come prompt: flusso operativo, runtime browser, automazione, integrazione IDE, affidabilità e differenze rispetto al loop di debug percepito in Claude Code. Confronterò anche ciò che il repository promette con ciò che implementa davvero.Parto dai punti eseguibili e dai contratti dichiarati, poi confronterò ciò che il repository automatizza davvero con ciò che lascia all’agente come istruzione manuale. Traccerò anche duplicazione tra sorgente e bundle, copertura dei test e percorso di distribuzione.Finora emerge una distinzione netta: il prodotto corrente è soprattutto un contratto operativo ben scritto più installer/detector; il vero orchestratore persistente è esplicitamente rinviato alla V2. Sto verificando ora i punti di drift tra documentazione, bundle npm e CI, e se le fixture browser vengono davvero eseguite.La mappa è chiara: il repository contiene soprattutto un ottimo **contratto operativo per l’agente** e un installer, non ancora un control plane di debug. Ora verifico packaging, CI e test reali per quantificare il divario tra promessa e comportamento eseguibile.Il test locale ha fatto emergere un gap DX concreto: gli smoke test base partono, ma `install-smoke.sh` si blocca su macOS quando la sessione dispone di un TTY, perché il chooser legge `/dev/tty` invece dell’input pipe. Questo conferma che la CI Ubuntu non rappresenta ancora bene l’installazione reale cross-platform. Chiudo con i controlli di artefatto e una roadmap misurabile.## Verdetto

Il repository è già una **skill metodologicamente molto buona**, ma non offre ancora un’esperienza di debug frontend paragonabile a Claude Code end-to-end.

Oggi hai:

- un ottimo “cervello” procedurale in `SKILL.md`;
- reference tecniche solide;
- installazione multi-agent abbastanza curata;
- rilevamento dei runtime disponibili;
- buoni principi su riproduzione, evidenze, patch minima e verifica.

Manca però il **control plane eseguibile** che trasformi queste istruzioni in un’esperienza fluida e deterministica. In pratica, la skill dice bene all’agente *cosa dovrebbe fare*, ma quasi tutto il *come farlo concretamente* dipende ancora dalle capacità dell’host, dai tool MCP installati e dall’interpretazione del modello.

La valutazione `92.32/100` in `EVALUATION.md` misura soprattutto **qualità di scrittura e steering della skill**. Non misura autonomia del browser loop, successo nei repair, integrazione Kiro o affidabilità end-to-end.

## Specchietto dei gap

| Area | Stato attuale | Gap rispetto alla DX desiderata | Priorità |
|---|---|---|---|
| Metodo di debugging | Molto buono: reproduce → evidence → patch → verify | Poco da aggiungere | — |
| Browser control | Delegato a MCP/CLI esterne | Nessuna API uniforme e garantita | P0 |
| Dev server | Solo istruzioni testuali | Mancano discovery, start/reuse, readiness, log e cleanup | P0 |
| Sessione browser | Delegata al backend | Nessun session ID, ownership, recovery o resume | P0 |
| Evidenze | Ledger testuale suggerito | Nessun bundle automatico, JSONL, indice o redaction | P0 |
| Verifica | Decisa dal modello | Nessun `bda verify` deterministico | P0 |
| Console/network | Dipendono dal runtime scelto | Output e capacità non normalizzati | P0 |
| Kiro integration | Installazione nel path corretto | Nessun health check MCP, setup assistito o tool nativo | P1 |
| Runtime routing | Detector presente | Priorità non del tutto coerenti tra skill, detector e reference | P1 |
| Visual QA | Buona documentazione | Nessun crop/diff/baseline runner automatico | P1 |
| Packaging | Pacchetto npm valido | Bundle generato manualmente, niente `prepack` o freshness check CI | P1 |
| Cross-platform | Shell POSIX | `win32` dichiarato ma non realmente supportato | P1 |
| Browser E2E | Assenti | CI verde senza aver aperto un browser | P0 |
| Benchmark | Assente | Nessuna misura contro skill-only o Claude Code | P2 |
| IDE UX | Assente | Nessun artifact viewer, timeline o replay | P2 |

## Il problema principale

La qualità percepita di Claude Code non deriva solo dal prompt o dalla skill. Deriva dall’integrazione tra:

1. reasoning;
2. shell e processi persistenti;
3. browser automation;
4. editing e diff;
5. raccolta automatica delle evidenze;
6. iterazione continua;
7. verifica conclusiva.

Questo repository copre molto bene il punto 1, parzialmente il punto 3 tramite runtime esterni, ma non orchestra i punti 2–7.

La conseguenza è una forte variabilità:

- con Kiro + Playwright MCP configurato + dev server già attivo, la DX può essere buona;
- su un progetto nuovo o un ambiente non predisposto, l’agente deve improvvisare comandi, lifecycle, porte, output e cleanup;
- `VERIFIED` rimane una valutazione del modello, non un risultato ripetibile.

## Cosa costruirei

Non implementerei un altro browser driver. L’ADR in `docs/ADR-0001-v2-runtime.md` prende la direzione corretta: costruire un **orchestratore sottile sopra runtime esistenti**.

### Architettura target

```text
Kiro / coding agent
        │
        ▼
SKILL.md
policy, diagnosi, repair loop
        │
        ▼
bda core
sessioni, server, evidence, verify, ownership
        │
        ├── CLI locale
        └── MCP server per Kiro
                │
                ▼
        runtime adapter
        Playwright CLI / agent-browser / DevTools
```

Il core dovrebbe essere condiviso tra CLI e MCP. La CLI serve per portabilità e CI; MCP offre a Kiro un’esperienza più nativa, con tool strutturati invece di parsing del terminale.

### Superficie minima

```text
bda doctor
bda session start
bda server start|attach
bda open
bda snapshot
bda interact
bda eval
bda console
bda network
bda screenshot
bda verify
bda stop
```

Non serve uniformare ogni funzionalità dei backend. Serve uniformare il lifecycle del debug e lasciare un pass-through per capacità specifiche.

## Roadmap consigliata

### P0 — rendere reale il loop

1. Implementare un core Node multipiattaforma con **un solo adapter iniziale**, preferibilmente `agent-browser` o `playwright-cli`.
2. Aggiungere session manifest worktree-scoped:
   - session ID;
   - backend/versione;
   - URL;
   - PID e porte;
   - risorse owned vs attached;
   - profilo browser;
   - directory artefatti.
3. Implementare server lifecycle:
   - rilevamento script nativo;
   - reuse di server esistente;
   - porta dinamica;
   - readiness probe;
   - log filtrati;
   - cleanup solo delle risorse possedute.
4. Implementare JSONL ed evidence bundle con redaction obbligatoria.
5. Implementare `bda verify` con assertion deterministiche.
6. Portare in CI una fixture realmente difettosa e un browser E2E fail → repair → pass.
7. Correggere l’installer affinché non scarichi runtime implicitamente quando riceve `--yes`.

### P1 — ottenere il feeling integrato in Kiro

1. Esporre il core come MCP server:
   - `browser_open`;
   - `browser_snapshot`;
   - `browser_interact`;
   - `browser_console`;
   - `browser_network`;
   - `browser_verify`;
   - `browser_stop`.
2. Aggiungere `bda doctor --host kiro`:
   - skill scoperta;
   - MCP configurato;
   - tool realmente disponibili;
   - browser installato;
   - eventuale restart richiesto.
3. Fornire setup MCP assistito e reversibile, senza sovrascrivere `mcp.json`.
4. Aggiungere secondo adapter e contract test condivisi.
5. Rendere il packaging riproducibile:
   - `prepack`;
   - build automatica del bundle;
   - `npm pack` in CI;
   - confronto root/bundle.
6. Eliminare `win32` dai metadata finché non esiste un launcher Node testato su Windows.

### P2 — superare la baseline

1. Resume/replay di una sessione interrotta.
2. Visual diff deterministico con element crop e geometria.
3. Evidence timeline con link cliccabili da Kiro.
4. Recording opzionale automatico.
5. Performance/network diagnostics tramite adapter DevTools.
6. Benchmark pubblico su un corpus di bug:
   - startup;
   - blank page;
   - runtime exception;
   - API failure;
   - stale state;
   - layout responsive;
   - overlay/hit testing;
   - flakiness.

## Criteri di successo

La parità non dovrebbe essere valutata “a sensazione”. Suggerisco questi gate:

- da checkout pulito, un singolo prompt completa start → reproduce → patch → verify → cleanup;
- 20 esecuzioni consecutive della stessa fixture senza flake;
- zero processi o profili browser orfani;
- `bda stop` non termina mai server o browser non posseduti;
- zero cookie, authorization header o credential URL negli artefatti;
- ogni risultato `VERIFIED` contiene evidenza machine-readable per tutte le assertion richieste;
- lo stesso manifest di verifica funziona su almeno due adapter;
- test negativi dimostrano che un difetto ancora presente non può risultare `VERIFIED`;
- benchmark comparativo tra:
  1. agente senza skill;
  2. skill attuale;
  3. skill + orchestratore;
  4. Claude Code come baseline osservabile.

Le metriche principali dovrebbero essere success rate, tempo alla prima evidenza, numero di patch, token, false verification, processi orfani e leak di segreti.

## Problemi concreti verificati

Durante l’analisi:

- `detector-smoke.sh` passa;
- il detector locale sceglie correttamente Obscura e rileva Chrome;
- bundle root/npm attualmente allineati;
- `npm pack --dry-run` produce correttamente il pacchetto con 13 file;
- working tree rimasto pulito;
- `install-smoke.sh` si è bloccato su macOS durante il chooser interattivo: in presenza di TTY legge `/dev/tty` invece dell’input passato via pipe. La CI solo Ubuntu non intercetta questo comportamento;
- nessun test esistente apre realmente un browser o usa le fixture per dimostrare il repair loop.

## Sintesi finale

La skill attuale è circa:

- **molto forte come metodo**;
- **buona come installazione portabile**;
- **debole come automazione runtime**;
- **ancora limitata come integrazione Kiro**;
- **non verificata come esperienza end-to-end**.

Per ottenere lo stesso feeling di Claude Code, non serve espandere molto `SKILL.md`. Serve implementare il V2 già delineato nell’ADR: **session lifecycle, dev-server ownership, adapter browser, evidence protocol, verifica deterministica e integrazione MCP con Kiro**. È lì che si trova quasi tutto il valore ancora mancante.