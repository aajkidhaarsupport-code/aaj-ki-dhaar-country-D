-- =====================================================================
-- आज की धार — Supabase schema (SQL Editor में पूरा paste करके Run करें)
-- सारी टेबल पर RLS चालू है और कोई policy नहीं है, यानी बाहर से कोई सीधे
-- डेटा नहीं पढ़/लिख सकता। सिर्फ़ आपका Render सर्वर (service_role key) पहुँचता है।
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- USERS ----------
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  name text default '',
  phone text default '',
  role text not null default 'customer' check (role in ('customer','admin','rider')),
  society_id bigint,
  flat text default '',
  deliv_pref text default '🔕 घंटी न बजाएं - दरवाज़े के बैग में रखें',
  pay_pref text not null default 'wallet' check (pay_pref in ('wallet','upi','cod')),
  is_vip boolean not null default false,
  vip_until date,
  wallet_main numeric(10,2) not null default 0,
  wallet_cb numeric(10,2) not null default 0,
  vacation boolean not null default false,
  ref_code text unique,
  referred_by uuid,
  blocked boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists otps (
  email text primary key,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  last_sent timestamptz not null default now()
);

-- ---------- CATALOG ----------
create table if not exists societies (
  id bigserial primary key,
  name text not null,
  active boolean not null default true
);

create table if not exists categories (
  id text primary key,
  name text not null,
  img text default '',
  sort int not null default 0,
  active boolean not null default true
);

create table if not exists products (
  id bigserial primary key,
  name text not null,
  cat text references categories(id) on update cascade,
  unit text default '',
  vip_price numeric(10,2) not null,
  price numeric(10,2) not null,
  mrp numeric(10,2) not null,
  stock_qty int not null default 100,
  in_stock boolean not null default true,
  tag text default '',
  sub_info text default '',
  descr text default '',
  nutri text default '',
  shelf text default '',
  images text[] not null default '{}',
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists banners (
  id bigserial primary key,
  tag text default '',
  title text not null,
  sub text default '',
  bg text default 'linear-gradient(135deg, #0d5c3a 0%, #15803d 100%)',
  icon text default 'fa-cow',
  badge text default '100% PURE',
  img text default '',
  sort int not null default 0,
  active boolean not null default true
);

create table if not exists coupons (
  code text primary key,
  min_amount numeric(10,2) not null,
  bonus numeric(10,2) not null,
  descr text default '',
  active boolean not null default true
);

-- ---------- CUSTOMER DATA ----------
create table if not exists subscriptions (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  product_id bigint not null references products(id) on delete cascade,
  qty int not null default 1,
  pattern text default 'रोज़ाना (Daily)',
  days int[] not null default '{0,1,2,3,4,5,6}',
  active boolean not null default true,
  unique (user_id, product_id)
);

create table if not exists cart_items (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  product_id bigint not null references products(id) on delete cascade,
  qty int not null default 1,
  delivery_date date not null,
  unique (user_id, product_id, delivery_date)
);

create table if not exists orders (
  id bigserial primary key,
  order_no text unique not null,
  user_id uuid not null references users(id),
  delivery_date date not null,
  status text not null default 'placed'
    check (status in ('placed','on_hold','packed','out_for_delivery','delivered','cancelled')),
  pay_method text not null default 'wallet' check (pay_method in ('wallet','upi','cod')),
  pay_status text not null default 'pending' check (pay_status in ('pending','paid','verify','failed','refunded')),
  utr text,
  subtotal numeric(10,2) not null default 0,
  mrp_total numeric(10,2) not null default 0,
  fee numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  cb_used numeric(10,2) not null default 0,
  main_used numeric(10,2) not null default 0,
  society_name text default '',
  flat text default '',
  deliv_pref text default '',
  customer_name text default '',
  customer_phone text default '',
  rider_id uuid references users(id),
  note text default '',
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  unique (user_id, delivery_date)
);

create table if not exists order_items (
  id bigserial primary key,
  order_id bigint not null references orders(id) on delete cascade,
  product_id bigint,
  name text not null,
  unit text default '',
  qty int not null,
  rate numeric(10,2) not null,
  mrp numeric(10,2) not null default 0,
  from_sub int not null default 0,
  from_once int not null default 0
);

create table if not exists wallet_txns (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('cr','dr')),
  amount numeric(10,2) not null,
  wallet text not null default 'main' check (wallet in ('main','cb')),
  title text not null,
  ref text default '',
  created_at timestamptz not null default now()
);

