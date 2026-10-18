/* =====================================================================
   आज की धार — ग्राहक वाला हिस्सा (storefront)
   डेटा अब localStorage में नहीं, सर्वर (Supabase) में रहता है।
   ===================================================================== */
const $ = id => document.getElementById(id);
const E = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const wkDays = ["सोम", "मंगल", "बुध", "गुरु", "शुक्र", "शनि", "रवि"];
const dNames = ["रवि", "सोम", "मंगल", "बुध", "गुरु", "शुक्र", "शनि"];
const PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="#e8f5ee"/><text x="100" y="118" font-size="70" text-anchor="middle">🥛</text></svg>');
const STATUS = { placed: ['ऑर्डर मिला', 'bg-sky-100 text-sky-800'], on_hold: ['होल्ड (बैलेंस कम)', 'bg-rose-100 text-rose-800'], packed: ['पैक हो गया', 'bg-amber-100 text-amber-800'], out_for_delivery: ['रास्ते में 🚴', 'bg-indigo-100 text-indigo-800'], delivered: ['डिलीवर ✅', 'bg-emerald-100 text-emerald-800'], cancelled: ['कैंसिल', 'bg-slate-200 text-slate-600'] };
const PAYLBL = { wallet: 'वॉलेट', upi: 'UPI', cod: 'कैश ऑन डिलीवरी' };
const PAYST = { pending: 'बाकी', paid: 'पेड ✓', verify: 'वेरिफिकेशन में', failed: 'फ़ेल', refunded: 'रिफंड' };

let C = null, ME = null, bag = null, calIdx = 0, selCat = 'all', curPdpId = null, pwaEvt;
let mPid = null, mQty = 1, mPat = 'रोज़ाना (Daily)', mDays = [0, 1, 2, 3, 4, 5, 6];
let upiMode = null; // {type:'topup'} या {type:'order', id, amount}

// ---------------------------------------------------------------- helpers
async function api(path, method = 'GET', body) {
  const r = await fetch('/api' + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  let d = {}; try { d = await r.json(); } catch { }
  if (!r.ok) { const e = new Error(d.error || 'कुछ गड़बड़ हुई'); e.status = r.status; throw e; }
  return d;
}
function toast(msg, err) {
  const el = document.createElement('div');
  el.className = 'text-white border-l-4 border-amber-400 px-4 py-2.5 rounded-xl shadow-2xl text-xs font-bold flex justify-between items-center gap-2';
  el.style.background = err ? '#be123c' : 'var(--cd-green)';
  const s = document.createElement('span'); s.textContent = msg; el.appendChild(s);
  $('toastBox').appendChild(el); setTimeout(() => el.remove(), err ? 4200 : 2600);
}
async function run(fn) { try { return await fn(); } catch (e) { if (e.status === 401) { openLogin(); } toast(e.message, true); } }
const addDaysC = (ds, n) => { const d = new Date(ds + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function dInfo(idx) {
  const date = addDaysC(C.next_date, idx), d = new Date(date + 'T00:00:00Z'), js = d.getUTCDay(), wk = (js + 6) % 7;
  const label = idx === 0 ? (C.next_date === addDaysC(C.today, 1) ? 'कल सुबह' : 'अगली सुबह') : dNames[js];
  return { date, dayNum: d.getUTCDate(), wkIdx: wk, wkName: wkDays[wk], label };
}
const money = n => Math.round(Number(n || 0) * 100) / 100;
const isVipNow = () => !!(ME && ME.user.is_vip);
const rateOf = p => isVipNow() ? p.vipPrice : p.price;
const balance = () => ME ? money(ME.user.wallet_main + ME.user.wallet_cb) : 0;
const PM = () => Object.fromEntries((C.products || []).map(p => [p.id, p]));
const cartQty = pid => { const c = (ME?.cart || []).find(x => x.product_id === pid && x.delivery_date === C.next_date); return c ? c.qty : 0; };
const fmtDate = ds => { const d = new Date(ds + 'T00:00:00Z'); return `${d.getUTCDate()}/${d.getUTCMonth() + 1}/${d.getUTCFullYear()}`; };

// ---------------------------------------------------------------- PWA
(() => { window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); pwaEvt = e; }); })();
function installPWA() { pwaEvt ? pwaEvt.prompt() : toast("📲 ब्राउज़र के (⋮) मेन्यू से 'Install App' या 'Add to Home Screen' चुनें!"); }

// ---------------------------------------------------------------- load
async function loadConfig() {
  C = await api('/config');
  const t = C.theme || {};
  const rs = document.documentElement.style;
  if (t.pri) rs.setProperty('--cd-green', t.pri);
  if (t.light) rs.setProperty('--cd-green-light', t.light);
  if (t.acc) rs.setProperty('--cd-gold', t.acc);
  const shop = C.shop || {};
  $('shopNameH').textContent = shop.name || 'आज की धार';
  document.title = (shop.name || 'आज की धार') + ' — सुबह की ताज़ा डिलीवरी';
  $('footAddr').textContent = [shop.address, shop.phone ? '📞 ' + shop.phone : ''].filter(Boolean).join(' • ');
}
async function refreshMe() {
  try { ME = await api('/me'); } catch (e) { if (e.status === 401) ME = null; else throw e; }
}
async function loadBag() {
  if (!ME) { bag = null; return renderFloatingBasket(); }
  try { bag = await api('/bag?date=' + dInfo(calIdx).date); } catch { bag = null; }
  renderFloatingBasket(); renderLowBal();
}
async function refreshAll() { await loadConfig(); await refreshMe(); renderAll(); await loadBag(); }

// ---------------------------------------------------------------- render
function renderAll() {
  const u = ME && ME.user;
  const soc = u && (C.societies || []).find(s => s.id === u.society_id);
  $('hdrLocation').textContent = u && (soc || u.flat) ? `${u.flat ? u.flat + ', ' : ''}${soc ? soc.name : ''}` : 'डिलीवरी पता चुनें';
  $('hdrUserShort').textContent = u ? (u.name || 'प्रोफ़ाइल').split(' ')[0] : 'लॉगिन';
  $('hdrWal').textContent = balance();
  $('vipHdrStatus').textContent = isVipNow() ? 'ACTIVE' : 'JOIN VIP';
  $('vipSubText').textContent = isVipNow() ? 'VIP मेंबरशिप चालू है — आपको हर प्रोडक्ट पर नीचे दिया गया गोल्डन VIP रेट मिल रहा है!' : 'VIP मेंबरशिप बंद है — अभी चालू करें और हर लीटर दूध व घी पर 25-40% तक बचाएं!';
  const vacOn = u && (u.vacation || (u.vac_from && u.vac_to && u.vac_to >= C.today));
  $('vacBar').classList.toggle('hidden', !vacOn);
  if (vacOn) { $('vacBarTitle').textContent = u.vacation ? 'वेकेशन मोड चालू है:' : 'छुट्टी सेट है:'; $('vacBarTxt').textContent = u.vacation ? 'आपकी सुबह की सभी डिलीवरी रुकी हुई हैं।' : `${fmtDate(u.vac_from)} से ${fmtDate(u.vac_to)} तक डिलीवरी बंद रहेगी।`; }
  const staff = u && ['admin', 'rider'].includes(u.role);
  $('adminBtn').classList.toggle('hidden', !staff);
  $('staffBtn').classList.toggle('hidden', !staff);
  renderCal(); renderBannersAndCats(); renderProducts(); renderFloatingBasket(); renderLowBal();
}

function renderCal() {
  $('cdCalStrip').innerHTML = [0, 1, 2, 3, 4, 5, 6].map(i => {
    const f = dInfo(i), a = calIdx === i;
    return `<button onclick="selectDay(${i})" class="px-2.5 py-1 rounded-xl text-[10px] font-bold whitespace-nowrap transition flex items-center gap-1 ${a ? 'text-white font-extrabold shadow-xs' : 'bg-white text-slate-600 border border-slate-200'}" style="${a ? 'background:var(--cd-green)' : ''}"><span>${f.label}</span><span class="${a ? 'bg-amber-300 text-slate-950' : 'bg-slate-100 text-slate-700'} px-1.5 rounded font-extrabold">${f.dayNum}</span></button>`;
  }).join('');
}
function selectDay(i) { calIdx = i; renderCal(); loadBag(); const f = dInfo(i); toast(`📅 ${f.label} (${f.dayNum} तारीख - ${f.wkName}वार) का शेड्यूल`); }

