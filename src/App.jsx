import React, { useState, useEffect, useCallback } from 'react';
import { Plane, Plus, Check, X, Download, FileText, ChevronLeft, Trash2, LogOut, Clock, Euro, Calendar, User, ChevronRight, AlertCircle, Camera, Image as ImageIcon, Pencil } from 'lucide-react';
import { storage, receiptStorage } from './storage.js';

// ---------- BMF Verpflegungsmehraufwand (Inland, gültig 2026) ----------
const RATE_FULL_DAY = 28;
const RATE_HALF_DAY = 14; // An-/Abreisetag, oder 8-24h Abwesenheit
const CUT_BREAKFAST = 5.6;   // 20% von 28€
const CUT_LUNCH = 11.2;      // 40% von 28€
const CUT_DINNER = 11.2;     // 40% von 28€

function calcDays(startDate, endDate, startTime = '', endTime = '') {
  const s = new Date(startDate + 'T00:00:00');
  const e = new Date(endDate + 'T00:00:00');
  const diffDays = Math.round((e - s) / (1000 * 60 * 60 * 24));
  const days = [];

  let singleDayHours = null;
  if (diffDays === 0 && startTime && endTime) {
    const start = new Date(`${startDate}T${startTime}:00`);
    const end = new Date(`${endDate}T${endTime}:00`);
    singleDayHours = Math.max(0, (end - start) / (1000 * 60 * 60));
  }

  for (let i = 0; i <= diffDays; i++) {
    const d = new Date(s);
    d.setDate(d.getDate() + i);
    const iso = toLocalISODate(d);
    let type = 'full';
    if (diffDays === 0) type = 'single';
    else if (i === 0) type = 'arrival';
    else if (i === diffDays) type = 'departure';
    days.push({ date: iso, type, singleDayHours });
  }
  return days;
}

function dayBaseRate(day) {
  if (day.type === 'full') return RATE_FULL_DAY;
  if (day.type === 'single') {
    // Eintägige Dienstreise: 14 € nur bei mehr als 8 Stunden Abwesenheit.
    return day.singleDayHours !== null && day.singleDayHours > 8 ? RATE_HALF_DAY : 0;
  }
  // Mehrtägige Reise mit Übernachtung: An- und Abreisetag jeweils 14 €,
  // unabhängig von der konkreten Abwesenheitsdauer an diesen Tagen.
  return RATE_HALF_DAY;
}

function calcPerDiem(days, meals) {
  // meals: { [date]: { breakfast: bool, lunch: bool, dinner: bool } }
  return days.map(d => {
    const base = dayBaseRate(d);
    const m = meals[d.date] || { breakfast: false, lunch: false, dinner: false };
    let cut = 0;
    if (m.breakfast) cut += CUT_BREAKFAST;
    if (m.lunch) cut += CUT_LUNCH;
    if (m.dinner) cut += CUT_DINNER;
    const amount = Math.max(0, base - cut);
    return { ...d, base, cut, amount, meals: m };
  });
}

function fmtEUR(n) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n);
}
function fmtDate(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function fmtDateShort(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
}
function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
}

function toLocalISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function compressImage(file, maxWidth = 1000, quality = 0.65) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const ADMIN_NAME = 'Admin';
const ADMIN_PIN = import.meta.env.VITE_ADMIN_PIN;

const EXPENSE_CATEGORIES = [
  'Bahn/ÖPNV', 'PKW (Kilometergeld)', 'Tanken/Kraftstoff', 'Taxi/Mietwagen', 'Übernachtung', 'Parken', 'Bewirtung (Geschäftsessen)', 'Sonstiges'
];

const PAID_BY_OPTIONS = [
  { value: 'employee', label: 'Vom Mitarbeiter bezahlt' },
  { value: 'companyCard', label: 'Mit Firmenkarte bezahlt' },
  { value: 'company', label: 'Direkt vom Unternehmen bezahlt' },
];

const KM_RATE = 0.30; // gesetzliches Kilometergeld PKW

// ---------- Storage helpers ----------
async function loadAll() {
  try {
    const res = await storage.get('trips-all');
    return res ? JSON.parse(res.value) : [];
  } catch (e) {
    return [];
  }
}
async function saveAll(trips) {
  try {
    await storage.set('trips-all', JSON.stringify(trips));
  } catch (e) {
    console.error('Speichern fehlgeschlagen', e);
  }
}
async function saveReceiptImage(expenseId, dataUrl) {
  return await receiptStorage.upload(expenseId, dataUrl);
}

async function loadReceiptImage(expenseId) {
  return await receiptStorage.download(expenseId);
}

async function deleteReceiptImage(expenseId) {
  return await receiptStorage.delete(expenseId);
}

export default function App() {
  const [user, setUser] = useState(null);
  const [nameInput, setNameInput] = useState('');
  const [adminPinInput, setAdminPinInput] = useState('');
  const [loginError, setLoginError] = useState('');
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('list'); // list | new | detail | admin
  const [activeTrip, setActiveTrip] = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    (async () => {
      const data = await loadAll();
      setTrips(data);
      setLoading(false);
    })();
  }, []);

  const persist = useCallback(async (next) => {
    setTrips(next);
    await saveAll(next);
  }, []);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const login = () => {
    const n = nameInput.trim();
    if (!n) return;

    if (n === ADMIN_NAME) {
      if (!ADMIN_PIN) {
        setLoginError('Admin-PIN ist noch nicht eingerichtet.');
        return;
      }
      if (adminPinInput !== ADMIN_PIN) {
        setLoginError('Admin-PIN ist nicht korrekt.');
        return;
      }
    }

    setLoginError('');
    setUser(n);
  };

  const logout = () => {
    setUser(null);
    setNameInput('');
    setAdminPinInput('');
    setLoginError('');
    setView('list');
    setActiveTrip(null);
  };

  if (loading) {
    return (
      <div style={styles.centerScreen}>
        <div style={styles.loadingSpinner} />
      </div>
    );
  }

  if (!user) {
    return <LoginScreen nameInput={nameInput} setNameInput={setNameInput} adminPinInput={adminPinInput} setAdminPinInput={setAdminPinInput} loginError={loginError} onLogin={login} />;
  }

  const isAdmin = user === ADMIN_NAME;
  const myTrips = isAdmin ? trips : trips.filter(t => t.employee === user);

  return (
    <div style={styles.app}>
      <TopBar user={user} isAdmin={isAdmin} view={view} setView={setView} onLogout={logout} />
      <div style={styles.content}>
        {view === 'list' && (
          <TripList
            trips={myTrips}
            isAdmin={isAdmin}
            onSelect={(t) => { setActiveTrip(t); setView('detail'); }}
            onNew={() => setView('new')}
            onUpdateMany={async (updates) => {
              const byId = new Map(updates.map(item => [item.id, item]));
              const next = trips.map(t => byId.get(t.id) || t);
              await persist(next);
            }}
            showToast={showToast}
            onDismissFeedback={async (tripId) => {
              const next = trips.map(t => t.id === tripId ? { ...t, employeeFeedbackSeen: true } : t);
              await persist(next);
            }}
          />
        )}
        {view === 'new' && (
          <NewTrip
            user={user}
            onCancel={() => setView('list')}
            onSave={async (trip) => {
              const next = [trip, ...trips];
              await persist(next);
              setActiveTrip(trip);
              setView('detail');
              showToast('Reise gespeichert');
            }}
          />
        )}
        {view === 'detail' && activeTrip && (
          <TripDetail
            trip={trips.find(t => t.id === activeTrip.id) || activeTrip}
            isAdmin={isAdmin}
            onBack={() => setView('list')}
            onUpdate={async (updated) => {
              const original = trips.find(t => t.id === updated.id);
              if (!isAdmin && original && (original.status === 'pending' || original.status === 'approved')) {
                showToast('Diese Abrechnung ist gesperrt');
                return;
              }
              const next = trips.map(t => t.id === updated.id ? updated : t);
              await persist(next);
              setActiveTrip(updated);
            }}
            onDelete={async (id) => {
              const original = trips.find(t => t.id === id);
              if (isAdmin || !original || !['draft', 'rejected'].includes(original.status)) {
                showToast('Diese Abrechnung kann nicht gelöscht werden');
                return;
              }
              const next = trips.filter(t => t.id !== id);
              await persist(next);
              setView('list');
              showToast('Reise gelöscht');
            }}
            showToast={showToast}
          />
        )}
      </div>
      {toast && <div style={styles.toast}>{toast}</div>}
    </div>
  );
}

// ================= LOGIN =================
function LoginScreen({ nameInput, setNameInput, adminPinInput, setAdminPinInput, loginError, onLogin }) {
  return (
    <div style={styles.loginScreen}>
      <div style={styles.loginCard}>
        <div style={styles.loginIcon}><Plane size={28} color="#F7F5F0" /></div>
        <h1 style={styles.loginTitle}>Reisekosten</h1>
        <p style={styles.loginSub}>Erfassung & Abrechnung für unterwegs</p>
        <input
          style={styles.loginInput}
          placeholder="Dein Name oder Kürzel"
          value={nameInput}
          onChange={e => setNameInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && onLogin()}
          autoFocus
        />

        {nameInput.trim() === ADMIN_NAME && (
          <input
            style={styles.loginInput}
            type="password"
            placeholder="Admin-PIN"
            value={adminPinInput}
            onChange={e => setAdminPinInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && onLogin()}
          />
        )}

        {loginError && <p style={styles.loginError}>{loginError}</p>}

        <button style={styles.loginBtn} onClick={onLogin}>Anmelden</button>
      </div>
    </div>
  );
}

