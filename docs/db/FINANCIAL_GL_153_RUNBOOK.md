# Migration 153 — Financial GL Legal Amount Contract Runbook

**Migration:** `153_financial_gl_legal_amount_contract.sql`  
**Contract:** `WRD-FIN-REP-SRS-001` v1.4  
**Baseline cutoff عند إنشاء هذا الـPR:** 152  
**الحالة:** Repository implementation؛ **غير مطبقة على Production**.

## 1. الهدف

Migration 153 تنفذ انتقالًا ميكانيكيًا محدودًا لعقد مبالغ دفتر الأستاذ:

- نقل القيمة داخل السطر من `debit_amount/credit_amount` إلى `debit/credit` للأسطر legacy-only.
- إبقاء هوية الحساب التاريخية كما هي؛ لا Mapping ولا تخمين.
- فرض قيود قانونية على `debit/credit`.
- توسيع `gl_entries.total_debit/total_credit` إلى `numeric(18,2)`.
- إنشاء RPCs ذرّية لسندات القبض والصرف تمنع فصل GL عن تحديث الفاتورة والسند.
- إنشاء توافق انتقالي أحادي الاتجاه للكتابات المستقبلية:
  `account_id + debit/credit → account_code/name + debit_amount/credit_amount`.
- إعادة حماية أسطر القيود المرحّلة قبل إنهاء المعاملة.

## 2. خارج النطاق

لا تنفذ 153 أيًا من الآتي:

- ربط الأكواد التاريخية الرباعية بحسابات قانونية سداسية.
- تعبئة `account_id` للأسطر التاريخية.
- `account_id NOT NULL` أو FK إلى `gl_accounts`.
- Quarantine أو استبعاد سطر من التقارير.
- إصلاح الرؤوس المرحّلة التي لا تحمل سطورًا.
- تحويل خدمات التقارير أو الواجهة إلى المصدر الجديد.

هذه البنود موزعة بين قرار Mapping/Quarantine وMigration 154 والحزم اللاحقة.

## 3. الحالة الحية المثبتة قبل التنفيذ

تمت قراءة Production دون DDL أو تعديل بيانات، وكانت النتيجة:

| الفحص | النتيجة |
|---|---:|
| `gl_entries` | 11 |
| `gl_entry_lines` | 20 |
| رؤوس `posted` | 9 |
| رؤوس `draft` | 2 |
| أسطر `posted` legacy-only | 16 |
| مجموع legacy posted — مدين/دائن | 19,910.00 / 19,910.00 |
| أسطر `draft` modern-only | 4 |
| مجموع legal draft — مدين/دائن | 20,987.00 / 20,987.00 |
| mixed/missing identity | 0 / 0 |
| trigger حماية posted | موجود ومفعّل `O` |
| رؤوس `posted` بلا سطور | 3، بقيمة 9,955.00 لكل طرف |

الرؤوس الثلاثة بلا سطور **Quality finding منفصل**. 153 تبلغ عنها ولا تعيد إنشاء تاريخ محاسبي غير موجود.

## 4. ترتيب التنفيذ داخل المعاملة

1. `BEGIN` مع `lock_timeout` و`statement_timeout` محدودين.
2. قفل parent-first في statement واحدة:

```sql
LOCK TABLE public.gl_entries,
           public.gl_entry_lines
IN SHARE ROW EXCLUSIVE MODE;
```

3. Preflight fail-closed على مخطط وبيانات ثابتين تحت القفل.
4. حفظ snapshot ديناميكي للأعداد والمجاميع وIDs المستهدفة.
5. توسيع دقة رؤوس القيود وضبط nullability/defaults.
6. تعطيل `trg_protect_posted_gl_entry_lines` بالاسم فقط.
7. `UPDATE ... RETURNING` للأسطر المستهدفة وحدها.
8. إعادة تفعيل trigger الحماية فورًا.
9. مقارنة العدد وIDs والقيم والمجاميع والاتزان.
10. إضافة قيود المبالغ القانونية.
11. إنشاء trigger التوافق legal → legacy وسحب EXECUTE عن دالته الداخلية.
12. اختبار فعلي أن تعديل سطر `posted` يعيد `POSTED_ENTRY_IMMUTABLE`.
13. `COMMIT`.

ممنوع استخدام `session_replication_role` أو `DISABLE TRIGGER USER` أو bypass دائم.

## 5. Preflight الحاجز

تفشل Migration كاملة عند أي من الحالات الآتية:

