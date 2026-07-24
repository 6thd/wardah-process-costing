# Migration 148 — Runbook: الاستلام الجزئي على Snapshot أمر الشراء

**الحالة:** غير مطبقة على Production.
**سجل Production عند كتابة هذا المستند:** ينتهي عند `147_atomic_uom_purchase_order_creation`.
**الاعتماد:** 147 (إنشاء أمر شراء ذرّي بوحدات القياس) و139 (تطبيع سطور المستندات).

---

## 1. ما تعالجه هذه الـMigration

### 1.1 انقطاع مسار الاستلام

Migration 147 تُنشئ كل أمر شراء بحالة `draft`، والاستلام لا يقبل إلا
`approved` أو `submitted` أو `partially_received`. لم يكن في النظام أي انتقال
حالة محروس: المسار الوحيد كان `updatePurchaseOrderStatus` وهو تحديث مباشر من
العميل بلا تحقق من العضوية ولا من صلاحية الاعتماد ولا من شرعية الانتقال، ولم
يكن مربوطًا بأي زر في الواجهة أصلًا. النتيجة: أمر شراء يُنشأ عبر مسار UoM
الجديد لا يمكن استلامه إطلاقًا.

تضيف 148 دالتين محروستين:

| الدالة | الحارس | الانتقال |
|---|---|---|
| `rpc_submit_purchase_order` | عضوية فعّالة | `draft → submitted` |
| `rpc_approve_purchase_order` | مدير المؤسسة | `draft │ submitted → approved` |

الاعتماد يفتح الأمر للاستلام، وبالتالي لأثر مخزوني ومحاسبي، لذلك حارسه
`wardah_assert_org_admin` لا العضوية وحدها.

### 1.2 الكمية المرفوضة كانت تُغلق أمر الشراء

**هذا العيب موجود في Production منذ Migration 133 (والمسار الأقدم 89/94/95/96)،
ولا تُنشئه 148 بل ترثه عند استبدال الدالة.**

كان `received_quantity` يزداد لكل سطر مهما كانت حالة الجودة، بينما المخزون
والقيد المحاسبي ينفذان فقط عند `accepted`. ثم تُحدَّد حالة أمر الشراء من
`received_quantity` نفسها. النتيجة: أمر بـ100 وحدة استُلمت كلها مرفوضة يصبح
`fully_received` بمخزون صفر وGRNI صفر، ولا يمكن استلام البديل من المورد بسبب
`OVER_RECEIPT`.

**فحص أثر على Production بتاريخ 2026-07-24 (قراءة فقط):**

| الفحص | النتيجة |
|---|---|
| إجمالي سطور الاستلام | 6 |
| السطور المرتبطة بأمر شراء | 1 |
| سطور `rejected` مرتبطة بـPO | 0 |
| سطور `pending_inspection` مرتبطة بـPO | 0 |
| أوامر أُغلقت بكمية غير مقبولة | 0 |
| سطور PO غير أساسية بلا Snapshot | 0 |

لا توجد بيانات متضررة، لذلك الإصلاح **للأمام فقط** ولا يحتاج عكسًا قانونيًا ولا
تصحيح أرصدة تاريخية.

### 1.3 التدهور الصامت عند غياب Snapshot

كان المسار يحسب `COALESCE(NULLIF(conversion_factor_snapshot,0),1)`، أي يعامل
سطرًا بلا Snapshot كأن معامله 1. backfill في Migration 139 غطّى فقط الصفوف ذات
`uom_id IS NULL`، والقيد `purchase_order_lines_uom_snapshot_check` معرَّف
`NOT VALID` ويقبل `NULL`. فسطر بوحدة غير أساسية وSnapshot فارغ كان يُنتج كمية
وتكلفة أساس خاطئتين **دون أي خطأ**.

---

## 2. عقد الكميات الجديد

أعمدة إضافية nullable على `purchase_order_lines`:

| العمود | المعنى |
|---|---|
| `quantity` | المطلوب بوحدة الأساس (بلا تغيير) |
| `received_quantity` | المستلم ماديًا بوحدة الأساس، لكل حالات الجودة (بلا تغيير في المعنى) |
| `accepted_quantity` | المقبول جودةً — **هو ما يغلق التزام المورد** |
| `rejected_quantity` | المرفوض جودةً — يحرّر رصيد التعاقد للاستبدال |
| قيد الفحص | مشتق: `received - accepted - rejected`، ويظل محتجزًا للرصيد |

**الرصيد التعاقدي** `= quantity - accepted - pending`. حالة الأمر تُحدَّد من
`accepted_quantity` لا من `received_quantity`.

### Backfill

