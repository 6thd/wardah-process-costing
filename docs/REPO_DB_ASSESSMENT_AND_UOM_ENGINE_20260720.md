# تقييم شامل للمستودع وقاعدة البيانات + تصميم محرك تحويل الوحدات (UoM Conversion Engine)

**تاريخ التقييم:** 2026-07-20
**النطاق:** فحص حي لقاعدة Supabase (`uutfztmqvajmsxnrqeiv`) عبر MCP (Security + Performance Advisors + سجل migrations)، وفحص كود المستودع (SQL baseline 121 + migrations حتى 127 + طبقة الخدمات في `src/`).
**المنهج:** كل بند أدناه موثّق بمرجع ملف/سطر أو نتيجة فحص حي. لا يوجد بند مبني على تخمين.

---

## الجزء الأول — أخطاء وإصلاحات على مستوى قاعدة البيانات (Supabase)

### DB-1 (حرج — تكاليف): معادلة الوحدات المكافئة في التريغر الحي خاطئة

التريغر `trigger_calculate_wip_eu` مفعّل على `stage_wip_log` (Baseline سطر 12177) ويستدعي `calculate_wip_equivalent_units()` (Baseline سطر 4162) التي تحسب:

```sql
equivalent_units_material := (units_completed * pct/100) + (units_ending_wip * pct/100);
```

المعادلة القياسية للمتوسط المرجّح (Weighted Average) هي:

```text
EU = units_completed × 100% + units_ending_wip × completion_pct
```

أي أن نسبة الإتمام تُطبَّق على WIP النهائي فقط، بينما الوحدات المكتملة تُحسب دائمًا 100%. النتيجة الحالية: تقليص مقام EU ⇒ تضخيم `cost_per_eu` ⇒ تشويه تقييم `cost_completed_transferred` و`cost_ending_wip`.

**الأخطر:** الواجهة تحسب المعادلة **الصحيحة** (`src/features/manufacturing/__tests__/wip-derived.test.ts` يتوقع `800 + 200 × 0.5`)، أي أن القاعدة والواجهة تُنتجان رقمين مختلفين لنفس السجل.

مشاكل إضافية في نفس الدالة:

- `cost_beginning_wip` و`cost_transferred_in` يُضافان بالكامل إلى وعاء المواد؛ قياسيًا يجب فصل تكلفة Transferred-In في وعاء EU مستقل (مكتمل 100% دائمًا)، وتقسيم تكلفة WIP الافتتاحي بين المواد والتحويل.

**الإصلاح المقترح (Additive):** migration جديدة `128_fix_equivalent_units_weighted_average.sql` بـ`CREATE OR REPLACE FUNCTION` توحّد المعادلة مع الواجهة، مع سكربت إعادة احتساب اختياري للسجلات غير المقفلة (`is_closed = false`) فقط — لا تعديل على الفترات المقفلة (عكس قانوني موثق إن لزم).

### DB-2 (حرج — سلامة بيانات): ازدواجية الكتالوج `items` مقابل `products` بافتراض هوية غير مضمون

- التصنيع يشير إلى `items`: قيود FK موثقة لـ`material_consumption.item_id → items` و`routings.item_id → items` (Baseline سطر 2497 و2550)، و`material_reservations.item_id` كذلك.
- المخزون والمبيعات والمشتريات تشير إلى `products`: `bins`, `stock_ledger_entries`, `goods_receipt_lines`, `sales_invoice_lines`… (Baseline سطور 2405–2604).
- `rpc_consume_reserved_materials` (migration 124، سطر 633) تنفذ حرفيًا:

```sql
WHERE org_id = v_org AND product_id = v_res.item_id AND actual_qty > 0;
```

أي تعامل `item_id` (من كتالوج items) كأنه `products.id` مباشرة. لا يوجد أي جدول ربط أو view أو تريغر مزامنة بين الجدولين (تم الفحص). هذا يعمل فقط إن كانت الـUUIDs متطابقة بالمصادفة/بالإدخال اليدوي، وإلا فالاستهلاك يسقط صامتًا (لا bins مطابقة).

