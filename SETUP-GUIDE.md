# आज की धार — सेटअप गाइड (हिंदी)

Stack: **GitHub → Render (सर्वर) → Supabase (डेटाबेस) → Brevo (ईमेल OTP)**

## 0. पहले क्या-क्या बदला है (पुराने कोड से)
- डेटा अब `localStorage` में नहीं, Supabase में है। हर कस्टमर का अलग अकाउंट।
- लॉगिन: ईमेल OTP (Brevo)। एडमिन PIN हटा दिया, अब एडमिन = आपका ईमेल।
- वॉलेट में पैसा अपने-आप नहीं जुड़ता: ग्राहक UTR डालता है, एडमिन वेरिफाई करके अप्रूव करता है।
- रिफंड अपने-आप नहीं मिलता: ग्राहक रिक्वेस्ट डालता है, एडमिन अप्रूव करता है।
- रात के कटऑफ़ पर सर्वर अपने-आप सबके ऑर्डर बनाकर वॉलेट से बिल काटता है।
- Firebase हटा दिया (वह सबके लिए खुला था)।

## 1. Supabase रीसेट (पुराना डेटा हटाना)
सबसे आसान: **नया प्रोजेक्ट बनाएं**, पुराना बाद में डिलीट कर दें।
1. supabase.com → New project (पासवर्ड सुरक्षित रखें, रीजन: Mumbai)।
2. बाएँ मेन्यू में **SQL Editor → New query** → इस फ़ोल्डर की `schema.sql` पूरी कॉपी-पेस्ट करके **Run**।
3. **Project Settings → API** से दो चीज़ें कॉपी करें:
   - `Project URL` → `SUPABASE_URL`
   - `service_role` key (secret वाली, anon नहीं) → `SUPABASE_SERVICE_KEY`
   ⚠️ service_role key किसी को न दें, GitHub पर न डालें।

(अगर पुराना ही प्रोजेक्ट रखना है: SQL Editor में `drop schema public cascade; create schema public; grant usage on schema public to postgres, anon, authenticated, service_role; grant all on schema public to postgres, service_role;` चलाएं, फिर `schema.sql`.)

## 2. Brevo
- पुराना Brevo रीसेट करने की ज़रूरत **नहीं**। बस वही API key और verified sender ईमेल इस्तेमाल करें।
- Brevo → SMTP & API → API Keys → `BREVO_API_KEY`। Senders में जो ईमेल verified है वही `BREVO_SENDER_EMAIL` में डालें (वरना ईमेल नहीं जाएगा)।

## 3. GitHub
- नई रिपॉजिटरी बनाना ज़रूरी नहीं। पुरानी में सारी पुरानी फ़ाइलें हटाकर इस ZIP की फ़ाइलें डाल सकते हैं, या नई private रिपॉजिटरी बनाकर डालें (साफ़ शुरुआत के लिए यह बेहतर है)।
- `.env` फ़ाइल कभी अपलोड न करें (`.gitignore` में पहले से है)।
- ZIP खोलकर **अंदर की फ़ाइलें** (server.js, package.json, public/ …) रिपॉजिटरी के रूट में डालें।

## 4. Render
1. Render → New → **Web Service** → अपनी GitHub रिपॉजिटरी चुनें।
2. Runtime **Node**, Build Command `npm install`, Start Command `npm start`।
3. **Environment** में ये डालें (नाम बिल्कुल यही):

| नाम | क्या डालें |
|---|---|
| `SUPABASE_URL` | Supabase का Project URL |
| `SUPABASE_SERVICE_KEY` | service_role key |
| `JWT_SECRET` | कोई 32+ अक्षर का रैंडम टेक्स्ट |
| `ADMIN_EMAIL` | आपका ईमेल (कई हों तो कॉमा से) |
| `BREVO_API_KEY` | Brevo की key |
| `BREVO_SENDER_EMAIL` | Brevo में verified ईमेल |
| `BREVO_SENDER_NAME` | आज की धार |
| `CRON_SECRET` | कोई गुप्त कोड |
| `NODE_ENV` | `production` |

4. Deploy। अगर पुराना Render सर्विस है तो उसी में नई keys डालकर **Manual Deploy → Clear build cache & deploy**।
5. साइट खोलें → लॉगिन → अपने `ADMIN_EMAIL` से OTP → आप अपने-आप **Admin** बन जाएंगे। हेडर में ⚙ बटन दिखेगा (या लोगो पर 5 बार टैप)।

## 5. रात का ऑटो-चेकआउट (ज़रूरी)
Render का **फ्री प्लान 15 मिनट बाद सो जाता है**, तब रात का ऑटो-चेकआउट नहीं चलेगा। दो रास्ते:
- (a) Render का पेड प्लान (सबसे पक्का), या
- (b) फ्री: cron-job.org पर मुफ़्त अकाउंट बनाकर हर **5 मिनट** यह लिंक खुलवाएं:
  `https://आपकी-साइट.onrender.com/api/cron/nightly?key=आपका_CRON_SECRET`
  यह सर्वर को जगाए रखता है और कटऑफ़ के बाद काम भी चला देता है (दोबारा चलने पर दोहरा बिल नहीं कटता)।

## 6. पहली बार एडमिन में क्या भरें
**सेटिंग्स** टैब: दुकान का नाम, मोबाइल, WhatsApp, ईमेल, पता → पेमेंट (UPI ID, QR फ़ोटो अपलोड, COD/UPI/वॉलेट चालू-बंद) → डिलीवरी शुल्क/कटऑफ़ → FAQ और पॉलिसी लिखें।
**सोसायटी** जोड़ें (कैटेगरी/बैनर टैब में) और **राइडर** का ईमेल जोड़ें (कस्टमर & स्टाफ टैब)।
**प्रोडक्ट्स** में अपनी फ़ोटो अपलोड करें (कई फ़ोटो → ग्राहक स्वाइप करेगा)।

## 7. रोज़ का काम
1. सुबह: **डिस्पैच** टैब → राइडर असाइन → "शीट भेजें" (WhatsApp)।
2. **रिचार्ज/रिफंड** टैब: अपने UPI ऐप में UTR और रकम मिलाकर अप्रूव करें।
3. **रिपोर्ट** टैब: बिल, बिक्री, स्टॉक, कस्टमर लेजर CSV में डाउनलोड।

## 8. जो अभी मैंने चलाकर टेस्ट नहीं किया
मेरे वर्कस्पेस में इंटरनेट नहीं था, इसलिए `npm install` और असली Supabase/Brevo के साथ टेस्ट नहीं हो सका। कोड की सिंटैक्स जाँच हो चुकी है। पहली बार deploy के बाद ये ज़रूर आज़माएं: OTP लॉगिन → सब्सक्रिप्शन → रिचार्ज+UTR → एडमिन अप्रूव → "ऑटो-चेकआउट अभी चलाएं" → रसीद। कोई एरर आए तो Render **Logs** का टेक्स्ट मुझे भेज दें।
