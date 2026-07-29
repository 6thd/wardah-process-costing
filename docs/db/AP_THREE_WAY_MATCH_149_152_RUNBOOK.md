# Migrations 149–152 — Runbook: المطابقة الثلاثية وفاتورة المورد الذرّية

**الحالة:** جاهزة للدمج إلى Repository بعد نجاح CI، **غير مطبقة على Production** وقت كتابة هذا المستند.  
**PR:** #65 — `test/ap-149-fresh-db-acceptance`  
**Production الموثق قبل هذه الجولة:** ينتهي عند Migration 148.  
**Baseline:** cutoff 148؛ لذلك Fresh DB يطبّق 149→152 بعد طبقتَي الـBaseline.

---

## 1. الهدف والنطاق

تغلق هذه السلسلة مسار Accounts Payable من سند استلام قانوني إلى فاتورة مورد
مطابقة ومُرحّلة محاسبيًا داخل RPC ذرّية واحدة، مع دفتر تخصيص append-only، ومنع
الفوترة الزائدة، وفصل idempotency التقني عن رقم مستند المورد.

السلسلة لا تضيف واجهة مستخدم ولا تغيّر Production بمجرد الدمج. ترتيب النشر هو:

1. **Repository-first:** دمج PR قاعدة البيانات إلى `main` بعد نجاح جميع البوابات.
2. **DB application:** تطبيق 149 ثم 150 ثم 151 ثم 152 على Production.
3. **Verification:** تنفيذ فحوص ما بعد التطبيق والتأكد من سجل migrations.
4. **UI لاحقًا فقط:** أي واجهة تعتمد على هذا العقد تُدمج بعد نجاح الخطوة 3.

---

## 2. العقد النهائي لكل Migration

| Migration | العقد النهائي |
|---|---|
| `149_ap_three_way_match_allocations` | ينشئ دفتر تخصيص GRN→فاتورة، نواة إنشاء الفاتورة المطابقة، فحوص الكمية/السعر/الدقة، والقيد المحاسبي الذرّي. |
| `150_ap_matched_invoice_idempotency_and_grn_gate` | يعيد تسمية نواة 149 إلى `rpc_create_matched_supplier_invoice_v149(jsonb)`، ويسحب تنفيذها من العملاء، ويضيف wrapper عامًا بمفتاح idempotency صريح وrequest hash وبوابة حالة GRN ومنع تكرار السطر. |
| `151_ap_helper_security_hardening` | يحوّل trigger الحماية إلى SECURITY INVOKER، ويجعل helper الرصيد يستخرج المؤسسة ويفرض `wardah_assert_org_member` ويقيّد التجميع بـ`org_id`. |
| `152_ap_allow_fully_received_purchase_orders` | يضيف حالة `fully_received` إلى الحالات القانونية للفوترة داخل نواة v149، مع فشل مغلق عند انحراف تعريف الدالة المخزّن. |

---

## 3. ترتيب التطبيق إلزامي وغير قابل للتبديل

```text
149_ap_three_way_match_allocations
150_ap_matched_invoice_idempotency_and_grn_gate
151_ap_helper_security_hardening
152_ap_allow_fully_received_purchase_orders
```

### لماذا الترتيب حرج؟

- 150 تعتمد على وجود الدالة العامة التي أنشأتها 149، ثم تعيد تسميتها إلى
  `rpc_create_matched_supplier_invoice_v149(jsonb)` وتبني wrapper جديدًا بالاسم العام.
- 152 تعتمد صراحة على الاسم الداخلي الذي أنشأته 150، وتقرأ تعريفه عبر
  `pg_get_functiondef` ثم تستبدل predicate محددًا.
- 151 تعيد تعريف helperين ظهرا في 149. موضعها بين 150 و152 هو الترتيب القانوني
  المختبر في Fresh DB، ولا يجوز نقلها أو القفز فوقها حتى لو لم تكن اعتمادًا نصيًا
  مباشرًا لـ152.