الصفوف القائمة تُعبَّأ بـ`accepted_quantity = received_quantity` و
`rejected_quantity = 0`. هذا **يحفظ التفسير الحالي للنظام حرفيًا** ولا يعيد
تفسير التاريخ: كل ما استُلم سابقًا كان يُعامل كمغلِق للتعاقد فعلًا. لا يتغيّر
أي رصيد ولا تنقلب حالة أي أمر بسبب هذه الـMigration.

قيد `purchase_order_lines_quality_quantity_check` يُضاف `NOT VALID` — يحرس
الكتابات الجديدة دون رفض أي صف تاريخي.

---

## 3. عقد Feature Flag

`uom_engine_enabled` يحكم **الإنشاء والواجهة فقط**:

- ✅ `rpc_create_uom_purchase_order` (147) — fail-closed على العلم.
- ✅ `rpc_list_uom_receivable_purchase_orders` (148) — fail-closed على العلم.
- ❌ `rpc_post_goods_receipt` — **لا يُطبّق العلم عمدًا**.

السبب: سطر أمر شراء يحمل Snapshot قانونيًا هو **واقعة محاسبية مخزَّنة**. إطفاء
علم الطرح لا يجوز أن يغيّر تفسير مستند قائم ولا أن يمنع استلامه. والعلم مطفأ
افتراضيًا في كل المؤسسات، فتطبيقه على الاستلام كان سيكسر كل استلام مرتبط بأمر
شراء في الإنتاج فورًا.

المُميِّز الصحيح هو **المستند لا المؤسسة**: وجود Snapshot يحدد المسار.

---

## 4. عقد Payload للاستلام

| السطر | الحقول المطلوبة |
|---|---|
| مرتبط بـPO ومعامله ≠ 1 | `purchase_order_line_id` + `qty_entered` (+ `uom_id` و`unit_cost_entered` للتحقق) |
| مرتبط بـPO ومعامله = 1 | يقبل `received_quantity`/`unit_cost` التاريخيين |
| غير مرتبط بـPO | كما كان: `received_quantity` أو `qty_entered` مع `unit_cost` |

**سبب التشدد:** الواجهة قبل 148 كانت ترسل `received_quantity` و`unit_cost`
بقيم **وحدة الأساس** (`GoodsReceiptForm` كان يقرأ `line.quantity` و
`line.unit_price`)، بينما 133/148 تفسّرانهما كقيم **وحدة الإدخال** وتضربانهما
في المعامل. عند معامل 12 هذا انتفاخ 12 ضعفًا. القيمتان متطابقتان **فقط** عند
معامل 1، فحيثما اختلفتا يُرفض الطلب بـ`RECEIPT_SNAPSHOT_CONTRACT_REQUIRED` بدل
التخمين.

### أكواد الأخطاء الجديدة

| الكود | المعنى |
|---|---|
| `PO_LINE_SNAPSHOT_MISSING` | سطر بوحدة غير أساسية بلا Snapshot قانوني |
| `RECEIPT_SNAPSHOT_CONTRACT_REQUIRED` | حمولة ملتبسة على سطر بمعامل ≠ 1 |
| `RECEIPT_UOM_MISMATCH` | وحدة الحمولة تخالف Snapshot أمر الشراء |
| `RECEIPT_COST_MISMATCH` | تكلفة الحمولة تخالف Snapshot أمر الشراء |
| `PO_NOT_SUBMITTABLE` / `PO_NOT_APPROVABLE` | انتقال حالة غير قانوني |
| `PO_HAS_NO_LINES` | إرسال/اعتماد أمر بلا أسطر |

---

## 5. التحقق قبل الدمج

| البوابة | الحالة محليًا |
|---|---|
| pglast migration syntax | ✅ 185 ملفًا |
| migration numbering + governance | ✅ `repo_max=148` |
| SECURITY DEFINER guard | ✅ 27 migration بلا دالة غير محروسة |
| Fresh DB chain (baseline 121 → 148) | ✅ `PASS=27 FAIL=0` |
| Acceptance 148 | ✅ `ACCEPTANCE_148_PASS` |
| TypeScript | ✅ |
| Vitest | ✅ |

### ضابطان سالبان

اختبار القبول أُثبت أنه غير فارغ بإعادة العيوب عمدًا:

1. إعادة إغلاق الأمر على `received_quantity` ⇒ يفشل عند
   `expected PO status partially_received, got fully_received`.
2. إزالة حارس Snapshot ⇒ يفشل عند
   `expected [PO_LINE_SNAPSHOT_MISSING] ... but it succeeded`.

---

## 6. التطبيق على Production

**لا يُطبَّق ضمن الدمج.** الترتيب بعد الدمج:

1. أخذ snapshot للقاعدة.
2. تشغيل استعلامات ما قبل التطبيق (القسم 7).
3. تطبيق `148_uom_purchase_receipt_snapshots` باسم يساوي stem الملف كاملًا.
4. تشغيل استعلامات ما بعد التطبيق.
5. التأكد من ظهور الاسم القانوني **مرة واحدة** في `supabase_migrations.schema_migrations`.
6. تحديث Baseline **فقط** بعد ظهور 148 في سجل Production، وعبر
   `Generate Schema Baseline` وPR مستقل.

