# تقرير اختبار بناء قاعدة فارغة — 16 يوليو 2026

## الخلاصة

نُفِّذ لأول مرة اختبار «قاعدة فارغة تصل إلى آخر schema» الذي طالبت به مراجعة
16 يوليو: PostgreSQL 16 نظيف + محاكاة بيئة Supabase الدنيا
(`scripts/ci/fresh-db/supabase_shim.sql`) + تطبيق السلسلة القانونية الكاملة
(148 ملفًا وفق قرارات MANIFEST) بالترتيب.

**النتيجة: 60 نجحت / 87 فشلت / 1 لم تُشغَّل (119 — توقفت السلسلة بعد فشل 118) = 148 — السلسلة لا تعيد بناء القاعدة من الصفر.**

التقرير الخام: `docs/db/fresh_db_chain_report_20260716.txt`

## السبب الجذري

الجداول الأساسية **لا ينشئها أي ملف في السلسلة القانونية**:
`gl_accounts` / `gl_entries` / `journal_entries` / `journals` / `products` /
`sales_invoices` / `invitations` / `user_organizations` / `user_roles` /
`goods_receipts` / جداول HR — كلها أُنشئت تاريخيًا عبر سكربتات
`sql/archive/` (مثل `deploy-wardah-erp.sql`) أو من SQL Editor مباشرة،
قبل اعتماد نظام الترقيم.

لذلك تفشل الملفات المبكرة (00–20) على «relation does not exist»، ويتسلسل
الفشل إلى معظم ما بعدها. ملفات 85–95 تمر لأنها `CREATE OR REPLACE FUNCTION`
(لا تلمس الجداول وقت التعريف)، و110/111/116–119 تفشل لغياب الجداول التي
تعمل عليها سياساتها.

## أصناف الفشل الـ87

| الصنف | العدد التقريبي | أمثلة |
|---|---|---|
| جدول أساس غائب (لم تُنشئه السلسلة) | ~55 | gl_entries، products، invitations |
| متطلب صريح فشل (`PREREQ_MISSING`/`FAIL[..]`) | ~8 | 99، 101، 102، 113، 118، 119 |
| عمود بمخطط قديم مختلف | ~12 | journal_type، sequence_prefix، tenant_id |
| سكربتات تشخيص تاريخية تفترض بيانات | ~12 | 12a–12e، 20/21/26 الفحصية |

## العلاج الصحيح: Schema Baseline

إصلاح 87 ملفًا تاريخيًا عبث؛ الحل المعياري:

1. **توليد baseline من الإنتاج** (يتطلب بيانات اعتماد المشروع):
   ```bash
   supabase db dump --project-ref uutfztmqvajmsxnrqeiv \
     -f sql/baseline/000_schema_baseline_20260716.sql
   ```
   (يشمل الجداول والدوال والسياسات والفهارس — بلا بيانات.)
2. **قاعدة جديدة = baseline + migrations بعد تاريخ الـbaseline فقط.**
   الملفات 1–119 تبقى للتاريخ ولا تُطبق على البيئات الجديدة.
3. **تحديث MANIFEST**: قسم «بناء بيئة جديدة» يشير إلى baseline كنقطة بداية.
4. **تفعيل job الـCI**: بعد وجود baseline يضاف job يطبق
   baseline + كل migration جديدة على Postgres فارغ في كل PR —
   الأدوات جاهزة في `scripts/ci/fresh-db/`.

## ما أُنجز الآن (قبل الـbaseline)

- بوابة CI لفحص صياغة كل migrations بمحلل PostgreSQL الحقيقي
  (`scripts/ci/check_migration_syntax.py`) — تمسك أخطاء مثل `RAISE` العارية
  التي وُجدت فعليًا في 103/110/111 وصياغة SQL Server في 71.
- مواءمة 118/119 (كانتا توثيقًا بلا SQL) و103/104/110/111/112 مع النص
  المطبَّق فعليًا على الإنتاج (تطابق normalized-md5 حرفي 17/19،
  ودلالي كامل 19/19).
- أدوات اختبار البناء من الصفر قابلة لإعادة التشغيل محليًا وفي CI:
  ```bash
  createdb wardah_fresh
  psql -d wardah_fresh -f scripts/ci/fresh-db/supabase_shim.sql
  python3 scripts/ci/fresh-db/build_apply_order.py > /tmp/order.txt
  PGDATABASE=wardah_fresh scripts/ci/fresh-db/run_chain.sh sql/migrations /tmp/order.txt
  ```