- **إضافة:** `bom_lines.item_id` بلا أي قيد FK إطلاقًا (القيد الوحيد على الجدول هو `bom_id`، سطر 2413) — يقبل UUID عشوائيًا.

**الإصلاح المقترح:** (أ) جدول جسر additive `item_product_map(org_id, item_id, product_id)` أو عمود nullable `items.product_id` مع backfill موثق، (ب) تعديل `rpc_consume_reserved_materials` للمرور عبر الجسر مع Fail-closed عند غياب الربط (`RAISE EXCEPTION 'ITEM_PRODUCT_MAP_MISSING'`)، (ج) إضافة FK على `bom_lines.item_id` بعد تنظيف البيانات (بـ`NOT VALID` ثم `VALIDATE CONSTRAINT` لتجنب قفل الجدول).

### DB-3 (جوهري): لا وجود لأي بنية وحدات قياس — نصوص حرة متضاربة

لا يوجد جدول `uoms` أو `uom_categories` أو أي دالة تحويل. الوحدات أعمدة varchar حرة متناثرة وبقيَم افتراضية متضاربة:

| الموضع | العمود | النوع | الافتراضي |
|---|---|---|---|
| `products` | `unit` | varchar(50) | `'قطعة'` |
| `items` | `unit` | varchar(20) | `'PCS'` |
| `bom_lines` | `uom` | varchar(50) | NULL |
| `bom_operation_materials` | `uom` | varchar(50) | NULL |
| `operation_resources` | `unit_of_measure` | varchar(20) | NULL |

حتى دوال تفجير الـBOM تتحوط للتضارب بـ`COALESCE(i.unit, i.unit_of_measure)` و`COALESCE(p.unit, p.uom)` (Baseline سطور 5070 و5117) — أي أن الكود نفسه لا يعرف اسم العمود القانوني. لا تحويل، لا تحقق، لا تطابق بين وحدة البند في الـBOM ووحدة المخزون. **المعالجة الكاملة في الجزء الثاني (محرك التحويل).**

### DB-4 (جوهري): تضارب دقة الأرقام العشرية للكميات عبر السلسلة الواحدة

نفس الكمية تمر عبر أعمدة بدقات مختلفة:

- `purchase_order_lines.quantity` و`goods_receipt_lines.received_quantity`: `numeric(12,2)`
- `stock_ledger_entries.actual_qty`: `numeric(15,4)`
- `material_reservations`, `bom_lines`, `stage_wip_log`: `numeric(18,6)`
- `products.stock_quantity`: `numeric(12,2)` بينما `items.stock_quantity`: `numeric(15,4)`

استلام 10.375 كجم يُقصّ إلى 10.38 في سطر الاستلام ثم يُرحَّل إلى الدفتر بدقة 4 خانات ⇒ انحراف تراكمي بين المستند والدفتر والرصيد. **الإصلاح:** توحيد سياسة `numeric(18,6)` للكميات عبر migrations additive (`ALTER COLUMN ... TYPE numeric(18,6)` توسيع آمن لا يفقد بيانات)، مع اعتماد التقريب في طبقة العرض/المستند فقط.

### DB-5 (من الفحص الحي — Security Advisors): 59 ملاحظة

نتائج `get_advisors(security)` الحية بتاريخ 2026-07-20:

