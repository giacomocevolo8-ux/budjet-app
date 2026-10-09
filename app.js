'use strict';

/* ============ Costanti e utilità ============ */
const SCHEMA_VERSION = 2;
const CATS = [
  { key: 'macchina', label: 'Macchina' },
  { key: 'altro', label: 'Altro' }
];
const FREQS = {
  monthly: { label: 'Mensile', months: 1, per: 'al mese' },
  quarterly: { label: 'Trimestrale', months: 3, per: 'ogni 3 mesi' },
  yearly: { label: 'Annuale', months: 12, per: 'all’anno' }
};
const DEFAULT_SOURCES = ['Etsy', 'Vendita stampa', 'Altro'];
const MOVE_LABELS = { initial: 'Saldo iniziale', week: 'Chiusura settimana', adjust: 'Rettifica', manual: 'Manuale', income: 'Guadagno' };
const MAX_CENTS = 100000000; // 1.000.000 €
const PIGGY_START = '2026-10-05'; // prima settimana accumulata in automatico (lunedì)
const INITIAL_MOVE_ID = 'saldo-iniziale';
const MONTHS_SHORT = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const MONTHS_LONG = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];

const eur = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
const eurSigned = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', signDisplay: 'exceptZero' });
const numFmt = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 });
const fmtEur = (cents) => eur.format(cents / 100);
const fmtSigned = (cents) => eurSigned.format(cents / 100);
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const pad = (n) => String(n).padStart(2, '0');
const toStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromStr = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = fromStr(s); d.setDate(d.getDate() + n); return toStr(d); };
const isDateStr = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && toStr(fromStr(s)) === s;
function mondayOf(s) {
  const d = fromStr(s);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toStr(d);
}
const daysInMonth = (y, m0) => new Date(y, m0 + 1, 0).getDate();
const monthDate = (y, m0, d) => `${String(y).padStart(4, '0')}-${pad(m0 + 1)}-${pad(Math.min(d, daysInMonth(y, m0)))}`;
const diffDays = (a, b) => Math.round((fromStr(b) - fromStr(a)) / 86400000);
const roundDiv = (a, b) => Math.floor((2 * a + b) / (2 * b)); // a/b arrotondato al centesimo, solo interi positivi

// Data "oggi" (con possibilità di simulazione per test: ?oggi=2026-10-12).
// In modalità test i dati vivono in una chiave separata: quelli veri non vengono mai toccati.
const TEST_DATE = (() => {
  const fake = new URLSearchParams(location.search).get('oggi');
  return isDateStr(fake) ? fake : null;
})();
const todayStr = () => TEST_DATE || toStr(new Date());

const shortDate = (s) => fromStr(s).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
const longDate = (s) => fromStr(s).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
const fullDate = (s) => fromStr(s).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
function weekLabel(w) { // "28 set – 4 ott 2026"
  const a = fromStr(w), b = fromStr(addDays(w, 6));
  const left = a.getMonth() === b.getMonth() ? `${a.getDate()}` : `${a.getDate()} ${MONTHS_SHORT[a.getMonth()]}`;
  return `${left} – ${b.getDate()} ${MONTHS_SHORT[b.getMonth()]} ${b.getFullYear()}`;
}

// Importo testuale -> centesimi (accetta virgola o punto). null se non valido.
function parseAmount(text) {
  let t = String(text).trim().replace(/\s/g, '').replace('€', '').replace(',', '.');
  if (!/^\d*\.?\d{0,2}$/.test(t) || t === '' || t === '.') return null;
  const [int, frac = ''] = t.split('.');
  const cents = (parseInt(int || '0', 10) * 100) + parseInt((frac + '00').slice(0, 2), 10);
  return cents > 0 && cents <= MAX_CENTS ? cents : null;
}
const centsToInput = (c) => (c / 100).toFixed(2).replace('.', ',');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const isFreq = (f) => Object.prototype.hasOwnProperty.call(FREQS, f);

/* ============ Dati ============ */
const REAL_KEY = 'budget-settimanale';
const STORAGE_KEY = TEST_DATE ? 'budget-settimanale-test' : REAL_KEY;
const BACKUP_V1_KEY = 'budget-settimanale-backup-v1';                 // copia dei dati prima della migrazione 1 → 2
const BACKUP_LAST_KEY = TEST_DATE ? 'budget-settimanale-backup-ultimo-test' : 'budget-settimanale-backup-ultimo'; // prima di import/cancellazione
const CORRUPT_KEY = 'budget-settimanale-illeggibile';                  // dati non leggibili, conservati intatti
const LAST_CAT_KEY = 'budget-last-cat';
const LAST_SOURCE_KEY = 'budget-last-source';

const safeGet = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const safeSet = (k, v) => { try { localStorage.setItem(k, v); return localStorage.getItem(k) === v; } catch (_) { return false; } };

// Valori iniziali richiesti: Abbonamenti il 1° del mese, Sito a giugno, Oggetti in vendita ogni 3 mesi.
function seedRecurring() {
  return [
    { id: 'rec-abbonamenti', name: 'Abbonamenti', amount: 2400, freq: 'monthly', renewal: '2026-11-01', active: true, toConfirm: false },
    { id: 'rec-sito', name: 'Sito', amount: 20000, freq: 'yearly', renewal: '2027-06-01', active: true, toConfirm: true },
    { id: 'rec-oggetti', name: 'Oggetti in vendita', amount: 3000, freq: 'quarterly', renewal: '2026-11-01', active: true, toConfirm: true }
  ];
}
const initialMovement = () => ({ id: INITIAL_MOVE_ID, kind: 'initial', date: '2026-10-04', amount: 2000, reason: 'Residuo settimana 28 set – 4 ott 2026' });
const v2Additions = () => ({
  recurring: seedRecurring(),
  incomes: [],
  sources: DEFAULT_SOURCES.slice(),
  piggy: { trackFrom: PIGGY_START, processed: {}, movements: [initialMovement()] }
});

// Dati completamente vuoti (usato da "Cancella tutto": l'accumulo riparte dalla settimana corrente)
function blankData() {
  return {
    version: SCHEMA_VERSION,
    settings: { budgets: [{ from: '0000-00-00', macchina: 2000, altro: 2000 }] },
    expenses: [], incomes: [], sources: DEFAULT_SOURCES.slice(), recurring: [],
    piggy: { trackFrom: mondayOf(todayStr()), processed: {}, movements: [] }
  };
}
// Dati di una nuova installazione: vuoti + valori iniziali (ricorrenti e saldo iniziale del salvadanaio)
function seededData() { return { ...blankData(), ...v2Additions() }; }

// Porta qualunque versione nota alla versione corrente. Lancia se non valido.
function migrate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('File non valido');
  if (typeof raw.version !== 'number') throw new Error('Versione dati mancante');
  if (!Number.isInteger(raw.version) || raw.version < 1) throw new Error('Versione dati non valida');
  if (raw.version > SCHEMA_VERSION) throw new Error('Dati creati da una versione più recente');
  let src = raw;
  // 1 → 2: spese e impostazioni restano identiche; si aggiungono ricorrenti, salvadanaio, guadagni.
  // (L'interruttore "Riporta il residuo" non esiste più: il residuo ora finisce nel salvadanaio.)
  if (src.version === 1) src = { ...src, ...v2Additions(), version: 2 };
  return normalize(src);
}

