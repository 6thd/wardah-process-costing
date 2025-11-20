-- ===================================================================
-- التحقق من حالة جداول Journal Entries
-- Check Journal Tables Status
-- ===================================================================

-- 1. Check what exists
DO $$
BEGIN
    RAISE NOTICE '=== Checking Journal Tables ===';
    
    -- Check journal_entries
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'journal_entries'
    ) THEN
        RAISE NOTICE '✅ journal_entries EXISTS';
        
        -- Check if it's a table or view
        SELECT 'journal_entries type: ' || table_type 
        FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'journal_entries';
    ELSE
        RAISE NOTICE '❌ journal_entries DOES NOT EXIST';
    END IF;
    
    -- Check gl_entries
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'gl_entries'
    ) THEN
        RAISE NOTICE '✅ gl_entries EXISTS';
    ELSE
        RAISE NOTICE '❌ gl_entries DOES NOT EXIST';
    END IF;
    
    -- Check journal_lines
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'journal_lines'
    ) THEN
        RAISE NOTICE '✅ journal_lines EXISTS';
        
        SELECT 'journal_lines type: ' || table_type 
        FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'journal_lines';
    ELSE
        RAISE NOTICE '❌ journal_lines DOES NOT EXIST';
    END IF;
    
    -- Check gl_entry_lines
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'gl_entry_lines'
    ) THEN
        RAISE NOTICE '✅ gl_entry_lines EXISTS';
    ELSE
        RAISE NOTICE '❌ gl_entry_lines DOES NOT EXIST';
    END IF;
END $$;

-- 2. Show table structures
DO $$
DECLARE
    rec RECORD;
BEGIN
    RAISE NOTICE '=== journal_entries columns ===';
    FOR rec IN 
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'journal_entries'
        ORDER BY ordinal_position
    LOOP
        RAISE NOTICE '  - %: %', rec.column_name, rec.data_type;
    END LOOP;
    
    RAISE NOTICE '=== gl_entries columns ===';
    FOR rec IN 
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'gl_entries'
        ORDER BY ordinal_position
    LOOP
        RAISE NOTICE '  - %: %', rec.column_name, rec.data_type;
    END LOOP;
END $$;

-- 3. Check RLS policies
DO $$
DECLARE
    rec RECORD;
BEGIN
    RAISE NOTICE '=== RLS Policies ===';
    FOR rec IN 
        SELECT schemaname, tablename, policyname, permissive, roles, cmd
        FROM pg_policies 
        WHERE tablename IN ('journal_entries', 'gl_entries', 'journal_lines', 'gl_entry_lines')
        ORDER BY tablename, policyname
    LOOP
        RAISE NOTICE '  - %.%: % (%) for %', 
            rec.schemaname, rec.tablename, rec.policyname, rec.cmd, rec.roles;
    END LOOP;
END $$;

-- 4. Check if RLS is enabled
DO $$
DECLARE
    rec RECORD;
BEGIN
    RAISE NOTICE '=== RLS Status ===';
    FOR rec IN 
        SELECT tablename, rowsecurity 
        FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename IN ('journal_entries', 'gl_entries', 'journal_lines', 'gl_entry_lines')
    LOOP
        RAISE NOTICE '  - %: RLS %', 
            rec.tablename, 
            CASE WHEN rec.rowsecurity THEN 'ENABLED' ELSE 'DISABLED' END;
    END LOOP;
END $$;

-- 5. Try to select from each table
DO $$
DECLARE
    v_count INTEGER;
BEGIN
    RAISE NOTICE '=== Row Counts ===';
    
    -- journal_entries
    BEGIN
        SELECT COUNT(*) INTO v_count FROM journal_entries;
        RAISE NOTICE '  - journal_entries: % rows', v_count;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '  - journal_entries: ERROR - %', SQLERRM;
    END;
    
    -- gl_entries
    BEGIN
        SELECT COUNT(*) INTO v_count FROM gl_entries;
        RAISE NOTICE '  - gl_entries: % rows', v_count;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '  - gl_entries: ERROR - %', SQLERRM;
    END;
    
    -- journal_lines
    BEGIN
        SELECT COUNT(*) INTO v_count FROM journal_lines;
        RAISE NOTICE '  - journal_lines: % rows', v_count;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '  - journal_lines: ERROR - %', SQLERRM;
    END;
    
    -- gl_entry_lines
    BEGIN
        SELECT COUNT(*) INTO v_count FROM gl_entry_lines;
        RAISE NOTICE '  - gl_entry_lines: % rows', v_count;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '  - gl_entry_lines: ERROR - %', SQLERRM;
    END;
    
    RAISE NOTICE '=== Check Complete ===';
END $$;

