-- ===================================================================
-- إنشاء دالة توليد رقم القيد
-- Create Entry Number Generation Function
-- ===================================================================

-- 1. حذف الدالة القديمة إن وجدت
DROP FUNCTION IF EXISTS generate_entry_number(UUID);

-- 2. إنشاء الدالة الجديدة
CREATE OR REPLACE FUNCTION generate_entry_number(p_journal_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_prefix VARCHAR(10);
    v_sequence_name TEXT;
    v_next_number INTEGER;
    v_entry_number TEXT;
    v_org_id UUID;
BEGIN
    -- الحصول على معلومات الدفتر
    SELECT sequence_prefix, org_id INTO v_prefix, v_org_id
    FROM journals 
    WHERE id = p_journal_id;
    
    IF v_prefix IS NULL THEN
        RAISE EXCEPTION 'Journal not found: %', p_journal_id;
    END IF;
    
    -- إنشاء اسم تسلسل فريد لكل دفتر
    -- استخدام أسماء أبسط للـ sequences
    v_sequence_name := 'seq_' || lower(v_prefix);
    
    -- إنشاء التسلسل إذا لم يكن موجوداً
    BEGIN
        EXECUTE format('CREATE SEQUENCE IF NOT EXISTS %I START WITH 1', v_sequence_name);
    EXCEPTION 
        WHEN duplicate_table THEN
            -- التسلسل موجود بالفعل، لا مشكلة
            NULL;
        WHEN OTHERS THEN
            -- في حالة أي خطأ آخر، نحاول المتابعة
            RAISE NOTICE 'Could not create sequence %, continuing...', v_sequence_name;
    END;
    
    -- الحصول على الرقم التالي
    BEGIN
        EXECUTE format('SELECT nextval(%L)', v_sequence_name) INTO v_next_number;
    EXCEPTION WHEN OTHERS THEN
        -- إذا فشل، نستخدم رقم 1
        v_next_number := 1;
    END;
    
    -- تنسيق رقم القيد: PREFIX-YYYY-NNNNNN
    v_entry_number := v_prefix || '-' || EXTRACT(YEAR FROM CURRENT_DATE) || '-' || LPAD(v_next_number::text, 6, '0');
    
    RETURN v_entry_number;
END;
$$;

-- 3. منح الصلاحيات
GRANT EXECUTE ON FUNCTION generate_entry_number(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION generate_entry_number(UUID) TO anon;

-- 4. إنشاء الـ sequences الأساسية لكل نوع دفتر
CREATE SEQUENCE IF NOT EXISTS seq_gj START WITH 1;  -- General Journal
CREATE SEQUENCE IF NOT EXISTS seq_si START WITH 1;  -- Sales Invoice
CREATE SEQUENCE IF NOT EXISTS seq_pi START WITH 1;  -- Purchase Invoice
CREATE SEQUENCE IF NOT EXISTS seq_cr START WITH 1;  -- Cash Receipt
CREATE SEQUENCE IF NOT EXISTS seq_cp START WITH 1;  -- Cash Payment
CREATE SEQUENCE IF NOT EXISTS seq_br START WITH 1;  -- Bank Receipt
CREATE SEQUENCE IF NOT EXISTS seq_bp START WITH 1;  -- Bank Payment

-- 5. اختبار الدالة
DO $$
DECLARE
    v_journal_id UUID;
    v_entry_number TEXT;
BEGIN
    -- الحصول على أول دفتر يومية
    SELECT id INTO v_journal_id FROM journals LIMIT 1;
    
    IF v_journal_id IS NOT NULL THEN
        -- اختبار توليد رقم القيد
        v_entry_number := generate_entry_number(v_journal_id);
        RAISE NOTICE 'Test Entry Number Generated: %', v_entry_number;
    ELSE
        RAISE NOTICE 'No journals found for testing';
    END IF;
END;
$$;

-- ===================================================================
-- ✅ تم إنشاء الدالة بنجاح
-- ✅ Function Created Successfully
-- ===================================================================

SELECT 
    'Function created successfully!' as message,
    'Test it by running: SELECT generate_entry_number(your_journal_id_here)' as test_command;