function normalize(raw) {
  const s = raw.settings || {};
  let budgets = Array.isArray(s.budgets) ? s.budgets.filter((b) =>
    b && (b.from === '0000-00-00' || isDateStr(b.from)) &&
    Number.isInteger(b.macchina) && b.macchina >= 0 && Number.isInteger(b.altro) && b.altro >= 0) : [];
  if (!budgets.length) budgets = blankData().settings.budgets;
  budgets = budgets.map((b) => ({ from: b.from, macchina: b.macchina, altro: b.altro }));
  budgets.sort((a, b) => a.from.localeCompare(b.from));

  if (!Array.isArray(raw.expenses)) throw new Error('Elenco spese mancante');
  const expenses = raw.expenses.map((e) => {
    if (!e || !CATS.some((c) => c.key === e.cat) || !Number.isInteger(e.amount) || e.amount <= 0 || e.amount > MAX_CENTS || !isDateStr(e.date)) {
      throw new Error('Una o più spese non sono valide');
    }
    return { id: typeof e.id === 'string' && e.id ? e.id : uid(), cat: e.cat, amount: e.amount, note: String(e.note || '').slice(0, 80), date: e.date };
  });

  if (!Array.isArray(raw.recurring)) throw new Error('Elenco ricorrenti mancante');
  const recurring = raw.recurring.map((r) => {
    if (!r || typeof r.name !== 'string' || !r.name.trim() || !isFreq(r.freq) || !Number.isInteger(r.amount) || r.amount <= 0 || r.amount > MAX_CENTS || !isDateStr(r.renewal)) {
      throw new Error('Una o più spese ricorrenti non sono valide');
    }
    return { id: typeof r.id === 'string' && r.id ? r.id : uid(), name: r.name.trim().slice(0, 40), amount: r.amount, freq: r.freq, renewal: r.renewal, active: r.active !== false, toConfirm: !!r.toConfirm };
  });

  if (!Array.isArray(raw.incomes)) throw new Error('Elenco guadagni mancante');
  const incomes = raw.incomes.map((i) => {
    if (!i || typeof i.source !== 'string' || !i.source.trim() || !Number.isInteger(i.amount) || i.amount <= 0 || i.amount > MAX_CENTS || !isDateStr(i.date)) {
      throw new Error('Uno o più guadagni non sono validi');
    }
    return { id: typeof i.id === 'string' && i.id ? i.id : uid(), amount: i.amount, source: i.source.trim().slice(0, 30), date: i.date, note: String(i.note || '').slice(0, 80), toPiggy: !!i.toPiggy };
  });

  const sources = [];
  const addSource = (name) => {
    const n = String(name || '').trim().slice(0, 30);
    if (n && !sources.some((x) => x.toLowerCase() === n.toLowerCase())) sources.push(n);
  };
  (Array.isArray(raw.sources) ? raw.sources : []).forEach(addSource);
  incomes.forEach((i) => addSource(i.source));
  if (!sources.length) DEFAULT_SOURCES.forEach(addSource);

  const p = raw.piggy;
  if (!p || typeof p !== 'object' || !Array.isArray(p.movements)) throw new Error('Dati del salvadanaio mancanti');
  const trackFrom = isDateStr(p.trackFrom) && p.trackFrom >= '2000-01-01' ? mondayOf(p.trackFrom) : PIGGY_START;
  const seen = new Set();
  const movements = [];
  p.movements.forEach((m) => {
    if (!m || typeof m.id !== 'string' || !m.id || !Object.prototype.hasOwnProperty.call(MOVE_LABELS, m.kind) ||
        !isDateStr(m.date) || !Number.isInteger(m.amount) || m.amount === 0 || Math.abs(m.amount) > MAX_CENTS) {
      throw new Error('Uno o più movimenti del salvadanaio non sono validi');
    }
    if (seen.has(m.id)) return; // un movimento non può comparire due volte
    seen.add(m.id);
    const mv = { id: m.id, kind: m.kind, date: m.date, amount: m.amount, reason: String(m.reason || '').slice(0, 120) };
    if (typeof m.incomeId === 'string' && m.incomeId) mv.incomeId = m.incomeId;
    movements.push(mv);
  });
  const processed = {};
  if (p.processed && typeof p.processed === 'object') {
    for (const [k, v] of Object.entries(p.processed)) if (isDateStr(k) && Number.isInteger(v)) processed[k] = v;
  }

  return { version: SCHEMA_VERSION, settings: { budgets }, expenses, incomes, sources, recurring, piggy: { trackFrom, processed, movements } };
}

let storageOk = true;
let startupNotice = null;
let migratedAtLoad = false;
let loadFailed = false; // dati illeggibili: niente salvataggi automatici finché l'utente non fa qualcosa
function load() {
  let txt = safeGet(STORAGE_KEY);
  if (!txt && TEST_DATE) txt = safeGet(REAL_KEY); // modalità test: parte da una copia (i dati veri restano intatti)
  if (!txt) return seededData();
  try {
    const parsed = JSON.parse(txt);
    const old = !!parsed && Number.isInteger(parsed.version) && parsed.version < SCHEMA_VERSION;
    // Prima di migrare: copia di sicurezza dei dati vecchi, in una chiave a parte
    if (old && !TEST_DATE && safeGet(BACKUP_V1_KEY) === null && !safeSet(BACKUP_V1_KEY, txt)) startupNotice = 'Attenzione: copia di sicurezza non riuscita';
    const migrated = migrate(parsed);
    migratedAtLoad = old; // solo se la migrazione è riuscita: si riscrive lo storage con il formato nuovo
    return migrated;
  } catch (err) {
    console.warn('Dati non leggibili', err);
    if (!TEST_DATE) safeSet(CORRUPT_KEY, txt); // il testo originale resta salvato, non si perde nulla
    startupNotice = 'Dati non leggibili: ne ho conservato una copia';
    loadFailed = true;
    return seededData();
  }
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); storageOk = true; loadFailed = false; return true; }
  catch (err) { storageOk = false; toast('Impossibile salvare i dati!'); return false; }
}
let data = load();

/* ============ Calcoli: settimana ============ */
function baseBudget(cat, weekStart) {
  let cur = data.settings.budgets[0];
  for (const b of data.settings.budgets) if (b.from <= weekStart) cur = b;
  return cur[cat];
}
function spentIn(cat, weekStart) {
  const end = addDays(weekStart, 6);
  return data.expenses.reduce((t, e) => (e.cat === cat && e.date >= weekStart && e.date <= end ? t + e.amount : t), 0);
}
function firstWeek() {
  if (!data.expenses.length) return null;
  return mondayOf(data.expenses.reduce((m, e) => (e.date < m ? e.date : m), data.expenses[0].date));
}
function weekStats(weekStart) {
  const cats = CATS.map((c) => {
    const budget = baseBudget(c.key, weekStart);
    const spent = spentIn(c.key, weekStart);
    return { ...c, budget, spent, remaining: budget - spent };
  });
  const budget = cats.reduce((t, c) => t + c.budget, 0);
  const spent = cats.reduce((t, c) => t + c.spent, 0);
  return { cats, budget, spent, net: budget - spent };
}
function statusOf(remaining, budget) {
  if (remaining < 0) return 'red';
  if (budget <= 0) return remaining > 0 ? 'green' : 'orange';
  return remaining / budget > 0.3 ? 'green' : 'orange';
}

/* ============ Calcoli: salvadanaio ============ */
const piggyBalance = () => data.piggy.movements.reduce((t, m) => t + m.amount, 0);

