# خطة التحسينات الجوهرية — قسم التصنيع وقسم المحاسبة (Fullstack)

**التاريخ:** 7 يوليو 2026
**النطاق:** مراجعة شاملة للكود الفعلي (Frontend + Services + SQL/RPC + Schema) وليس للوثائق فقط
**المنهجية:** كل ملاحظة في هذه الخطة مدعومة بمرجع ملف وسطر من الكود الحالي

---

## 📁 محتويات الخطة

| الملف | المحتوى |
|---|---|
| [01_CROSS_CUTTING_FOUNDATIONS.md](./01_CROSS_CUTTING_FOUNDATIONS.md) | الأساسات المشتركة: توحيد Multi-Tenancy، الذرّية (Atomicity)، معالجة الأخطاء، إدارة الـ Migrations، توليد الأنواع (Types) |
| [02_MANUFACTURING_IMPROVEMENTS.md](./02_MANUFACTURING_IMPROVEMENTS.md) | تحسينات قسم التصنيع: توحيد نموذج التكاليف، آلة حالات أوامر التصنيع، الحجز والاستهلاك الذرّي، Backflush، تقرير تكاليف الإنتاج، تحسينات الواجهة |
| [03_ACCOUNTING_IMPROVEMENTS.md](./03_ACCOUNTING_IMPROVEMENTS.md) | تحسينات قسم المحاسبة: القيد الذرّي، ربط العمليات التشغيلية بالـ GL عبر gl_mappings، إقفال الفترات، تسوية الأستاذ المساعد، حماية القيود المرحّلة، الضريبة والفوترة الإلكترونية |

---

## 🎯 الملخص التنفيذي

النظام يحتوي على **أساس نظري ممتاز** (Process Costing مع EUP وFIFO وScrap Accounting على مستوى SQL، وطبقة Domain نظيفة مع اختبارات IAS-2/IAS-16)، لكن **الطبقات الثلاث غير متصلة ببعضها فعلياً**. المشاكل الجوهرية ليست في نقص الميزات بل في **الانفصال والازدواجية**:

### المشاكل الخمس الأخطر (مرتبة بالأثر)

1. **🔴 الترحيل المحاسبي للتصنيع غير موصول إطلاقاً**
   دوال SQL الجاهزة `post_mo_stage_to_wip` و`finish_mo_to_stock` و`post_purchase_receipt_to_gl` و`post_sales_delivery_to_gl` (في `sql/migrations/03_operational_gl_integration.sql`) **لا يستدعيها أي سطر في `src/`**. وبالمقابل، الواجهة تستدعي `rpc_post_event_journal` (في `src/services/accounting/posting-service.ts:67`) وهي دالة **غير معرّفة في أي ملف SQL في المستودع**. النتيجة: لا يوجد مسار فعلي يحوّل تكاليف التصنيع إلى قيود يومية.

2. **🔴 نموذجا بيانات متوازيان للتكاليف**
   دالة `complete_manufacturing_order` (في `sql/wardah_implementation/10_mo_functions.sql`) تقرأ من `labor_entries` و`overhead_allocations`، بينما خدمات الواجهة تكتب في `labor_time_logs` و`moh_applied` (في `src/services/process-costing-service.ts:113,205`). أي أن إكمال أمر التصنيع من قاعدة البيانات **سيحسب تكلفة عمالة وأوفرهيد = صفر** لأن البيانات في جداول أخرى.

3. **🔴 ابتلاع أخطاء قاعدة البيانات وإرجاع نجاح وهمي**
   النمط `if (error && !error.message.includes('Could not find')) throw` متكرر في `src/services/process-costing-service.ts:129,221,350,392` ويُرجع `id: 'temp-id'` عند الفشل. المستخدم يرى "تم الحفظ" بينما لم يُكتب أي شيء في قاعدة البيانات — **فقدان بيانات تكاليف صامت**.

4. **🟠 عمليات مالية غير ذرّية من المتصفح**
   إنشاء القيد اليومي = INSERT للرأس ثم INSERT للسطور بدون Transaction (`src/services/accounting/journal-service.ts:177-203`). إنشاء أمر تصنيع + حجز مواد = عمليتان منفصلتان وفشل الحجز يُسجَّل في `console.error` فقط (`src/services/manufacturing/createOrder.ts:77-82`).

