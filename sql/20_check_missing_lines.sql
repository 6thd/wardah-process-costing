-- فحص القيود التي ليس لها بنود في gl_entry_lines
-- Check entries that have no lines in gl_entry_lines

DO $$
DECLARE
    entry_record RECORD;
    lines_count INTEGER;
BEGIN
    RAISE NOTICE '🔍 فحص القيود بدون بنود / Checking entries without lines...';
    RAISE NOTICE '================================================';
    
    -- Get all entries from gl_entries
    FOR entry_record IN 
        SELECT 
            id,
            entry_number,
            entry_date,
            description,
            total_debit,
            total_credit,
            status
        FROM gl_entries
        WHERE org_id = '00000000-0000-0000-0000-000000000001'
        ORDER BY entry_date DESC, entry_number DESC
        LIMIT 20
    LOOP
        -- Count lines for this entry
        SELECT COUNT(*) INTO lines_count
        FROM gl_entry_lines
        WHERE entry_id = entry_record.id;
        
        IF lines_count = 0 THEN
            RAISE NOTICE '⚠️ القيد % (%) - التاريخ: % - المجموع: % - البنود: %',
                entry_record.entry_number,
                entry_record.description,
                entry_record.entry_date,
                entry_record.total_debit,
                lines_count;
        ELSE
            RAISE NOTICE '✅ القيد % - البنود: %',
                entry_record.entry_number,
                lines_count;
        END IF;
    END LOOP;
    
    RAISE NOTICE '================================================';
    RAISE NOTICE '✅ انتهى الفحص / Check completed';
END $$;

-- عرض إجمالي القيود والبنود
SELECT 
    'إجمالي القيود / Total Entries' as metric,
    COUNT(*) as count
FROM gl_entries
WHERE org_id = '00000000-0000-0000-0000-000000000001'

UNION ALL

SELECT 
    'إجمالي البنود / Total Lines' as metric,
    COUNT(*) as count
FROM gl_entry_lines
WHERE org_id = '00000000-0000-0000-0000-000000000001'

UNION ALL

SELECT 
    'قيود بدون بنود / Entries without lines' as metric,
    COUNT(DISTINCT ge.id) as count
FROM gl_entries ge
LEFT JOIN gl_entry_lines gel ON ge.id = gel.entry_id
WHERE ge.org_id = '00000000-0000-0000-0000-000000000001'
AND gel.id IS NULL;

