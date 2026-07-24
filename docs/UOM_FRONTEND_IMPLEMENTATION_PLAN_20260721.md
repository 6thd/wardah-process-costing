# خطة تنفيذ واجهة محرك الوحدات (UoM) — نسخة مصحّحة على واقع المستودع

**التاريخ:** 2026-07-21
**المرجع الهندسي:** migrations 129–142 (مدمجة في `main` عبر PR #39، **غير مطبقة على Production**)
**مراجع مكملة:** `sql/migrations/MANIFEST_128_142.md`, `docs/REPO_DB_ASSESSMENT_AND_UOM_ENGINE_20260720.md`, `src/services/uom-service.ts`

> **⚠️ لقطة زمنية (snapshot):** يوثّق هذا المستند حالة قاعدة البيانات كما كانت بتاريخ **2026-07-21**، أي **قبل** تطبيق migrations على Production. لا تُعتبر عبارات «غير مطبقة على Production» أدناه حالةً حيّة؛ الحالة الحالية موضّحة في وصف الـPR ذي الصلة وفي سجل `supabase_migrations.schema_migrations`. عند أي تعارض بين هذا المستند ووصف الـPR، فوصف الـPR وسجل Production هما المرجع.

> **🟢 تحديث 2026-07-22 — إكمال Master Data للأصناف والوحدات (PR تالٍ بعد دمج PR #40):**
> - **G10 مُنجزة:** `src/features/inventory/components/UomBackfillIssues.tsx` — شاشة إصلاح الوحدات تعرض مشكلات `uom_backfill_issues` المفتوحة والأصناف `uom_migration_status <> 'MAPPED'`، مع إسناد وحدة أساس، وإنشاء تحويل (عبر `ProductUomSettings`)، وحل/تجاهل المشكلة مع تسجيل الملاحظة والمستخدم.
> - **بطاقة إعدادات الصنف:** أُضيف مسار قانوني لتعيين/تغيير وحدة الأساس (مع تأكيد إداري للتحويل العابر عدد↔وزن، ومنع الوحدات الخاصة بالصنف)، وعرض تاريخ التحويلات السابقة.
> - **§1.8 مُنجزة:** `sql/migrations/144_products_base_uom_change_guard.sql` — trigger يمنع تغيير `products.base_uom_id` بعد وجود SLE، مع RPC قانونية admin-guarded: `rpc_assign_product_base_uom`، `rpc_resolve_uom_backfill_issue`، `rpc_ignore_uom_backfill_issue`.
> - **منع استخدام الصنف غير المحسوم:** `useItemUomStatus` + `ItemUomStatusBadge` يعطّلان الصنف غير MAPPED في المنتقيات مع شارة وانتقال مباشر لشاشة الإصلاح (مطبّق على منتقي تسوية المخزون؛ يُعمَّم على منتقيات المشتريات/التصنيع في مراحل الدمج).
> - **بلا تفعيل ولا Production:** لا يُفعّل `uom_engine_enabled` ولا تُطبَّق migration 143 أو 144 على Production في هذه الخطوة. الرقم 143 استُهلك فعليًا لقراءة العلم؛ migration إنشاء أمر الشراء الذري تنتقل إلى رقم لاحق (بعد 144).

---

## 0. الحالة الفعلية الموثقة (قبل أي تعديل)

### 0.1 ما يوفره المحرك في قاعدة البيانات اليوم (بعد 129–142)

| العنصر | الحالة | الملف |
|---|---|---|
| `uom_categories`, `uoms`, `uom_aliases`, `product_uom_conversions`, `uom_backfill_issues` | موجودة، والتحويلات append-only (إغلاق زمني عبر `valid_to`) والكتابة عبر RPC فقط | 129 |
| `products.base_uom_id` + `uom_migration_status` (`PENDING/MAPPED/AMBIGUOUS/NO_UNIT`) | موجودة على `products` و`items` | 129 |
| أعمدة المستندات: `uom_id`, `qty_entered`, `conversion_factor_snapshot` (+ `unit_price_entered` في PO/SI، `unit_cost_entered` في GR) | موجودة على سطور PO/GR/SI/DN والتسويات والحجوزات | 129 |
| `rpc_convert_product_uom`, `wardah_uom_factor` fail-closed | موجودة | 131 |
| جسر `items`/`products` + `wardah_resolve_product_id` | موجود | 132 |
| `rpc_post_goods_receipt(jsonb)` و`rpc_post_delivery_note(jsonb)` UoM-aware + idempotency | موجودة والواجهة تستدعيها فعلًا (fail-closed) | 133 |
| `rpc_manual_stock_movement_v2(jsonb)` + تطبيع تسويات الجرد | موجودة | 134 |
| `rpc_set_product_uom_conversion(..., p_allow_cross_dimension)` — إغلاق العامل القديم وإنشاء جديد ذريًا | موجودة | 136–137 |
| أوزان المنتج (`net_weight`, `gross_weight`, `weight_uom_id` على `products`) + `rpc_set_product_physical_weight` + `rpc_get_product_weight` | موجودة | 137 |
| تطبيع BOM (`quantity_base`) + `rpc_consume_reserved_materials_v2` + تدفق COGS الفعلي إلى `stage_wip_log.cost_material` | موجودة | 138 |
| Triggers تطبيع سطور PO/SI عند INSERT/UPDATE (السيرفر يحسب `quantity`/`unit_price` الأساسيين دائمًا) | موجودة | 139 |
| وحدات مخصصة للمستأجر `rpc_create_org_uom` | موجودة | 140 |
| `explode_bom` بقاسم متحقق ورفض BOM غير محسوم + عقد EXECUTE لدور `authenticated` | موجودة | 141–142 |

### 0.2 ما هو موجود في الواجهة اليوم

- `src/services/uom-service.ts` فقط: `getProductUomOptions` (وحدة الأساس أولًا + التحويلات النشطة `is_active=true, valid_to IS NULL`)، `convertProductQuantity`، `saveProductUomConversion`، `setProductPhysicalWeight`، `getProductWeight` — مع اختبارات وحدة.
- **لا يوجد** أي مكوّن UI أو hook أو شاشة تستهلك هذه الخدمة. لا يظهر `uom_id`/`qty_entered` في أي نموذج.

### 0.3 قيدان حاكمان للتسلسل (يجب احترامهما قبل أول سطر UI)

1. **المحرك غير مطبق على Production.** أي واجهة ترسل `uom_id`/`qty_entered` إلى قاعدة لا تملك أعمدة 129 ستفشل. لذلك كل شاشات UoM تُشحن خلف علم تفعيل (انظر §7).
2. **`src/types/database.generated.ts` قديم** — لا يحتوي `uoms` ولا `product_uom_conversions` ولا `uom_backfill_issues`. تجديد الأنواع المولدة خطوة صفرية إلزامية (بوابة CI رقم 2)، وإلا سيستمر نمط الـ cast غير الآمن الموجود في `uom-service.ts`.

---

## 1. تصحيحات جوهرية على الخطة المقدّمة

الخطة المقترحة سليمة في فلسفتها (طبقة تجارية + طبقة قانونية، snapshot لا يتغير، السيرفر مصدر الحقيقة). التصحيحات التالية تُلزم لأنها تخالف التوقيعات والسلوك الفعلي للمحرك:

### 1.1 توقيع استهلاك المواد (أهم تصحيح)

الخطة وصفت استدعاءً بمفاتيح `{reservation_id, stage_id, quantity, uom_id, warehouse_id, work_order_id, notes}` كجسم واحد. التوقيع الفعلي (138):

```
rpc_consume_reserved_materials_v2(
  p_mo_id uuid,          -- أمر التصنيع
  p_stage_id uuid,       -- يجوز NULL
  p_consumptions jsonb   -- مصفوفة أسطر، وليست كائنًا واحدًا
)
```

كل عنصر في المصفوفة:

```json
{
  "reservation_id": "…",      // أو "item_id" فيُختار أقدم حجز reserved تلقائيًا
  "quantity": 3.2,             // الكمية المدخلة بوحدة الإدخال (وليست الأساس)
  "uom_id": "…",              // اختياري؛ الافتراضي وحدة الحجز ثم وحدة الأساس
  "warehouse_id": "…",        // اختياري؛ يُستنتج إذا وُجد bin واحد كافٍ فقط
  "work_order_id": "…",       // اختياري؛ يُستنتج إذا وُجد WO مفتوح واحد فقط
  "consumption_type": "MANUAL",
  "notes": "…"
}
```

سلوك يجب أن تعكسه الواجهة:

- **يشترط وجود `stage_wip_log` مفتوح** للمرحلة والفترة الحالية (`OPEN_STAGE_WIP_LOG_NOT_FOUND`). شاشة الاستهلاك يجب أن تتحقق/تعرض حالة فترة WIP قبل السماح بالخصم، لا أن تكتشفها كخطأ خام.
- إذا لم تُمرَّر المرحلة ولم يكن هناك سوى WIP مفتوح واحد يُستنتج تلقائيًا؛ غير ذلك `STAGE_REQUIRED_FOR_MATERIAL_CONSUMPTION`.
- المخزن وأمر العمل يُستنتجان فقط عند وحدانية الخيار؛ الواجهة تعرض قائمة اختيار عند `WAREHOUSE_REQUIRED_FOR_CONSUMPTION` و`WORK_ORDER_REQUIRED_FOR_CONSUMPTION`.
- الناتج يعيد `material_cost_posted` و`stage_wip_log_id` — هذه هي القيم التي تُعرض لحظة الخصم (وليس حسابًا محليًا).
- `src/services/inventory-transaction-service.ts` ما زال يستدعي **v1** `rpc_consume_reserved_materials` (التي أصبحت مجرد wrapper يستنتج المرحلة من أول سطر). يُرقّى إلى v2 مع تمرير `stage_id` صراحة.

### 1.2 جدول رسائل الخطأ — أكواد فعلية وأسلوب مطابقة

بعض الأكواد في الخطة غير مطابقة، والمحرك يلحق بالكود تفاصيل (`CONSUMPTION_EXCEEDS_RESERVATION: remaining=…, requested_base=…`)، لذلك المطابقة تكون **بالبادئة (prefix)** لا بالمساواة. الجدول القانوني المستخرج من 129–142:

| الكود الفعلي (بادئة) | الرسالة للمستخدم | إجراء مساعد |
|---|---|---|
| `PRODUCT_BASE_UOM_REQUIRED` | يجب تحديد وحدة أساس للصنف أولًا | زر «فتح إعداد وحدات الصنف» |
| `PRODUCT_BASE_UOM_CANNOT_BE_PRODUCT_SPECIFIC` | لا يمكن جعل وحدة خاصة بالصنف (كالكرتون) وحدةَ أساس | شرح نموذج KG/PCS |
| `PRODUCT_UOM_CONVERSION_MISSING` | لا يوجد عامل تحويل ساري لهذه الوحدة | فتح تبويب الوحدات |
| `UOM_CATEGORY_MISMATCH` / `PRODUCT_UOM_CATEGORY_MISMATCH` | الوحدة غير متوافقة مع فئة وحدة الصنف | — |
| `UOM_CROSS_DIMENSION_NOT_ALLOWED` / `PRODUCT_UOM_CROSS_DIMENSION_REQUIRES_EXPLICIT_FLAG` | التحويل بين العدد والوزن يحتاج اعتمادًا صريحًا | يظهر فقط لمدير المخزون |
| `BASE_UOM_FACTOR_MUST_EQUAL_ONE` | عامل وحدة الأساس يجب أن يساوي 1 | — |
| `UOM_NOT_FOUND_OR_INACTIVE` | الوحدة غير معرّفة أو موقوفة | — |
| `BOM_HAS_UNRESOLVED_UOM_LINES` | توجد أسطر BOM بوحدات غير مكتملة | فتح شاشة Backfill Issues |
| `BOM_PRODUCT_OR_BASE_UOM_MISSING` | مكوّن BOM بلا صنف/وحدة أساس محسومة | — |
| `BOM_QUANTITY_MUST_BE_POSITIVE` / `BOM_EXPLOSION_QUANTITY_INVALID` / `BOM_CHILD_QUANTITY_INVALID` | كمية BOM غير صالحة | — |
| `CONSUMPTION_EXCEEDS_RESERVATION` | الكمية تتجاوز المتبقي من الحجز (اعرض المتبقي من ذيل الرسالة) | — |
| `OPEN_STAGE_WIP_LOG_NOT_FOUND` | لا توجد فترة WIP مفتوحة لهذه المرحلة | فتح شاشة المراحل |
| `STAGE_REQUIRED_FOR_MATERIAL_CONSUMPTION` | حدد المرحلة — يوجد أكثر من مرحلة مفتوحة | قائمة مراحل |
| `WAREHOUSE_REQUIRED_FOR_CONSUMPTION` / `WAREHOUSE_REQUIRED_FOR_DELIVERY` / `WAREHOUSE_REQUIRED` | حدد المخزن | قائمة مخازن |
| `WORK_ORDER_REQUIRED_FOR_CONSUMPTION` | حدد أمر العمل | قائمة أوامر عمل |
| `ACTIVE_RESERVATION_NOT_FOUND` | لا يوجد حجز نشط لهذه المادة | — |
| `PO_LINE_QUANTITY_MUST_BE_POSITIVE` / `SALES_LINE_QUANTITY_MUST_BE_POSITIVE` | الكمية يجب أن تكون موجبة | — |
| `PO_LINE_PRICE_MUST_BE_NONNEGATIVE` / `SALES_LINE_PRICE_MUST_BE_NONNEGATIVE` | السعر لا يقبل قيمة سالبة | — |
| `PRODUCT_WEIGHT_NOT_DECLARED` | لم يُعرَّف وزن للصنف — معاينة الوزن معطلة | (تحذير غير مانع في المحاكي) |
| `WEIGHT_UOM_MUST_BE_ACTIVE_MASS_UNIT` | وحدة الوزن يجب أن تكون من فئة الكتلة | — |
| `NET_WEIGHT_MUST_BE_POSITIVE` / `GROSS_WEIGHT_BELOW_NET_WEIGHT` | وزن صافٍ موجب، والإجمالي ≥ الصافي | — |
| `IDEMPOTENCY_KEY_REUSED` | هذا المستند مُرسل سابقًا ببيانات مختلفة | عرض المستند الأصلي |
| `STOCK_OUT_NOT_APPLIED` / `STOCK_IN_NOT_APPLIED` | تعذر تنفيذ الحركة المخزنية — لم يُحفظ شيء | — |
| `UOM_CODE_INVALID` / `UOM_NAME_AND_SYMBOL_REQUIRED` / `UOM_CATEGORY_NOT_FOUND` / `STANDARD_UOM_FACTOR_MUST_BE_POSITIVE` / `PRODUCT_SPECIFIC_UOM_FACTOR_MUST_BE_NULL` | أخطاء شاشة إنشاء وحدة مخصصة | — |

> ملاحظة تنفيذية: الأكواد تصل داخل `error.message` من PostgREST؛ الـ mapper يطبّق `startsWith` على أول توكن قبل `:`.

### 1.3 المعاينة الفورية مقابل المصدر القانوني

`rpc_convert_product_uom` استدعاء شبكي؛ لا يصلح لكل ضغطة مفتاح. القاعدة:

- **المعاينة الحية** تُحسب محليًا من `factor_to_base` القادم من `getProductUomOptions` (متوفر أصلًا في الذاكرة)، مع تقريب عرض حسب `decimal_places`.
- **الحفظ** يرسل المدخلات الخام فقط (`qty_entered`, `uom_id`, `unit_price_entered`) — triggers 139 والـ RPCs تحسب القيم القانونية. الواجهة لا ترسل `conversion_factor_snapshot` أبدًا ولا `quantity`/`unit_price` المحسوبين.
- `rpc_convert_product_uom` يُستخدم اختياريًا للتحقق عند blur أو في المحاكي داخل بطاقة الصنف.

### 1.4 أمر الشراء الذري

`rpc_create_purchase_order_uom` **غير موجود** في المحرك الحالي. الخيار المهني:

- **مرحليًا (بدون migration):** يبقى النموذج على INSERT رأس ثم سطور، مع إضافة أعمدة UoM — trigger 139 يحمي الصحة. عند فشل إدراج السطور يُحذف الرأس اليتيم (تعويض compensating delete) أو يُعاد فتحه كمسودة.
- **الهدف (migration جديدة 143+):** `rpc_create_purchase_order_uom(p_payload jsonb)` بنمط `rpc_post_goods_receipt` نفسه (idempotency_key + request hash + سطور في transaction واحدة)، وبالمثل لاحقًا لفاتورة المبيعات. تتبع كامل قواعد الحوكمة: ملف `143_atomic_purchase_order_creation.sql`، حارس SECURITY DEFINER، runbook.

### 1.5 الاستلام والتسليم: البنية موجودة — الفجوة في UI فقط

- `purchasing-service.ts` يستدعي `rpc_post_goods_receipt` فعلًا (fail-closed). مفاتيح السطر المدعومة في الـ payload جاهزة للوحدات: `qty_entered` (أو `received_quantity`)، `uom_id`، `unit_cost_entered`، `ordered_qty_entered`، `purchase_order_line_id`، `quality_status`. المطلوب فقط أن يعرض `GoodsReceiptForm` عمود الوحدة والمتبقي بوحدتين ويمرر المفاتيح.
- `enhanced-sales-service.ts` يستدعي `rpc_post_delivery_note` فعلًا. لكن `DeliveryNoteForm.tsx` فيه ثلاث مخالفات يجب إزالتها:
  1. يحسب `cogs_amount` في الواجهة (`unit_cost × qty`) — يُحذف؛ COGS الفعلي يعود من SLE عبر نتيجة الـ RPC ويُعرض فقط.
  2. يسقف الكمية على `products.stock_quantity` (مجمع مرجعي على مستوى كل المخازن) — التوافر الصحيح من `bins` للمخزن المحدد، والمقارنة أساس-مقابل-أساس.
  3. لا يرث وحدة سطر الفاتورة — الافتراضي القانوني: `uom_id` و`conversion_factor_snapshot` من سطر الفاتورة، والمتبقي يُحسب بالأساس ثم يُعرض بالوحدتين.

### 1.6 BOM

- `BOMBuilder.tsx` يستخدم حقل `unit_of_measure` نصًا حرًا بافتراضي `'EA'` — يُستبدل بمُنتقي `uom_id` من وحدات المكوّن (وحدة الأساس + التحويلات السارية). trigger `trg_normalize_bom_line_uom` يتكفل بالتطبيع، لكنه يرفض المكوّن غير المحسوم (`BOM_PRODUCT_OR_BASE_UOM_MISSING`) — الواجهة تمنع إضافة مكوّن `uom_migration_status <> 'MAPPED'` مسبقًا بدل انتظار الخطأ.
- `explode_bom(p_bom_id, p_quantity, p_org_id)`: `p_quantity` كمية **أساس** المنتج النهائي، وتُقسم داخليًا على كمية رأس الـ BOM (`p_quantity / header.quantity`) — واجهة أمر التصنيع تحول الكمية التجارية إلى الأساس أولًا (بالضبط كما في الخطة)، وتعرض خطأ `BOM_HAS_UNRESOLVED_UOM_LINES` كإحالة لشاشة الإصلاح.

### 1.7 الأصناف 51 و53 وBackfill

آلية «IGNORED» موجودة رسميًا: `uom_backfill_issues.status IN ('OPEN','RESOLVED','IGNORED')`، والأصناف غير المحسومة تحمل `uom_migration_status IN ('PENDING','AMBIGUOUS','NO_UNIT')`. المعالجة تكون **بيانات عبر شاشة إدارية** (تحديث status وربط الوحدة عبر RPC) وليست migration — لا نلمس السجل التاريخي.

### 1.8 منع تغيير وحدة الأساس بعد الحركات

لا يوجد حارس DB يمنع تغيير `products.base_uom_id` بعد أول حركة SLE. الواجهة ستمنع ذلك (تعطيل الحقل عند وجود حركات)، لكن الحماية القانونية تحتاج **migration مقترحة 144** `products_base_uom_change_guard` (trigger يرفض التغيير عند وجود SLE للصنف إلا عبر عملية ترحيل معتمدة). حتى تطبيقها، المنع واجهي + صلاحيات.

### 1.9 تكوين C1 — مصادقة

التوصية صحيحة ومطابقة للمحرك: Base = KG، CARTON خاصة بالصنف `factor_to_base = 5.4` عبر `rpc_set_product_uom_conversion` مع `p_allow_cross_dimension = true` (لأن CARTON من فئة العدد وKG من الكتلة)، `use_for_sale = true`، والوزن `net_weight = 1` لكل KG عبر `rpc_set_product_physical_weight`. سيناريو C1 هو أصلًا بوابة قبول رقم 5 في `MANIFEST_128_142.md`.

---

## 2. جرد الفجوات الأمامية (موثق بالملفات)

| # | الملف | الفجوة | الخطورة |
|---|---|---|---|
| G1 | `src/types/database.generated.ts` | لا يحتوي جداول/RPCs محرك UoM | حاجز لكل ما بعده |
| G2 | `src/components/forms/PurchaseOrderForm.tsx` | INSERT مباشر برأس+سطور منفصلين؛ لا `uom_id`/`qty_entered`/`unit_price_entered`؛ لا عمود وحدة | عالية |
| G3 | `src/components/forms/SalesInvoiceForm.tsx` | نفس فجوة G2 لوحدات البيع | عالية |
| G4 | `src/components/forms/GoodsReceiptForm.tsx` | المتبقي والاستلام بوحدة واحدة؛ لا يمرر مفاتيح UoM المدعومة في الـ RPC | عالية |
| G5 | `src/components/forms/DeliveryNoteForm.tsx` | COGS محسوب محليًا، توافر من `products.stock_quantity`، لا وراثة وحدة الفاتورة | عالية |
| G6 | `src/features/manufacturing/bom/BOMBuilder.tsx` | `unit_of_measure` نص حر بافتراضي `'EA'` | عالية |
| G7 | `src/services/inventory-transaction-service.ts` | يستدعي consume v1 بلا مرحلة | متوسطة |
| G8 | `src/features/manufacturing/components/ManufacturingOrderForm.tsx` | كمية الإنتاج بلا وحدة تجارية ولا تحويل قبل `explode_bom` | متوسطة |
| G9 | `src/features/inventory/index.tsx` | إنشاء المنتج بلا `base_uom_id`؛ لا تبويب «الوحدات والأوزان» | عالية (Master Data) |
| G10 | غير موجود | شاشة معالجة الأصناف غير المحسومة (`uom_backfill_issues` + `uom_migration_status`) | عالية (Master Data) |
| G11 | غير موجود | مكوّنات مشتركة `UomQuantityInput` وأخواتها + `useProductUoms` | أساس المراحل 3–4 |
| G12 | غير موجود | طبقة ترجمة أكواد الخطأ (§1.2) | عالية |
| G13 | التقارير (`features/reports`, تقارير المخزون/المبيعات) | عمود كمية واحد، لا عرض مزدوج ولا وزن/طن | متوسطة |
| G14 | غير موجود | شاشة إدارية للوحدات المخصصة (`rpc_create_org_uom`) وصلاحياتها | منخفضة |
| G15 | i18n | كل المكوّنات الجديدة يجب أن تمر عبر مفاتيح i18n — بوابة legacy `isRTL ? … : …` سترفض غير ذلك | حاكمة |

---

## 3. المرحلة صفر — تمكين (قبل أي شاشة)

1. **تجديد الأنواع المولدة** من قاعدة مطبق عليها 129–142 (فرع Supabase أو Fresh DB) وإزالة الـ cast في `uom-service.ts`.
2. **علم تفعيل** `uom_engine_enabled` في `org_settings` (البنية موجودة من 98) مع hook `useUomEngineEnabled()`. كل مسارات UI الجديدة مشروطة به؛ القيمة الافتراضية false حتى تطبيق الـ migrations على Production وتحقق بوابات `MANIFEST_128_142.md`.
3. **`uom-error-mapper.ts`** في `src/services` أو `src/utils`: مطابقة بالبادئة، إرجاع `{ title, description, action?: 'OPEN_PRODUCT_UOM_SETTINGS' | 'OPEN_BACKFILL_ISSUES' | 'PICK_WAREHOUSE' | … }`، مع fallback عام لا يطبع الكود الخام إلا في تفاصيل قابلة للطي. اختبارات وحدة لكل كود.

## 4. المرحلة الأولى — Master Data

### 4.1 تبويب «الوحدات والأوزان» في بطاقة الصنف

مكوّن جديد `src/features/inventory/components/ProductUomSettings.tsx` يُركّب داخل بطاقة الصنف الحالية (وفي حوار الإنشاء يظهر بعد الحفظ الأولي). البطاقات الأربع كما في الخطة، بضبطها على الواقع:

- **وحدة الأساس:** قائمة من `uoms` غير الخاصة بالأصناف (المحرك يرفض غيرها). دقة العرض من `decimal_places`. الحالة من `uom_migration_status`. الحقل للقراءة فقط إذا وُجدت حركات SLE للصنف (استعلام عدّ خفيف) مع تلميح «يتطلب عملية ترحيل».
- **وحدات الشراء والبيع:** جدول من `getProductUomOptions` + التاريخية عبر استعلام منفصل يشمل `valid_to IS NOT NULL` للعرض فقط. أزرار الإضافة/التعديل تستدعي `saveProductUomConversion` (التي تغلق القديم وتنشئ الجديد ذريًا) — لا كتابة مباشرة أبدًا. تعديل عامل عابر للفئات يُظهر مربع تأكيد إداري قبل تمرير `allowCrossDimension: true`.
- **الوزن الفيزيائي:** `setProductPhysicalWeight` مع قوائم وحدات فئة الكتلة فقط.
- **محاكي التحويل:** `convertProductQuantity` + `getProductWeight`، مع تحمّل `PRODUCT_WEIGHT_NOT_DECLARED` كتحذير غير مانع.

### 4.2 شاشة «أصناف تحتاج إعداد وحدة»

`src/features/inventory/components/UomBackfillIssues.tsx`: قائمة `uom_backfill_issues` المفتوحة + الأصناف `uom_migration_status <> 'MAPPED'`، بإجراءات: «إسناد وحدة أساس»، «إنشاء تحويل»، «تجاهل (IGNORED)» — التجاهل يتطلب دور مدير مخزون ويُسجل في notes. هنا تُعالج حالتا الصنفين 51 و53 كبيانات، لا كـ migration.

### 4.3 حارس الحركة على الصنف غير المحسوم

في كل نقاط اختيار الصنف داخل مستندات المخزون: الصنف `uom_migration_status <> 'MAPPED'` يظهر معطلًا مع شارة «يحتاج إعداد وحدة» وزر انتقال للتبويب (المحرك سيرفضه على أي حال؛ الواجهة تمنع الوصول للخطأ).

## 5. المرحلة الثانية — المكوّنات المشتركة

`src/components/uom/`:

| المكوّن | العقد |
|---|---|
| `useProductUoms(productId)` | TanStack Query فوق `getProductUomOptions`، مفتاح `['product-uoms', orgId, productId]`، `staleTime` دقائق، إبطال عند حفظ تحويل |
| `UomQuantityInput` | props: `{ productId, value: UomQuantityValue, onChange, purpose: 'purchase'|'sale'|'manufacturing'|'any', showPrice?, showWeight?, defaultUomId? }` — فلترة `use_for_purchase`/`use_for_sale` مع **إبقاء وحدة الأساس متاحة دائمًا** (الخدمة تعيدها use_for_* = true)، ومعاينة محلية من `factor_to_base` |
| `UomConversionPreview` | سطر معاينة: «10 كرتون = 54 KG = 0.054 TON» — التحويل للطن للعرض فقط عبر فئة الوحدة |
| `ProductWeightPreview` | يستدعي `getProductWeight` بشكل كسول؛ يخفي نفسه عند `PRODUCT_WEIGHT_NOT_DECLARED` |
| `UomBadge` | عرض رمز الوحدة بدقة `decimal_places` — يُستخدم في الجداول والتقارير |

`UomQuantityValue` كما في الخطة (`productId, quantityEntered, uomId, unitPriceEntered?`) — **بلا** حقل عامل تحويل؛ العامل لا يغادر السيرفر كحقيقة.

الاختبارات: وحدة لكل مكوّن (فلترة الغرض، وحدة الأساس أولًا، الدقة، سلوك الأخطاء) بنمط اختبارات `uom-service.test.ts` الحالية.

## 6. المرحلتان الثالثة والرابعة — دمج المستندات

الترتيب حسب أثر التكلفة القانونية:

1. **`PurchaseOrderForm`** (G2): عمود وحدة عبر `UomQuantityInput` بغرض purchase؛ الإرسال يصبح `{ product_id, uom_id, qty_entered, unit_price_entered, discount_percentage, tax_percentage }` بلا `quantity`/`unit_price` محسوبين (trigger 139 يتكفل). سطر المعاينة: الكمية | الوحدة | السعر | كمية الأساس | الإجمالي. لصق Excel يفسر العمود الثالث وحدةً اختيارية عبر `uom_aliases`. تعويض حذف الرأس عند فشل السطور، إلى حين migration 143.
2. **`GoodsReceiptForm`** (G4): وراثة وحدة أمر الشراء افتراضيًا، عرض المتبقي بالوحدتين (المقارنة أساس-مقابل-أساس)، السماح باختيار وحدة استلام مختلفة سارية، تمرير `uom_id/qty_entered/unit_cost_entered/ordered_qty_entered/purchase_order_line_id` إلى `rpc_post_goods_receipt`.
3. **`SalesInvoiceForm`** (G3): كالبند 1 بغرض sale.
4. **`DeliveryNoteForm`** (G5): إزالة حساب COGS المحلي وسقف `products.stock_quantity`؛ وراثة `uom_id` وsnapshot سطر الفاتورة؛ المتبقي = (quantity الأساس − المسلَّم الأساس) معروضًا بالوحدتين؛ عرض COGS الفعلي من نتيجة `rpc_post_delivery_note`.
5. **`BOMBuilder`** (G6): مُنتقي وحدة لكل مكوّن + معاينة `quantity_base`؛ منع المكوّنات غير المحسومة.
6. **`ManufacturingOrderForm`** (G8): كمية الإنتاج بوحدة تجارية → تحويل للأساس → `explode_bom`؛ عرض الاحتياجات بوحدة أساس كل مكوّن + المكافئ التجاري.
7. **الاستهلاك** (G7): ترقية `inventory-transaction-service` إلى v2 وبناء شاشة الخصم الجزئي: إدخال بأي وحدة سارية، وعرض فوري بعد النجاح لـ`material_cost_posted` والمتبقي من الحجز (إعادة جلب الحجز) — «القيمة تظهر لحظة الخصم» كما في الخطة.
8. **استلام الإنتاج التام:** عرض مزدوج (كرتون/KG) وتكلفة الوحدة التجارية والأساس من بيانات الأمر — بلا حساب تكلفة محلي.

## 7. المرحلة الخامسة — التقارير + النشر

- تقارير المخزون/المبيعات/تكلفة الإنتاج: عمودا كمية (أساس + تجاري بالعامل الساري للرصيد الحالي، وبالـ snapshot للمستندات التاريخية — لا يُعاد تسعير مستند قديم بعامل اليوم)، والوزن عبر `rpc_get_product_weight` أو ضرب `net_weight` محليًا للرصيد.
- **تسلسل الإطلاق الملزم:**
  1. تطبيق 128–142 على Production عبر runbook وبوابات `MANIFEST_128_142.md` (خارج نطاق هذا العمل الأمامي).
  2. تجديد الأنواع المولدة من سجل Production.
  3. تفعيل `uom_engine_enabled` لمؤسسة تجريبية، تنفيذ سيناريو C1 كاملًا (شراء طن PP → BOM → حجز → خصم جزئي → إنتاج 100 كرتون → فاتورة وتسليم جزئي) بحساب `authenticated` حقيقي على staging + Playwright artifact.
  4. التعميم.

## 8. Migrations مقترحة جديدة (لا يبدأ بها العمل الأمامي)

| رقم مقترح | الاسم | الغرض |
|---|---|---|
| 143 | `atomic_purchase_order_creation` | `rpc_create_purchase_order_uom(p_payload jsonb)` رأس+سطور+idempotency في transaction واحدة (§1.4) |
| 144 | `products_base_uom_change_guard` | رفض تغيير `base_uom_id` عند وجود SLE إلا عبر مسار ترحيل معتمد (§1.8) |
| لاحقًا | `atomic_sales_invoice_creation` | نظير 143 للمبيعات |

كلها additive، بحارس معروف، وتتبع تسلسل الترقيم والحوكمة القياسية.

## 9. خريطة الصلاحيات (مطابقة للموجود)

الأدوار كما في الخطة، مع الإسناد الفعلي: عمليات الإدارة (`rpc_set_product_uom_conversion`, `rpc_set_product_physical_weight`, `rpc_create_org_uom`) محروسة بـ`wardah_assert_org_admin`/عضوية نشطة داخل الـ RPC نفسها — الواجهة تخفي الأزرار حسب الدور لكنها لا تعتمد على الإخفاء أمنيًا. المشتريات/المبيعات يريان وحدات الغرض فقط عبر prop `purpose` في `UomQuantityInput`.
