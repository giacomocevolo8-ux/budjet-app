'use strict';

/* ============ Costanti e utilità ============ */
const STORAGE_KEY = 'budget-settimanale';
const LAST_CAT_KEY = 'budget-last-cat';
const SCHEMA_VERSION = 1;
const CATS = [
  { key: 'macchina', label: 'Macchina' },
  { key: 'altro', label: 'Altro' }
];
const MAX_CENTS = 100000000; // 1.000.000 €

const eur = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
const fmtEur = (cents) => eur.format(cents / 100);
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Data "oggi" (con possibilità di simulazione per test: ?oggi=2026-10-12)
function todayStr() {
  const fake = new URLSearchParams(location.search).get('oggi');
  if (fake && /^\d{4}-\d{2}-\d{2}$/.test(fake)) return fake;
  return toStr(new Date());
}
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
const shortDate = (s) => fromStr(s).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
const longDate = (s) => fromStr(s).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });

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

/* ============ Dati ============ */
function defaultData() {
  return { version: SCHEMA_VERSION, settings: { carryOver: false, budgets: [{ from: '0000-00-00', macchina: 2000, altro: 2000 }] }, expenses: [] };
}

// Porta qualunque versione nota alla versione corrente. Lancia se non valido.
function migrate(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('File non valido');
  if (typeof raw.version !== 'number') throw new Error('Versione dati mancante');
  if (raw.version > SCHEMA_VERSION) throw new Error('Dati creati da una versione più recente');
  // (qui in futuro: if (raw.version === 1) { ...; raw.version = 2 })
  const base = defaultData();
  const s = raw.settings || {};
  let budgets = Array.isArray(s.budgets) ? s.budgets.filter((b) =>
    b && (b.from === '0000-00-00' || isDateStr(b.from)) &&
    Number.isInteger(b.macchina) && b.macchina >= 0 && Number.isInteger(b.altro) && b.altro >= 0) : [];
  if (!budgets.length) budgets = base.settings.budgets;
  budgets.sort((a, b) => a.from.localeCompare(b.from));
  if (!Array.isArray(raw.expenses)) throw new Error('Elenco spese mancante');
  const expenses = raw.expenses.map((e) => {
    if (!e || !CATS.some((c) => c.key === e.cat) || !Number.isInteger(e.amount) || e.amount <= 0 || e.amount > MAX_CENTS || !isDateStr(e.date)) {
      throw new Error('Una o più spese non sono valide');
    }
    return { id: typeof e.id === 'string' && e.id ? e.id : uid(), cat: e.cat, amount: e.amount, note: String(e.note || '').slice(0, 80), date: e.date };
  });
  return { version: SCHEMA_VERSION, settings: { carryOver: !!s.carryOver, budgets }, expenses };
}

let storageOk = true;
function load() {
  try {
    const txt = localStorage.getItem(STORAGE_KEY);
    if (txt) return migrate(JSON.parse(txt));
  } catch (err) {
    console.warn('Dati non leggibili, riparto da zero', err);
  }
  return defaultData();
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); storageOk = true; }
  catch (err) { storageOk = false; toast('Impossibile salvare i dati!'); }
}
let data = load();

/* ============ Calcoli ============ */
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
// Budget effettivo di una settimana (con riporto, se attivo): solo residui positivi si riportano.
function effectiveBudget(cat, weekStart) {
  let carry = 0;
  const first = firstWeek();
  if (data.settings.carryOver && first && first < weekStart) {
    for (let w = first; w < weekStart; w = addDays(w, 7)) {
      carry = Math.max(0, baseBudget(cat, w) + carry - spentIn(cat, w));
    }
  }
  return baseBudget(cat, weekStart) + carry;
}
function weekStats(weekStart) {
  const cats = CATS.map((c) => {
    const budget = effectiveBudget(c.key, weekStart);
    const spent = spentIn(c.key, weekStart);
    return { ...c, budget, spent, remaining: budget - spent };
  });
  return { cats, budget: cats.reduce((t, c) => t + c.budget, 0), spent: cats.reduce((t, c) => t + c.spent, 0) };
}
function statusOf(remaining, budget) {
  if (remaining < 0) return 'red';
  if (budget <= 0) return remaining > 0 ? 'green' : 'orange';
  return remaining / budget > 0.3 ? 'green' : 'orange';
}