العلم `uom_engine_enabled` يبقى على حاله؛ هذه الـMigration لا تفعّله ولا تتطلبه.

---

## 7. استعلامات التحقق

### قبل التطبيق — يجب أن تكون النتيجة صفرًا

```sql
-- سطور PO بوحدة غير أساسية وبلا Snapshot قانوني: ستفشل بعد التطبيق
-- بـPO_LINE_SNAPSHOT_MISSING عند محاولة استلامها.
SELECT count(*) AS lines_missing_snapshot
FROM public.purchase_order_lines pol
JOIN public.products p ON p.id = pol.product_id AND p.org_id = pol.org_id
WHERE pol.uom_id IS DISTINCT FROM p.base_uom_id
  AND (pol.conversion_factor_snapshot IS NULL OR pol.conversion_factor_snapshot <= 0);

-- أوامر أُغلقت تاريخيًا بكمية غير مقبولة.
SELECT count(*) AS orders_closed_by_unaccepted
FROM public.purchase_orders po
WHERE po.status = 'fully_received'
  AND EXISTS (
    SELECT 1 FROM public.goods_receipt_lines grl
    JOIN public.goods_receipts gr ON gr.id = grl.goods_receipt_id
    WHERE gr.purchase_order_id = po.id
      AND grl.quality_status <> 'accepted'
  );
```

### بعد التطبيق

```sql
-- 1) الأعمدة والقيد موجودة.
SELECT count(*) FILTER (WHERE column_name = 'accepted_quantity') AS accepted_col,
       count(*) FILTER (WHERE column_name = 'rejected_quantity') AS rejected_col
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'purchase_order_lines';

SELECT conname, convalidated
FROM pg_constraint
WHERE conrelid = 'public.purchase_order_lines'::regclass
  AND conname = 'purchase_order_lines_quality_quantity_check';

-- 2) الـbackfill حفظ التفسير القائم: لا سطر مقبولُه أقل من مستلمه دون رفض.
SELECT count(*) AS backfill_anomalies
FROM public.purchase_order_lines
WHERE COALESCE(accepted_quantity,0) + COALESCE(rejected_quantity,0)
      <> COALESCE(received_quantity,0);
-- المتوقع: 0 مباشرة بعد التطبيق (كل مستلم صار مقبولًا).

-- 3) لم تنقلب حالة أي أمر بسبب التطبيق.
SELECT status, count(*) FROM public.purchase_orders GROUP BY status ORDER BY status;
-- قارن بلقطة ما قبل التطبيق: يجب أن تتطابق تمامًا.

-- 4) الدوال موجودة وعقد الصلاحيات سليم.
SELECT p.proname,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'rpc_submit_purchase_order', 'rpc_approve_purchase_order',
    'rpc_list_uom_receivable_purchase_orders', 'rpc_post_goods_receipt')
ORDER BY p.proname;
-- المتوقع: auth_exec = true و anon_exec = false للأربع.

-- 5) السجل يحمل الاسم القانوني مرة واحدة.
SELECT version, name FROM supabase_migrations.schema_migrations
WHERE name = '148_uom_purchase_receipt_snapshots';
```

---

## 8. الرجوع

الـMigration لا تحذف شيئًا، فالرجوع لا يحتاج حذف أعمدة:

- لاستعادة السلوك السابق للدوال: أعد تطبيق تعريفات 133 و147 عبر
  `CREATE OR REPLACE` في migration جديدة لاحقة — **لا تعدّل 148 بعد تطبيقها**.
- الأعمدة `accepted_quantity` و`rejected_quantity` تبقى؛ وجودها غير ضار للمسار
  القديم لأنه لا يقرأها.
- القيد `NOT VALID` يمكن إسقاطه وحده إن لزم دون مساس بالبيانات.

---

## 9. خارج النطاق

- ربط الواجهة بـ`rpc_list_uom_receivable_purchase_orders`؛ نموذج الاستلام ما
  زال يقرأ `purchase_order_lines` مباشرة عبر RLS. الدالة جاهزة ومحروسة وتنتظر
  الربط.
- مسار إرجاع/مردود رسمي للكمية المرفوضة (Credit Note).
- فاتورة المورد والمطابقة الثلاثية — تتبعها Issue #46 وPR #47.
- المسار الاحتياطي القديم في `receiveGoods` (يعمل فقط عند غياب
  `rpc_post_goods_receipt`) لا يكتب الأعمدة الجديدة؛ وهو متسق ذاتيًا لأن غياب
  الدالة يعني غياب 148 كاملة.