- Trigger حماية posted مفقود أو معطل مسبقًا.
- NULL أو مبلغ سالب.
- مدين ودائن موجبان في السطر نفسه.
- قيمة اقتصادية موجودة في legal وlegacy معًا.
- `account_id` و`account_code` معبآن معًا أو كلاهما فارغ.
- شكل لا ينتمي بوضوح إلى modern-only أو legacy-only.
- اختلاف المؤسسة بين الرأس والسطر.
- `account_id` حديث غير موجود في `gl_accounts` للمؤسسة نفسها.
- رأس يحمل سطورًا لكن إجمالياته لا تطابق القيمة الفعلية للسطور.

الأعداد والمبالغ الحية لا تُثبت داخل شرط النجاح؛ تُحسب وقت التنفيذ.

## 6. القيود الناتجة

على `gl_entry_lines`:

- `gl_entry_lines_legal_debit_nonnegative`
- `gl_entry_lines_legal_credit_nonnegative`
- `gl_entry_lines_legal_one_sided`

وعلى `gl_entries`:

- `total_debit numeric(18,2) NOT NULL DEFAULT 0`
- `total_credit numeric(18,2) NOT NULL DEFAULT 0`

تبقى أعمدة legacy `numeric(12,2)` مؤقتًا بسبب اعتماد Views قديمة عليها. Trigger التوافق يرفض قيمة قانونية تتجاوز المدى المؤقت بدل truncation أو overflow غامض.

## 7. بوابة Fresh DB المخصصة

Workflow:

```text
Financial GL 153 Fresh DB Acceptance
```

Runner:

```text
scripts/ci/fresh-db/run_financial_gl_153_gate.sh
```

يثبت ما يلي:

- Baseline cutoff = 152.
- إنشاء fixture قبل Migration يحمل legacy posted وmodern draft ورأسًا بلا سطور.
- اختبار جلستين حقيقي:
  - الكاتب يحجز `gl_entries` ثم ينتظر قبل إدخال السطور.
  - 153 تنتظر قفل الرأس parent-first.
  - لا deadlock ولا drift، والطرفان ينجحان.
- backfill دقيق بلا Mapping أو تغيير للصفوف الحديثة.
- الحفاظ على المجاميع والاتزان.
- إعادة تفعيل حماية posted.
- عمل قيود السالب والموجب المزدوج والصفر.
- legal → legacy للكتابات الجديدة.
- رفض legacy-only وconflicting وcross-org writes.
- سحب EXECUTE عن trigger function الداخلية.
- اختبار سلبي مستقل: mixed-source row يسقط Migration ويثبت rollback الكامل.

علامة النجاح النهائية:

```text
FINANCIAL_GL_153_FRESH_DB_GATE_PASS
```

## 8. حاجز تطبيق Production ومعالجته

كان يوجد مسار تطبيق يكتب شكلًا غير قانوني ويفصل GL عن تحديث الفاتورة والسند. النسخة v1.4 من Migration 153 تعالج ذلك بإضافة `rpc_post_customer_receipt` و`rpc_post_supplier_payment` الذريتين، ويستدعي التطبيق هاتين الدالتين فقط. يبقى تطبيق Production محظورًا حتى دمج هذه النسخة، اخضرار Fresh DB، ونشر التطبيق ثم Pilot موثق.

المسار السابق كان:

```text
src/services/payment-vouchers-service.ts
```

في إنشاء قيود سندات القبض/الصرف، يرسل المسار:

```text
account_id + debit_amount/credit_amount
```

ولا يرسل `debit/credit`. Trigger 153 يرفض هذا الشكل عمدًا لأن الاتجاه العكسي legacy → legal محظور.

### القرار التشغيلي

- يجوز مراجعة ودمج **DB PR** بعد اخضرار بواباته.
- **يُمنع تطبيق 153 على Production** قبل إصلاح هذا الكاتب إلى `account_id + debit/credit` ونشره والتحقق منه.
- لا تُضعف 153 لتخمين المبالغ من legacy في كتابة جديدة.
- إصلاح الكاتب يجب أن يكون متوافقًا مع قاعدة ما قبل 153؛ الأعمدة القانونية موجودة أصلًا، لذلك يمكن نشر الإصلاح أولًا دون اعتماد Schema جديدة.
- بعد نشر الإصلاح، تُنفذ تجربة سند قبض وسند صرف وتُفحص السطور الناتجة قبل السماح بتطبيق 153.

## 9. فحوص ما قبل تطبيق Production