5. **🟠 فوضى تعدد المستأجرين (Multi-Tenancy)**
   خليط `org_id` / `tenant_id` حسب الجدول، و`ORG_ID` يُقرأ من ملف Config عام بدلاً من جلسة المستخدم (`src/services/process-costing-service.ts:73`)، ودوال SQL بعضها يعتمد `current_setting('app.current_tenant_id')` وبعضها يستقبل `p_org_id` كمعامل من العميل.

### نقاط القوة التي نبني عليها

- ✅ محرّك Process Costing في SQL متقدم فعلاً: EUP (Weighted-Average + FIFO)، فصل Normal/Abnormal Scrap، `FOR UPDATE` locking في `upsert_stage_cost`
- ✅ محرّك AVCO في `sql/wardah_implementation/09_avco_functions.sql` مع قفل صفوف وسياسة السالب
- ✅ طبقة Domain نظيفة (`src/domain/`) مع Value Objects واختبارات معايير محاسبية
- ✅ بنية قيود يومية غنية: موافقات متعددة المستويات، مرفقات، تعليقات، عكس قيود، ترحيل دفعات

---

## 📊 مصفوفة الأولويات

| # | التحسين | القسم | الجهد | الأثر | الأولوية |
|---|---|---|---|---|---|
| 1 | توصيل الترحيل التشغيلي بالـ GL (قيود WIP/FG/COGS تلقائية) | محاسبة+تصنيع | 2-3 أسابيع | حرج | P0 |
| 2 | توحيد جداول التكاليف (labor/overhead) على نموذج واحد | تصنيع | 1-2 أسبوع | حرج | P0 |
| 3 | إيقاف ابتلاع الأخطاء + Result Type موحّد | مشترك | 3-5 أيام | حرج | P0 |
| 4 | RPC ذرّي لإنشاء القيود + قيد DB على التوازن | محاسبة | 3-5 أيام | حرج | P0 |
| 5 | توحيد org_id/tenant_id واشتقاقه من JWT | مشترك | 1 أسبوع | عالٍ | P0 |
| 6 | آلة حالات لأوامر التصنيع (State Machine) في DB | تصنيع | 1 أسبوع | عالٍ | P1 |
| 7 | حجز/استهلاك مواد ذرّي عبر RPC واحد | تصنيع | 1 أسبوع | عالٍ | P1 |
| 8 | فرض إقفال الفترات على كل مسارات الترحيل | محاسبة | 3-5 أيام | عالٍ | P1 |
| 9 | حماية القيود المرحّلة من التعديل (Trigger + RLS) | محاسبة | 2-3 أيام | عالٍ | P1 |
| 10 | توحيد مصدر الحقيقة للـ Migrations (supabase/migrations) | مشترك | 1-2 أسبوع | عالٍ | P1 |
| 11 | React Query لكل جلب البيانات + إلغاء useState/useEffect اليدوي | واجهة | 1-2 أسبوع | متوسط | P2 |
| 12 | تقرير تكلفة الإنتاج (Cost of Production Report) مع EUP | تصنيع | 2 أسابيع | متوسط | P2 |
| 13 | تسوية Subledger↔GL (مخزون، عملاء، موردون) | محاسبة | 2 أسابيع | متوسط | P2 |
| 14 | Backflush Costing اختياري حسب BOM | تصنيع | 2 أسابيع | متوسط | P3 |
| 15 | القوائم المالية (دخل/مركز مالي/تدفقات) من gl_entries | محاسبة | 2-3 أسابيع | متوسط | P3 |
| 16 | ZATCA e-Invoicing (المرحلة الثانية) | محاسبة | 4+ أسابيع | حسب السوق | P3 |

---

## 🗺️ خارطة الطريق المقترحة

### المرحلة صفر — وقف النزيف (أسبوعان)
- إصلاح ابتلاع الأخطاء (بند 3) — أخطر مشكلة لأنها تُخفي كل ما بعدها
- تجميد الكتابة في الجداول المهجورة وتحديد النموذج القانوني لكل كيان (بند 2 — قرار فقط)
- قيد `CHECK`/Trigger على توازن القيود في DB (جزء من بند 4)

