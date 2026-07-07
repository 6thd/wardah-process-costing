# تحسينات قسم التصنيع (Manufacturing) — Fullstack

كل بند يغطي الطبقات الثلاث: قاعدة البيانات (Schema/RPC) ⇒ طبقة الخدمات (TypeScript) ⇒ الواجهة (React).

---

## 1. توحيد نموذج بيانات التكاليف — أخطر مشكلة في القسم 🔴 P0

### الوضع الحالي: نظامان لا يريان بعضهما

**النظام أ (SQL — `sql/wardah_implementation/`):**
- `labor_entries` + `overhead_allocations` + `stock_moves(move_type='material_issue')`
- `complete_manufacturing_order(p_mo_id)` في `10_mo_functions.sql` تجمع التكلفة من هذه الجداول ثم تستدعي `apply_stock_move` لاستلام الإنتاج التام بتكلفة الوحدة المحسوبة.

**النظام ب (TypeScript — `src/services/process-costing-service.ts`):**
- يكتب العمالة في `labor_time_logs` (سطر 113) والأوفرهيد في `moh_applied` (سطر 205) ويجمعها في `stage_costs`.

**النتيجة الفعلية:** إذا سجّل المستخدم عمالة وأوفرهيد من الواجهة ثم استُدعيت `complete_manufacturing_order`، فستقرأ من `labor_entries`/`overhead_allocations` **الفارغة** وتستلم الإنتاج التام بتكلفة مواد فقط ⇒ **تقييم مخزون FG ناقص** وWIP لا يُفرَّغ بالكامل.

يتفاقم الانقسام في أعمدة الربط نفسها: دالة `post_mo_stage_to_wip` (`sql/migrations/03_operational_gl_integration.sql:186-189`) تقرأ `stage_costs.mo_id` و`stage_costs.tenant_id`، بينما خدمة TS تكتب `manufacturing_order_id` و`org_id` (`process-costing-service.ts:317`). نفس الجدول، عمودان مختلفان في مصدرين مختلفين.

### التحسين المقترح

1. **قرار معماري مكتوب (ADR-004)**: النموذج القانوني هو `labor_time_logs` + `moh_applied` + `stage_costs` (لأنه الذي يملك EUP/FIFO/Scrap من Migrations 66-69 والواجهة تكتب فيه فعلاً).
2. **Migration توحيد**:
   - نقل أي بيانات من `labor_entries`/`overhead_allocations` إلى الجداول القانونية ثم إسقاطهما (أو إبقاؤهما Views للقراءة فقط خلال ربع سنة).
   - توحيد أعمدة `stage_costs`: عمود واحد `manufacturing_order_id` (مع View متوافق `mo_id` مؤقتاً)، وعمود واحد `org_id`.
   - قيد فريد واحد صريح: `UNIQUE (org_id, manufacturing_order_id, stage_id)` — حالياً `upsertStageCost` يبدّل `onConflict` بين تركيبتين حسب توفر `stageId` (`process-costing-service.ts:339-342`) وهذا يسمح بصف مكرر لنفس المرحلة (صف بـ stage_id وصف بـ stage_number).
3. **إعادة كتابة `complete_manufacturing_order`** لتقرأ من `stage_costs` (مجموع المراحل بعد EUP وScrap) بدل إعادة الجمع من الجداول الخام — التكلفة تُحسب مرة واحدة في مكان واحد.
4. **حسم `stage_id` vs `stage_number`**: الخدمة الحالية تحوّل بينهما بثلاث نسخ متطابقة من نفس الاستعلام (`process-costing-service.ts:77-87,168-179,273-284`). الحل: `stage_id UUID NOT NULL` هو المعرّف، و`stage_no` يبقى للعرض فقط، ودالة SQL واحدة `resolve_stage(p_mo_id, p_stage_ref)` بدل التكرار في TS.

### معيار القبول
- اختبار تكامل: تسجيل مواد + عمالة + أوفرهيد من الواجهة ثم إكمال MO ⇒ تكلفة FG المستلمة = مجموع الثلاثة بعد معالجة EUP/Scrap، وWIP يصل صفراً.