function renderBannersAndCats() {
  $('heroBannerSlider').innerHTML = (C.banners || []).map(b => `
    <div class="min-w-[88%] sm:min-w-[60%] snap-center rounded-2xl p-4 text-white shadow-sm flex items-center justify-between gap-2" style="background:${E(b.bg)}">
      <div class="space-y-1"><span class="bg-amber-300 text-slate-950 text-[9px] font-extrabold px-2 py-0.5 rounded-full uppercase">${E(b.tag)}</span>
      <h2 class="text-sm sm:text-base font-extrabold leading-snug">${E(b.title)}</h2><p class="text-[11px] opacity-90">${E(b.sub)}</p></div>
      <div class="w-16 h-16 rounded-2xl bg-white/15 border border-white/20 flex flex-col items-center justify-center shrink-0 text-center p-1">
        <i class="fa-solid ${E(b.icon || 'fa-cow')} text-2xl text-amber-300"></i><span class="text-[8px] font-extrabold mt-1">${E(b.badge || 'PURE')}</span></div>
    </div>`).join('');
  $('couponStripBox').innerHTML = (C.coupons || []).map(c => `
    <div onclick="openWalletModal('${E(c.code)}',${+c.min_amount})" class="bg-amber-50 border border-amber-300 rounded-xl px-3 py-1.5 flex items-center gap-2 shrink-0 cursor-pointer">
      <span class="bg-amber-400 text-slate-950 text-[10px] font-extrabold px-1.5 py-0.5 rounded">${E(c.code)}</span><span class="text-[11px] font-bold text-amber-950">${E(c.descr)}</span></div>`).join('');
  const cats = [{ id: 'all', name: 'सभी (All)', img: 'https://images.unsplash.com/photo-1550583724-b2692b85b150?w=200&q=80' }, ...(C.categories || [])];
  $('cdCatCircles').innerHTML = cats.map(c => {
    const a = selCat === c.id;
    return `<button onclick="selCat='${E(c.id)}';renderAll()" class="flex flex-col items-center shrink-0 w-16 sm:w-20">
      <div class="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl overflow-hidden p-0.5 transition" style="${a ? 'box-shadow:0 0 0 2px var(--cd-green);background:var(--cd-green-light)' : 'background:#f1f5f9'}"><img src="${E(c.img || PLACEHOLDER)}" onerror="this.src=PLACEHOLDER" class="w-full h-full object-cover rounded-xl"></div>
      <span class="text-[10px] sm:text-[11px] mt-1.5 leading-tight text-center ${a ? 'font-extrabold' : 'font-semibold text-slate-600'}" style="${a ? 'color:var(--cd-green)' : ''}">${E(c.name)}</span></button>`;
  }).join('');
  const cur = cats.find(c => c.id === selCat);
  $('activeCatHeading').textContent = selCat !== 'all' && cur ? `${cur.name} - आज की धार स्पेशल` : 'सभी ताज़ा प्रोडक्ट्स';
}

function renderProducts() {
  const q = ($('cdSearchInp')?.value || '').toLowerCase().trim();
  const list = (C.products || []).filter(p => (selCat === 'all' || p.cat === selCat) && (p.name + ' ' + (p.tag || '')).toLowerCase().includes(q));
  $('prodCountTxt').textContent = `${list.length} Products`;
  if (!list.length) { $('prodGrid').innerHTML = '<p class="text-xs text-slate-500 col-span-full text-center py-8">कोई प्रोडक्ट नहीं मिला</p>'; return; }
  $('prodGrid').innerHTML = list.map(p => {
    const cq = cartQty(p.id), sub = (ME?.subs || []).find(s => s.product_id === p.id && s.active);
    const save = p.mrp > 0 ? Math.round(((p.mrp - p.vipPrice) / p.mrp) * 100) : 0;
    const img = (p.images || [])[0] || PLACEHOLDER, nSl = Math.max(1, (p.images || []).length) + 5;
    return `
    <div class="bg-white rounded-2xl p-3.5 border border-slate-200/80 shadow-xs hover:shadow-md transition flex flex-col justify-between gap-3">
      <div onclick="openPdp(${p.id})" class="flex gap-3.5 cursor-pointer group">
        <div class="w-28 h-32 sm:w-32 sm:h-36 rounded-2xl overflow-hidden bg-slate-100 border border-slate-200 shrink-0 relative">
          <img src="${E(img)}" loading="lazy" onerror="this.src=PLACEHOLDER" class="w-full h-full object-cover group-hover:scale-105 transition duration-300">
          <span class="absolute top-1.5 left-1.5 bg-slate-900/85 text-amber-300 text-[8px] font-extrabold px-1.5 py-0.5 rounded">${E(p.tag || '100% Pure')}</span>
          <span class="absolute top-1.5 right-1.5 bg-white/90 text-slate-800 text-[8px] font-extrabold px-1.5 py-0.5 rounded shadow"><i class="fa-regular fa-images mr-0.5" style="color:var(--cd-green)"></i>${nSl}</span>
          <div class="absolute inset-x-1.5 bottom-1.5 bg-white/95 rounded-xl p-1.5 shadow-md border text-center">
            <div class="flex items-center justify-center gap-1"><span class="w-3.5 h-3.5 rounded-full text-amber-300 flex items-center justify-center text-[7px] font-bold" style="background:var(--cd-green)">✓</span><span class="font-extrabold text-[10px] tracking-tight leading-none" style="color:var(--cd-green)">${E((C.shop || {}).name || 'आज की धार')}</span></div>
            <span class="block text-[7px] font-extrabold text-slate-500 uppercase tracking-wider mt-0.5">${E(p.unit)} • PURE</span>
          </div>
        </div>
        <div class="flex-1 min-w-0 flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between gap-1">
              <span class="text-[10px] font-extrabold px-2 py-0.5 rounded-md" style="background:var(--cd-green-light);color:var(--cd-green)">${E(p.unit)}</span>
              ${sub ? `<span class="bg-amber-100 text-amber-900 text-[9px] font-extrabold px-2 py-0.5 rounded-full"><i class="fa-solid fa-repeat mr-0.5"></i>${sub.qty}x Sub</span>` : `<span class="text-[9px] font-bold" style="color:var(--cd-green)">विवरण देखें →</span>`}
            </div>
            <h3 class="font-extrabold text-slate-900 text-xs sm:text-sm leading-snug mt-1.5 line-clamp-2">${E(p.name)}</h3>
            <p class="text-[11px] text-slate-500 line-clamp-1 mt-0.5">${E(p.subInfo || '100% फार्म फ्रेश • बिना प्रिज़र्वेटिव')}</p>
          </div>
          <div class="mt-2 space-y-1.5">
            <div class="flex items-baseline gap-2"><span class="text-xs text-slate-500 font-bold">Regular: <b class="${isVipNow() ? 'line-through text-slate-400' : 'text-slate-900 text-sm font-extrabold'}">₹${p.price}</b></span><span class="text-[11px] text-slate-400 line-through">MRP ₹${p.mrp}</span></div>
            <div class="cd-vip-ribbon rounded-xl px-2.5 py-1.5 flex items-center justify-between">
              <div class="flex items-center gap-1.5"><span class="w-5 h-5 rounded-lg bg-slate-900 text-amber-400 flex items-center justify-center text-[10px]"><i class="fa-solid fa-crown"></i></span><div><span class="text-xs sm:text-sm font-extrabold text-slate-950">₹${p.vipPrice}</span><span class="text-[10px] font-extrabold text-amber-900"> with VIP</span></div></div>
              <span class="bg-slate-900 text-amber-300 text-[9px] font-extrabold px-1.5 py-0.5 rounded">${save}% OFF</span>
            </div>
          </div>
        </div>
      </div>
      ${!p.stock ? `<div class="bg-rose-50 border border-rose-200 text-rose-600 text-center py-2 rounded-xl text-xs font-extrabold">Out of Stock (जल्द उपलब्ध होगा)</div>` : `
      <div class="grid grid-cols-5 gap-2 pt-2 border-t border-slate-100">
        <button onclick="openSubModal(${p.id})" class="col-span-3 text-white font-extrabold py-2 rounded-xl text-xs shadow-xs flex items-center justify-center gap-1.5" style="background:var(--cd-green)"><i class="fa-solid fa-calendar-check text-[11px] text-amber-300"></i><span>${sub ? 'Edit Subscription' : 'Subscribe (रोज़ाना)'}</span></button>
        <div class="col-span-2">${cq === 0 ? `<button onclick="updCart(${p.id},1)" class="w-full h-full bg-white font-extrabold py-1.5 rounded-xl text-xs border-2" style="color:var(--cd-green);border-color:var(--cd-green)">+ Buy Once</button>` : `
          <div class="w-full h-full flex items-center justify-between text-white rounded-xl px-2 py-1" style="background:var(--cd-green)"><button onclick="updCart(${p.id},-1)" class="w-6 h-6 rounded-lg bg-white text-slate-900 font-extrabold">-</button><span class="text-xs font-extrabold">${cq}</span><button onclick="updCart(${p.id},1)" class="w-6 h-6 rounded-lg bg-white text-slate-900 font-extrabold">+</button></div>`}</div>
      </div>`}
    </div>`;
  }).join('');
}