### المرحلة الأولى — الأساسات (3-4 أسابيع)
- بنود 4، 5، 6، 7: ذرّية العمليات + توحيد الهوية + آلة الحالات
- بند 10: خط أساس Migration واحد قابل لإعادة البناء

### المرحلة الثانية — التكامل المحاسبي (3-4 أسابيع)
- بند 1: توصيل TصنيعGL عبر gl_mappings مع Idempotency
- بنود 8، 9: إقفال الفترات وحماية القيود

### المرحلة الثالثة — التقارير والتجربة (4-6 أسابيع)
- بنود 11، 12، 13، 15

---

## ✅ حالة التنفيذ

### ما نُفِّذ فعلاً (8 يوليو 2026) — المرحلة صفر

| البند | ما تم | الملفات |
|---|---|---|
| بند 3: إيقاف ابتلاع الأخطاء | حذف نمط `!error.message.includes('Could not find')` وإرجاع `'temp-id'` من كل دوال التكاليف — فشل الحفظ الآن يصل للمستخدم برسالة عربية واضحة | `src/services/process-costing-service.ts` |
| بند 4: RPC ذرّي للقيود | `rpc_create_journal_entry` (رأس + سطور + توازن + Idempotency في معاملة واحدة)، مع **Fallback تلقائي للمسار القديم** في `journal-service.ts` إذا لم يُطبَّق الـ Migration بعد — لا كسر لأي شيء | `sql/migrations/76_...sql` + `src/services/accounting/journal-service.ts` |
| بند 1 (جزئياً): الترحيل التشغيلي | تعريف `rpc_post_event_journal` و`rpc_post_work_center_oh` **المفقودتين** اللتين تستدعيهما الواجهة منذ زمن، مقادتين بجدول `gl_event_mappings` الجديد + دالة إدارة `rpc_upsert_event_mapping` | `sql/migrations/76_...sql` |
| بند 8 (جزئياً): حارس الفترات | `assert_period_open` — متسامح إن لم تُعرَّف فترات (لا يكسر العمل)، يرفض القيد في فترة مقفلة | `sql/migrations/76_...sql` |
| بند 9: حماية القيود المرحّلة | Triggers تمنع حذف/تعديل الحقول المالية للقيود المرحّلة وسطورها، مع السماح بمسارات الترحيل والعكس الحالية | `sql/migrations/76_...sql` |

### ✅ تم تطبيق Migration 76 على قاعدة البيانات الحية (8 يوليو 2026)

نُفِّذ محتوى `sql/migrations/76_p0_atomic_journal_and_gl_event_posting.sql` عبر Supabase SQL Editor بنجاح (`Success. No rows returned`). تم التحقق: 6 صفوف في `pg_proc` ✅

- إنشاء القيود اليومية **ذرّياً** عبر `rpc_create_journal_entry`
- القيود المرحّلة **محمية** من الحذف وتعديل الحقول المالية
- دالتا `rpc_post_event_journal` و`rpc_post_work_center_oh` **معرّفتان** وجاهزتان

### ✅ تم تطبيق Migration 77 — زرع خرائط الأحداث المحاسبية (8 يوليو 2026)

نُفِّذ محتوى `sql/migrations/77_seed_gl_event_mappings.sql` بنجاح. تم التحقق: 14 خريطة حدث في `gl_event_mappings` ✅

أكواد الحسابات مستخرجة مباشرة من `wardah_enhanced_coa.csv` و`wardah_gl_mappings.csv`:
- WIP بالمراحل: 134100 (خلط)، 134200 (بثق)، 134300 (طباعة)، 134400 (قطع)، 134500 (تغليف)
- FG: 135100+، مواد خام: 131100+، أجور: 210201، OH مُحمَّل: 514000، تالف: 595100/595200

### ✅ تم تطبيق Migration 78 — آلة حالات MO + حجز مواد ذرّي (9 يوليو 2026)

نُفِّذ محتوى `sql/migrations/78_p1_mo_state_machine_and_atomic_reservation.sql` بنجاح. تم التحقق: trigger `mo_status_machine` موجود ✅