- بوابة CI اختبرت السلسلة بهذا الترتيب فقط. أي ترتيب آخر مسار غير مختبر.

> **قاعدة:** لا تُطبّق 152 منفردة، ولا تُطبّق 149 ثم 152 مع تجاوز 150 أو 151.

### ملاحظة تصميمية عن 152

استخدام `pg_get_functiondef` هنا حل استثنائي لتفادي نسخة ثانية من نواة تتجاوز
400 سطر. هو fail-closed لأن migration تفشل بـ`AP_152_DEFINITION_DRIFT` إذا لم
تجد النص المتوقع، لكنه يعتمد على شكل التعريف المخزّن. لا يُعمم كنمط افتراضي
للتصحيحات القادمة؛ الأفضل عادةً تعريف كامل واضح أو استخراج منطق أصغر إلى helper.

---

## 4. شروط ما قبل الدمج

يجب أن تكون كل النقاط التالية صحيحة على آخر SHA للـPR:

- PR مفتوح وقابل للدمج ولا توجد review threads غير محلولة.
- جميع check runs مكتملة بنجاح، وبالأخص:
  - `AP 149 Fresh DB Acceptance`
  - `Migration Governance`
  - `UoM Partial Receipt Atomic Acceptance`
  - `Regenerate UoM Database Types`
  - `CI/CD Pipeline`
  - `SonarQube Analysis`
- Fresh DB مبني على PostgreSQL 17 من Baseline cutoff 148 ثم 149→152.
- ملف `src/types/database.generated.ts` متوافق مع Fresh DB.
- لا تعديل على Migration مطبقة حيًا؛ كل الإصلاحات additive في 150–152.

لا تُستخدم نتيجة CI السابقة بعد إضافة commit جديد. يجب اعتماد checks المرتبطة
بـhead SHA النهائي نفسه.

---

## 5. شروط ما قبل تطبيق Production

### 5.1 تأكيد أن SQL موجودة في `main`

لا تطبّق أي ملف من فرع أو من نسخة محلية. بعد الدمج، تأكد أن `main` يحتوي الملفات:

```text
sql/migrations/149_ap_three_way_match_allocations.sql
sql/migrations/150_ap_matched_invoice_idempotency_and_grn_gate.sql
sql/migrations/151_ap_helper_security_hardening.sql
sql/migrations/152_ap_allow_fully_received_purchase_orders.sql
```

وسجّل SHA الدمج في سجل التنفيذ.

### 5.2 أخذ Snapshot

خذ snapshot/backup يمكن الرجوع إليه تشغيليًا قبل أي كتابة. لا تُطبع بيانات
الاتصال أو الأسرار في logs أو المستند.

### 5.3 فحص سجل Production

يجب أن ينتهي السجل القانوني عند 148 وألا توجد أسماء 149–152 مسجلة مسبقًا:

```sql
SELECT version, name
FROM supabase_migrations.schema_migrations
WHERE name IN (
  '149_ap_three_way_match_allocations',
  '150_ap_matched_invoice_idempotency_and_grn_gate',
  '151_ap_helper_security_hardening',
  '152_ap_allow_fully_received_purchase_orders'
)
ORDER BY version, name;
```

**المتوقع قبل التطبيق:** صفر صفوف.  
إذا ظهر صف واحد أو أكثر، أوقف التطبيق وحقق في السجل؛ لا تحذف الصفوف ولا تعدّلها.

### 5.4 فحص الحسابات وGL mappings

المسار يحتاج mappings نشطة داخل كل مؤسسة ستستخدمه:

| event_code | Debit | Credit |
|---|---|---|
| `AP_MATCHED_INVOICE_GOODS` | حساب GRNI/استلام غير مفوتر | Accounts Payable |
| `AP_MATCHED_INVOICE_VAT` | Input VAT | Accounts Payable |