// Chiude tutte le settimane concluse (lunedì → domenica 23:59) non ancora processate, una per una.
// Ogni settimana è registrata in piggy.processed: non può essere contata due volte.
// Se una settimana già chiusa cambia (spesa aggiunta/modificata/eliminata a posteriori), registra una rettifica.
function processPiggy() {
  const p = data.piggy, cur = mondayOf(todayStr());
  let changed = false;
  for (let w = p.trackFrom; w < cur; w = addDays(w, 7)) {
    const net = weekStats(w).net;
    let done = p.processed[w];
    if (done === undefined) {
      const existing = p.movements.find((m) => m.id === 'w-' + w);
      if (existing) { done = existing.amount; p.processed[w] = done; changed = true; }
    }
    if (done === undefined) {
      if (net !== 0) {
        p.movements.push({ id: 'w-' + w, kind: 'week', date: addDays(w, 6), amount: net, reason: `${net > 0 ? 'Residuo' : 'Sforamento'} settimana ${weekLabel(w)}` });
      }
      p.processed[w] = net;
      changed = true;
    } else if (done !== net) {
      p.movements.push({ id: uid(), kind: 'adjust', date: todayStr(), amount: net - done, reason: `Rettifica settimana ${weekLabel(w)}` });
      p.processed[w] = net;
      changed = true;
    }
  }
  return changed;
}

/* ============ Calcoli: ricorrenti ============ */
const yearlyCents = (r) => r.amount * (12 / FREQS[r.freq].months); // costo annuo (interi: ×12, ×4, ×1)
const monthlyEq = (yearly) => roundDiv(yearly, 12);
const weeklyEq = (yearly) => roundDiv(yearly, 52);

// Date di addebito in un dato anno (calcolate dalla data di rinnovo, sempre dall'àncora: nessuna deriva)
function occurrences(r, year) {
  const a = fromStr(r.renewal), step = FREQS[r.freq].months;
  const aIdx = a.getFullYear() * 12 + a.getMonth();
  const out = [];
  for (let m = 0; m < 12; m++) {
    if ((((year * 12 + m - aIdx) % step) + step) % step === 0) out.push(monthDate(year, m, a.getDate()));
  }
  return out;
}
function nextDue(r, today) {
  const a = fromStr(r.renewal), t = fromStr(today), step = FREQS[r.freq].months;
  const aIdx = a.getFullYear() * 12 + a.getMonth();
  let idx = t.getFullYear() * 12 + t.getMonth();
  idx += (((aIdx - idx) % step) + step) % step;
  for (;;) {
    const d = monthDate(Math.floor(idx / 12), idx % 12, a.getDate());
    if (d >= today) return d;
    idx += step;
  }
}
const dueText = (d, today) => { const n = diffDays(today, d); return n === 0 ? 'oggi' : n === 1 ? 'domani' : `tra ${n} giorni`; };

/* ============ Calcoli: anno ============ */
function yearBounds() {
  const cur = Number(todayStr().slice(0, 4));
  let min = cur, max = cur;
  for (const x of [...data.expenses, ...data.incomes]) {
    const y = Number(x.date.slice(0, 4));
    if (y < min) min = y;
    if (y > max) max = y;
  }
  return { min, max };
}
function yearReport(year) {
  const today = todayStr();
  const from = `${year}-01-01`, to = `${year}-12-31`;
  const mSpend = Array(12).fill(0), mInc = Array(12).fill(0);
  const weekly = { macchina: 0, altro: 0 };
  for (const e of data.expenses) {
    if (e.date < from || e.date > to) continue;
    weekly[e.cat] += e.amount;
    mSpend[Number(e.date.slice(5, 7)) - 1] += e.amount;
  }
  const rec = [];
  for (const r of data.recurring) {
    if (!r.active) continue;
    const dates = occurrences(r, year);
    const matured = dates.filter((d) => d <= today);
    for (const d of matured) mSpend[Number(d.slice(5, 7)) - 1] += r.amount;
    rec.push({ r, matured: matured.length * r.amount, projected: dates.length * r.amount });
  }
  const bySource = new Map();
  for (const i of data.incomes) {
    if (i.date < from || i.date > to) continue;
    bySource.set(i.source, (bySource.get(i.source) || 0) + i.amount);
    mInc[Number(i.date.slice(5, 7)) - 1] += i.amount;
  }
  const weeklyTotal = weekly.macchina + weekly.altro;
  const recMatured = rec.reduce((t, x) => t + x.matured, 0);
  const recProjected = rec.reduce((t, x) => t + x.projected, 0);
  const spendTotal = weeklyTotal + recMatured;
  const incTotal = [...bySource.values()].reduce((t, v) => t + v, 0);
  return {
    year, weekly, weeklyTotal, rec, recMatured, recProjected, spendTotal, incTotal, net: incTotal - spendTotal,
    bySource: [...bySource.entries()].sort((a, b) => b[1] - a[1]), mSpend, mInc
  };
}

/* ============ Rendering: Settimana e Storico ============ */
let currentView = 'week';

function renderWeek() {
  const today = todayStr();
  const ws = mondayOf(today);
  const stats = weekStats(ws);

  $('week-range').textContent = `${shortDate(ws)} – ${shortDate(addDays(ws, 6))}`;
  $('total-text').textContent = `${fmtEur(stats.spent)} su ${fmtEur(stats.budget)}`;
  const left = 7 - ((fromStr(today).getDay() + 6) % 7);
  $('days-left').textContent = left === 1 ? 'Ultimo giorno' : `${left} giorni`;

  const bal = piggyBalance();
  $('piggy-balance').textContent = fmtEur(bal);
  $('piggy-balance').className = 'piggy-main' + (bal < 0 ? ' neg' : '');
  $('piggy-week').textContent = ws < data.piggy.trackFrom ? '—' : fmtSigned(stats.net);
  $('piggy-week').className = 'summary-main' + (ws >= data.piggy.trackFrom && stats.net < 0 ? ' neg' : stats.net > 0 && ws >= data.piggy.trackFrom ? ' pos' : '');

  $('cards').innerHTML = stats.cats.map((c) => {
    const st = statusOf(c.remaining, c.budget);
    const pct = c.budget > 0 ? Math.min(100, Math.max(0, (c.spent / c.budget) * 100)) : (c.spent > 0 ? 100 : 0);
    return `<div class="card cat-card st-${st}" data-cat="${c.key}">
      <div class="cat-top"><span>${c.label}</span><span class="label">${c.remaining < 0 ? 'Sforato' : 'Residuo'}</span></div>
      <div class="remaining">${fmtEur(c.remaining)}</div>
      <div class="detail">${fmtEur(c.spent)} spesi su ${fmtEur(c.budget)}</div>
      <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><div style="width:${pct}%"></div></div>
    </div>`;
  }).join('');

  // Spese della settimana corrente, per categoria
  const we = addDays(ws, 6);
  const inWeek = data.expenses.filter((e) => e.date >= ws && e.date <= we);
  $('expense-list').innerHTML = inWeek.length ? CATS.map((c) => {
    const items = inWeek.filter((e) => e.cat === c.key).sort((a, b) => b.date.localeCompare(a.date));
    if (!items.length) return '';
    const tot = items.reduce((t, e) => t + e.amount, 0);
    return `<div class="exp-group"><div class="exp-head"><span>${c.label}</span><span>${fmtEur(tot)}</span></div>
      <div class="group">${items.map((e) => `<div class="row exp-item" data-id="${esc(e.id)}">
        <button class="main edit" data-id="${esc(e.id)}" style="text-align:left">
          <div class="note">${e.note ? esc(e.note) : '<span class="muted">Senza nota</span>'}</div>
          <div class="date">${longDate(e.date)}</div></button>
        <span class="amt">${fmtEur(e.amount)}</span>
        <button class="del" data-id="${esc(e.id)}" aria-label="Elimina spesa">🗑</button>
      </div>`).join('')}</div></div>`;
  }).join('') : '<div class="empty">Nessuna spesa questa settimana.<br>Tocca + per aggiungerne una.</div>';

  renderHistory(ws);
}

