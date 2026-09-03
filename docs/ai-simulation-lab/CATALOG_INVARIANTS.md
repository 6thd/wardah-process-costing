# كتالوج الثوابت — ما لا يجوز أن ينكسر

**مشتقّ من:** `sql/baseline/000_schema_baseline_20260830_083021.sql` (cutoff 185)
**تاريخ الاشتقاق:** 2026-09-02
**الإجمالي:** 32 ثابتًا — **11 سندها `NONE`** (لا يكشفها إلا هذا المختبر)

> اقرأ [ADR-SIM-004](./ADR-SIM-004-invariant-based-validation.md) قبل تعديل أي
> ثابت هنا. **إضعاف مِسبار لإنجاحه ممنوع.** المعرّفات دائمة ولا يُعاد استخدامها.

---

## 0. كيف يُقرأ الجدول

| الحقل | القيم |
|---|---|
| **سند** | `DB` قيد أو trigger يفرضه · `CONTRACT` تفرضه RPC داخليًا · `NONE` لا شيء يمنع خرقه |
| **خطورة** | `S0` فساد مالي/مخزوني · `S1` خرق عقد · `S2` انحراف مشتقّ · `S3` مرشَّح غير مثبت |
| **نقطة** | `CONT` في أي لحظة · `QUIET` بعد سكون الممثلين · `CLOSE` بعد إغلاق الفترة |

في كل مِسبار `:org` = مؤسسة المحاكاة، و`:as_of` = تاريخ التقييم. **صفر صفوف =
سليم.** كل مِسبار يعيد صفوف الانتهاك مسمّاة، لا قيمة منطقية.

---

## 1. ثوابت الدفتر العام (GL)

### INV-GL-01 — رأس القيد متوازن مع نفسه
**سند:** `DB` (`gl_entries_balanced`) · **خطورة:** S0 · **نقطة:** CONT
**المصدر:** `CONSTRAINT gl_entries_balanced CHECK (abs(total_debit - total_credit) < 0.01)`

```sql
SELECT id, entry_number, status, total_debit, total_credit
FROM gl_entries
WHERE org_id = :org AND abs(total_debit - total_credit) >= 0.01;
```

كاشف ارتداد: فشله يعني أن القيد نفسه اختفى أو عُطِّل — افحص البيئة قبل النظام.

---

### INV-GL-02 — مجموع الأسطر يساوي إجمالي الرأس ⭐
**سند:** `DB` (Migration 184) · **خطورة:** S0 · **نقطة:** CONT

الحارسان المؤجلان في Migration 184 يعيدان حساب الأسطر القانونية لكل قيد `posted`
تم لمسه، ويرفضان عدم تطابق مجموعها مع الرأس عند نهاية المعاملة. يبقى الاستعلام
أدناه مِسبار ارتداد مستقلًا، ولا يصلح وجود الحارس مبررًا لحذفه. الصفوف التاريخية
السابقة لـ184 لا تُخترع لها أسطر آليًا؛ إذا مُسَّت وجب إصلاحها ذريًا ببيانات
موثوقة وإلا تفشل مغلقة.

```sql
SELECT e.id, e.entry_number, e.entry_type, e.journal_origin,
       e.total_debit, l.sum_debit, e.total_credit, l.sum_credit
FROM gl_entries e
LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(debit), 0)  AS sum_debit,
           COALESCE(SUM(credit), 0) AS sum_credit
    FROM gl_entry_lines WHERE entry_id = e.id
) l ON TRUE
WHERE e.org_id = :org
  AND e.status = 'posted'
  AND (abs(e.total_debit  - l.sum_debit)  >= 0.01
    OR abs(e.total_credit - l.sum_credit) >= 0.01);
```

---

### INV-GL-03 — مرآة الأعمدة القانونية والتاريخية متطابقة
**سند:** `DB` للكتابات الجديدة (`wardah_sync_gl_line_legal_to_legacy`) · **خطورة:** S1 · **نقطة:** CONT

`gl_entry_lines` تحمل زوجين: القانوني `debit`/`credit`/`account_id`، والتاريخي
`debit_amount`/`credit_amount`/`account_code`. الـtrigger يزامنهما ويرفض الكتابة
على التاريخي. المِسبار يثبت أن الأمر بقي كذلك تحت الحمل.

