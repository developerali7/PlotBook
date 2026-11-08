'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';

const rs = (n) => '₨ ' + Math.round(n || 0).toLocaleString('en-PK');
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => iso(new Date());
const addMonths = (s, n) => { const x = new Date(s + 'T00:00:00'), day = x.getDate(); x.setDate(1); x.setMonth(x.getMonth() + n); x.setDate(Math.min(day, new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate())); return iso(x); };
const initials = (s) => (s || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthly = (p) => Math.round(p.total_price / p.months);
const dg = (s) => (s || '').replace(/\D/g, '');
function behind(p, paid) {
  const s = new Date(p.start_date + 'T00:00:00'), t = new Date();
  let m = (t.getFullYear() - s.getFullYear()) * 12 + t.getMonth() - s.getMonth();
  if (t.getDate() < s.getDate()) m--;
  return Math.max(0, Math.max(0, Math.min(p.months, m + 1)) * monthly(p) - paid);
}
function csv(name, rows) {
  const t = rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([t], { type: 'text/csv' })); a.download = name; a.click();
}
const friendly = (e) => { if (!e) return ''; const m = e.message || ''; return e.code === '23505' ? (m.includes('plots_unique') ? 'A plot with this number already exists.' : m.includes('one_per_plot') ? 'That plot is already assigned to a customer.' : 'A customer with this phone or CNIC already exists.') : m; };

const DEF_UNITS = ['Marla', 'Kanal', 'Sq ft', 'Sq yd', 'Sq m', 'Acre'];
const unitOf = (s) => ((String(s ?? '').match(/^\s*[\d.,]+\s*(.+)$/) || [])[1] || '').trim();
const natural = (a, b) => String(a).replace(/[-\s]/g, '').localeCompare(String(b).replace(/[-\s]/g, ''), undefined, { numeric: true, sensitivity: 'base' }) || String(a).localeCompare(String(b), undefined, { numeric: true });
const PH = '[0-9+\\- ]{10,16}', CN = '\\d{5}-\\d{7}-\\d';
const SPEC = {
  plots: [{ n: 'number', l: 'Plot number' }, { n: 'block', l: 'Block', req: 0 }, { n: 'size', l: 'Size', t: 'size' }, { n: 'price', l: 'Price (₨)', t: 'number', min: 1 }],
  customers: [{ n: 'name', l: 'Full name' }, { n: 'phone', l: 'Phone / WhatsApp', pattern: PH, title: 'e.g. 0300-1234567' }, { n: 'cnic', l: 'CNIC', req: 0, pattern: CN, title: 'Format: 35201-1234567-1' }],
  purchases: [{ n: 'total_price', l: 'Agreed price (₨)', t: 'number', min: 1 }, { n: 'months', l: 'Months', t: 'number', min: 1 }, { n: 'start_date', l: 'First installment date', t: 'date' }],
};
const parse = (spec, f) => Object.fromEntries(spec.map((s) => {
  if (s.t === 'size') { const amt = String(f.size_amount ?? '').trim(), custom = f.size_unit === '__custom', u = custom ? String(f.size_custom ?? '').trim() : f.size_unit; return ['size', amt ? `${amt} ${u}`.trim() : custom && u ? u : null]; }
  const v = String(f[s.n] ?? '').trim(); return [s.n, s.t === 'number' || s.n === 'months' ? +v : v === '' ? null : v];
}));

