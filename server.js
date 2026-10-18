require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// ------------------------------------------------------------------ ENV
const {
  SUPABASE_URL, SUPABASE_SERVICE_KEY, JWT_SECRET, BREVO_API_KEY,
  BREVO_SENDER_EMAIL, BREVO_SENDER_NAME = 'आज की धार', ADMIN_EMAIL = '',
  CRON_SECRET, NODE_ENV, PORT = 3000
} = process.env;
const PROD = NODE_ENV === 'production';
for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'JWT_SECRET']) {
  if (!process.env[k]) { console.error(`❌ ENV missing: ${k}`); process.exit(1); }
}
if (JWT_SECRET.length < 24) { console.error('❌ JWT_SECRET कम से कम 24 अक्षर का रखें'); process.exit(1); }
const ADMINS = ADMIN_EMAIL.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

// ------------------------------------------------------------------ HELPERS
class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const bad = (msg, code = 400) => { throw new HttpError(code, msg); };
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const dbq = async p => { const { data, error } = await p; if (error) throw new Error(error.message); return data; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const money = n => Math.round(num(n) * 100) / 100;
const sha = s => crypto.createHash('sha256').update(s + JWT_SECRET).digest('hex');
const isEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 120;

const TZ = 'Asia/Kolkata';
function istParts(d = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const p = Object.fromEntries(f.formatToParts(d).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: +p.hour % 24, minute: +p.minute };
}
const addDays = (ds, n) => { const d = new Date(ds + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const wkIdx = ds => (new Date(ds + 'T00:00:00Z').getUTCDay() + 6) % 7; // सोम=0 ... रवि=6
const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

// settings cache
let _cfg = null, _cfgAt = 0;
async function getSettings(force) {
  if (!force && _cfg && Date.now() - _cfgAt < 20000) return _cfg;
  const rows = await dbq(sb.from('settings').select('*'));
  _cfg = Object.fromEntries(rows.map(r => [r.key, r.value]));
  _cfgAt = Date.now();
  return _cfg;
}
// एडमिन/राइडर के लिए डिफ़ॉल्ट तारीख़: जिस सबसे आगे की तारीख़ के ऑर्डर बन चुके हैं (आज या कल); वरना कल
async function staffDate() {
  const today = istParts().date;
  const r = await dbq(sb.from('orders').select('delivery_date').neq('status', 'cancelled').gte('delivery_date', today).order('delivery_date', { ascending: false }).limit(1));
  return r.length ? r[0].delivery_date : addDays(today, 1);
}
async function cutoffInfo() {
  const cfg = await getSettings();
  const [ch, cm] = String((cfg.delivery || {}).cutoff || '23:59').split(':').map(Number);
  const now = istParts();
  const past = now.hour * 60 + now.minute >= (ch || 23) * 60 + (cm ?? 59);
  return { now, past, nextDate: addDays(now.date, past ? 2 : 1) };
}

// ------------------------------------------------------------------ MAIL (Brevo)
async function sendMail(to, subject, html) {
  if (!BREVO_API_KEY || !BREVO_SENDER_EMAIL) {
    console.log(`[MAIL-DEV] to=${to} | ${subject}\n${html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}`);
    return false;
  }
  try {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: { name: BREVO_SENDER_NAME, email: BREVO_SENDER_EMAIL }, to: [{ email: to }], subject, htmlContent: html })
    });
    if (!r.ok) console.error('Brevo error', r.status, await r.text());
    return r.ok;
  } catch (e) { console.error('Brevo fail', e.message); return false; }
}
const mailWrap = (title, body) => `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden"><div style="background:#0d5c3a;color:#fff;padding:14px 18px;font-weight:bold">🥛 आज की धार</div><div style="padding:18px"><h3 style="margin:0 0 10px">${esc(title)}</h3>${body}</div></div>`;
const notifyAdmins = (subject, html) => Promise.all(ADMINS.map(a => sendMail(a, subject, mailWrap(subject, html))));

// ------------------------------------------------------------------ USERS / AUTH
const COOKIE = 'akd_sid';
function readCookie(req, name) {
  const m = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}
const isVip = u => !!u.is_vip && (!u.vip_until || u.vip_until >= istParts().date);
const pubUser = u => ({
  id: u.id, email: u.email, name: u.name, phone: u.phone, role: u.role, society_id: u.society_id, flat: u.flat,
  deliv_pref: u.deliv_pref, pay_pref: u.pay_pref, is_vip: isVip(u), vip_until: u.vip_until,
  wallet_main: num(u.wallet_main), wallet_cb: num(u.wallet_cb), vacation: u.vacation, ref_code: u.ref_code,
  vac_from: u.vac_from || null, vac_to: u.vac_to || null, call_before: !!u.call_before, door_note: u.door_note || ''
});
// इस डिलीवरी तारीख़ पर छुट्टी है? (हमेशा के लिए पॉज़ या तारीख़ों की रेंज)
const onVacation = (u, D) => !!u.vacation || !!(u.vac_from && u.vac_to && D >= u.vac_from && D <= u.vac_to);
const newRefCode = () => crypto.randomBytes(4).toString('hex').toUpperCase();

async function auth(req, res, next) {
  try {
    const tok = readCookie(req, COOKIE);
    if (!tok) throw new HttpError(401, 'लॉगिन करें');
    let p; try { p = jwt.verify(tok, JWT_SECRET); } catch { throw new HttpError(401, 'सेशन ख़त्म, दोबारा लॉगिन करें'); }
    const u = await dbq(sb.from('users').select('*').eq('id', p.uid).maybeSingle());
    if (!u) throw new HttpError(401, 'अकाउंट नहीं मिला');
    if (u.blocked) throw new HttpError(403, 'आपका अकाउंट बंद है, सपोर्ट से संपर्क करें');
    req.user = u; next();
  } catch (e) { next(e); }
}
const needRole = (...roles) => (req, res, next) => roles.includes(req.user.role) ? next() : next(new HttpError(403, 'अनुमति नहीं है'));

// ------------------------------------------------------------------ APP
const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '6mb' }));
app.use('/api', rateLimit({ windowMs: 60000, limit: 240, standardHeaders: true, legacyHeaders: false }));
const authLimiter = rateLimit({ windowMs: 15 * 60000, limit: 12, standardHeaders: true, legacyHeaders: false, message: { error: 'बहुत ज़्यादा कोशिशें, 15 मिनट बाद दोबारा करें' } });
app.get('/healthz', (_, res) => res.send('ok'));

// ---------- public config
app.get('/api/config', wrap(async (req, res) => {
  const cfg = await getSettings();
  const [societies, categories, products, banners, coupons] = await Promise.all([
    dbq(sb.from('societies').select('id,name').eq('active', true).order('name')),
    dbq(sb.from('categories').select('id,name,img').eq('active', true).order('sort')),
    dbq(sb.from('products').select('*').eq('active', true).order('sort').order('id')),
    dbq(sb.from('banners').select('*').eq('active', true).order('sort')),
    dbq(sb.from('coupons').select('code,min_amount,bonus,descr,valid_till').eq('active', true))
  ]);
  const pay = cfg.payments || {};
  const ci = await cutoffInfo();
  res.json({
    shop: cfg.shop, delivery: cfg.delivery, vip_plans: cfg.vip_plans, faq: cfg.faq, policies: cfg.policies, theme: cfg.theme, referral: cfg.referral,
    payments: { wallet: pay.wallet !== false, upi: !!pay.upi, cod: !!pay.cod, upi_id: pay.upi_id, merchant_name: pay.merchant_name, qr_url: pay.qr_url },
    societies, categories, banners, coupons: coupons.filter(c => !c.valid_till || c.valid_till >= ci.now.date), next_date: ci.nextDate, today: ci.now.date,
    products: products.map(p => ({ id: p.id, name: p.name, cat: p.cat, unit: p.unit, vipPrice: num(p.vip_price), price: num(p.price), mrp: num(p.mrp), stock: p.in_stock && p.stock_qty > 0, tag: p.tag, subInfo: p.sub_info, desc: p.descr, nutri: p.nutri, shelf: p.shelf, images: p.images || [] }))
  });
}));