```sql
SELECT l.id, l.entry_id, l.debit, l.debit_amount, l.credit, l.credit_amount,
       l.account_code, a.code AS account_id_code
FROM gl_entry_lines l
LEFT JOIN gl_accounts a ON a.id = l.account_id
WHERE l.org_id = :org
  AND (round(l.debit, 2)  IS DISTINCT FROM round(COALESCE(l.debit_amount, 0), 2)
    OR round(l.credit, 2) IS DISTINCT FROM round(COALESCE(l.credit_amount, 0), 2)
    OR (a.code IS NOT NULL AND l.account_code IS DISTINCT FROM a.code));
```

**قيد النطاق:** صفوف أقدم من الـtrigger قد تخالف بحق. في بيئة المحاكاة كل الصفوف
مولَّدة داخل التشغيلة، فلا استثناء تاريخي مشروع.

---

### INV-GL-04 — لا قيد مرحَّل بلا أسطر
**سند:** `DB` (Migration 184) · **خطورة:** S0 · **نقطة:** CONT

```sql
SELECT e.id, e.entry_number, e.entry_type, e.total_debit
FROM gl_entries e
WHERE e.org_id = :org AND e.status = 'posted'
  AND NOT EXISTS (SELECT 1 FROM gl_entry_lines l WHERE l.entry_id = e.id);
```

الحارس المؤجل يرفض أي قيد `posted` تم لمسه إن كان بلا سطرين قانونيين على الأقل.
قيد تاريخي سابق لـ184 قد يبقى كما هو إلى أن يُمس؛ لذلك يظل المِسبار ضروريًا
لجرد الإرث، بينما كل قيد تنشئه المحاكاة أو تلمسه محميّ بعقد قاعدة البيانات.

---

### INV-GL-05 — ميزان المراجعة يقفل
**سند:** `NONE` · **خطورة:** S0 · **نقطة:** CLOSE
**مِسبار جاهز:** `rpc_get_trial_balance`

```sql
SELECT SUM(closing_debit)  AS total_closing_debit,
       SUM(closing_credit) AS total_closing_credit,
       SUM(closing_debit) - SUM(closing_credit) AS drift
FROM public.rpc_get_trial_balance(:org, :as_of)
HAVING abs(SUM(closing_debit) - SUM(closing_credit)) >= 0.01;
```

يتحقق من الدفاتر **ويختبر أداة التسوية نفسها** تحت الحمل.

---

### INV-GL-06 — لا تسرّب مؤسسة بين السطر ورأسه
**سند:** `DB` (`GL_CROSS_ORG_ENTRY` / `GL_CROSS_ORG_TENANT_ALIAS`) · **خطورة:** S0 · **نقطة:** CONT

```sql
SELECT l.id, l.entry_id, l.org_id AS line_org, e.org_id AS entry_org, l.tenant_id
FROM gl_entry_lines l
JOIN gl_entries e ON e.id = l.entry_id
WHERE l.org_id <> e.org_id
   OR (l.tenant_id IS NOT NULL AND l.tenant_id <> l.org_id);
```

---

### INV-GL-07 — مفتاح الـidempotency لا ينتج أثرًا مزدوجًا
**سند:** `CONTRACT` (Migration 179) · **خطورة:** S0 · **نقطة:** CONT

```sql
SELECT org_id, idempotency_key, count(*) AS occurrences,
       array_agg(id) AS entry_ids
FROM gl_entries
WHERE org_id = :org AND idempotency_key IS NOT NULL
  AND status <> 'cancelled'
GROUP BY org_id, idempotency_key
HAVING count(*) > 1;
```

**الهدف الأول للسباق المصمَّم:** `rpc_complete_manufacturing_order` تُرحّل
`MATERIAL_ISSUE:<mo_id>` و`FG_RECEIPT:<mo_id>` بمفتاحين مشتقّين من المعرّف؛
إتمامان متزامنان لنفس الأمر هما اختبار هذا الثابت مباشرةً. عند التنفيذ تحقق ما
إذا كان فهرس فريد يدعمه فعليًا — إن وُجد يُرقّى السند إلى `DB` (`OQ-07`).

