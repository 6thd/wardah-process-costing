-- =============================================
-- Check stage_costs Table Structure
-- التحقق من بنية جدول stage_costs
-- =============================================

-- IMPORTANT: Run ALL queries below to see complete structure
-- مهم: شغّل جميع الاستعلامات أدناه لرؤية البنية الكاملة

-- =============================================
-- PART 1: Check ALL columns in stage_costs table
-- =============================================
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public'
AND table_name = 'stage_costs'
ORDER BY ordinal_position;

-- Check if RLS is enabled
SELECT 
    tablename,
    rowsecurity as rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
AND tablename = 'stage_costs';

-- Check RLS policies
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE schemaname = 'public'
AND tablename = 'stage_costs';

-- Check indexes
SELECT 
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
AND tablename = 'stage_costs';

-- Sample data (if any)
SELECT COUNT(*) as total_records FROM stage_costs;

-- =============================================
-- PART 2: Summary of Key Columns
-- =============================================
-- This query shows status of all important columns in one result
SELECT 
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'stage_costs' 
            AND column_name = 'org_id'
        ) THEN '✅ EXISTS'
        ELSE '❌ MISSING'
    END as org_id,
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'stage_costs' 
            AND column_name = 'mo_id'
        ) THEN '✅ EXISTS'
        ELSE '❌ MISSING'
    END as mo_id,
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'stage_costs' 
            AND column_name = 'manufacturing_order_id'
        ) THEN '✅ EXISTS'
        ELSE '❌ MISSING'
    END as manufacturing_order_id,
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'stage_costs' 
            AND column_name = 'tenant_id'
        ) THEN '✅ EXISTS'
        ELSE '❌ MISSING'
    END as tenant_id,
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'stage_costs' 
            AND column_name = 'wc_id'
        ) THEN '✅ EXISTS'
        ELSE '❌ MISSING'
    END as wc_id,
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'stage_costs' 
            AND column_name = 'work_center_id'
        ) THEN '✅ EXISTS'
        ELSE '❌ MISSING'
    END as work_center_id;