// ---------- AUTH (ईमेल OTP)
app.post('/api/auth/request', authLimiter, wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!isEmail(email)) bad('सही ईमेल लिखें');
  const old = await dbq(sb.from('otps').select('*').eq('email', email).maybeSingle());
  if (old && Date.now() - new Date(old.last_sent).getTime() < 45000) bad('45 सेकंड बाद दोबारा OTP माँगें', 429);
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  await dbq(sb.from('otps').upsert({ email, code_hash: sha(email + code), expires_at: new Date(Date.now() + 10 * 60000).toISOString(), attempts: 0, last_sent: new Date().toISOString() }));
  const sent = await sendMail(email, `आपका लॉगिन OTP: ${code}`, mailWrap('लॉगिन OTP', `<p style="font-size:28px;letter-spacing:6px;font-weight:bold">${code}</p><p>यह कोड 10 मिनट तक मान्य है। किसी से साझा न करें।</p>`));
  if (!sent && PROD) bad('ईमेल नहीं भेजा जा सका, थोड़ी देर बाद कोशिश करें', 502);
  res.json({ ok: true, dev: !sent && !PROD ? 'OTP सर्वर कंसोल में छपा है (Brevo key नहीं है)' : undefined });
}));

app.post('/api/auth/verify', authLimiter, wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const code = String(req.body.code || '').trim();
  if (!isEmail(email) || !/^\d{6}$/.test(code)) bad('सही ईमेल और 6 अंकों का OTP डालें');
  const o = await dbq(sb.from('otps').select('*').eq('email', email).maybeSingle());
  if (!o || new Date(o.expires_at) < new Date()) bad('OTP ख़त्म हो गया, नया माँगें');
  if (o.attempts >= 5) bad('बहुत गलत कोशिशें, नया OTP माँगें', 429);
  if (o.code_hash !== sha(email + code)) {
    await dbq(sb.from('otps').update({ attempts: o.attempts + 1 }).eq('email', email));
    bad('गलत OTP');
  }
  await dbq(sb.from('otps').delete().eq('email', email));
  let u = await dbq(sb.from('users').select('*').eq('email', email).maybeSingle());
  const cfg = await getSettings();
  if (!u) {
    let referred_by = null;
    const rc = String(req.body.ref || '').trim().toUpperCase();
    if (rc && (cfg.referral || {}).enabled) {
      const r = await dbq(sb.from('users').select('id').eq('ref_code', rc).maybeSingle());
      if (r) referred_by = r.id;
    }
    const name = String(req.body.name || '').trim().slice(0, 60);
    const phone = String(req.body.phone || '').replace(/\D/g, '').slice(-10);
    u = await dbq(sb.from('users').insert({ email, name, phone, role: ADMINS.includes(email) ? 'admin' : 'customer', ref_code: newRefCode(), referred_by }).select().single());
  } else if (ADMINS.includes(email) && u.role !== 'admin') {
    u = await dbq(sb.from('users').update({ role: 'admin' }).eq('id', u.id).select().single());
  }
  if (u.blocked) bad('आपका अकाउंट बंद है', 403);
  const tok = jwt.sign({ uid: u.id }, JWT_SECRET, { expiresIn: '60d' });
  res.cookie(COOKIE, tok, { httpOnly: true, sameSite: 'lax', secure: PROD, maxAge: 60 * 86400000, path: '/' });
  res.json({ ok: true, user: pubUser(u), isNew: !u.name });
}));
app.post('/api/auth/logout', (req, res) => { res.clearCookie(COOKIE, { path: '/' }); res.json({ ok: true }); });

// ------------------------------------------------------------------ BAG ENGINE
async function loadProdMap() {
  const rows = await dbq(sb.from('products').select('*').eq('active', true));
  return Object.fromEntries(rows.map(p => [p.id, p]));
}
function buildLines(user, D, subs, cart, prodMap, withCart) {
  const wk = wkIdx(D), vip = isVip(user), map = {};
  subs.filter(s => s.active && (s.days || []).includes(wk)).forEach(s => { map[s.product_id] = { pid: s.product_id, sq: s.qty, oq: 0 }; });
  if (withCart) cart.filter(c => c.delivery_date === D).forEach(c => {
    if (!map[c.product_id]) map[c.product_id] = { pid: c.product_id, sq: 0, oq: c.qty }; else map[c.product_id].oq += c.qty;
  });
  return Object.values(map).map(x => {
    const p = prodMap[x.pid];
    if (!p || !p.in_stock || p.stock_qty <= 0) return null;
    const qty = x.sq + x.oq, rate = vip ? num(p.vip_price) : num(p.price);
    return { ...x, product: p, qty, rate, mrp: num(p.mrp), tot: money(qty * rate), mrpTot: money(qty * num(p.mrp)) };
  }).filter(Boolean);
}
function calcFee(user, subtotal, dcfg) {
  const fee = num((dcfg || {}).fee), free = num((dcfg || {}).free_above);
  if (!fee || isVip(user)) return 0;
  return free > 0 && subtotal >= free ? 0 : fee;
}
const lineOut = l => ({ pid: l.pid, name: l.product.name, unit: l.product.unit, img: (l.product.images || [])[0] || '', sq: l.sq, oq: l.oq, qty: l.qty, rate: l.rate, mrp: l.mrp, tot: l.tot });

// ------------------------------------------------------------------ CUSTOMER
const orderSelect = '*, order_items(*)';
app.get('/api/me', auth, wrap(async (req, res) => {
  const u = req.user;
  const [subs, cart, txns, orders, topups, refunds, tickets] = await Promise.all([
    dbq(sb.from('subscriptions').select('*').eq('user_id', u.id).order('id')),
    dbq(sb.from('cart_items').select('*').eq('user_id', u.id)),
    dbq(sb.from('wallet_txns').select('*').eq('user_id', u.id).order('id', { ascending: false }).limit(40)),
    dbq(sb.from('orders').select(orderSelect).eq('user_id', u.id).order('delivery_date', { ascending: false }).limit(40)),
    dbq(sb.from('topups').select('*').eq('user_id', u.id).order('id', { ascending: false }).limit(20)),
    dbq(sb.from('refund_requests').select('*').eq('user_id', u.id).order('id', { ascending: false }).limit(20)),
    dbq(sb.from('support_tickets').select('*').eq('user_id', u.id).order('id', { ascending: false }).limit(20))
  ]);
  res.json({ user: pubUser(u), subs, cart, txns, orders, topups, refunds, tickets });
}));

// रेफ़रल की प्रोग्रेस और कुल बचत
app.get('/api/me/stats', auth, wrap(async (req, res) => {
  const [refs, bonus, orders] = await Promise.all([
    dbq(sb.from('users').select('id').eq('referred_by', req.user.id)),
    dbq(sb.from('wallet_txns').select('amount').eq('user_id', req.user.id).eq('title', 'रेफ़रल बोनस')),
    dbq(sb.from('orders').select('mrp_total,subtotal').eq('user_id', req.user.id).neq('status', 'cancelled'))
  ]);
  const earned = money(bonus.reduce((a, t) => a + num(t.amount), 0));
  res.json({
    referrals: { total: refs.length, successful: Math.min(bonus.length, refs.length), pending: Math.max(0, refs.length - bonus.length), earned },
    saved: money(orders.reduce((a, o) => a + Math.max(0, num(o.mrp_total) - num(o.subtotal)), 0))
  });
}));

app.put('/api/me', auth, wrap(async (req, res) => {
  const b = req.body, patch = {};
  if (b.name !== undefined) patch.name = String(b.name).trim().slice(0, 60);
  if (b.phone !== undefined) { const ph = String(b.phone).replace(/\D/g, '').slice(-10); if (ph && ph.length !== 10) bad('10 अंकों का मोबाइल नंबर डालें'); patch.phone = ph; }
  if (b.society_id !== undefined) patch.society_id = b.society_id ? +b.society_id : null;
  if (b.flat !== undefined) patch.flat = String(b.flat).trim().slice(0, 60);
  if (b.deliv_pref !== undefined) patch.deliv_pref = String(b.deliv_pref).slice(0, 120);
  if (b.vacation !== undefined) patch.vacation = !!b.vacation;
  if (b.vac_from !== undefined || b.vac_to !== undefined) {
    if (!b.vac_from && !b.vac_to) { patch.vac_from = null; patch.vac_to = null; }
    else {
      if (!validDate(b.vac_from) || !validDate(b.vac_to)) bad('छुट्टी की दोनों तारीख़ें सही चुनें');
      if (b.vac_to < b.vac_from) bad('"तक" की तारीख़ "से" से पहले नहीं हो सकती');
      if (b.vac_to > addDays(istParts().date, 180)) bad('छुट्टी 6 महीने से ज़्यादा आगे की नहीं रख सकते');
      patch.vac_from = b.vac_from; patch.vac_to = b.vac_to;
    }
  }
  if (b.call_before !== undefined) patch.call_before = !!b.call_before;
  if (b.door_note !== undefined) patch.door_note = String(b.door_note).trim().slice(0, 160);
  if (b.pay_pref !== undefined) {
    const pay = (await getSettings()).payments || {};
    if (!['wallet', 'upi', 'cod'].includes(b.pay_pref) || pay[b.pay_pref] === false || (b.pay_pref !== 'wallet' && !pay[b.pay_pref])) bad('यह पेमेंट तरीका अभी बंद है');
    patch.pay_pref = b.pay_pref;
  }
  const u = await dbq(sb.from('users').update(patch).eq('id', req.user.id).select().single());
  res.json({ user: pubUser(u) });
}));

