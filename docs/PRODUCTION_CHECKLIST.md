# قائمة فحص الإنتاج — Wardah ERP

> آخر تحديث: P14 (17 يوليو 2026). هذه القائمة هي بوابة الانتقال للإنتاج —
> كل بند يُشطب بعد التحقق الفعلي، لا بالافتراض.

## 0) CI/CD Pipeline — حالة 17 يوليو 2026

| البند | الحالة |
|---|---|
| **T1** `ci-cd.yml` — lint + type-check + migration numbering | ✅ فعّال |
| **T2** `generate-baseline.yml` — توليد baseline من الإنتاج | ✅ workflow جاهز — يحتاج `SUPABASE_DB_URL` secret |
| **T3** Fresh DB chain test (`ci-cd.yml` § 3) | ✅ **فُعِّل** — `000_schema_baseline_20260717.sql` مودَع (cutoff 121) |
| **T4** E2E nightly (`e2e-nightly.yml`) — 4 أدوار × عزل org | ⏳ يحتاج 9 secrets (انظر أدناه) |

### Secrets المطلوبة لـT4

أضف في `Settings → Secrets and variables → Actions`:

| Secret | القيمة |
|---|---|
| `STAGING_URL` | رابط التطبيق المنشور (Vercel) |
| `E2E_USER_EMAIL` | إيميل مستخدم عادي |
| `E2E_USER_PASSWORD` | كلمته |
| `E2E_ORG_ADMIN_EMAIL` | إيميل org admin |
| `E2E_ORG_ADMIN_PASSWORD` | كلمته |
| `E2E_SUPER_ADMIN_EMAIL` | إيميل super admin |
| `E2E_SUPER_ADMIN_PASSWORD` | كلمته |
| `E2E_ORG_B_USER_EMAIL` | إيميل مستخدم المؤسسة B (عزل البيانات) |
| `E2E_ORG_B_USER_PASSWORD` | كلمته |

> **ملاحظة staging**: لا تحتاج دمج الفرع في main قبل تشغيل E2E —
> الاختبارات تعمل على `STAGING_URL` (Supabase + Vercel مستقل عن الفرع).
> يُنصح بالدمج لتفعيل T3 على main branch CI.

---

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
- [x] **90** `90_p5_harden_goods_receipt.sql` — **تشديد الاستلام**: مطابقة المورد بأمر
  الشراء + ملكية سطر PO ومطابقة منتجه + منع تجاوز الكمية المطلوبة + منع الكمية/التكلفة
  السالبة + ملكية المخزن + حالة PO قابلة للاستلام + **تحديث سطور/حالة PO داخل نفس
  المعاملة** + إصلاح **سباق idempotency** (فحص بعد القفل). 9 اختبارات rollback حيّة.
- [x] **91** `91_p5_delivery_idem_race_and_admin_gate.sql` — التسليم: إصلاح سباق
  idempotency + **`allow_over_delivery` محكوم بدور admin** لا براية العميل. مُختبَر حيّاً.
- [x] **92** `92_p6_fix_mo_status_machine_drift.sql` — **إصلاح آلة حالات التصنيع**:
  `rpc_transition_mo_status` و`trg_mo_status_machine` كانتا تشيران لأعمدة ميتة
  (`mo_number/date_started/date_finished`) فأي تغيير حالة يفشل بـ 42703 — صُحّحت إلى
  `order_number/start_date/completed_date` + تحقق عضوية + `previous_status` صحيح. مُختبَر حيّاً.
- [x] **93** `93_p6_atomic_mo_completion_costing.sql` — **إتمام أمر تصنيع ذرّي/مالي**:
  تكلفة WIP الفعلية المتراكمة من `material_consumption` ⇒ زيادة مخزون المنتج التام
  (متوسط مرجّح) + سلسلة قيود `MATERIAL_ISSUE` (مدين WIP 134100/دائن مواد) و`FG_RECEIPT`
  (مدين تام 135100/دائن WIP 134100) **Fail-closed** + حالة `done` + **idempotent** (لا
  إتمام مزدوج). الواجهة `updateManufacturingOrderStatus` توجّه الإتمام لهذا الـ RPC
  (RPC أولاً، fallback خارج الإنتاج، **Fail-closed في الإنتاج**). مُختبَر حيّاً بالكامل:
  PART 1 (مخزون تام + done + replay) + PART 2 (بتكلفة مواد 1000: `total_cost`=1000،
  قيدا MATERIAL_ISSUE + FG_RECEIPT، **WIP 134100 يصفو=0**، مخزون التام + تكلفته صحيحان).
  الأجور/الأوفرهيد وWIP متعدد المراحل: بناء لاحق.
