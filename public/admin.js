/* =====================================================================
   आज की धार — एडमिन + राइडर पैनल
   सारी जाँच सर्वर पर होती है; यहाँ सिर्फ़ स्क्रीन है।
   ===================================================================== */
const IN = 'bg-slate-950 border border-slate-800 rounded-xl p-2 text-white w-full';
const BTN = 'font-extrabold px-3 py-2 rounded-xl text-xs';
const CARD = 'bg-slate-900 border border-slate-800 rounded-2xl p-4';
let AD = { tab: 'disp', date: null }, ADIMGS = {};

const ADMIN_TABS = [['disp', '📊 डिस्पैच & ऑर्डर'], ['pay', '💰 रिचार्ज / रिफंड / सपोर्ट'], ['prod', '📦 प्रोडक्ट्स'], ['cat', '🎨 बैनर, कूपन, कैटेगरी'], ['ppl', '👥 कस्टमर & स्टाफ'], ['rep', '📑 रिपोर्ट (CSV)'], ['set', '⚙️ सेटिंग्स']];

function openAdmin() {
  if (!ME || !['admin', 'rider'].includes(ME.user.role)) return toast('अनुमति नहीं है', true);
  const isAdmin = ME.user.role === 'admin';
  $('admTitle').textContent = isAdmin ? '🔐 मास्टर एडमिन कमांड सेंटर' : '🚴 राइडर डिलीवरी शीट';
  $('admSub').textContent = `${ME.user.name || ME.user.email} • ${isAdmin ? 'Admin' : 'Rider'}`;
  AD.tabs = isAdmin ? ADMIN_TABS : [['disp', '🚴 मेरी डिलीवरी']];
  if (!AD.tabs.find(t => t[0] === AD.tab)) AD.tab = 'disp';
  $('adminModal').classList.remove('hidden'); admTab(AD.tab);
}
function admTab(t) {
  AD.tab = t;
  $('admTabs').innerHTML = AD.tabs.map(x => `<button onclick="admTab('${x[0]}')" class="px-3.5 py-2 rounded-xl whitespace-nowrap ${x[0] === t ? 'bg-amber-400 text-slate-950 font-extrabold' : 'text-slate-300'}">${x[1]}</button>`).join('');
  $('admBody').innerHTML = '<p class="text-slate-400 text-xs p-4">लोड हो रहा है...</p>';
  ({ disp: admDisp, pay: admPay, prod: admProd, cat: admCat, ppl: admPpl, rep: admRep, set: admSet })[t]().catch(e => { $('admBody').innerHTML = `<p class="text-rose-400 text-xs p-4">${E(e.message)}</p>`; });
}
const adm = (m, p, b) => api('/admin' + p, m, b);
const waLink = (ph, txt) => `https://wa.me/${(ph || '').replace(/\D/g, '').length === 10 ? '91' + ph.replace(/\D/g, '') : (ph || '').replace(/\D/g, '')}?text=${encodeURIComponent(txt)}`;