- **`normalize_mo_status()`** — توحيد kebab-case ↔ snake_case (`in-progress` → `in_progress`، `completed` → `done`)
- **`validate_mo_transition()`** — منطق آلة الحالات: يرفع `MO_INVALID_TRANSITION` أو `MO_TERMINAL_STATE`
- **Trigger `mo_status_machine`** — يعمل قبل أي UPDATE على حقل status، يُطبق التحقق ويضبط تواريخ البداية/النهاية تلقائياً
- **`rpc_transition_mo_status()`** — RPC آمن لتغيير الحالة من الواجهة
- **`rpc_create_mo_with_reservation()`** — إنشاء MO + حجز مواد في معاملة واحدة (فحص التوفر مسبقاً)
- الواجهة (`updateStatus.ts`، `createOrder.ts`) تجرّب المسار الذرّي أولاً وتُراجع للمسار القديم تلقائياً إن لم يُطبَّق الـ Migration بعد (Fallback آمن)

### ✅ تم تطبيق Migration 79 — فرض إقفال الفترات + إدارتها (9 يوليو 2026)

نُفِّذ محتوى `sql/migrations/79_p1_period_enforcement_and_management.sql` بنجاح (مع تفعيل RLS من محرّر Supabase). تم التحقق: trigger `gl_entries_period_guard` موجود على `gl_entries` ✅ — بند 8 من المصفوفة:

- **إصلاح جذري في `assert_period_open`**: النسخة الأولى كانت تبحث بعمود `org_id` بينما جدول الفترات القديم يستخدم `tenant_id` — فكانت تسمح دائماً بصمت. v2 تكتشف اسم العمود تلقائياً (`wardah_periods_org_col`)
- **Trigger `gl_entries_period_guard`**: يحمي *كل* مسارات الإدخال والترحيل (INSERT قيد جديد، ترحيل draft→posted، تغيير تاريخ قيد) — مهما كان المصدر: RPC أو batch أو INSERT مباشر
- **جدول `accounting_periods`** يُنشأ إن لم يوجد (بـ `org_id` + RLS) — الجدول القديم إن وُجد لا يُمس
- **RPCs إدارية**: `rpc_list_periods`، `rpc_generate_fiscal_periods` (12 فترة شهرية)، `rpc_set_period_status` (إقفال/إعادة فتح، مع `permanently_closed` نهائي لا رجعة فيه)
- **طبقة خدمة جديدة**: `src/services/accounting/periods-service.ts` مع 9 اختبارات

السلوك: Fail-Open إن لم تُعرَّف فترات (لا كسر للعمل اليومي)، Fail-Closed برسالة `PERIOD_CLOSED` إن وُجدت فترة مقفلة تغطي التاريخ.

### ✅ إصلاحات إضافية (9 يوليو 2026)

| الإصلاح | الملفات |
|---|---|
| بند 5 (جزئياً): هوية المؤسسة من جلسة المستخدم أولاً (`getEffectiveTenantId`) بدلاً من `config.ORG_ID` الثابت — الـ Config يبقى Fallback فقط | `src/services/process-costing-service.ts` |
| رسائل أخطاء Supabase كانت تصل للمستخدم كـ `[object Object]` — `getErrorMessage` تتعامل الآن مع كائنات PostgREST | `src/services/enhanced-sales-service.ts` |
| اختبارات `createOrder` محدَّثة للمسار الذرّي (Migration 78) + اختبار `resumeWorkOrder` يحاكي RPC `start_operation` الفعلي | `createOrder.test.ts`، `mesService.test.ts` |

### ✅ تم تطبيق Migration 80 — تقرير تكلفة الإنتاج بالوحدات المكافئة (9 يوليو 2026) — بند 12 (P2)

نُفِّذ محتوى `sql/migrations/80_cost_of_production_report.sql` بنجاح. تم التحقق: الدالة `rpc_cost_of_production_report` موجودة في `pg_proc` ✅

أول مخرجات المرحلة الثانية: تقرير تكلفة الإنتاج (Cost of Production Report) بالخطوات الخمس القياسية:

1. **جدول الكميات**: WIP أول + بدأ = مكتمل + WIP آخر + تالف طبيعي/غير طبيعي (مع فحص توازن)
2. **الوحدات المكافئة**: لكل عنصر (مواد/تحويل) — بنفس معادلات `upsert_stage_cost` حرفياً (WA وFIFO)
3. **التكاليف الواجب حسابها**: WIP أول + محوَّل وارد + مواد + عمالة + أوفرهيد + إعادة طحن − رصيد خردة
4. **تكلفة الوحدة المكافئة**: لكل عنصر + مقارنة مع `unit_cost` المخزَّن
5. **التوزيع والتسوية**: مكتمل / WIP نهائي / خسارة تالف غير طبيعي — مع `is_balanced` لكل مرحلة وللأمر كاملاً