const LBL = { Dashboard: 'Home', 'Plot Map': 'Plots', Installments: 'Payments' };
const ALIAS = {
  plots: { number: ['plot', 'plotno', 'plotnumber', 'number'], block: ['block'], size: ['size'], price: ['price', 'listprice'] },
  customers: { name: ['name', 'customer', 'customername', 'fullname'], phone: ['phone', 'mobile', 'whatsapp', 'phonewhatsapp', 'phoneno', 'contact'], cnic: ['cnic'], plot: ['plot', 'plotno', 'plotnumber'], price: ['agreedprice', 'price', 'totalprice', 'total'], months: ['months', 'installments', 'term'], start: ['firstinstallmentdate', 'startdate', 'buyingdate', 'date', 'firstinstallment'], paid: ['amountpaidsofar', 'amountpaid', 'paidsofar', 'paid'] },
};
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z]/g, '');
const str = (v) => (v == null ? '' : String(v).trim());
const num = (v) => { const n = parseFloat(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isNaN(n) ? NaN : n; };
const dateOf = (v) => { if (v instanceof Date) return iso(v); const s = str(v), m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''; };
const phoneOf = (v) => { const s = str(v); return /^3\d{9}$/.test(s) ? '0' + s : s; };
const rowsOf = (rows, alias) => {
  if (!rows || !rows.length) return [];
  const head = rows[0].map(norm), idx = {};
  for (const k in alias) idx[k] = head.findIndex((h) => alias[k].includes(h));
  return rows.slice(1).map((r, i) => { const o = { _row: i + 2 }; for (const k in idx) o[k] = idx[k] < 0 ? null : r[idx[k]]; return o; }).filter((o) => Object.keys(idx).some((k) => str(o[k]) !== ''));
};
function buildImport(rp, rc, plots, customers, takenNums) {
  const problems = [], P = [], seen = new Set(plots.map((p) => p.number.trim().toLowerCase()));
  rowsOf(rp, ALIAS.plots).forEach((o) => {
    const number = str(o.number), price = num(o.price), bad = (m) => problems.push(`Plots row ${o._row}: ${m}`);
    if (!number) return bad('plot number is missing');
    if (!(price > 0)) return bad(`price must be a number above 0 (plot ${number})`);
    if (seen.has(number.toLowerCase())) return bad(`plot ${number} already exists or is listed twice`);
    seen.add(number.toLowerCase()); P.push({ number, block: str(o.block) || null, size: str(o.size) || null, price });
  });
  const C = new Map(), A = [], byPhone = new Set(customers.map((c) => dg(c.phone))), cnics = new Set(customers.map((c) => c.cnic).filter(Boolean)), taken = new Set(takenNums);
  rowsOf(rc, ALIAS.customers).forEach((o) => {
    const name = str(o.name), phone = phoneOf(o.phone), key = dg(phone), plot = str(o.plot), bad = (m) => problems.push(`Customers row ${o._row}: ${m}`);
    if (!name) return bad('name is missing');
    if (key.length < 10) return bad(`phone number looks wrong (${name})`);
    const cnic = str(o.cnic) || null;
    if (cnic && !byPhone.has(key) && !C.has(key) && cnics.has(cnic)) return bad(`CNIC ${cnic} already belongs to another customer`);
    let a = null;
    if (plot) {
      const price = num(o.price), months = Math.round(num(o.months)), start = dateOf(o.start), paid = str(o.paid) === '' ? 0 : num(o.paid);
      if (!seen.has(plot.toLowerCase())) return bad(`plot ${plot} was not found (${name})`);
      if (taken.has(plot.toLowerCase())) return bad(`plot ${plot} is already assigned or listed twice`);
      if (!(price > 0)) return bad(`agreed price is missing for plot ${plot}`);
      if (!(months >= 1 && months <= 120)) return bad(`months must be between 1 and 120 for plot ${plot}`);
      if (!start || Number.isNaN(new Date(start + 'T00:00:00').getTime())) return bad(`first installment date is missing or not understood for plot ${plot} (write 25/03/2025)`);
      if (Number.isNaN(paid) || paid < 0 || paid > price) return bad(`amount paid must be between 0 and the agreed price for plot ${plot}`);
      taken.add(plot.toLowerCase()); a = { key, plot, price, months, start, paid };
    }
    if (!byPhone.has(key) && !C.has(key)) { C.set(key, { name, phone, cnic }); if (cnic) cnics.add(cnic); }
    if (a) A.push(a);
  });
  return { P, C: [...C.values()], A, problems };
}

const Modal = ({ title, onClose, children }) => (
  <div className="ov" onClick={(e) => e.target === e.currentTarget && onClose()}>
    <div className="mod"><div className="mh">{title}<button className="x" onClick={onClose} aria-label="Close">✕</button></div>{children}</div>
  </div>
);
function SizeField({ value, units }) {
  const m = String(value ?? '').match(/^\s*([\d.,]+)\s*(.*)$/), raw = m ? m[2].trim() : String(value ?? '').trim();
  const found = units.find((u) => u.toLowerCase() === raw.toLowerCase());
  const [unit, setUnit] = useState(found || (raw ? '__custom' : units[0]));
  return (<>
    <label>Size<input name="size_amount" type="number" step="any" min="0" defaultValue={m ? m[1].replace(/,/g, '') : ''} placeholder="e.g. 5" /></label>
    <label>Unit<select name="size_unit" value={unit} onChange={(e) => setUnit(e.target.value)}>{units.map((u) => <option key={u} value={u}>{u}</option>)}<option value="__custom">Other unit…</option></select></label>
    {unit === '__custom' && <label className="w">Unit name<input name="size_custom" required defaultValue={found || m ? '' : raw} placeholder="e.g. Gaz, Biswa, Square feet" /></label>}
  </>);
}
const Fields = ({ spec, row = {}, units = [] }) => spec.map((f) => f.t === 'size' ? <SizeField key={f.n} value={row.size} units={units} /> : (
  <label key={f.n}>{f.l}{f.o
    ? <select name={f.n} defaultValue={row[f.n]}>{(row[f.n] != null && !f.o.map(String).includes(String(row[f.n])) ? [row[f.n], ...f.o] : f.o).map((x) => <option key={x}>{x}</option>)}</select>
    : <input name={f.n} type={f.t || 'text'} defaultValue={row[f.n] ?? ''} required={f.req !== 0} min={f.min} pattern={f.pattern} title={f.title} />}</label>
));
const Actions = ({ onCancel, busy, label }) => (
  <div className="ma w"><button type="button" className="btn gh" onClick={onCancel}>Cancel</button><button className="btn" disabled={busy}>{label}</button></div>
);

function Auth() {
  const [email, setEmail] = useState(''), [pw, setPw] = useState(''), [society, setSociety] = useState('');
  const [up, setUp] = useState(false), [msg, setMsg] = useState('');
  async function go(e) {
    e.preventDefault(); setMsg('');
    const { error, data } = up ? await supabase.auth.signUp({ email, password: pw, options: { data: { society } } }) : await supabase.auth.signInWithPassword({ email, password: pw });
    if (error) setMsg(error.message); else if (up && !data.session) setMsg('Check your email to confirm your account, then sign in.');
  }
  return (
    <main className="auth">
      <div className="logo" style={{ border: 0, padding: 0 }}><div className="li">🏗</div><div className="lt">PlotBook</div></div>
      <p style={{ marginTop: 10 }}>Plots, customers and installments in one place.</p>
      <form onSubmit={go}>
        {up && <input required placeholder="Society or company name" value={society} onChange={(e) => setSociety(e.target.value)} />}
        <input type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input type="password" required minLength={6} placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} />
        {msg && <div className="err">{msg}</div>}
        <button className="btn">{up ? 'Create account' : 'Sign in'}</button>
      </form>
      <p>{up ? 'Already registered? ' : 'New here? '}<button className="link" onClick={() => { setUp(!up); setMsg(''); }}>{up ? 'Sign in' : 'Create an account'}</button></p>
    </main>
  );
}

