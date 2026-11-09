# Budget Settimanale (PWA)

HTML + CSS + JS vanilla, nessuna libreria. Dati in `localStorage`, importi in centesimi.
File: `index.html`, `style.css`, `app.js`, `manifest.json`, `service-worker.js`, `icons/`.

## Sezioni
- **Settimana**: budget Macchina/Altro, spese, saldo del salvadanaio in evidenza. Il "+" chiede se aggiungere una Spesa o un Guadagno. In alto a destra: Storico e Impostazioni.
- **Salvadanaio**: il totale reale dei soldi. Saldo = movimenti (saldo iniziale, versamenti e prelievi manuali, guadagni, allineamenti) − tutte le spese: ogni spesa si riflette subito. Il budget settimanale è solo un limite di spesa. "Allinea al saldo reale" registra la differenza con il totale scritto a mano (movimento eliminabile; se la differenza è zero non registra nulla).
- **Ricorrenti**: spese fisse fuori dal budget settimanale (mensili, trimestrali, annuali) con costo equivalente al mese/settimana e prossima scadenza.
- **Anno**: totali dell'anno solare, netto, proiezione delle ricorrenti, grafico mensile, elenco guadagni.

## Dati (versione 3)
`{ version, settings: { budgets }, expenses, incomes, sources, recurring, piggy: { movements, archive, alignedAt, needsAlign } }`

- `piggy.movements`: movimenti di tipo `initial`, `manual`, `income`, `align`. Il saldo iniziale (+20,00 €, id `saldo-iniziale`) esiste una sola volta.
- `piggy.archive`: le chiusure settimanali e le rettifiche (`week`, `adjust`) della versione 2. Non entrano nel saldo: contavano due volte soldi già presenti nei conti.
- `piggy.alignedAt`: data dell'ultimo allineamento. `piggy.needsAlign`: fa comparire l'avviso dopo una migrazione, finché non si allinea.
- Le Ricorrenti non toccano il saldo: se ne occupa l'allineamento.
- Migrazione automatica 1 → 2 → 3 (`migrate()` in `app.js`), anche negli import JSON. Prima di migrare i dati vecchi vengono copiati in `budget-settimanale-backup-v1` o `budget-settimanale-backup-v2`, a seconda della versione.
- Prima di un import o di "Cancella tutto" i dati attuali vengono copiati in `budget-settimanale-backup-ultimo`. Le copie si esportano da Impostazioni → Copie di sicurezza.
- Se i dati nello storage non sono leggibili, il testo originale resta in `budget-settimanale-illeggibile` e non viene sovrascritto finché non si fa una modifica.

## Test con data simulata
Aggiungi `?oggi=AAAA-MM-GG` all'URL (es. `index.html?oggi=2026-10-12`). In questa modalità l'app parte da una copia dei dati veri e salva solo in `budget-settimanale-test`: i dati veri non vengono toccati. Appare una barra arancione in alto.

## Aggiornare l'app sull'iPhone
Il service worker usa la cache `budget-v3`. Quando cambi i file, aumenta il numero (`budget-v4`, …) in `service-worker.js`: l'app scarica la nuova versione e si ricarica da sola (alla prima volta dopo una pubblicazione servono due aperture).
