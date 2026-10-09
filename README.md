# Budget Settimanale (PWA)

HTML + CSS + JS vanilla, nessuna libreria. Dati in `localStorage`, importi in centesimi.
File: `index.html`, `style.css`, `app.js`, `manifest.json`, `service-worker.js`, `icons/`.

## Sezioni
- **Settimana**: budget Macchina/Altro, spese, saldo del salvadanaio in evidenza. Il "+" chiede se aggiungere una Spesa o un Guadagno. In alto a destra: Storico e Impostazioni.
- **Salvadanaio**: ogni domenica 23:59 il residuo netto della settimana (budget totale − speso) viene aggiunto; se hai sforato viene sottratto. Versamenti e prelievi manuali con nota.
- **Ricorrenti**: spese fisse fuori dal budget settimanale (mensili, trimestrali, annuali) con costo equivalente al mese/settimana e prossima scadenza.
- **Anno**: totali dell'anno solare, netto, proiezione delle ricorrenti, grafico mensile, elenco guadagni.

## Dati (versione 2)
`{ version, settings: { budgets }, expenses, incomes, sources, recurring, piggy: { trackFrom, processed, movements } }`

- `piggy.processed` tiene traccia delle settimane già chiuse (lunedì → importo accreditato): una settimana non viene mai contata due volte. Se una spesa di una settimana già chiusa viene modificata, si registra un movimento di "Rettifica".
- L'accumulo automatico parte dalla settimana del 5 ottobre 2026 (`piggy.trackFrom`); il saldo iniziale (+20,00 €, id `saldo-iniziale`) esiste una sola volta.
- Migrazione 1 → 2 automatica (`migrate()` in `app.js`): prima di migrare i dati vecchi vengono copiati in `budget-settimanale-backup-v1`. L'import JSON accetta anche i vecchi file versione 1.
- Prima di un import o di "Cancella tutto" i dati attuali vengono copiati in `budget-settimanale-backup-ultimo`. Le copie si esportano da Impostazioni → Copie di sicurezza.
- Se i dati nello storage non sono leggibili, il testo originale resta in `budget-settimanale-illeggibile` e non viene sovrascritto finché non si fa una modifica.

## Test con data simulata
Aggiungi `?oggi=AAAA-MM-GG` all'URL (es. `index.html?oggi=2026-10-12`). In questa modalità l'app parte da una copia dei dati veri e salva solo in `budget-settimanale-test`: i dati veri non vengono toccati. Appare una barra arancione in alto.

## Aggiornare l'app sull'iPhone
Il service worker usa la cache `budget-v2`. Quando cambi i file, aumenta il numero (`budget-v3`, …) in `service-worker.js`: l'app scarica la nuova versione e si ricarica da sola (alla prima volta dopo una pubblicazione servono due aperture).