// ---------------------------------------------------------------- PDP (स्वाइप स्लाइड्स: पहले आपकी फ़ोटो, फिर जानकारी वाली स्लाइड्स)
let pdpTotal = 6;
function openPdp(id) {
  const p = PM()[id]; if (!p) return;
  curPdpId = id;
  const save = Math.max(0, p.mrp - p.vipPrice), pct = p.mrp ? Math.round(save / p.mrp * 100) : 0;
  $('pdpTopTitle').textContent = p.name; $('pdpUnitBadge').textContent = `पैकेट साइज: ${p.unit}`; $('pdpMainName').textContent = p.name;
  $('pdpSubLine').textContent = p.subInfo || 'सीधे फार्म से 36 घंटे में आपके दरवाज़े पर • 100% शुद्ध';
  $('pdpMrpTxt').textContent = `MRP ₹${p.mrp}`; $('pdpRegTxt').textContent = `Regular Price: ₹${p.price}`; $('pdpVipRate').textContent = `₹${p.vipPrice}`;
  $('pdpVipNote').textContent = isVipNow() ? `✅ आपका VIP क्लब चालू है — प्रति पैक ₹${save} की सीधी बचत!` : `अभी टैप करके VIP चालू करें और प्रति पैक ₹${save} बचाएं!`;
  $('pdpSaveBadge').textContent = `${pct}% VIP बचत`;
  $('pdpFullDesc').textContent = p.desc || 'यह प्रोडक्ट 70+ क्वालिटी जांच के बाद सीधे फार्म से 4°C कोल्ड-चेन में आपके घर डिलीवर किया जाता है।';
  $('pdpNutriTxt').textContent = p.nutri || '100% Natural Farm Nutrients • Zero Preservatives';
  $('pdpShelfTxt').textContent = p.shelf || '2-3 Days (Keep Refrigerated below 4°C)';
  const imgs = (p.images && p.images.length) ? p.images : [PLACEHOLDER], alt = imgs[1] || imgs[0], first = imgs[0];
  const photoSlides = imgs.map((src, i) => `
    <div class="min-w-full snap-center h-64 sm:h-72 rounded-2xl overflow-hidden relative bg-slate-900 border">
      <img src="${E(src)}" onerror="this.src=PLACEHOLDER" class="w-full h-full object-cover">
      ${i === 0 ? `<div class="absolute top-3 left-3 text-white px-3 py-1 rounded-full text-[10px] font-extrabold shadow flex items-center gap-1.5 border border-amber-300" style="background:var(--cd-green)"><i class="fa-solid fa-cow text-amber-300"></i> ${E((C.shop || {}).name || 'आज की धार')} • OFFICIAL PACK</div>
      <div class="absolute inset-x-3 bottom-3 bg-white/95 rounded-2xl p-3 shadow-xl border flex items-center justify-between"><div><span class="text-[9px] font-extrabold uppercase tracking-wider block" style="color:var(--cd-green)">100% Farm Fresh Guarantee</span><h4 class="font-extrabold text-xs sm:text-sm text-slate-900 line-clamp-1">${E(p.name)}</h4><span class="text-[10px] font-bold text-slate-500">${E(p.unit)} • ${E(p.tag || 'Pure & Natural')}</span></div><div class="text-amber-300 font-extrabold text-xs px-3 py-1.5 rounded-xl text-center shrink-0" style="background:var(--cd-green)">👑 ₹${p.vipPrice}<span class="block text-[8px] text-white">VIP PRICE</span></div></div>` : `<span class="absolute top-3 left-3 bg-slate-900/80 text-amber-300 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full">फोटो ${i + 1}</span>`}
    </div>`).join('');
  const info = `
    <div class="min-w-full snap-center h-64 sm:h-72 rounded-2xl overflow-hidden relative bg-slate-900 border">
      <img src="${E(alt)}" onerror="this.src=PLACEHOLDER" class="w-full h-full object-cover opacity-35">
      <div class="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-900/75 to-transparent p-5 flex flex-col justify-between text-white">
        <div class="flex justify-between items-center"><span class="bg-amber-400 text-slate-950 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full">PURITY PROOF</span><span class="text-xs font-extrabold text-emerald-300">लैब टेस्टेड</span></div>
        <div class="space-y-2"><div class="w-11 h-11 rounded-2xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center text-xl text-amber-300"><i class="fa-solid fa-flask"></i></div>
        <h3 class="text-base sm:text-lg font-extrabold leading-snug">घर बैठे खुद शुद्धता जांचें!</h3>
        <p class="text-xs text-slate-200 leading-relaxed">हर पैक में <b>0% यूरिया, 0% स्टार्च, 0% मिल्क पाउडर और 0% डिटर्जेंट</b> की गारंटी है।</p></div>
        <div class="grid grid-cols-3 gap-2 text-center text-[10px] font-extrabold"><div class="bg-white/10 py-1.5 rounded-lg border border-white/15">✓ No Urea</div><div class="bg-white/10 py-1.5 rounded-lg border border-white/15">✓ No Powder</div><div class="bg-white/10 py-1.5 rounded-lg border border-white/15">✓ No Peroxide</div></div>
      </div></div>
    <div class="min-w-full snap-center h-64 sm:h-72 rounded-2xl p-5 text-white flex flex-col justify-between border" style="background:linear-gradient(135deg,#0d5c3a 0%,#06331f 100%)">
      <div class="flex justify-between items-center"><span class="bg-amber-300 text-slate-950 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full">36 HR JOURNEY</span><span class="text-xs font-extrabold text-amber-300">कोल्ड-चेन</span></div>
      <div><h3 class="text-sm sm:text-base font-extrabold mb-3">सीधे किसान के फार्म से सुबह आपके दरवाज़े तक:</h3>
      <div class="grid grid-cols-4 gap-2 text-center">
        <div class="bg-white/10 p-2 rounded-2xl border border-white/15"><i class="fa-solid fa-cow text-amber-300 text-lg"></i><b class="block text-[10px] mt-1">1. फार्म</b><span class="text-[8px] text-emerald-200">ताज़ा कलेक्शन</span></div>
        <div class="bg-white/10 p-2 rounded-2xl border border-white/15"><i class="fa-solid fa-snowflake text-sky-300 text-lg"></i><b class="block text-[10px] mt-1">2. 4°C चिलिंग</b><span class="text-[8px] text-emerald-200">तुरंत ठंडा</span></div>
        <div class="bg-white/10 p-2 rounded-2xl border border-white/15"><i class="fa-solid fa-microscope text-emerald-300 text-lg"></i><b class="block text-[10px] mt-1">3. 70+ टेस्ट</b><span class="text-[8px] text-emerald-200">क्वालिटी जांच</span></div>
        <div class="bg-white/10 p-2 rounded-2xl border border-white/15"><i class="fa-solid fa-bell-slash text-amber-300 text-lg"></i><b class="block text-[10px] mt-1">4. सुबह 7 AM</b><span class="text-[8px] text-emerald-200">साइलेंट डिलीवरी</span></div></div></div>
      <p class="text-[10px] text-center bg-black/25 py-1.5 rounded-xl font-bold text-emerald-200">बिना किसी बिचौलिए के 100% ताज़ा डिलीवरी</p></div>
    <div class="min-w-full snap-center h-64 sm:h-72 rounded-2xl p-5 bg-white border-2 border-slate-200 flex flex-col justify-between">
      <div class="flex justify-between items-center border-b pb-2"><span class="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full" style="background:var(--cd-green-light);color:var(--cd-green)">NUTRITION CHART</span><span class="text-xs font-extrabold" style="color:var(--cd-green)">न्यूट्रिशन</span></div>
      <div class="space-y-2"><h3 class="font-extrabold text-sm text-slate-900 line-clamp-2">${E(p.name)} — पोषण और लाभ:</h3>
        <div class="bg-[#f8faf9] p-3 rounded-2xl border border-slate-200 text-xs font-extrabold" style="color:var(--cd-green)">${E(p.nutri || 'Natural Farm Nutrients')}</div>
        <div class="grid grid-cols-2 gap-2 text-[11px]"><div class="p-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 font-bold"><i class="fa-solid fa-bone mr-1 text-amber-600"></i>मज़बूत हड्डियाँ और इम्युनिटी</div><div class="p-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 font-bold"><i class="fa-solid fa-heart-pulse mr-1 text-emerald-600"></i>बच्चों व बुजुर्गों के लिए</div></div></div>
      <div class="text-[10px] text-slate-500 font-bold flex justify-between border-t pt-2"><span>स्टोरेज: ${E(p.shelf || '4°C फ्रिज में रखें')}</span><span style="color:var(--cd-green)">Quality Checked ✓</span></div></div>
    <div class="min-w-full snap-center h-64 sm:h-72 rounded-2xl overflow-hidden relative bg-slate-900 border">
      <img src="${E(first)}" onerror="this.src=PLACEHOLDER" class="w-full h-full object-cover opacity-30 scale-110">
      <div class="absolute inset-0 p-5 flex flex-col justify-between text-white" style="background:linear-gradient(135deg,rgba(120,53,15,.92),rgba(28,25,23,.92))">
        <div class="flex justify-between items-center"><span class="bg-amber-400 text-slate-950 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full">HYGIENE SEAL</span><span class="text-xs font-extrabold text-amber-300">पैकेजिंग</span></div>
        <div class="space-y-2"><h3 class="text-base font-extrabold text-amber-300">जीरो हैंड-टच और टेम्पर-प्रूफ पैकेजिंग</h3><p class="text-xs text-slate-200 leading-relaxed line-clamp-4">${E(p.desc)}</p></div>
        <div class="bg-white/10 p-2.5 rounded-xl border border-white/15 flex items-center justify-between text-xs font-bold"><span>📦 ${E(p.unit)}</span><span class="text-amber-300">Refund Guarantee</span></div></div></div>
    <div class="min-w-full snap-center h-64 sm:h-72 rounded-2xl p-5 text-white flex flex-col justify-between border" style="background:linear-gradient(135deg,#1c1917 0%,#312514 100%)">
      <div class="flex justify-between items-center"><span class="bg-amber-400 text-slate-950 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full">SILENT DELIVERY</span><span class="text-xs font-extrabold text-amber-400">👑 VIP PRIVILEGE</span></div>
      <div class="flex items-center gap-3"><div class="w-12 h-12 rounded-2xl bg-amber-400 text-slate-950 flex items-center justify-center text-sm font-extrabold shrink-0">7 AM</div><div><h3 class="text-sm sm:text-base font-extrabold text-amber-300">रात तक ऑर्डर • सुबह दरवाज़े पर!</h3><p class="text-[11px] text-slate-300">बिना घंटी बजाए आपके दरवाज़े के इंसुलेटेड बैग में सुरक्षित डिलीवरी।</p></div></div>
      <div class="bg-white/10 p-3 rounded-2xl border border-amber-400/30 flex items-center justify-between text-xs"><span>👑 VIP रेट: <b>₹${p.vipPrice}</b> <span class="line-through text-slate-400 ml-1">MRP ₹${p.mrp}</span></span><span class="bg-emerald-500 text-slate-950 font-extrabold px-2.5 py-1 rounded-lg">VIP: Free Delivery</span></div></div>`;
  pdpTotal = imgs.length + 5;
  const track = $('pdpSlideTrack'); track.innerHTML = photoSlides + info; track.scrollLeft = 0;
  $('pdpDotsBox').innerHTML = Array.from({ length: pdpTotal }, (_, i) => `<button onclick="goToPdpSlide(${i})" id="pdpDot-${i}" class="h-2 rounded-full transition-all ${i === 0 ? 'w-6' : 'w-2 bg-slate-300'}" style="${i === 0 ? 'background:var(--cd-green)' : ''}"></button>`).join('');
  $('pdpSlideBadge').textContent = `Slide 1 / ${pdpTotal}`;
  const sim = (C.products || []).filter(x => x.cat === p.cat && x.id !== p.id).slice(0, 6);
  $('pdpSimilarBox').classList.toggle('hidden', !sim.length);
  $('pdpSimilar').innerHTML = sim.map(x => `<div onclick="openPdp(${x.id})" class="w-28 shrink-0 cursor-pointer"><img src="${E((x.images || [])[0] || PLACEHOLDER)}" onerror="this.src=PLACEHOLDER" class="w-28 h-24 object-cover rounded-xl border"><p class="text-[10px] font-extrabold mt-1 line-clamp-2">${E(x.name)}</p><p class="text-[10px] font-bold" style="color:var(--cd-green)">₹${rateOf(x)}</p></div>`).join('');
  $('pdpSubActionBtn').onclick = () => { closePdp(); openSubModal(p.id); };
  $('pdpBuyOnceBtn').onclick = () => { updCart(p.id, 1); closePdp(); };
  $('pdpBuyOnceBtn').disabled = !p.stock; $('pdpSubActionBtn').disabled = !p.stock;
  $('pdpModal').classList.remove('hidden');
}
function closePdp() { $('pdpModal').classList.add('hidden'); }
function goToPdpSlide(i) { const t = $('pdpSlideTrack'); t.scrollTo({ left: t.clientWidth * i, behavior: 'smooth' }); }
function stepPdpSlide(d) { const t = $('pdpSlideTrack'); goToPdpSlide((Math.round(t.scrollLeft / t.clientWidth) + d + pdpTotal) % pdpTotal); }
function updateSlideDots() {
  const t = $('pdpSlideTrack'); if (!t.clientWidth) return;
  const idx = Math.min(pdpTotal - 1, Math.max(0, Math.round(t.scrollLeft / t.clientWidth)));
  $('pdpSlideBadge').textContent = `Slide ${idx + 1} / ${pdpTotal}`;
  for (let i = 0; i < pdpTotal; i++) { const d = $('pdpDot-' + i); if (d) { d.className = `h-2 rounded-full transition-all ${i === idx ? 'w-6' : 'w-2 bg-slate-300'}`; d.style.background = i === idx ? 'var(--cd-green)' : ''; } }
}

