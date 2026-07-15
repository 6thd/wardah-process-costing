# supabase/migrations — اتفاقية المشروع

مصدر الحقيقة الوحيد للـ migrations هو **`sql/migrations/`** (145+ ملف مرقَّم + `MANIFEST.md`).

الملفات الأصلية ذات الطوابع الزمنية 2024 (20240924083100_add_gl_tables وما بعدها)
أُرشفت في `sql/archive/supabase-2024-originals/` — استُعيض عنها بمجموعة المرقَّمات.

## لتطبيق migration جديدة

1. أنشئ `sql/migrations/NNN_description.sql` (NNN = الرقم التالي في MANIFEST).
2. أضف سطراً في `sql/migrations/MANIFEST.md`.
3. طبّقها عبر Supabase MCP أو CLI:
   ```
   supabase db push  # أو mcp__Supabase__apply_migration
   ```

لا تضع DDL مباشرةً في هذا المجلد — الـ Supabase CLI يجلب ما يحتاجه من SQL عبر `apply_migration`.
