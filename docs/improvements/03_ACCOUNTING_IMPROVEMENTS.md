# تحسينات قسم المحاسبة (Accounting / GL) — Fullstack

كل بند يغطي: قاعدة البيانات (Schema/RPC/Triggers) ⇒ طبقة الخدمات ⇒ الواجهة.

---

## 1. القيد اليومي الذرّي وفرض التوازن في قاعدة البيانات 🔴 P0

### الوضع الحالي

- `JournalService.createEntry` (`src/services/accounting/journal-service.ts:118-216`) ينفّذ من المتصفح: توليد رقم القيد (RPC) ⇒ INSERT رأس في `gl_entries` ⇒ INSERT سطور في `gl_entry_lines`. **ثلاث عمليات غير ذرّية**: فشل السطور يترك رأساً بمجاميع غير صفرية وبلا سطور؛ وانقطاع الشبكة بعد توليد الرقم يحرق تسلسلاً.
- فحص التوازن **في المتصفح فقط** (سطر 132، بسماحية 0.01): أي INSERT مباشر آخر (سكربت، استيراد، خدمة أخرى) يمكنه إدخال قيد غير متوازن — لا يوجد قيد على مستوى DB.
- `total_debit/total_credit` في الرأس تُحسب في العميل وتُخزَّن كما هي — يمكن أن تخالف مجموع السطور الفعلي.
- ازدواجية جداول: الخدمة تكتب في `gl_entries` وتسقط عند الفشل إلى قراءة `journal_entries` (`journal-service.ts:613-634`)، بينما دوال SQL مثل `post_mo_stage_to_wip` تفحص وتكتب في `journal_entries`. **عائلتا جداول GL متوازيتان.**

### التحسين المقترح

**أ. RPC واحد ذرّي:**

```sql
CREATE OR REPLACE FUNCTION rpc_create_journal_entry(p_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_org uuid := auth_org_id();
  v_entry_id uuid; v_debit numeric; v_credit numeric;
BEGIN
  SELECT COALESCE(SUM((l->>'debit')::numeric),0),
         COALESCE(SUM((l->>'credit')::numeric),0)
  INTO v_debit, v_credit
  FROM jsonb_array_elements(p_payload->'lines') l;

  IF round(v_debit, 2) <> round(v_credit, 2) THEN
    RAISE EXCEPTION 'UNBALANCED_ENTRY debit=% credit=%', v_debit, v_credit;
  END IF;
  IF v_debit = 0 THEN RAISE EXCEPTION 'EMPTY_ENTRY'; END IF;

  PERFORM assert_period_open(v_org, (p_payload->>'entry_date')::date); -- بند 3

  INSERT INTO gl_entries (org_id, journal_id, entry_number, entry_date, description,
                          status, total_debit, total_credit)
  VALUES (v_org, (p_payload->>'journal_id')::uuid,
          generate_entry_number((p_payload->>'journal_id')::uuid),
          (p_payload->>'entry_date')::date, p_payload->>'description',
          'draft', v_debit, v_credit)
  RETURNING id INTO v_entry_id;

  INSERT INTO gl_entry_lines (org_id, entry_id, line_number, account_id, debit, credit,
                              cost_center_id, description)
  SELECT v_org, v_entry_id, (l->>'line_number')::int, (l->>'account_id')::uuid,
         COALESCE((l->>'debit')::numeric,0), COALESCE((l->>'credit')::numeric,0),
         NULLIF(l->>'cost_center_id','')::uuid, l->>'description'
  FROM jsonb_array_elements(p_payload->'lines') l;

  RETURN v_entry_id;
END $$;
```

**ب. دفاع في العمق على مستوى الجداول** (يصطاد أي مسار كتابة آخر):

```sql
-- كل سطر إما مدين أو دائن، غير سالب
ALTER TABLE gl_entry_lines ADD CONSTRAINT chk_line_amounts
  CHECK (debit >= 0 AND credit >= 0 AND NOT (debit > 0 AND credit > 0));

-- Constraint Trigger مؤجل يتحقق من توازن القيد كاملاً عند COMMIT
CREATE CONSTRAINT TRIGGER trg_entry_balanced
AFTER INSERT OR UPDATE OR DELETE ON gl_entry_lines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION assert_entry_balanced();
```