// ---------------------------------------------------------------- LOGIN
let lgEmail = '';
function openLogin() { $('loginStep1').classList.remove('hidden'); $('loginStep2').classList.add('hidden'); $('loginModal').classList.remove('hidden'); const r = new URLSearchParams(location.search).get('ref'); if (r) $('lgRef').value = r.toUpperCase(); }
const needLogin = () => { if (ME) return false; openLogin(); toast('पहले लॉगिन करें'); return true; };
async function loginSend() {
  const email = $('lgEmail').value.trim().toLowerCase(); if (!email) return toast('ईमेल लिखें', true);
  $('lgSendBtn').disabled = true;
  await run(async () => { const r = await api('/auth/request', 'POST', { email }); lgEmail = email; $('lgSentTo').textContent = email; $('loginStep1').classList.add('hidden'); $('loginStep2').classList.remove('hidden'); toast(r.dev || '📧 OTP भेज दिया गया'); });
  $('lgSendBtn').disabled = false;
}
async function loginVerify() {
  $('lgVerifyBtn').disabled = true;
  await run(async () => {
    const r = await api('/auth/verify', 'POST', { email: lgEmail, code: $('lgCode').value.trim(), name: $('lgName').value, phone: $('lgPhone').value, ref: $('lgRef').value });
    $('loginModal').classList.add('hidden'); $('lgCode').value = '';
    await refreshMe(); renderAll(); await loadBag();
    toast('✅ लॉगिन हो गया');
    if (r.isNew || !ME.user.name || !ME.user.society_id) setTimeout(() => { toast('📍 अपना नाम और डिलीवरी पता पूरा करें'); openAccount(); }, 600);
  });
  $('lgVerifyBtn').disabled = false;
}
async function logout() { await api('/auth/logout', 'POST'); ME = null; bag = null; $('accountModal').classList.add('hidden'); renderAll(); toast('लॉगआउट हो गया'); }