function Ledger({ user }) {
  const [page, setPage] = useState('Dashboard'), [sel, setSel] = useState(null), [modal, setModal] = useState(null);
  const [q, setQ] = useState(''), [blk, setBlk] = useState(''), [tip, setTip] = useState(null), [err, setErr] = useState('');
  const [d, setD] = useState({ plots: [], customers: [], purchases: [], payments: [], transfers: [], history: [] });
  const [cp, setCp] = useState({ plot: '', price: '', months: '36' }), [pp, setPp] = useState({ pid: '', amount: '' }), [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [ok, setOk] = useState(''), [imp, setImp] = useState(null), [prefs, setPrefs] = useState({ theme: 'light', size: '15' });
  const { plots, customers, purchases, payments, transfers, history } = d;
  const society = user.user_metadata?.society || 'My Society';

  const load = useCallback(async () => {
    const T = [['plots', 'number', true], ['customers', 'created_at'], ['purchases', 'created_at'], ['payments', 'paid_on'], ['plot_transfers', 'transferred_on'], ['history', 'created_at']];
    const r = await Promise.all(T.map(([t, o, a]) => supabase.from(t).select('*').order(o, { ascending: !!a }).limit(t === 'history' ? 200 : 5000)));
    const e = r.find((x) => x.error)?.error;
    if (e) return setErr(e.message);
    setD({ plots: [...r[0].data].sort((a, b) => natural(a.number, b.number)), customers: r[1].data, purchases: r[2].data, payments: r[3].data, transfers: r[4].data, history: r[5].data });
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { try { const s = JSON.parse(localStorage.getItem('pb_prefs2')); if (s) setPrefs(s); } catch {} }, []);
  useEffect(() => { document.documentElement.dataset.theme = prefs.theme; document.documentElement.style.fontSize = prefs.size + 'px'; try { localStorage.setItem('pb_prefs2', JSON.stringify(prefs)); } catch {} }, [prefs]);
  useEffect(() => { document.querySelectorAll('table').forEach((t) => { const h = [...t.querySelectorAll('thead th')].map((x) => x.textContent); t.querySelectorAll('tbody tr').forEach((r) => [...r.children].forEach((c, i) => c.setAttribute('data-l', h[i] || ''))); }); });

  async function run(x) { const { error } = await x; setErr(friendly(error)); if (!error) await load(); return !error; }
  const guard = (fn) => async (e) => {
    e.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try { await fn(Object.fromEntries(new FormData(e.target))); } finally { busyRef.current = false; setBusy(false); }
  };
  const paidBy = (id) => payments.filter((y) => y.purchase_id === id).reduce((s, y) => s + Number(y.amount), 0);
  const countBy = (id) => { const p = ofPurchase(id); return p ? Math.min(p.months, Math.floor(paidBy(id) / monthly(p) + 1e-9)) : 0; };
  const plotNo = (id) => plots.find((p) => p.id === id)?.number || '-';
  const custName = (id) => customers.find((c) => c.id === id)?.name || '-';
  const ownerOf = (plotId) => purchases.find((p) => p.plot_id === plotId);
  const ofPurchase = (id) => purchases.find((p) => p.id === id);
  const open = (k, x = {}) => { setErr(''); setTip(null); setModal({ k, ...x }); };
  const go = (p, id) => { setPage(p); setSel(id ?? null); setErr(''); setOk(''); setTip(null); };
  const del = (t, id, what) => confirm(`Delete this ${what}? This cannot be undone.`) && run(supabase.from(t).delete().eq('id', id));

  async function addPlot(f) {
    const v = parse(SPEC.plots, f);
    if (plots.some((p) => p.number.trim().toLowerCase() === v.number.toLowerCase())) return setErr(`Plot ${v.number} already exists.`);
    if (await run(supabase.from('plots').insert(v))) setModal(null);
  }
  async function addCustomer(f) {
    const v = parse(SPEC.customers, f);
    if (customers.some((c) => dg(c.phone) === dg(v.phone) || (v.cnic && c.cnic === v.cnic))) return setErr('A customer with this phone or CNIC already exists. Open that customer and assign another plot instead.');
    const { data, error } = await supabase.from('customers').insert(v).select().single();
    if (error) return setErr(friendly(error));
    await load(); setModal(null); go('Customer', data.id);
  }
  async function assign(f) {
    if (!f.plot_id || ownerOf(f.plot_id)) return setErr('Choose an available plot.');
    if (await run(supabase.from('purchases').insert({ customer_id: modal.cid, plot_id: f.plot_id, total_price: +f.total_price, months: +f.months, start_date: f.start_date }))) { setModal(null); setCp({ plot: '', price: '', months: '36' }); }
  }
  async function pay(f) {
    const p = ofPurchase(f.purchase_id), amt = +f.amount;
    if (!p) return setErr('Choose which plot this payment is for.');
    const owed = p.total_price - paidBy(p.id);
    if (amt > owed + 0.5) return setErr(`That is more than the ${rs(owed)} still owed on plot ${plotNo(p.plot_id)}.`);
    if (payments.some((y) => y.purchase_id === p.id && y.paid_on === f.paid_on && Number(y.amount) === amt) && !confirm('The same amount is already recorded for this plot on this date. Record it again?')) return;
    if (await run(supabase.from('payments').insert({ purchase_id: p.id, amount: amt, paid_on: f.paid_on, method: f.method, note: f.note }))) { setModal(null); setPp({ pid: '', amount: '' }); }
  }
  async function transfer(f) {
    if (!f.to) return setErr('Choose the new owner.');
    const { error } = await supabase.rpc('transfer_plot', { p_purchase: modal.p.id, p_to: f.to, p_date: f.date, p_fee: +f.fee || 0, p_note: f.note || null });
    setErr(friendly(error)); if (!error) { setModal(null); load(); }
  }
  async function saveEdit(f) {
    const { t, row } = modal, v = parse(SPEC[t], f);
    if (t === 'purchases' && v.total_price < paidBy(row.id)) return setErr(`The agreed price can't be below the ${rs(paidBy(row.id))} already paid.`);
    if (await run(supabase.from(t).update(v).eq('id', row.id))) setModal(null);
  }
  async function pickFile(e) {
    const file = e.target.files[0]; if (!file) return;
    try {
      const read = (await import('read-excel-file')).default;
      const rp = await read(file, { sheet: 1 });
      let rc = []; try { rc = await read(file, { sheet: 2 }); } catch { rc = []; }
      setImp(buildImport(rp, rc, plots, customers, purchases.map((p) => plotNo(p.plot_id).toLowerCase()))); setErr('');
    } catch { setErr('Could not read that file. Please use an .xlsx file (Excel 2007 or newer). In Excel you can use File > Save As to convert it.'); }
    e.target.value = '';
  }
  async function runImport() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    const { P, C, A } = imp, fail = (e) => setErr('Import stopped: ' + friendly(e) + '. Some rows may already have been added; see the Activity page.');
    try {
      let pl = [], cu = [];
      if (P.length) { const r = await supabase.from('plots').insert(P).select(); if (r.error) return fail(r.error); pl = r.data; }
      if (C.length) { const r = await supabase.from('customers').insert(C).select(); if (r.error) return fail(r.error); cu = r.data; }
      const plotId = (n) => [...plots, ...pl].find((p) => p.number.trim().toLowerCase() === n.toLowerCase())?.id;
      const custId = (k) => [...customers, ...cu].find((c) => dg(c.phone) === k)?.id;
      if (A.length) {
        const r = await supabase.from('purchases').insert(A.map((a) => ({ customer_id: custId(a.key), plot_id: plotId(a.plot), total_price: a.price, months: a.months, start_date: a.start }))).select();
        if (r.error) return fail(r.error);
        const pays = A.filter((a) => a.paid > 0).map((a) => ({ purchase_id: r.data.find((p) => p.plot_id === plotId(a.plot)).id, amount: a.paid, paid_on: today(), method: 'Imported', note: 'Opening balance from Excel' }));
        if (pays.length) { const r2 = await supabase.from('payments').insert(pays); if (r2.error) return fail(r2.error); }
      }
      setImp(null); setModal(null); setErr(''); setOk(`Imported ${P.length} plots, ${C.length} customers and ${A.length} plot assignments.`); await load();
    } finally { busyRef.current = false; setBusy(false); }
  }
  const delPlot = (p) => ownerOf(p.id) ? setErr(`Plot ${p.number} is assigned to ${custName(ownerOf(p.id).customer_id)}. Cancel the assignment first.`) : del('plots', p.id, 'plot');
  const delCustomer = async (c) => {
    if (purchases.some((p) => p.customer_id === c.id)) return setErr('This customer still has plots. Cancel or transfer them first.');
    if (await del('customers', c.id, 'customer')) go('Customers');
  };

  const cnt = (s) => plots.filter((p) => p.status === s).length;
  const sold = cnt('sold'), held = cnt('held'), avail = cnt('available');
  const collected = payments.reduce((s, y) => s + Number(y.amount), 0);
  const contract = purchases.reduce((s, p) => s + Number(p.total_price), 0);
  const late = purchases.map((p) => ({ p, gap: behind(p, paidBy(p.id)) })).filter((x) => x.gap > 0).sort((a, b) => b.gap - a.gap);
  const lateAmt = late.reduce((s, x) => s + x.gap, 0);
  const year = new Date().getFullYear(), thisM = new Date().getMonth();
  const byMonth = MONTHS.map((_, i) => payments.filter((y) => y.paid_on.startsWith(`${year}-${String(i + 1).padStart(2, '0')}`)).reduce((s, y) => s + Number(y.amount), 0));
  const maxM = Math.max(...byMonth, 1);
  const upcoming = purchases.filter((p) => countBy(p.id) < p.months).map((p) => ({ p, due: addMonths(p.start_date, countBy(p.id)) })).sort((a, b) => a.due.localeCompare(b.due)).slice(0, 5);
  const R = 48, C = 2 * Math.PI * R; let off = 0;
  const arcs = [[sold, 'var(--ac)'], [avail, 'var(--gr)'], [held, 'var(--am)']].map(([n, col]) => {
    const len = plots.length ? (n / plots.length) * C : 0;
    const el = <circle key={col} cx="60" cy="60" r={R} fill="none" stroke={col} strokeWidth="18" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-off} transform="rotate(-90 60 60)" />;
    off += len; return el;
  });
  const blocks = [...new Set(plots.map((p) => p.block).filter(Boolean))].sort(natural);
  const units = (() => { const m = new Map(); [...DEF_UNITS, ...plots.map((p) => unitOf(p.size))].filter(Boolean).forEach((u) => !m.has(u.toLowerCase()) && m.set(u.toLowerCase(), u)); return [...m.values()]; })();
  const shownPlots = plots.filter((p) => !blk || p.block === blk);
  const groups = Object.entries(shownPlots.reduce((g, p) => { const k = p.block || '—'; (g[k] = g[k] || []).push(p); return g; }, {})).sort(([a], [b]) => natural(a, b));
  const payRows = payments.filter((y) => { const p = ofPurchase(y.purchase_id); return (custName(p?.customer_id) + plotNo(p?.plot_id)).toLowerCase().includes(q.toLowerCase()); });
  const c = customers.find((x) => x.id === sel);
  const pLabel = (p) => `${custName(p.customer_id)} — plot ${plotNo(p.plot_id)}`;
  const nm = (k, v) => (k === 'customer_id' ? custName(v) : k === 'plot_id' ? plotNo(v) : v ?? '—');
  const what = (h) => { const x = h.new_data || h.old_data; return ({ plots: `plot ${x.number}`, customers: `customer ${x.name}`, purchases: `plot ${plotNo(x.plot_id)} for ${custName(x.customer_id)}`, payments: `payment of ${rs(x.amount)}`, plot_transfers: `transfer of plot ${plotNo(x.plot_id)}` })[h.table_name]; };
  const diff = (h) => (h.action !== 'UPDATE' ? '' : Object.keys(h.new_data).filter((k) => JSON.stringify(h.old_data[k]) !== JSON.stringify(h.new_data[k])).map((k) => `${k.replace(/_/g, ' ')}: ${nm(k, h.old_data[k])} → ${nm(k, h.new_data[k])}`).join(', '));
  const nav = [['Overview', [['Dashboard', '🏠']]], ['Management', [['Plot Map', '🗺'], ['Customers', '👥'], ['Installments', '💳']]], ['Reports', [['Reports', '📄'], ['Activity', '🕘']]]];
  const ledgerCsv = () => csv('ledger.csv', [['Date', 'Customer', 'Plot', 'Amount', 'Method', 'Note'], ...payments.map((y) => { const p = ofPurchase(y.purchase_id); return [y.paid_on, custName(p?.customer_id), plotNo(p?.plot_id), y.amount, y.method, y.note]; })]);
  const custCsv = () => csv('customers.csv', [['Name', 'Phone', 'CNIC', 'Plots', 'Total', 'Paid', 'Remaining'], ...customers.map((x) => { const m = purchases.filter((p) => p.customer_id === x.id); const t = m.reduce((s, p) => s + Number(p.total_price), 0), pd = m.reduce((s, p) => s + paidBy(p.id), 0); return [x.name, x.phone, x.cnic, m.map((p) => plotNo(p.plot_id)).join(' '), t, pd, t - pd]; })]);

  return (
    <div className="app">
      <aside className="side">
        <div className="logo"><div className="li">🏗</div><div><div className="lt">PlotBook</div><div className="ls">Real Estate Manager</div></div></div>
        <div className="org"><b>{society}</b><small>{plots.length} plots · {customers.length} customers</small></div>
        <nav className="nv">
          {nav.map(([sec, items]) => (
            <div key={sec}><div className="ns">{sec}</div>
              {items.map(([n, ic]) => (
                <button key={n} className="ni" aria-current={page === n || (n === 'Customers' && page === 'Customer')} onClick={() => go(n)}>
                  <span>{ic}</span>{LBL[n] || n}{n === 'Installments' && late.length > 0 && <span className="bg">{late.length}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sf"><div className="av">{initials(user.email)}</div><div>{user.email.split('@')[0]}<small>Admin</small></div><button className="btn gh sm" onClick={() => supabase.auth.signOut()}>Sign out</button></div>
      </aside>

      <main className="main">
        <header className="top">
          <div className="tt">{LBL[page] || page}</div>
          <div className="ta">
            <button className="btn gh sm" onClick={() => open('customer')}>+ Customer</button>
            <button className="btn sm" onClick={() => { setPp({ pid: '', amount: '' }); open('pay'); }}>+ Record Payment</button>
            <button className="btn gh sm" aria-label="Display settings" onClick={() => open('prefs')}>⚙ Display</button>
          </div>
        </header>
        <div className="pg">
          {err && <div className="err">{err}</div>}
          {ok && <div className="ok">{ok}</div>}

          {page === 'Dashboard' && (<>
            {late.length > 0 && <div className="alert"><span>⚠️</span><div><b>{late.length} plot account{late.length > 1 ? 's are' : ' is'} behind</b> — totalling {rs(lateAmt)}.</div></div>}
            <div className="stats">
              <div className="stat"><div className="sl">Total plots</div><div className="sv" style={{ color: 'var(--ac)' }}>{plots.length}</div><div className="sm2">{avail} available</div></div>
              <div className="stat"><div className="sl">Plots sold</div><div className="sv" style={{ color: 'var(--gr)' }}>{sold}</div><div className="sm2">{customers.length} customers</div></div>
              <div className="stat"><div className="sl">Collections this month</div><div className="sv">{rs(byMonth[thisM])}</div><div className="sm2">{rs(contract - collected)} still to collect</div></div>
              <div className="stat"><div className="sl">Overdue accounts</div><div className="sv" style={{ color: late.length ? 'var(--rd)' : 'var(--gr)' }}>{late.length}</div><div className="sm2">of {purchases.length} plot accounts</div></div>
            </div>
            <div className="row2">
              <div className="card"><div className="ct">Monthly collections — {year}</div><div className="cs">Payments received, in rupees</div>
                <div className="bars">{byMonth.map((v, i) => <div className="bar" key={i}><i style={{ height: v ? (v / maxM) * 100 + '%' : 4, background: v ? 'var(--ac)' : 'var(--bd)', opacity: i === thisM || !v ? 1 : 0.5 }} title={rs(v)} />{MONTHS[i]}</div>)}</div></div>
              <div className="card"><div className="ct">Plot availability</div>
                <div className="dn"><svg width="120" height="120" viewBox="0 0 120 120"><circle cx="60" cy="60" r={R} fill="none" stroke="var(--bd)" strokeWidth="18" />{arcs}
                  <text x="60" y="58" textAnchor="middle" fontSize="18" fontWeight="700" fill="var(--tx)">{plots.length}</text><text x="60" y="73" textAnchor="middle" fontSize="10" fill="var(--mu)">total plots</text></svg>
                  <div className="lg"><div><i style={{ background: 'var(--ac)' }} />Sold<b>{sold}</b></div><div><i style={{ background: 'var(--gr)' }} />Available<b>{avail}</b></div><div><i style={{ background: 'var(--am)' }} />On hold<b>{held}</b></div></div></div></div>
            </div>
            <div className="row2">
              <div className="card"><div className="ct">Upcoming installments</div>
                {upcoming.length === 0 ? <p className="empty">Assign a plot to a customer to see installments here.</p> : (
                  <table style={{ minWidth: 0 }}><thead><tr><th>Customer</th><th>Plot</th><th>Due</th><th className="r">Amount</th></tr></thead><tbody>
                    {upcoming.map(({ p, due }) => <tr key={p.id}><td>{custName(p.customer_id)}</td><td className="m">{plotNo(p.plot_id)}</td><td><span className={'pill ' + (due < today() ? 'r' : new Date(due + 'T00:00:00') - new Date() < 6048e5 ? 'a' : 'g')}>{due}</span></td><td className="r"><b>{rs(monthly(p))}</b></td></tr>)}
                  </tbody></table>)}</div>
              <div className="card act"><div className="ct">Recent activity</div>
                {payments.length === 0 ? <p className="empty">Payments you record will show up here.</p> : [...payments].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5).map((y) => (
                  <div key={y.id}><i style={{ background: 'var(--gr)' }} /><span>Payment of <b>{rs(y.amount)}</b> from {custName(ofPurchase(y.purchase_id)?.customer_id)}<small>{y.paid_on} · {y.method}</small></span></div>))}</div>
            </div>
          </>)}

          {page === 'Plot Map' && (<>
            <div className="pc2">
              <div className="key"><span><i style={{ background: 'var(--ac)' }} />Sold ({sold})</span><span><i style={{ border: '2px solid var(--gr)', boxSizing: 'border-box' }} />Available ({avail})</span><span><i style={{ background: 'var(--amb)', border: '2px dashed var(--am)', boxSizing: 'border-box' }} />On hold ({held})</span></div>
              <div className="sp"><select className="in" style={{ width: 'auto' }} value={blk} onChange={(e) => setBlk(e.target.value)}><option value="">All blocks</option>{blocks.map((b) => <option key={b}>{b}</option>)}</select>
                <button className="btn gh sm" onClick={() => { setImp(null); open('import'); }}>📤 Import Excel</button><button className="btn sm" onClick={() => open('plot')}>+ Add plot</button></div>
            </div>
            <div className="card"><div className="ct">{society} — plot layout</div>
              {shownPlots.length === 0 ? <p className="empty">No plots yet. Use “Add plot” to create your first one.</p> : (
                <div>{groups.map(([b, list]) => (<div key={b} className="blk"><div className="bh">{b === '—' ? 'No block' : 'Block ' + b} <span className="m">· {list.length} plot{list.length > 1 ? 's' : ''}</span></div><div className="pgrid">{list.map((p) => (
                  <button key={p.id} className={'pc ' + p.status} title={ownerOf(p.id) ? 'Open owner' : 'Click to toggle available / on hold'}
                    onClick={() => { const o = ownerOf(p.id); if (o) go('Customer', o.customer_id); else run(supabase.from('plots').update({ status: p.status === 'held' ? 'available' : 'held' }).eq('id', p.id)); }}
                    onMouseEnter={(e) => setTip({ p, x: e.clientX, y: e.clientY })} onMouseMove={(e) => setTip({ p, x: e.clientX, y: e.clientY })} onMouseLeave={() => setTip(null)}>{p.number}</button>))}</div></div>))}</div>)}</div>
            {shownPlots.length > 0 && <div className="tw" style={{ marginTop: 18 }}><table><thead><tr><th>Plot</th><th>Block</th><th>Size</th><th className="r">Price</th><th>Owner / status</th><th /></tr></thead><tbody>
              {shownPlots.map((p) => { const o = ownerOf(p.id); return (
                <tr key={p.id}><td><b>{p.number}</b></td><td>{p.block}</td><td>{p.size}</td><td className="r">{rs(p.price)}</td>
                  <td>{o ? <button className="link" onClick={() => go('Customer', o.customer_id)}>{custName(o.customer_id)}</button> : <select className="in" style={{ width: 'auto' }} value={p.status} onChange={(e) => run(supabase.from('plots').update({ status: e.target.value }).eq('id', p.id))}><option value="available">Available</option><option value="held">On hold</option></select>}</td>
                  <td className="r"><div className="btns" style={{ justifyContent: 'flex-end' }}>{o && <button className="btn gh sm" onClick={() => open('transfer', { p: o })}>Transfer</button>}<button className="btn gh sm" onClick={() => open('edit', { t: 'plots', row: p })}>Edit</button><button className="btn gh sm" onClick={() => delPlot(p)}>Delete</button></div></td></tr>); })}</tbody></table></div>}
          </>)}

          {page === 'Customers' && (customers.length === 0 ? <div className="card"><p className="empty">No customers yet. Use “+ Customer” to add a buyer, then assign plots to them.</p></div> : (
            <div className="cg">{customers.map((x) => { const m = purchases.filter((p) => p.customer_id === x.id), t = m.reduce((s, p) => s + Number(p.total_price), 0), pd = m.reduce((s, p) => s + paidBy(p.id), 0), bh = m.some((p) => behind(p, paidBy(p.id)) > 0); return (
              <div className="cc" key={x.id} role="button" tabIndex={0} onClick={() => go('Customer', x.id)} onKeyDown={(e) => e.key === 'Enter' && go('Customer', x.id)}>
                <div className="av" style={{ width: 40, height: 40, marginBottom: 12 }}>{initials(x.name)}</div>
                <div className="cn">{x.name}</div><div className="cm">📞 {x.phone || '—'}</div>
                <div className="cs3"><div><b>{m.length}</b><small>Plots</small></div><div><b style={{ color: 'var(--gr)' }}>{rs(pd)}</b><small>Paid</small></div><div><b style={{ color: 'var(--am)' }}>{rs(t - pd)}</b><small>Remaining</small></div></div>
                <div className="prog"><i style={{ width: (t ? Math.min(100, (pd / t) * 100) : 0) + '%', background: bh ? 'var(--rd)' : 'var(--gr)' }} /></div>
                <div style={{ marginTop: 10 }}>{m.length === 0 ? <span className="pill a">No plot assigned yet</span> : <span className={'pill ' + (bh ? 'r' : 'g')}>{bh ? '⚠ Behind' : '✓ On track'}</span>}</div></div>); })}</div>))}

          {page === 'Customer' && c && (() => {
            const m = purchases.filter((p) => p.customer_id === c.id), t = m.reduce((s, p) => s + Number(p.total_price), 0), pd = m.reduce((s, p) => s + paidBy(p.id), 0);
            const tr = transfers.filter((x) => x.from_customer_id === c.id || x.to_customer_id === c.id);
            return (<>
              <button className="btn gh sm" onClick={() => go('Customers')}>← All customers</button>
              <div className="card gap">
                <div className="hd"><div style={{ display: 'flex', gap: 12, alignItems: 'center' }}><div className="av" style={{ width: 46, height: 46 }}>{initials(c.name)}</div><div><div className="tt">{c.name}</div><div className="m">📞 {c.phone || '—'} · CNIC {c.cnic || '—'} · Customer since {c.created_at.slice(0, 10)}</div></div></div>
                  <div className="btns"><button className="btn sm" onClick={() => { setCp({ plot: '', price: '', months: '36' }); open('assign', { cid: c.id }); }}>+ Assign plot</button><button className="btn gh sm" onClick={() => open('edit', { t: 'customers', row: c })}>Edit</button><button className="btn gh sm" onClick={() => delCustomer(c)}>Delete</button></div></div>
                <div className="dg"><div><small>Plots owned</small><b>{m.length}</b></div><div><small>Total agreed</small><b>{rs(t)}</b></div><div><small>Total paid</small><b style={{ color: 'var(--gr)' }}>{rs(pd)}</b></div><div><small>Remaining</small><b style={{ color: 'var(--am)' }}>{rs(t - pd)}</b></div></div>
              </div>
              {m.length === 0 && <div className="card gap"><p className="empty">No plots assigned yet. Use “Assign plot” to start an installment plan.</p></div>}
              {m.map((p) => { const plot = plots.find((x) => x.id === p.plot_id), paid = paidBy(p.id), n = countBy(p.id), bh = behind(p, paid) > 0, ys = payments.filter((y) => y.purchase_id === p.id); return (
                <div className="card gap" key={p.id}>
                  <div className="hd"><div><div className="tt">Plot {plot?.number} <span className={'pill ' + (paid >= p.total_price ? 'g' : bh ? 'r' : 'g')}>{paid >= p.total_price ? '✓ Fully paid' : bh ? '⚠ Behind' : '✓ On track'}</span></div><div className="m">{plot?.size} · Block {plot?.block || '—'} · Listed {rs(plot?.price)}</div></div>
                    <div className="btns"><button className="btn sm" onClick={() => { setPp({ pid: p.id, amount: monthly(p) }); open('pay'); }}>Record payment</button><button className="btn gh sm" onClick={() => open('transfer', { p })}>Transfer</button><button className="btn gh sm" onClick={() => open('edit', { t: 'purchases', row: p })}>Edit terms</button><button className="btn gh sm" onClick={() => del('purchases', p.id, 'plot assignment and all its payments')}>Cancel</button></div></div>
                  <div className="dg"><div><small>Buying date</small><b>{p.start_date}</b></div><div><small>Agreed price</small><b>{rs(p.total_price)}</b></div><div><small>Monthly</small><b>{rs(monthly(p))}</b></div><div><small>Installments paid</small><b>{n} of {p.months}</b></div><div><small>Installments remaining</small><b>{Math.max(0, p.months - n)}</b></div><div><small>Paid</small><b style={{ color: 'var(--gr)' }}>{rs(paid)}</b></div><div><small>Remaining</small><b style={{ color: 'var(--am)' }}>{rs(p.total_price - paid)}</b></div><div><small>Next due</small><b>{n < p.months ? addMonths(p.start_date, n) : '—'}</b></div></div>
                  <div className="prog" style={{ margin: 0 }}><i style={{ width: Math.min(100, (paid / p.total_price) * 100) + '%', background: bh ? 'var(--rd)' : 'var(--gr)' }} /></div>
                  {ys.length > 0 && <div className="tw"><table style={{ minWidth: 0 }}><thead><tr><th>Date</th><th className="r">Amount</th><th>Method</th><th>Note</th><th /></tr></thead><tbody>{ys.map((y) => <tr key={y.id}><td>{y.paid_on}</td><td className="r"><b>{rs(y.amount)}</b></td><td>{y.method}</td><td className="m">{y.note || '—'}</td><td className="r"><button className="btn gh sm" onClick={() => del('payments', y.id, 'payment')}>Delete</button></td></tr>)}</tbody></table></div>}
                </div>); })}
              {tr.length > 0 && <div className="card gap"><div className="ct">Ownership transfers</div>{tr.map((x) => <div key={x.id} className="m">{x.transferred_on} · Plot {plotNo(x.plot_id)}: {custName(x.from_customer_id)} → {custName(x.to_customer_id)}{x.fee > 0 ? ` · fee ${rs(x.fee)}` : ''}{x.note ? ` · ${x.note}` : ''}</div>)}</div>}
            </>);
          })()}

          {page === 'Installments' && (<>
            <div className="pc2"><input className="in" placeholder="🔍  Search by name or plot..." value={q} onChange={(e) => setQ(e.target.value)} /><div className="sp"><button className="btn gh sm" onClick={ledgerCsv}>📥 Export CSV</button></div></div>
            {payRows.length === 0 ? <div className="card"><p className="empty">No payments to show. Use “+ Record Payment” when a customer pays.</p></div> : <div className="tw"><table><thead><tr><th>Date</th><th>Customer</th><th>Plot</th><th className="r">Amount</th><th>Method</th><th>Note</th><th /></tr></thead><tbody>
              {payRows.map((y) => { const p = ofPurchase(y.purchase_id); return <tr key={y.id}><td className="m">{y.paid_on}</td><td><b>{custName(p?.customer_id)}</b></td><td className="m">{plotNo(p?.plot_id)}</td><td className="r"><b>{rs(y.amount)}</b></td><td>{y.method}</td><td className="m">{y.note || '—'}</td><td className="r"><button className="btn gh sm" onClick={() => del('payments', y.id, 'payment')}>Delete</button></td></tr>; })}</tbody></table></div>}
          </>)}

          {page === 'Reports' && (
            <div className="rg"><div className="card"><div className="e">📤</div><div className="ct">Import from Excel</div><p>Bring in your existing plots, customers and balances from an Excel sheet.</p><button className="btn sm" onClick={() => { setImp(null); open('import'); }}>Import Excel file</button></div>
              <div className="card"><div className="e">📊</div><div className="ct">Full installment ledger</div><p>Every payment with customer, plot, method and notes.</p><button className="btn sm" onClick={ledgerCsv}>Download CSV</button></div>
              <div className="card"><div className="e">👥</div><div className="ct">Customer database</div><p>Customers with their plots, totals, paid and remaining balance.</p><button className="btn sm" onClick={custCsv}>Download CSV</button></div>
            </div>)}

          {page === 'Activity' && (<>
            <div className="ct">Ownership transfers</div>
            {transfers.length === 0 ? <div className="card"><p className="empty">No plots have been transferred yet. Use “Transfer” on a plot to move it to another customer.</p></div> : <div className="tw"><table><thead><tr><th>Date</th><th>Plot</th><th>From</th><th>To</th><th className="r">Fee</th><th>Note</th></tr></thead><tbody>
              {transfers.map((x) => <tr key={x.id}><td className="m">{x.transferred_on}</td><td><b>{plotNo(x.plot_id)}</b></td><td>{custName(x.from_customer_id)}</td><td>{custName(x.to_customer_id)}</td><td className="r">{rs(x.fee)}</td><td className="m">{x.note || '—'}</td></tr>)}</tbody></table></div>}
            <div className="ct" style={{ marginTop: 24 }}>Change history (latest 200)</div>
            {history.length === 0 ? <div className="card"><p className="empty">Changes will be listed here.</p></div> : <div className="card act">{history.map((h) => <div key={h.id}><i style={{ background: h.action === 'DELETE' ? 'var(--rd)' : h.action === 'UPDATE' ? 'var(--am)' : 'var(--gr)' }} /><span><b>{{ INSERT: 'Added', UPDATE: 'Edited', DELETE: 'Deleted' }[h.action]}</b> {what(h)}{diff(h) && <> — {diff(h)}</>}<small>{new Date(h.created_at).toLocaleString()} · {h.actor}</small></span></div>)}</div>}
          </>)}
        </div>
      </main>

      {tip && <div className="tip" style={{ left: tip.x + 14, top: tip.y - 10 }}><b>Plot {tip.p.number}</b>
        <div>Owner<span>{ownerOf(tip.p.id) ? custName(ownerOf(tip.p.id).customer_id) : '—'}</span></div><div>Size<span>{tip.p.size}</span></div><div>Status<span>{tip.p.status}</span></div><div>Price<span>{rs(tip.p.price)}</span></div></div>}

      {modal?.k === 'prefs' && <Modal title="Display settings" onClose={() => setModal(null)}><div className="gap">
        <div><div className="ct">Colour theme</div><div className="btns">{[['light', '☀ Light'], ['dark', '🌙 Dark']].map(([v, l]) => <button key={v} className={'btn big' + (prefs.theme === v ? '' : ' gh')} aria-pressed={prefs.theme === v} onClick={() => setPrefs({ ...prefs, theme: v })}>{l}</button>)}</div></div>
        <div><div className="ct">Text size</div><div className="btns">{[['15', 'Normal'], ['17', 'Large'], ['20', 'Extra large']].map(([v, l]) => <button key={v} className={'btn big' + (prefs.size === v ? '' : ' gh')} aria-pressed={prefs.size === v} onClick={() => setPrefs({ ...prefs, size: v })}>{l}</button>)}</div></div>
        <button className="btn gh" onClick={() => supabase.auth.signOut()}>Sign out</button></div></Modal>}
      {modal?.k === 'import' && <Modal title="Import from Excel" onClose={() => setModal(null)}>{!imp ? (
        <div className="gap">
          <p><b>Step 1.</b> Download the template and fill it in. Sheet 1 is <b>Plots</b>. Sheet 2 is <b>Customers</b>, with one row for each plot a customer bought.</p>
          <a className="btn gh" href="/plotbook-import-template.xlsx" download>📥 Download Excel template</a>
          <p><b>Step 2.</b> Choose your finished .xlsx file. You will see a summary before anything is saved.</p>
          <input type="file" accept=".xlsx" className="file" onChange={pickFile} />
        </div>) : (
        <div className="gap">
          <div className="dg"><div><small>Plots to add</small><b>{imp.P.length}</b></div><div><small>New customers</small><b>{imp.C.length}</b></div><div><small>Plot assignments</small><b>{imp.A.length}</b></div></div>
          {imp.A.some((a) => a.paid > 0) && <p className="m">Amounts already paid are saved as one opening payment dated today.</p>}
          {imp.problems.length > 0 && <div className="err" style={{ maxHeight: '30vh', overflow: 'auto' }}><b>{imp.problems.length} row(s) will be skipped:</b>{imp.problems.slice(0, 15).map((x, i) => <div key={i}>{x}</div>)}{imp.problems.length > 15 && <div>…and {imp.problems.length - 15} more</div>}</div>}
          <div className="ma"><button className="btn gh" onClick={() => setImp(null)}>Choose another file</button><button className="btn" disabled={busy || !(imp.P.length + imp.C.length + imp.A.length)} onClick={runImport}>Import now</button></div>
        </div>)}</Modal>}
      {modal?.k === 'plot' && <Modal title="Add plot" onClose={() => setModal(null)}><form className="f" onSubmit={guard(addPlot)}><Fields spec={SPEC.plots} units={units} /><Actions onCancel={() => setModal(null)} busy={busy} label="Save plot" /></form></Modal>}
      {modal?.k === 'customer' && <Modal title="Add customer" onClose={() => setModal(null)}><form className="f" onSubmit={guard(addCustomer)}><Fields spec={SPEC.customers} /><div className="w m">Each person is added once. You can assign as many plots as they buy on the next screen.</div><Actions onCancel={() => setModal(null)} busy={busy} label="Save customer" /></form></Modal>}
      {modal?.k === 'edit' && <Modal title={`Edit ${modal.t === 'purchases' ? 'payment terms' : modal.t.slice(0, -1)}`} onClose={() => setModal(null)}><form className="f" onSubmit={guard(saveEdit)}><Fields spec={SPEC[modal.t]} row={modal.row} units={units} /><Actions onCancel={() => setModal(null)} busy={busy} label="Save changes" /></form></Modal>}
      {modal?.k === 'assign' && <Modal title={`Assign plot to ${custName(modal.cid)}`} onClose={() => setModal(null)}>{plots.every((p) => ownerOf(p.id)) ? <p className="empty">Every plot is already assigned. Add a new plot first.</p> : (
        <form className="f" onSubmit={guard(assign)}>
          <label className="w">Plot<select name="plot_id" required value={cp.plot} onChange={(e) => setCp({ ...cp, plot: e.target.value, price: plots.find((p) => p.id === e.target.value)?.price ?? '' })}><option value="">Choose a plot</option>{plots.filter((p) => !ownerOf(p.id)).map((p) => <option key={p.id} value={p.id}>{p.number} ({p.size})</option>)}</select></label>
          <label>Agreed price (₨)<input name="total_price" type="number" min="1" required value={cp.price} onChange={(e) => setCp({ ...cp, price: e.target.value })} /></label>
          <label>Months<select name="months" value={cp.months} onChange={(e) => setCp({ ...cp, months: e.target.value })}>{[12, 18, 24, 36, 48, 60].map((x) => <option key={x}>{x}</option>)}</select></label>
          <label className="w">Buying date (first installment)<input name="start_date" type="date" required defaultValue={today()} /></label>
          {cp.price && <div className="w m">Monthly installment: <b style={{ color: 'var(--gr)' }}>{rs(+cp.price / +cp.months)}</b> for {cp.months} months</div>}
          <Actions onCancel={() => setModal(null)} busy={busy} label="Assign plot" /></form>)}</Modal>}
      {modal?.k === 'pay' && <Modal title="Record payment" onClose={() => setModal(null)}><form className="f" onSubmit={guard(pay)}>
        <label className="w">Customer and plot<select name="purchase_id" required value={pp.pid} onChange={(e) => { const p = ofPurchase(e.target.value); setPp({ pid: e.target.value, amount: p ? Math.min(monthly(p), p.total_price - paidBy(p.id)) : '' }); }}><option value="">Choose…</option>{purchases.filter((p) => p.total_price - paidBy(p.id) > 0).map((p) => <option key={p.id} value={p.id}>{pLabel(p)} (owes {rs(p.total_price - paidBy(p.id))})</option>)}</select></label>
        <label>Amount (₨)<input name="amount" type="number" min="1" required value={pp.amount} onChange={(e) => setPp({ ...pp, amount: e.target.value })} /></label>
        <label>Date<input name="paid_on" type="date" required defaultValue={today()} /></label>
        <label>Method<select name="method">{['Cash', 'Bank transfer', 'Cheque', 'EasyPaisa', 'JazzCash'].map((x) => <option key={x}>{x}</option>)}</select></label>
        <label>Note (optional)<input name="note" /></label>
        <Actions onCancel={() => setModal(null)} busy={busy} label="Save payment" /></form></Modal>}
      {modal?.k === 'transfer' && <Modal title={`Transfer plot ${plotNo(modal.p.plot_id)}`} onClose={() => setModal(null)}><form className="f" onSubmit={guard(transfer)}>
        <div className="w m">Current owner: <b>{custName(modal.p.customer_id)}</b>. The payment plan and all payments made so far stay with the plot.</div>
        <label className="w">New owner<select name="to" required><option value="">Choose a customer</option>{customers.filter((x) => x.id !== modal.p.customer_id).map((x) => <option key={x.id} value={x.id}>{x.name} ({x.phone})</option>)}</select></label>
        <label>Transfer date<input name="date" type="date" required defaultValue={today()} /></label>
        <label>Transfer fee (₨)<input name="fee" type="number" min="0" defaultValue="0" /></label>
        <label className="w">Note (optional)<input name="note" /></label>
        <Actions onCancel={() => setModal(null)} busy={busy} label="Transfer ownership" /></form></Modal>}
    </div>
  );
}

export default function Page() {
  const [session, setSession] = useState(undefined);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  if (session === undefined) return null;
  return session ? <Ledger user={session.user} /> : <Auth />;
}
