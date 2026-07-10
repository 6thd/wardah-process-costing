-- ===================================================================
-- Migration 86: إغلاق ثغرات RLS المفتوحة للـ anon (متمّمة لـ 83)
-- ===================================================================
-- الخلفية: أثناء تطبيق 83 على قاعدة الإنتاج تبيّن أن الملف افترض
-- أسماء سياسات لا تطابق الموجود حياً، فبقيت سياسات "Allow all"
-- (USING(true) للدور public = مفتاح anon العام) تُبطل العزل على
-- products/categories، كما انكشف أن الدفتر المالي كله (gl_entries,
-- sales_invoices, purchase_orders, supplier_invoices, goods_receipts,
-- delivery_notes وأسطرها) مفتوح للـ anon بنفس النمط.
--
-- القرار (المالك): تحويل آمن public → authenticated — يُبقي USING(true)
-- للمستخدم المسجَّل (صفر تغيير سلوك، صفر خطر كسر) ويغلق anon تماماً.
-- مؤسسة واحدة فأقصى عزل غير مطلوب الآن؛ الخطر الحقيقي هو المفتاح العام.
--
-- المبدأ: لا يمس بيانات. يعيد ضبط أدوار السياسات فقط. Idempotent.
-- التحقق العملي بعد 83+86: قراءة gl_entries/products بمفتاح anon ⇒ 0 صف.
-- ===================================================================

BEGIN;

-- 1) products/categories: إسقاط "Allow all" المتبقية (بدائل org_id من 83 قائمة)
DROP POLICY IF EXISTS "Allow all" ON products;
DROP POLICY IF EXISTS "Allow all" ON categories;

-- 2) تحويل كل سياسات "Allow all%" المفتوحة (public/anon) إلى authenticated
--    يشمل: gl_entries, gl_entry_lines, sales_invoices, sales_invoice_lines,
--    purchase_orders, purchase_order_lines, supplier_invoices,
--    supplier_invoice_lines, goods_receipts, goods_receipt_lines,
--    delivery_notes, delivery_note_lines — وأي جدول آخر بنفس النمط.
DO $$
DECLARE
    r RECORD;
    v_count INT := 0;
BEGIN
    FOR r IN
        SELECT tablename, policyname
        FROM pg_policies
        WHERE schemaname = 'public'
          AND policyname LIKE 'Allow all%'
          AND (roles::text[] && ARRAY['public', 'anon'])
    LOOP
        EXECUTE format('ALTER POLICY %I ON public.%I TO authenticated',
                       r.policyname, r.tablename);
        v_count := v_count + 1;
        RAISE NOTICE 'حُصرت سياسة % على % بدور authenticated', r.policyname, r.tablename;
    END LOOP;

    -- جدول BOM الاحتياطي المؤرّخ: إسقاط السياسة المفتوحة للـ anon
    -- (سياسة authenticated موجودة أصلاً على نفس الجدول)
    IF EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'bill_of_materials_20250905_1900'
          AND policyname = 'anon_all_bill_materials'
    ) THEN
        DROP POLICY anon_all_bill_materials ON public.bill_of_materials_20250905_1900;
        v_count := v_count + 1;
    END IF;

    RAISE NOTICE 'إجمالي السياسات المحصورة/المغلقة: %', v_count;
END $$;

COMMIT;

-- ===================================================================
-- مقصود إبقاؤه عاماً (لا يُحصر — وظيفة ما قبل الدخول أو بيانات وصف غير حساسة):
--   invitations.invitations_by_token (SELECT) — قبول الدعوة برابط
--   permissions.permissions_public_read (SELECT) — كتالوج الصلاحيات
--   audit_logs.audit_insert / audit_logs_insert (INSERT) — تسجيل التدقيق
-- سياسات INSERT الأخرى للدور public تبقى: شرط WITH CHECK يعتمد auth.uid()
--   فيفشل للـ anon تلقائياً (لا يحتاج حصراً صريحاً).
--
-- التحقق بعد التطبيق:
--   -- بمفتاح anon: يجب أن يرجع 0 صف
--   SELECT * FROM gl_entries LIMIT 1;
--   -- بمستخدم مسجَّل: يرى صفوف مؤسسته طبيعياً
-- ===================================================================