/* ============ Rendering ============ */
let currentView = 'week';

function render() {
  const today = todayStr();
  const ws = mondayOf(today);
  const stats = weekStats(ws);

  $('week-range').textContent = `${shortDate(ws)} – ${shortDate(addDays(ws, 6))}`;
  $('total-text').textContent = `${fmtEur(stats.spent)} su ${fmtEur(stats.budget)}`;
  const left = 7 - ((fromStr(today).getDay() + 6) % 7);
  $('days-left').textContent = left === 1 ? 'Ultimo giorno' : `${left} giorni`;

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
      <div class="group">${items.map((e) => `<div class="row exp-item" data-id="${e.id}">
        <button class="main edit" data-id="${e.id}" style="text-align:left">
          <div class="note">${e.note ? esc(e.note) : '<span class="muted">Senza nota</span>'}</div>
          <div class="date">${longDate(e.date)}</div></button>
        <span class="amt">${fmtEur(e.amount)}</span>
        <button class="del" data-id="${e.id}" aria-label="Elimina spesa">🗑</button>
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
    return `<details class="hist-week"><summary>
      <div class="hist-top"><span>${shortDate(w)} – ${shortDate(addDays(w, 6))}</span><span class="badge ${ok ? 'ok' : 'ko'}">${ok ? 'Rispettato' : 'Sforato'}</span></div>
      ${st.cats.map((c) => `<div class="hist-cat"><span>${c.label}</span><span class="${c.remaining < 0 ? 'ko' : ''}">${fmtEur(c.spent)} / ${fmtEur(c.budget)}</span></div>`).join('')}
      </summary>
      ${exps.length ? `<div class="hist-exp">${exps.map((e) => `<div><span>${shortDate(e.date)} · ${CATS.find((c) => c.key === e.cat).label}${e.note ? ' · ' + esc(e.note) : ''}</span><span>${fmtEur(e.amount)}</span></div>`).join('')}</div>` : ''}
    </details>`;
  }).join('') : '<div class="empty">Ancora nessuna settimana conclusa.</div>';
}

function renderSettings() {
  const b = data.settings.budgets;
  const cur = b.filter((x) => x.from <= mondayOf(todayStr())).pop() || b[0];
  $('set-macchina').value = centsToInput(cur.macchina);
  $('set-altro').value = centsToInput(cur.altro);
  $('set-carry').checked = data.settings.carryOver;
}

/* ============ Navigazione ============ */
function showView(name) {
  currentView = name;
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
  $('fab').hidden = name === 'settings';
  if (name === 'settings') renderSettings();
  window.scrollTo(0, 0);
}
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showView(t.dataset.view)));

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

/* ============ Foglio inserimento / modifica ============ */
let editingId = null;
let formCat = 'macchina';

function setFormCat(cat) {
  formCat = cat;
  document.querySelectorAll('.seg').forEach((s) => s.classList.toggle('active', s.dataset.cat === cat));
}
document.querySelectorAll('.seg').forEach((s) => s.addEventListener('click', () => setFormCat(s.dataset.cat)));

function openSheet(id) {
  editingId = id || null;
  const e = id ? data.expenses.find((x) => x.id === id) : null;
  $('sheet-title').textContent = e ? 'Modifica spesa' : 'Nuova spesa';
  $('f-amount').value = e ? centsToInput(e.amount) : '';
  $('f-note').value = e ? e.note : '';
  $('f-date').value = e ? e.date : todayStr();
  let last = 'macchina';
  try { last = localStorage.getItem(LAST_CAT_KEY) || 'macchina'; } catch (_) {}
  setFormCat(e ? e.cat : (CATS.some((c) => c.key === last) ? last : 'macchina'));
  $('f-delete').hidden = !e;
  $('f-error').hidden = true;
  $('backdrop').hidden = false;
  $('sheet').classList.add('open');
  $('sheet').setAttribute('aria-hidden', 'false');
  $('f-amount').focus();
}
function closeSheet() {
  $('sheet').classList.remove('open');
  $('sheet').setAttribute('aria-hidden', 'true');
  $('backdrop').hidden = true;
  document.activeElement && document.activeElement.blur();
  editingId = null;
}

function submitExpense() {
  const cents = parseAmount($('f-amount').value);
  const date = $('f-date').value;
  const err = $('f-error');
  if (cents === null) { err.textContent = 'Inserisci un importo valido (es. 12,50).'; err.hidden = false; $('f-amount').focus(); return; }
  if (!isDateStr(date)) { err.textContent = 'Inserisci una data valida.'; err.hidden = false; return; }
  const note = $('f-note').value.trim().slice(0, 80);
  if (editingId) {
    const e = data.expenses.find((x) => x.id === editingId);
    Object.assign(e, { amount: cents, cat: formCat, note, date });
  } else {
    data.expenses.push({ id: uid(), cat: formCat, amount: cents, note, date });
  }
  try { localStorage.setItem(LAST_CAT_KEY, formCat); } catch (_) {}
  save();
  const inCurrent = mondayOf(date) === mondayOf(todayStr());
  closeSheet();
  render();
  toast(inCurrent ? 'Spesa salvata' : 'Spesa salvata (non è nella settimana corrente)');
}

async function deleteExpense(id) {
  const e = data.expenses.find((x) => x.id === id);
  if (!e) return;
  const ok = await confirmDialog({ title: 'Eliminare la spesa?', message: `${fmtEur(e.amount)}${e.note ? ' · ' + e.note : ''}`, okLabel: 'Elimina', destructive: true });
  if (!ok) return;
  data.expenses = data.expenses.filter((x) => x.id !== id);
  save();
  if ($('sheet').classList.contains('open')) closeSheet();
  render();
  toast('Spesa eliminata');
}

$('fab').addEventListener('click', () => openSheet());
$('sheet-cancel').addEventListener('click', closeSheet);
$('backdrop').addEventListener('click', closeSheet);
$('sheet-save').addEventListener('click', submitExpense);
$('expense-form').addEventListener('submit', (ev) => { ev.preventDefault(); submitExpense(); });
$('f-delete').addEventListener('click', () => editingId && deleteExpense(editingId));
$('expense-list').addEventListener('click', (ev) => {
  const del = ev.target.closest('.del');
  if (del) return deleteExpense(del.dataset.id);
  const edit = ev.target.closest('.edit');
  if (edit) openSheet(edit.dataset.id);
});

/* ============ Impostazioni ============ */
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
  save(); render(); renderSettings();
  toast('Budget aggiornati');
});
$('set-carry').addEventListener('change', (ev) => {
  data.settings.carryOver = ev.target.checked;
  save(); render();
});

$('btn-export').addEventListener('click', async () => {
  const json = JSON.stringify(data, null, 2);
  const name = `budget-backup-${todayStr()}.json`;
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
});

$('btn-import').addEventListener('click', () => $('file-import').click());
$('file-import').addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  let imported;
  try { imported = migrate(JSON.parse(await file.text())); }
  catch (err) { toast('Importazione fallita: ' + err.message); return; }
  const ok = await confirmDialog({
    title: 'Importare il backup?',
    message: `Verranno sostituiti tutti i dati attuali con ${imported.expenses.length} spese del backup.`,
    okLabel: 'Importa', destructive: true
  });
  if (!ok) return;
  data = imported;
  save(); render(); renderSettings();
  toast('Dati importati');
});

$('btn-clear').addEventListener('click', async () => {
  const one = await confirmDialog({ title: 'Cancellare tutto?', message: 'Tutte le spese e le impostazioni verranno eliminate.', okLabel: 'Continua', destructive: true });
  if (!one) return;
  const two = await confirmDialog({ title: 'Ultima conferma', message: 'Questa azione è irreversibile. Vuoi davvero cancellare tutti i dati?', okLabel: 'Cancella tutto', destructive: true });
  if (!two) return;
  data = defaultData();
  save(); render(); renderSettings();
  toast('Dati cancellati');
});

/* ============ Avvio ============ */
// Aggiorna quando l'app torna in primo piano (es. dopo lunedì) e a mezzanotte
document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('sheet').classList.contains('open')) render(); });
setInterval(() => { if (!$('sheet').classList.contains('open')) render(); }, 60 * 1000);

render();
showView('week');

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('service-worker.js').catch(() => {}));
}