function renderHistory(currentWs) {
  const first = firstWeek();
  const weeks = [];
  if (first) for (let w = first; w < currentWs; w = addDays(w, 7)) weeks.push(w);
  weeks.reverse();
  $('history-list').innerHTML = weeks.length ? weeks.map((w) => {
    const st = weekStats(w);
    const ok = st.cats.every((c) => c.remaining >= 0);
    const exps = data.expenses.filter((e) => e.date >= w && e.date <= addDays(w, 6)).sort((a, b) => a.date.localeCompare(b.date));
    const inPiggy = data.piggy.processed[w];
    return `<details class="hist-week"><summary>
      <div class="hist-top"><span>${shortDate(w)} – ${shortDate(addDays(w, 6))}</span><span class="badge ${ok ? 'ok' : 'ko'}">${ok ? 'Rispettato' : 'Sforato'}</span></div>
      ${st.cats.map((c) => `<div class="hist-cat"><span>${c.label}</span><span class="${c.remaining < 0 ? 'ko' : ''}">${fmtEur(c.spent)} / ${fmtEur(c.budget)}</span></div>`).join('')}
      ${inPiggy !== undefined ? `<div class="hist-cat"><span>Nel salvadanaio</span><span class="${inPiggy < 0 ? 'ko' : 'ok'}">${fmtSigned(inPiggy)}</span></div>` : ''}
      </summary>
      ${exps.length ? `<div class="hist-exp">${exps.map((e) => `<div><span>${shortDate(e.date)} · ${CATS.find((c) => c.key === e.cat).label}${e.note ? ' · ' + esc(e.note) : ''}</span><span>${fmtEur(e.amount)}</span></div>`).join('')}</div>` : ''}
    </details>`;
  }).join('') : '<div class="empty">Ancora nessuna settimana conclusa.</div>';
}

/* ============ Rendering: Salvadanaio ============ */
let pgLimit = 30;
function renderPiggy() {
  const bal = piggyBalance();
  $('pg-balance').textContent = fmtEur(bal);
  $('pg-balance').className = 'hero' + (bal < 0 ? ' neg' : bal > 0 ? ' pos' : '');

  const today = todayStr(), ws = mondayOf(today), p = data.piggy;
  let info;
  if (ws < p.trackFrom) {
    info = `L’accumulo automatico parte dalla settimana del ${fullDate(p.trackFrom)}.`;
  } else {
    const net = weekStats(ws).net;
    info = `Settimana in corso: ${fmtSigned(net)} (provvisorio). Si chiude domenica ${shortDate(addDays(ws, 6))} alle 23:59: se hai risparmiato va nel salvadanaio, se hai sforato viene sottratto.`;
  }
  $('pg-info').textContent = info;

  const order = new Map(p.movements.map((m, i) => [m.id, i]));
  const list = p.movements.slice().sort((a, b) => b.date.localeCompare(a.date) || order.get(b.id) - order.get(a.id));
  const shown = list.slice(0, pgLimit);
  $('pg-list').innerHTML = list.length ? `<div class="group">${shown.map((m) => {
    const kind = m.kind === 'manual' ? (m.amount > 0 ? 'Versamento' : 'Prelievo') : MOVE_LABELS[m.kind];
    return `<div class="row mv-item">
      <div class="main"><div class="note">${esc(m.reason || kind)}</div><div class="date">${fullDate(m.date)} · ${kind}</div></div>
      <span class="amt ${m.amount < 0 ? 'neg' : 'pos'}">${fmtSigned(m.amount)}</span>
      ${m.kind === 'manual' ? `<button class="del" data-mv="${esc(m.id)}" aria-label="Elimina movimento">🗑</button>` : ''}
    </div>`;
  }).join('')}</div>${list.length > shown.length ? '<button id="pg-more" class="btn block gap-top">Mostra altri movimenti</button>' : ''}`
    : '<div class="empty">Ancora nessun movimento.</div>';
}

/* ============ Rendering: Ricorrenti ============ */
function renderRecurring() {
  const today = todayStr();
  const active = data.recurring.filter((r) => r.active);
  const yearly = active.reduce((t, r) => t + yearlyCents(r), 0);
  let next = null;
  for (const r of active) {
    const d = nextDue(r, today);
    if (!next || d < next.d) next = { r, d };
  }
  $('rec-summary').innerHTML = `<div class="card">
    <div class="label">Costo fisso equivalente${active.length < data.recurring.length ? ` · ${active.length} voci attive` : ''}</div>
    <div class="rec-big"><span id="rec-total-month">${fmtEur(monthlyEq(yearly))}</span> <small>al mese</small></div>
    <div class="detail"><span id="rec-total-week">${fmtEur(weeklyEq(yearly))}</span> a settimana · <span id="rec-total-year">${fmtEur(yearly)}</span> all’anno</div>
    ${next ? `<div class="detail due">Prossima scadenza: ${esc(next.r.name)}, ${fullDate(next.d)} (${dueText(next.d, today)})</div>` : ''}
  </div>`;

  const items = data.recurring.map((r) => ({ r, d: nextDue(r, today) }))
    .sort((a, b) => (b.r.active - a.r.active) || a.d.localeCompare(b.d));
  $('rec-list').innerHTML = items.length ? items.map(({ r, d }) => {
    const y = yearlyCents(r);
    return `<div class="card rec-card${r.active ? '' : ' off'}" data-id="${esc(r.id)}">
      <button class="rec-main" data-id="${esc(r.id)}">
        <div class="rec-name">${esc(r.name)}${r.toConfirm ? ' <span class="tag">Data da confermare</span>' : ''}</div>
        <div class="rec-amt">${fmtEur(r.amount)} <small>${FREQS[r.freq].per}</small></div>
        <div class="detail">≈ ${fmtEur(monthlyEq(y))} al mese · ${fmtEur(weeklyEq(y))} a settimana</div>
        <div class="detail due">${r.active ? `Prossima scadenza: ${fullDate(d)} (${dueText(d, today)})` : 'Disattivata: non conta nei totali'}</div>
      </button>
      <label class="switch rec-switch"><input type="checkbox" data-id="${esc(r.id)}" aria-label="Attiva ${esc(r.name)}"${r.active ? ' checked' : ''}><span class="slider"></span></label>
    </div>`;
  }).join('') : '<div class="empty">Nessuna spesa ricorrente.<br>Tocca + per aggiungerne una.</div>';
}

/* ============ Rendering: Anno ============ */
let yearSel = null;
const kv = (label, value, cls = '') => `<div class="row kv ${cls}"><span>${label}</span><span class="v">${value}</span></div>`;

