# دليل الـ Migrations القانوني — Wardah ERP

> **القاعدة**: عند بناء بيئة جديدة طبّق الملفات بالترتيب الرقمي.
> عند وجود نسخ متعددة لنفس الرقم، هذا الدليل يحدد **القانونية** منها.
> النسخ المتجاوزة تبقى في المستودع للتاريخ — لا تُحذف ولا تُطبَّق.

## الجوهر المطبَّق على قاعدة البيانات الحية ✅

| Migration | الغرض | الحالة |
|---|---|---|
| 66-69 | WIP fields + EUP متوسط مرجّح + Scrap + FIFO | ✅ مطبَّقة |
| 76 | القيد الذرّي `rpc_create_journal_entry` + بوابة الأحداث + `wardah_org_id` | ✅ مطبَّقة |
| 77 | زرع خرائط الأحداث المحاسبية | ✅ مطبَّقة |
| 78 | آلة حالات MO + الحجز الذرّي | ✅ مطبَّقة |
| 79 | فرض إقفال الفترات + إدارتها | ✅ مطبَّقة |
| 80 | تقرير تكلفة الإنتاج (EUP) | ✅ مطبَّقة |
| 81 | تسوية الدفاتر الفرعية مع GL | ✅ مطبَّقة |
| 82 | أمني: إزالة execute_sql | ✅ مطبَّقة (10 يوليو 2026) — كانت غائبة أصلاً |
| 83 | أمني: عزل المؤسسات RLS (rollback في `sql/rollback/`) | ✅ مطبَّقة — أُتمّت بـ 86 |
| 84 | قيد GL للاستلام (GRNI 210150) | ✅ مطبَّقة — GR_RECEIPT: مدين 131100/دائن 210150 |
| 85 | إذن التسليم الذرّي `rpc_post_delivery_note` + COGS | ✅ منشورة — ⚠️ راجع «تعارض بنيوي» أدناه |
| **86** | **أمني: إغلاق ثغرات anon على الدفتر المالي (متمّم لـ 83)** | ✅ مطبَّقة — الملف يعيد إنتاجها |
| **87** | **مواءمة دالة التسليم الذرّي مع المخطط الحيّ (products/org_id)** | ✅ مطبَّقة + مُختبرة حيّاً |
| **88** | **تحصين التسليم: عضوية+عزل org+ملكية+منع تسليم زائد+idempotency+COGS fail-closed** | ✅ مطبَّقة + 9 اختبارات rollback |
| **89** | **استلام بضاعة ذرّي (رأس+سطور+GRNI) fail-closed + idempotency** | ✅ مطبَّقة + 5 اختبارات rollback |
| **90** | **تشديد الاستلام: مورد/سطر PO/مخزن/تجاوز/سالب + PO ذرّي + سباق idempotency** | ✅ مطبَّقة + 9 اختبارات rollback |
| **91** | **التسليم: إصلاح سباق idempotency + بوابة admin للتسليم الزائد** | ✅ مطبَّقة + مُختبرة حيّاً |
| **92** | **إصلاح تعارض مخطط آلة حالات التصنيع (mo_number→order_number إلخ) + عضوية** | ✅ مطبَّقة + مُختبرة حيّاً |
| **93** | **إتمام أمر تصنيع ذرّي: مخزون تام (متوسط مرجّح) + سلسلة قيود Raw→WIP→FG (Fail-closed) + idempotent** | ✅ مطبَّقة + مُختبرة حيّاً بالكامل (PART 1: مخزون تام+done+replay؛ PART 2: total_cost + قيدا MATERIAL_ISSUE/FG_RECEIPT + **WIP 134100 يصفو=0**) |
| **94** | **إغلاق ذرّية المخزون: SLE + bins + تقييم (FIFO/LIFO/متوسط) داخل rpc_post_goods_receipt** | ✅ مطبَّقة + مُختبرة حيّاً (WA/FIFO/LIFO مطابِقة للمحرّك + GRNI متزن + idempotent + إصلاح علة bin فارغ) |
| **95** | **إغلاق مراجعة Codex: replay يعيد inventory_atomic (منع تكرار مخزون) + سحب صلاحية الدالة المساعدة (أمني) + تشديد المورد/المخزن/PO + إتمام تكلفة صفرية Fail-closed** | ✅ مطبَّقة + مُختبرة حيّاً (replay=SLE واحد، الدالة المساعدة غير متاحة لـ authenticated، رفض مورد/PO/مخزن، ZERO_COST_COMPLETION) |
| **96** | **بوابة admin لـ allow_zero_cost + بصمة الحمولة (request_hash) على idempotency الاستلام** | ✅ مطبَّقة + مُختبرة حيّاً (نفس المفتاح بحمولة مختلفة=IDEMPOTENCY_KEY_REUSED، allow_zero_cost لغير المدير يُخفَّض) |
| **97** | **توحيد المخزون: products مجمّع مرجعي مشتق من bins (الخيار B) — مزامنة products.stock_quantity/cost_price داخل wardah_apply_stock_incoming + تسوية idempotent للـ bins السابقة** | ✅ مطبَّقة + مُختبرة حيّاً (تسوية: products=001(18,200 تام)+RM-042(3,250 خام)=**21,450**؛ استلام 100@8 فوق 500@6.5 ⇒ bins=products=600@6.75، اشتقاق idempotent بلا مضاعفة) |
| **98** | **جدول org_settings (key/value JSONB لكل مؤسسة) + RLS قياسي + trigger updated_at — خلفية شاشة إعدادات النظام والنسخ الاحتياطي (P11-6)** | ✅ مطبَّقة + مُختبرة حيّاً (upsert مرتين على نفس المفتاح ⇒ صف واحد بالقيمة الأحدث، rollback) |