**ج. حسم الازدواجية**: قرار (ADR-005) بأن `gl_entries/gl_entry_lines` هما العائلة القانونية؛ ترحيل بيانات `journal_entries` القديمة إليهما وتحويلها إلى View للتوافق، وتحديث الدوال التي تكتب فيها (`post_mo_stage_to_wip` وأخواتها) أثناء توصيلها (بند 2).

**د. الواجهة**: نموذج القيد (`src/features/accounting/journal-entries/`) يستدعي RPC واحدة؛ رسائل الأخطاء المرمّزة (`UNBALANCED_ENTRY`, `PERIOD_CLOSED`) تُترجم في i18n بدل تمرير نص الخطأ الخام.

---

## 2. إحياء الترحيل التشغيلي عبر gl_mappings — قلب التكامل 🔴 P0

### الوضع الحالي

- `PostingService` (`src/services/accounting/posting-service.ts:65-100`) يستدعي `rpc_post_event_journal` و`rpc_post_work_center_oh` — **غير معرّفتين في أي ملف SQL في المستودع** (`grep -rln rpc_post_event_journal sql/ supabase/` فارغ). كل استدعاء ترحيل من الواجهة يفشل حتماً.
- بيانات `gl_mappings` (خريطة حدث ⇒ حسابات) موجودة في `sql/wardah_implementation/gl_mappings_data.json` و`18_import_gl_mappings_data.sql` لكن لا توجد دالة حية تستهلكها.
- الدوال التشغيلية الجاهزة (`post_purchase_receipt_to_gl`, `post_sales_delivery_to_gl`, `post_mo_stage_to_wip`, `finish_mo_to_stock`) **حسابات مكتوبة Hardcoded داخلها** ولا يستدعيها أحد.

### التحسين المقترح

**أ. جدول خرائط أحداث فعّال:**

```sql
CREATE TABLE gl_event_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  event_code text NOT NULL,          -- 'MATERIAL_ISSUE','LABOR_APPLIED','OH_APPLIED',
                                     -- 'FG_RECEIPT','ABNORMAL_SCRAP','PURCHASE_RECEIPT',
                                     -- 'COGS_DELIVERY','INVENTORY_ADJUSTMENT',...
  debit_account_code text NOT NULL,
  credit_account_code text NOT NULL,
  cost_center_source text,           -- 'work_center'|'fixed'|null
  is_active boolean DEFAULT true,
  UNIQUE (org_id, event_code)
);
```

**ب. دالة ترحيل واحدة معمّمة** `post_event(p_event_code, p_amount, p_ref_type, p_ref_id, p_memo, p_idempotency_key)`:
- تقرأ الحسابات من `gl_event_mappings` (خطأ صريح `MAPPING_MISSING` إن غابت — لا حسابات افتراضية صامتة).
- **Idempotency حقيقي**: `UNIQUE (org_id, idempotency_key)` على `gl_entries` + `ON CONFLICT DO NOTHING` مع إرجاع القيد الموجود — إعادة المحاولة من الشبكة لا تكرر القيد. (المعامل موجود اسمياً في `posting-service.ts:74` لكن لا شيء يفرضه.)
- تُستدعى **من داخل RPCs التشغيلية فقط** (استهلاك مواد، إكمال MO، استلام مشتريات، تسليم مبيعات) — الترحيل جزء من معاملة الحدث نفسها، فلا يوجد وضع "تشغيلي بلا محاسبة".

**ج. حالة الترحيل مرئية**: الدالة `get_gl_posting_status` موجودة (`03_operational_gl_integration.sql:628`) — تُوصل بشارة (Badge) في شاشات المشتريات/المبيعات/التصنيع: "مرحَّل ✓ / غير مرحَّل ⚠" مع رابط للقيد.

