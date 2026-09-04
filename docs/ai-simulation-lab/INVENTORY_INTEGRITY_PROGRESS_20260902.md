# AI Simulation Lab — Inventory Integrity Progress — updated 2026-09-04

**الغرض:** سجل الحالة الحالية لـRound 3 قبل Simulation Lab Phase 0.

**مصدر الحقيقة:** سجل Production حتى Migration 187
(`20260903202341 / 187_stock_adjustment_ledger_idempotency`)، زوج Baseline cutoff
187 المولّد في run `33734325356` attempt 2 والمنشور عبر PR #217 عند
`3917231b`، تدقيق المخزون read-only في 2026-08-30، وإعادة فحص INV-02 في
2026-09-03 و2026-09-04، ونتائج PRs #208–#217 وpostflight تطبيق 187.

**حد السلطة:** هذا المستند لا يفوض دمج PR، ولا تطبيق migration، ولا كتابة أو
إصلاح بيانات على Production.

---

## 1. الحكم التنفيذي

Round 3 **بدأت ولم تُغلق**. أُنجزت إغلاقات ومخرجات محددة، بينما بقيت عيوب سلامة
ومسارات عقدية تمنع إعلان جاهزية Phase 0:

| المسار | الحالة | الدليل |
|---|---|---|
| تدقيق سلامة المخزون | ✅ مكتمل كاكتشاف | فحص Production read-only في 2026-08-30؛ لا كتابة ولا إصلاح بيانات |
| إغلاق الكتابة المباشرة على SLE/bins | ✅ مدموج ومطبق | Migration 185 / PR #208؛ postflight وRed/Green؛ Baseline cutoff 185 في PR #209 |
| خطأ شاشة حركات المخزون | ✅ مدموج | PR #210؛ query contract + حالة خطأ صريحة + RTL Red/Green + smoke على Staging |
| جرد `stock_movements`/`stock_moves`/`avg_rate` | ✅ مدموج | PR #211 عند `a74c06f`؛ 11/11 checks والخيطان محلولان؛ merge commit `c4ffc44` |
| إصلاح عقود `stock_moves` الحية | ✅ مدموج ومطبق | PR #213 / Migration 186؛ merge `956011a`؛ Production ledger `20260903083010`؛ صفر مراجع `stock_moves` وبيانات المخزون ثابتة و`0A000` مثبتة |
| عقد `INV-02` المستقبلي | ✅ مدموج ومطبق | PR #216 / Migration 187؛ merge `e2b6a075`؛ Production ledger `20260903202341`؛ Baseline cutoff 187 في PR #217 |
| بقية عيوب S0/S1 | ⏳ مفتوحة | `INV-01`/`INV-03`/`INV-04` مفتوحة؛ وتكرار `ADJ-000001` التاريخي باقٍ بلا remediation متعمدًا |
| Simulation Lab Phase 0 | ⏳ مؤجلة | لا تبدأ لمجرد خضرة UI أو CI؛ تبدأ بعد إغلاق بوابة Round 3 أدناه |

لا يجوز اختزال النتيجة إلى «Round 3 مكتملة»: Migration 185 أغلقت **سطح كتابة**،
وPR #210 أغلقت **عرض فشل القراءة**، و186 أصلحت عقود `stock_moves` الحية، و187
أغلقت حد idempotency المستقبلي للتسويات. لكنها لم تصلح بيانات المخزون التاريخية
أو تسلسل الرصيد، ولذلك لا تزال Round 3 مفتوحة.

---

## 2. خط أساس المخطط عند cutoff 185

أُعيد اشتقاق الكتالوجات من:

- `sql/baseline/000_schema_baseline_20260830_083021.sql`
- `sql/baseline/001_system_reference_data_20260830_083021.sql`

الحقائق التي يجب أن تبقى متزامنة في وثائق المختبر:

| الحقيقة | cutoff 184 | cutoff 185 |
|---|---:|---:|
| إجمالي `rpc_*` | 70 | 70 |
| `rpc_*` القابلة لـ`authenticated` | 64 | 64 |
| كل دوال `public` القابلة لـ`authenticated` | 181 | 181 |
| الدوال غير `rpc_*` القابلة لـ`authenticated` | 117 | 117 |
| صفوف البيانات المرجعية النظامية | 263 | 263 |
| `anon` على `stock_ledger_entries`/`bins` | `ALL` | لا صلاحيات |
| `authenticated` على `stock_ledger_entries`/`bins` | `ALL` | `SELECT, MAINTAIN` فقط |
| `anon/PUBLIC` على `consume_materials_for_mo` و`update_warehouse_gl_mapping` | قابلتان للتنفيذ | مسحوب |

إذن لا يصح تغيير أرقام كتالوج الـRPC بسبب 185؛ التغير الحقيقي في **منح الجداول
وسطح anon**. ويبقى سطح `authenticated` التاريخي الواسع موضوع `INV-SEC-05` و
`OQ-08`.