1. **`vulnerable_postgres_version` (WARN):** نسخة Postgres الحالية عليها ترقيع أمني متاح. الإصلاح: ترقية عبر لوحة Supabase (Infrastructure → Upgrade) في نافذة صيانة، بعد أخذ لقطة والتحقق من التوافق مع PG17 baseline.
2. **`auth_leaked_password_protection` (WARN):** حماية كلمات المرور المسرّبة (HaveIBeenPwned) معطّلة. الإصلاح: تفعيلها من Auth settings — بدون أي تغيير كودي.
3. **`rls_enabled_no_policy` (INFO) على `items`, `journal_entries`, `journal_lines`:** RLS مفعّل بلا أي policy ⇒ الجداول fail-closed كليًا أمام العملاء. هذا مقبول لـ`journal_*` (مسار تاريخي لا يُبنى عليه جديد بحسب الـManifest)، لكنه يكشف أن `items` غير قابل للوصول من الواجهة إطلاقًا إلا عبر دوال DEFINER — يجب توثيق ذلك صراحة أو إضافة سياسات قراءة org-scoped إن كان الكتالوج مطلوبًا للواجهة.
4. **`authenticated_security_definer_function_executable` (WARN × 53):** معظمها محروس بـ`wardah_assert_org_member/admin` (سياسة المشروع)، لكن القائمة تشمل دوال قديمة مثل `backflush_materials`, `auto_schedule_work_orders`, `complete_operation`, `generate_entry_number` تحتاج مراجعة حارس فردية — سكربت `check_definer_guards.py` يفحص فقط ما بعد cutoff 121، فالدوال الأقدم خارج تغطيته.
5. **`anon_security_definer_function_executable` على `rpc_get_invitation_preview`:** مقصودة على الأرجح (معاينة دعوة قبل تسجيل الدخول) — تحتاج توثيقًا كاستثناء مقبول + اختبارًا سلبيًا يثبت أنها لا تسرّب إلا الحد الأدنى.

### DB-6 (من الفحص الحي — Performance Advisors): 585 ملاحظة

1. **`auth_rls_initplan` (WARN × 194 على 71 جدولًا):** سياسات RLS تستدعي `auth.uid()` / دوال لكل صف بدل `(SELECT auth.uid())` ⇒ إعادة تقييم لكل صف في كل استعلام. على جداول كبيرة (`stock_ledger_entries`, `gl_entry_lines`) هذا مكلف فعليًا. الإصلاح: migration واحدة تعيد كتابة السياسات بصيغة initplan-cached — تغيير ميكانيكي قابل للأتمتة والاختبار.
2. **`unused_index` (INFO × 376 على 110 كائنات):** ديون فهرسة ضخمة تبطئ الكتابة وتضخم التخزين. لا تُحذف دفعة واحدة؛ تقرير مراقبة 30 يومًا ثم إسقاط على دفعات موثقة (والفهارس المدعومة بقيود UNIQUE تُستثنى).
3. **`unindexed_foreign_keys` (INFO × 15):** منها `stock_adjustments` (جدول تشغيلي حي منذ 124-127) — يجب فهرسته فورًا؛ والبقية جداول لقطات قديمة (انظر DB-7).

### DB-7: جداول لقطات مهجورة في Production

`bill_of_materials_20250905_1900`, `cost_entries_20250905_1900`, `cost_predictions_20250905_1900`, `final_products_20250905_1900`, `notifications_20250905_1900`, `projects_20250905_1900`, `risk_assessments_20250905_1900` — نسخ backup من سبتمبر 2025 ما تزال في `public` وتظهر في ملاحظات RLS والفهارس. التزامًا بالقاعدة الذهبية (لا حذف): تصدير موثق ثم نقلها إلى schema أرشيفية `legacy_archive` عبر migration مرقمة + runbook، مع إبقاء إمكانية الاسترجاع.

### DB-8: أعمدة زمنية وتينانت في الدفتر القانوني

في `stock_ledger_entries`: `created_at`/`modified_at` من نوع `timestamp WITHOUT time zone` (بقية النظام `timestamptz`)، و**`org_id` قابل للـNULL** في الدفتر القانوني نفسه وفي `stock_reposting_queue`. الإصلاح: backfill لأي صفوف NULL ثم `ALTER COLUMN org_id SET NOT NULL` عبر قيد `NOT VALID → VALIDATE`، وتوحيد timestamptz للأعمدة الجديدة (الأعمدة القائمة تُترك وتُوثّق — لا تعديل تاريخ).

### DB-9: سجل Production مطابق للتوثيق (نتيجة إيجابية)

