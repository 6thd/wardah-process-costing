# Database Utilities (أدوات إرث)

> **مصدر الحقيقة الوحيد للـ migrations هو `sql/migrations/`.**
> ملفات SQL التي كانت هنا (001/002) نُقلت إلى `sql/migrations/108` و`109`.
> لا تضع DDL جديداً هنا.

## الملفات المتبقية

- `execute-migrations.ts` / `run-migrations.js` — أدوات تشغيل قديمة (لا تُستخدم في الإنتاج)
- `diagnose-tables.sql` / `validate-sql.js` — أدوات تشخيص للتطوير المحلي
- `migrations/` — فارغ (نُقل محتواه)

## لتطبيق migration جديدة

أنشئ `sql/migrations/NNN_description.sql` + سطر في `sql/migrations/MANIFEST.md`
ثم طبّقها عبر Supabase MCP أو CLI.