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
| `000_schema_baseline_20260717.sql` | 2026-07-17 | 121 | 611 KB / 13 521 سطر |

المحتوى: 125 جدول · 216 PK/UNIQUE · 237 FK · 470 فهرس · 164 دالة · 17 view · 72 trigger · 125 RLS ENABLE · 333 policy

---

## توليد الـBaseline

### الطريقة المُوصى بها — GitHub Actions (تلقائي)

1. أضف السر `SUPABASE_DB_URL` في إعدادات المستودع:
   `Settings → Secrets and variables → Actions → New repository secret`

   القيمة:
   ```
   postgresql://postgres:[DB_PASSWORD]@db.uutfztmqvajmsxnrqeiv.supabase.co:5432/postgres?sslmode=require
   ```

2. شغّل الـworkflow يدوياً:
   `Actions → Generate Schema Baseline → Run workflow`

3. سيُولد الـbaseline ويُودَع تلقائياً في `sql/baseline/`.

### توليد يدوي (محلي)

```bash
pg_dump "$SUPABASE_DB_URL" \
  --schema-only \
  --no-owner \
  --no-acl \
  --no-comments \
  --schema=public \
  --no-tablespaces \
  | grep -v '^--' \
  > sql/baseline/000_schema_baseline_$(date +%Y%m%d).sql

# أضف سطر migration_cutoff في أول الملف
MAX=$(ls sql/migrations/ | grep -oE '^[0-9]+' | sort -n | uniq | tail -1)
sed -i "1s/^/-- migration_cutoff: $MAX\n/" sql/baseline/000_schema_baseline_$(date +%Y%m%d).sql
```

### بديل — Supabase MCP (عند تعذّر `pg_dump`)

إذا كان Direct Connection IPv6-only (لا يدعمه `psql` محلياً)، يمكن إعادة بناء
الـbaseline من `pg_catalog` عبر Supabase MCP أو Transaction Pooler:

```
postgresql://postgres.uutfztmqvajmsxnrqeiv:[PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:6543/postgres
```

الـbaseline الحالي (`20260717`) مُولَّد بهذه الطريقة بالاستعلام من:
`pg_class`, `pg_attribute`, `pg_constraint`, `pg_index`, `pg_trigger`, `pg_policy`
مع `pg_get_functiondef()`, `pg_get_indexdef()`, `pg_get_viewdef()`, `pg_get_triggerdef()`.

## استخدام CI

بمجرد وجود الـbaseline تُفعَّل خطوة `Fresh DB chain test` في `ci-cd.yml` تلقائياً:

1. تُطبَّق `supabase_shim.sql` (roles + auth + storage المحاكاة)
2. يُطبَّق الـbaseline (المخطط الكامل حتى migration_cutoff)
3. تُطبَّق المهاجرات الأحدث من migration_cutoff فقط
4. الناتج: `PASS=N FAIL=0 NOT_RUN=0`

## ملاحظات

- الـbaseline **لا يُلغي** ملفات المهاجرات القديمة — تبقى للتاريخ
- عند إضافة مهاجرات جديدة كثيرة (>50 بعد الـbaseline)، أعِد التوليد
- المعيار: `psql -f baseline` على PostgreSQL 16 نظيف (بعد shim) ينجح بلا أخطاء