---

### INV-GL-08 — كل سطر أحادي الجانب وموجب
**سند:** `DB` (`gl_entry_lines_legal_one_sided` + `GL_ZERO_LEGAL_LINE`) · **خطورة:** S1 · **نقطة:** CONT

```sql
SELECT id, entry_id, debit, credit FROM gl_entry_lines
WHERE org_id = :org
  AND NOT ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0));
```

---

### INV-GL-09 — لا ترحيل في فترة مغلقة
**سند:** `DB` (`gl_entries_period_guard`) · **خطورة:** S1 · **نقطة:** CONT

يُقيَّم باستدعاء `rpc_list_periods` ثم مطابقة `entry_date` للقيود المرحَّلة مع
الفترات غير المفتوحة. سيناريو السباق: إغلاق فترة أثناء دفعة ترحيل جارية
(`rpc_set_period_status` × `rpc_batch_post_manual_journal_entries`).

---

## 2. ثوابت المخزون

### INV-INV-01 — رصيد الـbin يطابق آخر حركة في السجل ⭐
**سند:** `NONE` · **خطورة:** S0 · **نقطة:** QUIET
**المصدر:** `stock_ledger_entries` سجل الحركة القانوني · `bins` الرصيد والتقييم

```sql
WITH latest AS (
    SELECT DISTINCT ON (product_id, warehouse_id)
           product_id, warehouse_id, qty_after_transaction, stock_value
    FROM stock_ledger_entries
    WHERE org_id = :org
      AND COALESCE(is_cancelled, false) = false
      AND docstatus = 1
    ORDER BY product_id, warehouse_id, posting_datetime DESC, created_at DESC
)
SELECT b.product_id, b.warehouse_id,
       b.actual_qty, l.qty_after_transaction,
       b.actual_qty - l.qty_after_transaction AS qty_drift
FROM bins b
JOIN latest l ON l.product_id = b.product_id AND l.warehouse_id = b.warehouse_id
WHERE b.org_id = :org
  AND abs(b.actual_qty - l.qty_after_transaction) >= 0.000001;
```

**نقطة التقييم `QUIET` إلزامية:** أثناء معاملة استلام أو صرف جارية قد يكون الصفان
مؤقتًا غير متطابقين من منظور جلسة أخرى. تقييمه تحت الحمل ينتج إنذارات كاذبة تقتل
الثقة بالمختبر.

> ⚠️ **حدّ معروف، أثبته تدقيق Production 2026-08-28:** هذا المِسبار يستخدم `JOIN`،
> فيكشف **اختلاف** رصيد قائم عن السجل ويعمى تمامًا عن **حركة سجل بلا صف bin
> إطلاقًا**. أعاد صفرًا على Production بينما كانت حالة كهذه موجودة فعلًا. لا يُقرأ
> إلا مقترنًا بـ`INV-INV-08`. التفصيل في
> [`PRODUCTION_INTEGRITY_AUDIT_20260828.md`](./PRODUCTION_INTEGRITY_AUDIT_20260828.md) §F-7.

---

### INV-INV-02 — لا رصيد سالب ولا متاح سالب
**سند:** `NONE` · **خطورة:** S0 · **نقطة:** QUIET

```sql
SELECT product_id, warehouse_id, actual_qty, reserved_qty,
       actual_qty - reserved_qty AS available_qty, projected_qty
FROM bins
WHERE org_id = :org
  AND (actual_qty < 0 OR (actual_qty - reserved_qty) < 0);
```

**قرار سياسة مطلوب قبل التفعيل:** هل يسمح Wardah بالمخزون السالب في أي حالة
مشروعة؟ إن كان الجواب نعم بشروط، يُضيَّق المِسبار على الحالات غير المشروعة **مع
توثيق السبب**، لا بحذف الشرط. مسجَّل كـ`OQ-04`.

`projected_qty` عمود مولَّد (`actual − reserved + ordered + planned`) فلا يُكتب
ولا يُختبر مستقلًا؛ يُعرض للتشخيص فقط.

---

