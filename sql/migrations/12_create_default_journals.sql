-- ============================================================================
-- Create Default Journals (أنواع القيود الافتراضية)
-- ============================================================================

DO $$
DECLARE
    v_org_id UUID := '00000000-0000-0000-0000-000000000001'::uuid;
    v_gen_id UUID;
    v_sales_id UUID;
    v_purch_id UUID;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '🎯 Creating Default Journals...';
    RAISE NOTICE '========================================';
    
    -- 1. قيد عام (General Journal)
    INSERT INTO journals (
        code,
        name,
        name_ar,
        journal_type,
        sequence_prefix,
        is_active,
        org_id
    ) VALUES (
        'GEN',
        'General Journal',
        'قيد عام',
        'general',
        'JE-',
        true,
        v_org_id
    )
    ON CONFLICT (org_id, code) DO UPDATE
    SET name = EXCLUDED.name,
        name_ar = EXCLUDED.name_ar,
        is_active = true
    RETURNING id INTO v_gen_id;
    
    RAISE NOTICE '  ✓ Created General Journal: %', v_gen_id;
    
    -- 2. قيد مبيعات (Sales Journal)
    INSERT INTO journals (
        code,
        name,
        name_ar,
        journal_type,
        sequence_prefix,
        is_active,
        org_id
    ) VALUES (
        'SALES',
        'Sales Journal',
        'قيد المبيعات',
        'sales',
        'SJ-',
        true,
        v_org_id
    )
    ON CONFLICT (org_id, code) DO UPDATE
    SET name = EXCLUDED.name,
        name_ar = EXCLUDED.name_ar,
        is_active = true
    RETURNING id INTO v_sales_id;
    
    RAISE NOTICE '  ✓ Created Sales Journal: %', v_sales_id;
    
    -- 3. قيد مشتريات (Purchase Journal)
    INSERT INTO journals (
        code,
        name,
        name_ar,
        journal_type,
        sequence_prefix,
        is_active,
        org_id
    ) VALUES (
        'PURCH',
        'Purchase Journal',
        'قيد المشتريات',
        'purchase',
        'PJ-',
        true,
        v_org_id
    )
    ON CONFLICT (org_id, code) DO UPDATE
    SET name = EXCLUDED.name,
        name_ar = EXCLUDED.name_ar,
        is_active = true
    RETURNING id INTO v_purch_id;
    
    RAISE NOTICE '  ✓ Created Purchase Journal: %', v_purch_id;
    
    -- 4. قيد بنك (Bank Journal)
    INSERT INTO journals (
        code,
        name,
        name_ar,
        journal_type,
        sequence_prefix,
        is_active,
        org_id
    ) VALUES (
        'BANK',
        'Bank Journal',
        'قيد البنك',
        'bank',
        'BJ-',
        true,
        v_org_id
    )
    ON CONFLICT (org_id, code) DO NOTHING;
    
    RAISE NOTICE '  ✓ Created Bank Journal';
    
    -- 5. قيد صندوق (Cash Journal)
    INSERT INTO journals (
        code,
        name,
        name_ar,
        journal_type,
        sequence_prefix,
        is_active,
        org_id
    ) VALUES (
        'CASH',
        'Cash Journal',
        'قيد الصندوق',
        'cash',
        'CJ-',
        true,
        v_org_id
    )
    ON CONFLICT (org_id, code) DO NOTHING;
    
    RAISE NOTICE '  ✓ Created Cash Journal';
    
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '✅ Default Journals Created Successfully!';
    RAISE NOTICE '========================================';
    
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE '❌ Error: %', SQLERRM;
END $$;

-- Verify and display
DO $$
DECLARE
    rec RECORD;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE 'Current Journals:';
    RAISE NOTICE '─────────────────────────────────────────';
    
    FOR rec IN 
        SELECT 
            code,
            name,
            name_ar,
            sequence_prefix,
            is_active
        FROM journals
        WHERE org_id = '00000000-0000-0000-0000-000000000001'
        ORDER BY code
    LOOP
        RAISE NOTICE '  % | % | % | % | Active: %', 
            rec.code,
            rec.name,
            rec.name_ar,
            rec.sequence_prefix,
            rec.is_active;
    END LOOP;
    
    RAISE NOTICE '─────────────────────────────────────────';
END $$;