الفحص الحي لـ`supabase_migrations.schema_migrations` أكد: مطبقة حتى `127_stock_adjustment_ledger_valued_posting`، بازدواجية 101/102 التاريخية الموثقة في `migration_ledger_exceptions.json` تمامًا، وسجل 121 بالاسم التاريخي `fail_closed_tenant_isolation`. لا drift غير موثق — الحوكمة تعمل.

---

## الجزء الثاني — أخطاء وإصلاحات على مستوى المستودع (الكود)

### REPO-1 (حرج): مسار المبيعات يكتب المخزون من العميل بقراءة-ثم-كتابة غير ذرية

`src/services/enhanced-sales-service.ts` (دالة `recordSalesInventoryMovement`، سطر ~366): يقرأ `products.stock_quantity` ثم يحسب `newStock = currentStock - quantity` في المتصفح ثم `UPDATE products`. المشاكل:

- **سباق تزامن:** مستخدمان يبيعان معًا ⇒ خصم واحد يضيع.
- **تجاوز كامل للعمارة القانونية:** لا `stock_ledger_entries`، لا `bins`، لا AVCO — بينما الـManifest يوجب RPC ذرية واحدة، و`rpc_post_delivery_note` **موجودة فعلًا منذ migration 85** لكن هذا المسار لا يستخدمها.
- المستهلكون الفعليون: `SalesInvoiceForm.tsx`, `DeliveryNoteForm.tsx`, `src/features/sales/index.tsx`.

**الإصلاح:** تحويل فوترة/تسليم المبيعات بالكامل إلى `rpc_post_delivery_note` (وإنشاء `rpc_post_sales_invoice` ذرية للفاتورة+COGS إن لزم)، وإخضاع `enhanced-sales-service` للحذف التدريجي الموثق (deprecation ثم إزالة الاستدعاءات — الملف يبقى في التاريخ).

### REPO-2 (حرج): مسار fallback في المشتريات يعيد تنفيذ التقييم في الواجهة

`src/services/purchasing-service.ts` (سطر ~350–440): عندما لا تعيد `rpc_post_goods_receipt` العلم `inventory_atomic=true`، تنفذ الواجهة بنفسها: قراءة bin → حساب valuation عبر `ValuationFactory` → إدراج SLE → upsert على `bins` — **أربع طلبات منفصلة غير ذرية** وبنسخة ثانية من منطق التقييم يجب أن تبقى مطابقة للـSQL إلى الأبد. أي فشل بين الخطوات = دفتر بلا رصيد أو العكس.

**الإصلاح:** بما أن migration 94 مطبقة حيًا (المرجع سجل Production)، مسار الـfallback ميت وظيفيًا ويجب جعله **fail-closed**: إن غاب العلم يُرفض الترحيل برسالة واضحة بدل التنفيذ الجزئي من العميل.

### REPO-3: كتابة قيود GL مباشرة من العميل