### INV-INV-03 — تسلسل الرصيد الجاري متصل
**سند:** `NONE` · **خطورة:** S0 · **نقطة:** QUIET

```sql
WITH seq AS (
    SELECT id, product_id, warehouse_id, posting_datetime, voucher_type,
           actual_qty, qty_after_transaction,
           LAG(qty_after_transaction) OVER (
               PARTITION BY product_id, warehouse_id
               ORDER BY posting_datetime, created_at, id
           ) AS prev_qty
    FROM stock_ledger_entries
    WHERE org_id = :org
      AND COALESCE(is_cancelled, false) = false
      AND docstatus = 1
)
SELECT * FROM seq
WHERE prev_qty IS NOT NULL
  AND abs(qty_after_transaction - (prev_qty + actual_qty)) >= 0.000001;
```

هذا أدق مِسبار لسباقات المخزون: تداخل حركتين متزامنتين على نفس (صنف، مخزن) يظهر
هنا كقفزة في التسلسل حتى لو بدا الرصيد النهائي سليمًا بالمصادفة.

**تنبيه:** `posting_datetime` مولَّد من `posting_date + posting_time`؛ حركتان في
نفس الميكروثانية تكسران الترتيب الحتمي. الترتيب يُكمَّل بـ`created_at` ثم `id`،
وأي انتهاك ناتج عن تعادل تام يُصنَّف قبل التصعيد.

---

### INV-INV-04 — مجمّع المنتج يطابق مجموع الـbins
**سند:** `NONE` · **خطورة:** S2 · **نقطة:** QUIET
**المصدر:** `products.stock_quantity` مجمّع مرجعي مشتقّ من الـbins

```sql
SELECT p.id, p.stock_quantity, b.bin_total,
       p.stock_quantity - b.bin_total AS drift
FROM products p
JOIN LATERAL (
    SELECT SUM(actual_qty) AS bin_total, count(*) AS bin_count
    FROM bins WHERE bins.product_id = p.id AND bins.org_id = p.org_id
) b ON b.bin_count > 0
WHERE p.org_id = :org
  AND abs(COALESCE(p.stock_quantity, 0) - COALESCE(b.bin_total, 0)) >= 0.000001;
```

`S2` لا `S0` لأن هذا مجمّع مرجعي لا دفتر قانوني. **لكن** `rpc_complete_manufacturing_order`
تكتب `products.stock_quantity` و`cost_price` مباشرةً بمتوسط مرجّح — فانحرافه تحت
الحمل مؤشر مبكّر على سباق في مسار الإنتاج التام.

---

### INV-INV-05 — الدفتر الفرعي يطابق الدفتر العام
**سند:** `NONE` · **خطورة:** S0 · **نقطة:** CLOSE
**مِسبار جاهز:** `rpc_subledger_gl_reconciliation`

```sql
SELECT public.rpc_subledger_gl_reconciliation(:as_of, :org);
-- سليم عندما تكون أعلام التوازن في الناتج صحيحة والفروق ضمن التسامح
```

يوازن حسابات المخزون (`131/132/133/135`) والـWIP (`134`) في GL مقابل
`stock_ledger_entries`/`inventory_ledger`. هذا هو الثابت الذي يكشف انفصال الدفاتر
— أخطر أعراض فشل الذرّية في نظام تكاليف.

---

### INV-INV-06 — لا رصيد بلا سجل حركة
**سند:** `NONE` · **خطورة:** S0 · **نقطة:** QUIET

```sql
SELECT b.product_id, b.warehouse_id, b.actual_qty, b.stock_value
FROM bins b
WHERE b.org_id = :org AND b.actual_qty <> 0
  AND NOT EXISTS (
      SELECT 1 FROM stock_ledger_entries s
      WHERE s.org_id = b.org_id
        AND s.product_id = b.product_id
        AND s.warehouse_id = b.warehouse_id
  );
```

يُفعّل مباشرةً القاعدة المعمارية: **`stock_ledger_entries` هو سجل الحركة القانوني**
ولا كمية تظهر بلا حركة تفسّرها.

---

### INV-INV-07 — قيمة المخزون تتسق مع الكمية ومعدل التقييم
**سند:** `NONE` · **خطورة:** S2 · **نقطة:** QUIET

