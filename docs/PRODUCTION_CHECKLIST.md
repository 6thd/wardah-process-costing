# قائمة فحص الإنتاج — Wardah ERP

> آخر تحديث: P4 (9 يوليو 2026). هذه القائمة هي بوابة الانتقال للإنتاج —
> كل بند يُشطب بعد التحقق الفعلي، لا بالافتراض.

## 1) قاعدة البيانات — Migrations بانتظار التطبيق

طبّقها بالترتيب في محرّر Supabase SQL (كلها إضافية — لا تمس بيانات قائمة):

- [ ] **82** `82_p4_security_hardening.sql` — إزالة `execute_sql` (ثغرة تنفيذ SQL من المتصفح)
  - تحقق: `SELECT proname FROM pg_proc WHERE proname IN ('execute_sql','exec_sql','run_sql');` ⇒ 0 صفوف
  - ⚠️ قبلها: تأكد أن لا أتمتة خارجية عندك تستدعي `execute_sql`
- [ ] **83** `83_p4_org_scoped_rls.sql` — عزل المؤسسات (products/categories/journals/BOM)
  - **افتح `sql/rollback/83_rollback_org_scoped_rls.sql` في تبويب ثانٍ قبل التنفيذ**
  - لو رمى `PREFLIGHT_FAILED`: اقرأ الرسالة، فعّل عبارات الـ backfill المعلَّقة (مؤسسة واحدة)، أعد التنفيذ
  - بعده: سجّل دخولاً حقيقياً وتحقق أن المنتجات والقيود وBOM تظهر — عندها فقط أغلق تبويب التراجع
- [ ] **84** `84_p4_gr_receipt_event_mapping.sql` — حساب GRNI 210150 + حدث GR_RECEIPT
  - تحقق: `SELECT * FROM gl_event_mappings WHERE event_code = 'GR_RECEIPT';`
- [ ] **85** `85_p4_atomic_delivery_note.sql` — إذن التسليم الذرّي
  - تحقق: `SELECT proname FROM pg_proc WHERE proname = 'rpc_post_delivery_note';`
  - لاحظ إشعار زرع `COGS_DELIVERY` — لو فشل (أكواد حسابات مختلفة) ازرعه يدوياً:
    `SELECT rpc_upsert_event_mapping('COGS_DELIVERY', '<كود COGS>', '<كود FG>', NULL, '...');`

## 2) متغيرات البيئة في Vercel

- [ ] `VITE_SUPABASE_URL` — رابط المشروع
- [ ] `VITE_SUPABASE_ANON_KEY` — المفتاح العام
- [ ] `VITE_SENTRY_DSN` — (اختياري لكنه موصى به بشدة) مراقبة الأخطاء:
  1. أنشئ حساباً مجانياً على sentry.io ← مشروع React
  2. انسخ الـ DSN من Project Settings → Client Keys
  3. أضفه في Vercel → Settings → Environment Variables ← أعد النشر
  - بدون DSN: التطبيق يعمل طبيعياً لكن أخطاء الإنتاج لا تصلك
- ملاحظة: غياب مفاتيح Supabase الآن يعرض شاشة "التطبيق غير مُهيّأ" الواضحة بدل الشاشة البيضاء

## 3) أمان — أعمال يدوية لمرة واحدة

- [ ] **تدوير كلمة سر الـ pooler**: ملف `supabase/.temp/pooler-url` كان في git
  (أُخفي الآن). من Supabase → Settings → Database → Reset database password
- [ ] تأكد أن حسابات الديمو (`admin@wardah.sa` وشقيقاتها بكلمات `admin123` إلخ)
  **غير موجودة** في Supabase Auth الإنتاجي — احذفها إن وُجدت
- [ ] راجع Vercel بعد النشر: الرؤوس الأمنية تظهر في استجابة أي صفحة
  (`curl -I https://your-app.vercel.app` ⇒ HSTS + nosniff + X-Frame-Options)
- [ ] راقب تقارير CSP-Report-Only في DevTools Console بعد أسبوع استخدام —
  إن كانت نظيفة، رقِّ الرأس من `Content-Security-Policy-Report-Only` إلى المُلزم

## 4) تحقق وظيفي بعد التطبيق

- [ ] استلام بضاعة جديد ⇒ قيد GL يظهر تلقائياً (مدين 131100 / دائن 210150)
- [ ] إذن تسليم جديد ⇒ يمر عبر المسار الذرّي (لا تحذيرات في Console عن fallback)
- [ ] تقرير التسوية (`/accounting/reconciliation`) — سجّل الفجوة الحالية كخط أساس:
  الفجوة التاريخية طبيعية (حركات قبل P4)؛ **المطلوب ألا تكبر** مع العمليات الجديدة
- [ ] فاتورة مبيعات بقيد فاشل (مثلاً فترة مقفلة) ⇒ يظهر توست تحذير برتقالي واضح

## 5) CI/CD

- [x] الاختبارات حاجز إلزامي في `.github/workflows/ci-cd.yml` (P4-C1)
- [x] tsc + ESLint + build حواجز قائمة
- [ ] أول PR بعد هذه الدفعة: تأكد أن خطوة "Unit & integration tests" ظهرت ونجحت

## 6) خارج نطاق هذه الدفعة (مقرَّر ومؤجَّل عمداً)

| البند | السبب |
|---|---|
| إعادة بناء RLS لكل الجداول القديمة | يحتاج بيئة staging — 83 غطّت الجداول الحرجة |
| فرض CSP الكامل | Report-Only أولاً لرصد الانتهاكات |
| Playwright e2e في CI | الإعداد أُصلح (منفذ 5173) — التشغيل الدوري لاحقاً |
| توحيد مخطط stock-adjustment الثالث | موثَّق في `sql/migrations/MANIFEST.md` |
| تسلسل DB لأرقام المستندات | مرشح Migration 86 |