---

## 3. سجل نتائج تدقيق المخزون

القيم أدناه لقطة اكتشاف، لا وصفًا متجددًا تلقائيًا للحالة الحية. لم تُجرَ أي
كتابة لإعادة فحصها أو إصلاحها.

| ID | الخطورة | الاكتشاف | الحالة في 2026-09-02 |
|---|---|---|---|
| `INV-01` | S0 | حركة PP810837 بكمية 400 وقيمة 10,000 بلا bin | مفتوح؛ لا backfill تخميني |
| `INV-02` | S0 | غياب idempotency race-safe للتسويات؛ صياغة القيد العالمي الأصلية غير قانونية لأن مستندات أخرى تسمح بأسطر متكررة لنفس المنتج/المخزن | ✅ الحد prospective مغلق في Migration 187؛ التكرار التاريخي مجهول المصدر باقٍ عمدًا خارج القيد ولا يُعدّ مُعالَجًا |
| `INV-03` | S1 | انقطاع `qty_after_transaction` في ADJ-000001 | مفتوح؛ يرتبط بعقد التسلسل/التزامن |
| `INV-04` | S1 | `products.stock_quantity/value` لا يتطابق دائمًا مع SLE/bins | مفتوح؛ يجب حسم كونه projection مشتقًا قبل فرضه |
| `INV-05` | S1 | منح كتابة مباشرة على `stock_ledger_entries` و`bins` | ✅ مغلق في Migration 185 |
| `INV-06` | S1 | تباعد `wardah_org_id()` و`auth_org_id()` في المحللات | مفتوح؛ DB-first |
| `INV-07` | S2 | حقول UoM في سجل المخزون `NULL` | مفتوح؛ لا backfill بلا مصدر قانوني |
| `INV-08` | S2 | تفرد `bins` لا يضم `org_id` | مفتوح؛ يحتاج تحليل تكرارات قبل أي قيد |
| `INV-09` | S2 | دالتان كاتبتان كانتا متاحتين لـ`anon` | ✅ شق anon مغلق في 185؛ بقاء `authenticated` يدخل جرد consumers/OQ-08 |
| `INV-10` | S3 | `created_by` فارغ و`voucher_number` UUID خام في صفوف تاريخية | مفتوح؛ جودة provenance لا إصلاح تخميني |
| `INV-11` | UI | قراءة الشاشة 400 عُرضت كرصيد حركات `(0)` | ✅ مغلق في PR #210 |

اللقطة التي أنتجت هذه النتائج كانت: 5 صفوف SLE مرحّلة، صفا bins، 118 منتجًا
stockable، و4 مخازن. وهي لا تُعاد صياغتها كـ«الحالة الحالية» دون قراءة جديدة
مؤرخة؛ قيمتها أنها دليل اكتشاف محفوظ.

### 3.1 تنقيح عقد INV-02 في 2026-09-03

إعادة الفحص read-only أثبتت أن صفوف SLE الخمسة كلها بلا `source_line_id`، وأن
مجموعة تكرار تاريخية واحدة تخص `ADJ-000001`. لكنه أثبت أيضًا من عقود writers أن
القيد العالمي المقترح أولًا سيمنع حركات قانونية: Goods Receipt وDelivery Note قد
يحملان سطرين مستقلين لنفس المنتج/المخزن، واستهلاك التصنيع قد يكون جزئيًا.

لذلك Migration 187 لا تعيد كتابة التاريخ ولا تفرض هذا المفتاح على كل voucher.
بعد دمجها عبر PR #216 وتطبيقها على Production كسجل `20260903202341`، تفرض
مستقبلًا فقط حركة Stock Adjustment واحدة لكل
`(org_id,voucher_id,product_id,warehouse_id)` عندما يكون `source_line_id` معلومًا،
وتلزم RPC التسوية بتمرير `stock_adjustment_items.id`. أثبت postflight أن الفهرس
valid/ready والـtrigger مفعّل، وأن صفوف SLE الخمسة والمعرفين التاريخيين لم
يتغيروا، وأن صفر تكرارات source-aware موجود. بهذا أُغلق **العقد المستقبلي** من
`INV-02`؛ أما مجموعة `ADJ-000001` التاريخية ذات `NULL source_line_id` فبقيت
دون remediation أو نسبة تخمينية، وهي قرار بيانات مستقل وليست نجاحًا ضمنيًا.

---

## 4. حاجز consumers الذي كشفه PR #211

الجرد القانوني الكامل موجود في
[`../architecture/INVENTORY_CONSUMER_INVENTORY_20260901.md`](../architecture/INVENTORY_CONSUMER_INVENTORY_20260901.md).
أثره على المختبر مباشر:

1. `stock_movements` و`stock_moves` غير موجودين في cutoff 185؛ لا يجوز بناء
   سيناريو جديد عليهما.