`src/services/sales-service.ts` (سطر ~389): إدراج مباشر في `gl_entries` لقيد COGS من المتصفح، خارج أي RPC — قيد بلا ضمان توازن مدين/دائن ذري وبلا اشتقاق من `stock_value_difference` الفعلية (يخالف مبدأ PR #32 المطبق على التسويات). الإصلاح ضمن REPO-1 (RPC موحدة).

### REPO-4: ثلاث طبقات خدمات متوازية وملفات SQL سائبة

- `src/services/` و`src/modules/` و`src/features/` تتقاطع وظيفيًا (مثلًا منطق مخزون في الثلاثة) بلا حدود ملكية واضحة ⇒ هذا ما سمح بوجود REPO-1 بجوار المسار الذري.
- جذر `sql/migrations/` يحوي ملفات غير مرقمة خارج الحوكمة: `warehouse_accounting_fixed.sql`, `warehouse_management_system*.sql`, `phase2_stock_ledger_system.sql`, `phase3_valuation_methods.sql`, `fix_view_org_id_error.sql`, `migration_add_warehouse_to_goods_receipts.sql` — لا يمكن معرفة أيها طُبق يدويًا تاريخيًا. الإصلاح: نقلها إلى `sql/legacy_unmanaged/` مع README يوثق حالتها (نقل وليس حذف).
- مجلدات إرث في الجذر: `Gemini_enhanced_dashboard/`, `wardah_erp_handover/`, `js/` — خارج الـbuild ويجب عزلها في `docs/archive` أو مستودع أرشيفي.

### REPO-5: `products.stock_quantity` عاجز عن تمثيل ما يخزنه الدفتر

الواجهة تعرض وتقارن `products.stock_quantity` بدقة خانتين بينما الدفتر بدقة 4-6 خانات (انظر DB-4) — فحوصات التوفر في `enhanced-sales-service.checkStockAvailability` قد تُجيز بيعًا لا يغطيه الرصيد الفعلي أو العكس. يُحل بتوحيد الدقة (DB-4) + اعتماد `bins` مصدرًا للتوفر لا `products`.

---

## الجزء الثالث — تصميم محرك تحويل الوحدات (Units Conversion Engine)

### 3.1 لماذا الآن؟ (خلاصة دراسة الأقسام الثلاثة)

- **التصنيع:** `bom_lines.uom` نص حر لا يُستخدم في أي حساب؛ تفجير BOM يضرب الكميات مباشرة بافتراض وحدة موحدة؛ الوحدات المكافئة في `stage_wip_log` بلا وحدة معلنة أصلًا. مصنع بلاستيك (سياق وردة) يشتري بالكيلوجرام، ينتج رولات بالمتر، يبيع بالكرتون — بلا محرك تحويل كل مرحلة تُدخل أرقامًا بوحدة مختلفة على نفس الصنف.
- **المخزون:** `stock_ledger_entries.actual_qty` بلا عمود وحدة — الدفتر يفترض ضمنيًا وحدة `products.unit` النصية؛ أي إدخال بوحدة مغايرة يفسد الرصيد والتقييم معًا (valuation_rate لكل "وحدة" غير معرفة).
- **المحاسبة:** التقييم (AVCO/FIFO) يقسم قيمة على كمية؛ إن اختلطت وحدات الكمية اختلط `valuation_rate` وانهارت `stock_value_difference` التي تُشتق منها قيود GL القانونية (migration 127).

### 3.2 المبدأ الحاكم: وحدة أساس قانونية واحدة لكل صنف

**كل تخزين قانوني (SLE، bins، WIP، تقييم) يتم حصريًا بوحدة الأساس للصنف.** التحويل يحدث عند حدود الإدخال/العرض فقط، داخل الـRPC الذرية، مع **لقطة عامل التحويل** محفوظة في سطر المستند للتدقيق والعكس القانوني. هذا نفس نموذج ERPNext/Odoo الناضج، ويتوافق مع القاعدة الذهبية: لا نعدّل الدفتر التاريخي — الصفوف القديمة تُعتبر بوحدة الأساس بعامل 1.

### 3.3 مخطط قاعدة البيانات (migrations 128+، كلها additive)

```sql
-- 128_uom_engine_foundation.sql

CREATE TABLE public.uom_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,                    -- بذور عامة تُنسخ لكل org عند التفعيل
  code varchar(30) NOT NULL,               -- WEIGHT, LENGTH, VOLUME, COUNT, TIME, AREA
  name varchar(100) NOT NULL,
  name_ar varchar(100),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, code)
);

CREATE TABLE public.uoms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  category_id uuid NOT NULL REFERENCES public.uom_categories(id),
  code varchar(30) NOT NULL,               -- KG, G, M, CM, PCS, BOX...
  name varchar(100) NOT NULL,
  name_ar varchar(100),
  -- كم "وحدة مرجع للفئة" في وحدة واحدة من هذه: KG=1, G=0.001
  factor_to_reference numeric(24,12) NOT NULL CHECK (factor_to_reference > 0),
  is_reference boolean NOT NULL DEFAULT false,
  rounding_precision numeric(18,6) NOT NULL DEFAULT 0.000001,  -- خطوة تقريب العرض
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, code)
);
-- وحدة مرجع واحدة فعّالة لكل فئة
CREATE UNIQUE INDEX uoms_one_reference_per_category
  ON public.uoms (org_id, category_id) WHERE is_reference AND is_active;

-- تحويلات خاصة بالصنف (عبر الفئات): كرتون=24 قطعة، رول الفيلم 50م=12.5كجم
CREATE TABLE public.product_uom_conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  product_id uuid NOT NULL REFERENCES public.products(id),
  from_uom_id uuid NOT NULL REFERENCES public.uoms(id),
  -- كم وحدة أساس للصنف في 1 من from_uom
  factor_to_base numeric(24,12) NOT NULL CHECK (factor_to_base > 0),
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX product_uom_conv_active
  ON public.product_uom_conversions (org_id, product_id, from_uom_id)
  WHERE effective_to IS NULL;

-- أعمدة مواءمة nullable — لا نلمس الأعمدة النصية القديمة
ALTER TABLE public.products ADD COLUMN base_uom_id uuid REFERENCES public.uoms(id);
ALTER TABLE public.items    ADD COLUMN base_uom_id uuid REFERENCES public.uoms(id);
ALTER TABLE public.bom_lines ADD COLUMN uom_id uuid REFERENCES public.uoms(id);
ALTER TABLE public.purchase_order_lines ADD COLUMN uom_id uuid REFERENCES public.uoms(id);
ALTER TABLE public.goods_receipt_lines  ADD COLUMN uom_id uuid REFERENCES public.uoms(id);
ALTER TABLE public.sales_invoice_lines  ADD COLUMN uom_id uuid REFERENCES public.uoms(id);
ALTER TABLE public.delivery_note_lines  ADD COLUMN uom_id uuid REFERENCES public.uoms(id);
-- لقطة التدقيق على سطور المستندات:
--   qty_entered + uom_id + conversion_factor_snapshot ⇒ qty_base محسوبة داخل RPC
ALTER TABLE public.goods_receipt_lines
  ADD COLUMN qty_entered numeric(18,6),
  ADD COLUMN conversion_factor_snapshot numeric(24,12);
-- (نفس الثلاثي يُضاف لسطور التسليم والفواتير وأوامر الشراء)
```

ملاحظات تصميم ملزمة:

- **RLS** على الجداول الثلاثة بنمط org-scoped الموحد (بصيغة initplan-cached من البداية — انظر DB-6).
- **لا Generated Columns** للكمية المحوّلة على سطور المستندات (سياسة المشروع تمنع إرسالها، والاشتقاق داخل RPC أوضح للتدقيق).
- البذور القياسية (KG/G/TON، M/CM/MM، PCS/DOZEN/BOX، L/ML، HR/MIN) تُزرع بدالة `wardah_seed_default_uoms(p_org)` تُستدعى عند إنشاء org وفي backfill.

### 3.4 نواة التحويل SQL (Fail-closed)

```sql
-- 129_uom_engine_convert_functions.sql
CREATE OR REPLACE FUNCTION public.uom_factor(
  p_org uuid, p_product uuid, p_from_uom uuid
) RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_base uuid; v_factor numeric; v_from_cat uuid; v_base_cat uuid;
  v_from_ref numeric; v_base_ref numeric;
BEGIN
  PERFORM public.wardah_assert_org_member(p_org);
  SELECT base_uom_id INTO v_base FROM public.products
   WHERE id = p_product AND org_id = p_org;
  IF v_base IS NULL THEN RAISE EXCEPTION 'PRODUCT_BASE_UOM_MISSING'; END IF;
  IF p_from_uom = v_base THEN RETURN 1; END IF;

  -- 1) تحويل خاص بالصنف (يسمح بعبور الفئات: رول→كجم)
  SELECT factor_to_base INTO v_factor
    FROM public.product_uom_conversions
   WHERE org_id = p_org AND product_id = p_product AND from_uom_id = p_from_uom
     AND effective_from <= CURRENT_DATE
     AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
   ORDER BY effective_from DESC LIMIT 1;
  IF v_factor IS NOT NULL THEN RETURN v_factor; END IF;

  -- 2) تحويل عام داخل نفس الفئة فقط
  SELECT category_id, factor_to_reference INTO v_from_cat, v_from_ref
    FROM public.uoms WHERE id = p_from_uom AND org_id = p_org AND is_active;
  SELECT category_id, factor_to_reference INTO v_base_cat, v_base_ref
    FROM public.uoms WHERE id = v_base AND org_id = p_org AND is_active;
  IF v_from_cat IS NULL OR v_base_cat IS NULL
     THEN RAISE EXCEPTION 'UOM_NOT_FOUND_OR_INACTIVE'; END IF;
  IF v_from_cat <> v_base_cat
     THEN RAISE EXCEPTION 'UOM_CROSS_CATEGORY_NEEDS_PRODUCT_CONVERSION'; END IF;
  RETURN v_from_ref / v_base_ref;
END; $$;

CREATE OR REPLACE FUNCTION public.uom_convert_to_base(
  p_org uuid, p_product uuid, p_qty numeric, p_from_uom uuid
) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT p_qty * public.uom_factor(p_org, p_product, p_from_uom) $$;

REVOKE EXECUTE ON FUNCTION public.uom_factor(uuid,uuid,uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.uom_factor(uuid,uuid,uuid) TO authenticated;
-- (نفس النمط للدالة الثانية — متوافق مع check_definer_guards.py)
```

**قواعد صلبة:** لا افتراض عامل = 1 عند غياب التحويل (Fail-closed دائمًا)؛ التحويل عبر الفئات ممنوع إلا بتحويل صنفي صريح موقوت (`effective_from/to`)؛ الأسعار تُحوَّل عكسيًا (سعر وحدة الإدخال ÷ العامل = سعر وحدة الأساس).

### 3.5 التكامل مع الـRPC الذرية القائمة

التعديل بـ`CREATE OR REPLACE` على الدوال الحية (متوافق مع سياسة المشروع)، بمعامل jsonb اختياري لا يكسر الاستدعاءات القائمة:

1. **`rpc_post_goods_receipt`:** يقبل في كل سطر `uom_id` + `qty_entered` اختياريًا؛ داخليًا: `v_qty_base := uom_convert_to_base(...)`، `v_rate_base := unit_cost / v_factor`، ويُخزّن اللقطة في السطر. غياب `uom_id` = وحدة الأساس بعامل 1 (توافق رجعي كامل).
2. **`rpc_post_delivery_note` و`rpc_submit_stock_adjustment` و`rpc_manual_stock_movement`:** نفس النمط — التحويل قبل أي لمس لـSLE/bins، فتبقى `stock_value_difference` (أساس قيود GL في 127) صحيحة بلا أي تغيير على منطق GL.
3. **`rpc_consume_reserved_materials`:** بعد جسر items→products (DB-2)، تُحوَّل كمية `bom_lines.uom_id` إلى وحدة أساس المنتج المخزني قبل الخصم.
4. **تفجير BOM (`explode_bom` وأخواتها):** الكمية المطلوبة = `qty × uom_factor(component)` بدل الضرب المباشر، فتخرج المتطلبات كلها بوحدات الأساس القابلة للحجز.
5. **العكس القانوني:** أي إلغاء يقرأ `conversion_factor_snapshot` من السطر الأصلي — لا يعيد الاحتساب بعامل اليوم (العوامل الصنفية موقوتة وقد تتغير).

### 3.6 طبقة الواجهة

- خدمة واحدة `src/services/uom-service.ts` + hooks TanStack Query (`useUoms`, `useProductConversions`)؛ **يُمنع** تكرار منطق التحويل في المكونات — العرض التقديري فقط في الواجهة، والتحويل القانوني في SQL حصريًا (درس REPO-2).
- مكوّن `UomSelector` يعرض وحدات فئة الصنف + تحويلاته الخاصة مع معاينة حية: «5 كرتون = 120 قطعة».
- أسماء الوحدات عبر i18n (`name`/`name_ar` من الجدول) — لا نصوص مكتوبة مباشرة، التزامًا ببوابة i18n.
- تحديث `database.generated.ts` عبر توليد الأنواع (بوابة CI رقم 2).

### 3.7 خطة التنفيذ المرحلية

| المرحلة | المحتوى | Migrations | بوابة القبول |
|---|---|---|---|
| P0 | جداول + بذور + دوال التحويل + RLS | 128, 129 | Fresh DB أخضر + اختبارات وحدات للدوال (حدّية: عامل صفري مرفوض، عبور فئات مرفوض) |
| P1 | Backfill: ربط النصوص القديمة (`'قطعة'`,`'PCS'`,`'KG'`…) بـ`base_uom_id` عبر جدول قرارات موثق | 130 | تقرير تغطية 100% للأصناف الفعّالة، الغامض يُعلَّم للمراجعة اليدوية ولا يُخمَّن |
| P2 | تكامل RPC الاستلام/التسليم/التسوية + لقطات السطور | 131 | اختبارات تكامل: استلام بالكرتون يرصّد قطعًا بقيمة صحيحة؛ اختبار سلبي fail-closed |
| P3 | BOM/التصنيع + جسر items→products (DB-2) | 132 | استهلاك MO بوحدات مختلطة يطابق الدفتر يدويًا |
| P4 | فرض عبر تريغر: صفوف SLE الجديدة لصنف له `base_uom_id` تُرفض إن جاءت من مسار غير محوّل | 133 | اختبار سلبي + مراجعة أمنية |
| P5 | واجهة كاملة + إيقاف قراءة الأعمدة النصية (تبقى في المخطط بلا حذف) | — | E2E على staging بحسابات الاختبار |

كل migration تمر بمسار الحوكمة الكامل (تسمية `NNN_snake_case`، pglast، definer-guard، Fresh DB PG17، ثم Production بالترتيب، ثم تحديث Baseline عبر الـworkflow حصريًا).

---

## الجزء الرابع — أولويات التنفيذ الموصى بها

| # | البند | الأثر | الجهد |
|---|---|---|---|
| 1 | DB-1: تصحيح معادلة الوحدات المكافئة | أرقام تكاليف الإنتاج نفسها خاطئة | منخفض (دالة واحدة) |
| 2 | REPO-1/2/3: إغلاق مسارات الكتابة غير الذرية من العميل | سلامة المخزون والدفتر | متوسط |
| 3 | DB-2: جسر items↔products + FK على bom_lines | استهلاك المواد يعمل فعليًا | متوسط |
| 4 | DB-5/6 السريعة: ترقية Postgres + تفعيل حماية كلمات المرور + فهرسة stock_adjustments | أمن وأداء فوري | منخفض جدًا |
| 5 | محرك UoM مراحل P0–P2 | أساس تشغيلي لمصنع متعدد الوحدات | مرتفع |
| 6 | DB-4: توحيد دقة الكميات 18,6 | يمنع الانحراف التراكمي (شرط مسبق منطقي لمحرك UoM) | متوسط |
| 7 | DB-6: إصلاح auth_rls_initplan (194) + تقليم الفهارس | أداء على نطاق | متوسط |
| 8 | DB-7 + REPO-4: أرشفة اللقطات والملفات السائبة | نظافة حوكمة | منخفض |

**ملاحظة التزام:** كل ما سبق مقترح بصيغة additive حصرًا — لا حذف جداول أو أعمدة أو تاريخ، والتصحيحات الحسابية عبر `CREATE OR REPLACE` مع عدم المساس بالفترات المقفلة، تمامًا وفق القاعدة الذهبية في `CLAUDE.md`.