```sql
SELECT product_id, warehouse_id, actual_qty, valuation_rate, stock_value,
       stock_value - (actual_qty * valuation_rate) AS value_drift
FROM bins
WHERE org_id = :org
  AND abs(stock_value - (actual_qty * valuation_rate)) >= 0.01;
```

`S2` لأن التقريب بين `numeric(15,4)` و`numeric(20,4)` ينتج فروقًا مشروعة؛ العتبة
تُعاير في Phase 1 على تشغيلة نظيفة **قبل** اعتماد الثابت، لا بعد أول فشل.

---

### INV-INV-08 — لا حركة سجل بلا رصيد يقابلها ⭐
**سند:** `NONE` · **خطورة:** S0 · **نقطة:** QUIET
**أُضيف بعد** تدقيق Production 2026-08-28 الذي كشف عمى `INV-INV-01` عن هذه الحالة.

```sql
SELECT k.product_id, k.warehouse_id, k.movements, k.last_qty_after
FROM (
    SELECT product_id, warehouse_id, count(*) AS movements,
           (array_agg(qty_after_transaction ORDER BY posting_datetime DESC, created_at DESC))[1]
               AS last_qty_after
    FROM public.stock_ledger_entries
    WHERE org_id = :org
      AND COALESCE(is_cancelled, false) = false
      AND docstatus = 1
    GROUP BY product_id, warehouse_id
) k
WHERE NOT EXISTS (
    SELECT 1 FROM public.bins b
    WHERE b.product_id = k.product_id AND b.warehouse_id = k.warehouse_id
);
```

`INV-INV-06` يكشف الاتجاه المعاكس (رصيد بلا سجل). الاثنان معًا — مع `INV-INV-01` —
يغطون الاتجاهات الثلاثة؛ أيٌّ منها وحده يترك ثغرة أُثبتت عمليًا.

---

## 3. ثوابت التصنيع والتكلفة

> ⚠️ اقرأ [ADR-SIM-004 §2.5](./ADR-SIM-004-invariant-based-validation.md) قبل هذا
> القسم. الثوابت هنا مصاغة على **العقد المنفَّذ**، والفجوة بينه وبين الصيغة
> المحاسبية المدرسية مسجَّلة سؤالًا مفتوحًا (`OQ-01`) لا ثابتًا فاشلًا.

### INV-MFG-01 — تكلفة الأمر المنجز تساوي استهلاك مواده
**سند:** `CONTRACT` (`rpc_complete_manufacturing_order`) · **خطورة:** S1 · **نقطة:** QUIET

```sql
SELECT mo.id, mo.status, mo.total_cost, c.consumed_cost,
       mo.total_cost - c.consumed_cost AS cost_drift
FROM manufacturing_orders mo
JOIN LATERAL (
    SELECT COALESCE(SUM(COALESCE(mc.total_cost,
                                 mc.consumed_quantity * COALESCE(mc.unit_cost, 0))), 0)
           AS consumed_cost
    FROM material_consumption mc
    WHERE mc.mo_id = mo.id AND mc.org_id = mo.org_id
) c ON TRUE
WHERE mo.org_id = :org AND mo.status = 'done'
  AND abs(COALESCE(mo.total_cost, 0) - c.consumed_cost) >= 0.000001;
```

هذه هي الصيغة **الفعلية** في الكود. الأجور والتكاليف غير المباشرة لا تدخل هذا
المسار (`OQ-01`).

---

### INV-MFG-02 — تكلفة الوحدة مشتقّة لا مستقلة
**سند:** `CONTRACT` · **خطورة:** S1 · **نقطة:** QUIET

```sql
SELECT id, total_cost, completed_quantity, unit_cost,
       unit_cost - (total_cost / NULLIF(completed_quantity, 0)) AS unit_drift
FROM manufacturing_orders
WHERE org_id = :org AND status = 'done' AND COALESCE(completed_quantity, 0) > 0
  AND abs(COALESCE(unit_cost, 0)
          - (COALESCE(total_cost, 0) / completed_quantity)) >= 0.000001;
```

---