function niceMax(cents) {
  const v = Math.max(cents / 100, 1);
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p;
  const n = [1, 2, 3, 4, 5, 6, 8, 10].find((s) => m <= s + 1e-9);
  return n * p;
}
function barPath(x, y, w, h) { // angoli superiori arrotondati (4px), base dritta
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
function chartHtml(rp) {
  const W = 340, H = 190, L = 46, R = 4, T = 10, B = 22;
  const pw = W - L - R, ph = H - T - B, gw = pw / 12, bw = 9, gap = 2;
  const maxV = niceMax(Math.max(...rp.mSpend, ...rp.mInc)) * 100;
  const yOf = (v) => T + ph - (v / maxV) * ph;
  let svg = '';
  for (const f of [0, 0.5, 1]) {
    const y = yOf(maxV * f);
    svg += `<line class="ch-grid" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/><text class="ch-tick" x="${L - 6}" y="${y + 3.5}" text-anchor="end">${numFmt.format(maxV * f / 100)} €</text>`;
  }
  for (let m = 0; m < 12; m++) {
    const gx = L + m * gw, cx = gx + gw / 2;
    const hs = (rp.mSpend[m] / maxV) * ph, hi = (rp.mInc[m] / maxV) * ph;
    const label = `${MONTHS_LONG[m]}: spese ${fmtEur(rp.mSpend[m])}, guadagni ${fmtEur(rp.mInc[m])}`;
    svg += `<g class="ch-g" data-m="${m}" tabindex="0" role="img" aria-label="${label}">
      <rect class="ch-bg" x="${gx + 1}" y="${T}" width="${gw - 2}" height="${ph}" rx="4"/>
      ${hs > 0 ? `<path class="ch-spend" d="${barPath(cx - bw - gap / 2, yOf(rp.mSpend[m]), bw, hs)}"/>` : ''}
      ${hi > 0 ? `<path class="ch-inc" d="${barPath(cx + gap / 2, yOf(rp.mInc[m]), bw, hi)}"/>` : ''}
      <text class="ch-month" x="${cx}" y="${H - 6}" text-anchor="middle">${MONTHS_SHORT[m]}</text>
    </g>`;
  }
  const rows = MONTHS_LONG.map((n, m) => `<tr><td>${n}</td><td>${fmtEur(rp.mSpend[m])}</td><td>${fmtEur(rp.mInc[m])}</td></tr>`).join('');
  return `<div class="card chart-card">
    <div class="chart-head"><h3>Mese per mese</h3>
      <div class="legend"><span><i class="sw sw-spend"></i>Spese</span><span><i class="sw sw-inc"></i>Guadagni</span></div></div>
    <svg id="chart" viewBox="0 0 ${W} ${H}" role="group" aria-label="Spese e guadagni mese per mese nel ${rp.year}">${svg}</svg>
    <div id="ch-readout" class="ch-readout" aria-live="polite">Tocca un mese per vedere i valori.</div>
    <details class="ch-table"><summary>Mostra tabella</summary>
      <table><thead><tr><th>Mese</th><th>Spese</th><th>Guadagni</th></tr></thead><tbody>${rows}</tbody></table></details>
  </div>`;
}

function renderYear() {
  const { min, max } = yearBounds();
  if (yearSel === null) yearSel = Number(todayStr().slice(0, 4));
  yearSel = Math.min(max, Math.max(min, yearSel));
  $('year-label').textContent = String(yearSel);
  $('year-prev').disabled = yearSel <= min;
  $('year-next').disabled = yearSel >= max;
  const rp = yearReport(yearSel);
  const netCls = rp.net > 0 ? 'pos' : rp.net < 0 ? 'neg' : '';
  const incomes = data.incomes.filter((i) => i.date >= `${yearSel}-01-01` && i.date <= `${yearSel}-12-31`)
    .sort((a, b) => b.date.localeCompare(a.date));

  $('year-body').innerHTML = `
    <div class="card net-card">
      <div class="label">Netto ${yearSel}</div>
      <div id="y-net" class="hero ${netCls}">${fmtSigned(rp.net)}</div>
      <div class="detail">Guadagni ${fmtEur(rp.incTotal)} − spese ${fmtEur(rp.spendTotal)}</div>
    </div>

    <h2 class="section-title">Spese</h2>
    <div class="group">
      ${kv('Settimanali', `<span id="y-weekly">${fmtEur(rp.weeklyTotal)}</span>`, 'strong')}
      ${CATS.map((c) => kv(c.label, fmtEur(rp.weekly[c.key]), 'sub')).join('')}
      ${kv('Ricorrenti maturate', `<span id="y-rec">${fmtEur(rp.recMatured)}</span>`, 'strong')}
      ${rp.rec.length ? rp.rec.map((x) => kv(esc(x.r.name), fmtEur(x.matured), 'sub')).join('') : kv('Nessuna voce attiva', '', 'sub')}
      ${kv('Totale spese', `<span id="y-spend">${fmtEur(rp.spendTotal)}</span>`, 'strong total')}
    </div>

    <h2 class="section-title">Guadagni</h2>
    <div class="group">
      ${rp.bySource.length ? rp.bySource.map(([s, v]) => kv(esc(s), fmtEur(v), 'sub')).join('') + kv('Totale guadagni', `<span id="y-inc">${fmtEur(rp.incTotal)}</span>`, 'strong total')
        : kv('Nessun guadagno nel ' + yearSel, '', 'sub')}
    </div>

    <h2 class="section-title">Proiezione ricorrenti a fine anno</h2>
    <div class="group">
      ${rp.rec.map((x) => kv(esc(x.r.name), fmtEur(x.projected), 'sub')).join('')}
      ${kv('Costo totale ricorrenti nel ' + yearSel, `<span id="y-proj">${fmtEur(rp.recProjected)}</span>`, 'strong total')}
    </div>
    <p class="footnote">${rp.recProjected > rp.recMatured ? `Finora maturati ${fmtEur(rp.recMatured)}: da qui a fine anno ne mancano ${fmtEur(rp.recProjected - rp.recMatured)}.` : 'Tutte le scadenze dell’anno sono già maturate.'}</p>

    ${chartHtml(rp)}

    <h2 class="section-title">Guadagni ${yearSel}</h2>
    ${incomes.length ? `<div class="group">${incomes.map((i) => `<div class="row exp-item">
      <button class="main edit-income" data-id="${esc(i.id)}" style="text-align:left">
        <div class="note">${esc(i.source)}${i.note ? ' · ' + esc(i.note) : ''}</div>
        <div class="date">${longDate(i.date)}${i.toPiggy ? ' · nel salvadanaio' : ''}</div></button>
      <span class="amt">${fmtEur(i.amount)}</span>
      <button class="del del-income" data-id="${esc(i.id)}" aria-label="Elimina guadagno">🗑</button>
    </div>`).join('')}</div>` : '<div class="empty">Nessun guadagno registrato.</div>'}
    <button id="year-add-income" class="btn block gap-top">Aggiungi guadagno</button>`;
}

function renderSettings() {
  const b = data.settings.budgets;
  const cur = b.filter((x) => x.from <= mondayOf(todayStr())).pop() || b[0];
  $('set-macchina').value = centsToInput(cur.macchina);
  $('set-altro').value = centsToInput(cur.altro);
  const has = { v1: safeGet(BACKUP_V1_KEY) !== null, last: safeGet(BACKUP_LAST_KEY) !== null, bad: safeGet(CORRUPT_KEY) !== null };
  $('btn-export-v1').hidden = !has.v1;
  $('btn-export-last').hidden = !has.last;
  $('btn-export-bad').hidden = !has.bad;
  $('safety-wrap').hidden = !(has.v1 || has.last || has.bad);
}

function renderAll() {
  renderWeek(); renderPiggy(); renderRecurring(); renderYear();
  if (currentView === 'settings') renderSettings();
}

/* ============ Navigazione ============ */
const TAB_OF = { history: 'week', settings: 'week' };
function showView(name) {
  currentView = name;
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === (TAB_OF[name] || name)));
  $('fab').hidden = name !== 'week';
  if (name === 'settings') renderSettings();
  window.scrollTo(0, 0);
}
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showView(t.dataset.view)));
document.addEventListener('click', (ev) => {
  const g = ev.target.closest('[data-goto]');
  if (g) showView(g.dataset.goto);
});