---

## 2. آلة حالات أوامر التصنيع (MO State Machine) في قاعدة البيانات 🟠 P1

### الوضع الحالي

- `updateManufacturingOrderStatus` (`src/services/manufacturing/updateStatus.ts`) يقبل أي انتقال من أي حالة إلى أي حالة — يمكن نقل أمر `completed` إلى `draft`، أو إكمال أمر لم يُستهلك له أي مواد.
- قائمة الحالات في TS (`draft/confirmed/pending/in-progress/completed/cancelled/on-hold/quality-check`) تحتاج `normalizeStatus` (في `helpers.ts`) للتحويل بين تمثيل الواجهة وتمثيل DB (`in_progress` vs `in-progress`) — دليل على غياب مصدر حقيقة.
- تغيير الحالة لا يشغّل أي منطق: الإكمال من الواجهة **لا يستدعي** `complete_manufacturing_order` ولا يحرّر الحجوزات ولا يرحّل قيوداً — مجرد UPDATE على عمود.

### التحسين المقترح

**طبقة DB:**

```sql
CREATE TYPE mo_status AS ENUM
  ('draft','confirmed','in_progress','quality_check','on_hold','completed','cancelled');

CREATE OR REPLACE FUNCTION validate_mo_transition() RETURNS trigger AS $$
DECLARE allowed jsonb := '{
  "draft":        ["confirmed","cancelled"],
  "confirmed":    ["in_progress","cancelled","on_hold"],
  "in_progress":  ["quality_check","on_hold","completed"],
  "quality_check":["in_progress","completed"],
  "on_hold":      ["in_progress","cancelled"],
  "completed":    [],
  "cancelled":    []
}';
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status
     AND NOT (allowed -> OLD.status::text) ? NEW.status::text THEN
    RAISE EXCEPTION 'Invalid MO transition: % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
```

**الانتقالات ذات الآثار الجانبية تصبح RPCs مسماة** بدل UPDATE عام:
- `rpc_confirm_mo(mo_id)` — يفجّر متطلبات BOM ويحجز المواد (`FOR UPDATE`) ويعيّن التواريخ.
- `rpc_start_mo(mo_id)` — يتحقق من الحجز ويعيّن `start_date` (المنطق الحالي في `updateStatus.ts:37-66` ينتقل هنا).
- `rpc_complete_mo(mo_id, qty_produced, qty_scrapped)` — يستدعي منطق الإكمال الموحّد (بند 1) + الترحيل المحاسبي (بند 5) + تحرير فائض الحجوزات، **كل ذلك في معاملة واحدة**.
- `rpc_cancel_mo(mo_id, reason)` — يحرّر كل الحجوزات ويعكس ما يلزم.

**طبقة الخدمة:** يُختزل `updateStatus.ts` وشبكة الـ fallbacks فيه (سطور 68-107) إلى استدعاءات RPC مباشرة مع أخطاء صريحة.

**طبقة الواجهة:** أزرار الحالة في `src/features/manufacturing/index.tsx` تُبنى من قائمة الانتقالات المسموحة (تأتي من الخادم أو ثابت مشترك مولَّد)، فيختفي احتمال عرض زر "إكمال" لأمر ملغي.

---

## 3. حجز واستهلاك المواد: ذرّي ومحصّن ضد التسابق 🟠 P1

### الوضع الحالي

- `reserveMaterials` (`inventory-transaction-service.ts:142-197`): فحص التوفر ثم INSERT في حلقة — طلبان متزامنان يمرّان معاً من الفحص ويحجزان أكثر من المتاح (TOCTOU).
- `checkAvailability` (سطور 75-137): ثلاثة استعلامات لكل مادة (RPC + reservations + quants) — أمر بعشرين مادة = 60 طلب شبكة.
- `consumeReservedMaterials` (سطور 202-261): يتجاهل الاستهلاك الجزئي — يضع `status='consumed'` حتى لو استهلك أقل من المحجوز، ويُنشئ `stock_moves` بـ `unit_cost` **يمرَّر من العميل** بدل تكلفة AVCO من `apply_stock_move`.
- فشل الحجز بعد إنشاء الأمر يُبتلع (`createOrder.ts:77-82`) ⇒ أوامر مؤكدة بلا حجوزات.