2. `bins.avg_rate` غير موجود؛ الحقل القانوني هو `bins.valuation_rate`.
3. `simulate_cogs.avg_rate` حقل ناتج RPC صالح ومستقل؛ لا يُستبدل آليًا.
4. `rpc_create_mo_with_reservation` يقرأ `stock_moves` مباشرة عند مواد غير فارغة؛
   لذلك خطوة 08:00 في `SC-DAY-01` ليست قابلة للتنفيذ بعقدها الحالي.
5. `consume_materials_for_mo` و`validate_stock_balance` غير محميتين من غياب
   relation، و`comprehensive_data_integrity_check` يرث فشل الثانية.
6. `rpc_complete_manufacturing_order` و`calculate_material_variances` تتحققان من
   `to_regclass` وتتجاوزان المرآة القديمة؛ هذا يمنع 42P01 لكنه لا يثبت اكتمال
   الأثر المخزوني.
7. `SupabaseInventoryRepository` القديم وملفات SQL/JavaScript التاريخية خاملة
   حاليًا، لكنها لا تصبح صحيحة لمجرد خمولها.

هذا هو سبب أولوية PR-1R قبل تشغيل سيناريو اليوم: المختبر ممنوع من الالتفاف على
العقد القانوني باستدعاء دالة تاريخية أو بالكتابة المباشرة.

---

## 5. بوابة إغلاق Round 3

لا تنتقل الحالة إلى ✅ ولا يبدأ Phase 0 إلا بعد توفر أدلة مستقلة على:

1. ✅ دُمج PR #211 بتفويض المالك عند `c4ffc44` دون drift عن الرأس المراجع.
2. ✅ دُمجت مزامنة وثائق المختبر في PR #212 عند `4e63a55` بتفويض مستقل.
3. ✅ دُمج PR #213 عند `956011a` بعد نجاح Red/Green/Fresh DB والسباق، وطُبقت
   Migration 186 على Production كسجل `20260903083010` مع postflight حي؛ زوج
   Baseline cutoff 186 نُشر عبر PR #214 المدموج عند `3ce8b295`.
4. ✅ `rpc_create_mo_with_reservation` يعمل بمواد غير فارغة عبر العقد القانوني
   بعد Migration 186؛ لا fallback تاريخي.
5. ✅ أُغلق الحد المستقبلي لـ`INV-02`: Migration 187 مرت Red/Green والسباق
   الحتمي، ودُمجت وطُبقت ووُثق postflight. لم يُفرض القيد العالمي المرفوض ولم
   تُعالج صفوف `NULL source_line_id` تخمينيًا؛ remediation التاريخي منفصل.
6. إغلاق `INV-01` و`INV-03` بعقد bin/continuity قابل للفرض، مع فصل إصلاح البيانات
   التاريخية عن تغيير المخطط.
7. حسم `INV-04` كـprojection قانوني أو مرجع غير ملزم، ثم تعديل الثابت وفق القرار.
8. تحديث الكتالوجات من أحدث Baseline بعد كل migration، وإعادة إثبات D-1.
9. عدم وجود S0/S1 مفتوح يؤثر على سيناريو اليوم؛ الاستثناء المقبول—إن وُجد—يحتاج
   قرارًا وأثرًا محفوظًا، لا تعليقًا شفهيًا.

---

## 6. ترتيب التنفيذ التالي

| الترتيب | العمل | نوعه | شرط البدء/الخروج |
|---:|---|---|---|
| 1 | جرد consumers في PR #211 | evidence/docs | ✅ مدموج عند `c4ffc44` |
| 2 | تثبيت مزامنة الوثائق في PR #212 على `main` | docs-only | ✅ مدموج عند `4e63a55`؛ لم يغيّر قاعدة البيانات |
| 3 | PR-1R / Migration 186 لعقود المخزون القديمة | DB-first | ✅ PR #213 مدموج، Production مطبق ومثبت postflight؛ Baseline cutoff 186 منشور عبر PR #214 عند `3ce8b295` |
| 4 | idempotency للمخزون (`INV-02`) | DB | ✅ Migration 187 مدموجة ومطبقة؛ الحد prospective مغلق وBaseline cutoff 187 منشور، والتكرار التاريخي محفوظ بلا remediation |
| 5 | bin/continuity (`INV-01`/`INV-03`) | DB/data split | عقد مستقبلي منفصل عن remediation التاريخي |
| 6 | projection والهوية (`INV-04`/`INV-06`) | DB/application حسب القرار | مصدر حقيقة واحد واختبار مستهلك |
| 7 | UoM/org/provenance (`INV-07`/`INV-08`/`INV-10`) | follow-ups محددة | بلا backfill استنتاجي |
| 8 | Phase 0 | مختبر معزول | فقط بعد بوابة Round 3؛ Issue #195 يبقى مسارًا مستقلًا |

كل صف DB أعلاه يحتاج تفويض Production منفصل **بعد** الدمج والـCI والـrunbook؛
وجوده في هذه الخارطة ليس تفويضًا بالتطبيق.