/* ============ Toast e conferma ============ */
let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

function confirmDialog({ title, message, okLabel = 'OK', destructive = false }) {
  return new Promise((resolve) => {
    $('dialog-title').textContent = title;
    $('dialog-msg').textContent = message;
    const ok = $('dialog-ok');
    ok.textContent = okLabel;
    ok.classList.toggle('destructive', destructive);
    $('dialog-wrap').hidden = false;
    const done = (v) => {
      $('dialog-wrap').hidden = true;
      ok.onclick = $('dialog-cancel').onclick = null;
      resolve(v);
    };
    ok.onclick = () => done(true);
    $('dialog-cancel').onclick = () => done(false);
  });
}

/* ============ Fogli (sheet) ============ */
const SHEETS = ['sheet-add', 'sheet-expense', 'sheet-income', 'sheet-move', 'sheet-rec'];
let openSheetId = null;
let editingId = null, editingIncomeId = null, editingRecId = null;

function openSheetEl(id, focusId) {
  closeSheet();
  $('backdrop').hidden = false;
  $(id).classList.add('open');
  $(id).setAttribute('aria-hidden', 'false');
  openSheetId = id;
  if (focusId) $(focusId).focus();
}
function closeSheet() {
  SHEETS.forEach((id) => { $(id).classList.remove('open'); $(id).setAttribute('aria-hidden', 'true'); });
  $('backdrop').hidden = true;
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  openSheetId = null;
  editingId = editingIncomeId = editingRecId = null;
}
const anySheetOpen = () => openSheetId !== null;
const showError = (id, msg, focusId) => { const el = $(id); el.textContent = msg; el.hidden = false; if (focusId) $(focusId).focus(); };

$('backdrop').addEventListener('click', closeSheet);
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeSheet));
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && anySheetOpen() && $('dialog-wrap').hidden) closeSheet(); });

// Segmented controls
let formCat = 'macchina', moveKind = 'deposit', recFreq = 'monthly';
const setSeg = (container, attr, value) => container.querySelectorAll('.seg').forEach((s) => s.classList.toggle('active', s.dataset[attr] === value));
function setFormCat(cat) { formCat = cat; setSeg($('expense-form'), 'cat', cat); }
function setMoveKind(k) { moveKind = k; setSeg($('move-form'), 'kind', k); }
function setRecFreq(f) { recFreq = f; setSeg($('rec-form'), 'freq', f); }
$('expense-form').querySelectorAll('.seg').forEach((s) => s.addEventListener('click', () => setFormCat(s.dataset.cat)));
$('move-form').querySelectorAll('.seg').forEach((s) => s.addEventListener('click', () => setMoveKind(s.dataset.kind)));
$('rec-form').querySelectorAll('.seg').forEach((s) => s.addEventListener('click', () => setRecFreq(s.dataset.freq)));

// Salva i dati dopo una modifica; ricalcola il salvadanaio (chiusure e rettifiche)
function persist() { processPiggy(); save(); }

/* ---- Spese ---- */
function openExpenseSheet(id) {
  editingId = null;
  const e = id ? data.expenses.find((x) => x.id === id) : null;
  $('sheet-title').textContent = e ? 'Modifica spesa' : 'Nuova spesa';
  $('f-amount').value = e ? centsToInput(e.amount) : '';
  $('f-note').value = e ? e.note : '';
  $('f-date').value = e ? e.date : todayStr();
  const last = safeGet(LAST_CAT_KEY) || 'macchina';
  setFormCat(e ? e.cat : (CATS.some((c) => c.key === last) ? last : 'macchina'));
  $('f-delete').hidden = !e;
  $('f-error').hidden = true;
  openSheetEl('sheet-expense', 'f-amount');
  editingId = e ? e.id : null;
}

function submitExpense() {
  const cents = parseAmount($('f-amount').value);
  const date = $('f-date').value;
  if (cents === null) return showError('f-error', 'Inserisci un importo valido (es. 12,50).', 'f-amount');
  if (!isDateStr(date)) return showError('f-error', 'Inserisci una data valida.');
  const note = $('f-note').value.trim().slice(0, 80);
  if (editingId) {
    const e = data.expenses.find((x) => x.id === editingId);
    Object.assign(e, { amount: cents, cat: formCat, note, date });
  } else {
    data.expenses.push({ id: uid(), cat: formCat, amount: cents, note, date });
  }
  safeSet(LAST_CAT_KEY, formCat);
  persist();
  const inCurrent = mondayOf(date) === mondayOf(todayStr());
  closeSheet();
  renderAll();
  toast(inCurrent ? 'Spesa salvata' : 'Spesa salvata (non è nella settimana corrente)');
}

async function deleteExpense(id) {
  const e = data.expenses.find((x) => x.id === id);
  if (!e) return;
  const ok = await confirmDialog({ title: 'Eliminare la spesa?', message: `${fmtEur(e.amount)}${e.note ? ' · ' + e.note : ''}`, okLabel: 'Elimina', destructive: true });
  if (!ok) return;
  data.expenses = data.expenses.filter((x) => x.id !== id);
  persist();
  if (anySheetOpen()) closeSheet();
  renderAll();
  toast('Spesa eliminata');
}

$('fab').addEventListener('click', () => openSheetEl('sheet-add'));
$('add-expense').addEventListener('click', () => openExpenseSheet());
$('add-income').addEventListener('click', () => openIncomeSheet());
$('sheet-save').addEventListener('click', submitExpense);
$('expense-form').addEventListener('submit', (ev) => { ev.preventDefault(); submitExpense(); });
$('f-delete').addEventListener('click', () => editingId && deleteExpense(editingId));
$('expense-list').addEventListener('click', (ev) => {
  const del = ev.target.closest('.del');
  if (del) return deleteExpense(del.dataset.id);
  const edit = ev.target.closest('.edit');
  if (edit) openExpenseSheet(edit.dataset.id);
});

/* ---- Guadagni ---- */
function fillSources(selected) {
  const sel = $('i-source');
  sel.innerHTML = data.sources.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('') + '<option value="__new__">＋ Nuova fonte…</option>';
  sel.value = data.sources.includes(selected) ? selected : data.sources[0];
  $('i-newsource-row').hidden = sel.value !== '__new__';
}
$('i-source').addEventListener('change', () => {
  const isNew = $('i-source').value === '__new__';
  $('i-newsource-row').hidden = !isNew;
  if (isNew) $('i-newsource').focus();
});

function openIncomeSheet(id) {
  editingIncomeId = null;
  const i = id ? data.incomes.find((x) => x.id === id) : null;
  $('income-title').textContent = i ? 'Modifica guadagno' : 'Nuovo guadagno';
  $('i-amount').value = i ? centsToInput(i.amount) : '';
  fillSources(i ? i.source : (safeGet(LAST_SOURCE_KEY) || data.sources[0]));
  $('i-newsource').value = '';
  $('i-date').value = i ? i.date : todayStr();
  $('i-note').value = i ? i.note : '';
  $('i-piggy').checked = i ? i.toPiggy : false;
  $('i-delete').hidden = !i;
  $('i-error').hidden = true;
  openSheetEl('sheet-income', 'i-amount');
  editingIncomeId = i ? i.id : null;
}