- [x] **94** `94_p7_atomic_inventory_ledger_on_receipt.sql` — **إغلاق ذرّية المخزون**:
  نقل دفتر المخزون (Stock Ledger Entry + bins + طابور FIFO/LIFO + التقييم) من خطوات
  الواجهة المنفصلة (قراءة bin ⇒ حساب JS ⇒ كتابة — عرضة للسباق) إلى **داخل**
  `rpc_post_goods_receipt` عبر `wardah_apply_stock_incoming` (قفل صف bin FOR UPDATE)،
  فصار مستند + سطور + PO + GRNI + SLE + bin **معاملة ذرّية واحدة Fail-closed**. الواجهة
  تتخطّى خطوة SLE في المسار الأساسي وتُبقيها للـ fallback (تطوير) فقط. **✅ مطبَّقة
  ومُختبرة حيّاً**: WA/FIFO/LIFO تطابق محرّك التقييم، GRNI متزن، idempotent بلا SLE مكرَّر؛
  الاختبار الحيّ كشف وأصلح علة bin فارغ (SELECT INTO يُنيّل المتغيّرات ⇒ COALESCE بعد الجلب).
- [x] **95** `95_p8_harden_receipt_idempotency_security_and_zero_cost.sql` — **إغلاق مراجعة
  Codex على 92–94**: (P0) مسار replay يعيد `inventory_atomic=true` فلا تُكرّر الواجهة SLE/bin؛
  (P0 أمني) **سحب EXECUTE للدالة المساعدة `wardah_apply_stock_incoming` من authenticated**
  فتبقى داخلية (النداء من `rpc_post_goods_receipt` بصلاحية المالك)؛ (P1) تحقق وجود المورد
  وملكيته + إلزام المخزن للسطر المقبول + منع `purchase_order_line_id` بلا `purchase_order_id`؛
  (P2) إتمام تصنيع بتكلفة صفرية **Fail-closed** ما لم يُمرَّر `allow_zero_cost=true`. الواجهة:
  مفتاح idempotency ثابت من نموذج الاستلام عبر إعادة المحاولة + معاملة replay كمُعالَجة.
  مُختبَر حيّاً بالكامل (replay=SLE واحد، رفض الدالة لـ authenticated، رفض مورد/PO/مخزن، ZERO_COST).
- [x] **96** `96_p8_admin_gate_zero_cost_and_idempotency_request_hash.sql` — **إغلاق مراجعة
  Codex الثالثة**: (P1) `allow_zero_cost` صار محكوماً بدور مدير المؤسسة (is_org_admin/admin/owner)
  — غير المدير تُخفَّض رايته فيسري Fail-closed (كنمط `allow_over_delivery`/91)؛ (P2) عمود
  `request_hash` على `goods_receipts` + مقارنة بصمة الحمولة على مسار idempotency: نفس المفتاح
  بحمولة مختلفة ⇒ `IDEMPOTENCY_KEY_REUSED` (بدل إرجاع سند خاطئ). الواجهة: مفتاح idempotency
  مقرون ببصمة الحمولة في نموذجَي **الاستلام والتسليم** (تغيّر الكمية/المخزن/السطور ⇒ مفتاح جديد).
  مُختبَر حيّاً (IDEMPOTENCY_KEY_REUSED، بوابة admin لغير المدير).

> **P0 (كود، لا migration): إصلاح تصفير مخزون الاستلام** — كان
> `purchasing-service.ts` يستخدم stub تقييم يُرجع أصفاراً فيُصفّر رصيد الـ Bin
> والتقييم عند كل استلام مقبول. أُعيد ربط محرّك التقييم الحقيقي (`services/valuation`
> — FIFO/LIFO/متوسط مرجّح/متحرّك، مُختبَر). **✅ عولجت ذرّية المخزون الكاملة
> (Migration 94)**: بورت دفتر المخزون/التقييم إلى داخل `rpc_post_goods_receipt`
> فصار مستند+GRNI+PO+SLE+bin معاملة ذرّية واحدة تحت قفل صف الـ bin (⏳ بانتظار
> التطبيق الحيّ + اختبار rollback).

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
- [ ] إتمام أمر تصنيع (بعد تسجيل استهلاك مواد) ⇒ مخزون المنتج التام يزيد + قيدان
  `MATERIAL_ISSUE` + `FG_RECEIPT` يظهران و **WIP 134100 يصفو**؛ إتمام ثانٍ لنفس الأمر
  = لا خصم/قيد مزدوج (idempotent). إتمام بلا استهلاك مواد ⇒ تحذير «تكلفة صفرية».

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