```sql
-- 1) شكل السطور الحالي
SELECT e.status,
       count(*) AS lines,
       count(*) FILTER (WHERE l.account_id IS NOT NULL AND l.account_code IS NULL) AS modern_only,
       count(*) FILTER (WHERE l.account_id IS NULL AND l.account_code IS NOT NULL) AS legacy_only,
       count(*) FILTER (WHERE l.account_id IS NOT NULL AND l.account_code IS NOT NULL) AS mixed_identity,
       sum(l.debit) AS legal_debit,
       sum(l.credit) AS legal_credit,
       sum(l.debit_amount) AS legacy_debit,
       sum(l.credit_amount) AS legacy_credit
FROM public.gl_entry_lines l
JOIN public.gl_entries e ON e.id=l.entry_id
GROUP BY e.status ORDER BY e.status;

-- 2) حالة trigger الحماية
SELECT tgname, tgenabled, pg_get_triggerdef(oid)
FROM pg_trigger
WHERE tgrelid='public.gl_entry_lines'::regclass
  AND tgname='trg_protect_posted_gl_entry_lines'
  AND NOT tgisinternal;

-- 3) رؤوس بلا سطور — Quality finding لا تعالجها 153
SELECT e.id, e.entry_number, e.status, e.total_debit, e.total_credit
FROM public.gl_entries e
WHERE NOT EXISTS (SELECT 1 FROM public.gl_entry_lines l WHERE l.entry_id=e.id)
ORDER BY e.entry_date, e.entry_number;

-- 4) علم المحرك يجب أن يبقى غير مفعل خلال هذه المرحلة
SELECT org_id, value
FROM public.org_settings
WHERE key='financial_reporting_engine_v2_enabled';
```

## 10. فحوص ما بعد تطبيق Production

```sql
-- legal totals carry all economic value of existing lines
SELECT e.status, count(*) AS lines,
       sum(l.debit) AS legal_debit,
       sum(l.credit) AS legal_credit
FROM public.gl_entry_lines l
JOIN public.gl_entries e ON e.id=l.entry_id
GROUP BY e.status ORDER BY e.status;

-- no line remains legal-zero while legacy-positive
SELECT count(*) AS incomplete_backfill
FROM public.gl_entry_lines
WHERE debit=0 AND credit=0
  AND (debit_amount>0 OR credit_amount>0);

-- constraints and triggers
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid='public.gl_entry_lines'::regclass
  AND conname LIKE 'gl_entry_lines_legal_%'
ORDER BY conname;

SELECT tgname, tgenabled
FROM pg_trigger
WHERE tgrelid='public.gl_entry_lines'::regclass
  AND tgname IN ('trg_protect_posted_gl_entry_lines','trg_wardah_gl_line_legal_compat')
  AND NOT tgisinternal
ORDER BY tgname;

-- header precision
SELECT column_name, numeric_precision, numeric_scale, is_nullable
FROM information_schema.columns
WHERE table_schema='public' AND table_name='gl_entries'
  AND column_name IN ('total_debit','total_credit')
ORDER BY column_name;
```

## 11. Rollback وRecovery

### قبل COMMIT أو عند فشل التطبيق

كل DDL وDML داخل معاملة واحدة. أي خطأ يعيد:

- backfill.
- تغييرات الأنواع والقيود.
- trigger التوافق.
- تعطيل/إعادة تفعيل trigger الحماية.

إلى الحالة السابقة تلقائيًا.

### بعد نجاح COMMIT

لا تستخدم حذف migration أو تعديل سجل `supabase_migrations`. ولا تُرجع المبالغ القانونية إلى صفر؛ ذلك يفقد المصدر القانوني الجديد.

أي عيب بعد التطبيق يعالج بـMigration إضافية additive موثقة، مع بقاء بيانات legal التي نُقلت وحفظ سجل التدقيق.

## 12. ترتيب النشر

1. دمج DB PR إلى `main` بعد CI والمراجعة.
2. **لا تطبيق Production بعد الدمج مباشرة بسبب حاجز writer المذكور في §8.**
3. إصلاح ونشر كاتب سندات القبض/الصرف المتوافق للخلف.
4. Pilot فعلي لسند قبض وسند صرف والتحقق من `debit/credit`.
5. إعادة تنفيذ prechecks من Production.
6. تطبيق الاسم القانوني:

```text
153_financial_gl_legal_amount_contract
```

7. تنفيذ postchecks وتوثيق سجل migration مرة واحدة.
8. إبقاء محرك التقارير v2 غير مفعّل؛ 154 وما بعدها لم تُطبق بعد.
9. تحديث Baseline لاحقًا عبر workflow وPR مستقل بعد ظهور 153 في سجل Production.


## 12. قبول السندات الذرّية

بوابة 153 تثبت أيضًا: نجاح سند قبض وصرف، GL قانوني posted، تحديث الفواتير والسندات في المعاملة نفسها، retry بلا تكرار، rollback كامل عند over-allocation، رفض cross-org، وسحب EXECUTE عن helper الداخلية. الخصومات غير مدعومة حتى اعتماد حسابها القانوني وتُرفض fail-closed.
