-- ===================================================================
-- Migration 82: تصليب أمني — إزالة دالة execute_sql الخطرة
-- ===================================================================
-- الخطورة: execute_sql(sql_query TEXT) تنفّذ أي SQL يُمرَّر إليها
-- (RETURN QUERY EXECUTE sql_query) وكانت قابلة للاستدعاء من المتصفح
-- عبر supabase.rpc بمفتاح anon — أي زائر يستطيع قراءة/تعديل/حذف أي شيء
-- ضمن صلاحيات الدور. هذا سطح حقن كامل يجب إغلاقه قبل الإنتاج.
--
-- المبدأ: إزالة الدالة فقط — لا تمس أي بيانات أو جداول.
-- عميل TypeScript (execute-migrations.ts) عُطِّل بالتوازي في الكود.
-- ===================================================================

-- 1) فحص استطلاعي: كل التحميلات (overloads) الموجودة للدالة
DO $$
DECLARE
    v_overload RECORD;
BEGIN
    FOR v_overload IN
        SELECT p.oid::regprocedure AS signature
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN ('execute_sql', 'exec_sql', 'run_sql')
    LOOP
        RAISE NOTICE 'وُجدت دالة خطرة سيتم إسقاطها: %', v_overload.signature;
    END LOOP;
END $$;

-- 2) الإسقاط — كل التواقيع المحتملة
DROP FUNCTION IF EXISTS public.execute_sql(TEXT);
DROP FUNCTION IF EXISTS public.execute_sql(sql_query TEXT);
DROP FUNCTION IF EXISTS public.exec_sql(TEXT);
DROP FUNCTION IF EXISTS public.run_sql(TEXT);

-- 3) تحقق نهائي: يفشل بصوت عالٍ لو بقيت أي نسخة
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN ('execute_sql', 'exec_sql', 'run_sql')
    ) THEN
        RAISE EXCEPTION 'SECURITY: ما زالت دالة تنفيذ SQL موجودة — راجع التواقيع يدوياً';
    END IF;
    RAISE NOTICE 'تم: لا توجد أي دالة تنفيذ SQL عام في public ✅';
END $$;

-- ===================================================================
-- التحقق بعد التطبيق (يجب أن يرجع 0 صفوف):
--   SELECT proname FROM pg_proc
--   WHERE proname IN ('execute_sql','exec_sql','run_sql');
-- ===================================================================
