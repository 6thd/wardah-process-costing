# قائمة فحص الإنتاج — Wardah ERP

> آخر تحديث: P4 (9 يوليو 2026). هذه القائمة هي بوابة الانتقال للإنتاج —
> كل بند يُشطب بعد التحقق الفعلي، لا بالافتراض.

## 1) قاعدة البيانات — Migrations ✅ مطبَّقة على الإنتاج (10 يوليو 2026)

طُبِّقت 82–89 مباشرةً على مشروع `uutfztmqvajmsxnrqeiv` عبر واجهة الإدارة مع تحقق
بعد كلٍّ. تبقى الملفات مؤرشفةً لإعادة بناء أي بيئة جديدة:

- [x] **82** `82_p4_security_hardening.sql` — إزالة `execute_sql` (كانت غائبة أصلاً)
- [x] **83** `83_p4_org_scoped_rls.sql` — عزل products/categories/journals/BOM
  - ⚠️ الملف افترض أسماء سياسات لم تطابق الحيّ فبقيت `"Allow all"` مفتوحة —
    **أُتمّت الإزالة في 86**. تحقُّق نهائي: بمفتاح anon القراءة من products ⇒ 0 صف
- [x] **84** `84_p4_gr_receipt_event_mapping.sql` — GRNI 210150 + GR_RECEIPT (مدين 131100/دائن 210150)
- [x] **85** `85_p4_atomic_delivery_note.sql` — دالة التسليم (نسخة أولى)
- [x] **86** `86_p4_close_anon_rls_holes.sql` — إغلاق anon على كل الدفتر المالي
  (gl_entries، sales/purchase/supplier invoices، goods_receipts، delivery_notes
  وأسطرها) بتحويل `"Allow all%"` من public إلى authenticated
  - تحقُّق عملي: بمفتاح anon القراءة من `gl_entries` ⇒ 0 صف (كانت تكشف الكل)
- [x] **87** `87_p4_fix_delivery_note_schema.sql` — مواءمة دالة التسليم مع المخطط الحيّ
  (`products`/`org_id` بدل `items`/`tenant_id`)؛ COGS_DELIVERY = **544000 / 135100**.
  مُختبرة حيّاً بـ rollback (success + total_cogs صحيحة).
- [x] **88** `88_p5_harden_delivery_note.sql` — **تحصين التسليم**: تحقق عضوية المستخدم
  + عزل org لكل استعلام + ملكية الفاتورة/السطر/المنتج + منع تسليم زائد +
  `idempotency_key` + **COGS Fail-closed**. 9 اختبارات rollback حيّة ناجحة.
- [x] **89** `89_p5_atomic_goods_receipt.sql` — **استلام ذرّي**: رأس+سطور+قيد GRNI في
  معاملة واحدة Fail-closed (لا مستند بلا قيد) + عزل org + عضوية + idempotency.
  دفتر المخزون/التقييم يبقى في الواجهة. 5 اختبارات rollback حيّة ناجحة.

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
| عزل org_id لجداول الدفتر المالي (بدل authenticated USING(true)) | تجهيز SaaS — Migration 90+ ببيئة staging |
| strict TypeScript + اختبارات DB حقيقية (تسليم زائد/تزامن) | دفعة جودة لاحقة |