### INV-MFG-03 — لا إتمام بتكلفة صفرية بلا تفويض
**سند:** `CONTRACT` (`ZERO_COST_COMPLETION`) · **خطورة:** S1 · **نقطة:** QUIET

```sql
SELECT id, order_number, status, completed_quantity, total_cost
FROM manufacturing_orders
WHERE org_id = :org AND status = 'done'
  AND COALESCE(total_cost, 0) <= 0;
```

الحارس يرفض الإتمام صفري التكلفة إلا بعلم `allow_zero_cost` **ولمسؤول المؤسسة
حصرًا**. أي صف هنا يعني إما تجاوز الحارس، أو إتمامًا مفوَّضًا يجب أن يقابله ممثل
مسؤول في سجل التشغيلة. المِسبار يُقاطَع مع سجل الاستدعاءات قبل التصعيد.

---

### INV-MFG-04 — حالة أمر التصنيع ضمن آلة الحالات
**سند:** `DB` (`manufacturing_orders_status_check`) · **خطورة:** S1 · **نقطة:** CONT

```sql
SELECT id, status FROM manufacturing_orders
WHERE org_id = :org
  AND status NOT IN ('draft','pending','confirmed','in_progress',
                     'on_hold','quality_check','done','cancelled');
```

كاشف ارتداد. **الأهم منه** هو اختبار **الانتقالات** غير المشروعة عبر
`rpc_transition_mo_status` تحت التزامن — وذلك سيناريو لا ثابت.

---

### INV-MFG-05 — تكلفة المرحلة تساوي مكوّناتها
**سند:** `NONE` · **خطورة:** S3 (مرشَّح) · **نقطة:** QUIET

`stage_costs.total_cost` عمود عادي لا مولَّد، فلا شيء يضمن تركيبته. المرجع
المتاح هو نظيره المولَّد في `stage_wip_log`:

```
cost_total = cost_beginning_wip + cost_material + cost_labor
           + cost_overhead + cost_transferred_in
```

**لا يُرقّى إلى ثابت فعّال قبل تثبيت تعريف `stage_costs.total_cost` المقصود**
(هل يخصم `waste_credit`؟ هل يشمل `regrind_proc_cost`؟). حتى ذلك يبقى `S3` ولا
يُفشل تشغيلة. مسجَّل كـ`OQ-05`.

---

### INV-MFG-06 — الكمية المنجزة لا تتجاوز المخطّطة
**سند:** `NONE` · **خطورة:** S3 (مرشَّح) · **نقطة:** QUIET

```sql
SELECT id, order_number, quantity, completed_quantity
FROM manufacturing_orders
WHERE org_id = :org AND COALESCE(completed_quantity, 0) > COALESCE(quantity, 0);
```

يبقى `S3` حتى يُحسم إن كان الإنتاج الزائد مسموحًا بسياسة (كما `allow_over_delivery`
في مسار التسليم). قرار منتج لا خلل تقني — مسجَّل كـ`OQ-06`.

---

## 4. ثوابت الأمن والعزل

### INV-SEC-01 — لا تسرّب بين المستأجرين
**سند:** `DB` (RLS — 318 سياسة في اللقطة) · **خطورة:** S0 · **نقطة:** CONT

يُقيَّم **بالسلوك لا بالاستعلام الإداري**: مؤسستان في بيئة المحاكاة، وممثل نشط في
كل منهما، ثم يُثبت أن ممثل B لا يرى ولا يعدّل أي صف يخص A عبر ناقل `postgrest`
بهويته الحقيقية. تشغيل المِسبار بامتياز إداري يُبطله تمامًا.

```sql
-- تحت هوية ممثل المؤسسة B، عبر postgrest — يجب أن يعيد 0 في كل جدول مستأجر
SELECT count(*) FROM gl_entries            WHERE org_id = :org_a;
SELECT count(*) FROM stock_ledger_entries  WHERE org_id = :org_a;
SELECT count(*) FROM manufacturing_orders  WHERE org_id = :org_a;
```

---

### INV-SEC-02 — الدوال الداخلية تبقى خارج سطح العميل
**سند:** `DB` (منح) · **خطورة:** S0 · **نقطة:** CONT