app.put('/api/cart', auth, wrap(async (req, res) => {
  const pid = +req.body.product_id, qty = Math.max(0, Math.min(50, Math.floor(num(req.body.qty))));
  const p = await dbq(sb.from('products').select('id,in_stock,stock_qty,active').eq('id', pid).maybeSingle());
  if (!p || !p.active) bad('प्रोडक्ट नहीं मिला', 404);
  const D = (await cutoffInfo()).nextDate;
  if (qty === 0) await dbq(sb.from('cart_items').delete().eq('user_id', req.user.id).eq('product_id', pid).eq('delivery_date', D));
  else {
    if (!p.in_stock || p.stock_qty <= 0) bad('यह प्रोडक्ट अभी स्टॉक में नहीं है');
    await dbq(sb.from('cart_items').upsert({ user_id: req.user.id, product_id: pid, qty, delivery_date: D }, { onConflict: 'user_id,product_id,delivery_date' }));
  }
  res.json({ ok: true, delivery_date: D });
}));

app.get('/api/bag', auth, wrap(async (req, res) => {
  const ci = await cutoffInfo();
  const D = validDate(req.query.date) ? req.query.date : ci.nextDate;
  const cfg = await getSettings();
  const existing = await dbq(sb.from('orders').select(orderSelect).eq('user_id', req.user.id).eq('delivery_date', D).maybeSingle());
  if (existing) return res.json({ date: D, locked: true, order: existing });
  if (onVacation(req.user, D)) return res.json({ date: D, vacation: true, lines: [], subtotal: 0, mrp: 0, fee: 0, total: 0 });
  const [subs, cart, pm] = await Promise.all([
    dbq(sb.from('subscriptions').select('*').eq('user_id', req.user.id)),
    dbq(sb.from('cart_items').select('*').eq('user_id', req.user.id)),
    loadProdMap()
  ]);
  const lines = buildLines(req.user, D, subs, cart, pm, D === ci.nextDate);
  const subtotal = money(lines.reduce((a, l) => a + l.tot, 0)), mrp = money(lines.reduce((a, l) => a + l.mrpTot, 0));
  const fee = lines.length ? calcFee(req.user, subtotal, cfg.delivery) : 0;
  res.json({ date: D, lines: lines.map(lineOut), subtotal, mrp, fee, total: money(subtotal + fee) });
}));

app.put('/api/subs', auth, wrap(async (req, res) => {
  const pid = +req.body.product_id;
  const days = [...new Set((req.body.days || []).map(Number).filter(d => d >= 0 && d <= 6))];
  if (!days.length) bad('कम से कम एक दिन चुनें');
  const p = await dbq(sb.from('products').select('id,active').eq('id', pid).maybeSingle());
  if (!p || !p.active) bad('प्रोडक्ट नहीं मिला', 404);
  const row = { user_id: req.user.id, product_id: pid, qty: Math.max(1, Math.min(20, Math.floor(num(req.body.qty, 1)))), pattern: String(req.body.pattern || '').slice(0, 40), days, active: req.body.active !== false };
  await dbq(sb.from('subscriptions').upsert(row, { onConflict: 'user_id,product_id' }));
  res.json({ ok: true });
}));
app.patch('/api/subs/:id', auth, wrap(async (req, res) => {
  await dbq(sb.from('subscriptions').update({ active: !!req.body.active }).eq('id', +req.params.id).eq('user_id', req.user.id));
  res.json({ ok: true });
}));
app.delete('/api/subs/:id', auth, wrap(async (req, res) => {
  await dbq(sb.from('subscriptions').delete().eq('id', +req.params.id).eq('user_id', req.user.id));
  res.json({ ok: true });
}));

app.post('/api/vip/buy', auth, wrap(async (req, res) => {
  const plans = (await getSettings()).vip_plans || [];
  const plan = plans.find(p => p.days === +req.body.days);
  if (!plan) bad('प्लान नहीं मिला');
  const u = req.user;
  if (num(u.wallet_main) + num(u.wallet_cb) < plan.price) bad(`वॉलेट में ₹${plan.price} चाहिए, पहले रिचार्ज करें`);
  const useCb = Math.min(num(u.wallet_cb), plan.price), useMain = money(plan.price - useCb);
  try { await dbq(sb.rpc('wallet_apply', { p_user: u.id, p_main: -useMain, p_cb: -useCb, p_title: `VIP ${plan.label}`, p_ref: 'vip' })); }
  catch { bad('बैलेंस कम है'); }
  const today = istParts().date;
  const base = isVip(u) && u.vip_until ? u.vip_until : today;
  const until = addDays(base, plan.days);
  const nu = await dbq(sb.from('users').update({ is_vip: true, vip_until: until }).eq('id', u.id).select().single());
  res.json({ user: pubUser(nu) });
}));

// ---------- वॉलेट रिचार्ज (UPI + UTR → एडमिन वेरिफाई)
app.post('/api/topup', auth, wrap(async (req, res) => {
  const pay = (await getSettings()).payments || {};
  if (!pay.upi) bad('UPI रिचार्ज अभी बंद है');
  const amount = money(req.body.amount), utr = String(req.body.utr || '').trim().toUpperCase();
  if (amount < 10 || amount > 50000) bad('रकम ₹10 से ₹50,000 के बीच हो');
  if (!/^[A-Z0-9]{10,24}$/.test(utr)) bad('सही UTR / ट्रांज़ैक्शन ID डालें (12 अंक आमतौर पर)');
  let bonus = 0, code = String(req.body.coupon_code || '').trim().toUpperCase();
  if (code) {
    const c = await dbq(sb.from('coupons').select('*').eq('code', code).eq('active', true).maybeSingle());
    if (!c || (c.valid_till && c.valid_till < istParts().date)) bad('कूपन सही नहीं है या उसकी तारीख़ निकल चुकी है');
    if (amount < num(c.min_amount)) bad(`इस कूपन के लिए कम से कम ₹${c.min_amount} रिचार्ज करें`);
    const used = await dbq(sb.from('topups').select('id').eq('user_id', req.user.id).eq('coupon_code', code).neq('status', 'rejected').limit(1));
    if (used.length) bad('यह कूपन आप पहले इस्तेमाल कर चुके हैं');
    bonus = num(c.bonus);
  }
  const dup = await dbq(sb.from('orders').select('id').eq('utr', utr).limit(1));
  if (dup.length) bad('यह UTR पहले इस्तेमाल हो चुका है');
  const { error } = await sb.from('topups').insert({ user_id: req.user.id, amount, coupon_code: code, bonus, utr });
  if (error) bad(error.code === '23505' ? 'यह UTR पहले इस्तेमाल हो चुका है' : error.message);
  notifyAdmins('नया वॉलेट रिचार्ज वेरिफाई करें', `<p>${esc(req.user.name || req.user.email)} ने ₹${amount} भेजे। UTR: <b>${esc(utr)}</b></p><p>एडमिन पैनल → रिचार्ज में जाकर अप्रूव करें।</p>`);
  res.json({ ok: true, message: 'UTR जमा हो गया। एडमिन वेरिफाई करते ही बैलेंस जुड़ जाएगा।' });
}));