create table if not exists topups (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  amount numeric(10,2) not null,
  coupon_code text default '',
  bonus numeric(10,2) not null default 0,
  utr text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  note text default '',
  created_at timestamptz not null default now()
);
-- एक ही UTR दोबारा इस्तेमाल नहीं हो सकता (रिजेक्टेड को छोड़कर)
create unique index if not exists topups_utr_unique on topups (utr) where status <> 'rejected';

create table if not exists refund_requests (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  order_id bigint references orders(id),
  reason text not null,
  amount numeric(10,2) not null default 0,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  admin_note text default '',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create table if not exists support_tickets (
  id bigserial primary key,
  user_id uuid references users(id) on delete set null,
  subject text not null,
  message text not null,
  status text not null default 'open' check (status in ('open','closed')),
  reply text default '',
  created_at timestamptz not null default now()
);

create table if not exists settings (
  key text primary key,
  value jsonb not null
);

create table if not exists job_runs (
  job text not null,
  run_date date not null,
  finished_at timestamptz not null default now(),
  info text default '',
  primary key (job, run_date)
);

-- ---------- INDEXES ----------
create index if not exists idx_orders_date on orders(delivery_date);
create index if not exists idx_orders_user on orders(user_id);
create index if not exists idx_txn_user on wallet_txns(user_id, created_at desc);
create index if not exists idx_subs_user on subscriptions(user_id);

-- ---------- RLS: सब बंद (सिर्फ़ service_role चल सकता है) ----------
alter table users enable row level security;
alter table otps enable row level security;
alter table societies enable row level security;
alter table categories enable row level security;
alter table products enable row level security;
alter table banners enable row level security;
alter table coupons enable row level security;
alter table subscriptions enable row level security;
alter table cart_items enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table wallet_txns enable row level security;
alter table topups enable row level security;
alter table refund_requests enable row level security;
alter table support_tickets enable row level security;
alter table settings enable row level security;
alter table job_runs enable row level security;

-- ---------- वॉलेट बदलाव: एक ही atomic फ़ंक्शन (दोहरी कटौती नहीं होगी) ----------
create or replace function wallet_apply(p_user uuid, p_main numeric, p_cb numeric, p_title text, p_ref text default '')
returns void language plpgsql as $$
declare u users%rowtype;
begin
  select * into u from users where id = p_user for update;
  if not found then raise exception 'user not found'; end if;
  if u.wallet_main + p_main < 0 or u.wallet_cb + p_cb < 0 then
    raise exception 'insufficient balance';
  end if;
  update users set wallet_main = wallet_main + p_main, wallet_cb = wallet_cb + p_cb where id = p_user;
  if p_main <> 0 then
    insert into wallet_txns(user_id, kind, amount, wallet, title, ref)
    values (p_user, case when p_main > 0 then 'cr' else 'dr' end, abs(p_main), 'main', p_title, p_ref);
  end if;
  if p_cb <> 0 then
    insert into wallet_txns(user_id, kind, amount, wallet, title, ref)
    values (p_user, case when p_cb > 0 then 'cr' else 'dr' end, abs(p_cb), 'cb', p_title, p_ref);
  end if;
end $$;

-- ---------- शुरुआती डेटा ----------
insert into societies(name) values
 ('ग्रीन वैली अपार्टमेंट्स'),('शांति निकेतन रेजीडेंसी'),('रॉयल पाम्स सोसायटी'),
 ('कृष्णा हाइट्स टावर'),('वैशाली नगर एनक्लेव')
on conflict do nothing;

insert into categories(id,name,img,sort) values
 ('milk','ताज़ा दूध (Milk)','https://images.unsplash.com/photo-1563636619-e9143da7973b?w=200&q=80',1),
 ('curd','दही & छाछ','https://images.unsplash.com/photo-1488477181946-6428a0291777?w=200&q=80',2),
 ('paneer','पनीर & मक्खन','https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=200&q=80',3),
 ('ghee','देसी घी (Ghee)','https://images.unsplash.com/photo-1631451095765-2c91616fc9e6?w=200&q=80',4),
 ('bread','ब्रेड & अंडे','https://images.unsplash.com/photo-1509440159596-0249088772ff?w=200&q=80',5),
 ('veg','ताज़ी सब्ज़ियाँ','https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=200&q=80',6),
 ('fruit','फल & नारियल','https://images.unsplash.com/photo-1525385133512-2f3bdd039054?w=200&q=80',7)
on conflict do nothing;

insert into products(name,cat,unit,vip_price,price,mrp,stock_qty,tag,sub_info,descr,nutri,shelf,images,sort) values
('भैंस का ताज़ा मलाईदार दूध (Rich Buffalo Milk)','milk','1 Ltr Pouch',62,72,78,200,'6.5%+ Rich Fat','गाढ़ा और मलाईदार • बिना पाउडर या प्रिज़र्वेटिव','आज की धार का भैंस का दूध सीधे हमारे ग्रामीण डेयरी फार्म्स से इकट्ठा किया जाता है और 4°C पर ठंडा करके 36 घंटे के भीतर सुबह 7 बजे आपके घर पहुंचाया जाता है। इसमें मोटी मलाई जमती है और किसी भी तरह का मिल्क पाउडर, यूरिया या प्रिज़र्वेटिव नहीं मिलाया जाता।','Energy: 98 kcal • Rich Fat: 6.5g • Protein: 4.2g • Calcium: 180mg','2 दिन (उबालकर 4°C से नीचे फ्रिज में रखें)',array['https://images.unsplash.com/photo-1550583724-b2692b85b150?w=600&q=80','https://images.unsplash.com/photo-1563636619-e9143da7973b?w=600&q=80'],1),
('देसी गाय का ताज़ा दूध (Farm Fresh Cow Milk)','milk','1 Ltr Pouch',56,66,72,200,'Free Milk Test Kit','बच्चों के लिए सुपाच्य • 36 घंटे में फार्म से घर','प्राकृतिक चारे पर पली गायों का 100% शुद्ध और हल्का गाय का दूध। यह पचने में बेहद आसान है और बढ़ते बच्चों, बुजुर्गों व फिटनेस पसंद लोगों के रोज़ाना पीने के लिए सबसे उत्तम है।','Energy: 67 kcal • Fat: 3.8g • Protein: 3.4g • Calcium: 120mg','2 दिन (डिलीवरी के तुरंत बाद उबालें और फ्रिज में रखें)',array['https://images.unsplash.com/photo-1563636619-e9143da7973b?w=600&q=80','https://images.unsplash.com/photo-1550583724-b2692b85b150?w=600&q=80'],2),
('A2 गिर गाय का शुद्ध दूध (100% A2 Gir Cow Milk)','milk','1 Ltr Pouch',75,88,95,100,'Certified A2 Protein','देसी गिर गायों का अमृत समान A2 बीटा-केसीन दूध','100% शुद्ध देसी गिर और साहीवाल नस्ल की गायों का A2 दूध। इसमें केवल A2 बीटा-केसीन प्रोटीन होता है जो इम्युनिटी बढ़ाने और पाचन तंत्र को स्वस्थ रखने में मदद करता है।','Energy: 70 kcal • A2 Protein: 3.5g • Omega-3 & Natural Calcium','2 दिन (4°C कोल्ड-चेन में सुरक्षित)',array['https://images.unsplash.com/photo-1528498033373-3c6c08e93d79?w=600&q=80','https://images.unsplash.com/photo-1563636619-e9143da7973b?w=600&q=80'],3),
('घर जैसा गाढ़ा मटका दही (Low Fat Taaza Dahi)','curd','400 g Cup',32,40,48,100,'Thick & Creamy','लाइव प्रोबायोटिक कल्चर से तैयार बिना खटास वाला दही','पारंपरिक तरीके से शुद्ध फार्म दूध और एक्टिव प्रोबायोटिक जामन से जमाया गया गाढ़ा दही।','Energy: 62 kcal • Protein: 3.8g • Probiotics: 1 Billion+ CFU','5 दिन (हमेशा फ्रिज में 4°C पर रखें)',array['https://images.unsplash.com/photo-1488477181946-6428a0291777?w=600&q=80','https://images.unsplash.com/photo-1576186726115-4d51596775d1?w=600&q=80'],4),
('तड़का मसाला छाछ (Desi Spiced Chaach)','curd','450 ml Pouch',18,24,30,100,'Jeera & Pudina','भुना जीरा और काला नमक के साथ पाचक छाछ','ताज़ा दही को मथकर बनाई गई देसी छाछ जिसमें भुना जीरा, सेंधा नमक, पुदीना और हल्की हरी मिर्च का स्वाद है।','Energy: 28 kcal • Fat: 1.0g • Natural Electrolytes','3 दिन (ठंडा करके पिएं)',array['https://images.unsplash.com/photo-1576186726115-4d51596775d1?w=600&q=80','https://images.unsplash.com/photo-1488477181946-6428a0291777?w=600&q=80'],5),
('ताज़ा सॉफ्ट मलाई पनीर (Hygienic Fresh Paneer)','paneer','200 g Pack',74,88,100,60,'100% Milk Protein','बिना साइट्रिक एसिड के नींबू से फाड़ा गया मुलायम पनीर','आज की धार का मलाई पनीर 100% फुल-क्रीम दूध से बिना किसी केमिकल या कृत्रिम एसिड के तैयार किया जाता है।','Energy: 265 kcal • High Protein: 18.5g • Fat: 20g • Calcium: 210mg','6 दिन (फ्रीज़र या चिलर ट्रे में रखें)',array['https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=600&q=80','https://images.unsplash.com/photo-1589985270826-4b7bb135bc9d?w=600&q=80'],6),
('सफ़ेद मक्खन (Traditional White Makhan)','paneer','200 g Tub',115,135,150,50,'Zero Salt • Pure','पराठे और साग के लिए दही मथकर निकाला ताज़ा मक्खन','बिना नमक और बिना किसी पीले रंग के, देसी दही को बिलोकर निकाला गया ताज़ा सफ़ेद मक्खन।','Energy: 710 kcal • Pure Milk Fat: 78g • Vitamin A & D','10 दिन (फ्रिज में रखें)',array['https://images.unsplash.com/photo-1589985270826-4b7bb135bc9d?w=600&q=80','https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=600&q=80'],7),
('दानेदार देसी गाय का घी (A2 Bilona Cow Ghee)','ghee','500 ml Glass Jar',540,640,720,40,'Aroma Rich Bilona','पारंपरिक बिलोना विधि से धीमी आंच पर पका दानेदार घी','दही को लकड़ी की मथनी (बिलोना) से मथकर निकाले गए मक्खन को धीमी आंच पर पकाकर तैयार किया गया 100% दानेदार और खुशबूदार देसी घी।','Energy: 900 kcal • Healthy Fats: 99.8g • Rich in Butyric Acid & Vit A, E','9 महीने (सामान्य कमरे के तापमान पर सूखे चम्मच से निकालें)',array['https://images.unsplash.com/photo-1631451095765-2c91616fc9e6?w=600&q=80','https://images.unsplash.com/photo-1589985270826-4b7bb135bc9d?w=600&q=80'],8),
('100% आटा ब्राउन ब्रेड (Zero Maida Wheat Bread)','bread','400 g Pack',36,45,55,80,'Zero Maida • Zero Palm Oil','कोल्ड-प्रेस्ड तेल और चोकर युक्त गेहूँ के आटे से बनी','100% शरबती गेहूँ के आटे, बिना पाम ऑयल और बिना किसी केमिकल सॉफ्टनर के रोज़ रात को ताज़ा बेक होती है।','Energy: 240 kcal • Dietary Fiber: 6.5g • Protein: 8.2g • 0% Maida','3 दिन (ठंडी और सूखी जगह पर रखें)',array['https://images.unsplash.com/photo-1509440159596-0249088772ff?w=600&q=80','https://images.unsplash.com/photo-1582722872445-44dc5f7e3c8f?w=600&q=80'],9),
('फार्म फ्रेश देसी भूरे अंडे (6 Brown Protein Eggs)','bread','6 Pcs Box',52,65,75,80,'Herbal Feed Hens','हर्बल फीड मुर्गियों के ओमेगा-3 और प्रोटीन से भरपूर अंडे','एंटीबायोटिक-मुक्त हर्बल फीड खाने वाली मुर्गियों के ताज़ा भूरे अंडे।','Protein: 6.5g per egg • Rich in Omega-3, Vitamin B12 & Choline','10 दिन (फ्रिज की एग ट्रे में रखें)',array['https://images.unsplash.com/photo-1582722872445-44dc5f7e3c8f?w=600&q=80','https://images.unsplash.com/photo-1509440159596-0249088772ff?w=600&q=80'],10),
('मीठा हरा नारियल पानी (Guaranteed Sweet Coconut)','fruit','1 Pc Large',48,60,70,60,'300ml+ Water','ताज़ा छांटा हुआ मीठा और भरपूर पानी वाला नारियल','ग्रेड-A हरे नारियल। हर नारियल में कम से कम 300ml+ मीठे पानी की गारंटी।','Natural Electrolytes • Potassium: 600mg • Zero Fat Hydrator','4 दिन (सामान्य या ठंडी जगह रखें)',array['https://images.unsplash.com/photo-1525385133512-2f3bdd039054?w=600&q=80','https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=600&q=80'],11),
('ताज़ा लाल देसी टमाटर + आलू-प्याज किचन पैक','veg','1.5 kg Combo',54,68,85,60,'Ozone Washed','ओज़ोन-वॉश्ड और साफ़ छांटी हुई रोज़ाना की ताज़ी सब्ज़ियाँ','किसान के खेत से सीधे आए ताज़ा टमाटर, आलू और प्याज जिन्हें धोकर और हाथ से छांटकर नेट बैग में पैक किया गया है।','100% Surface Pesticide Removed • Rich in Natural Vitamins & Fiber','7-10 दिन (सूखी हवादार टोकरी में रखें)',array['https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=600&q=80','https://images.unsplash.com/photo-1518977676601-b53f82aba655?w=600&q=80'],12);

insert into banners(tag,title,sub,bg,icon,badge,sort) values
('36 HRS FARM TO HOME','सीधे फार्म से सुबह 7 बजे आपके दरवाज़े पर 100% शुद्ध दूध!','हर पहले ऑर्डर के साथ मुफ़्त Milk Testing Kit','linear-gradient(135deg, #0d5c3a 0%, #15803d 100%)','fa-flask-vial','100% TESTED',1),
('TRADITIONAL BILONA','दानेदार देसी गाय और भैंस का शुद्ध बिलोना घी','VIP मेंबर्स के लिए ₹140 तक की सीधी बचत','linear-gradient(135deg, #78350f 0%, #b45309 100%)','fa-jar','DANEDAR GHEE',2);

insert into coupons(code,min_amount,bonus,descr) values
('FRESH25',500,25,'₹500 रिचार्ज पर ₹25 कैशबैक'),
('MILK75',1000,75,'₹1000 रिचार्ज पर ₹75 कैशबैक'),
('SUPER200',2000,200,'₹2000 रिचार्ज पर ₹200 कैशबैक')
on conflict do nothing;

insert into settings(key,value) values
('shop', '{"name":"आज की धार","tagline":"5-7 AM Farm-to-Home Delivery","phone":"","whatsapp":"","email":"","address":"","hours":"सुबह 8 से रात 8 बजे"}'),
('payments', '{"wallet":true,"upi":true,"cod":true,"upi_id":"aajkidhaar@upi","merchant_name":"AajKiDhaar","qr_url":""}'),
('delivery', '{"fee":0,"free_above":0,"min_order":0,"cutoff":"23:59"}'),
('alerts', '{"low_balance":100,"low_stock":10}'),
('vip_plans', '[{"days":30,"price":149,"label":"1 महीना"},{"days":90,"price":349,"label":"3 महीने (Best Value)"},{"days":180,"price":599,"label":"6 महीने Mega Saver"}]'),
('referral', '{"enabled":true,"referrer_bonus":50,"new_user_bonus":50}'),
('faq', '[{"q":"डिलीवरी कब होती है?","a":"रोज़ सुबह 5 से 7 बजे के बीच।"},{"q":"ऑर्डर कब तक बदल सकते हैं?","a":"रात 11:59 बजे तक अगली सुबह के ऑर्डर बदले जा सकते हैं।"},{"q":"वॉलेट में पैसा कैसे डालें?","a":"वॉलेट खोलें, रकम चुनें, UPI QR से भुगतान करके UTR नंबर डालें। एडमिन वेरिफाई करते ही बैलेंस जुड़ जाएगा।"},{"q":"दूध ख़राब निकले तो?","a":"वॉलेट में रिफंड रिक्वेस्ट डालें, वेरिफिकेशन के बाद रिफंड मिलेगा।"}]'),
('policies', '{"terms":"यहाँ अपनी नियम-शर्तें लिखें।","privacy":"यहाँ अपनी प्राइवेसी पॉलिसी लिखें।","refund":"यहाँ अपनी रिफंड पॉलिसी लिखें।"}'),
('theme', '{"pri":"#0d5c3a","light":"#e8f5ee","acc":"#d4af37"}')
on conflict do nothing;