// ================= TOP BAR =================
function TopBar({ user, isAdmin, view, setView, onLogout }) {
  return (
    <div style={styles.topBar}>
      <div style={styles.topBarLeft}>
        {view !== 'list' ? (
          <button style={styles.iconBtn} onClick={() => setView('list')}><ChevronLeft size={22} color="#1A2332" /></button>
        ) : (
          <div style={styles.topBarIcon}><Plane size={16} color="#F7F5F0" /></div>
        )}
        <div>
          <div style={styles.topBarTitle}>{view === 'new' ? 'Neue Reise' : view === 'detail' ? 'Details' : 'Reisekosten'}</div>
          <div style={styles.topBarSub}>{isAdmin ? 'Admin-Ansicht · alle Mitarbeiter' : user}</div>
        </div>
      </div>
      <button style={styles.iconBtn} onClick={onLogout}><LogOut size={19} color="#8A8F98" /></button>
    </div>
  );
}

// ================= TRIP LIST =================
function TripList({ trips, isAdmin, onSelect, onNew, onUpdateMany, showToast, onDismissFeedback }) {
  const sorted = [...trips].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const pending = trips.filter(t => t.status === 'pending').length;
  const feedbackTrip = !isAdmin
    ? sorted.find(t => !t.employeeFeedbackSeen && employeeFeedbackMeta(t))
    : null;
  const feedback = feedbackTrip ? employeeFeedbackMeta(feedbackTrip) : null;

  return (
    <div style={styles.listWrap}>
      {feedbackTrip && feedback && (
        <div style={{ ...styles.employeeFeedbackBanner, background: feedback.bg, color: feedback.fg }}>
          <div style={styles.employeeFeedbackText}>
            <strong>{feedback.title}</strong>
            <span>{feedback.text}</span>
          </div>
          <button
            style={{ ...styles.feedbackCloseBtn, color: feedback.fg }}
            onClick={() => onDismissFeedback(feedbackTrip.id)}
            aria-label="Hinweis schließen"
          >
            <X size={17} />
          </button>
        </div>
      )}
      {isAdmin && pending > 0 && (
        <div style={styles.pendingBanner}>
          <AlertCircle size={16} color="#C9A24B" />
          <span>{pending} {pending === 1 ? 'Antrag wartet' : 'Anträge warten'} auf Freigabe</span>
        </div>
      )}

      {isAdmin && (
        <PayrollPanel trips={trips} onUpdateMany={onUpdateMany} showToast={showToast} />
      )}

      {sorted.length === 0 ? (
        <div style={styles.emptyState}>
          <Plane size={40} color="#D8DCE3" />
          <p style={styles.emptyText}>Noch keine Reisen erfasst</p>
          <p style={styles.emptySub}>Tippe unten auf + für deine erste Reisekostenabrechnung</p>
        </div>
      ) : (
        <div style={styles.tripCards}>
          {sorted.map(t => <TripCard key={t.id} trip={t} isAdmin={isAdmin} onClick={() => onSelect(t)} />)}
        </div>
      )}

      {!isAdmin && <button style={styles.fab} onClick={onNew}><Plus size={26} color="#F7F5F0" /></button>}
    </div>
  );
}

function PayrollPanel({ trips, onUpdateMany, showToast }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const monthTrips = trips.filter(t => t.status === 'approved' && payrollMonthForTrip(t) === month);
  const ready = monthTrips.filter(t => !t.payrollStatus || t.payrollStatus === 'ready');
  const submitted = monthTrips.filter(t => t.payrollStatus === 'submitted');
  const paid = monthTrips.filter(t => t.payrollStatus === 'paid');
  const amount = monthTrips.reduce((sum, trip) => sum + employeeReimbursementTotal(trip), 0);
  const unclassifiedExpenses = monthTrips.reduce(
    (sum, trip) => sum + (trip.expenses || []).filter(expense => !expense.paidBy).length,
    0
  );

  const markSubmitted = async () => {
    if (ready.length === 0 || unclassifiedExpenses > 0) return;
    const now = new Date().toISOString();
    await onUpdateMany(ready.map(trip => ({
      ...trip,
      payrollMonth: month,
      payrollStatus: 'submitted',
      payrollSubmittedAt: now,
      payrollStatusChangedAt: now,
      employeeFeedbackSeen: false,
    })));
    showToast(`${ready.length} Abrechnung${ready.length === 1 ? '' : 'en'} als übermittelt markiert`);
  };

  const markPaid = async () => {
    if (submitted.length === 0) return;
    const now = new Date().toISOString();
    await onUpdateMany(submitted.map(trip => ({
      ...trip,
      payrollStatus: 'paid',
      payrollPaidAt: now,
      payrollStatusChangedAt: now,
      employeeFeedbackSeen: false,
    })));
    showToast(`${submitted.length} Abrechnung${submitted.length === 1 ? '' : 'en'} als ausgezahlt markiert`);
  };

  return (
    <section style={styles.payrollPanel}>
      <div style={styles.payrollHeader}>
        <div>
          <div style={styles.payrollEyebrow}>Gehaltsabrechnung</div>
          <div style={styles.payrollAmount}>{fmtEUR(amount)}</div>
        </div>
        <input
          type="month"
          value={month}
          onChange={e => setMonth(e.target.value)}
          style={styles.monthInput}
          aria-label="Abrechnungsmonat"
        />
      </div>
      <div style={styles.payrollStats}>
        <span>{ready.length} vorgemerkt</span>
        <span>{submitted.length} übermittelt</span>
        <span>{paid.length} ausgezahlt</span>
      </div>
      {unclassifiedExpenses > 0 && (
        <div style={styles.payrollWarning}>
          {unclassifiedExpenses} ältere{unclassifiedExpenses === 1 ? 'r Beleg muss' : ' Belege müssen'} vor der Übergabe einer Zahlungsart zugeordnet werden.
        </div>
      )}
      {monthTrips.length === 0 ? (
        <div style={styles.payrollEmpty}>Für diesen Monat liegen noch keine genehmigten Abrechnungen vor.</div>
      ) : (
        <div style={styles.payrollActions}>
          <button
            style={{ ...styles.payrollSecondaryBtn, opacity: unclassifiedExpenses > 0 ? 0.45 : 1 }}
            disabled={unclassifiedExpenses > 0}
            onClick={() => exportMonthlyPayrollCSV(monthTrips, month)}
          >
            <Download size={15} /> Monats-CSV
          </button>
          {ready.length > 0 && (
            <button
              style={{ ...styles.payrollPrimaryBtn, opacity: unclassifiedExpenses > 0 ? 0.45 : 1 }}
              disabled={unclassifiedExpenses > 0}
              onClick={markSubmitted}
            >Übergabe bestätigen</button>
          )}
          {ready.length === 0 && submitted.length > 0 && (
            <button style={styles.payrollPrimaryBtn} onClick={markPaid}>Auszahlung bestätigen</button>
          )}
        </div>
      )}
    </section>
  );
}

function statusMeta(status) {
  switch (status) {
    case 'draft': return { label: 'Entwurf', bg: '#ECEFF3', fg: '#5B6270' };
    case 'approved': return { label: 'Genehmigt', bg: '#EAF4EC', fg: '#2E7D4F' };
    case 'rejected': return { label: 'Korrektur erforderlich', bg: '#FBEAEA', fg: '#C0392B' };
    default: return { label: 'Zur Genehmigung', bg: '#FBF3E3', fg: '#B8862F' };
  }
}

function employeeFeedbackMeta(trip) {
  if (!trip) return null;
  if (trip.payrollStatus === 'paid' && trip.payrollStatusChangedAt) {
    return {
      title: 'Reisekosten ausgezahlt',
      text: `${trip.destination}: ${fmtEUR(employeeReimbursementTotal(trip))} wurden als ausgezahlt bestätigt.`,
      bg: '#EAF4EC',
      fg: '#2E7D4F'
    };
  }
  if (trip.payrollStatus === 'submitted' && trip.payrollStatusChangedAt) {
    return {
      title: 'An Gehaltsabrechnung übermittelt',
      text: `${trip.destination}: ${fmtEUR(employeeReimbursementTotal(trip))} sind für ${formatPayrollMonth(payrollMonthForTrip(trip))} übermittelt.`,
      bg: '#E9EFF8',
      fg: '#315D8A'
    };
  }
  if (!trip.statusChangedAt) return null;
  if (trip.status === 'approved') {
    return {
      title: 'RKA genehmigt',
      text: `${trip.destination}: Deine Reisekostenabrechnung wurde genehmigt.`,
      bg: '#EAF4EC',
      fg: '#2E7D4F'
    };
  }
  if (trip.status === 'rejected') {
    return {
      title: 'RKA abgelehnt',
      text: trip.adminNote
        ? `${trip.destination}: ${trip.adminNote}`
        : `${trip.destination}: Deine Reisekostenabrechnung wurde abgelehnt.`,
      bg: '#FBEAEA',
      fg: '#C0392B'
    };
  }
  return null;
}