**د. شاشة إدارة الخرائط** في الإعدادات: جدول `event_code` ⇒ حسابين مع Validation أن الحسابات موجودة ومن النوع الصحيح (Postable وليس Header) — تعتمد على شجرة الحسابات ثنائية اللغة الموجودة.

**هـ. حذف `PostingService` الحالي** أو إعادة توجيهه إلى `post_event` بعد إنشائها — إبقاء API ميت أخطر من حذفه.

---

## 3. الفترات المحاسبية: من دوال معزولة إلى فرض فعلي 🟠 P1

### الوضع الحالي

- توجد دوال إقفال (`close_accounting_period`, `create_period_closing_entries` في `sql/migrations/04_period_closing.sql`) وجداول فترات (`15_gl_mappings_and_periods.sql`)، لكن:
- `rpc_create_journal_entry` غير موجودة أصلاً (البند 1)، وإنشاء القيود الحالي من المتصفح **لا يفحص الفترة إطلاقاً** — يمكن إدخال قيد بتاريخ فترة مقفلة.
- لا شيء يمنع الترحيل أو العكس (`reverse_journal_entry_enhanced`) في فترة مقفلة.

### التحسين المقترح

1. **دالة حارسة واحدة** تُستدعى من كل مسارات الكتابة (إنشاء/ترحيل/عكس/ترحيل تشغيلي):

```sql
CREATE OR REPLACE FUNCTION assert_period_open(p_org uuid, p_date date)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM fiscal_periods
             WHERE org_id = p_org AND p_date BETWEEN start_date AND end_date
               AND status <> 'open') THEN
    RAISE EXCEPTION 'PERIOD_CLOSED date=%', p_date;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM fiscal_periods
                 WHERE org_id = p_org AND p_date BETWEEN start_date AND end_date) THEN
    RAISE EXCEPTION 'PERIOD_NOT_DEFINED date=%', p_date;
  END IF;
END $$;
```

2. **دورة حالات للفترة**: `open ⇒ closing ⇒ closed ⇒ locked` مع إعادة فتح `closed⇒open` بصلاحية خاصة وتسجيل في سجل تدقيق؛ `locked` نهائي (بعد اعتماد القوائم).
3. **قائمة فحص الإقفال في الواجهة** (Closing Checklist): صفحة تعرض قبل الإقفال — قيود Draft متبقية، أوامر تصنيع غير مكتملة لها WIP، انحرافات OH غير مرحّلة (`calculate_manufacturing_variances`)، فرق المخزون⇄GL (`calculate_inventory_gl_variance` موجودة في `04_period_closing.sql:184`). زر الإقفال يُعطَّل حتى صفاء القائمة أو تجاوز موثَّق.
4. **قيود الإقفال آلية**: ترحيل أرصدة الإيرادات/المصروفات إلى الأرباح المرحلة عبر `create_period_closing_entries` مع قيد عكسي تلقائي عند إعادة الفتح.

---

## 4. حماية القيود المرحّلة وسجل تدقيق غير قابل للعبث 🟠 P1

### الوضع الحالي

- لا يوجد ما يمنع `UPDATE`/`DELETE` على `gl_entries`/`gl_entry_lines` بعد الترحيل — RLS الحالية تفصل بين المستأجرين لكنها لا تفرّق بين Draft وPosted.
- الحذف الفعلي متاح من الخدمات (مثل `deleteAttachment`/`deleteComment` بلا فحص حالة القيد في `journal-service.ts:444,511`).
- التعديل بعد الترحيل يكسر المبدأ المحاسبي الأساسي: القيد المرحّل يُعكس ولا يُعدَّل.

### التحسين المقترح

1. **Trigger منع التعديل**:

```sql
CREATE OR REPLACE FUNCTION protect_posted_entries() RETURNS trigger AS $$
BEGIN
  IF (TG_OP IN ('UPDATE','DELETE')) AND OLD.status IN ('posted','reversed') THEN
    -- يُسمح فقط بتحويل posted ⇒ reversed عبر دالة العكس
    IF TG_OP = 'UPDATE' AND OLD.status = 'posted'
       AND NEW.status = 'reversed'
       AND NEW.reversed_by_entry_id IS NOT NULL THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'POSTED_ENTRY_IMMUTABLE id=%', OLD.id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;
```