```sql
SELECT p.proname,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_can
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
      'rpc_create_journal_entry', 'rpc_post_event_journal',
      'rpc_post_work_center_oh',  'rpc_upsert_event_mapping',
      'rpc_create_matched_supplier_invoice_v149',
      'rpc_check_and_record_ai_usage')
  AND (has_function_privilege('authenticated', p.oid, 'EXECUTE')
    OR has_function_privilege('anon', p.oid, 'EXECUTE'));
```

يجب أن يعيد صفر صفوف. يُنفَّذ **قبل** كل تشغيلة كبوابة، لا بعدها فقط: تشغيلة على
بيئة انفرط فيها المنح تنتج نتائج بلا معنى.

---

### INV-SEC-03 — أسطح الكتابة المباشرة تبقى مغلقة
**سند:** `DB` (Migrations 169، 176، 178، 180، 185) · **خطورة:** S0 · **نقطة:** CONT

يُقيَّم بمحاولة مقصودة تتوقع **رسالة الخطأ المحددة**، لا أي خطأ:

| السطح | المحاولة | المتوقع |
|---|---|---|
| RBAC (176) | `UPDATE public.user_roles …` | `RBAC_175_DIRECT_USER_ROLES_UPDATE_FORBIDDEN_USE_RPC_REPLACE_USER_ROLES` أو حارس 176 |
| السندات (169) | كتابة مباشرة على رأس سند أو سطر تخصيص | رفض الحارس المزدوج |
| القيود (178/180) | استدعاء بدائيات القيود التاريخية | رفض |
| GL التاريخي | كتابة `debit_amount` مباشرةً | `GL_LEGACY_AMOUNT_WRITE_REJECTED` |
| سجل/رصيد المخزون (185) | `INSERT`/`UPDATE` مباشر على `stock_ledger_entries` أو `bins` كـ`authenticated` | `insufficient_privilege` حتى لو وُجدت policy متساهلة |

خطأ مختلف عن المتوقع = بلاغ جودة (الحالة الوسطى في
[ADR-SIM-003 §2.3](./ADR-SIM-003-dual-transport-actors.md)).

---

### INV-SEC-04 — لا صف مستأجر بلا هوية مؤسسة
**سند:** جزئي (`NOT NULL` على بعض الجداول لا كلها) · **خطورة:** S1 · **نقطة:** QUIET

```sql
SELECT 'bins' AS t, count(*) FROM bins WHERE org_id IS NULL
UNION ALL SELECT 'gl_entry_lines', count(*) FROM gl_entry_lines WHERE org_id IS NULL
UNION ALL SELECT 'material_consumption', count(*) FROM material_consumption WHERE org_id IS NULL;
```

`bins.org_id` **nullable** في المخطط الحالي بينما `stock_ledger_entries.org_id`
ليس كذلك. صف bin بلا مؤسسة يقع خارج RLS — يُفحص صراحةً.

---

### INV-SEC-05 — السطح التاريخي القابل للكتابة لا ينمو ولا يلتف ⭐
**سند:** `DB` (منح) · **خطورة:** S0 · **نقطة:** CONT

**ما وُجد:** 181 دالة `public` ممنوحة لـ`authenticated`، منها 117 خارج تسمية
`rpc_`، ومنها **24 على الأقل قادرة على الكتابة** — بينها توأم مباشر
`create_mo_with_reservation` بجوار `rpc_create_mo_with_reservation`، و
`start_operation`/`complete_operation` الكاتبتان لـ`labor_time_tracking`، و
`consume_materials_for_mo` و`backflush_materials` و`release_manufacturing_order`.

**الشقّ الأول — جرد ثابت:**

```sql
SELECT p.proname
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname NOT LIKE 'rpc\_%'
  AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
ORDER BY 1;
-- يُقارن بالجرد المرجعي؛ أي اسم جديد = توسّع غير مقصود للسطح
```

**الشقّ الثاني — لا التفاف:** لكل دالة تاريخية لها نظير قانوني، يُثبت بسيناريو
أن استدعاءها **لا** ينتج حالة يرفضها النظير. المثال الأول والأوجب:
`create_mo_with_reservation` مقابل `rpc_create_mo_with_reservation`.

