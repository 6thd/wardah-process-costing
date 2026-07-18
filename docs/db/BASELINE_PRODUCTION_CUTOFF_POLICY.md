# سياسة توليد Schema Baseline من Production

**الحالة:** قانونية للمستودع ابتداءً من Migration 123  
**المبدأ:** لا تُحذف اللقطات القديمة، ولا يُكتب cutoff تخميني.

## مصدر الحقيقة

`migration_cutoff` يساوي آخر migration مطبقة فعليًا في Production وفق جدول:

```sql
SELECT name
FROM supabase_migrations.schema_migrations
ORDER BY version DESC
LIMIT 1;
```

بعد قراءة الاسم، يجب مطابقته بملف داخل `sql/migrations/` واستخراج الرقم من مقدمة اسم الملف. أعلى رقم موجود في GitHub ليس دليلًا على أنه مطبق في Production.

## حماية الـworkflow

`.github/workflows/generate-baseline.yml` ينفذ الآتي:

1. يتحقق من وجود بيانات الاتصال في GitHub Actions Secrets.
2. يقرأ اسم آخر migration مطبقة من Production.
3. يطابق الاسم مع ملف المستودع.
4. يتوقف إذا لم يجد تطابقًا بدل وضع cutoff تخميني.
5. يعرض migrations الموجودة في GitHub وغير المطبقة بعد.
6. ينشئ لقطة جديدة باسم يحتوي التاريخ والوقت حتى لا يستبدل ملفًا سابقًا.
7. يتحقق من أول سطر، الحجم، ووجود جداول ودوال قبل الإيداع.

## الاتصال

في GitHub-hosted runners استخدم رابط Session Pooler الداعم لـIPv4 والمنسوخ مباشرة من زر **Connect** في لوحة Supabase، مع SSL مطلوب. لا تضع كلمة المرور في المستودع أو الوثائق.

Direct Connection قد يعتمد IPv6 فقط ويعطي `Network is unreachable` من بعض runners.

## الترتيب الصحيح

1. دمج migration بعد نجاح CI.
2. تطبيقها على Production بالطريقة المعتمدة.
3. التحقق من ظهورها في `supabase_migrations.schema_migrations`.
4. تشغيل Generate Schema Baseline.
5. التأكد أن رأس الملف يحمل رقم migration الحية نفسها.

## التحقق بعد التوليد

```sql
SELECT count(*) FROM pg_tables WHERE schemaname = 'public';
SELECT count(*) FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'S';
SELECT count(*) FROM pg_attribute a
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND a.attgenerated = 's' AND NOT a.attisdropped;
SELECT count(*) FROM pg_policies WHERE schemaname = 'public';
```

## قواعد عدم الكسر

- لا تحذف Baseline قديمة عند إنشاء لقطة جديدة.
- لا تعدّل بيانات Production أثناء عملية `pg_dump`.
- لا تعتبر migrations المعلقة مشمولة في اللقطة.
- لا تُرسل الأعمدة `GENERATED ALWAYS` ضمن payload للكتابة.
- لا تستخدم الرابط المباشر إذا كان runner لا يدعم مسار IPv6.