### التحسين المقترح

**RPC واحد للحجز** يجمع الفحص والحجز تحت قفل:

```sql
CREATE OR REPLACE FUNCTION rpc_reserve_materials(p_mo_id uuid, p_lines jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_org uuid := auth_org_id(); v_line record; v_available numeric;
BEGIN
  FOR v_line IN SELECT * FROM jsonb_to_recordset(p_lines)
                AS x(item_id uuid, quantity numeric, location_id uuid)
  LOOP
    -- قفل صف المخزون أولاً ثم الفحص: يمنع TOCTOU
    SELECT sq.onhand_qty - COALESCE(res.reserved, 0) INTO v_available
    FROM stock_quants sq
    LEFT JOIN LATERAL (
      SELECT SUM(quantity_reserved - quantity_consumed - quantity_released) reserved
      FROM material_reservations
      WHERE org_id = v_org AND item_id = v_line.item_id AND status = 'reserved'
    ) res ON true
    WHERE sq.org_id = v_org AND sq.item_id = v_line.item_id
    FOR UPDATE OF sq;

    IF COALESCE(v_available, 0) < v_line.quantity THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK item=% required=% available=%',
        v_line.item_id, v_line.quantity, COALESCE(v_available, 0);
    END IF;

    INSERT INTO material_reservations (org_id, mo_id, item_id, quantity_reserved, status)
    VALUES (v_org, p_mo_id, v_line.item_id, v_line.quantity, 'reserved');
  END LOOP;
  RETURN jsonb_build_object('success', true);
END $$;
```

**RPC واحد للاستهلاك** `rpc_consume_materials(p_mo_id, p_lines)`:
- يدعم **الاستهلاك الجزئي**: `quantity_consumed += x` والحالة تبقى `reserved` حتى النفاد.
- يستدعي `apply_stock_move` داخلياً فتأتي التكلفة من **AVCO الفعلي** لا من العميل — يُحذف معامل `unit_cost` من واجهة TS.
- يقيد تكلفة المواد على المرحلة الأولى في `stage_costs` مباشرة (تغذية `directMaterialCost` تلقائياً بدل إدخالها يدوياً في `stage-costing-panel.tsx`).

**تحسين الفحص للعرض فقط**: View واحدة `v_item_availability` (onhand − reserved) تُستعلم بطلب واحد لكل الأصناف، وتُستخدم في شاشة إنشاء الأمر كإرشاد — التحقق الملزم يحدث داخل RPC الحجز.

---

## 4. ربط BOM والتوجيه (Routing) بدورة حياة الأمر 🟡 P2

### الوضع الحالي

يوجد نظام BOM غني (`src/services/manufacturing/bomService.ts`, `bomCostingService.ts`, `bomRoutingService.ts`, بدائل BOM، شجرة BOM) ونظام مراحل (`manufacturing_stages`)، لكن إنشاء أمر التصنيع (`createOrder.ts`) يستقبل قائمة مواد **يدوية** من الواجهة ولا يمس BOM، ولا تُنسخ عمليات الـ Routing إلى مراحل الأمر.

### التحسين المقترح

1. **تفجير BOM عند التأكيد** داخل `rpc_confirm_mo`:
   - جدول جديد `mo_bom_lines (mo_id, item_id, qty_per_unit, qty_required, qty_reserved, qty_consumed, source_bom_line_id)` — snapshot ثابت للمتطلبات لحظة التأكيد (تعديل BOM لاحقاً لا يغيّر الأوامر الجارية).
   - اختيار BOM البديل حسب أولوية/تاريخ سريان (البنية موجودة في `bomAlternativeService.ts`).