// ---------------------------------------------------------------- 1. डिस्पैच
async function admDisp() {
  const isAdmin = ME.user.role === 'admin';
  const date = AD.date || C.next_date; AD.date = date;
  let orders, riders = [], dash = null;
  if (isAdmin) { const [o, d] = await Promise.all([adm('GET', '/orders?date=' + date), adm('GET', '/dashboard?date=' + date)]); orders = o.orders; riders = o.riders; dash = d; }
  else orders = (await api('/rider/orders?date=' + date)).orders;
  AD.orders = orders; AD.riders = riders;
  const live = orders.filter(o => o.status !== 'cancelled');
  // पैकिंग सारांश
  const pack = {}; live.forEach(o => o.order_items.forEach(i => { const k = i.name + ' (' + i.unit + ')'; pack[k] = (pack[k] || 0) + i.qty; }));
  const bySoc = {}; live.forEach(o => { (bySoc[o.society_name || '— सोसायटी नहीं —'] = bySoc[o.society_name || '— सोसायटी नहीं —'] || []).push(o); });
  const kpi = (l, v, c) => `<div class="${CARD} !p-3.5"><span class="text-slate-400 text-xs">${l}</span><p class="text-2xl font-extrabold ${c} mt-1">${v}</p></div>`;
  let h = `<div class="${CARD} flex flex-wrap items-center gap-2 text-xs"><b class="text-amber-400">डिलीवरी तारीख़:</b><input type="date" id="admDate" value="${date}" class="${IN} !w-auto"><button onclick="AD.date=$('admDate').value;admTab('disp')" class="${BTN} bg-amber-400 text-slate-950">दिखाएं</button>${isAdmin ? `<button onclick="admRunCheckout()" class="${BTN} bg-emerald-600 text-white ml-auto"><i class="fa-solid fa-bolt mr-1"></i>इस तारीख़ का ऑटो-चेकआउट अभी चलाएं</button>` : ''}</div>`;
  if (dash) {
    h += `<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">${kpi('ऑर्डर', dash.orders, 'text-white')}${kpi('कुल बिल', '₹' + dash.revenue, 'text-emerald-400')}${kpi('होल्ड (बैलेंस कम)', dash.held, 'text-rose-400')}${kpi('एक्टिव सब्सक्रिप्शन', dash.subs, 'text-amber-400')}${kpi('कस्टमर', dash.customers, 'text-sky-400')}${kpi('वॉलेट में कुल', '₹' + dash.wallet_total, 'text-sky-400')}${kpi('वेरिफाई बाकी रिचार्ज', dash.pending_topups + dash.verify_orders, 'text-amber-400')}${kpi('खुले रिफंड/टिकट', dash.pending_refunds + dash.open_tickets, 'text-rose-400')}</div>`;
    h += `<div class="grid md:grid-cols-2 gap-3 text-xs"><div class="${CARD}"><h3 class="font-extrabold text-rose-400 mb-2">⚠️ लो-स्टॉक अलर्ट</h3>${dash.low_stock.length ? dash.low_stock.map(p => `<div class="flex justify-between py-1 border-b border-slate-800"><span>${E(p.name)}</span><b class="text-rose-300">${p.stock_qty} बचे</b></div>`).join('') : '<p class="text-slate-500">सब ठीक है ✅</p>'}</div>
      <div class="${CARD}"><h3 class="font-extrabold text-amber-400 mb-2">⚠️ लो-बैलेंस कस्टमर</h3>${dash.low_balance.length ? dash.low_balance.slice(0, 20).map(c => `<div class="flex justify-between items-center py-1 border-b border-slate-800"><span>${E(c.name || c.email)} <span class="text-slate-500">${E(c.phone)}</span></span><span class="flex items-center gap-2"><b class="text-amber-300">₹${c.bal}</b><a target="_blank" href="${waLink(c.phone, `नमस्ते ${c.name || ''}, आपके वॉलेट में ₹${c.bal} बचे हैं। कृपया रिचार्ज कर लें ताकि सुबह की डिलीवरी न रुके। 🥛`)}" class="text-emerald-400"><i class="fa-brands fa-whatsapp"></i></a></span></div>`).join('') : '<p class="text-slate-500">सबके बैलेंस ठीक हैं ✅</p>'}</div></div>`;
  }
  h += `<div class="${CARD} text-xs"><h3 class="font-extrabold text-amber-400 mb-2">📦 कुल पैकिंग (${live.length} ऑर्डर)</h3>${Object.keys(pack).length ? Object.entries(pack).map(([k, v]) => `<div class="flex justify-between py-1 border-b border-slate-800"><span>${E(k)}</span><b class="text-emerald-300">${v} पैक</b></div>`).join('') : '<p class="text-slate-500">इस तारीख़ के लिए कोई ऑर्डर नहीं।</p>'}</div>`;
  if (isAdmin && riders.length) {
    h += `<div class="${CARD} text-xs space-y-2"><h3 class="font-extrabold text-sky-400">🚴 राइडर असाइन / WhatsApp डिस्पैच</h3>${riders.map(r => `<div class="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-2"><b class="w-32">${E(r.name || r.email)}</b>
      <select id="asg_${r.id}" class="${IN} !w-auto"><option value="">पूरी लिस्ट</option>${Object.keys(bySoc).map(s => `<option>${E(s)}</option>`).join('')}</select>
      <button onclick="admAssign('${r.id}')" class="${BTN} bg-sky-600 text-white">असाइन करें</button>
      <button onclick="admDispatchWA('${r.id}')" class="${BTN} bg-emerald-600 text-white"><i class="fa-brands fa-whatsapp mr-1"></i>शीट भेजें</button></div>`).join('')}</div>`;
  } else if (isAdmin) h += `<p class="text-xs text-slate-400">राइडर जोड़ने के लिए "कस्टमर & स्टाफ" टैब में राइडर का ईमेल जोड़ें।</p>`;
  h += Object.entries(bySoc).map(([soc, list]) => `<div class="${CARD} text-xs space-y-2"><h3 class="font-extrabold text-amber-400">🏢 ${E(soc)} (${list.length})</h3>${list.map(o => orderCard(o, isAdmin)).join('')}</div>`).join('');
  $('admBody').innerHTML = h;
}
function orderCard(o, isAdmin) {
  const st = STATUS[o.status] || [o.status, ''], due = o.pay_method === 'cod' && o.pay_status !== 'paid';
  const statusBtns = isAdmin
    ? `<select onchange="admOrderSet(${o.id},{status:this.value})" class="${IN} !w-auto">${Object.keys(STATUS).map(k => `<option value="${k}" ${k === o.status ? 'selected' : ''}>${STATUS[k][0]}</option>`).join('')}</select>
       <select onchange="admOrderSet(${o.id},{rider_id:this.value})" class="${IN} !w-auto"><option value="">राइडर?</option>${(AD.riders || []).map(r => `<option value="${r.id}" ${r.id === o.rider_id ? 'selected' : ''}>${E(r.name || r.email)}</option>`).join('')}</select>`
    : (o.status !== 'delivered' ? `<button onclick="riderSet(${o.id},'out_for_delivery')" class="${BTN} bg-indigo-600 text-white">रास्ते में</button><button onclick="riderSet(${o.id},'delivered')" class="${BTN} bg-emerald-600 text-white">डिलीवर हो गया${due ? ' (₹' + o.total + ' कैश लिया)' : ''}</button>` : '<b class="text-emerald-400">डिलीवर ✅</b>');
  return `<div class="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-1.5">
    <div class="flex flex-wrap justify-between gap-2"><div><b class="text-white">${E(o.customer_name || '—')}</b> • <a class="text-sky-300" href="tel:${E(o.customer_phone)}">${E(o.customer_phone)}</a> • ${E(o.flat)}<br><span class="text-slate-500">${E(o.order_no)}</span></div><span class="px-2 py-0.5 rounded h-fit text-[10px] font-extrabold ${st[1]}">${st[0]}</span></div>
    <div class="text-slate-300">${o.order_items.map(i => `${E(i.name)} <b>×${i.qty}</b>`).join(' • ')}</div>
    <div class="text-slate-400">${E(o.deliv_pref)}</div>
    <div class="flex flex-wrap items-center gap-2"><b class="text-emerald-300">₹${o.total}</b><span class="text-slate-400">${PAYLBL[o.pay_method]} • ${PAYST[o.pay_status] || ''}${o.utr ? ' • UTR ' + E(o.utr) : ''}</span>${statusBtns}
      ${isAdmin ? `<button onclick="showReceipt(${o.id})" class="${BTN} bg-slate-700 text-white"><i class="fa-solid fa-receipt"></i></button>` : ''}${isAdmin && o.pay_status !== 'paid' && o.status !== 'cancelled' ? `<button onclick="admOrderSet(${o.id},{pay_status:'paid'})" class="${BTN} bg-amber-500 text-slate-950">पेड मार्क करें</button>` : ''}</div></div>`;
}
async function admOrderSet(id, patch) { await run(async () => { await adm('PATCH', '/orders/' + id, patch); toast('✅ अपडेट हो गया'); admTab('disp'); }); }
async function riderSet(id, status) { await run(async () => { await api('/rider/orders/' + id, 'PATCH', { status }); toast('✅ अपडेट हो गया'); admTab('disp'); }); }
async function admAssign(rid) { await run(async () => { await adm('POST', '/assign-riders', { date: AD.date, rider_id: rid, society_name: $('asg_' + rid).value }); toast('🚴 असाइन हो गया'); admTab('disp'); }); }
function admDispatchWA(rid) {
  const r = AD.riders.find(x => x.id === rid); const mine = AD.orders.filter(o => o.rider_id === rid && o.status !== 'cancelled');
  if (!mine.length) return toast('इस राइडर को कोई ऑर्डर असाइन नहीं है', true);
  if (!r.phone) return toast('राइडर का मोबाइल नंबर प्रोफ़ाइल में नहीं है', true);
  let t = `*🥛 ${(C.shop || {}).name} - डिलीवरी शीट*\n📅 ${fmtDate(AD.date)}\n------------------\n`;
  mine.forEach((o, i) => { t += `${i + 1}. *${o.customer_name}* (${o.customer_phone})\n   📍 ${o.flat}, ${o.society_name}\n   ${o.order_items.map(x => x.name + ' ×' + x.qty).join(', ')}\n   💰 ₹${o.total} ${o.pay_method === 'cod' && o.pay_status !== 'paid' ? '(कैश लेना है)' : '(' + PAYST[o.pay_status] + ')'}\n   🔔 ${o.deliv_pref}\n`; });
  window.open(waLink(r.phone, t), '_blank');
}
async function admRunCheckout() { if (!confirm(`${fmtDate(AD.date)} के लिए सबके ऑर्डर बनाकर वॉलेट से बिल काटें?`)) return; await run(async () => { const r = await adm('POST', '/run-checkout', { date: AD.date }); toast(r.skipped ? 'इस तारीख़ का चेकआउट पहले ही हो चुका है' : `🚀 ${r.created} ऑर्डर बने, ${r.held} होल्ड`); admTab('disp'); }); }

