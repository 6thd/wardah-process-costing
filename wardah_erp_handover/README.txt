

# ✅ تعليمات التنفيذ لـ Qoder

## 0) المتطلبات

* قاعدة بيانات **PostgreSQL 14+** (أو **Supabase**).
* صلاحية اتصال بROLE يقدر ينفّذ DDL/RLS (مثال: Supabase **service\_role**).
* أداة سطر أوامر `psql` أو Supabase SQL Editor.

> **متغيرات مهمّة (استبدلها):**

* `DB_URL` = اتصال Postgres/Supabase (مثال: `postgres://...`)
* `TENANT_ID` = UUID جهة “وردة البيان” (مثال: `8e5c5c36-...-...`)

---

## 1) تطبيق مخطط القاعدة و RLS و وظائف AVCO

افتح تيرمنال ونفّذ بالترتيب:

```bash
psql "$DB_URL" -f wardah-migration-schema.sql
psql "$DB_URL" -f wardah-rls-policies.sql
psql "$DB_URL" -f wardah-avco-functions.sql
```

> عند استخدام ملف موحّد بديل:
> `psql "$DB_URL" -f migration.sql`

---

## 2) تعيين سياق المستأجر (جلسة العمل)

RLS عندنا تعتمد على الـ JWT Claims. في جلسة `psql`, **اضبط الـ claim** قبل الاستيراد:

```sql
-- داخل psql (لكل جلسة)
SET LOCAL "request.jwt.claims" = json_build_object(
  'role','service_role',
  'tenant_id','TENANT_ID'  -- ← استبدلها بـ UUID حقيقي
)::text;
```

> في Supabase SQL Editor: نفّذ السطر أعلاه قبل أو مع أوامر الإدراج.

---

## 3) استيراد **شجرة الحسابات** (CSV → JSON → Upsert)

### 3.1 إنشاء جدول مرحلي مطابق للأعمدة

```sql
drop table if exists stg_coa;
create temp table stg_coa (
  code text, name text, category text, subtype text, parent_code text,
  normal_balance text, allow_posting boolean, is_active boolean,
  currency text, notes text
);
```

### 3.2 استيراد الـ CSV

* مع `psql` من جهازك:

```bash
\copy stg_coa from 'wardah_enhanced_coa.csv' with (format csv, header true, encoding 'UTF8')
```

* (بديل Supabase): استخدم **Import** من واجهة SQL للإدخال في `stg_coa`.

### 3.3 ضخّها في جدول الحسابات عبر الدالة

> نستدعي **fn\_gl\_accounts\_upsert** ببايانات JSON

```sql
select fn_gl_accounts_upsert(
  'TENANT_ID'::uuid,
  (select jsonb_agg(to_jsonb(s)) from stg_coa s)
);
-- (يفضّل تشغيلها مرّتين لضمان ربط parent_id لو كان ترتيب الصفوف غير هرمي)
select fn_gl_accounts_upsert(
  'TENANT_ID'::uuid,
  (select jsonb_agg(to_jsonb(s)) from stg_coa s)
);
```

---

## 4) تحميل **خرائط الأحداث** (GL Mappings)

### 4.1 جدول مرحلي

```sql
drop table if exists stg_map;
create temp table stg_map (
  event_code text, work_center text, 
  dr_account_code text, cr_account_code text,
  amount_key text, notes text
);
```

### 4.2 استيراد CSV

```bash
\copy stg_map from 'wardah_gl_mappings.csv' with (format csv, header true, encoding 'UTF8')
```

### 4.3 إدراج في الجدول الفعلي مع احترام RLS و Key

```sql
insert into gl_mappings (
  tenant_id, event_code, work_center, line_no,
  dr_account_code, cr_account_code, amount_key, notes
)
select 
  'TENANT_ID'::uuid, event_code, nullif(work_center,''), 1,
  dr_account_code, cr_account_code, coalesce(nullif(amount_key,''),'actual_amount'), notes
from stg_map
on conflict (tenant_id, event_code, coalesce(work_center,''), line_no)
do update set 
  dr_account_code = excluded.dr_account_code,
  cr_account_code = excluded.cr_account_code,
  amount_key     = excluded.amount_key,
  notes          = excluded.notes;
```

---

## 5) **اختبار سريع** لدورة تصنيع/بيع

### 5.1 جدول مرحلي للعمليات النموذجية

```sql
drop table if exists stg_txn;
create temp table stg_txn (
  txn_id text, txn_date date, event_code text, work_center text,
  amount numeric(18,2), item text, qty numeric, rate numeric,
  dr_account_code text, cr_account_code text, notes text
);
```