> **COGS_DELIVERY** زُرعت يدوياً بالحسابين الفعليين: مدين **544000** (COGS أكياس
> مطبوعة) / دائن **135100** (FG أكياس مطبوعة) — الافتراضي `511100` في ملف 85 غير
> موجود في شجرة الحسابات الحية. التحقق العملي: قراءة `gl_entries`/`products`
> بمفتاح anon بعد 83+86 ⇒ **0 صف** (كانت تكشف كل البيانات).

## حسم النسخ المتعددة (القانونية بالخط العريض)

| الرقم | النسخ | القانونية |
|---|---|---|
| 12 | `12_create_default_journals` / `12_simple_journals` / 12a-12f | **12_create_default_journals** ثم **12f** للسياسات (لاحقاً استُبدلت 12f بـ **83**) — البقية سكربتات تشخيص لمرة واحدة |
| 14 | `14_backup_checklist` / `_auto_detect` / `_fixed` | **14_backup_checklist_fixed** |
| 15 | `15_process_costing_enhancement` / `_no_migration` | **15_process_costing_enhancement** — `_no_migration` بديل يدوي قديم |
| 65 | `65_fix_stage_costs_complete` / `_v2` | **65_fix_stage_costs_complete_v2** |
| warehouse | `warehouse_accounting_integration` / `_fixed` / `_manual` | **warehouse_accounting_fixed** |
| warehouse mgmt | `warehouse_management_system` / `_fixed` | **warehouse_management_system_fixed** |
| غير مرقّمة | `phase2_stock_ledger_system`, `phase3_valuation_methods`, `migration_add_warehouse_to_goods_receipts`, `fix_view_org_id_error` | تُطبَّق بعد 30 وقبل 50 (نظام المستودعات) — مطبَّقة تاريخياً |

## ملاحظات معمارية مهمة

1. **ثلاثة مخططات GL تاريخية**: `gl_entries/gl_entry_lines` (القانوني — يكتب عبر
   `rpc_create_journal_entry` فقط منذ P4-B2)، و`journal_entries/journal_entry_lines`
   (يستخدمه stock-adjustment-service فقط — موثَّق، توحيده مؤجل).
