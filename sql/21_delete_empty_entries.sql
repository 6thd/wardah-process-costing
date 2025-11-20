-- حذف القيود التي ليس لها بنود (القيود الفارغة)
-- Delete entries that have no lines (empty entries)

DO $$
DECLARE
    deleted_count INTEGER := 0;
    entry_record RECORD;
BEGIN
    RAISE NOTICE '🗑️ بدء حذف القيود الفارغة / Starting deletion of empty entries...';
    RAISE NOTICE '================================================';
    
    -- Find and delete entries without lines
    FOR entry_record IN 
        SELECT ge.id, ge.entry_number, ge.entry_date, ge.description
        FROM gl_entries ge
        LEFT JOIN gl_entry_lines gel ON ge.id = gel.entry_id
        WHERE ge.org_id = '00000000-0000-0000-0000-000000000001'
        AND gel.id IS NULL
        AND ge.status = 'draft' -- Only delete drafts, not posted entries
    LOOP
        -- Delete the entry
        DELETE FROM gl_entries WHERE id = entry_record.id;
        
        deleted_count := deleted_count + 1;
        
        RAISE NOTICE '🗑️ تم حذف القيد: % (%) - التاريخ: %',
            entry_record.entry_number,
            entry_record.description,
            entry_record.entry_date;
    END LOOP;
    
    RAISE NOTICE '================================================';
    RAISE NOTICE '✅ تم حذف % قيد فارغ / Deleted % empty entries', deleted_count, deleted_count;
    
    -- Show remaining entries
    RAISE NOTICE '';
    RAISE NOTICE '📊 الإحصائيات بعد الحذف / Statistics after deletion:';
    RAISE NOTICE '   - إجمالي القيود / Total Entries: %', (SELECT COUNT(*) FROM gl_entries WHERE org_id = '00000000-0000-0000-0000-000000000001');
    RAISE NOTICE '   - إجمالي البنود / Total Lines: %', (SELECT COUNT(*) FROM gl_entry_lines WHERE org_id = '00000000-0000-0000-0000-000000000001');
    RAISE NOTICE '   - قيود بدون بنود / Entries without lines: %', (
        SELECT COUNT(DISTINCT ge.id)
        FROM gl_entries ge
        LEFT JOIN gl_entry_lines gel ON ge.id = gel.entry_id
        WHERE ge.org_id = '00000000-0000-0000-0000-000000000001'
        AND gel.id IS NULL
    );
END $$;

-- عرض القيود المتبقية
SELECT 
    ge.entry_number,
    ge.entry_date,
    ge.description,
    COUNT(gel.id) as lines_count,
    ge.total_debit,
    ge.status
FROM gl_entries ge
LEFT JOIN gl_entry_lines gel ON ge.id = gel.entry_id
WHERE ge.org_id = '00000000-0000-0000-0000-000000000001'
GROUP BY ge.id, ge.entry_number, ge.entry_date, ge.description, ge.total_debit, ge.status
ORDER BY ge.entry_date DESC, ge.entry_number DESC;