مثال الفحص العام:

```sql
SELECT org_id, event_code, debit_account_code, credit_account_code, is_active
FROM public.gl_event_mappings
WHERE event_code IN ('AP_MATCHED_INVOICE_GOODS', 'AP_MATCHED_INVOICE_VAT')
ORDER BY org_id, event_code;
```

تحقق لكل مؤسسة pilot أن الحسابات المشار إليها موجودة، `allow_posting = true`،
وأن طبيعة الحساب والعملة/دفتر اليومية متوافقة مع سياسة المؤسسة. غياب mapping يجب
أن يفشل العملية كاملة دون فاتورة أو تخصيص أو قيد جزئي.

### 5.5 فحص بيانات الاستلام المرشحة

لا تنشئ بيانات تجارية تجريبية على Production. نفّذ قراءة فقط للتأكد من وجود
حالات قانونية وعدم وجود تخصيصات زائدة قبل التطبيق:

```sql
SELECT gr.status, grl.quality_status, count(*) AS line_count
FROM public.goods_receipts gr
JOIN public.goods_receipt_lines grl ON grl.goods_receipt_id = gr.id
GROUP BY gr.status, grl.quality_status
ORDER BY gr.status, grl.quality_status;
```

الحالات القانونية للفوترة بعد السلسلة:

- رأس GRN: `confirmed` أو `posted`.
- سطر GRN: `accepted`.
- أمر الشراء: `approved` أو `partially_received` أو `fully_received` أو
  `received` أو `closed` بحسب التاريخ والمسارات القائمة.

---

## 6. تطبيق Production

طبّق الملفات بالأسماء القانونية الكاملة وبالترتيب التالي فقط:

```text
1. 149_ap_three_way_match_allocations
2. 150_ap_matched_invoice_idempotency_and_grn_gate
3. 151_ap_helper_security_hardening
4. 152_ap_allow_fully_received_purchase_orders
```

بعد كل migration:

1. تأكد أن التنفيذ انتهى دون خطأ.
2. تأكد أن الاسم القانوني ظهر مرة واحدة في
   `supabase_migrations.schema_migrations`.
3. لا تنتقل إلى الملف التالي إذا كانت نتيجة الفحص ملتبسة.

لا تعِد تشغيل ملف نجح وسُجّل. آلية wrapper صممت idempotency للمعاملة التجارية،
وليست ترخيصًا لإعادة تطبيق migrations عشوائيًا.

---

## 7. فحوص ما بعد التطبيق

### 7.1 سجل migrations

```sql
SELECT name, count(*) AS registrations
FROM supabase_migrations.schema_migrations
WHERE name IN (
  '149_ap_three_way_match_allocations',
  '150_ap_matched_invoice_idempotency_and_grn_gate',
  '151_ap_helper_security_hardening',
  '152_ap_allow_fully_received_purchase_orders'
)
GROUP BY name
ORDER BY name;
```

**المتوقع:** أربعة صفوف، وكل `registrations = 1`.

### 7.2 وجود الدوال والتواقيع

```sql
SELECT to_regprocedure('public.rpc_create_matched_supplier_invoice(jsonb)')
         AS public_wrapper,
       to_regprocedure('public.rpc_create_matched_supplier_invoice_v149(jsonb)')
         AS internal_core,
       to_regprocedure('public.wardah_receipt_line_uninvoiced_base(uuid)')
         AS balance_helper,
       to_regprocedure('public.wardah_guard_allocation_immutability()')
         AS immutability_guard;
```

**المتوقع:** القيم الأربع غير NULL.

### 7.3 عقد EXECUTE

