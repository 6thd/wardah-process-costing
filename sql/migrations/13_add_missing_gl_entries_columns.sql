-- إضافة الأعمدة الناقصة في gl_entries

-- 1. إضافة description_ar
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'gl_entries' 
        AND column_name = 'description_ar'
    ) THEN
        ALTER TABLE gl_entries ADD COLUMN description_ar text;
        RAISE NOTICE '✅ Added description_ar column to gl_entries';
    ELSE
        RAISE NOTICE 'ℹ️ description_ar already exists in gl_entries';
    END IF;
END $$;

-- 2. إضافة description (إذا لم يكن موجود)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'gl_entries' 
        AND column_name = 'description'
    ) THEN
        ALTER TABLE gl_entries ADD COLUMN description text;
        RAISE NOTICE '✅ Added description column to gl_entries';
    ELSE
        RAISE NOTICE 'ℹ️ description already exists in gl_entries';
    END IF;
END $$;

-- 3. إضافة reference_type
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'gl_entries' 
        AND column_name = 'reference_type'
    ) THEN
        ALTER TABLE gl_entries ADD COLUMN reference_type varchar(50);
        RAISE NOTICE '✅ Added reference_type column to gl_entries';
    ELSE
        RAISE NOTICE 'ℹ️ reference_type already exists in gl_entries';
    END IF;
END $$;

-- 4. إضافة reference_number
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'gl_entries' 
        AND column_name = 'reference_number'
    ) THEN
        ALTER TABLE gl_entries ADD COLUMN reference_number varchar(100);
        RAISE NOTICE '✅ Added reference_number column to gl_entries';
    ELSE
        RAISE NOTICE 'ℹ️ reference_number already exists in gl_entries';
    END IF;
END $$;

-- 5. إضافة reference_id
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'gl_entries' 
        AND column_name = 'reference_id'
    ) THEN
        ALTER TABLE gl_entries ADD COLUMN reference_id uuid;
        RAISE NOTICE '✅ Added reference_id column to gl_entries';
    ELSE
        RAISE NOTICE 'ℹ️ reference_id already exists in gl_entries';
    END IF;
END $$;

-- 6. التحقق من الأعمدة النهائية
SELECT 
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'gl_entries'
AND column_name IN ('description', 'description_ar', 'reference_type', 'reference_number', 'reference_id')
ORDER BY column_name;