المكوّنات (إضافية 100% — قراءة فقط، لا تعديل على أي جدول):
- `rpc_cost_of_production_report(p_mo_id, p_stage_no?, p_tenant?)` — دالة `STABLE` تُرجع JSONB
- `src/services/manufacturing/cost-of-production-service.ts` — خدمة بأنواع كاملة + كشف PGRST202 (8 اختبارات)
- `src/features/manufacturing/cost-of-production-report.tsx` — شاشة RTL قابلة للطباعة (3 اختبارات)
- مسار جديد `/manufacturing/cost-of-production` + رابط في القائمة الجانبية

### ✅ تم تطبيق Migration 81 — تسوية الدفاتر الفرعية مع GL (9 يوليو 2026) — بند 13 (P2)

نُفِّذ محتوى `sql/migrations/81_subledger_gl_reconciliation.sql` بنجاح. تم التحقق: الدالة `rpc_subledger_gl_reconciliation` موجودة في `pg_proc` ✅

يقارن أرصدة الدفاتر الفرعية مع حسابات الأستاذ العام — أي قيد يدوي شارد أو ترحيل ناقص يظهر فوراً بدلاً من اكتشافه في إقفال نهاية السنة:

| القسم | جانب GL | جانب الدفتر الفرعي |
|---|---|---|
| المخزون | حسابات بادئة `131/132/133/135` من القيود المرحَّلة | `inventory_ledger` (AVCO) أو `stock_ledger_entries` — أيهما وُجد |
| WIP | حسابات بادئة `134` | `stage_costs` للأوامر المفتوحة (غير done/cancelled) |

المكوّنات (إضافية 100% — قراءة فقط):
- `rpc_subledger_gl_reconciliation(p_as_of_date?, p_tenant?, p_prefixes?)` — دفاعية: أي جدول غير موجود يُعلَّم قسمه `unavailable` دون فشل الدالة، وبادئات الحسابات قابلة للتخصيص
- `src/services/accounting/reconciliation-service.ts` (6 اختبارات)
- شاشة `/accounting/reconciliation` بتاريخ قابل للاختيار + تفصيل حسابات GL + شارات توازن + طباعة (3 اختبارات)

### ✅ بند 11 — توحيد React Query في hooks الجلب اليدوية (9 يوليو 2026) — P2

لا يتطلب أي migration — تحسين واجهة فقط، **بدون تغيير أي واجهة عامة**:

- `useManufacturingOrders` و`useManufacturingProducts` (كانتا `useState + useEffect` يدوياً) تستخدمان الآن React Query داخلياً — الواجهة الخارجية `{ orders, loading, loadOrders }` كما هي حرفياً، لا كسر لأي مستهلك
- **كاش مشترك**: نفس مفتاح `['manufacturing-orders']` المستخدم في `hooks/use-manufacturing.ts` — أي إنشاء/تغيير حالة عبر mutations يحدّث كل الشاشات تلقائياً
- المكاسب: إلغاء تكرار الطلبات بين الشاشات، `staleTime` يمنع الجلب الزائد، وإعادة الجلب بعد المسـح invalidation بدل إعادة تحميل يدوية
- `useAuth`/`usePermissions` بقيتا كما هما عمداً — حالة جلسة وليست بيانات خادم
- 6 اختبارات جديدة تثبت ثبات الواجهة والسلوك (PGRST205 ⇒ فارغ، خطأ ⇒ toast، loadOrders ⇒ إعادة جلب)

### ✅ P3-UI — أساسات الواجهة الموحَّدة (9 يوليو 2026)

التفاصيل الكاملة في [04_UI_FOUNDATIONS.md](./04_UI_FOUNDATIONS.md):