// Mantiene allineato il versamento nel salvadanaio collegato a un guadagno
function syncIncomeMove(inc) {
  const mv = data.piggy.movements;
  const idx = mv.findIndex((m) => m.incomeId === inc.id);
  if (inc.toPiggy) {
    const entry = { id: idx >= 0 ? mv[idx].id : uid(), kind: 'income', incomeId: inc.id, date: inc.date, amount: inc.amount, reason: `Guadagno: ${inc.source}${inc.note ? ' · ' + inc.note : ''}`.slice(0, 120) };
    if (idx >= 0) mv[idx] = entry; else mv.push(entry);
  } else if (idx >= 0) {
    mv.splice(idx, 1);
  }
}

function submitIncome() {
  const cents = parseAmount($('i-amount').value);
  const date = $('i-date').value;
  if (cents === null) return showError('i-error', 'Inserisci un importo valido (es. 45,00).', 'i-amount');
  if (!isDateStr(date)) return showError('i-error', 'Inserisci una data valida.');
  let source = $('i-source').value;
  if (source === '__new__') {
    source = $('i-newsource').value.trim().slice(0, 30);
    if (!source) return showError('i-error', 'Scrivi il nome della nuova fonte.', 'i-newsource');
    const existing = data.sources.find((s) => s.toLowerCase() === source.toLowerCase());
    if (existing) source = existing; else data.sources.push(source);
  }
  const fields = { amount: cents, source, date, note: $('i-note').value.trim().slice(0, 80), toPiggy: $('i-piggy').checked };
  let inc;
  if (editingIncomeId) { inc = data.incomes.find((x) => x.id === editingIncomeId); Object.assign(inc, fields); }
  else { inc = { id: uid(), ...fields }; data.incomes.push(inc); }
  syncIncomeMove(inc);
  safeSet(LAST_SOURCE_KEY, source);
  persist();
  closeSheet();
  renderAll();
  toast(inc.toPiggy ? 'Guadagno salvato e versato nel salvadanaio' : 'Guadagno salvato (lo trovi in Anno)');
}

async function deleteIncome(id) {
  const i = data.incomes.find((x) => x.id === id);
  if (!i) return;
  const ok = await confirmDialog({
    title: 'Eliminare il guadagno?',
    message: `${fmtEur(i.amount)} · ${i.source}${i.toPiggy ? '. Verrà tolto anche il versamento nel salvadanaio.' : ''}`,
    okLabel: 'Elimina', destructive: true
  });
  if (!ok) return;
  data.incomes = data.incomes.filter((x) => x.id !== id);
  data.piggy.movements = data.piggy.movements.filter((m) => m.incomeId !== id);
  persist();
  if (anySheetOpen()) closeSheet();
  renderAll();
  toast('Guadagno eliminato');
}

$('income-save').addEventListener('click', submitIncome);
$('income-form').addEventListener('submit', (ev) => { ev.preventDefault(); submitIncome(); });
$('i-delete').addEventListener('click', () => editingIncomeId && deleteIncome(editingIncomeId));
$('year-body').addEventListener('click', (ev) => {
  const del = ev.target.closest('.del-income');
  if (del) return deleteIncome(del.dataset.id);
  const edit = ev.target.closest('.edit-income');
  if (edit) return openIncomeSheet(edit.dataset.id);
  if (ev.target.closest('#year-add-income')) return openIncomeSheet();
  const g = ev.target.closest('.ch-g');
  if (g) selectMonth(g);
});

/* ---- Grafico: lettura dei valori per mese ---- */
function selectMonth(g) {
  document.querySelectorAll('.ch-g.sel').forEach((x) => x.classList.remove('sel'));
  g.classList.add('sel');
  $('ch-readout').textContent = g.getAttribute('aria-label');
}
$('year-body').addEventListener('pointerover', (ev) => { const g = ev.target.closest('.ch-g'); if (g && ev.pointerType === 'mouse') selectMonth(g); });
$('year-body').addEventListener('focusin', (ev) => { const g = ev.target.closest && ev.target.closest('.ch-g'); if (g) selectMonth(g); });
$('year-prev').addEventListener('click', () => { yearSel -= 1; renderYear(); });
$('year-next').addEventListener('click', () => { yearSel += 1; renderYear(); });

/* ---- Movimenti del salvadanaio ---- */
function openMoveSheet(kind) {
  setMoveKind(kind);
  $('move-title').textContent = 'Salvadanaio';
  $('m-amount').value = '';
  $('m-note').value = '';
  $('m-date').value = todayStr();
  $('m-error').hidden = true;
  openSheetEl('sheet-move', 'm-amount');
}
async function submitMove() {
  const cents = parseAmount($('m-amount').value);
  const date = $('m-date').value;
  if (cents === null) return showError('m-error', 'Inserisci un importo valido (es. 10,00).', 'm-amount');
  if (!isDateStr(date)) return showError('m-error', 'Inserisci una data valida.');
  const withdraw = moveKind === 'withdraw';
  if (withdraw && cents > piggyBalance()) {
    const ok = await confirmDialog({ title: 'Saldo insufficiente', message: `Il saldo è ${fmtEur(piggyBalance())}: dopo il prelievo diventerà ${fmtEur(piggyBalance() - cents)}. Continuare?`, okLabel: 'Preleva', destructive: true });
    if (!ok) return;
  }
  const note = $('m-note').value.trim().slice(0, 80);
  data.piggy.movements.push({ id: uid(), kind: 'manual', date, amount: withdraw ? -cents : cents, reason: note || (withdraw ? 'Prelievo manuale' : 'Versamento manuale') });
  persist();
  closeSheet();
  renderAll();
  toast(withdraw ? 'Prelievo registrato' : 'Versamento registrato');
}
async function deleteMove(id) {
  const m = data.piggy.movements.find((x) => x.id === id && x.kind === 'manual');
  if (!m) return;
  const ok = await confirmDialog({ title: 'Eliminare il movimento?', message: `${fmtSigned(m.amount)} · ${m.reason}`, okLabel: 'Elimina', destructive: true });
  if (!ok) return;
  data.piggy.movements = data.piggy.movements.filter((x) => x.id !== id);
  persist();
  renderAll();
  toast('Movimento eliminato');
}
$('pg-deposit').addEventListener('click', () => openMoveSheet('deposit'));
$('pg-withdraw').addEventListener('click', () => openMoveSheet('withdraw'));
$('move-save').addEventListener('click', submitMove);
$('move-form').addEventListener('submit', (ev) => { ev.preventDefault(); submitMove(); });
$('pg-list').addEventListener('click', (ev) => {
  const del = ev.target.closest('.del');
  if (del) return deleteMove(del.dataset.mv);
  if (ev.target.closest('#pg-more')) { pgLimit += 30; renderPiggy(); }
});