### 5.2 استيراد ملف السيناريو

```bash
\copy stg_txn from 'sample_transactions.csv' with (format csv, header true, encoding 'UTF8')
```

### 5.3 توليد قيود يومية تلقائيًا من الخرائط

```sql
-- قيد لكل عملية (txn_id) اعتمادًا على event_code/center
do $$
declare
  v_jid uuid;
  v_ln  int;
begin
  for v_jid in
    select gen_random_uuid()
  loop
    null; -- placeholder
  end loop;

  for r in (
    select * from stg_txn order by txn_date, txn_id
  ) loop
    insert into gl_journal (tenant_id, jrn_date, ref)
    values ('TENANT_ID'::uuid, r.txn_date, r.txn_id)
    returning id into v_jid;

    v_ln := 0;

    -- اجلب كل المابّنج المطابق للحدث + مركز العمل (أو null)
    for m in (
      select * from gl_mappings
      where tenant_id = 'TENANT_ID'::uuid
        and event_code = r.event_code
        and (work_center is null or work_center = nullif(r.work_center,''))
      order by line_no
    ) loop
      v_ln := v_ln + 1;

      insert into gl_entries (
        tenant_id, journal_id, line_no, account_code, dr, cr, work_center, notes
      )
      values (
        'TENANT_ID'::uuid, v_jid, v_ln, m.dr_account_code,
        case m.amount_key 
          when 'actual_amount' then coalesce(r.amount,0)
          when 'net_amount'    then coalesce(r.amount,0)
          when 'vat_amount'    then coalesce(r.amount,0)
          else coalesce(r.amount,0)
        end,
        0,
        nullif(r.work_center,''),
        coalesce(r.notes, m.notes)
      );

      v_ln := v_ln + 1;

      insert into gl_entries (
        tenant_id, journal_id, line_no, account_code, dr, cr, work_center, notes
      )
      values (
        'TENANT_ID'::uuid, v_jid, v_ln, m.cr_account_code,
        0,
        case m.amount_key 
          when 'actual_amount' then coalesce(r.amount,0)
          when 'net_amount'    then coalesce(r.amount,0)
          when 'vat_amount'    then coalesce(r.amount,0)
          else coalesce(r.amount,0)
        end,
        nullif(r.work_center,''),
        coalesce(r.notes, m.notes)
      );
    end loop;
  end loop;
end $$;
```

### 5.4 سموك تشِك

```sql
-- رصيد WIP/FG/COGS
select account_code, sum(dr)-sum(cr) as balance
from gl_entries e
where tenant_id = 'TENANT_ID'::uuid
  and account_code in ('134100','134200','134300','134400','135100','135110','540000')
group by 1
order by 1;

-- التوافق المزدوج (DR=CR) لكل قيد
select j.id, j.ref, j.jrn_date, 
       sum(e.dr) as total_dr, sum(e.cr) as total_cr
from gl_journal j
join gl_entries e on e.journal_id = j.id
where j.tenant_id = 'TENANT_ID'::uuid
group by 1,2,3
having abs(sum(e.dr) - sum(e.cr)) > 0.001;
```

> لو ظهر فرق تحميل صناعي (فعلي مقابل مطبّق)، استخدم دوال/أوامر الإقفال إلى **593100/593200** حسب دليل AVCO.

---

## 6) نقاط ضبط مهمة

* **المواد/الأجور/الأوفرهيد المطبّق → WIP** (1341/2/3/4xx).
* **الأوفرهيد الفعلي** على 5131/5132… مقابل المورد/البنك.
* **التحويل WIP→FG** ثم **COGS عند التسليم**.
* **VAT**: فصل إيراد الصافي عن **VAT Output** (217000) و**VAT Input** (116000).

---

## 7) قبول المهمة (Acceptance)

* جميع ملفات SQL تُنفَّذ بدون أخطاء.
* استيراد CoA و GL Mappings بنجاح.
* سيناريو العينة يُنشئ قيود متوازنة (DR=CR) وتظهر أرصدة منطقية في WIP/FG/COGS.
* تمرير استعلامات RLS بنجاح لكل دور (إن لزم).

---

### أي مشكلة تواجهها؟

* إن تعذّر استيراد CSV من Supabase SQL Editor، استخدم `psql \copy` أو ارفع CSV إلى **Storage** واستعمل وظيفة `http_get()`/ETL (اختياري).
* إن لم تُفعّل الـ claims: استعمل السطر **SET LOCAL "request.jwt.claims"** كما بالأعلى أو نفّذ عبر **service\_role** داخليًا.

بالتوفيق يا Qoder! 🚀