function formatPayrollMonth(month) {
  if (!month) return '—';
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(year, monthNumber - 1, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
}

function TripCard({ trip, isAdmin, onClick }) {
  const total = tripTotal(trip);
  const sm = statusMeta(trip.status);
  return (
    <button style={styles.tripCard} onClick={onClick}>
      <div style={styles.tripCardTop}>
        <div>
          <div style={styles.tripCardDest}>{trip.destination}</div>
          <div style={styles.tripCardDate}>{fmtDate(trip.startDate)} – {fmtDate(trip.endDate)}</div>
          {isAdmin && <div style={styles.tripCardEmployee}><User size={11} /> {trip.employee}</div>}
        </div>
        <div style={styles.tripCardAmount}>{fmtEUR(total)}</div>
      </div>
      <div style={styles.tripCardBottom}>
        <span style={{ ...styles.statusPill, background: sm.bg, color: sm.fg }}>{sm.label}</span>
        <ChevronRight size={16} color="#C4C9D1" />
      </div>
    </button>
  );
}

function tripTotal(trip) {
  const perDiemTotal = (trip.perDiemDays || []).reduce((s, d) => s + d.amount, 0);
  const expTotal = (trip.expenses || []).reduce((s, e) => s + e.amount, 0);
  return perDiemTotal + expTotal;
}

function employeeReimbursementTotal(trip) {
  const perDiemTotal = (trip.perDiemDays || []).reduce((s, d) => s + d.amount, 0);
  const employeePaidExpenses = (trip.expenses || [])
    .filter(e => !e.paidBy || e.paidBy === 'employee')
    .reduce((s, e) => s + e.amount, 0);
  return perDiemTotal + employeePaidExpenses;
}

function paidByLabel(value) {
  return PAID_BY_OPTIONS.find(option => option.value === value)?.label || 'Zahlungsart noch nicht geprüft';
}

function payrollMonthForTrip(trip) {
  if (trip.payrollMonth) return trip.payrollMonth;
  const reference = trip.reviewedAt || trip.statusChangedAt || trip.endDate || new Date().toISOString();
  return String(reference).slice(0, 7);
}

function payrollMeta(status) {
  switch (status) {
    case 'submitted': return { label: 'An Gehaltsabrechnung übermittelt', bg: '#E9EFF8', fg: '#315D8A' };
    case 'paid': return { label: 'Ausgezahlt', bg: '#EAF4EC', fg: '#2E7D4F' };
    default: return { label: 'Für Gehaltsabrechnung vorgemerkt', bg: '#FBF3E3', fg: '#8A6A1F' };
  }
}

// ================= NEW TRIP =================
function NewTrip({ user, onCancel, onSave }) {
  const [destination, setDestination] = useState('');
  const [purpose, setPurpose] = useState('');
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('');

  const sameDay = startDate && endDate && startDate === endDate;

  const canContinue =
    destination.trim() &&
    startDate &&
    startTime &&
    endDate &&
    endTime &&
    startDate <= endDate &&
    !(sameDay && endTime <= startTime);

  const handleCreate = () => {
    const days = calcDays(startDate, endDate, startTime, endTime);

    const meals = {};
    days.forEach(d => {
      meals[d.date] = {
        breakfast: false,
        lunch: false,
        dinner: false
      };
    });

    const perDiemDays = calcPerDiem(days, meals);

    const trip = {
      id: uid(),
      employee: user,
      destination: destination.trim(),
      purpose: purpose.trim(),
      startDate,
      startTime,
      endDate,
      endTime,
      perDiemDays,
      expenses: [],
      status: 'draft',
      createdAt: new Date().toISOString(),
    };

    onSave(trip);
  };

  let durationText = '';
  if (sameDay && startTime && endTime && endTime > startTime) {
    const start = new Date(`${startDate}T${startTime}:00`);
    const end = new Date(`${endDate}T${endTime}:00`);
    const minutes = Math.round((end - start) / 60000);
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    durationText = `${hours} Std.${mins ? ` ${mins} Min.` : ''}`;
  }

  return (
    <div style={styles.formWrap}>
      <Field label="Reiseziel">
        <input
          style={styles.input}
          placeholder="z. B. München"
          value={destination}
          onChange={e => setDestination(e.target.value)}
        />
      </Field>

      <Field label="Anlass der Reise">
        <input
          style={styles.input}
          placeholder="z. B. Kundentermin, Messe..."
          value={purpose}
          onChange={e => setPurpose(e.target.value)}
        />
      </Field>

      <div style={styles.row2}>
        <Field label="Losgefahren am" style={{ flex: 1 }}>
          <input
            style={styles.input}
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
          />
        </Field>

        <Field label="Uhrzeit" style={{ flex: 1 }}>
          <input
            style={styles.input}
            type="time"
            value={startTime}
            onChange={e => setStartTime(e.target.value)}
          />
        </Field>
      </div>

      <div style={styles.row2}>
        <Field label="Zurück am" style={{ flex: 1 }}>
          <input
            style={styles.input}
            type="date"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
          />
        </Field>

        <Field label="Uhrzeit" style={{ flex: 1 }}>
          <input
            style={styles.input}
            type="time"
            value={endTime}
            onChange={e => setEndTime(e.target.value)}
          />
        </Field>
      </div>

      {durationText && (
        <div style={styles.durationBox}>
          Abwesenheit: <strong>{durationText}</strong>
        </div>
      )}

      <p style={styles.helpText}>
        Bitte tatsächliche Abfahrts- und Rückkehrzeit eintragen.
        Bei einer eintägigen Reise wird die Verpflegungspauschale automatisch
        anhand der Abwesenheitsdauer berechnet.
      </p>

      <div style={styles.formActions}>
        <button style={styles.secondaryBtn} onClick={onCancel}>Abbrechen</button>
        <button
          style={{ ...styles.primaryBtn, opacity: canContinue ? 1 : 0.4 }}
          disabled={!canContinue}
          onClick={handleCreate}
        >
          Weiter
        </button>
      </div>
    </div>
  );
}

function Field({ label, children, style }) {
  return (
    <div style={{ ...styles.field, ...style }}>
      <label style={styles.fieldLabel}>{label}</label>
      {children}
    </div>
  );
}

// ================= TRIP DETAIL =================
function TripDetail({ trip, isAdmin, onBack, onUpdate, onDelete, showToast }) {
  const [tab, setTab] = useState('perdiem'); // perdiem | expenses
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [showEditTrip, setShowEditTrip] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [employeeConfirmed, setEmployeeConfirmed] = useState(false);
  const [viewPhoto, setViewPhoto] = useState(null); // expenseId currently viewed full-screen
  const sm = statusMeta(trip.status);
  const total = tripTotal(trip);
  const canEdit = !isAdmin && (trip.status === 'draft' || trip.status === 'rejected');
  const canClassifyPayment = isAdmin && (
    trip.status === 'pending' ||
    (trip.status === 'approved' && (!trip.payrollStatus || trip.payrollStatus === 'ready'))
  );

  const toggleMeal = (date, mealKey) => {
    if (!canEdit) return;
    const days = trip.perDiemDays.map(d => d.date === date
      ? { ...d, meals: { ...d.meals, [mealKey]: !d.meals[mealKey] } }
      : d);
    const rawDays = days.map(d => ({ date: d.date, type: d.type, singleDayHours: d.singleDayHours ?? null }));
    const mealsMap = {};
    days.forEach(d => { mealsMap[d.date] = d.meals; });
    const recalced = calcPerDiem(rawDays, mealsMap);
    onUpdate({ ...trip, perDiemDays: recalced });
  };

  const addExpense = (expense) => {
    if (!canEdit) return;
    onUpdate({ ...trip, expenses: [...(trip.expenses || []), expense] });
    setShowAddExpense(false);
  };

  const removeExpense = (id) => {
    if (!canEdit) return;
    onUpdate({ ...trip, expenses: trip.expenses.filter(e => e.id !== id) });
    deleteReceiptImage(id);
  };

  const updateExpensePaidBy = (expenseId, paidBy) => {
    if (!canClassifyPayment) return;
    onUpdate({
      ...trip,
      expenses: (trip.expenses || []).map(expense => expense.id === expenseId ? { ...expense, paidBy } : expense),
    });
    showToast('Zahlungsart gespeichert');
  };

  const reviewTrip = (status, note = '') => {
    const now = new Date().toISOString();
    const payrollFields = status === 'approved'
      ? {
          payrollStatus: 'ready',
          payrollMonth: now.slice(0, 7),
          payrollStatusChangedAt: now,
        }
      : {
          payrollStatus: undefined,
          payrollMonth: undefined,
          payrollStatusChangedAt: undefined,
        };
    onUpdate({
      ...trip,
      status,
      ...payrollFields,
      adminNote: status === 'rejected' ? note.trim() : '',
      reviewedAt: now,
      reviewedBy: ADMIN_NAME,
      statusChangedAt: now,
      employeeFeedbackSeen: false,
      reviewHistory: [
        ...(trip.reviewHistory || []),
        { status, note: note.trim(), reviewedAt: now, reviewedBy: ADMIN_NAME }
      ]
    });
    setShowRejectModal(false);
    showToast(status === 'approved' ? 'Reise genehmigt und gesperrt' : 'Zur Korrektur zurückgegeben');
  };

  const submitForApproval = () => {
    if (!employeeConfirmed) return;
    const now = new Date().toISOString();
    onUpdate({
      ...trip,
      status: 'pending',
      submittedAt: now,
      employeeConfirmedAt: now,
      employeeConfirmedBy: trip.employee,
      adminNote: ''
    });
    setEmployeeConfirmed(false);
    showToast('Zur Genehmigung eingereicht');
  };

  const perDiemTotal = (trip.perDiemDays || []).reduce((s, d) => s + d.amount, 0);
  const expTotal = (trip.expenses || []).reduce((s, e) => s + e.amount, 0);

  return (
    <div style={styles.detailWrap}>
      <div style={styles.detailHeader}>
        <div>
          <div style={styles.detailDest}>{trip.destination}</div>
          <div style={styles.detailMeta}>
            {fmtDate(trip.startDate)}{trip.startTime ? ` · ${trip.startTime} Uhr` : ''}
            {' – '}
            {fmtDate(trip.endDate)}{trip.endTime ? ` · ${trip.endTime} Uhr` : ''}
          </div>
          {trip.purpose && <div style={styles.detailPurpose}>{trip.purpose}</div>}
          {isAdmin && <div style={styles.detailEmployee}><User size={12} /> {trip.employee}</div>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <span style={{ ...styles.statusPill, background: sm.bg, color: sm.fg }}>{sm.label}</span>
          {trip.statusChangedAt && (
            <div style={styles.statusChangedAt}>
              {new Date(trip.statusChangedAt).toLocaleString('de-DE', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })}
            </div>
          )}
        </div>
      </div>

      <div style={styles.totalBanner}>
        <div>
          <div style={styles.totalLabel}>Gesamtsumme</div>
          <div style={styles.totalAmount}>{fmtEUR(total)}</div>
        </div>
        <div style={styles.totalBreakdown}>
          <div>Verpflegung: {fmtEUR(perDiemTotal)}</div>
          <div>Belege: {fmtEUR(expTotal)}</div>
        </div>
      </div>

      {trip.status === 'approved' && (
        <div style={styles.lockedNotice}><Check size={16} /> Genehmigt – diese Abrechnung ist endgültig gesperrt.</div>
      )}

      {!isAdmin && trip.status === 'pending' && (
        <div style={styles.pendingNotice}><Clock size={16} /> Eingereicht – Änderungen sind während der Prüfung gesperrt.</div>
      )}

      {trip.status === 'rejected' && trip.adminNote && (
        <div style={styles.adminNoteBox}>
          <div style={styles.adminNoteTitle}>Hinweis der Freigabe</div>
          <div style={styles.adminNoteText}>{trip.adminNote}</div>
          {trip.reviewedAt && <div style={styles.adminNoteMeta}>{trip.reviewedBy || ADMIN_NAME} · {fmtDateTime(trip.reviewedAt)}</div>}
        </div>
      )}

      {trip.employeeConfirmedAt && (
        <div style={styles.auditInfo}>Vom Mitarbeiter bestätigt: {trip.employeeConfirmedBy || trip.employee} · {fmtDateTime(trip.employeeConfirmedAt)}</div>
      )}

      {trip.status === 'approved' && (
        <PayrollStatusBox trip={trip} isAdmin={isAdmin} onUpdate={onUpdate} showToast={showToast} />
      )}

      {isAdmin && trip.status === 'pending' && (
        <div style={styles.approveRow}>
          <button style={styles.rejectBtn} onClick={() => setShowRejectModal(true)}><X size={16} /> Ablehnen mit Notiz</button>
          <button style={styles.approveBtn} onClick={() => reviewTrip('approved')}><Check size={16} /> Genehmigen</button>
        </div>
      )}

      <div style={styles.tabs}>
        <button style={{ ...styles.tab, ...(tab === 'perdiem' ? styles.tabActive : {}) }} onClick={() => setTab('perdiem')}>Verpflegung</button>
        <button style={{ ...styles.tab, ...(tab === 'expenses' ? styles.tabActive : {}) }} onClick={() => setTab('expenses')}>Belege ({(trip.expenses || []).length})</button>
      </div>

      {tab === 'perdiem' && (
        <div style={styles.perDiemList}>
          {trip.perDiemDays.map(d => (
            <div key={d.date} style={styles.perDiemCard}>
              <div style={styles.perDiemTop}>
                <div>
                  <div style={styles.perDiemDate}>{fmtDateShort(d.date)}</div>
                  <div style={styles.perDiemType}>
                    {d.type === 'arrival' ? 'Anreisetag' : d.type === 'departure' ? 'Abreisetag' : d.type === 'single' ? `Eintägige Reise${d.singleDayHours !== null && d.singleDayHours !== undefined ? ` · ${d.singleDayHours.toFixed(1)} Std.` : ''}` : 'Voller Tag'}
                    {' · '}{fmtEUR(d.base)}
                  </div>
                </div>
                <div style={styles.perDiemAmount}>{fmtEUR(d.amount)}</div>
              </div>
              <div style={styles.mealRow}>
                <MealChip label="Frühstück gestellt" active={d.meals.breakfast} disabled={!canEdit} onClick={() => toggleMeal(d.date, 'breakfast')} />
                <MealChip label="Mittag gestellt" active={d.meals.lunch} disabled={!canEdit} onClick={() => toggleMeal(d.date, 'lunch')} />
                <MealChip label="Abend gestellt" active={d.meals.dinner} disabled={!canEdit} onClick={() => toggleMeal(d.date, 'dinner')} />
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'expenses' && (
        <div style={styles.expenseList}>
          {(trip.expenses || []).length === 0 && <p style={styles.emptySub}>Noch keine Belege hinzugefügt.</p>}
          {(trip.expenses || []).map(e => (
            <div key={e.id} style={styles.expenseCard}>
              <div>
                <div style={styles.expenseCategory}>{e.category}</div>
                <div style={styles.expenseDesc}>{e.description || '—'}</div>
                {e.occasion && <div style={styles.expenseDesc}>Anlass: {e.occasion}</div>}
                {e.attendees && <div style={styles.expenseDesc}>Teilnehmer: {e.attendees}</div>}
                {canClassifyPayment ? (
                  <select
                    style={styles.paidBySelect}
                    value={e.paidBy || ''}
                    onChange={event => updateExpensePaidBy(e.id, event.target.value)}
                    aria-label={`Zahlungsart für ${e.category}`}
                  >
                    <option value="" disabled>Zahlungsart prüfen</option>
                    {PAID_BY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                ) : (
                  <div style={styles.paidByLabel}>{paidByLabel(e.paidBy)}</div>
                )}
                <div style={styles.expenseDate}>
                  {e.checkoutDate ? `${fmtDate(e.date)} – ${fmtDate(e.checkoutDate)} · ${e.nights} ${e.nights === 1 ? 'Nacht' : 'Nächte'}` : fmtDate(e.date)}
                </div>
              </div>
              <div style={styles.expenseRight}>
                <div style={styles.expenseAmount}>{fmtEUR(e.amount)}</div>
                {e.hasReceipt && (
                  <button style={styles.photoIconBtn} onClick={() => setViewPhoto(e.id)}><ImageIcon size={15} color="#5B6270" /></button>
                )}
                {canEdit && <button style={styles.trashBtn} onClick={() => removeExpense(e.id)}><Trash2 size={15} color="#C4C9D1" /></button>}
              </div>
            </div>
          ))}
          {canEdit && <button style={styles.addExpenseBtn} onClick={() => setShowAddExpense(true)}><Plus size={16} /> Beleg hinzufügen</button>}
        </div>
      )}

      {canEdit && (
        <div style={styles.confirmBox}>
          <label style={styles.confirmLabel}>
            <input type="checkbox" checked={employeeConfirmed} onChange={e => setEmployeeConfirmed(e.target.checked)} />
            <span>Ich bestätige, dass meine Angaben vollständig und richtig sind, die Kosten dienstlich veranlasst wurden und die Belege den tatsächlichen Ausgaben entsprechen.</span>
          </label>
          <button
            style={{ ...styles.submitBtn, opacity: employeeConfirmed ? 1 : 0.4 }}
            disabled={!employeeConfirmed}
            onClick={submitForApproval}
          >
            <Check size={16} /> Zur Genehmigung einreichen
          </button>
        </div>
      )}

      <div style={styles.exportRow}>
        {canEdit && (
          <button style={styles.exportBtn} onClick={() => setShowEditTrip(true)}><Pencil size={15} /> Bearbeiten</button>
        )}
        <button style={styles.exportBtn} onClick={() => exportTripPDF(trip)}><FileText size={15} /> PDF</button>
        <button style={styles.exportBtn} onClick={() => exportTripCSV(trip)}><Download size={15} /> CSV</button>
        {canEdit && <button style={styles.deleteBtn} onClick={() => { if (confirm('Reise wirklich löschen?')) onDelete(trip.id); }}><Trash2 size={15} /></button>}
      </div>

      {showEditTrip && (
        <EditTripModal
          trip={trip}
          onClose={() => setShowEditTrip(false)}
          onSave={(updatedTrip) => {
            onUpdate(updatedTrip);
            setShowEditTrip(false);
            showToast('Reise aktualisiert');
          }}
        />
      )}
      {showAddExpense && (
        <AddExpenseModal onClose={() => setShowAddExpense(false)} onAdd={addExpense} />
      )}
      {showRejectModal && (
        <RejectModal onClose={() => setShowRejectModal(false)} onReject={(note) => reviewTrip('rejected', note)} />
      )}
      {viewPhoto && (
        <PhotoViewerModal expenseId={viewPhoto} onClose={() => setViewPhoto(null)} />
      )}
    </div>
  );
}

function PayrollStatusBox({ trip, isAdmin, onUpdate, showToast }) {
  const payrollStatus = trip.payrollStatus || 'ready';
  const meta = payrollMeta(payrollStatus);
  const month = payrollMonthForTrip(trip);
  const reimbursement = employeeReimbursementTotal(trip);
  const companyPaid = Math.max(0, tripTotal(trip) - reimbursement);
  const unclassifiedExpenses = (trip.expenses || []).filter(expense => !expense.paidBy).length;

  const updatePayroll = (nextStatus) => {
    const now = new Date().toISOString();
    onUpdate({
      ...trip,
      payrollStatus: nextStatus,
      payrollMonth: month,
      payrollSubmittedAt: nextStatus === 'submitted' ? now : trip.payrollSubmittedAt,
      payrollPaidAt: nextStatus === 'paid' ? now : trip.payrollPaidAt,
      payrollStatusChangedAt: now,
      employeeFeedbackSeen: false,
    });
    showToast(nextStatus === 'submitted' ? 'An Gehaltsabrechnung übermittelt' : 'Als ausgezahlt markiert');
  };

  return (
    <div style={styles.payrollStatusBox}>
      <div style={styles.payrollStatusTop}>
        <div>
          <div style={styles.payrollEyebrow}>Auszahlung an Mitarbeiter</div>
          <div style={styles.payrollDetailAmount}>{fmtEUR(reimbursement)}</div>
        </div>
        <span style={{ ...styles.statusPill, background: meta.bg, color: meta.fg }}>{meta.label}</span>
      </div>
      <div style={styles.payrollStatusInfo}>
        Abrechnungsmonat: <strong>{formatPayrollMonth(month)}</strong>
        {companyPaid > 0 && <> · Bereits vom Unternehmen bezahlt: <strong>{fmtEUR(companyPaid)}</strong></>}
      </div>
      {unclassifiedExpenses > 0 && isAdmin && (
        <div style={styles.payrollDetailWarning}>
          Bitte bei {unclassifiedExpenses} ältere{unclassifiedExpenses === 1 ? 'm Beleg' : 'n Belegen'} unter „Belege“ die Zahlungsart prüfen.
        </div>
      )}
      {isAdmin && (
        <div style={styles.payrollDetailActions}>
          <input
            type="month"
            value={month}
            onChange={e => onUpdate({ ...trip, payrollMonth: e.target.value })}
            style={styles.monthInput}
            aria-label="Abrechnungsmonat ändern"
          />
          {payrollStatus === 'ready' && (
            <button style={styles.payrollPrimaryBtn} onClick={() => updatePayroll('submitted')}>Als übermittelt markieren</button>
          )}
          {payrollStatus === 'submitted' && (
            <button style={styles.payrollPrimaryBtn} onClick={() => updatePayroll('paid')}>Als ausgezahlt markieren</button>
          )}
        </div>
      )}
      {trip.payrollSubmittedAt && <div style={styles.payrollAudit}>Übermittelt: {fmtDateTime(trip.payrollSubmittedAt)}</div>}
      {trip.payrollPaidAt && <div style={styles.payrollAudit}>Ausgezahlt: {fmtDateTime(trip.payrollPaidAt)}</div>}
    </div>
  );
}

function RejectModal({ onClose, onReject }) {
  const [note, setNote] = useState('');
  const canReject = note.trim().length >= 3;

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modalCard} onClick={e => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <span style={styles.modalTitle}>Ablehnung begründen</span>
          <button style={styles.iconBtn} onClick={onClose}><X size={20} color="#8A8F98" /></button>
        </div>
        <Field label="Notiz für den Mitarbeiter *">
          <textarea
            style={{ ...styles.input, minHeight: 110, resize: 'vertical' }}
            placeholder="z. B. Bitte den fehlenden Hotelbeleg hochladen und erneut einreichen."
            value={note}
            onChange={e => setNote(e.target.value)}
            autoFocus
          />
        </Field>
        <p style={styles.helpText}>Der Mitarbeiter sieht diese Begründung direkt in seiner Abrechnung und kann anschließend korrigieren.</p>
        <div style={styles.formActions}>
          <button style={styles.secondaryBtn} onClick={onClose}>Abbrechen</button>
          <button
            style={{ ...styles.rejectConfirmBtn, opacity: canReject ? 1 : 0.4 }}
            disabled={!canReject}
            onClick={() => onReject(note)}
          >
            Mit Notiz ablehnen
          </button>
        </div>
      </div>
    </div>
  );
}

function PhotoViewerModal({ expenseId, onClose }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let active = true;
    loadReceiptImage(expenseId).then(url => { if (active) setSrc(url); });
    return () => { active = false; };
  }, [expenseId]);

  return (
    <div style={styles.photoViewerOverlay} onClick={onClose}>
     {src ? (
  <>
    <img
      src={src}
      alt="Beleg"
      style={styles.photoViewerImg}
      onClick={e => e.stopPropagation()}
    />

    <a
      href={src}
      download={`Beleg-${expenseId}.jpg`}
      onClick={e => e.stopPropagation()}
      style={{
        position: 'absolute',
        bottom: '24px',
        left: '50%',
        transform: 'translateX(-50%)',
        background: '#ffffff',
        color: '#1A2332',
        padding: '10px 18px',
        borderRadius: '8px',
        textDecoration: 'none',
        fontWeight: 600,
        zIndex: 10
      }}
    >
      Beleg herunterladen
    </a>
  </>
) : (
        <div style={styles.loadingSpinner} />
      )}
      <button style={styles.photoViewerClose} onClick={onClose}><X size={22} color="#fff" /></button>
    </div>
  );
}

function MealChip({ label, active, disabled, onClick }) {
  return (
    <button
      disabled={disabled}
      style={{ ...styles.mealChip, ...(active ? styles.mealChipActive : {}), ...(disabled ? styles.mealChipDisabled : {}) }}
      onClick={onClick}
    >
      {label}
    </button>
  );
}


// ================= EDIT TRIP MODAL =================
function EditTripModal({ trip, onClose, onSave }) {
  const [destination, setDestination] = useState(trip.destination || '');
  const [purpose, setPurpose] = useState(trip.purpose || '');
  const [startDate, setStartDate] = useState(trip.startDate || '');
  const [startTime, setStartTime] = useState(trip.startTime || '');
  const [endDate, setEndDate] = useState(trip.endDate || '');
  const [endTime, setEndTime] = useState(trip.endTime || '');

  const canSave =
    destination.trim() &&
    startDate &&
    startTime &&
    endDate &&
    endTime &&
    startDate <= endDate &&
    !(startDate === endDate && endTime <= startTime);

  const handleSave = () => {
    const oldMeals = {};
    (trip.perDiemDays || []).forEach(d => {
      oldMeals[d.date] = d.meals || { breakfast: false, lunch: false, dinner: false };
    });

    const days = calcDays(startDate, endDate, startTime, endTime);
    const meals = {};
    days.forEach(d => {
      meals[d.date] = oldMeals[d.date] || {
        breakfast: false,
        lunch: false,
        dinner: false
      };
    });

    const perDiemDays = calcPerDiem(days, meals);

    onSave({
      ...trip,
      destination: destination.trim(),
      purpose: purpose.trim(),
      startDate,
      startTime,
      endDate,
      endTime,
      perDiemDays,
      status: trip.status,
      updatedAt: new Date().toISOString()
    });
  };

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modalCard} onClick={e => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <span style={styles.modalTitle}>Reise bearbeiten</span>
          <button style={styles.iconBtn} onClick={onClose}>
            <X size={20} color="#8A8F98" />
          </button>
        </div>

        <Field label="Reiseziel">
          <input
            style={styles.input}
            value={destination}
            onChange={e => setDestination(e.target.value)}
          />
        </Field>

        <Field label="Anlass der Reise">
          <input
            style={styles.input}
            value={purpose}
            onChange={e => setPurpose(e.target.value)}
          />
        </Field>

        <div style={styles.row2}>
          <Field label="Losgefahren am" style={{ flex: 1 }}>
            <input
              style={styles.input}
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
            />
          </Field>

          <Field label="Uhrzeit" style={{ flex: 1 }}>
            <input
              style={styles.input}
              type="time"
              value={startTime}
              onChange={e => setStartTime(e.target.value)}
            />
          </Field>
        </div>

        <div style={styles.row2}>
          <Field label="Zurück am" style={{ flex: 1 }}>
            <input
              style={styles.input}
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
            />
          </Field>

          <Field label="Uhrzeit" style={{ flex: 1 }}>
            <input
              style={styles.input}
              type="time"
              value={endTime}
              onChange={e => setEndTime(e.target.value)}
            />
          </Field>
        </div>

        <p style={styles.helpText}>
          Die Verpflegung wird anhand deiner tatsächlichen Abfahrts- und Rückkehrzeit berechnet.
          Hotel-Check-in und Check-out werden separat beim Hotelbeleg erfasst.
          Bereits erfasste Belege bleiben erhalten. Eingereichte und genehmigte
          Abrechnungen können nicht mehr bearbeitet werden.
        </p>

        <div style={styles.formActions}>
          <button style={styles.secondaryBtn} onClick={onClose}>Abbrechen</button>
          <button
            style={{ ...styles.primaryBtn, opacity: canSave ? 1 : 0.4 }}
            disabled={!canSave}
            onClick={handleSave}
          >
            Änderungen speichern
          </button>
        </div>
      </div>
    </div>
  );
}

// ================= ADD EXPENSE MODAL =================
function AddExpenseModal({ onClose, onAdd }) {
  const [category, setCategory] = useState(EXPENSE_CATEGORIES[0]);
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState('');
  const [km, setKm] = useState('');
  const [photo, setPhoto] = useState(null); // data URL preview
  const [uploading, setUploading] = useState(false);
  const [paidBy, setPaidBy] = useState('employee');

  const handlePhotoSelect = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setUploading(true);
    try {
      const dataUrl = await compressImage(file);
      setPhoto(dataUrl);
    } catch (err) {
      console.error(err);
    } finally {
      setUploading(false);
    }
  };

  const isKm = category === 'PKW (Kilometergeld)';
  const isBewirtung = category === 'Bewirtung (Geschäftsessen)';
  const isHotel = category === 'Übernachtung';
  const [attendees, setAttendees] = useState('');
  const [occasion, setOccasion] = useState('');
  const [checkoutDate, setCheckoutDate] = useState('');
  const nights = isHotel && checkoutDate && date ? Math.max(1, Math.round((new Date(checkoutDate) - new Date(date)) / 86400000)) : null;
  const computedAmount = isKm ? (parseFloat(km || 0) * KM_RATE) : parseFloat(amount || 0);
  const canSave = computedAmount > 0 && date && (!isBewirtung || (attendees.trim() && occasion.trim()));

  const handleSave = async () => {
    const expenseId = uid();
    if (photo) {
      await saveReceiptImage(expenseId, photo);
    }
    onAdd({
      id: expenseId,
      category,
      description: description.trim(),
      date,
      amount: Math.round(computedAmount * 100) / 100,
      paidBy,
      km: isKm ? parseFloat(km || 0) : undefined,
      attendees: isBewirtung ? attendees.trim() : undefined,
      occasion: isBewirtung ? occasion.trim() : undefined,
      hasReceipt: !!photo,
      checkoutDate: isHotel && checkoutDate ? checkoutDate : undefined,
      nights: isHotel ? nights : undefined,
    });
  };

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modalCard} onClick={e => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <span style={styles.modalTitle}>Beleg hinzufügen</span>
          <button style={styles.iconBtn} onClick={onClose}><X size={20} color="#8A8F98" /></button>
        </div>
        <Field label="Kategorie">
          <select style={styles.input} value={category} onChange={e => setCategory(e.target.value)}>
            {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Beschreibung">
          <input style={styles.input} placeholder="z. B. ICE Berlin–München" value={description} onChange={e => setDescription(e.target.value)} />
        </Field>
        <Field label={isHotel ? 'Anreise (Check-in)' : 'Datum'}>
          <input style={styles.input} type="date" value={date} onChange={e => setDate(e.target.value)} />
        </Field>
        {isHotel && (
          <Field label="Abreise (Check-out)">
            <input style={styles.input} type="date" value={checkoutDate} onChange={e => setCheckoutDate(e.target.value)} />
          </Field>
        )}
        {isHotel && nights && (
          <p style={styles.helpText}>{nights} {nights === 1 ? 'Nacht' : 'Nächte'} · Trage den Gesamtbetrag der Hotelrechnung unten ein — nicht pro Nacht einzeln.</p>
        )}
        {isBewirtung && (
          <>
            <Field label="Anlass der Bewirtung">
              <input style={styles.input} placeholder="z. B. Vertragsverhandlung Projekt X" value={occasion} onChange={e => setOccasion(e.target.value)} />
            </Field>
            <Field label="Teilnehmer">
              <input style={styles.input} placeholder="z. B. Max Muster (Kunde), du selbst" value={attendees} onChange={e => setAttendees(e.target.value)} />
            </Field>
            <p style={styles.helpText}>Pflichtangaben fürs Finanzamt: Anlass und Teilnehmer der Bewirtung. Beleg (Rechnung) bitte zusätzlich aufbewahren.</p>
          </>
        )}
        {isKm ? (
          <Field label={`Gefahrene Kilometer (${KM_RATE.toFixed(2)} €/km)`}>
            <input style={styles.input} type="number" placeholder="0" value={km} onChange={e => setKm(e.target.value)} />
          </Field>
        ) : (
          <Field label="Betrag (€)">
            <input style={styles.input} type="number" step="0.01" placeholder="0,00" value={amount} onChange={e => setAmount(e.target.value)} />
          </Field>
        )}
        {computedAmount > 0 && (
          <div style={styles.computedAmount}>Betrag: {fmtEUR(computedAmount)}</div>
        )}
        <Field label="Bezahlt durch">
          <select style={styles.input} value={paidBy} onChange={e => setPaidBy(e.target.value)}>
            {PAID_BY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Field>
        {paidBy !== 'employee' && (
          <p style={styles.companyPaidHint}>Dieser Betrag wird dokumentiert, aber nicht an den Mitarbeiter ausgezahlt.</p>
        )}
        <Field label="Beleg-Foto">
          {photo ? (
            <div style={styles.photoPreviewWrap}>
              <img src={photo} alt="Beleg" style={styles.photoPreview} />
              <button style={styles.photoRemoveBtn} onClick={() => setPhoto(null)}><X size={14} color="#fff" /></button>
            </div>
          ) : (
            <div style={styles.photoSourceRow}>
              <label style={styles.photoChoiceBtn}>
                <Camera size={18} color="#5B6270" />
                <span>{uploading ? 'Wird verarbeitet…' : 'Kamera'}</span>
                <input type="file" accept="image/*" capture="environment" onChange={handlePhotoSelect} style={{ display: 'none' }} />
              </label>
              <label style={styles.photoChoiceBtn}>
                <ImageIcon size={18} color="#5B6270" />
                <span>Aus Fotos wählen</span>
                <input type="file" accept="image/*" onChange={handlePhotoSelect} style={{ display: 'none' }} />
              </label>
            </div>
          )}
        </Field>
        <div style={styles.formActions}>
          <button style={styles.secondaryBtn} onClick={onClose}>Abbrechen</button>
          <button style={{ ...styles.primaryBtn, opacity: canSave ? 1 : 0.4 }} disabled={!canSave} onClick={handleSave}>Speichern</button>
        </div>
      </div>
    </div>
  );
}

// ================= EXPORT =================
function downloadCSV(lines, filename) {
  const csv = lines.map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportMonthlyPayrollCSV(trips, month) {
  const lines = [[
    'Abrechnungsmonat', 'Antragsnummer', 'Mitarbeiter', 'Reiseziel', 'Reisezeitraum',
    'Verpflegung', 'Vom Mitarbeiter bezahlte Belege', 'Auszahlungsbetrag',
    'Firmenkarte/Unternehmen', 'Freigabestatus', 'Auszahlungsstatus', 'Genehmigt am'
  ]];

  trips.forEach(trip => {
    const perDiem = (trip.perDiemDays || []).reduce((sum, day) => sum + day.amount, 0);
    const employeeExpenses = (trip.expenses || [])
      .filter(expense => !expense.paidBy || expense.paidBy === 'employee')
      .reduce((sum, expense) => sum + expense.amount, 0);
    const companyPaid = (trip.expenses || [])
      .filter(expense => expense.paidBy === 'companyCard' || expense.paidBy === 'company')
      .reduce((sum, expense) => sum + expense.amount, 0);
    lines.push([
      month,
      trip.id,
      trip.employee,
      trip.destination,
      `${fmtDate(trip.startDate)} - ${fmtDate(trip.endDate)}`,
      perDiem.toFixed(2),
      employeeExpenses.toFixed(2),
      (perDiem + employeeExpenses).toFixed(2),
      companyPaid.toFixed(2),
      statusMeta(trip.status).label,
      payrollMeta(trip.payrollStatus || 'ready').label,
      fmtDateTime(trip.reviewedAt),
    ]);
  });

  lines.push([]);
  lines.push(['Gesamtauszahlung', '', '', '', '', '', '', trips.reduce((sum, trip) => sum + employeeReimbursementTotal(trip), 0).toFixed(2)]);
  downloadCSV(lines, `Reisekosten_Gehaltsabrechnung_${month}.csv`);
}

function exportTripCSV(trip) {
  const lines = [];
  lines.push(['Reisekostenabrechnung']);
  lines.push(['Mitarbeiter', trip.employee]);
  lines.push(['Ziel', trip.destination]);
  lines.push(['Anlass', trip.purpose || '']);
  lines.push(['Zeitraum', `${fmtDate(trip.startDate)}${trip.startTime ? ' ' + trip.startTime + ' Uhr' : ''} - ${fmtDate(trip.endDate)}${trip.endTime ? ' ' + trip.endTime + ' Uhr' : ''}`]);
  lines.push(['Status', statusMeta(trip.status).label]);
  lines.push(['Vom Mitarbeiter bestätigt', trip.employeeConfirmedAt ? `${trip.employeeConfirmedBy || trip.employee}, ${fmtDateTime(trip.employeeConfirmedAt)}` : 'Nicht dokumentiert']);
  lines.push(['Geprüft von', trip.reviewedAt ? `${trip.reviewedBy || ADMIN_NAME}, ${fmtDateTime(trip.reviewedAt)}` : '']);
  if (trip.status === 'approved') {
    lines.push(['Auszahlungsbetrag Mitarbeiter', employeeReimbursementTotal(trip).toFixed(2)]);
    lines.push(['Abrechnungsmonat', payrollMonthForTrip(trip)]);
    lines.push(['Auszahlungsstatus', payrollMeta(trip.payrollStatus || 'ready').label]);
  }
  if (trip.adminNote) lines.push(['Hinweis der Freigabe', trip.adminNote]);
  lines.push([]);
  lines.push(['Verpflegungsmehraufwand']);
  lines.push(['Datum', 'Typ', 'Grundbetrag', 'Kürzung', 'Betrag']);
  trip.perDiemDays.forEach(d => {
    lines.push([fmtDate(d.date), d.type, d.base.toFixed(2), d.cut.toFixed(2), d.amount.toFixed(2)]);
  });
  lines.push([]);
  lines.push(['Belege']);
  lines.push(['Datum', 'Kategorie', 'Beschreibung', 'Anlass', 'Teilnehmer', 'Bezahlt durch', 'Betrag']);
  (trip.expenses || []).forEach(e => {
    const dateStr = e.checkoutDate ? `${fmtDate(e.date)} - ${fmtDate(e.checkoutDate)} (${e.nights} Nächte)` : fmtDate(e.date);
    lines.push([dateStr, e.category, e.description || '', e.occasion || '', e.attendees || '', paidByLabel(e.paidBy), e.amount.toFixed(2)]);
  });
  lines.push([]);
  lines.push(['Gesamtsumme', '', '', '', tripTotal(trip).toFixed(2)]);

  downloadCSV(lines, `Reisekosten_${trip.employee}_${trip.destination}_${trip.startDate}.csv`);
}

function exportTripPDF(trip) {
  const perDiemTotal = trip.perDiemDays.reduce((s, d) => s + d.amount, 0);
  const expTotal = (trip.expenses || []).reduce((s, e) => s + e.amount, 0);
  const total = perDiemTotal + expTotal;
  const reimbursement = employeeReimbursementTotal(trip);

  const win = window.open('', '_blank');
  win.document.write(`
    <html><head><title>Reisekostenabrechnung ${trip.destination}</title>
    <style>
      body { font-family: Georgia, serif; padding: 40px; color: #1A2332; max-width: 700px; margin: auto; }
      h1 { font-size: 22px; border-bottom: 2px solid #1A2332; padding-bottom: 10px; }
      .meta { margin: 16px 0; font-size: 14px; }
      .meta div { margin-bottom: 4px; }
      table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px; }
      th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #E5E5E5; }
      th { background: #F7F5F0; }
      .total { font-size: 18px; font-weight: bold; text-align: right; margin-top: 20px; border-top: 2px solid #1A2332; padding-top: 10px; }
      .section-title { font-weight: bold; margin-top: 24px; margin-bottom: 8px; color: #C9A24B; }
    </style>
    </head><body>
    <h1>Reisekostenabrechnung</h1>
    <div class="meta">
      <div><strong>Mitarbeiter:</strong> ${trip.employee}</div>
      <div><strong>Ziel:</strong> ${trip.destination}</div>
      <div><strong>Anlass:</strong> ${trip.purpose || '—'}</div>
      <div><strong>Zeitraum:</strong> ${fmtDate(trip.startDate)}${trip.startTime ? ' · ' + trip.startTime + ' Uhr' : ''} – ${fmtDate(trip.endDate)}${trip.endTime ? ' · ' + trip.endTime + ' Uhr' : ''}</div>
      <div><strong>Status:</strong> ${statusMeta(trip.status).label}</div>
      ${trip.status === 'approved' ? `<div><strong>Auszahlung an Mitarbeiter:</strong> ${fmtEUR(reimbursement)}</div>` : ''}
      ${trip.status === 'approved' ? `<div><strong>Gehaltsabrechnung:</strong> ${formatPayrollMonth(payrollMonthForTrip(trip))} · ${payrollMeta(trip.payrollStatus || 'ready').label}</div>` : ''}
      <div><strong>Mitarbeiterbestätigung:</strong> ${trip.employeeConfirmedAt ? `${trip.employeeConfirmedBy || trip.employee}, ${fmtDateTime(trip.employeeConfirmedAt)}` : 'Nicht dokumentiert'}</div>
      ${trip.reviewedAt ? `<div><strong>Geprüft von:</strong> ${trip.reviewedBy || ADMIN_NAME}, ${fmtDateTime(trip.reviewedAt)}</div>` : ''}
      ${trip.adminNote ? `<div><strong>Hinweis der Freigabe:</strong> ${trip.adminNote}</div>` : ''}
    </div>

    <div class="section-title">Verpflegungsmehraufwand</div>
    <table>
      <tr><th>Datum</th><th>Typ</th><th>Grundbetrag</th><th>Kürzung</th><th>Betrag</th></tr>
      ${trip.perDiemDays.map(d => `<tr><td>${fmtDate(d.date)}</td><td>${d.type === 'arrival' ? 'Anreise' : d.type === 'departure' ? 'Abreise' : d.type === 'single' ? 'Eintägig' : 'Voller Tag'}</td><td>${fmtEUR(d.base)}</td><td>${fmtEUR(d.cut)}</td><td>${fmtEUR(d.amount)}</td></tr>`).join('')}
    </table>

    <div class="section-title">Belege</div>
    <table>
      <tr><th>Datum</th><th>Kategorie</th><th>Beschreibung</th><th>Bezahlt durch</th><th>Betrag</th></tr>
      ${(trip.expenses || []).length === 0 ? '<tr><td colspan="5">Keine Belege</td></tr>' : trip.expenses.map(e => `<tr><td>${e.checkoutDate ? fmtDate(e.date) + ' – ' + fmtDate(e.checkoutDate) + ' (' + e.nights + ' Nächte)' : fmtDate(e.date)}</td><td>${e.category}</td><td>${e.description || '—'}${e.occasion ? '<br>' + e.occasion + ' · ' + (e.attendees || '') : ''}</td><td>${paidByLabel(e.paidBy)}</td><td>${fmtEUR(e.amount)}</td></tr>`).join('')}
    </table>

    <div class="total">Gesamtsumme: ${fmtEUR(total)}${trip.status === 'approved' ? `<br><span style="font-size:14px">Auszahlung an Mitarbeiter: ${fmtEUR(reimbursement)}</span>` : ''}</div>
    </body></html>
  `);
  win.document.close();
  setTimeout(() => win.print(), 300);
}

// ================= STYLES =================
const NAVY = '#1A2332';
const GOLD = '#C9A24B';
const OFFWHITE = '#F7F5F0';

const styles = {
  app: { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', background: OFFWHITE, minHeight: '100vh', maxWidth: 480, margin: '0 auto', position: 'relative', color: NAVY },
  centerScreen: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: OFFWHITE },
  loadingSpinner: { width: 32, height: 32, border: `3px solid ${GOLD}33`, borderTopColor: GOLD, borderRadius: '50%', animation: 'spin 0.8s linear infinite' },

  loginScreen: { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: NAVY, padding: 20 },
  loginCard: { background: OFFWHITE, borderRadius: 20, padding: '40px 28px', width: '100%', maxWidth: 360, textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' },
  loginIcon: { width: 56, height: 56, background: NAVY, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px', transform: 'rotate(-45deg)' },
  loginTitle: { fontSize: 24, fontWeight: 700, margin: '0 0 4px', letterSpacing: '-0.02em' },
  loginSub: { fontSize: 14, color: '#8A8F98', margin: '0 0 28px' },
  loginInput: { width: '100%', padding: '14px 16px', borderRadius: 12, border: '1.5px solid #E2E4E8', fontSize: 16, marginBottom: 14, boxSizing: 'border-box', outline: 'none' },
  loginBtn: { width: '100%', padding: '14px', borderRadius: 12, border: 'none', background: NAVY, color: OFFWHITE, fontSize: 16, fontWeight: 600, cursor: 'pointer' },
  loginHint: { fontSize: 12, color: '#B4B8C0', marginTop: 18 },
  loginError: { fontSize: 12.5, color: '#C0392B', margin: '-4px 0 12px', textAlign: 'left' },

  topBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', background: OFFWHITE, borderBottom: '1px solid #E8E6E0', position: 'sticky', top: 0, zIndex: 10 },
  topBarLeft: { display: 'flex', alignItems: 'center', gap: 10 },
  topBarIcon: { width: 32, height: 32, background: NAVY, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  topBarTitle: { fontSize: 16, fontWeight: 700 },
  topBarSub: { fontSize: 12, color: '#8A8F98' },
  iconBtn: { background: 'none', border: 'none', cursor: 'pointer', padding: 6, display: 'flex', alignItems: 'center' },

  content: { paddingBottom: 40 },

  listWrap: { padding: '16px 16px 100px', position: 'relative', minHeight: 'calc(100vh - 70px)' },
  pendingBanner: { display: 'flex', alignItems: 'center', gap: 8, background: '#FBF3E3', color: '#8A6A1F', padding: '10px 14px', borderRadius: 10, fontSize: 13, marginBottom: 14, fontWeight: 500 },
  payrollPanel: { background: NAVY, color: OFFWHITE, borderRadius: 16, padding: 16, marginBottom: 16, boxShadow: '0 8px 22px rgba(26,35,50,0.12)' },
  payrollHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  payrollEyebrow: { fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.72 },
  payrollAmount: { fontSize: 24, fontWeight: 750, marginTop: 3 },
  monthInput: { border: '1px solid #D8DCE3', borderRadius: 9, padding: '8px 9px', background: '#fff', color: NAVY, fontSize: 12.5, boxSizing: 'border-box' },
  payrollStats: { display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 12, fontSize: 11.5, color: '#D8DCE3' },
  payrollWarning: { fontSize: 12, color: '#FFE1A3', background: 'rgba(201,162,75,0.16)', border: '1px solid rgba(201,162,75,0.35)', padding: '9px 10px', borderRadius: 9, marginTop: 12, lineHeight: 1.4 },
  payrollEmpty: { marginTop: 13, fontSize: 12.5, color: '#D8DCE3', lineHeight: 1.4 },
  payrollActions: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  payrollSecondaryBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 12px', borderRadius: 9, border: '1px solid #596274', background: 'transparent', color: OFFWHITE, fontSize: 12.5, fontWeight: 650, cursor: 'pointer' },
  payrollPrimaryBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '10px 12px', borderRadius: 9, border: 'none', background: GOLD, color: NAVY, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' },
  employeeFeedbackBanner: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '12px 14px', borderRadius: 12, marginBottom: 14, fontSize: 13, lineHeight: 1.4 },
  employeeFeedbackText: { display: 'flex', flexDirection: 'column', gap: 3 },
  feedbackCloseBtn: { background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center' },
  emptyState: { textAlign: 'center', padding: '80px 20px' },
  emptyText: { fontSize: 15, fontWeight: 600, marginTop: 14 },
  emptySub: { fontSize: 13, color: '#8A8F98', marginTop: 4 },

  tripCards: { display: 'flex', flexDirection: 'column', gap: 10 },
  tripCard: { background: '#FFFFFF', border: '1px solid #ECE9E3', borderRadius: 14, padding: '14px 16px', textAlign: 'left', cursor: 'pointer', width: '100%', boxSizing: 'border-box' },
  tripCardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  tripCardDest: { fontSize: 15, fontWeight: 700 },
  tripCardDate: { fontSize: 12.5, color: '#8A8F98', marginTop: 2 },
  tripCardEmployee: { fontSize: 12, color: GOLD, marginTop: 4, display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600 },
  tripCardAmount: { fontSize: 16, fontWeight: 700 },
  tripCardBottom: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  statusPill: { fontSize: 11.5, fontWeight: 700, padding: '4px 10px', borderRadius: 20 },

  fab: { position: 'fixed', bottom: 28, right: '50%', transform: 'translateX(190px)', width: 56, height: 56, borderRadius: '50%', background: NAVY, border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 8px 24px rgba(26,35,50,0.35)' },

  formWrap: { padding: 18 },
  field: { marginBottom: 16 },
  fieldLabel: { display: 'block', fontSize: 12.5, fontWeight: 600, color: '#5B6270', marginBottom: 6 },
  input: { width: '100%', padding: '12px 14px', borderRadius: 10, border: '1.5px solid #E2E4E8', fontSize: 15, boxSizing: 'border-box', background: '#fff', outline: 'none', fontFamily: 'inherit' },
  row2: { display: 'flex', gap: 12 },
  helpText: { fontSize: 12.5, color: '#8A8F98', lineHeight: 1.5, background: '#F1EFEA', padding: 12, borderRadius: 10, marginBottom: 20 },
  durationBox: { fontSize: 13, color: NAVY, background: '#FFFFFF', border: '1px solid #ECE9E3', padding: '10px 12px', borderRadius: 10, marginBottom: 12 },
  formActions: { display: 'flex', gap: 10, marginTop: 8 },
  secondaryBtn: { flex: 1, padding: '13px', borderRadius: 10, border: '1.5px solid #E2E4E8', background: '#fff', fontSize: 14.5, fontWeight: 600, cursor: 'pointer', color: NAVY },
  primaryBtn: { flex: 1, padding: '13px', borderRadius: 10, border: 'none', background: NAVY, color: OFFWHITE, fontSize: 14.5, fontWeight: 600, cursor: 'pointer' },

  detailWrap: { padding: '16px 16px 60px' },
  detailHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  detailDest: { fontSize: 19, fontWeight: 700 },
  detailMeta: { fontSize: 13, color: '#8A8F98', marginTop: 2 },
  detailPurpose: { fontSize: 13, color: '#5B6270', marginTop: 4 },
  detailEmployee: { fontSize: 12, color: GOLD, marginTop: 6, display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600 },
  statusChangedAt: { fontSize: 10.5, color: '#8A8F98', marginTop: 6 },

  totalBanner: { background: NAVY, borderRadius: 14, padding: '16px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  totalLabel: { fontSize: 11.5, color: '#B8BEC9', textTransform: 'uppercase', letterSpacing: '0.05em' },
  totalAmount: { fontSize: 26, fontWeight: 700, color: OFFWHITE },
  totalBreakdown: { fontSize: 11.5, color: '#B8BEC9', textAlign: 'right', lineHeight: 1.6 },

  approveRow: { display: 'flex', gap: 10, marginBottom: 16 },
  approveBtn: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '11px', borderRadius: 10, border: 'none', background: '#2E7D4F', color: '#fff', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' },
  rejectBtn: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '11px', borderRadius: 10, border: '1.5px solid #E8B4B0', background: '#fff', color: '#C0392B', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' },
  rejectConfirmBtn: { flex: 1, padding: '13px', borderRadius: 10, border: 'none', background: '#C0392B', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  lockedNotice: { display: 'flex', alignItems: 'center', gap: 8, background: '#EAF4EC', color: '#2E7D4F', padding: '11px 13px', borderRadius: 10, fontSize: 12.5, fontWeight: 600, marginBottom: 14 },
  pendingNotice: { display: 'flex', alignItems: 'center', gap: 8, background: '#FBF3E3', color: '#8A6A1F', padding: '11px 13px', borderRadius: 10, fontSize: 12.5, fontWeight: 600, marginBottom: 14 },
  adminNoteBox: { background: '#FBEAEA', border: '1px solid #E8B4B0', borderRadius: 12, padding: '13px 14px', marginBottom: 14 },
  adminNoteTitle: { fontSize: 12.5, fontWeight: 700, color: '#C0392B', marginBottom: 5 },
  adminNoteText: { fontSize: 13.5, color: NAVY, lineHeight: 1.45 },
  adminNoteMeta: { fontSize: 11.5, color: '#8A8F98', marginTop: 8 },
  auditInfo: { fontSize: 11.5, color: '#5B6270', background: '#F1EFEA', padding: '9px 11px', borderRadius: 9, marginBottom: 14 },
  payrollStatusBox: { background: '#fff', border: '1.5px solid #E2E4E8', borderRadius: 13, padding: 14, marginBottom: 14 },
  payrollStatusTop: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  payrollDetailAmount: { fontSize: 21, fontWeight: 750, marginTop: 3 },
  payrollStatusInfo: { fontSize: 12, color: '#5B6270', lineHeight: 1.45, marginTop: 10 },
  payrollDetailWarning: { fontSize: 12, color: '#8A6A1F', background: '#FBF3E3', padding: '9px 10px', borderRadius: 9, marginTop: 10, lineHeight: 1.4 },
  payrollDetailActions: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 12 },
  payrollAudit: { fontSize: 11.5, color: '#8A8F98', marginTop: 7 },

  tabs: { display: 'flex', gap: 4, background: '#ECE9E3', borderRadius: 10, padding: 4, marginBottom: 14 },
  tab: { flex: 1, padding: '9px', border: 'none', background: 'transparent', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', color: '#5B6270' },
  tabActive: { background: '#fff', color: NAVY, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' },

  perDiemList: { display: 'flex', flexDirection: 'column', gap: 8 },
  perDiemCard: { background: '#fff', border: '1px solid #ECE9E3', borderRadius: 12, padding: 12 },
  perDiemTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  perDiemDate: { fontSize: 14, fontWeight: 700 },
  perDiemType: { fontSize: 11.5, color: '#8A8F98', marginTop: 2 },
  perDiemAmount: { fontSize: 15, fontWeight: 700, color: GOLD },
  mealRow: { display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' },
  mealChip: { fontSize: 11, padding: '6px 10px', borderRadius: 20, border: '1.5px solid #E2E4E8', background: '#fff', cursor: 'pointer', color: '#5B6270', fontWeight: 500 },
  mealChipActive: { background: NAVY, borderColor: NAVY, color: OFFWHITE },
  mealChipDisabled: { cursor: 'default', opacity: 0.72 },

  expenseList: { display: 'flex', flexDirection: 'column', gap: 8 },
  expenseCard: { background: '#fff', border: '1px solid #ECE9E3', borderRadius: 12, padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  expenseCategory: { fontSize: 13.5, fontWeight: 700 },
  expenseDesc: { fontSize: 12.5, color: '#5B6270', marginTop: 2 },
  paidByLabel: { display: 'inline-block', fontSize: 10.5, color: '#315D8A', background: '#E9EFF8', padding: '3px 7px', borderRadius: 12, marginTop: 6, fontWeight: 650 },
  paidBySelect: { display: 'block', maxWidth: 220, marginTop: 7, border: '1px solid #C8D5E3', borderRadius: 8, padding: '6px 8px', background: '#F7FAFD', color: NAVY, fontSize: 11.5 },
  expenseDate: { fontSize: 11.5, color: '#8A8F98', marginTop: 2 },
  expenseRight: { display: 'flex', alignItems: 'center', gap: 10 },
  expenseAmount: { fontSize: 14.5, fontWeight: 700 },
  trashBtn: { background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex' },
  addExpenseBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '12px', borderRadius: 10, border: `1.5px dashed ${GOLD}`, background: 'transparent', color: GOLD, fontSize: 13.5, fontWeight: 600, cursor: 'pointer', marginTop: 4 },
  confirmBox: { background: '#fff', border: '1.5px solid #E2E4E8', borderRadius: 12, padding: 14, marginTop: 18 },
  confirmLabel: { display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 12.5, lineHeight: 1.45, color: '#5B6270', cursor: 'pointer' },
  submitBtn: { width: '100%', marginTop: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '12px', borderRadius: 10, border: 'none', background: NAVY, color: OFFWHITE, fontSize: 13.5, fontWeight: 600, cursor: 'pointer' },

  exportRow: { display: 'flex', gap: 10, marginTop: 24 },
  exportBtn: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '11px', borderRadius: 10, border: '1.5px solid #E2E4E8', background: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: NAVY },
  deleteBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '11px 14px', borderRadius: 10, border: '1.5px solid #F0D4D2', background: '#fff', color: '#C0392B', cursor: 'pointer' },

  modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(26,35,50,0.5)', display: 'flex', alignItems: 'flex-end', zIndex: 100 },
  modalCard: { background: OFFWHITE, borderRadius: '20px 20px 0 0', padding: '20px 18px 30px', width: '100%', maxWidth: 480, margin: '0 auto', maxHeight: '85vh', overflowY: 'auto', boxSizing: 'border-box' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 },
  modalTitle: { fontSize: 16, fontWeight: 700 },
  computedAmount: { fontSize: 13.5, fontWeight: 600, color: GOLD, marginBottom: 16 },
  companyPaidHint: { fontSize: 12, color: '#315D8A', background: '#E9EFF8', padding: '9px 10px', borderRadius: 9, margin: '-6px 0 16px', lineHeight: 1.4 },
  photoSourceRow: { display: 'flex', gap: 10 },
  photoChoiceBtn: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '14px 10px', borderRadius: 10, border: '1.5px dashed #C4C9D1', background: '#fff', color: '#5B6270', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  photoPreviewWrap: { position: 'relative', width: 100, height: 100 },
  photoPreview: { width: 100, height: 100, objectFit: 'cover', borderRadius: 10, border: '1.5px solid #E2E4E8' },
  photoRemoveBtn: { position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: '50%', background: '#C0392B', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },
  photoIconBtn: { background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex' },
  photoViewerOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 20 },
  photoViewerImg: { maxWidth: '100%', maxHeight: '90vh', borderRadius: 8, boxShadow: '0 10px 40px rgba(0,0,0,0.5)' },
  photoViewerClose: { position: 'fixed', top: 20, right: 20, background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '50%', width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },

  toast: { position: 'fixed', bottom: 100, left: '50%', transform: 'translateX(-50%)', background: NAVY, color: OFFWHITE, padding: '10px 20px', borderRadius: 20, fontSize: 13, fontWeight: 600, boxShadow: '0 8px 24px rgba(0,0,0,0.25)', zIndex: 200 },
};