/* ---- Ricorrenti ---- */
function openRecSheet(id) {
  editingRecId = null;
  const r = id ? data.recurring.find((x) => x.id === id) : null;
  $('rec-title').textContent = r ? 'Modifica ricorrente' : 'Nuova ricorrente';
  $('r-name').value = r ? r.name : '';
  $('r-amount').value = r ? centsToInput(r.amount) : '';
  $('r-date').value = r ? r.renewal : todayStr();
  $('r-active').checked = r ? r.active : true;
  $('r-confirm').checked = r ? r.toConfirm : false;
  $('r-confirm-row').hidden = !(r && r.toConfirm);
  setRecFreq(r ? r.freq : 'monthly');
  $('r-delete').hidden = !r;
  $('r-error').hidden = true;
  openSheetEl('sheet-rec', r ? null : 'r-name');
  editingRecId = r ? r.id : null;
}
// Cambiando la data, la data si considera confermata
$('r-date').addEventListener('change', () => { $('r-confirm').checked = false; });

function submitRec() {
  const name = $('r-name').value.trim().slice(0, 40);
  const cents = parseAmount($('r-amount').value);
  const date = $('r-date').value;
  if (!name) return showError('r-error', 'Scrivi il nome della voce.', 'r-name');
  if (cents === null) return showError('r-error', 'Inserisci un importo valido (es. 24,00).', 'r-amount');
  if (!isDateStr(date)) return showError('r-error', 'Inserisci una data di rinnovo valida.');
  const fields = { name, amount: cents, freq: recFreq, renewal: date, active: $('r-active').checked, toConfirm: $('r-confirm').checked };
  if (editingRecId) Object.assign(data.recurring.find((x) => x.id === editingRecId), fields);
  else data.recurring.push({ id: uid(), ...fields });
  persist();
  closeSheet();
  renderAll();
  toast('Ricorrente salvata');
}
async function deleteRec(id) {
  const r = data.recurring.find((x) => x.id === id);
  if (!r) return;
  const ok = await confirmDialog({ title: 'Eliminare la voce?', message: `${r.name} · ${fmtEur(r.amount)} ${FREQS[r.freq].per}`, okLabel: 'Elimina', destructive: true });
  if (!ok) return;
  data.recurring = data.recurring.filter((x) => x.id !== id);
  persist();
  closeSheet();
  renderAll();
  toast('Voce eliminata');
}
$('rec-add').addEventListener('click', () => openRecSheet());
$('rec-save').addEventListener('click', submitRec);
$('rec-form').addEventListener('submit', (ev) => { ev.preventDefault(); submitRec(); });
$('r-delete').addEventListener('click', () => editingRecId && deleteRec(editingRecId));
$('rec-list').addEventListener('click', (ev) => {
  const main = ev.target.closest('.rec-main');
  if (main) openRecSheet(main.dataset.id);
});
$('rec-list').addEventListener('change', (ev) => {
  const cb = ev.target.closest('input[type="checkbox"][data-id]');
  if (!cb) return;
  const r = data.recurring.find((x) => x.id === cb.dataset.id);
  if (!r) return;
  r.active = cb.checked;
  persist();
  renderAll();
});

/* ============ Impostazioni, esporta / importa ============ */
$('save-budgets').addEventListener('click', () => {
  const m = parseAmount($('set-macchina').value);
  const a = parseAmount($('set-altro').value);
  if (m === null || a === null) { toast('Inserisci importi validi'); return; }
  const from = mondayOf(todayStr());
  const list = data.settings.budgets;
  const existing = list.find((b) => b.from === from);
  if (existing) { existing.macchina = m; existing.altro = a; }
  else list.push({ from, macchina: m, altro: a });
  list.sort((x, y) => x.from.localeCompare(y.from));
  persist(); renderAll(); renderSettings();
  toast('Budget aggiornati');
});

async function exportText(json, name) {
  const file = new File([json], name, { type: 'application/json' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Backup budget' });
      return;
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return;
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast('Backup esportato');
}
$('btn-export').addEventListener('click', () => exportText(JSON.stringify(data, null, 2), `budget-backup-${todayStr()}.json`));
$('btn-export-v1').addEventListener('click', () => { const t = safeGet(BACKUP_V1_KEY); if (t) exportText(t, 'budget-copia-prima-aggiornamento-v1.json'); });
$('btn-export-last').addEventListener('click', () => { const t = safeGet(BACKUP_LAST_KEY); if (t) exportText(t, 'budget-copia-prima-ultima-modifica.json'); });
$('btn-export-bad').addEventListener('click', () => { const t = safeGet(CORRUPT_KEY); if (t) exportText(t, 'budget-dati-non-leggibili.json'); });

$('btn-import').addEventListener('click', () => $('file-import').click());
$('file-import').addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  let imported, oldFormat = false;
  try {
    const parsed = JSON.parse(await file.text());
    oldFormat = !!parsed && parsed.version === 1;
    imported = migrate(parsed);
  } catch (err) { toast('Importazione fallita: ' + err.message); return; }
  const ok = await confirmDialog({
    title: 'Importare il backup?',
    message: `Verranno sostituiti tutti i dati attuali con ${imported.expenses.length} spese, ${imported.incomes.length} guadagni e ${imported.recurring.length} ricorrenti del backup.` +
      (oldFormat ? ' Il file è del formato precedente: lo aggiorno e il salvadanaio riparte da 20,00 €.' : ''),
    okLabel: 'Importa', destructive: true
  });
  if (!ok) return;
  safeSet(BACKUP_LAST_KEY, JSON.stringify(data)); // copia di sicurezza dei dati che stanno per essere sostituiti
  data = imported;
  persist(); renderAll(); renderSettings();
  toast('Dati importati');
});

$('btn-clear').addEventListener('click', async () => {
  const one = await confirmDialog({ title: 'Cancellare tutto?', message: 'Spese, guadagni, salvadanaio, ricorrenti e impostazioni verranno eliminati.', okLabel: 'Continua', destructive: true });
  if (!one) return;
  const two = await confirmDialog({ title: 'Ultima conferma', message: 'Questa azione è irreversibile. Vuoi davvero cancellare tutti i dati?', okLabel: 'Cancella tutto', destructive: true });
  if (!two) return;
  safeSet(BACKUP_LAST_KEY, JSON.stringify(data));
  data = blankData();
  save(); renderAll(); renderSettings();
  toast('Dati cancellati');
});

/* ============ Avvio ============ */
// Chiude le settimane concluse (anche dopo giorni o settimane di assenza) e aggiorna lo schermo.
// Si riesegue quando l'app torna in primo piano e ogni minuto (passaggio di mezzanotte).
let lastDay = null;
function tick() {
  const changed = processPiggy();
  if (changed && !loadFailed) save();
  const day = todayStr();
  if ((changed || day !== lastDay) && !anySheetOpen()) { lastDay = day; renderAll(); }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) { lastDay = null; tick(); } });
setInterval(tick, 60 * 1000);

{ const changed = processPiggy(); if ((changed || migratedAtLoad) && !loadFailed) save(); }
lastDay = todayStr();
renderAll();
showView('week');
if (startupNotice) toast(startupNotice);
if (TEST_DATE) {
  const b = document.createElement('div');
  b.className = 'test-banner';
  b.textContent = `Modalità test · oggi = ${TEST_DATE} · i dati veri non vengono toccati`;
  document.body.prepend(b);
}

if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js')
      .then((reg) => document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); }))
      .catch(() => {});
  });
  // Quando arriva una nuova versione dell'app la ricarica da sola (senza interrompere un inserimento in corso)
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    const typing = document.activeElement && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
    if (anySheetOpen() || typing) { toast('Aggiornamento pronto: chiudi e riapri l’app'); return; }
    location.reload();
  });
}
