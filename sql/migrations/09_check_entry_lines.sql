-- ============================================================================
-- Diagnose entry lines vs. journal_lines/gl_entry_lines
-- ============================================================================
-- Usage:
--   1. Replace :entry_number with the actual entry number (e.g. 'JE-2025-11-0009')
--   2. Run the script in Supabase SQL editor
-- ============================================================================

DO $$
DECLARE
    v_entry_id UUID;
BEGIN
    -- Step 1: find entry id
    SELECT id INTO v_entry_id
    FROM gl_entries
    WHERE entry_number = 'JE-2025-11-0009';

    IF v_entry_id IS NULL THEN
        RAISE NOTICE 'Entry not found in gl_entries';
        RETURN;
    END IF;

    RAISE NOTICE 'Entry ID: %', v_entry_id;

    -- Step 2: show lines from gl_entry_lines
    RAISE NOTICE '';
    RAISE NOTICE '== gl_entry_lines ==';
    FOR SELECT line_number, account_id, debit, credit, org_id
        FROM gl_entry_lines
        WHERE entry_id = v_entry_id
        ORDER BY line_number
    LOOP
        -- results visible in Data output
    END LOOP;

END $$;

-- Step 3: raw select for download
SELECT 
    e.entry_number,
    l.line_number,
    l.account_id,
    l.debit,
    l.credit,
    l.org_id,
    ga.code AS account_code,
    ga.name AS account_name,
    ga.name_ar
FROM gl_entries e
JOIN gl_entry_lines l ON l.entry_id = e.id
LEFT JOIN gl_accounts ga ON ga.id = l.account_id
WHERE e.entry_number = 'JE-2025-11-0009'
ORDER BY l.line_number;

