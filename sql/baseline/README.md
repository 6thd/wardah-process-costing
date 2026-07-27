# Schema Baseline

هذا المجلد يحتوي على Baseline المخطط — لقطة مباشرة من الإنتاج بعد تطبيق المهاجرات.

## الغرض

بدلاً من إعادة تطبيق جميع المهاجرات من الصفر في كل دورة CI (بطيء + مهاجرات قديمة قد تتعارض)،
يطبّق CI الـbaseline مرة واحدة ثم يطبّق فقط المهاجرات **الأحدث من الـbaseline**.

## بنية الملف

```
000_schema_baseline_YYYYMMDD.sql
```

- `YYYYMMDD` = تاريخ التوليد
- السطر الأول يحوي: `-- migration_cutoff: N` حيث N هو رقم أعلى مهاجرة مشمولة

## الـBaseline الحالي

| الملف | تاريخ التوليد | migration_cutoff | الحجم |
|---|---|---|---|
| `000_schema_baseline_20260727_125744.sql` | 2026-07-27 | 148 | 1065 KB / 30,379 سطر |

المحتوى المتحقق بعد إعادة البناء: 131 جدول · 201 دالة · 316 policy

---

## توليد الـBaseline

### المسار القانوني الوحيد — `Generate Schema Baseline`

`Actions → Generate Schema Baseline → Run workflow`

يتطلب سرّ `SUPABASE_DB_URL` بصيغة مجمّع الاتصالات (session mode)، واسم مستخدم
مؤهَّل بمعرّف المشروع. الصيغة والمزالق موثقة في
`docs/db/UOM_PARTIAL_RECEIPT_148_RUNBOOK.md`. لا تكتب كلمة مرور هنا ولا في أي
ملف بالمستودع.

**لا تولّد Baseline يدويًا.** حُذفت الوصفة اليدوية من هذا الملف عمدًا: كانت
تنتج لقطة معطوبة بأربع طرق، كلٌّ منها صامت.

| ما كانت تفعله الوصفة اليدوية | الأثر |
|---|---|
| `--no-acl` | تُسقط نموذج الصلاحيات كاملًا. الـBaseline يحل محل كل migration دون cutoff ومعها منحها، فتصبح القاعدة بلا `GRANT` لـ`authenticated`؛ وأخطر منه أن PostgreSQL يمنح `PUBLIC` صلاحية `EXECUTE` افتراضيًا على الدوال عند إنشائها، فبغياب `REVOKE` قد يرث `anon` تنفيذ دوال سحبها الإنتاج منه |
| `MAX` من أعلى ملف في المستودع | cutoff من المستودع لا من سجل Production. مع سياسة `repository-first` قد يكون `main` عند 149 وProduction عند 148، فتُوسم لقطة الإنتاج بـ149 وتُتخطى 149 في Fresh DB |
| لا تحوّل `CREATE SCHEMA public` | يفشل التطبيق على أي قاعدة جديدة بـ`schema "public" already exists` |
| لا حارس ولا إعادة بناء | لا شيء يكشف أيًّا مما سبق قبل الدمج |

الـworkflow يفرض هذه العقود كلها: cutoff من سجل Production الحي، صلاحيات محفوظة
مع حارس عددي، تحويل `CREATE SCHEMA`، إعادة بناء نظيفة على PostgreSQL 17،
وعتبات كائنات. ولا يكتب إلى `main` — يفتح PR للمراجعة.

### ملاحظة تاريخية: كيف وُلد baseline 20260717

لم يُولَّد بـ`pg_dump`، بل أُعيد بناؤه من `pg_catalog` عبر Supabase MCP
بالاستعلام من `pg_class`, `pg_attribute`, `pg_constraint`, `pg_index`,
`pg_trigger`, `pg_policy` مع `pg_get_functiondef()` وأخواتها.

وهذا يفسّر فجوتين انكشفتا عند أول توليد حقيقي بـ`pg_dump`:

- **صفر `GRANT`/`REVOKE`** — لا نموذج صلاحيات إطلاقًا.
- **قيود ومفاتيح مفقودة** — منها `user_organizations_role_check` وخمسة مفاتيح
  أجنبية مركّبة على `employee_id, org_id`، موجودة في الإنتاج وغائبة عن اللقطة.

تُحفظ هذه الملاحظة ولا تُحذف: هي سبب وجود فجوة lineage بين حالة Production
وسلسلة الإنشاء في المستودع.

## استخدام CI

بمجرد وجود الـbaseline تُفعَّل خطوة `Fresh DB chain test` في `ci-cd.yml` تلقائياً:

1. تُطبَّق `supabase_shim.sql` (roles + auth + storage المحاكاة)
2. يُطبَّق الـbaseline (المخطط الكامل حتى migration_cutoff)
3. تُطبَّق المهاجرات الأحدث من migration_cutoff فقط
4. الناتج: `PASS=N FAIL=0 NOT_RUN=0`

## ملاحظات

- الـbaseline **لا يُلغي** ملفات المهاجرات القديمة — تبقى للتاريخ
- عند إضافة مهاجرات جديدة كثيرة (>50 بعد الـbaseline)، أعِد التوليد
- المعيار: `psql -f baseline` على PostgreSQL 17 نظيف (بعد shim) ينجح بلا أخطاء