// ---------------------------------------------------------------- CART / SUBS / BAG
async function updCart(id, d) {
  if (needLogin()) return;
  const n = Math.max(0, cartQty(id) + d);
  ME.cart = ME.cart.filter(c => !(c.product_id === id && c.delivery_date === C.next_date));
  if (n > 0) ME.cart.push({ product_id: id, qty: n, delivery_date: C.next_date });
  renderProducts();
  try { await api('/cart', 'PUT', { product_id: id, qty: n }); toast(n > 0 ? '✅ बैग में जुड़ गया (Buy Once)' : '🗑️ बैग से हटाया गया'); if (calIdx !== 0) { calIdx = 0; renderCal(); } await loadBag(); }
  catch (e) { toast(e.message, true); await refreshMe(); renderProducts(); }
}
function openSubModal(id) {
  if (needLogin()) return;
  mPid = id; const p = PM()[id], ex = ME.subs.find(x => x.product_id === id);
  mQty = ex ? ex.qty : 1; mPat = ex ? ex.pattern : 'रोज़ाना (Daily)'; mDays = ex ? [...ex.days] : [0, 1, 2, 3, 4, 5, 6];
  $('subQtyNum').textContent = mQty;
  $('subProdPreview').innerHTML = `<img src="${E((p.images || [])[0] || PLACEHOLDER)}" onerror="this.src=PLACEHOLDER" class="w-12 h-12 rounded-xl object-cover border"><div><span class="text-[9px] font-extrabold text-white px-1.5 py-0.5 rounded" style="background:var(--cd-green)">PURE</span><h4 class="font-extrabold text-xs mt-0.5">${E(p.name)}</h4><p class="text-xs font-extrabold" style="color:var(--cd-green)">₹${rateOf(p)} / ${E(p.unit)} <span class="text-[10px] text-slate-400 line-through">MRP ₹${p.mrp}</span></p></div>`;
  renderDayBtns(); $('subModal').classList.remove('hidden');
}
function chgSubQty(d) { mQty = Math.max(1, Math.min(20, mQty + d)); $('subQtyNum').textContent = mQty; }
function setPresetDays(pat, arr) { mPat = pat; mDays = [...arr]; renderDayBtns(); }
function renderDayBtns() { $('wkDayGrid').innerHTML = wkDays.map((w, i) => `<button onclick="togWkDay(${i})" class="py-1.5 rounded-xl text-xs font-extrabold border ${mDays.includes(i) ? 'text-white border-transparent' : 'bg-slate-50 text-slate-400'}" style="${mDays.includes(i) ? 'background:var(--cd-green)' : ''}">${w}</button>`).join(''); }
function togWkDay(i) { if (mDays.includes(i)) { if (mDays.length > 1) mDays = mDays.filter(x => x !== i); } else mDays.push(i); mPat = 'कस्टम वार'; renderDayBtns(); }
async function saveSubscription() {
  await run(async () => { await api('/subs', 'PUT', { product_id: mPid, qty: mQty, pattern: mPat, days: mDays, active: true }); $('subModal').classList.add('hidden'); await refreshMe(); renderAll(); await loadBag(); toast('🔄 सब्सक्रिप्शन एक्टिवेट हो गई!'); });
}
async function toggleSub(id, active) { await run(async () => { await api('/subs/' + id, 'PATCH', { active }); await refreshMe(); renderAll(); await loadBag(); }); }
async function delSub(id) { if (!confirm('यह सब्सक्रिप्शन हटाएं?')) return; await run(async () => { await api('/subs/' + id, 'DELETE'); await refreshMe(); renderAll(); await loadBag(); }); }
async function toggleVac() {
  if (needLogin()) return;
  await run(async () => { const r = await api('/me', 'PUT', { vacation: !ME.user.vacation }); ME.user = r.user; renderAll(); await loadBag(); toast(ME.user.vacation ? '🏖️ वेकेशन मोड चालू: डिलीवरी पॉज़' : '✅ वेकेशन मोड बंद: डिलीवरी चालू'); });
}
async function saveVacRange() {
  if (needLogin()) return;
  const f = $('vacFrom').value, t = $('vacTo').value;
  if (!f || !t) return toast('"से" और "तक" दोनों तारीख़ें चुनें', true);
  await run(async () => { const r = await api('/me', 'PUT', { vac_from: f, vac_to: t }); ME.user = r.user; renderAll(); await loadBag(); toast(`🏖️ छुट्टी सेट: ${fmtDate(f)} से ${fmtDate(t)} तक`); });
}
async function clearVacRange() { await run(async () => { const r = await api('/me', 'PUT', { vac_from: '', vac_to: '' }); ME.user = r.user; $('vacFrom').value = ''; $('vacTo').value = ''; renderAll(); await loadBag(); toast('✅ छुट्टी हटा दी गई'); }); }
async function endVacation() { await run(async () => { const r = await api('/me', 'PUT', { vacation: false, vac_from: '', vac_to: '' }); ME.user = r.user; renderAll(); await loadBag(); toast('✅ डिलीवरी वापस चालू'); }); }
async function saveCallBefore(v) { await run(async () => { const r = await api('/me', 'PUT', { call_before: !!v }); ME.user = r.user; toast(v ? '📞 राइडर पहुँचने से पहले कॉल करेगा' : 'कॉल बंद'); }); }
async function saveDoorNote(v) { await run(async () => { const r = await api('/me', 'PUT', { door_note: v }); ME.user = r.user; toast('📝 निर्देश सेव हो गया'); }); }
async function savePref(v) { await run(async () => { const r = await api('/me', 'PUT', { deliv_pref: v }); ME.user = r.user; toast('🔔 डिलीवरी निर्देश अपडेट हो गया'); }); }