2. **نسخ الـ Routing إلى مراحل الأمر**: `mo_operations (mo_id, stage_id, work_center_id, std_hours, std_rate)` — يصبح مصدر **التكلفة المعيارية** التي تقارن بها انحرافات `variance-monitoring-service.ts` بدل الاعتماد على `standard_costs` منفصلة عن الأمر.
3. **شاشة "متطلبات الأمر"** في الواجهة: جدول qty_required/reserved/consumed لكل مادة مع مؤشر نقص لوني، وزر "استهلاك حسب الخطة" يستدعي `rpc_consume_materials` بالكميات المتبقية.
4. **Backflush اختياري (P3)**: علم على BOM `consumption_mode = 'manual' | 'backflush'`؛ في وضع Backflush يستهلك `rpc_complete_mo` المواد تلقائياً بنسبة `qty_produced × qty_per_unit` — يناسب المصانع ذات الخطوط السريعة ويلغي إدخالاً يدوياً كاملاً.

---

## 5. توصيل التصنيع بالمحاسبة: قيود WIP تلقائية 🔴 P0 (مشترك مع قسم المحاسبة)

### الوضع الحالي

- الدوال جاهزة في SQL منذ زمن: `post_mo_stage_to_wip` (مواد/عمالة/أوفرهيد ⇒ مدين WIP) و`finish_mo_to_stock` (مدين FG / دائن WIP) في `sql/migrations/03_operational_gl_integration.sql` — **صفر استدعاء لها من `src/`** (تحقق: `grep -rln "post_mo_stage_to_wip" src` فارغ).
- الواجهة تحاول الترحيل عبر `rpc_post_event_journal` (`posting-service.ts:67`) **غير الموجودة في أي SQL بالمستودع**.
- النتيجة: حساب WIP في الأستاذ العام لا يعكس الإنتاج الجاري إطلاقاً، وتقرير `WIPValuationReport` يقرأ من جداول التشغيل لا من GL — لا يمكن تسوية المخزون مع الأستاذ.

### التحسين المقترح

التفاصيل المحاسبية (gl_mappings، Idempotency، إقفال الفترات) في `03_ACCOUNTING_IMPROVEMENTS.md` بند 2. من منظور التصنيع:

1. **الترحيل يحدث داخل نفس معاملة الحدث التشغيلي** — لا زر "ترحيل" منفصل يمكن نسيانه:
   - `rpc_consume_materials` ⇒ قيد: مدين WIP-Materials / دائن Raw Materials (بتكلفة AVCO الفعلية من `stock_moves`).
   - `rpc_apply_labor` ⇒ مدين WIP-Labor / دائن Wages Payable (أو حساب مقاصة عمالة).
   - `rpc_apply_overhead` ⇒ مدين WIP-OH / دائن Manufacturing OH Applied.
   - `rpc_complete_mo` ⇒ مدين FG / دائن WIP بمكوناته + قيد Abnormal Scrap إلى مصروف الفترة (القيمة محسوبة أصلاً في `stage_costs.abnormal_scrap_cost` منذ Migration 68 لكنها لا تُرحَّل).
2. **ربط ثنائي الاتجاه**: عمود `gl_entry_id` على `stock_moves` و`labor_time_logs` و`moh_applied` (الدالة `rpc_link_inventory_move_to_journal` موجودة في `posting-service.ts:105` — تُفعَّل من داخل RPCs لا من المتصفح).
3. **إغلاق الحلقة مع الانحرافات**: عند إقفال الفترة، رصيد OH Applied مقابل OH Actual يُرحَّل انحرافه (الدالة `calculate_manufacturing_variances` موجودة في `04_period_closing.sql:112` — تُوصل بواجهة `variance-alerts.tsx`).

---

## 6. تحسينات واجهة قسم التصنيع 🟡 P2

### الوضع الحالي