app.post('/api/orders/:id/utr', auth, wrap(async (req, res) => {
  const utr = String(req.body.utr || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{10,24}$/.test(utr)) bad('सही UTR डालें');
  const o = await dbq(sb.from('orders').select('*').eq('id', +req.params.id).eq('user_id', req.user.id).maybeSingle());
  if (!o) bad('ऑर्डर नहीं मिला', 404);
  if (o.pay_method !== 'upi' || o.pay_status === 'paid') bad('इस ऑर्डर पर UTR की ज़रूरत नहीं');
  const dup = await dbq(sb.from('topups').select('id').eq('utr', utr).limit(1));
  const dup2 = await dbq(sb.from('orders').select('id').eq('utr', utr).neq('id', o.id).limit(1));
  if (dup.length || dup2.length) bad('यह UTR पहले इस्तेमाल हो चुका है');
  await dbq(sb.from('orders').update({ utr, pay_status: 'verify' }).eq('id', o.id));
  notifyAdmins('ऑर्डर पेमेंट वेरिफाई करें', `<p>ऑर्डर ${esc(o.order_no)} (₹${o.total}) — UTR: <b>${esc(utr)}</b></p>`);
  res.json({ ok: true });
}));

app.get('/api/orders/:id', auth, wrap(async (req, res) => {
  const o = await dbq(sb.from('orders').select(orderSelect).eq('id', +req.params.id).maybeSingle());
  if (!o || (o.user_id !== req.user.id && !['admin', 'rider'].includes(req.user.role))) bad('ऑर्डर नहीं मिला', 404);
  res.json({ order: o, shop: (await getSettings()).shop });
}));

app.post('/api/refunds', auth, wrap(async (req, res) => {
  const reason = String(req.body.reason || '').trim().slice(0, 300);
  if (reason.length < 3) bad('कारण लिखें');
  let amount = money(req.body.amount);
  const oid = req.body.order_id ? +req.body.order_id : null;
  if (oid) {
    const o = await dbq(sb.from('orders').select('id,total').eq('id', oid).eq('user_id', req.user.id).maybeSingle());
    if (!o) bad('ऑर्डर नहीं मिला', 404);
    amount = Math.min(amount || num(o.total), num(o.total));
    const open = await dbq(sb.from('refund_requests').select('id').eq('order_id', oid).eq('status', 'pending').limit(1));
    if (open.length) bad('इस ऑर्डर की रिफंड रिक्वेस्ट पहले से खुली है');
  }
  if (amount <= 0) bad('रिफंड रकम डालें');
  await dbq(sb.from('refund_requests').insert({ user_id: req.user.id, order_id: oid, reason, amount }));
  notifyAdmins('नई रिफंड रिक्वेस्ट', `<p>${esc(req.user.name || req.user.email)} — ₹${amount}</p><p>${esc(reason)}</p>`);
  res.json({ ok: true });
}));

app.post('/api/support', auth, wrap(async (req, res) => {
  const subject = String(req.body.subject || '').trim().slice(0, 100), message = String(req.body.message || '').trim().slice(0, 1000);
  if (!subject || !message) bad('विषय और संदेश दोनों लिखें');
  await dbq(sb.from('support_tickets').insert({ user_id: req.user.id, subject, message }));
  notifyAdmins('नया सपोर्ट टिकट', `<p><b>${esc(subject)}</b></p><p>${esc(message)}</p><p>${esc(req.user.name)} • ${esc(req.user.phone)} • ${esc(req.user.email)}</p>`);
  res.json({ ok: true });
}));

// ------------------------------------------------------------------ ORDER ENGINE
async function restoreOrderStock(orderId) {
  const items = await dbq(sb.from('order_items').select('product_id,qty').eq('order_id', orderId));
  for (const it of items) if (it.product_id) {
    const p = await dbq(sb.from('products').select('stock_qty').eq('id', it.product_id).maybeSingle());
    if (p) await dbq(sb.from('products').update({ stock_qty: p.stock_qty + it.qty }).eq('id', it.product_id));
  }
}

async function payFromWallet(order) {
  const u = await dbq(sb.from('users').select('wallet_main,wallet_cb').eq('id', order.user_id).single());
  const total = num(order.total), cb = Math.min(num(u.wallet_cb), total), main = money(total - cb);
  if (num(u.wallet_main) < main) return false;
  try {
    await dbq(sb.rpc('wallet_apply', { p_user: order.user_id, p_main: -main, p_cb: -cb, p_title: `ऑर्डर ${order.order_no} (${order.delivery_date})`, p_ref: order.order_no }));
  } catch { return false; }
  await dbq(sb.from('orders').update({ pay_status: 'paid', status: 'placed', cb_used: cb, main_used: main }).eq('id', order.id));
  return true;
}

// ऑन-होल्ड ऑर्डरों को रिचार्ज के बाद दोबारा चुकाने की कोशिश
async function retryHeldOrders(userId) {
  const today = istParts().date;
  const held = await dbq(sb.from('orders').select('*').eq('user_id', userId).eq('status', 'on_hold').gte('delivery_date', today).order('delivery_date'));
  for (const o of held) if (!(await payFromWallet(o))) break;
}