2. **rollback scripts**: تحت `sql/rollback/` — حالياً `83_rollback_org_scoped_rls.sql`.
3. **أرقام جديدة**: التالي هو **99**. أي migration جديدة = ملف جديد مرقّم + سطر هنا.
4. **✅ حُسم تعارض مسار التسليم (Migration 87) ثم تحصينه (88)**: القانوني هو
   **`products`** (كل مفاتيح product_id الأجنبية تشير إليه؛ `items` جدول ميت فارغ)
   و**`org_id`** (112 جدولاً مقابل tenant_id على 13 محاسبياً). 87 واءم الدالة
   والخدمة بالكامل؛ **88 حصّنها** (تحقق عضوية + عزل org لكل استعلام + ملكية
   الفاتورة/السطر/المنتج + منع تسليم زائد + idempotency + COGS **fail-closed**).
   **89** يوفّر استلاماً ذرّياً مماثلاً (رأس+سطور+GRNI fail-closed). كلاهما مُختبَر
   بـ rollback حيّ. **✅ أُغلقت ذرّية المخزون (Migration 94)**: نُقل دفتر المخزون
   (SLE + bins + طابور FIFO/LIFO + التقييم) من خطوات الواجهة المنفصلة إلى **داخل**
   `rpc_post_goods_receipt` عبر `wardah_apply_stock_incoming` (قفل صف bin FOR UPDATE
   ⇒ لا سباق قراءة/كتابة)، فصار مستند+PO+GRNI+SLE+bin **معاملة ذرّية واحدة Fail-closed**.
   الواجهة تتخطّى خطوة الـ SLE في المسار الأساسي وتُبقيها للـ fallback فقط. **✅ 94
   مطبَّقة ومُختبرة حيّاً**: WA/FIFO/LIFO تطابق محرّك `services/valuation` (رصيد/سعر/طابور)،
   وGRNI يظل متزناً، وidempotency لا يُكرّر SLE؛ والاختبار الحيّ كشف وأصلح علة: عند غياب
   صف bin يضبط `SELECT INTO` كل المتغيّرات NULL ⇒ عولجت بـ COALESCE بعد الجلب.
5. **✅ حُسم تعارض آلة حالات التصنيع (Migration 92) ثم إتمام ذرّي (93)**: 92 صحّح
   أعمدة التواريخ الميتة (`mo_number/date_started/date_finished` ⇒
   `order_number/start_date/completed_date`) في `rpc_transition_mo_status` و
   `trg_mo_status_machine` (كانت آلة الحالات معطوبة كلياً كتعارض التسليم في 87)، وأضاف
   تحقق عضوية. **93** يجعل الإتمام **ذرّياً ومالياً**: تكلفة WIP الفعلية المتراكمة من
   `material_consumption` ⇒ زيادة مخزون المنتج التام (متوسط مرجّح) + سلسلة قيود
   `MATERIAL_ISSUE` (مدين WIP 134100/دائن مواد) و`FG_RECEIPT` (مدين تام 135100/دائن
   WIP 134100) **Fail-closed** + حالة `done` + **idempotent** (لا إتمام مزدوج). الواجهة:
   `updateManufacturingOrderStatus` توجّه الإتمام (`completed`/`done`) لـ
   `rpc_complete_manufacturing_order` (RPC أولاً، fallback خارج الإنتاج، **Fail-closed
   في الإنتاج**). الأجور/الأوفرهيد/الفروق وWIP متعدد المراحل: بناء لاحق (أحداث WIP إضافية).
6. **مؤجَّل (دفعة مواءمة تالية)**: خدمات أخرى ما زالت تشير إلى `items` القديم للقراءة
   فقط (financial-dashboard, sales-reports, gemini-financial, بعض manufacturing/*).
   لوحات/تقارير غير حرجة — تُواءم على حدة مع تشغيل التطبيق.
7. **✅ حُسم انفصال نظامَي المخزون (Migration 97)**: كان إكمال التصنيع (93) يكتب
   المنتج التام إلى `products.stock_quantity`، والاستلام (94) يكتب إلى `bins` فقط ⇒
   قيمتان منفصلتان لا تراهما التقارير معاً (products=18,200 تام، bins=3,250 خام).
   **القرار (الخيار B)**: `products` هو **المجمّع المرجعي** للمخزون الذي تقرؤه
   التقارير/اللوحة/تقييم المخزون؛ و`bins` يبقى دفتر التقييم/الطابور المفصّل (FIFO/
   LIFO/متوسط) دون تغيير لدوره. لكل منتج **له صف bin** تُشتقّ
   `products.stock_quantity`/`cost_price` من مجموع `bins` عبر المخازن **داخل**
   `wardah_apply_stock_incoming` (اشتقاق idempotent، لا مضاعفة) + تسوية لمرة واحدة
   للـ bins السابقة. المنتجات التامة (بلا bin) تبقى بقيمة إكمال التصنيع. **افتراض
   موثَّق**: منتج «هجين» يُصنَّع ويُستلَم معاً نادر؛ عندئذ يسود اشتقاق bins — التوحيد
   الكامل (كتابة bin للتام عند الإتمام) بناء لاحق. مطبَّقة ومُختبرة حيّاً (المجموع
   الموحَّد 21,450؛ استلام إضافي ⇒ bins=products متطابقان).