- `src/features/manufacturing/index.tsx` = **966 سطراً** لصفحة واحدة (قائمة + فلاتر + نماذج + إحصاءات).
- `useManufacturingOrders` بلا كاش (انظر الملف المشترك بند 5)؛ كل عودة للصفحة = إعادة تحميل كاملة.
- `stage-costing-panel.tsx` (616 سطراً) يخلط جلب البيانات وRealtime والحسابات والعرض، ويطلب من المستخدم إدخال `directMaterialCost` وساعات وأجور يدوياً بينما يجب أن تتغذى من الاستهلاك الفعلي وسجلات العمل.
- لا يوجد تدفق مرئي للمراحل (Stage 1 ⇒ 2 ⇒ 3 مع Transferred-In) رغم أن هذا جوهر Process Costing.

### التحسين المقترح

1. **تفكيك الصفحة**: `MOListPage` / `MODetailPage` / `MOFormDialog` مع React Query (مفاتيح `qk.mo.*` من الملف المشترك).
2. **صفحة تفاصيل أمر** بتبويبات: نظرة عامة | المواد (متطلبات/حجز/استهلاك) | المراحل والتكاليف | القيود المحاسبية المرتبطة (من `gl_entry_id`) | سجل الحالة.
3. **مخطط تدفق تكاليف المراحل**: شريط أفقي لكل مرحلة يعرض Transferred-In / DM / DL / OH / Scrap و`unit_cost` التراكمي — البيانات كلها متاحة في `stage_costs` بعد Migrations 66-69، ينقصها العرض (هذا هو Phase 4 المعلّق في `PROCESS_COSTING_LIMITATIONS.md:292`).
4. **إدخال EUP مفهوم**: حقول `wip_end_qty` ونسب الإكمال موجودة في الدالة لكن نموذج الواجهة لا يشرحها — Slider لنسبة الإكمال مع معاينة حية لـ EUP والتكلفة/وحدة قبل الحفظ (الحساب متاح Client-side من `src/domain/use-cases/CalculateProcessCost.ts` للمعاينة، والقيمة النهائية من الخادم).
5. **قفل الحقول حسب الحالة**: نموذج الأمر يمنع تعديل الكمية/المنتج بعد التأكيد (يتوافق مع آلة الحالات، بند 2).

---

## 7. تكلفة العمالة: من الإدخال اليدوي إلى سجلات فعلية 🟢 P3

### الوضع الحالي

`applyLaborTime` يستقبل `employeeName` نصاً حراً و`hourlyRate` يدوياً من الواجهة (`process-costing-service.ts:65,121` — الافتراضي "غير محدد"). لا ربط بوحدة HR الموجودة في المشروع (`src/services/hr/`, `sql/migrations/15_hr_module.sql`).

### التحسين المقترح

1. `labor_time_logs.employee_id UUID REFERENCES employees(id)` بدل النص الحر، و`hourly_rate` يُشتق من مركز العمل (`work_centers.default_hourly_rate`) أو من عقد الموظف — قابل للتجاوز مع صلاحية.
2. شاشة **تسجيل وقت بنمط MES** (البنية موجودة في `src/features/manufacturing/mes/WorkCenterDashboard.tsx`): بدء/إيقاف مؤقت على مستوى العملية بدل إدخال الساعات لاحقاً، مع ترحيل تلقائي للتكلفة عند الإيقاف.
3. تقرير مطابقة شهري: ساعات `labor_time_logs` مقابل حضور HR — يكشف التسريب بين النظامين.

---

## ترتيب التنفيذ داخل القسم

| الترتيب | البند | يعتمد على |
|---|---|---|
| 1 | توحيد نموذج التكاليف (بند 1) | قرار ADR فقط |
| 2 | RPC الحجز/الاستهلاك الذرّي (بند 3) | الأساسات المشتركة بند 3 |
| 3 | آلة الحالات + RPCs الانتقالات (بند 2) | بند 1 و3 |
| 4 | الترحيل المحاسبي التلقائي (بند 5) | بند 2 + قسم المحاسبة بند 2 |
| 5 | BOM ⇒ متطلبات الأمر (بند 4) | بند 2 |
| 6 | الواجهة (بند 6) | يمكن التوازي بعد 2 |
| 7 | العمالة/MES (بند 7) | مستقل |