- **4 مكوّنات حالة موحَّدة** في `src/components/ui/`: `PageHeader` (يوحّد نمطاً مكرراً في 41 شاشة)، `EmptyState` (حالة فارغة موجِّهة)، `ErrorState` (رسالة + إعادة محاولة، `role="alert"`)، `loading-state` (هياكل skeleton تطابق المحتوى) — 10 اختبارات
- **طبقة طباعة احترافية** `src/styles/print.css`: إخفاء الملاحة تلقائياً، جداول أرشفة بحدود واضحة ورأس متكرر لكل صفحة، منع انقسام البطاقات، A4 بهوامش قياسية
- **طُبِّقت كنموذج مرجعي** على شاشتَي P2 (التسوية + تقرير تكلفة الإنتاج)
- الاعتماد تدريجي: الشاشات القديمة تعمل كما هي — لا حملة تعديل شاملة تخاطر بالكسر

### ✅ P4 — Production Ready (9 يوليو 2026)

دفعة الجاهزية الإنتاجية الكاملة — التفاصيل التشغيلية في [docs/PRODUCTION_CHECKLIST.md](../PRODUCTION_CHECKLIST.md):

**الأمان (المرحلة A)** — Migrations **82** (إزالة `execute_sql` — كانت تنفّذ أي SQL من المتصفح) و**83** (عزل المؤسسات RLS بفحص مسبق مُجهِض + rollback جاهز) ⚠️ بانتظار التطبيق؛ إغلاق ثغرة demo_mode (DEV فقط + false افتراضياً)؛ إزالة UUID المؤسسة الثابت من 5 مواضع؛ رؤوس أمان في vercel.json (HSTS/nosniff/X-Frame + CSP Report-Only)؛ إخفاء pooler-url من git.

**سلامة GL (المرحلة B)** — Migration **84**: قيد استلام البضاعة (مدين مخزون/دائن GRNI 210150 يُنشأ تلقائياً) ⚠️؛ B2: 4 خدمات كانت تكتب صفوف سطور في جدول رؤوس `gl_entries` (مسار مكسور) حُوِّلت للمسار الذرّي `JournalService` مع helper `account-lookup`؛ B3: الأخطاء المبتلعة بعد الترحيل (فاتورة/COGS/تحصيل/حركات) تتصاعد الآن كتحذيرات toast؛ B4: فحص الائتمان قابل للضبط (`credit_check_fail_closed`)؛ Migration **85**: إذن التسليم الذرّي `rpc_post_delivery_note` (قفل صف + خصم + حركة + COGS بمعاملة واحدة — يحل سباق الخصم) ⚠️ مع fallback كامل؛ B6: اختبارات مسارات المال (journal/posting/atomic-delivery).

**المراقبة وCI (المرحلة C)** — الاختبارات حاجز إلزامي في CI (كانت لا تعمل إطلاقاً!)؛ Sentry مركّب ويعمل عند وجود `VITE_SENTRY_DSN` (يعيّن `window.Sentry` فتشتغل فحوصات ErrorHandler القائمة)؛ شاشة "التطبيق غير مُهيّأ" بدل الشاشة البيضاء (`env-guard` + bootstrap محروس)؛ devtools خلف DEV؛ logger مشروط بالبيئة؛ إصلاح منفذ Playwright (5173).

**الأداء (المرحلة D)** — كل الموديولات lazy (كانت حزمة واحدة 3.9MB): الحمولة الأولية الآن ~1.1MB وxlsx/jspdf/الرسوم/Gemini (1.8MB+) تُحمَّل عند الحاجة فقط عبر `export-libs`؛ manualChunks للمكتبات المستقرة.

**التصليب (المرحلة E)** — عتبات تغطية كأرضية ضد الانحدار؛ `sql/migrations/MANIFEST.md` يحسم النسخ القانونية من 122 ملفاً؛ قائمة فحص إنتاج تشغيلية كاملة.

---

## 📏 معايير القبول العامة (Definition of Done)

لكل تحسين في هذه الخطة:
1. **Migration** واحد قابل للتطبيق والتراجع في `supabase/migrations/` (وليس ملف SQL يدوي في `sql/`)
2. **اختبار pgTAP أو اختبار تكامل** يثبت السلوك على مستوى قاعدة البيانات
3. **اختبار Vitest** لطبقة الخدمة يغطي مسار الفشل وليس النجاح فقط
4. **لا استعلام يكتب بيانات مالية مباشرة من المتصفح** — الكتابة المالية عبر RPC فقط
5. تحديث `docs/` بما يعكس السلوك الجديد