```sql
SELECT
  has_function_privilege(
    'authenticated',
    'public.rpc_create_matched_supplier_invoice(jsonb)',
    'EXECUTE'
  ) AS auth_wrapper,
  has_function_privilege(
    'anon',
    'public.rpc_create_matched_supplier_invoice(jsonb)',
    'EXECUTE'
  ) AS anon_wrapper,
  has_function_privilege(
    'authenticated',
    'public.rpc_create_matched_supplier_invoice_v149(jsonb)',
    'EXECUTE'
  ) AS auth_core,
  has_function_privilege(
    'service_role',
    'public.rpc_create_matched_supplier_invoice_v149(jsonb)',
    'EXECUTE'
  ) AS service_core,
  has_function_privilege(
    'anon',
    'public.wardah_receipt_line_uninvoiced_base(uuid)',
    'EXECUTE'
  ) AS anon_balance_helper;
```

**المتوقع:** `auth_wrapper=true` والبقية `false`.

### 7.4 SECURITY contract

```sql
SELECT p.proname, p.prosecdef
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'rpc_create_matched_supplier_invoice',
    'rpc_create_matched_supplier_invoice_v149',
    'wardah_receipt_line_uninvoiced_base',
    'wardah_guard_allocation_immutability'
  )
ORDER BY p.proname;
```

**المتوقع:** trigger `wardah_guard_allocation_immutability` يكون
`prosecdef=false`. helper الرصيد والـRPCs التي تحتاج صلاحيات مرتفعة تبقى
`SECURITY DEFINER` مع حراسها وسطح EXECUTE المقيّد.

### 7.5 التحقق من تصحيح `fully_received`

```sql
SELECT position(
  '''fully_received'''
  IN pg_get_functiondef(
    'public.rpc_create_matched_supplier_invoice_v149(jsonb)'::regprocedure
  )
) > 0 AS fully_received_supported;
```

**المتوقع:** `true`.

### 7.6 invariants على البيانات القائمة

```sql
-- لا فاتورة matched خارج الحالة approved أو دون قيد posted مرتبط.
SELECT count(*) AS invalid_matched_invoices
FROM public.supplier_invoices si
LEFT JOIN public.gl_entries ge ON ge.id = si.journal_entry_id
WHERE si.match_status = 'matched'
  AND (
    si.status <> 'approved'
    OR si.journal_entry_id IS NULL
    OR ge.status <> 'posted'
  );

-- لا تخصيص صافٍ يتجاوز الكمية المقبولة في سطر الاستلام.
SELECT count(*) AS overallocated_receipt_lines
FROM (
  SELECT grl.id,
         CASE WHEN grl.quality_status = 'accepted'
              THEN COALESCE(grl.received_quantity, 0)
              ELSE 0 END AS accepted_base,
         COALESCE(SUM(
           CASE WHEN a.reversal_of_allocation_id IS NULL
                THEN a.quantity_base
                ELSE -a.quantity_base
           END
         ), 0) AS allocated_base
  FROM public.goods_receipt_lines grl
  LEFT JOIN public.supplier_invoice_receipt_allocations a
    ON a.goods_receipt_line_id = grl.id
  GROUP BY grl.id, grl.quality_status, grl.received_quantity
) x
WHERE x.allocated_base > x.accepted_base;

-- القيود المنشورة المرتبطة بفواتير المورد متوازنة.
SELECT count(*) AS unbalanced_supplier_invoice_entries
FROM (
  SELECT ge.id,
         COALESCE(SUM(gel.debit_amount), 0) AS debit_total,
         COALESCE(SUM(gel.credit_amount), 0) AS credit_total
  FROM public.gl_entries ge
  JOIN public.supplier_invoices si ON si.journal_entry_id = ge.id
  JOIN public.gl_entry_lines gel ON gel.gl_entry_id = ge.id
  WHERE ge.status = 'posted'
  GROUP BY ge.id
) x
WHERE x.debit_total <> x.credit_total;
```

**المتوقع:** النتائج الثلاث كلها صفر.

> لا تنفّذ Happy Path تجاريًا على Production لمجرد الاختبار. القبول الكامل،
> والـrollback، والـzero VAT، والسباق ذو الجلستين موثقة في Fresh DB CI ببيانات
> اختبار معزولة.