// ---------------------------------------------------------------- 2. रिचार्ज / रिफंड / सपोर्ट
async function admPay() {
  const [tp, vo, rf, tk] = await Promise.all([adm('GET', '/topups?status=pending'), adm('GET', '/orders?verify=1'), adm('GET', '/refunds'), adm('GET', '/tickets')]);
  const nm = u => E(u ? (u.name || u.email) : '—') + (u && u.phone ? ' • ' + E(u.phone) : '');
  $('admBody').innerHTML = `
  <div class="${CARD} text-xs space-y-2"><h3 class="font-extrabold text-amber-400">💰 वेरिफाई बाकी वॉलेट रिचार्ज (${tp.topups.length})</h3>
    <p class="text-slate-400">अपने बैंक/UPI ऐप में UTR और रकम मिलाकर ही अप्रूव करें।</p>
    ${tp.topups.map(t => `<div class="bg-slate-950 border border-slate-800 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2"><div><b>${nm(t.users)}</b><br>रकम <b class="text-emerald-300">₹${t.amount}</b>${t.bonus ? ` + ₹${t.bonus} कैशबैक (${E(t.coupon_code)})` : ''}<br>UTR: <b class="text-amber-300 tracking-wider">${E(t.utr)}</b></div>
      <div class="flex gap-2"><button onclick="admTopup(${t.id},'approve')" class="${BTN} bg-emerald-600 text-white">✅ अप्रूव</button><button onclick="admTopup(${t.id},'reject')" class="${BTN} bg-rose-600 text-white">❌ रिजेक्ट</button></div></div>`).join('') || '<p class="text-slate-500">कुछ बाकी नहीं ✅</p>'}</div>
  <div class="${CARD} text-xs space-y-2"><h3 class="font-extrabold text-amber-400">🧾 ऑर्डर का UPI पेमेंट वेरिफाई (${vo.orders.length})</h3>
    ${vo.orders.map(o => `<div class="bg-slate-950 border border-slate-800 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2"><div><b>${E(o.customer_name)}</b> • ${E(o.order_no)}<br>₹${o.total} • UTR <b class="text-amber-300">${E(o.utr)}</b></div><div class="flex gap-2"><button onclick="admVerifyOrder(${o.id},true)" class="${BTN} bg-emerald-600 text-white">✅ पेड</button><button onclick="admVerifyOrder(${o.id},false)" class="${BTN} bg-rose-600 text-white">❌ फ़ेल</button></div></div>`).join('') || '<p class="text-slate-500">कुछ बाकी नहीं ✅</p>'}</div>
  <div class="${CARD} text-xs space-y-2"><h3 class="font-extrabold text-amber-400">🔁 रिफंड रिक्वेस्ट</h3>
    ${rf.refunds.map(r => `<div class="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-1.5"><div class="flex justify-between"><b>${nm(r.users)}</b><span class="text-[10px] ${r.status === 'pending' ? 'text-amber-300' : r.status === 'approved' ? 'text-emerald-300' : 'text-rose-300'}">${r.status}</span></div><p class="text-slate-300">${E(r.reason)}${r.orders ? ` <span class="text-slate-500">(${E(r.orders.order_no)})</span>` : ''}</p>
      ${r.status === 'pending' ? `<div class="flex flex-wrap gap-2 items-center"><input id="rfa_${r.id}" type="number" value="${r.amount}" class="${IN} !w-24"><input id="rfn_${r.id}" placeholder="नोट (वैकल्पिक)" class="${IN} !w-40"><button onclick="admRefund(${r.id},'approve')" class="${BTN} bg-emerald-600 text-white">रिफंड दें</button><button onclick="admRefund(${r.id},'reject')" class="${BTN} bg-rose-600 text-white">मना करें</button></div>` : `<p class="text-slate-500">₹${r.amount} ${E(r.admin_note)}</p>`}</div>`).join('') || '<p class="text-slate-500">कोई रिक्वेस्ट नहीं</p>'}</div>
  <div class="${CARD} text-xs space-y-2"><h3 class="font-extrabold text-amber-400">💬 सपोर्ट टिकट</h3>
    ${tk.tickets.map(t => `<div class="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-1.5"><div class="flex justify-between"><b>${E(t.subject)}</b><span class="${t.status === 'open' ? 'text-amber-300' : 'text-emerald-300'}">${t.status}</span></div><p class="text-slate-300">${E(t.message)}</p><p class="text-slate-500">${nm(t.users)}</p>
      ${t.status === 'open' ? `<div class="flex gap-2"><input id="tkr_${t.id}" placeholder="जवाब लिखें (ईमेल पर जाएगा)" class="${IN}"><button onclick="admReply(${t.id})" class="${BTN} bg-sky-600 text-white shrink-0">भेजें</button></div>` : `<p class="text-emerald-300">जवाब: ${E(t.reply)}</p>`}</div>`).join('') || '<p class="text-slate-500">कोई टिकट नहीं</p>'}</div>`;
}
async function admTopup(id, act) { let note = ''; if (act === 'reject') { note = prompt('रिजेक्ट का कारण (ग्राहक को ईमेल जाएगा):') ?? null; if (note === null) return; } await run(async () => { await adm('POST', `/topups/${id}/${act}`, { note }); toast('✅ हो गया'); admTab('pay'); }); }
async function admVerifyOrder(id, ok) { await run(async () => { await adm('POST', `/orders/${id}/verify-pay`, { ok }); admTab('pay'); }); }
async function admRefund(id, act) { await run(async () => { await adm('POST', `/refunds/${id}/${act}`, { amount: $('rfa_' + id)?.value, note: $('rfn_' + id)?.value }); toast('✅ हो गया'); admTab('pay'); }); }
async function admReply(id) { await run(async () => { await adm('POST', `/tickets/${id}/reply`, { reply: $('tkr_' + id).value }); toast('✅ जवाब भेज दिया'); admTab('pay'); }); }