مع Trigger مماثل على `gl_entry_lines` (يمنع أي لمس لسطور قيد مرحّل)، وسياسة RLS تمنع `DELETE` نهائياً على الجداول المالية لغير دور صيانة خاص.

2. **سجل تدقيق Append-Only**: جدول `gl_audit_log (entry_id, action, actor, at, before jsonb, after jsonb)` يتغذى من Triggers — يغطي الإنشاء/الترحيل/العكس/محاولات التعديل المرفوضة. (توجد اختبارات نية في `src/domain/__tests__/audit-trail.test.ts` — تُربط بواقع DB.)
3. **فرض الموافقات في DB لا في الواجهة**: `batch_post_journal_entries` يجب أن تستدعي `check_entry_approval_required` داخلياً وترفض الترحيل قبل اكتمال المستويات — حالياً الفحص متاح كـ RPC منفصل تستدعيه الواجهة اختيارياً (`journal-service.ts:282-298`)، أي يمكن تجاوزه باستدعاء الترحيل مباشرة.

---

## 5. تسوية الأستاذ المساعد مع الأستاذ العام (Subledger Reconciliation) 🟡 P2

### الوضع الحالي

المخزون يُقيَّم من `stock_quants/stock_moves` (AVCO)، والعملاء/الموردون من الفواتير، وWIP من `stage_costs` — وكل تقرير يقرأ من مصدره التشغيلي مباشرة (مثل `WIPValuationReport`). لا توجد شاشة تقارن الرصيد التشغيلي برصيد حساب المراقبة (Control Account) في GL، مع أن دالة `calculate_inventory_gl_variance` موجودة وغير موصولة.

### التحسين المقترح

1. **Views تسوية** لكل حساب مراقبة:

```sql
CREATE VIEW v_recon_inventory AS
SELECT q.org_id,
       SUM(q.onhand_qty * q.avg_cost) AS subledger_value,
       gl.balance AS gl_value,
       SUM(q.onhand_qty * q.avg_cost) - gl.balance AS variance
FROM stock_quants q
JOIN LATERAL (SELECT account_balance(q.org_id, '1310') AS balance) gl ON true
GROUP BY q.org_id, gl.balance;
```

ومثلها: `v_recon_wip` (مجموع `stage_costs` للأوامر المفتوحة مقابل حساب WIP)، `v_recon_ar`، `v_recon_ap`.

2. **صفحة "التسويات"** في قسم المحاسبة: بطاقة لكل حساب مراقبة (متطابق ✓ / فرق بمبلغ وTooltip بأقدم حركة غير مرحّلة)، مع Drill-down للحركات التشغيلية التي لا يقابلها `gl_entry_id` — وهذا يصبح ممكناً فقط بعد بند 2 (الربط الثنائي).
3. **تنبيه دوري**: فحص ليلي (pg_cron أو Edge Function) يرسل إشعاراً عبر `notification-service.ts` الموجودة عند تجاوز الفرق عتبة.

---

## 6. التقارير المالية: من ميزان مراجعة إلى قوائم كاملة 🟡 P2

### الوضع الحالي

يوجد ميزان مراجعة (`src/features/accounting/trial-balance/` + `trial-balance-helpers.ts`) وكشف حساب، لكن لا قائمة دخل ولا مركز مالي ولا تدفقات نقدية مبنية من GL. كما أن `rpc_get_account_balance` تُستدعى لكل حساب على حدة — شاشة بخمسين حساباً = خمسون استدعاء.

### التحسين المقترح