**تنبيه على الدقة:** عدد الـ24 مشتقّ بمطابقة نصية على جسم الدالة، فهو **حدّ أدنى**
لا رقم نهائي؛ دالة تكتب بالتفويض قد تكون خارجه. يُؤكَّد يدويًا قبل بناء حكم
نهائي (`OQ-08`).

**أثر cutoff 185:** الأعداد أعلاه لم تتغير لأن Migration 185 لم تسحب منح
`authenticated` من الدوال التاريخية. سحبت `anon/PUBLIC` فقط من
`consume_materials_for_mo` و`update_warehouse_gl_mapping`، وأغلقت منح الكتابة
المباشرة على SLE/bins. لذلك يبقى شق عدم الالتفاف قائمًا، وتضاف فجوة
`stock_moves` نفسها إلى `OQ-09` بدل إعلان السطح التاريخي سليمًا. Migration 186
المقترحة في PR-1R تحول `consume_materials_for_mo` إلى غلاف للمسار القانوني مع
إبقاء ACL بعد 185؛ ثبات العدد وحده لا يثبت صحة السلوك، لذلك Red/Green واختبار
السباق هما دليل هذا القرار قبل فتح سيناريوهات المختبر.

---

## 5. ثوابت الحوكمة الذاتية للمختبر

هذه تختبر **المختبر نفسه**. تشغيلة تخرقها نتائجها باطلة، مهما بدت خضراء.

### INV-LAB-01 — لم يستدعِ أي ممثل دالة داخلية
**خطورة:** S0 · **نقطة:** QUIET — يُقيَّم من سجل استدعاءات المحرك مقابل القائمة الست.

### INV-LAB-02 — لم تحدث كتابة مباشرة أثناء التشغيلة
**خطورة:** S0 · **نقطة:** QUIET — كل كتابة مباشرة يجب أن تكون قبل ختم بدء
التشغيلة (بذرة L2) أو تُعدّ خرقًا لـADR-SIM-002.

### INV-LAB-03 — لم يستخدم أي ممثل `service_role`
**خطورة:** S0 · **نقطة:** CONT — خرقه يُبطل كل ثوابت الأمن دفعةً واحدة (SB-5).

### INV-LAB-04 — البيانات المرجعية النظامية حاضرة
**خطورة:** S0 · **نقطة:** قبل التشغيل

```sql
SELECT 'uoms' AS t, count(*) FROM uoms WHERE org_id IS NULL          -- متوقع 17
UNION ALL SELECT 'uom_aliases', count(*) FROM uom_aliases WHERE org_id IS NULL  -- 59
UNION ALL SELECT 'uom_categories', count(*) FROM uom_categories      -- 6
UNION ALL SELECT 'permissions', count(*) FROM permissions            -- 171
UNION ALL SELECT 'modules', count(*) FROM modules;                   -- 10
```

قاعدة بلا هذه الصفوف تقلب حراس UoM إلى **fail-open** فتمر المحاكاة على حراس
معطّلين. الأعداد الفعلية من
`001_system_reference_data_20260830_083021.sql` (263 صفًا)؛ حدود الـmanifest
الدنيا ليست بديلًا عن مطابقة بصمة اللقطة.

---

## 6. الملخص العددي

| السند | العدد | الدلالة |
|---|---|---|
| `NONE` | 11 | **لا يكشفها إلا هذا المختبر** — مبرر وجوده |
| `DB` | 12 | كواشف ارتداد؛ فشلها يعني خللًا في البيئة |
| `CONTRACT` | 4 | الصيد المستهدف: ثغرات العقود |
| جزئي | 1 | `INV-SEC-04` — القيد قائم على بعض الجداول لا كلها |
| حوكمة ذاتية للمختبر | 4 | صلاحية التشغيلة نفسها |
| **الإجمالي** | **32** | |

| الخطورة | العدد | ملاحظة |
|---|---|---|
| S0 | 20 | توقف التشغيلة وتجمّد الأدلة |
| S1 | 8 | تُكمل التشغيلة وتُعلَّم فاشلة |
| S2 | 2 | تُسجَّل ولا توقف |
| S3 | 2 | مرشَّحان بانتظار حسم منتج (`OQ-05`، `OQ-06`) |