// ---------------------------------------------------------------- फ़ोटो अपलोड (छोटा करके)
function pickImages() {
  return new Promise(resolve => {
    const f = document.createElement('input'); f.type = 'file'; f.accept = 'image/*'; f.multiple = true;
    f.onchange = async () => {
      const urls = [];
      for (const file of f.files) {
        try { const dataUrl = await shrink(file, 1000); const r = await adm('POST', '/upload', { dataUrl }); urls.push(r.url); } catch (e) { toast(file.name + ': ' + e.message, true); }
      }
      resolve(urls);
    };
    f.click();
  });
}
function shrink(file, max) {
  return new Promise((res, rej) => {
    const img = new Image(), fr = new FileReader();
    fr.onload = () => { img.src = fr.result; };
    img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = img.width * k; c.height = img.height * k; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', 0.85)); };
    img.onerror = () => rej(new Error('फ़ोटो पढ़ी नहीं गई')); fr.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------- 3. प्रोडक्ट्स
function imgsBox(key) {
  const arr = ADIMGS[key] || [];
  return `<div class="space-y-1.5"><div class="flex flex-wrap gap-2">${arr.map((u, i) => `<div class="relative"><img src="${E(u)}" class="w-16 h-16 object-cover rounded-lg border ${i === 0 ? 'border-amber-400' : 'border-slate-700'}"><button onclick="imgDel('${key}',${i})" class="absolute -top-1.5 -right-1.5 bg-rose-600 rounded-full w-5 h-5 text-[10px]">✕</button>${i > 0 ? `<button onclick="imgFirst('${key}',${i})" class="absolute bottom-0 inset-x-0 bg-black/60 text-[8px]">पहली करें</button>` : '<span class="absolute bottom-0 inset-x-0 bg-amber-400 text-slate-950 text-[8px] text-center font-extrabold">मुख्य</span>'}</div>`).join('') || '<span class="text-slate-500">कोई फ़ोटो नहीं</span>'}</div>
  <div class="flex gap-2"><button onclick="imgUpload('${key}')" class="${BTN} bg-sky-600 text-white"><i class="fa-solid fa-upload mr-1"></i>फ़ोटो अपलोड (कई चुन सकते हैं)</button><button onclick="imgUrl('${key}')" class="${BTN} bg-slate-700 text-white">URL से जोड़ें</button></div></div>`;
}
async function imgUpload(key) { const u = await pickImages(); if (u.length) { ADIMGS[key] = [...(ADIMGS[key] || []), ...u]; refreshImgBox(key); } }
function imgUrl(key) { const u = prompt('फ़ोटो का लिंक (https://...):'); if (u && /^https?:\/\//.test(u)) { ADIMGS[key] = [...(ADIMGS[key] || []), u]; refreshImgBox(key); } }
function imgDel(key, i) { ADIMGS[key].splice(i, 1); refreshImgBox(key); }
function imgFirst(key, i) { const [x] = ADIMGS[key].splice(i, 1); ADIMGS[key].unshift(x); refreshImgBox(key); }
function refreshImgBox(key) { const el = $('imgbox_' + key); if (el) el.innerHTML = imgsBox(key); }

function prodForm(p, cats) {
  const k = p ? p.id : 'new', v = f => p ? E(p[f] ?? '') : '';
  return `<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
    <input id="pe_${k}_name" placeholder="प्रोडक्ट का नाम" value="${v('name')}" class="${IN} sm:col-span-2">
    <select id="pe_${k}_cat" class="${IN}">${cats.map(c => `<option value="${E(c.id)}" ${p && p.cat === c.id ? 'selected' : ''}>${E(c.name)}</option>`).join('')}</select>
    <input id="pe_${k}_unit" placeholder="पैक साइज (1 Ltr Pouch)" value="${v('unit')}" class="${IN}">
    <div class="grid grid-cols-3 gap-2 sm:col-span-2"><input id="pe_${k}_vip_price" type="number" placeholder="👑 VIP रेट ₹" value="${v('vip_price')}" class="${IN} !border-amber-500 text-amber-300"><input id="pe_${k}_price" type="number" placeholder="Regular ₹" value="${v('price')}" class="${IN}"><input id="pe_${k}_mrp" type="number" placeholder="MRP ₹" value="${v('mrp')}" class="${IN}"></div>
    <input id="pe_${k}_stock_qty" type="number" placeholder="स्टॉक (कितने पैक)" value="${p ? p.stock_qty : 100}" class="${IN}">
    <label class="flex items-center gap-2 ${IN}"><input id="pe_${k}_in_stock" type="checkbox" ${!p || p.in_stock ? 'checked' : ''}> स्टॉक में उपलब्ध दिखाएं</label>
    <input id="pe_${k}_tag" placeholder="टैग (जैसे: 6.5% Rich Fat)" value="${v('tag')}" class="${IN}"><input id="pe_${k}_sub_info" placeholder="छोटी लाइन (कार्ड पर)" value="${v('sub_info')}" class="${IN}">
    <textarea id="pe_${k}_descr" rows="2" placeholder="पूरा विवरण" class="${IN} sm:col-span-2">${v('descr')}</textarea>
    <input id="pe_${k}_nutri" placeholder="पोषण (Energy 98kcal, Fat 6.5g)" value="${v('nutri')}" class="${IN}"><input id="pe_${k}_shelf" placeholder="शेल्फ लाइफ" value="${v('shelf')}" class="${IN}">
    <div class="sm:col-span-2"><p class="text-slate-400 mb-1">📷 फ़ोटो (ग्राहक स्वाइप करके देखेगा, पहली फ़ोटो मुख्य होगी):</p><div id="imgbox_${k}">${imgsBox(k)}</div></div></div>`;
}
function readProd(k) {
  const g = f => $(`pe_${k}_${f}`);
  return { name: g('name').value, cat: g('cat').value, unit: g('unit').value, vip_price: g('vip_price').value, price: g('price').value, mrp: g('mrp').value, stock_qty: g('stock_qty').value, in_stock: g('in_stock').checked, tag: g('tag').value, sub_info: g('sub_info').value, descr: g('descr').value, nutri: g('nutri').value, shelf: g('shelf').value, images: ADIMGS[k] || [] };
}
async function admProd() {
  const d = await adm('GET', '/products'); ADIMGS = {};
  d.products.forEach(p => { ADIMGS[p.id] = [...(p.images || [])]; }); ADIMGS.new = [];
  $('admBody').innerHTML = `
  <div class="${CARD} text-xs space-y-2"><h3 class="font-extrabold text-emerald-400 text-sm">+ नया प्रोडक्ट जोड़ें</h3>${prodForm(null, d.categories.filter(c => c.active))}<button onclick="admSaveProd('new')" class="w-full bg-emerald-600 text-white font-extrabold py-3 rounded-xl">प्रोडक्ट लाइव करें</button></div>
  <div class="${CARD} text-xs space-y-2"><h3 class="font-extrabold text-amber-400">📦 सभी प्रोडक्ट्स (${d.products.length})</h3>
  ${d.products.map(p => `<details class="bg-slate-950 border border-slate-800 rounded-xl"><summary class="p-3 flex items-center gap-2"><img src="${E((p.images || [])[0] || PLACEHOLDER)}" class="w-10 h-10 rounded-lg object-cover"><div class="min-w-0 flex-1"><b class="block truncate">${E(p.name)}</b><span class="text-slate-400">${E(p.unit)} • स्टॉक ${p.stock_qty} • ₹${p.price} / VIP ₹${p.vip_price}</span></div><span class="${p.in_stock && p.stock_qty > 0 ? 'text-emerald-300' : 'text-rose-300'} font-bold">${p.in_stock && p.stock_qty > 0 ? 'In' : 'Out'}</span></summary>
    <div class="p-3 border-t border-slate-800 space-y-2">${prodForm(p, d.categories)}<div class="flex gap-2"><button onclick="admSaveProd(${p.id})" class="flex-1 bg-emerald-600 text-white font-extrabold py-2.5 rounded-xl">सेव करें</button><button onclick="admDelProd(${p.id})" class="bg-rose-600/30 text-rose-300 font-bold px-4 rounded-xl">हटाएं</button></div></div></details>`).join('')}</div>`;
}
async function admSaveProd(k) {
  await run(async () => { const body = readProd(k); if (k === 'new') await adm('POST', '/products', body); else await adm('PUT', '/products/' + k, body); toast('✅ सेव हो गया'); await refreshAll(); admTab('prod'); });
}
async function admDelProd(id) { if (!confirm('यह प्रोडक्ट स्टोर से हटाएं? (पुराने बिल सुरक्षित रहेंगे)')) return; await run(async () => { await adm('DELETE', '/products/' + id); toast('🗑️ हटा दिया'); await refreshAll(); admTab('prod'); }); }

// ---------------------------------------------------------------- 4. बैनर / कूपन / कैटेगरी / सोसायटी
async function admCat() {
  const [b, c, ct, s] = await Promise.all([adm('GET', '/banners'), adm('GET', '/coupons'), adm('GET', '/categories'), adm('GET', '/societies')]);
  const row = (txt, del) => `<div class="flex justify-between items-center bg-slate-950 p-2 rounded-xl border border-slate-800"><span class="truncate pr-2">${txt}</span><button onclick="${del}" class="text-rose-400 px-2"><i class="fa-solid fa-trash"></i></button></div>`;
  $('admBody').innerHTML = `<div class="grid md:grid-cols-2 gap-4 text-xs">
  <div class="${CARD} space-y-2"><h3 class="font-extrabold text-amber-400">🎨 होमपेज बैनर</h3>
    <input id="bnTag" placeholder="टैग (36 HRS FARM TO HOME)" class="${IN}"><input id="bnTitle" placeholder="हेडलाइन" class="${IN}"><input id="bnSub" placeholder="सब-टाइटल" class="${IN}">
    <select id="bnBg" class="${IN}"><option value="linear-gradient(135deg, #0d5c3a 0%, #15803d 100%)">हरा</option><option value="linear-gradient(135deg, #78350f 0%, #b45309 100%)">भूरा/गोल्ड</option><option value="linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%)">नीला</option><option value="linear-gradient(135deg, #9f1239 0%, #e11d48 100%)">लाल</option></select>
    <button onclick="admAddBanner()" class="w-full bg-amber-400 text-slate-950 font-extrabold py-2 rounded-xl">+ बैनर लाइव करें</button>
    ${b.rows.filter(x => x.active).map(x => row(`<b>${E(x.title)}</b> (${E(x.tag)})`, `admCrud('banners','${x.id}')`)).join('')}</div>
  <div class="${CARD} space-y-2"><h3 class="font-extrabold text-emerald-400">🎟️ रिचार्ज कूपन</h3>
    <div class="grid grid-cols-3 gap-2"><input id="cpCode" placeholder="MILK100" class="${IN} uppercase font-bold"><input id="cpMin" type="number" placeholder="मिनिमम ₹" class="${IN}"><input id="cpBonus" type="number" placeholder="कैशबैक ₹" class="${IN}"></div>
    <input id="cpDesc" placeholder="ऑफर टेक्स्ट" class="${IN}"><button onclick="admAddCoupon()" class="w-full bg-emerald-600 text-white font-extrabold py-2 rounded-xl">+ कूपन लाइव करें</button>
    ${c.rows.filter(x => x.active).map(x => row(`<b class="text-amber-400">${E(x.code)}</b> — ${E(x.descr)}`, `admCrud('coupons','${E(x.code)}')`)).join('')}</div>
  <div class="${CARD} space-y-2"><h3 class="font-extrabold text-sky-400">🗂️ कैटेगरी</h3>
    <div class="grid grid-cols-2 gap-2"><input id="ctId" placeholder="कोड (अंग्रेज़ी, जैसे: pulses)" class="${IN}"><input id="ctName" placeholder="नाम (दालें & मसाले)" class="${IN}"></div>
    <div class="flex gap-2"><input id="ctImg" placeholder="फ़ोटो लिंक (या अपलोड करें →)" class="${IN}"><button onclick="ctUpload()" class="${BTN} bg-sky-600 text-white shrink-0">अपलोड</button></div>
    <button onclick="admAddCat()" class="w-full bg-sky-600 text-white font-extrabold py-2 rounded-xl">+ कैटेगरी जोड़ें / अपडेट</button>
    ${ct.rows.filter(x => x.active).map(x => row(`<img src="${E(x.img)}" class="inline w-6 h-6 rounded mr-1 object-cover"> ${E(x.name)} <span class="text-slate-500">(${E(x.id)})</span>`, `admCrud('categories','${E(x.id)}')`)).join('')}</div>
  <div class="${CARD} space-y-2"><h3 class="font-extrabold text-amber-400">🏢 अप्रूव्ड डिलीवरी सोसायटी</h3>
    <div class="flex gap-2"><input id="newSocInp" placeholder="नई सोसायटी का नाम" class="${IN}"><button onclick="admAddSoc()" class="${BTN} bg-amber-400 text-slate-950">+ जोड़ें</button></div>
    ${s.rows.filter(x => x.active).map(x => row('🏢 ' + E(x.name), `admCrud('societies','${x.id}')`)).join('')}</div></div>`;
}
async function admCrud(t, k) { if (!confirm('हटाएं?')) return; await run(async () => { await adm('DELETE', `/${t}/${encodeURIComponent(k)}`); await refreshAll(); admTab('cat'); }); }
async function admAddBanner() { await run(async () => { if (!$('bnTitle').value.trim()) throw new Error('हेडलाइन लिखें'); await adm('POST', '/banners', { tag: $('bnTag').value || 'FARM FRESH', title: $('bnTitle').value, sub: $('bnSub').value || 'सुबह दरवाज़े पर डिलीवरी', bg: $('bnBg').value, icon: 'fa-cow', badge: '100% PURE', active: true }); toast('🎨 बैनर लाइव'); await refreshAll(); admTab('cat'); }); }
async function admAddCoupon() { await run(async () => { await adm('POST', '/coupons', { code: $('cpCode').value, min_amount: $('cpMin').value, bonus: $('cpBonus').value, descr: $('cpDesc').value || `₹${$('cpMin').value} रिचार्ज पर ₹${$('cpBonus').value} कैशबैक`, active: true }); toast('🎟️ कूपन लाइव'); await refreshAll(); admTab('cat'); }); }
async function ctUpload() { const u = await pickImages(); if (u[0]) $('ctImg').value = u[0]; }
async function admAddCat() { await run(async () => { await adm('POST', '/categories', { id: $('ctId').value, name: $('ctName').value, img: $('ctImg').value, active: true, sort: 50 }); toast('🗂️ सेव हो गया'); await refreshAll(); admTab('cat'); }); }
async function admAddSoc() { await run(async () => { await adm('POST', '/societies', { name: $('newSocInp').value, active: true }); await refreshAll(); admTab('cat'); }); }

// ---------------------------------------------------------------- 5. कस्टमर & स्टाफ
async function admPpl() {
  const q = AD.q || '';
  const [u, staff] = await Promise.all([adm('GET', '/users?role=customer&q=' + encodeURIComponent(q)), adm('GET', '/users?role=rider')]);
  const admins = await adm('GET', '/users?role=admin');
  $('admBody').innerHTML = `
  <div class="${CARD} text-xs space-y-2"><h3 class="font-extrabold text-sky-400">🚴 राइडर / एडमिन जोड़ें</h3>
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2"><input id="stEmail" placeholder="ईमेल" class="${IN}"><input id="stName" placeholder="नाम" class="${IN}"><select id="stRole" class="${IN}"><option value="rider">राइडर</option><option value="admin">एडमिन</option></select><button onclick="admAddStaff()" class="${BTN} bg-sky-600 text-white">जोड़ें</button></div>
    <p class="text-slate-400">वह व्यक्ति इसी ईमेल से OTP लॉगिन करेगा तो उसे पैनल दिखेगा। राइडर का मोबाइल नंबर वह अपने प्रोफ़ाइल में डाले (WhatsApp शीट के लिए)।</p>
    ${[...staff.users, ...admins.users].map(s => `<div class="flex justify-between items-center bg-slate-950 p-2 rounded-xl border border-slate-800"><span>${s.role === 'admin' ? '🔐' : '🚴'} <b>${E(s.name || '—')}</b> ${E(s.email)} ${E(s.phone)}</span><button onclick="admUser('${s.id}',{role:'customer'})" class="text-rose-400 text-[11px]">स्टाफ से हटाएं</button></div>`).join('')}</div>
  <div class="${CARD} text-xs space-y-2"><div class="flex gap-2"><input id="pplQ" value="${E(q)}" placeholder="🔍 नाम / मोबाइल / ईमेल से खोजें" class="${IN}"><button onclick="AD.q=$('pplQ').value;admTab('ppl')" class="${BTN} bg-amber-400 text-slate-950">खोजें</button></div>
  <h3 class="font-extrabold text-amber-400">👥 कस्टमर (${u.users.length})</h3>
  ${u.users.map(c => `<div class="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-1.5"><div class="flex flex-wrap justify-between gap-2"><div><b class="text-white">${E(c.name || '—')}</b> ${c.is_vip ? '👑' : ''} ${c.blocked ? '<span class="text-rose-400">[ब्लॉक]</span>' : ''}<br><span class="text-slate-400">${E(c.phone)} • ${E(c.email)} • ${E(c.flat)}</span></div><div class="text-right"><span class="text-slate-400">वॉलेट</span><br><b class="text-emerald-300 text-sm">₹${(+c.wallet_main + +c.wallet_cb).toFixed(0)}</b> <span class="text-slate-500">(CB ₹${c.wallet_cb})</span></div></div>
    <div class="flex flex-wrap gap-2 items-center"><input id="wa_${c.id}" type="number" placeholder="± रकम" class="${IN} !w-24"><select id="wt_${c.id}" class="${IN} !w-auto"><option value="main">मेन</option><option value="cb">कैशबैक</option></select><button onclick="admWallet('${c.id}')" class="${BTN} bg-emerald-600 text-white">वॉलेट बदलें</button>
    <button onclick="admUser('${c.id}',{is_vip:${!c.is_vip}})" class="${BTN} bg-amber-500 text-slate-950">${c.is_vip ? 'VIP हटाएं' : 'VIP दें'}</button><button onclick="admUser('${c.id}',{blocked:${!c.blocked}})" class="${BTN} bg-slate-700 text-white">${c.blocked ? 'अनब्लॉक' : 'ब्लॉक'}</button>
    <a target="_blank" href="${waLink(c.phone, 'नमस्ते ' + (c.name || '') + ' जी 🥛')}" class="text-emerald-400 px-2"><i class="fa-brands fa-whatsapp"></i></a></div></div>`).join('')}</div>`;
}
async function admAddStaff() { await run(async () => { await adm('POST', '/staff', { email: $('stEmail').value, name: $('stName').value, role: $('stRole').value }); toast('✅ जुड़ गया'); admTab('ppl'); }); }
async function admUser(id, patch) { await run(async () => { await adm('PATCH', '/users/' + id, patch); toast('✅ हो गया'); admTab('ppl'); }); }
async function admWallet(id) { await run(async () => { await adm('POST', `/users/${id}/wallet`, { amount: $('wa_' + id).value, wallet: $('wt_' + id).value, note: 'एडमिन एडजस्टमेंट' }); toast('✅ वॉलेट अपडेट'); admTab('ppl'); }); }

// ---------------------------------------------------------------- 6. रिपोर्ट
async function admRep() {
  const t = C.today, f = AD.from || addDaysC(t, -30), to = AD.to || t;
  const link = (n, label, desc) => `<a href="/api/admin/export/${n}.csv?from=${f}&to=${to}" class="block bg-slate-950 border border-slate-800 hover:border-amber-400 rounded-xl p-3"><b class="text-white"><i class="fa-solid fa-file-csv text-emerald-400 mr-1"></i>${label}</b><br><span class="text-slate-400">${desc}</span></a>`;
  $('admBody').innerHTML = `<div class="${CARD} text-xs space-y-3"><h3 class="font-extrabold text-amber-400">📑 Excel / Google Sheet के लिए CSV डाउनलोड</h3>
  <div class="flex flex-wrap items-center gap-2"><span>से</span><input type="date" id="rpF" value="${f}" class="${IN} !w-auto"><span>तक</span><input type="date" id="rpT" value="${to}" class="${IN} !w-auto"><button onclick="AD.from=$('rpF').value;AD.to=$('rpT').value;admTab('rep')" class="${BTN} bg-amber-400 text-slate-950">तारीख़ लागू करें</button></div>
  <div class="grid sm:grid-cols-2 gap-2">
  ${link('orders', 'सभी बिल / रसीद', 'हर ऑर्डर की रसीद: ग्राहक, आइटम, रकम, पेमेंट, स्टेटस')}
  ${link('items', 'आइटम-वाइज़ बिक्री', 'कौन सा माल कितना बिका और कितनी रकम')}
  ${link('stock', 'स्टॉक रिपोर्ट', 'अभी कितना माल बचा + चुने समय में कितना बिका')}
  ${link('ledger', 'कस्टमर लेजर (पूरी फ़ाइल)', 'हर कस्टमर ने कुल कितना ख़रीदा, रिचार्ज, बैलेंस, बकाया')}
  ${link('topups', 'रिचार्ज रिपोर्ट', 'सभी UPI रिचार्ज + UTR + स्टेटस')}
  ${link('transactions', 'वॉलेट लेन-देन', 'सभी जमा / कटौती की पासबुक')}</div></div>`;
}

// ---------------------------------------------------------------- 7. सेटिंग्स
async function admSet() {
  const s = await adm('GET', '/settings'), sh = s.shop || {}, pay = s.payments || {}, dl = s.delivery || {}, al = s.alerts || {}, rf = s.referral || {}, th = s.theme || {};
  const chk = (id, label, on) => `<label class="flex items-center gap-2"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}> ${label}</label>`;
  const field = (id, label, val, type = 'text') => `<div><label class="text-[10px] text-slate-400">${label}</label><input id="${id}" type="${type}" value="${E(val ?? '')}" class="${IN}"></div>`;
  $('admBody').innerHTML = `<div class="grid md:grid-cols-2 gap-4 text-xs">
  <div class="${CARD} space-y-2"><h3 class="font-extrabold text-amber-400">🏪 दुकान की जानकारी</h3>${field('sh_name', 'दुकान / ब्रांड का नाम', sh.name)}${field('sh_tag', 'टैगलाइन', sh.tagline)}${field('sh_phone', 'सपोर्ट मोबाइल', sh.phone)}${field('sh_wa', 'WhatsApp नंबर', sh.whatsapp)}${field('sh_email', 'सपोर्ट ईमेल', sh.email)}${field('sh_addr', 'पता', sh.address)}${field('sh_hours', 'सपोर्ट का समय', sh.hours)}<button onclick="saveShop()" class="w-full bg-emerald-600 font-extrabold py-2 rounded-xl">सेव करें</button></div>
  <div class="${CARD} space-y-2"><h3 class="font-extrabold text-emerald-400">💳 पेमेंट तरीके (चालू / बंद)</h3>${chk('py_wallet', 'वॉलेट (हमेशा चालू रखें)', pay.wallet !== false)}${chk('py_upi', 'UPI QR + UTR रिचार्ज / पेमेंट', pay.upi)}${chk('py_cod', 'कैश ऑन डिलीवरी (COD)', pay.cod)}${field('py_id', 'आपकी UPI ID', pay.upi_id)}${field('py_mn', 'मर्चेंट नाम (UPI ऐप में दिखेगा)', pay.merchant_name)}
    <div><label class="text-[10px] text-slate-400">अपना QR फ़ोटो (खाली = ऐप अपने-आप रकम वाला QR बनाएगा)</label><div class="flex gap-2"><input id="py_qr" value="${E(pay.qr_url || '')}" placeholder="QR इमेज लिंक" class="${IN}"><button onclick="qrUpload()" class="${BTN} bg-sky-600 text-white shrink-0">अपलोड</button></div></div><button onclick="savePay()" class="w-full bg-emerald-600 font-extrabold py-2 rounded-xl">सेव करें</button></div>
  <div class="${CARD} space-y-2"><h3 class="font-extrabold text-sky-400">🚚 डिलीवरी और अलर्ट</h3>${field('dl_fee', 'डिलीवरी शुल्क ₹ (0 = फ्री)', dl.fee, 'number')}${field('dl_free', 'इतने के ऑर्डर पर फ्री ₹ (0 = हमेशा शुल्क)', dl.free_above, 'number')}${field('dl_cut', 'ऑर्डर कटऑफ़ समय (HH:MM, 24 घंटे)', dl.cutoff)}${field('al_bal', 'लो-बैलेंस अलर्ट: इससे कम ₹', al.low_balance, 'number')}${field('al_stock', 'लो-स्टॉक अलर्ट: इससे कम पैक', al.low_stock, 'number')}<p class="text-slate-500">VIP मेंबर्स को डिलीवरी शुल्क नहीं लगता।</p><button onclick="saveDelivery()" class="w-full bg-emerald-600 font-extrabold py-2 rounded-xl">सेव करें</button></div>
  <div class="${CARD} space-y-2"><h3 class="font-extrabold text-amber-400">🎁 रेफ़रल और VIP प्लान</h3>${chk('rf_on', 'रेफ़रल चालू', rf.enabled)}${field('rf_a', 'बुलाने वाले को कैशबैक ₹', rf.referrer_bonus, 'number')}${field('rf_b', 'नए ग्राहक को कैशबैक ₹', rf.new_user_bonus, 'number')}
    <label class="text-[10px] text-slate-400">VIP प्लान (हर लाइन: दिन | कीमत | नाम)</label><textarea id="vp_txt" rows="3" class="${IN}">${E((s.vip_plans || []).map(p => `${p.days} | ${p.price} | ${p.label}`).join('\n'))}</textarea><button onclick="saveRef()" class="w-full bg-emerald-600 font-extrabold py-2 rounded-xl">सेव करें</button></div>
  <div class="${CARD} space-y-2 md:col-span-2"><h3 class="font-extrabold text-sky-400">❓ FAQ और 📜 पॉलिसी (हेल्प सेक्शन)</h3><label class="text-[10px] text-slate-400">FAQ (हर लाइन: सवाल | जवाब)</label><textarea id="fq_txt" rows="5" class="${IN}">${E((s.faq || []).map(f => `${f.q} | ${f.a}`).join('\n'))}</textarea>
    ${['terms:नियम-शर्तें', 'privacy:प्राइवेसी पॉलिसी', 'refund:रिफंड पॉलिसी'].map(x => { const [k, l] = x.split(':'); return `<label class="text-[10px] text-slate-400">${l}</label><textarea id="pl_${k}" rows="3" class="${IN}">${E((s.policies || {})[k] || '')}</textarea>`; }).join('')}<button onclick="saveHelp()" class="w-full bg-emerald-600 font-extrabold py-2 rounded-xl">सेव करें</button></div>
  <div class="${CARD} space-y-2 md:col-span-2"><h3 class="font-extrabold text-amber-400">🎨 कलर थीम</h3><div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
    ${[['#0d5c3a', '#e8f5ee', '#d4af37', '1. Country Delight ⭐'], ['#004b57', '#e6f4f1', '#00a86b', '2. Teal'], ['#1e3a8a', '#eff6ff', '#10b981', '3. Royal Blue'], ['#0f172a', '#f1f5f9', '#16a34a', '4. Dark Slate']].map(c => `<button onclick="saveTheme('${c[0]}','${c[1]}','${c[2]}')" class="p-3 bg-slate-950 border border-slate-700 rounded-xl text-left hover:border-amber-400"><b class="text-white block">${c[3]}</b><span class="inline-block w-4 h-4 rounded" style="background:${c[0]}"></span></button>`).join('')}</div></div>
  <div class="${CARD} md:col-span-2 text-slate-400 space-y-1"><h3 class="font-extrabold text-emerald-400">☁️ रात का ऑटो-चेकआउट</h3><p>कटऑफ़ समय पर सर्वर अपने-आप सबके ऑर्डर बनाता है और वॉलेट से बिल काटता है। Render का फ्री प्लान सो जाता है, इसलिए cron-job.org से हर 5 मिनट <code class="text-amber-300">/api/cron/nightly?key=आपका_CRON_SECRET</code> खुलवाएं (गाइड में लिखा है)।</p></div></div>`;
}
const setv = id => $(id).value, setc = id => $(id).checked;
async function putSetting(k, v) { await run(async () => { await adm('PUT', '/settings/' + k, { value: v }); toast('✅ सेव हो गया'); await refreshAll(); }); }
const saveShop = () => putSetting('shop', { name: setv('sh_name'), tagline: setv('sh_tag'), phone: setv('sh_phone'), whatsapp: setv('sh_wa'), email: setv('sh_email'), address: setv('sh_addr'), hours: setv('sh_hours') });
const savePay = () => putSetting('payments', { wallet: setc('py_wallet'), upi: setc('py_upi'), cod: setc('py_cod'), upi_id: setv('py_id').trim(), merchant_name: setv('py_mn'), qr_url: setv('py_qr').trim() });
async function qrUpload() { const u = await pickImages(); if (u[0]) $('py_qr').value = u[0]; }
async function saveDelivery() {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(setv('dl_cut'))) return toast('कटऑफ़ समय HH:MM में लिखें (जैसे 23:59)', true);
  await putSetting('delivery', { fee: +setv('dl_fee') || 0, free_above: +setv('dl_free') || 0, cutoff: setv('dl_cut') });
  await putSetting('alerts', { low_balance: +setv('al_bal') || 0, low_stock: +setv('al_stock') || 0 });
}
async function saveRef() {
  const plans = setv('vp_txt').split('\n').map(l => l.split('|').map(x => x.trim())).filter(a => a.length >= 3 && +a[0] > 0 && +a[1] > 0).map(a => ({ days: +a[0], price: +a[1], label: a[2] }));
  await putSetting('referral', { enabled: setc('rf_on'), referrer_bonus: +setv('rf_a') || 0, new_user_bonus: +setv('rf_b') || 0 });
  if (plans.length) await putSetting('vip_plans', plans);
}
async function saveHelp() {
  const faq = setv('fq_txt').split('\n').map(l => l.split('|').map(x => x.trim())).filter(a => a.length >= 2 && a[0]).map(a => ({ q: a[0], a: a.slice(1).join(' | ') }));
  await putSetting('faq', faq); await putSetting('policies', { terms: setv('pl_terms'), privacy: setv('pl_privacy'), refund: setv('pl_refund') });
}
const saveTheme = (pri, light, acc) => putSetting('theme', { pri, light, acc });