function renderFloatingBasket() {
  if (!C) return;
  const f = dInfo(calIdx), locked = bag && bag.locked, o = locked ? bag.order : null;
  const items = o ? o.order_items : (bag && bag.lines) || [];
  const qty = items.reduce((a, b) => a + b.qty, 0);
  const total = o ? o.total : (bag ? bag.total : 0), mrp = o ? o.mrp_total : (bag ? bag.mrp : 0), sub = o ? o.subtotal : (bag ? bag.subtotal : 0), fee = o ? o.fee : (bag ? bag.fee : 0);
  const saved = Math.max(0, money(mrp - sub));
  const title = `${f.label} (${f.dayNum} तारीख, ${f.wkName}वार) • सुबह बैग`;
  $('fltDayTitle').textContent = title; $('drwDayHeading').textContent = title; $('fltQty').textContent = qty; $('fltBill').textContent = total;
  $('fltVipSaved').textContent = saved > 0 ? `₹${saved} बचत` : '';
  $('fltSub').textContent = locked ? `ऑर्डर लॉक • ${STATUS[o.status][0]}` : 'कटऑफ़ तक आइटम बदलें • ऑटो-चेकआउट';
  $('floatStrip').classList.toggle('hidden', !qty);
  $('drwLockTag').textContent = locked ? '🔒 ऑर्डर लॉक हो चुका' : `AUTO-LOCKS AT ${(C.delivery || {}).cutoff || '23:59'}`;
  $('drwMrp').textContent = `₹${mrp}`; $('drwSave').textContent = `- ₹${saved}`; $('drwFee').textContent = fee ? `₹${fee}` : 'FREE';
  $('drwNetLbl').textContent = locked ? `कुल बिल (${PAYLBL[o.pay_method]})` : 'कुल बिल (कटऑफ़ पर वसूल होगा)'; $('drwNet').textContent = `₹${total}`;
  const vac = ME && ME.user.vacation;
  $('vacToggleBtn').className = `px-3 py-1.5 rounded-xl font-extrabold text-xs ${vac ? 'bg-rose-600 text-white' : 'bg-slate-200 text-slate-700'}`;
  $('vacToggleBtn').textContent = vac ? 'चालू है 🏖️' : 'बंद है';
  if (ME) {
    const u = ME.user; $('delivPrefSel').value = u.deliv_pref; $('callBeforeChk').checked = !!u.call_before; if (document.activeElement !== $('doorNote')) $('doorNote').value = u.door_note || '';
    $('vacFrom').min = C.today; $('vacTo').min = C.today;
    if (u.vac_from && u.vac_to) { $('vacFrom').value = u.vac_from; $('vacTo').value = u.vac_to; }
    $('vacClearBtn').classList.toggle('hidden', !(u.vac_from && u.vac_to));
    $('vacRangeInfo').textContent = u.vac_from && u.vac_to ? `सेट है: ${fmtDate(u.vac_from)} से ${fmtDate(u.vac_to)} तक` : '';
  }
  $('drwSubsList').innerHTML = ME && ME.subs.length ? ME.subs.map(s => {
    const p = PM()[s.product_id]; if (!p) return '';
    return `<div class="flex justify-between items-center bg-slate-50 p-2.5 rounded-xl border text-xs"><div><b>${E(p.name)}</b><span class="block text-[10px] text-slate-500">${s.qty} पैक • ${E(s.pattern)} [${s.days.map(d => wkDays[d]).join(', ')}]</span></div>
      <div class="flex items-center gap-1.5"><button onclick="toggleSub(${s.id},${!s.active})" class="px-2.5 py-1 rounded-lg text-[10px] font-bold border ${s.active ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">${s.active ? 'Active' : 'Paused'}</button><button onclick="delSub(${s.id})" class="text-rose-500 px-1.5"><i class="fa-solid fa-trash"></i></button></div></div>`;
  }).join('') : '<p class="text-slate-400 text-xs">कोई एक्टिव सब्सक्रिप्शन नहीं है</p>';
  $('drwItemsList').innerHTML = items.length ? (o ? o.order_items.map(i => `<div class="flex items-center justify-between bg-slate-50 p-2.5 rounded-xl border text-xs"><div><b>${E(i.name)}</b><span class="block text-[10px] text-slate-500">${E(i.unit)} × ${i.qty} (@ ₹${i.rate})</span></div><span class="font-extrabold" style="color:var(--cd-green)">₹${money(i.qty * i.rate)}</span></div>`).join('')
    : bag.lines.map(i => `<div class="flex items-center justify-between bg-slate-50 p-2.5 rounded-xl border text-xs"><div class="flex items-center gap-2.5"><img src="${E(i.img || PLACEHOLDER)}" onerror="this.src=PLACEHOLDER" class="w-10 h-10 rounded-xl object-cover border"><div><b>${E(i.name)}</b><span class="block text-[10px] text-slate-500">${i.sq ? `Sub: ${i.sq}` : ''} ${i.oq ? `• Buy Once: ${i.oq}` : ''} (@ ₹${i.rate})</span></div></div><span class="font-extrabold" style="color:var(--cd-green)">₹${i.tot}</span></div>`).join(''))
    : `<p class="text-slate-400 text-xs">${vac ? 'वेकेशन मोड चालू है — डिलीवरी रुकी हुई है' : 'इस दिन के लिए डिलीवरी बैग खाली है'}</p>`;
  const pb = $('drwPayBox');
  if (o && o.pay_method === 'upi' && ['pending', 'failed'].includes(o.pay_status)) {
    pb.classList.remove('hidden');
    pb.innerHTML = `<b class="text-amber-900">₹${o.total} का UPI पेमेंट बाकी है</b><button onclick="openOrderUpi(${o.id},${o.total})" class="w-full text-white font-extrabold py-2 rounded-xl" style="background:var(--cd-green)">QR से पेमेंट करें और UTR डालें</button>`;
  } else if (o && o.status === 'on_hold') {
    pb.classList.remove('hidden');
    pb.innerHTML = `<b class="text-rose-800">वॉलेट में बैलेंस कम है — ऑर्डर होल्ड पर है।</b><button onclick="$('basketDrawer').classList.add('hidden');openWalletModal()" class="w-full text-white font-extrabold py-2 rounded-xl" style="background:var(--cd-green)">अभी रिचार्ज करें</button>`;
  } else if (o) { pb.classList.remove('hidden'); pb.innerHTML = `पेमेंट: <b>${PAYLBL[o.pay_method]}</b> • ${PAYST[o.pay_status] || ''} <button onclick="showReceipt(${o.id})" class="ml-2 underline font-extrabold" style="color:var(--cd-green)">बिल देखें</button>`; }
  else if (items.length && !vac) {
    const fd = dInfo(calIdx).date, cd = addDaysC(fd, -1), MN = ['जनवरी', 'फ़रवरी', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुलाई', 'अगस्त', 'सितंबर', 'अक्टूबर', 'नवंबर', 'दिसंबर'];
    const fmt = ds => { const d = new Date(ds + 'T00:00:00Z'); return `${d.getUTCDate()} ${MN[d.getUTCMonth()]} (${wkDays[(d.getUTCDay() + 6) % 7]}वार)`; };
    const ct = (C.delivery || {}).cutoff || '23:59', how = ME && ME.user.pay_pref === 'wallet' ? 'वॉलेट से अपने-आप कटेगा' : ME && ME.user.pay_pref === 'cod' ? 'डिलीवरी पर कैश (COD)' : 'UPI से पेमेंट';
    pb.classList.remove('hidden');
    pb.innerHTML = `<div class="space-y-1"><div>🚚 <b>डिलीवरी:</b> ${fmt(fd)} सुबह 5–7 बजे</div><div>🔒 <b>ऑर्डर पक्का होगा:</b> ${fmt(cd)} रात ${ct} बजे</div><div>💳 <b>बिल:</b> ${how}${ME && ME.user.pay_pref === 'wallet' ? ' (उसी समय)' : ''}</div><div class="text-[10px] text-slate-500">तब तक आइटम बदल या हटा सकते हैं। वॉलेट में बैलेंस कम हुआ तो ऑर्डर होल्ड पर जाएगा।</div></div>`;
  }
  else pb.classList.add('hidden');
}
function renderLowBal() {
  const show = ME && bag && !bag.locked && !bag.vacation && calIdx === 0 && ME.user.pay_pref === 'wallet' && bag.total > 0 && bag.total > balance();
  $('lowBalBar').classList.toggle('hidden', !show);
  if (show) $('lowBalTxt').textContent = `⚠️ अगली डिलीवरी का बिल ₹${bag.total} है पर वॉलेट में ₹${balance()} हैं। डिलीवरी न रुके, रिचार्ज करें।`;
}
function openBasketDrawer() { if (needLogin()) return; renderFloatingBasket(); $('basketDrawer').classList.remove('hidden'); }

// ---------------------------------------------------------------- LOCATION / ACCOUNT
function openLocModal() {
  if (needLogin()) return;
  $('locSocSel').innerHTML = '<option value="">-- सोसायटी चुनें --</option>' + (C.societies || []).map(s => `<option value="${s.id}" ${s.id === ME.user.society_id ? 'selected' : ''}>${E(s.name)}</option>`).join('');
  $('locFlatInp').value = ME.user.flat || ''; $('locModal').classList.remove('hidden');
}
async function saveLocation() {
  const sid = $('locSocSel').value, flat = $('locFlatInp').value.trim();
  if (!sid || !flat) return toast('सोसायटी और फ्लैट नंबर दोनों भरें', true);
  await run(async () => { const r = await api('/me', 'PUT', { society_id: sid, flat }); ME.user = r.user; $('locModal').classList.add('hidden'); renderAll(); toast('📍 डिलीवरी लोकेशन अपडेट हो गई!'); });
}
async function openAccount() {
  if (needLogin()) return;
  await refreshMe(); const u = ME.user;
  $('profName').value = u.name; $('profPhone').value = u.phone; $('profEmail').value = u.email;
  const modes = [['wallet', 'वॉलेट', 'fa-wallet', true], ['upi', 'UPI', 'fa-qrcode', C.payments.upi], ['cod', 'COD', 'fa-money-bill', C.payments.cod]];
  $('payPrefBox').innerHTML = modes.filter(m => m[3]).map(m => `<button onclick="setPayPref('${m[0]}')" class="py-2 rounded-xl border-2 font-extrabold ${u.pay_pref === m[0] ? 'text-white border-transparent' : 'bg-white text-slate-600'}" style="${u.pay_pref === m[0] ? 'background:var(--cd-green)' : ''}"><i class="fa-solid ${m[2]} mr-1"></i>${m[1]}</button>`).join('');
  const rf = C.referral || {};
  $('refBox').classList.toggle('hidden', !rf.enabled); $('refCodeTxt').textContent = u.ref_code || '';
  loadStats().then(paintRefStats);
  $('myOrdersList').innerHTML = ME.orders.length ? ME.orders.map(o => {
    const st = STATUS[o.status] || [o.status, 'bg-slate-100'];
    return `<div class="border rounded-xl p-2.5 flex items-center justify-between gap-2"><div class="min-w-0"><b class="block truncate">${E(o.order_no)}</b><span class="text-[10px] text-slate-500">${fmtDate(o.delivery_date)} • ₹${o.total} • ${PAYLBL[o.pay_method]} (${PAYST[o.pay_status] || ''})</span><span class="ml-1 text-[9px] font-extrabold px-1.5 py-0.5 rounded ${st[1]}">${st[0]}</span></div>
      <div class="flex flex-col gap-1 shrink-0">${o.pay_method === 'upi' && ['pending', 'failed'].includes(o.pay_status) && o.status !== 'cancelled' ? `<button onclick="openOrderUpi(${o.id},${o.total})" class="text-[10px] font-extrabold bg-amber-400 px-2 py-1 rounded">UPI पेमेंट</button>` : ''}<button onclick="showReceipt(${o.id})" class="text-[10px] font-extrabold underline" style="color:var(--cd-green)">बिल देखें</button></div></div>`;
  }).join('') : '<p class="text-slate-400">अभी कोई ऑर्डर नहीं</p>';
  $('accountModal').classList.remove('hidden');
}
async function saveProfile() {
  await run(async () => { const r = await api('/me', 'PUT', { name: $('profName').value, phone: $('profPhone').value }); ME.user = r.user; renderAll(); toast('👤 प्रोफ़ाइल अपडेट हो गई!'); });
}
async function setPayPref(m) { await run(async () => { const r = await api('/me', 'PUT', { pay_pref: m }); ME.user = r.user; openAccount(); toast('पेमेंट तरीका बदल गया'); }); }
let ST = null;
async function loadStats() { try { ST = await api('/me/stats'); } catch { ST = null; } return ST; }
function paintRefStats() { if (!ST) return; $('refPend').textContent = ST.referrals.pending; $('refOk').textContent = ST.referrals.successful; $('refEarn').textContent = '₹' + ST.referrals.earned; }
function openOffers() {
  const cs = C.coupons || [];
  $('offersList').innerHTML = (cs.length ? cs.map(c => `<div class="rounded-2xl p-3.5 border" style="background:var(--cd-green-light)"><span class="text-[9px] font-extrabold px-2 py-0.5 rounded bg-emerald-600 text-white">HOT DEAL</span>
    <h4 class="font-extrabold text-sm mt-1.5">${E(c.descr)}</h4>
    <p class="text-[11px] text-slate-600 mt-0.5">₹${c.min_amount} या ज़्यादा का रिचार्ज करने पर ₹${c.bonus} कैशबैक</p>
    <div class="flex items-center justify-between mt-2"><span class="text-[10px] text-slate-500">${c.valid_till ? '*ऑफ़र ' + fmtDate(c.valid_till) + ' तक मान्य' : '*सीमित समय के लिए'}</span><button onclick="$('offersModal').classList.add('hidden');openWalletModal('${E(c.code)}',${+c.min_amount})" class="text-xs font-extrabold text-white px-3 py-1.5 rounded-lg" style="background:var(--cd-green)">कोड ${E(c.code)} लगाएं</button></div></div>`).join('') : '<p class="text-slate-400 text-xs text-center py-6">अभी कोई ऑफ़र नहीं है। जल्दी वापस देखें!</p>');
  $('offersModal').classList.remove('hidden');
}
function shareRef() { const url = location.origin + '/?ref=' + ME.user.ref_code; window.open('https://wa.me/?text=' + encodeURIComponent(`🥛 ${(C.shop || {}).name || 'आज की धार'} से सुबह ताज़ा दूध मंगाइए! मेरा रेफ़रल कोड ${ME.user.ref_code} इस्तेमाल करें: ${url}`), '_blank'); }

// ---------------------------------------------------------------- VIP
function openVipModal() {
  const vipTxt = () => (isVipNow() ? `✅ आपका VIP चालू है${ME.user.vip_until ? ' — ' + fmtDate(ME.user.vip_until) + ' तक' : ''}` : '') + (ST && ST.saved > 0 ? `${isVipNow() ? ' • ' : ''}💰 अब तक कुल बचत ₹${ST.saved}` : '');
  $('vipStatusLine').textContent = vipTxt();
  if (ME) loadStats().then(() => { $('vipStatusLine').textContent = vipTxt(); });
  $('vipPlansBox').innerHTML = (C.vip_plans || []).map((p, i) => `<div onclick="buyVip(${p.days})" class="p-3 rounded-2xl border-2 flex justify-between items-center cursor-pointer ${i === 1 ? 'border-amber-400 bg-amber-50/60' : 'border-slate-200 bg-white'}"><div><b>${E(p.label)} VIP पास</b><span class="block text-[10px] text-slate-500">${p.days} दिन • फ्री डिलीवरी + सबसे कम रेट</span></div><span class="font-extrabold text-sm" style="color:var(--cd-green)">₹${p.price}</span></div>`).join('');
  $('vipModal').classList.remove('hidden');
}
async function buyVip(days) {
  if (needLogin()) return;
  const p = C.vip_plans.find(x => x.days === days);
  if (!confirm(`${p.label} VIP पास ₹${p.price} में लें? रकम वॉलेट से कटेगी।`)) return;
  await run(async () => { const r = await api('/vip/buy', 'POST', { days }); ME.user = r.user; await refreshMe(); renderAll(); await loadBag(); $('vipModal').classList.add('hidden'); toast('🎉 बधाई हो! VIP Membership एक्टिव हो गई!'); });
}

// ---------------------------------------------------------------- WALLET / UPI
async function openWalletModal(code, amt) {
  if (needLogin()) return;
  await refreshMe(); await loadBag();
  const u = ME.user;
  $('walTotalShow').textContent = balance(); $('walMainShow').textContent = u.wallet_main; $('walCbShow').textContent = u.wallet_cb;
  $('walTomorrowBill').textContent = bag && bag.total ? bag.total : 0; $('walBillLbl').textContent = dInfo(calIdx).label + ' का बिल';
  $('rechargeBox').classList.toggle('hidden', !C.payments.upi);
  const presets = [{ a: 300, c: '' }, ...(C.coupons || []).slice(0, 3).map(c => ({ a: c.min_amount, c: c.code, b: c.bonus }))];
  $('rchPresets').innerHTML = presets.map((x, i) => `<button onclick="setRch(${x.a},'${E(x.c)}')" class="p-2 border-2 rounded-xl font-extrabold ${i === 1 ? '' : ''}" style="${x.c ? 'background:var(--cd-green-light);border-color:var(--cd-green)' : ''}">₹${x.a}${x.c ? `<span class="block text-[8px] text-emerald-700">+₹${x.b} CB</span>` : ''}</button>`).join('');
  if (code) setRch(amt, code);
  $('pendingTopups').innerHTML = ME.topups.filter(t => t.status === 'pending').map(t => `<div class="bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-amber-900">⏳ ₹${t.amount} (UTR ${E(t.utr)}) — एडमिन वेरिफिकेशन बाकी</div>`).join('');
  $('passbookList').innerHTML = ME.txns.length ? ME.txns.map(t => `<div class="flex justify-between py-1.5 border-b border-slate-100"><span><b>${E(t.title)}</b> <span class="text-[9px] text-slate-400 block">${new Date(t.created_at).toLocaleString('hi-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} • ${t.wallet === 'cb' ? 'कैशबैक' : 'मेन'}</span></span><b class="${t.kind === 'cr' ? 'text-emerald-600' : 'text-rose-600'}">${t.kind === 'cr' ? '+' : '-'}₹${t.amount}</b></div>`).join('') : '<p class="text-slate-400">अभी कोई लेन-देन नहीं</p>';
  $('walletModal').classList.remove('hidden');
}
function setRch(a, c) { $('rchAmt').value = a; $('rchCode').value = c; }
function buildUpi(amt, forOrder) {
  const P = C.payments;
  if (!P.upi_id && !P.qr_url) { toast('UPI अभी सेट नहीं है, सपोर्ट से संपर्क करें', true); return false; }
  const uri = `upi://pay?pa=${encodeURIComponent(P.upi_id || '')}&pn=${encodeURIComponent(P.merchant_name || 'Shop')}&am=${amt}&cu=INR&tn=${encodeURIComponent(forOrder ? 'Order' : 'Wallet')}`;
  $('upiQrImg').src = P.qr_url || `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(uri)}`;
  $('upiAmtShow').textContent = amt; $('upiIdTxt').textContent = P.upi_id || '—'; $('upiPayLink').href = uri; $('upiUtr').value = '';
  return true;
}
function openUpiQr() {
  const amt = Number($('rchAmt').value) || 0, code = $('rchCode').value.trim().toUpperCase();
  if (amt < 10) return toast('कम से कम ₹10 डालें', true);
  const c = (C.coupons || []).find(x => x.code === code && amt >= x.min_amount);
  if (!buildUpi(amt, false)) return;
  upiMode = { type: 'topup', amt, code: c ? code : '' };
  $('upiCbTag').textContent = code ? (c ? `🎁 कूपन ${code} लागू: +₹${c.bonus} कैशबैक मिलेगा!` : '⚠️ कूपन लागू नहीं (रकम कम या कोड गलत)') : 'कोई कूपन लागू नहीं';
  $('upiModal').classList.remove('hidden');
}
function openOrderUpi(id, amt) { if (!buildUpi(amt, true)) return; upiMode = { type: 'order', id }; $('upiCbTag').textContent = 'ऑर्डर का सीधा UPI पेमेंट'; $('upiModal').classList.remove('hidden'); }
async function submitTopup() {
  const utr = $('upiUtr').value.trim(); if (!utr) return toast('UTR नंबर डालें', true);
  $('upiSubmitBtn').disabled = true;
  await run(async () => {
    if (upiMode.type === 'topup') await api('/topup', 'POST', { amount: upiMode.amt, coupon_code: upiMode.code, utr });
    else await api('/orders/' + upiMode.id + '/utr', 'POST', { utr });
    $('upiModal').classList.add('hidden'); toast('✅ UTR जमा हो गया — एडमिन वेरिफाई करेगा');
    await refreshMe(); renderAll(); await loadBag(); if (upiMode.type === 'topup') openWalletModal();
  });
  $('upiSubmitBtn').disabled = false;
}

// ---------------------------------------------------------------- RECEIPT
async function showReceipt(id) {
  await run(async () => {
    const { order: o, shop } = await api('/orders/' + id);
    $('printArea').innerHTML = `
      <div class="flex justify-between items-start border-b pb-2"><div><h4 class="font-extrabold text-sm text-slate-900">${E(shop.name)} <span class="text-[10px] font-normal">(${E(shop.tagline || '')})</span></h4><p class="text-[10px] text-slate-500">${E(shop.address || '')} ${shop.phone ? '• 📞 ' + E(shop.phone) : ''}</p></div>
      <span class="bg-emerald-100 text-emerald-800 text-[10px] font-extrabold px-2 py-0.5 rounded">${PAYST[o.pay_status] || ''}</span></div>
      <div class="text-[11px] text-slate-600"><b>बिल नं:</b> ${E(o.order_no)}<br><b>डिलीवरी तारीख़:</b> ${fmtDate(o.delivery_date)}<br><b>ग्राहक:</b> ${E(o.customer_name)} (${E(o.customer_phone)})<br><b>पता:</b> ${E(o.flat)}, ${E(o.society_name)}</div>
      <div class="space-y-1 text-[11px] border-t pt-2">${o.order_items.map(i => `<div class="flex justify-between"><span>${E(i.name)} (${E(i.unit)}) × ${i.qty} @ ₹${i.rate}</span><b>₹${money(i.qty * i.rate)}</b></div>`).join('')}</div>
      <div class="border-t pt-2 space-y-0.5 text-[11px]"><div class="flex justify-between"><span>सबटोटल</span><span>₹${o.subtotal}</span></div><div class="flex justify-between"><span>डिलीवरी शुल्क</span><span>${o.fee ? '₹' + o.fee : 'FREE'}</span></div>
      <div class="flex justify-between font-extrabold text-slate-900 text-xs"><span>कुल बिल (Total)</span><span>₹${o.total}</span></div></div>
      <div class="text-[10px] text-slate-500">पेमेंट: ${PAYLBL[o.pay_method]}${o.utr ? ' • UTR ' + E(o.utr) : ''} • स्टेटस: ${(STATUS[o.status] || [o.status])[0]}</div>
      <p class="text-center text-[10px] text-slate-400">धन्यवाद! 🙏 ${E(shop.name)}</p>`;
    $('receiptModal').classList.remove('hidden');
  });
}

// ---------------------------------------------------------------- HELP
function openHelp(focus) {
  const s = C.shop || {}, tel = (s.phone || '').replace(/\D/g, ''), wa = (s.whatsapp || '').replace(/\D/g, '');
  const btn = (href, icon, txt, color) => href ? `<a href="${href}" target="_blank" class="${color} text-white font-extrabold py-2.5 rounded-xl text-center"><i class="${icon} block text-lg mb-0.5"></i>${txt}</a>` : `<span class="bg-slate-200 text-slate-400 font-extrabold py-2.5 rounded-xl text-center"><i class="${icon} block text-lg mb-0.5"></i>${txt}</span>`;
  $('helpContact').innerHTML = btn(tel ? 'tel:+91' + tel.slice(-10) : '', 'fa-solid fa-phone', 'कॉल करें', 'bg-sky-600') + btn(wa ? 'https://wa.me/' + (wa.length === 10 ? '91' + wa : wa) : '', 'fa-brands fa-whatsapp', 'WhatsApp', 'bg-emerald-600') + btn(s.email ? 'mailto:' + s.email : '', 'fa-solid fa-envelope', 'ईमेल', 'bg-slate-700');
  $('helpHours').textContent = s.hours ? '🕒 सपोर्ट समय: ' + s.hours : '';
  $('faqBox').innerHTML = (C.faq || []).map(f => `<details class="border rounded-xl p-2.5 bg-slate-50"><summary class="font-extrabold text-slate-800 flex justify-between">${E(f.q)}<i class="fa-solid fa-chevron-down text-[10px] text-slate-400"></i></summary><p class="text-slate-600 mt-1.5 leading-relaxed">${E(f.a)}</p></details>`).join('') || '<p class="text-slate-400">जल्द आ रहा है</p>';
  const orders = (ME?.orders || []).filter(o => o.status !== 'cancelled');
  $('rfOrder').innerHTML = '<option value="">-- ऑर्डर चुनें (वैकल्पिक) --</option>' + orders.map(o => `<option value="${o.id}">${E(o.order_no)} • ${fmtDate(o.delivery_date)} • ₹${o.total}</option>`).join('');
  $('refundForm').classList.toggle('hidden', !ME); $('ticketForm').classList.toggle('hidden', !ME);
  const rs = { pending: 'विचाराधीन', approved: 'स्वीकृत', rejected: 'अस्वीकृत', open: 'खुला', closed: 'जवाब मिला' };
  $('myTickets').innerHTML = ME ? [...ME.refunds.map(r => `<div class="border rounded-lg p-2">🔁 रिफंड ₹${r.amount} — <b>${rs[r.status]}</b> <span class="text-slate-500">${E(r.admin_note || '')}</span></div>`), ...ME.tickets.map(t => `<div class="border rounded-lg p-2">💬 <b>${E(t.subject)}</b> — ${rs[t.status]}${t.reply ? `<p class="text-emerald-700 mt-1">जवाब: ${E(t.reply)}</p>` : ''}</div>`)].join('') : '<p class="text-center text-slate-500">रिफंड/संदेश भेजने के लिए लॉगिन करें</p>';
  $('helpModal').classList.remove('hidden');
  if (focus === 'refund') setTimeout(() => $('refundForm').scrollIntoView({ behavior: 'smooth' }), 100);
}
async function submitRefund() {
  await run(async () => { await api('/refunds', 'POST', { order_id: $('rfOrder').value || null, reason: $('rfReason').value, amount: $('rfAmt').value }); $('rfReason').value = ''; $('rfAmt').value = ''; toast('✅ रिफंड रिक्वेस्ट भेज दी गई'); await refreshMe(); openHelp(); });
}
async function submitTicket() {
  await run(async () => { await api('/support', 'POST', { subject: $('tkSubject').value, message: $('tkMsg').value }); $('tkSubject').value = ''; $('tkMsg').value = ''; toast('✅ संदेश भेज दिया गया'); await refreshMe(); openHelp(); });
}
function openPolicy(k) {
  const t = { terms: 'नियम और शर्तें', privacy: 'प्राइवेसी पॉलिसी', refund: 'रिफंड पॉलिसी' };
  $('policyTitle').textContent = t[k]; $('policyBody').textContent = (C.policies || {})[k] || ''; $('policyModal').classList.remove('hidden');
}

// ---------------------------------------------------------------- logo 5-tap, clock, search hints
let lTaps = 0, lTimer;
function tapLogo() { lTaps++; clearTimeout(lTimer); if (lTaps >= 5) { lTaps = 0; if (!ME) openLogin(); else if (['admin', 'rider'].includes(ME.user.role)) openAdmin(); } else lTimer = setTimeout(() => lTaps = 0, 1600); }
const hints = ['खोजें "गाय का दूध (A2 Cow Milk)"...', 'खोजें "भैंस का ताज़ा दूध"...', 'खोजें "दानेदार देसी घी"...', 'खोजें "मटका दही और मलाई पनीर"...', 'खोजें "ब्रेड और अंडे"...', 'खोजें "नारियल पानी"...'];
let hIdx = 0;
setInterval(() => { hIdx = (hIdx + 1) % hints.length; const i = $('cdSearchInp'); if (i && document.activeElement !== i) i.placeholder = hints[hIdx]; }, 2800);
setInterval(() => {
  const el = $('cutoffClock'); if (!el || !C) return;
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(new Date());
  const g = t => +f.find(x => x.type === t).value % (t === 'hour' ? 24 : 60);
  const [ch, cm] = String((C.delivery || {}).cutoff || '23:59').split(':').map(Number);
  let d = (ch * 3600 + cm * 60) - (g('hour') * 3600 + g('minute') * 60 + g('second')); if (d < 0) d += 86400;
  const p = n => String(n).padStart(2, '0');
  el.textContent = `⏳ ${p(Math.floor(d / 3600))}:${p(Math.floor(d % 3600 / 60))}:${p(d % 60)}`;
}, 1000);

// ---------------------------------------------------------------- start
(async () => {
  try { await loadConfig(); await refreshMe(); renderAll(); await loadBag(); }
  catch (e) { document.body.insertAdjacentHTML('afterbegin', `<div class="bg-rose-600 text-white text-xs p-3 text-center">सर्वर से कनेक्ट नहीं हो पाया: ${E(e.message)}</div>`); }
  if (!ME && new URLSearchParams(location.search).get('ref')) openLogin();
})();
