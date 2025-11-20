-- إضافة/تحديث أعمدة gl_entry_lines الناقصة
-- Fix missing columns in gl_entry_lines

DO $$
BEGIN
    RAISE NOTICE '🔧 فحص وإصلاح أعمدة gl_entry_lines...';
    RAISE NOTICE '================================================';
    
    -- 1. Add description column if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'gl_entry_lines' 
        AND column_name = 'description'
    ) THEN
        ALTER TABLE gl_entry_lines ADD COLUMN description TEXT;
        RAISE NOTICE '✅ تمت إضافة عمود description';
    ELSE
        RAISE NOTICE '✓ عمود description موجود';
    END IF;
    
    -- 2. Add description_ar column if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'gl_entry_lines' 
        AND column_name = 'description_ar'
    ) THEN
        ALTER TABLE gl_entry_lines ADD COLUMN description_ar TEXT;
        RAISE NOTICE '✅ تمت إضافة عمود description_ar';
    ELSE
        RAISE NOTICE '✓ عمود description_ar موجود';
    END IF;
    
    -- 3. Ensure account_code exists and is nullable
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'gl_entry_lines' 
        AND column_name = 'account_code'
    ) THEN
        ALTER TABLE gl_entry_lines ADD COLUMN account_code VARCHAR(50);
        RAISE NOTICE '✅ تمت إضافة عمود account_code';
    ELSE
        RAISE NOTICE '✓ عمود account_code موجود';
    END IF;
    
    -- 4. Ensure account_name exists and is nullable
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'gl_entry_lines' 
        AND column_name = 'account_name'
    ) THEN
        ALTER TABLE gl_entry_lines ADD COLUMN account_name TEXT;
        RAISE NOTICE '✅ تمت إضافة عمود account_name';
    ELSE
        RAISE NOTICE '✓ عمود account_name موجود';
    END IF;
    
    -- 5. Ensure account_name_ar exists and is nullable
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'gl_entry_lines' 
        AND column_name = 'account_name_ar'
    ) THEN
        ALTER TABLE gl_entry_lines ADD COLUMN account_name_ar TEXT;
        RAISE NOTICE '✅ تمت إضافة عمود account_name_ar';
    ELSE
        RAISE NOTICE '✓ عمود account_name_ar موجود';
    END IF;
    
    -- 6. Ensure tenant_id exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'gl_entry_lines' 
        AND column_name = 'tenant_id'
    ) THEN
        ALTER TABLE gl_entry_lines ADD COLUMN tenant_id UUID;
        RAISE NOTICE '✅ تمت إضافة عمود tenant_id';
    ELSE
        RAISE NOTICE '✓ عمود tenant_id موجود';
    END IF;
    
    RAISE NOTICE '================================================';
    RAISE NOTICE '✅ تم الانتهاء من فحص الأعمدة';
END $$;

-- عرض هيكل الجدول النهائي
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'gl_entry_lines'
ORDER BY ordinal_position;