---

## 8. عقد الاستدعاء للتطبيق اللاحق

الواجهة أو الخدمة تستدعي فقط:

```text
rpc_create_matched_supplier_invoice(jsonb)
```

ولا تستدعي النواة:

```text
rpc_create_matched_supplier_invoice_v149(jsonb)
```

الحمولة تحتاج على الأقل:

- `org_id`
- `vendor_id`
- `invoice_number`
- `invoice_date`
- `due_date`
- `idempotency_key` صريح وغير فارغ
- `lines[]`، وكل سطر يحمل:
  - `goods_receipt_line_id`
  - `quantity_base`
  - `unit_price`
  - `discount_percentage`
  - `tax_percentage`

قواعد مهمة:

- إعادة نفس `idempotency_key` مع نفس JSONB الدلالي تعيد نفس الفاتورة.
- إعادة المفتاح نفسه بحمولة مختلفة تفشل بـ`AP_IDEMPOTENCY_KEY_REUSED`.
- رقم فاتورة المورد uniqueness تجاري مستقل عن idempotency.
- لا يجوز تكرار `goods_receipt_line_id` داخل الحمولة نفسها.
- الدقة الرقمية للكمية والسعر محكومة، والكمية لا تتجاوز الرصيد المقبول غير
  المفوتر.

---

## 9. الفشل والرجوع القانوني

هذه السلسلة additive ولا تبرر حذف تاريخ أو تعديل ملفات مطبقة:

- إذا فشلت migration قبل التسجيل، أصلح السبب في migration لاحقة أو صحح شرط البيئة
  ثم أعد التنفيذ وفق أداة النشر الموثقة.
- إذا نجحت وسُجلت ثم ظهر عيب، لا تعدّل 149–152 ولا تحذف صفوف السجل.
- العكس يكون migration جديدة أعلى رقمًا تعيد تعريف الدالة أو الصلاحيات المطلوبة.
- دفتر `supplier_invoice_receipt_allocations` append-only؛ التصحيح بعكس قانوني
  يشير إلى التخصيص الأصلي، لا UPDATE أو DELETE.
- لا تسقط أعمدة `idempotency_key` أو `request_hash` ولا الفهارس الفريدة لتجاوز
  مشكلة تشغيلية.

الـsnapshot وسيلة استرداد كارثي، وليس بديلًا عن migration عكسية موثقة عند وجود
بيانات قانونية أُنشئت بعد التطبيق.

---

## 10. تحديث Baseline

لا يُرفع cutoff إلى 152 قبل أن تظهر 149–152 في سجل Production مرة واحدة وتنجح
فحوص ما بعد التطبيق. بعدها فقط:

1. شغّل `Generate Schema Baseline` من `main`.
2. راجع طبقتَي baseline وsystem reference data.
3. افتح PR مستقلًا.
4. شغّل Fresh DB وMigration Governance على الـBaseline الجديد.

لا تطوِ migrations غير مطبقة حيًا داخل Baseline لمجرد أنها نجحت في CI.

---

## 11. أدلة القبول في Repository

- Workflow: `.github/workflows/ap-149-fresh-db.yml`
- Runner: `scripts/ci/fresh-db/run_ap_149_gate.sh`
- Persisted-state acceptance:
  `scripts/ci/fresh-db/acceptance_149_ap_three_way_match.sql`
- Two-session race:
  `scripts/ci/fresh-db/acceptance_149_concurrency.sh`

تغطي البوابة: الصلاحيات، happy path، idempotent replay، تغيير الحمولة، تكرار رقم
المورد، over-invoicing، price variance، precision، GRN المرفوض أو غير القانوني،
تكرار سطر GRN، rollback عند غياب mapping، immutability، zero VAT، سباق آخر رصيد،
وتوازن القيود النهائية.