1. **View أرصدة مجمّعة واحدة** `v_account_balances (org_id, account_id, period_id, debit_total, credit_total, balance)` مبنية على `gl_entry_lines` المرحّلة فقط، مع Materialized View تُحدَّث عند الترحيل للأداء (أو GROUP BY مفهرس — القياس أولاً).
2. **تعريف تقارير مقاد بالبيانات**: جدول `financial_report_lines (report_code, line_no, label_ar, label_en, account_filter, sign, is_subtotal)` يعرّف قائمة الدخل والمركز المالي من مدى أكواد حسابات — التعديل من الإعدادات لا من الكود، ويستفيد من ثنائية اللغة الموجودة في شجرة الحسابات.
3. **مقارنات**: عمود فترة سابقة/موازنة مع نسبة التغير؛ التصدير Excel/PDF موحّد (يوجد أساس تصدير في تقارير المبيعات يُعمَّم).
4. **قائمة تكلفة البضاعة المصنوعة (Cost of Goods Manufactured)**: تقرير يربط القسمين — مواد مباشرة + عمالة + OH ± تغير WIP = تكلفة الإنتاج التام، ويتحقق تلقائياً من مطابقته لحركة حساب FG في GL. هذا التقرير هو اختبار القبول الطبيعي لتكامل البندين 2 و5.

---

## 7. الضريبة والفوترة الإلكترونية (سياق سعودي) 🟢 P3

### الوضع الحالي

العملة SAR مثبتة افتراضياً (`journal-service.ts:192`)، توجد فواتير مبيعات/مشتريات، لكن لا نموذج ضريبة قيمة مضافة صريحاً في القيود ولا دعم ZATCA.

### التحسين المقترح

1. **نموذج ضرائب**: `tax_codes (code, rate, input_account_id, output_account_id)` وسطر ضريبة تلقائي في قيود الفواتير عبر `gl_event_mappings` (حدثا `VAT_INPUT`/`VAT_OUTPUT`).
2. **تقرير الإقرار الضريبي**: مبيعات/مشتريات خاضعة وصفرية ومعفاة لكل ربع، من GL لا من الفواتير (يضمن التطابق مع الدفاتر).
3. **ZATCA المرحلة الثانية (Integration)**: توليد XML (UBL 2.1) وQR (TLV) للفواتير — يُبنى كـ Supabase Edge Function معزولة كي لا يدخل التوقيع الرقمي في المتصفح. يُقيَّم حسب إلزامية الموجة (Wave) المنطبقة على المنشأة.

---

## 8. تحسينات واجهة قسم المحاسبة 🟡 P2

1. **شاشة قيد يومية أسرع**: إدخال بلوحة مفاتيح فقط (Tab بين الخلايا، Enter لسطر جديد)، بحث حسابات فوري ثنائي اللغة مع الترميز، عرض فرق التوازن حياً وتلوينه، قوالب قيود متكررة (رواتب، إهلاك) تُحفظ وتُستدعى.
2. **حالة القيد مرئية دوماً**: شارة Draft/Posted/Reversed بألوان ثابتة في كل القوائم، وأزرار التعديل/الحذف تختفي (لا تُعطَّل فقط) للقيود المرحّلة — بالتوازي مع فرض DB في البند 4.
3. **كشف الحساب بارتباط عكسي**: من سطر الكشف إلى القيد الأصل إلى المستند التشغيلي (فاتورة/أمر تصنيع) عبر `reference_type/reference_id` الموجودين أصلاً في `gl_entries`.
4. **لوحة مؤشرات محاسبية** في `src/features/accounting/index.tsx` (حالياً 164 سطراً من البطاقات الثابتة): قيود بانتظار الموافقة، قيود Draft قديمة، فروق تسوية (بند 5)، حالة الفترة الحالية.

---

## ترتيب التنفيذ داخل القسم

| الترتيب | البند | يعتمد على |
|---|---|---|
| 1 | القيد الذرّي + قيود التوازن (بند 1) | الأساسات المشتركة 2،3 |
| 2 | حماية القيود المرحّلة (بند 4) | بند 1 |
| 3 | post_event + gl_event_mappings (بند 2) | بند 1 |
| 4 | فرض الفترات (بند 3) | بند 1 |
| 5 | التسويات (بند 5) | بند 2 |
| 6 | القوائم المالية (بند 6) | بند 1-4 |
| 7 | الواجهة (بند 8) | توازٍ |
| 8 | الضريبة/ZATCA (بند 7) | بند 2 |