async function generateOrdersForDate(D) {
  const cfg = await getSettings();
  const pay = cfg.payments || {}, dcfg = cfg.delivery || {}, lowBal = num((cfg.alerts || {}).low_balance, 100);
  const pm = await loadProdMap();
  const users = await dbq(sb.from('users').select('*').eq('role', 'customer').eq('blocked', false));
  const stats = { created: 0, paid: 0, held: 0, cod: 0, upi: 0, revenue: 0, skipped: 0 };
  for (const u of users) {
    try {
      if (onVacation(u, D)) { stats.vacation = (stats.vacation || 0) + 1; continue; }
      const have = await dbq(sb.from('orders').select('id').eq('user_id', u.id).eq('delivery_date', D).maybeSingle());
      if (have) { stats.skipped++; continue; }
      const [subs, cart] = await Promise.all([
        dbq(sb.from('subscriptions').select('*').eq('user_id', u.id)),
        dbq(sb.from('cart_items').select('*').eq('user_id', u.id).eq('delivery_date', D))
      ]);
      let lines = buildLines(u, D, subs, cart, pm, true);
      // स्टॉक सीमा
      lines = lines.map(l => { const p = pm[l.pid]; const q = Math.min(l.qty, p.stock_qty); if (q <= 0) return null; if (q < l.qty) { const cut = l.qty - q; l.oq = Math.max(0, l.oq - cut); l.sq = q - l.oq; l.qty = q; l.tot = money(q * l.rate); l.mrpTot = money(q * l.mrp); } p.stock_qty -= q; return l; }).filter(Boolean);
      if (!lines.length) continue;
      const subtotal = money(lines.reduce((a, l) => a + l.tot, 0)), mrpTot = money(lines.reduce((a, l) => a + l.mrpTot, 0));
      const fee = calcFee(u, subtotal, dcfg), total = money(subtotal + fee);
      let method = u.pay_pref;
      if (method !== 'wallet' && !pay[method]) method = 'wallet';
      const soc = u.society_id ? await dbq(sb.from('societies').select('name').eq('id', u.society_id).maybeSingle()) : null;
      const order_no = `AKD-${D.replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const order = await dbq(sb.from('orders').insert({
        order_no, user_id: u.id, delivery_date: D, status: 'placed', pay_method: method, pay_status: 'pending',
        subtotal, mrp_total: mrpTot, fee, total, society_name: soc ? soc.name : '', flat: u.flat, deliv_pref: [u.deliv_pref, u.call_before ? '📞 पहुँचने से पहले कॉल करें' : '', u.door_note ? '📝 ' + u.door_note : ''].filter(Boolean).join(' • '),
        customer_name: u.name, customer_phone: u.phone
      }).select().single());
      await dbq(sb.from('order_items').insert(lines.map(l => ({ order_id: order.id, product_id: l.pid, name: l.product.name, unit: l.product.unit, qty: l.qty, rate: l.rate, mrp: l.mrp, from_sub: l.sq, from_once: l.oq }))));
      for (const l of lines) await dbq(sb.from('products').update({ stock_qty: pm[l.pid].stock_qty }).eq('id', l.pid));
      await dbq(sb.from('cart_items').delete().eq('user_id', u.id).eq('delivery_date', D));
      stats.created++; stats.revenue += total;
      if (method === 'wallet') {
        if (await payFromWallet(order)) {
          stats.paid++;
          const left = await dbq(sb.from('users').select('wallet_main,wallet_cb').eq('id', u.id).single());
          const bal = num(left.wallet_main) + num(left.wallet_cb);
          if (bal < lowBal) sendMail(u.email, 'वॉलेट बैलेंस कम है', mailWrap('बैलेंस कम है', `<p>आपके वॉलेट में सिर्फ़ <b>₹${bal}</b> बचे हैं। डिलीवरी न रुके इसलिए रिचार्ज कर लें।</p>`));
        } else {
          await dbq(sb.from('orders').update({ status: 'on_hold' }).eq('id', order.id));
          stats.held++;
          sendMail(u.email, 'ऑर्डर होल्ड पर — वॉलेट रिचार्ज करें', mailWrap('ऑर्डर होल्ड पर है', `<p>कल सुबह के ऑर्डर (₹${total}) के लिए वॉलेट में बैलेंस कम है। सुबह से पहले रिचार्ज करें, ऑर्डर अपने-आप चालू हो जाएगा।</p>`));
        }
      } else stats[method]++;
    } catch (e) { console.error('order gen failed for', u.email, e.message); }
  }
  return stats;
}

async function runNightlyJob(D, manual) {
  if (manual) { const stats = await generateOrdersForDate(D); return { date: D, manual: true, ...stats }; } // एडमिन के हाथ से चलाने पर नाइट-जॉब का रिकॉर्ड नहीं बनता, ताकि रात का जॉब बाकी ग्राहकों के लिए फिर भी चले
  const done = await dbq(sb.from('job_runs').select('job').eq('job', 'orders').eq('run_date', D).maybeSingle());
  if (done) return { skipped: true, date: D };
  const stats = await generateOrdersForDate(D);
  await dbq(sb.from('job_runs').insert({ job: 'orders', run_date: D, info: JSON.stringify(stats) }));
  notifyAdmins(`${D} की डिलीवरी — ऑटो-चेकआउट पूरा`, `<p>बने ऑर्डर: <b>${stats.created}</b></p><p>वॉलेट से पेड: ${stats.paid} • बैलेंस कम (होल्ड): ${stats.held} • COD: ${stats.cod} • UPI: ${stats.upi}</p><p>कुल बिल: ₹${money(stats.revenue)}</p>`);
  return { date: D, ...stats };
}

let tickBusy = false;
async function cronTick() {
  if (tickBusy) return; tickBusy = true;
  try {
    const ci = await cutoffInfo();
    if (ci.past) await runNightlyJob(addDays(ci.now.date, 1));
    else if (ci.now.hour < 6) await runNightlyJob(ci.now.date); // सर्वर सो गया था तो सुबह से पहले भरपाई
  } catch (e) { console.error('cron error', e.message); }
  tickBusy = false;
}
setInterval(cronTick, 60000);
// बाहर से ट्रिगर (Render फ्री प्लान सो जाता है, इसलिए cron-job.org से हर 5-10 मिनट इसे हिट करें)
app.all('/api/cron/nightly', wrap(async (req, res) => {
  if (!CRON_SECRET || (req.query.key || req.headers['x-cron-key']) !== CRON_SECRET) bad('अनुमति नहीं', 401);
  await cronTick();
  res.json({ ok: true, time: new Date().toISOString() });
}));

// ------------------------------------------------------------------ ORDER STATUS (एडमिन + राइडर)
async function setOrderStatus(id, status, actor) {
  const o = await dbq(sb.from('orders').select('*').eq('id', id).maybeSingle());
  if (!o) bad('ऑर्डर नहीं मिला', 404);
  if (!['placed', 'on_hold', 'packed', 'out_for_delivery', 'delivered', 'cancelled'].includes(status)) bad('गलत स्टेटस');
  if (o.status === 'cancelled') bad('कैंसिल ऑर्डर बदला नहीं जा सकता');
  if (o.status === 'delivered' && status !== 'cancelled') bad('डिलीवर हो चुका ऑर्डर बदला नहीं जा सकता');
  const patch = { status };
  if (status === 'delivered') { patch.delivered_at = new Date().toISOString(); if (o.pay_method === 'cod' && o.pay_status !== 'paid') patch.pay_status = 'paid'; }
  if (status === 'cancelled') {
    if (o.pay_method === 'wallet' && o.pay_status === 'paid') {
      await dbq(sb.rpc('wallet_apply', { p_user: o.user_id, p_main: num(o.main_used), p_cb: num(o.cb_used), p_title: `ऑर्डर ${o.order_no} कैंसिल — रिफंड`, p_ref: o.order_no }));
      patch.pay_status = 'refunded';
    }
    await restoreOrderStock(o.id);
  }
  await dbq(sb.from('orders').update(patch).eq('id', id));
  return true;
}

// ------------------------------------------------------------------ STAFF (राइडर + एडमिन)
const staff = [auth, needRole('admin', 'rider')];
app.get('/api/rider/orders', ...staff, wrap(async (req, res) => {
  const D = validDate(req.query.date) ? req.query.date : await staffDate();
  let q = sb.from('orders').select(orderSelect).eq('delivery_date', D).neq('status', 'cancelled').order('society_name').order('flat');
  if (req.user.role === 'rider') q = q.eq('rider_id', req.user.id);
  res.json({ date: D, orders: await dbq(q) });
}));
app.patch('/api/rider/orders/:id', ...staff, wrap(async (req, res) => {
  const id = +req.params.id;
  if (req.user.role === 'rider') {
    const o = await dbq(sb.from('orders').select('rider_id').eq('id', id).maybeSingle());
    if (!o || o.rider_id !== req.user.id) bad('यह ऑर्डर आपको असाइन नहीं है', 403);
    if (!['out_for_delivery', 'delivered'].includes(req.body.status)) bad('अनुमति नहीं');
  }
  await setOrderStatus(id, req.body.status, req.user);
  res.json({ ok: true });
}));

// ------------------------------------------------------------------ ADMIN
const admin = [auth, needRole('admin')];
const fetchAll = async build => {
  let out = [], from = 0;
  for (;;) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw new Error(error.message);
    out = out.concat(data); if (data.length < 1000) break; from += 1000;
  }
  return out;
};
const rangeQ = req => {
  const t = istParts().date;
  const from = validDate(req.query.from) ? req.query.from : addDays(t, -30), to = validDate(req.query.to) ? req.query.to : addDays(t, 1);
  return { from, to };
};

app.get('/api/admin/dashboard', ...admin, wrap(async (req, res) => {
  const ci = await cutoffInfo();
  const D = validDate(req.query.date) ? req.query.date : await staffDate();
  const cfg = await getSettings(), lowStock = num((cfg.alerts || {}).low_stock, 10), lowBal = num((cfg.alerts || {}).low_balance, 100);
  const target = addDays(ci.now.date, 1);
  const [jobRows, orders, customers, subs, products, pendTop, pendRef, openTk, verifyOrders] = await Promise.all([
    dbq(sb.from('job_runs').select('*').eq('job', 'orders').order('run_date', { ascending: false }).limit(3)),
    dbq(sb.from('orders').select('total,status,pay_method,pay_status').eq('delivery_date', D)),
    dbq(sb.from('users').select('id,name,phone,email,flat,vacation,wallet_main,wallet_cb').eq('role', 'customer')),
    dbq(sb.from('subscriptions').select('id,user_id,product_id,qty,pattern,days').eq('active', true)),
    dbq(sb.from('products').select('id,name,unit,stock_qty,in_stock').eq('active', true)),
    dbq(sb.from('topups').select('id').eq('status', 'pending')),
    dbq(sb.from('refund_requests').select('id').eq('status', 'pending')),
    dbq(sb.from('support_tickets').select('id').eq('status', 'open')),
    dbq(sb.from('orders').select('id').eq('pay_status', 'verify'))
  ]);
  const live = orders.filter(o => o.status !== 'cancelled');
  res.json({
    checkout: { cutoff: String((cfg.delivery || {}).cutoff || '23:59'), now: `${String(ci.now.hour).padStart(2, '0')}:${String(ci.now.minute).padStart(2, '0')}`, target, done: jobRows.find(j => j.run_date === target) || null, last: jobRows[0] || null },
    date: D, orders: live.length, revenue: money(live.reduce((a, o) => a + num(o.total), 0)),
    held: live.filter(o => o.status === 'on_hold').length, subs: subs.length,
    subs_list: (() => { const cm = Object.fromEntries(customers.map(c => [c.id, c])), pmap = Object.fromEntries(products.map(p => [p.id, p])); return subs.map(x => ({ name: (cm[x.user_id] || {}).name || (cm[x.user_id] || {}).email || '?', phone: (cm[x.user_id] || {}).phone || '', flat: (cm[x.user_id] || {}).flat || '', vacation: !!(cm[x.user_id] || {}).vacation, product: (pmap[x.product_id] || {}).name || '?', unit: (pmap[x.product_id] || {}).unit || '', qty: x.qty, pattern: x.pattern, days: x.days })).sort((a, b) => String(a.name).localeCompare(String(b.name))); })(), customers: customers.length,
    wallet_total: money(customers.reduce((a, c) => a + num(c.wallet_main) + num(c.wallet_cb), 0)), skus: products.length,
    pending_topups: pendTop.length, pending_refunds: pendRef.length, open_tickets: openTk.length, verify_orders: verifyOrders.length,
    low_stock: products.filter(p => p.stock_qty <= lowStock),
    low_balance: customers.filter(c => num(c.wallet_main) + num(c.wallet_cb) < lowBal).map(c => ({ id: c.id, name: c.name, phone: c.phone, email: c.email, bal: money(num(c.wallet_main) + num(c.wallet_cb)) }))
  });
}));

app.get('/api/admin/orders', ...admin, wrap(async (req, res) => {
  if (req.query.verify) return res.json({ orders: await dbq(sb.from('orders').select(orderSelect).eq('pay_status', 'verify').order('id', { ascending: false }).limit(100)) });
  const D = validDate(req.query.date) ? req.query.date : await staffDate();
  const rows = await dbq(sb.from('orders').select(orderSelect).eq('delivery_date', D).order('society_name').order('flat'));
  const riders = await dbq(sb.from('users').select('id,name,email,phone').eq('role', 'rider'));
  res.json({ date: D, orders: rows, riders });
}));
app.patch('/api/admin/orders/:id', ...admin, wrap(async (req, res) => {
  const id = +req.params.id, b = req.body;
  if (b.status) await setOrderStatus(id, b.status, req.user);
  const patch = {};
  if (b.rider_id !== undefined) patch.rider_id = b.rider_id || null;
  if (b.pay_status && ['pending', 'paid', 'verify', 'failed'].includes(b.pay_status)) patch.pay_status = b.pay_status;
  if (b.note !== undefined) patch.note = String(b.note).slice(0, 200);
  if (Object.keys(patch).length) await dbq(sb.from('orders').update(patch).eq('id', id));
  res.json({ ok: true });
}));
app.post('/api/admin/assign-riders', ...admin, wrap(async (req, res) => {
  const { date, rider_id, society_name } = req.body;
  if (!validDate(date)) bad('तारीख़ सही नहीं');
  let q = sb.from('orders').update({ rider_id: rider_id || null }).eq('delivery_date', date).neq('status', 'cancelled');
  if (society_name) q = q.eq('society_name', society_name);
  await dbq(q);
  res.json({ ok: true });
}));
app.post('/api/admin/run-checkout', ...admin, wrap(async (req, res) => {
  const D = validDate(req.body.date) ? req.body.date : (await cutoffInfo()).nextDate;
  res.json(await runNightlyJob(D, true));
}));

// टॉपअप
app.get('/api/admin/topups', ...admin, wrap(async (req, res) => {
  const st = req.query.status || 'pending';
  let q = sb.from('topups').select('*, users(name,phone,email)').order('id', { ascending: false }).limit(200);
  if (st !== 'all') q = q.eq('status', st);
  res.json({ topups: await dbq(q) });
}));
app.post('/api/admin/topups/:id/:act', ...admin, wrap(async (req, res) => {
  const id = +req.params.id, act = req.params.act;
  if (!['approve', 'reject'].includes(act)) bad('गलत क्रिया');
  const t = await dbq(sb.from('topups').update({ status: act === 'approve' ? 'approved' : 'rejected', reviewed_by: req.user.id, reviewed_at: new Date().toISOString(), note: String(req.body.note || '').slice(0, 200) }).eq('id', id).eq('status', 'pending').select().maybeSingle());
  if (!t) bad('यह रिचार्ज पहले ही प्रोसेस हो चुका है');
  const u = await dbq(sb.from('users').select('*').eq('id', t.user_id).single());
  if (act === 'approve') {
    try {
      await dbq(sb.rpc('wallet_apply', { p_user: t.user_id, p_main: num(t.amount), p_cb: 0, p_title: `UPI रिचार्ज (UTR ${t.utr})`, p_ref: 'topup' + t.id }));
      if (num(t.bonus) > 0) await dbq(sb.rpc('wallet_apply', { p_user: t.user_id, p_main: 0, p_cb: num(t.bonus), p_title: `कैशबैक ${t.coupon_code}`, p_ref: 'topup' + t.id }));
    } catch (e) { await dbq(sb.from('topups').update({ status: 'pending' }).eq('id', id)); throw e; }
    // रेफ़रल बोनस: पहली अप्रूव्ड रिचार्ज पर
    const rcfg = (await getSettings()).referral || {};
    if (rcfg.enabled && u.referred_by) {
      const n = await dbq(sb.from('topups').select('id').eq('user_id', u.id).eq('status', 'approved'));
      if (n.length === 1) {
        if (num(rcfg.referrer_bonus) > 0) await dbq(sb.rpc('wallet_apply', { p_user: u.referred_by, p_main: 0, p_cb: num(rcfg.referrer_bonus), p_title: 'रेफ़रल बोनस', p_ref: 'ref' }));
        if (num(rcfg.new_user_bonus) > 0) await dbq(sb.rpc('wallet_apply', { p_user: u.id, p_main: 0, p_cb: num(rcfg.new_user_bonus), p_title: 'वेलकम रेफ़रल बोनस', p_ref: 'ref' }));
      }
    }
    await retryHeldOrders(u.id);
    sendMail(u.email, `₹${t.amount} वॉलेट में जुड़ गए`, mailWrap('रिचार्ज सफल ✅', `<p>₹${t.amount}${num(t.bonus) ? ` + ₹${t.bonus} कैशबैक` : ''} आपके वॉलेट में जोड़ दिए गए हैं।</p>`));
  } else sendMail(u.email, 'रिचार्ज वेरिफाई नहीं हो सका', mailWrap('रिचार्ज रिजेक्ट', `<p>UTR ${esc(t.utr)} वेरिफाई नहीं हो सका। ${esc(t.note)}</p><p>सही UTR के साथ दोबारा कोशिश करें या सपोर्ट से संपर्क करें।</p>`));
  res.json({ ok: true });
}));
app.post('/api/admin/orders/:id/verify-pay', ...admin, wrap(async (req, res) => {
  await dbq(sb.from('orders').update({ pay_status: req.body.ok === false ? 'failed' : 'paid' }).eq('id', +req.params.id));
  res.json({ ok: true });
}));

// रिफंड + सपोर्ट
app.get('/api/admin/refunds', ...admin, wrap(async (req, res) => {
  res.json({ refunds: await dbq(sb.from('refund_requests').select('*, users(name,phone,email), orders(order_no,delivery_date)').order('id', { ascending: false }).limit(200)) });
}));
app.post('/api/admin/refunds/:id/:act', ...admin, wrap(async (req, res) => {
  const act = req.params.act;
  if (!['approve', 'reject'].includes(act)) bad('गलत क्रिया');
  const r = await dbq(sb.from('refund_requests').update({ status: act === 'approve' ? 'approved' : 'rejected', admin_note: String(req.body.note || '').slice(0, 200), reviewed_at: new Date().toISOString() }).eq('id', +req.params.id).eq('status', 'pending').select().maybeSingle());
  if (!r) bad('यह रिक्वेस्ट पहले ही प्रोसेस हो चुकी है');
  const u = await dbq(sb.from('users').select('email').eq('id', r.user_id).single());
  let amt = num(r.amount);
  if (act === 'approve') {
    if (req.body.amount !== undefined) amt = money(req.body.amount);
    try { await dbq(sb.rpc('wallet_apply', { p_user: r.user_id, p_main: amt, p_cb: 0, p_title: 'रिफंड (वेरिफाइड)', p_ref: 'refund' + r.id })); }
    catch (e) { await dbq(sb.from('refund_requests').update({ status: 'pending' }).eq('id', r.id)); throw e; }
  }
  sendMail(u.email, act === 'approve' ? `₹${amt} रिफंड हो गया` : 'रिफंड रिक्वेस्ट पर अपडेट', mailWrap('रिफंड अपडेट', act === 'approve' ? `<p>₹${amt} आपके वॉलेट में जोड़ दिए गए हैं।</p>` : `<p>आपकी रिफंड रिक्वेस्ट स्वीकार नहीं हुई। ${esc(r.admin_note)}</p>`));
  res.json({ ok: true });
}));
app.get('/api/admin/tickets', ...admin, wrap(async (req, res) => {
  res.json({ tickets: await dbq(sb.from('support_tickets').select('*, users(name,phone,email)').order('id', { ascending: false }).limit(200)) });
}));
app.post('/api/admin/tickets/:id/reply', ...admin, wrap(async (req, res) => {
  const reply = String(req.body.reply || '').trim().slice(0, 1000);
  const t = await dbq(sb.from('support_tickets').update({ reply, status: 'closed' }).eq('id', +req.params.id).select('*, users(email)').single());
  if (t.users && reply) sendMail(t.users.email, `सपोर्ट जवाब: ${t.subject}`, mailWrap('आपके सवाल का जवाब', `<p>${esc(reply)}</p>`));
  res.json({ ok: true });
}));

// कैटलॉग CRUD
app.get('/api/admin/products', ...admin, wrap(async (req, res) => {
  res.json({ products: await dbq(sb.from('products').select('*').eq('active', true).order('sort').order('id')), categories: await dbq(sb.from('categories').select('*').order('sort')) });
}));
const prodFields = b => {
  const o = {};
  if (b.name !== undefined) o.name = String(b.name).trim().slice(0, 150);
  if (b.cat !== undefined) o.cat = b.cat || null;
  if (b.unit !== undefined) o.unit = String(b.unit).slice(0, 50);
  ['vip_price', 'price', 'mrp'].forEach(k => { if (b[k] !== undefined) o[k] = money(b[k]); });
  if (b.stock_qty !== undefined) o.stock_qty = Math.max(0, Math.floor(num(b.stock_qty)));
  if (b.in_stock !== undefined) o.in_stock = !!b.in_stock;
  ['tag', 'sub_info', 'descr', 'nutri', 'shelf'].forEach(k => { if (b[k] !== undefined) o[k] = String(b[k]).slice(0, 1500); });
  if (b.images !== undefined) o.images = (Array.isArray(b.images) ? b.images : []).map(String).filter(s => /^https?:\/\//.test(s)).slice(0, 10);
  if (b.sort !== undefined) o.sort = Math.floor(num(b.sort));
  return o;
};
app.post('/api/admin/products', ...admin, wrap(async (req, res) => {
  const o = prodFields(req.body);
  if (!o.name) bad('नाम लिखें');
  if (!(o.price > 0) || !(o.mrp > 0)) bad('रेट और MRP डालें');
  if (!(o.vip_price > 0)) o.vip_price = o.price;
  res.json({ product: await dbq(sb.from('products').insert(o).select().single()) });
}));
app.put('/api/admin/products/:id', ...admin, wrap(async (req, res) => {
  res.json({ product: await dbq(sb.from('products').update(prodFields(req.body)).eq('id', +req.params.id).select().single()) });
}));
app.delete('/api/admin/products/:id', ...admin, wrap(async (req, res) => {
  await dbq(sb.from('products').update({ active: false }).eq('id', +req.params.id)); // पुराने बिल सुरक्षित रहें इसलिए soft delete
  res.json({ ok: true });
}));

// generic CRUD: categories, banners, coupons, societies
const crud = {
  categories: { pk: 'id', fields: ['id', 'name', 'img', 'sort', 'active'] },
  banners: { pk: 'id', fields: ['tag', 'title', 'sub', 'bg', 'icon', 'badge', 'img', 'sort', 'active'] },
  coupons: { pk: 'code', fields: ['code', 'min_amount', 'bonus', 'descr', 'active', 'valid_till'] },
  societies: { pk: 'id', fields: ['name', 'active'] }
};
for (const [t, c] of Object.entries(crud)) {
  const pick = b => Object.fromEntries(c.fields.filter(f => b[f] !== undefined).map(f => [f, f === 'valid_till' ? (b[f] ? String(b[f]).slice(0, 10) : null) : ['min_amount', 'bonus', 'sort'].includes(f) ? num(b[f]) : (f === 'active' ? !!b[f] : String(b[f]).slice(0, 400))]));
  app.get(`/api/admin/${t}`, ...admin, wrap(async (req, res) => res.json({ rows: await dbq(sb.from(t).select('*').order(c.pk)) })));
  app.post(`/api/admin/${t}`, ...admin, wrap(async (req, res) => {
    const o = pick(req.body);
    if (t === 'coupons') o.code = String(o.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (t === 'categories') o.id = String(o.id || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
    res.json({ row: await dbq(sb.from(t).upsert(o).select().single()) });
  }));
  app.delete(`/api/admin/${t}/:k`, ...admin, wrap(async (req, res) => {
    // सुरक्षित तरीका: हटाने की जगह बंद (active=false)
    await dbq(sb.from(t).update({ active: false }).eq(c.pk, c.pk === 'id' && t !== 'categories' ? +req.params.k : req.params.k));
    res.json({ ok: true });
  }));
}

// सेटिंग्स
const SETTING_KEYS = ['shop', 'payments', 'delivery', 'alerts', 'vip_plans', 'referral', 'faq', 'policies', 'theme'];
app.get('/api/admin/settings', ...admin, wrap(async (req, res) => res.json(await getSettings(true))));
app.put('/api/admin/settings/:key', ...admin, wrap(async (req, res) => {
  if (!SETTING_KEYS.includes(req.params.key)) bad('गलत सेटिंग');
  await dbq(sb.from('settings').upsert({ key: req.params.key, value: req.body.value }));
  await getSettings(true);
  res.json({ ok: true });
}));

// लोग: कस्टमर / राइडर / एडमिन
app.get('/api/admin/users', ...admin, wrap(async (req, res) => {
  const q = String(req.query.q || '').trim().replace(/[%,()]/g, '');
  let b = sb.from('users').select('id,email,name,phone,role,flat,society_id,is_vip,vip_until,wallet_main,wallet_cb,blocked,vacation,created_at').order('created_at', { ascending: false }).limit(300);
  if (req.query.role) b = b.eq('role', req.query.role);
  if (q) b = b.or(`name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%`);
  res.json({ users: await dbq(b) });
}));
app.patch('/api/admin/users/:id', ...admin, wrap(async (req, res) => {
  const b = req.body, patch = {};
  if (b.role && ['customer', 'rider', 'admin'].includes(b.role)) { if (req.params.id === req.user.id && b.role !== 'admin') bad('खुद का एडमिन रोल हटा नहीं सकते'); patch.role = b.role; }
  if (b.blocked !== undefined) { if (req.params.id === req.user.id) bad('खुद को ब्लॉक नहीं कर सकते'); patch.blocked = !!b.blocked; }
  if (b.is_vip !== undefined) { patch.is_vip = !!b.is_vip; if (!b.is_vip) patch.vip_until = null; }
  if (b.vip_until !== undefined) patch.vip_until = validDate(b.vip_until) ? b.vip_until : null;
  if (Object.keys(patch).length) await dbq(sb.from('users').update(patch).eq('id', req.params.id));
  res.json({ ok: true });
}));
app.post('/api/admin/users/:id/wallet', ...admin, wrap(async (req, res) => {
  const amt = money(req.body.amount), w = req.body.wallet === 'cb' ? 'cb' : 'main', note = String(req.body.note || 'एडमिन एडजस्टमेंट').slice(0, 100);
  if (!amt) bad('रकम डालें');
  try { await dbq(sb.rpc('wallet_apply', { p_user: req.params.id, p_main: w === 'main' ? amt : 0, p_cb: w === 'cb' ? amt : 0, p_title: note, p_ref: 'admin' })); }
  catch { bad('बैलेंस माइनस में नहीं जा सकता'); }
  if (amt > 0) await retryHeldOrders(req.params.id);
  res.json({ ok: true });
}));
app.post('/api/admin/staff', ...admin, wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase(), role = req.body.role === 'admin' ? 'admin' : 'rider';
  if (!isEmail(email)) bad('सही ईमेल लिखें');
  const ex = await dbq(sb.from('users').select('id').eq('email', email).maybeSingle());
  if (ex) await dbq(sb.from('users').update({ role, name: req.body.name || undefined }).eq('id', ex.id));
  else await dbq(sb.from('users').insert({ email, role, name: String(req.body.name || '').slice(0, 60), ref_code: newRefCode() }));
  res.json({ ok: true });
}));

// फ़ोटो अपलोड (Supabase Storage)
let bucketReady = false;
app.post('/api/admin/upload', ...admin, wrap(async (req, res) => {
  const m = /^data:(image\/(png|jpeg|webp));base64,(.+)$/.exec(String(req.body.dataUrl || ''));
  if (!m) bad('सिर्फ़ PNG / JPG / WEBP फ़ोटो');
  const buf = Buffer.from(m[3], 'base64');
  if (buf.length > 4 * 1024 * 1024) bad('फ़ोटो 4MB से छोटी हो');
  if (!bucketReady) { await sb.storage.createBucket('shop-images', { public: true }); bucketReady = true; }
  const ext = m[2] === 'jpeg' ? 'jpg' : m[2], name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  const { error } = await sb.storage.from('shop-images').upload(name, buf, { contentType: m[1], upsert: false });
  if (error) bad('अपलोड फ़ेल: ' + error.message, 500);
  res.json({ url: sb.storage.from('shop-images').getPublicUrl(name).data.publicUrl });
}));

// ---------- CSV रिपोर्ट
const csvCell = v => {
  if (v == null) return '';
  let s = typeof v === 'number' ? String(v) : String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const sendCsv = (res, name, cols, rows) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}-${istParts().date}.csv"`);
  res.send('﻿' + [cols.map(c => csvCell(c[0])).join(','), ...rows.map(r => cols.map(c => csvCell(typeof c[1] === 'function' ? c[1](r) : r[c[1]])).join(','))].join('\r\n'));
};

app.get('/api/admin/export/orders.csv', ...admin, wrap(async (req, res) => {
  const { from, to } = rangeQ(req);
  const rows = await fetchAll(() => sb.from('orders').select(orderSelect).gte('delivery_date', from).lte('delivery_date', to).order('delivery_date').order('id'));
  sendCsv(res, 'bills-receipts', [
    ['बिल नं.', 'order_no'], ['डिलीवरी तारीख़', 'delivery_date'], ['ग्राहक', 'customer_name'], ['मोबाइल', 'customer_phone'], ['सोसायटी', 'society_name'], ['फ्लैट', 'flat'],
    ['आइटम', r => r.order_items.map(i => `${i.name} x${i.qty}`).join(' | ')], ['सबटोटल', 'subtotal'], ['डिलीवरी शुल्क', 'fee'], ['कुल बिल', 'total'],
    ['पेमेंट तरीका', 'pay_method'], ['पेमेंट स्टेटस', 'pay_status'], ['UTR', 'utr'], ['ऑर्डर स्टेटस', 'status']
  ], rows);
}));
app.get('/api/admin/export/items.csv', ...admin, wrap(async (req, res) => {
  const { from, to } = rangeQ(req);
  const rows = await fetchAll(() => sb.from('order_items').select('name,unit,qty,rate,orders!inner(delivery_date,status)').gte('orders.delivery_date', from).lte('orders.delivery_date', to).neq('orders.status', 'cancelled'));
  const agg = {};
  rows.forEach(r => { const k = r.name + '|' + r.unit; agg[k] = agg[k] || { name: r.name, unit: r.unit, qty: 0, amt: 0 }; agg[k].qty += r.qty; agg[k].amt += r.qty * num(r.rate); });
  sendCsv(res, 'item-wise-sales', [['प्रोडक्ट', 'name'], ['पैक', 'unit'], ['कुल बिका (qty)', 'qty'], ['कुल रकम ₹', r => money(r.amt)]], Object.values(agg).sort((a, b) => b.qty - a.qty));
}));
app.get('/api/admin/export/stock.csv', ...admin, wrap(async (req, res) => {
  const { from, to } = rangeQ(req);
  const [prods, items] = await Promise.all([
    dbq(sb.from('products').select('id,name,unit,stock_qty,in_stock,price,vip_price').eq('active', true).order('sort')),
    fetchAll(() => sb.from('order_items').select('product_id,qty,orders!inner(delivery_date,status)').gte('orders.delivery_date', from).lte('orders.delivery_date', to).neq('orders.status', 'cancelled'))
  ]);
  const sold = {}; items.forEach(i => { sold[i.product_id] = (sold[i.product_id] || 0) + i.qty; });
  sendCsv(res, 'stock-report', [['प्रोडक्ट', 'name'], ['पैक', 'unit'], ['अभी स्टॉक में', 'stock_qty'], [`बिका (${from} से ${to})`, r => sold[r.id] || 0], ['रेट ₹', 'price'], ['VIP रेट ₹', 'vip_price'], ['स्टॉक वैल्यू ₹', r => money(r.stock_qty * num(r.price))]], prods);
}));
app.get('/api/admin/export/ledger.csv', ...admin, wrap(async (req, res) => {
  const [users, orders, topups] = await Promise.all([
    fetchAll(() => sb.from('users').select('id,name,phone,email,flat,wallet_main,wallet_cb,created_at').eq('role', 'customer').order('name')),
    fetchAll(() => sb.from('orders').select('user_id,total,status,pay_status,pay_method,delivery_date').neq('status', 'cancelled')),
    fetchAll(() => sb.from('topups').select('user_id,amount,bonus').eq('status', 'approved'))
  ]);
  const agg = {};
  const get = id => agg[id] = agg[id] || { n: 0, buy: 0, due: 0, last: '', rech: 0, cb: 0 };
  orders.forEach(o => { const a = get(o.user_id); a.n++; a.buy += num(o.total); if (o.pay_status !== 'paid' && o.status === 'delivered') a.due += num(o.total); if (o.delivery_date > a.last) a.last = o.delivery_date; });
  topups.forEach(t => { const a = get(t.user_id); a.rech += num(t.amount); a.cb += num(t.bonus); });
  sendCsv(res, 'customer-ledger', [
    ['ग्राहक', 'name'], ['मोबाइल', 'phone'], ['ईमेल', 'email'], ['फ्लैट', 'flat'], ['कुल ऑर्डर', u => get(u.id).n], ['कुल ख़रीदी ₹', u => money(get(u.id).buy)],
    ['कुल रिचार्ज ₹', u => money(get(u.id).rech)], ['कैशबैक मिला ₹', u => money(get(u.id).cb)], ['वॉलेट बैलेंस ₹', u => money(num(u.wallet_main) + num(u.wallet_cb))],
    ['बकाया (डिलीवर, अनपेड) ₹', u => money(get(u.id).due)], ['आख़िरी ऑर्डर', u => get(u.id).last], ['जुड़ने की तारीख़', u => String(u.created_at).slice(0, 10)]
  ], users);
}));
app.get('/api/admin/export/topups.csv', ...admin, wrap(async (req, res) => {
  const { from, to } = rangeQ(req);
  const rows = await fetchAll(() => sb.from('topups').select('*, users(name,phone)').gte('created_at', from).lte('created_at', to + 'T23:59:59').order('id'));
  sendCsv(res, 'recharges', [['तारीख़', r => String(r.created_at).slice(0, 16).replace('T', ' ')], ['ग्राहक', r => r.users && r.users.name], ['मोबाइल', r => r.users && r.users.phone], ['रकम ₹', 'amount'], ['कैशबैक ₹', 'bonus'], ['कूपन', 'coupon_code'], ['UTR', 'utr'], ['स्टेटस', 'status']], rows);
}));
app.get('/api/admin/export/transactions.csv', ...admin, wrap(async (req, res) => {
  const { from, to } = rangeQ(req);
  const rows = await fetchAll(() => sb.from('wallet_txns').select('*, users(name,phone)').gte('created_at', from).lte('created_at', to + 'T23:59:59').order('id'));
  sendCsv(res, 'wallet-transactions', [['तारीख़', r => String(r.created_at).slice(0, 16).replace('T', ' ')], ['ग्राहक', r => r.users && r.users.name], ['मोबाइल', r => r.users && r.users.phone], ['जमा/नाम', r => r.kind === 'cr' ? 'जमा' : 'कटौती'], ['रकम ₹', 'amount'], ['वॉलेट', 'wallet'], ['विवरण', 'title']], rows);
}));

// ------------------------------------------------------------------ STATIC + ERRORS
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', extensions: ['html'] }));
app.use('/api', (req, res) => res.status(404).json({ error: 'नहीं मिला' }));
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.code).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: PROD ? 'सर्वर में गड़बड़ी हुई, दोबारा कोशिश करें' : err.message });
});

app.listen(PORT, () => {
  console.log(`✅ आज की धार चालू: http://localhost:${PORT}`);
  if (!BREVO_API_KEY) console.log('⚠️ BREVO_API_KEY नहीं है — OTP ईमेल की जगह इसी कंसोल में छपेंगे');
  if (!ADMINS.length) console.log('⚠️ ADMIN_EMAIL सेट नहीं है — कोई एडमिन नहीं बन पाएगा');
});
