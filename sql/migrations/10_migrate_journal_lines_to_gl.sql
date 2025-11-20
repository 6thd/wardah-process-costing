-- Helper to ensure column exists
CREATE OR REPLACE FUNCTION ensure_column(
    p_table TEXT,
    p_column TEXT,
    p_type TEXT,
    p_default TEXT
) RETURNS VOID AS $$
DECLARE
    v_exists BOOLEAN;
    v_sql TEXT;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = p_table
          AND column_name = p_column
    ) INTO v_exists;

    IF NOT v_exists THEN
        v_sql := format(
            'ALTER TABLE %I ADD COLUMN %I %s',
            p_table, p_column, p_type
        );

    IF p_default IS NOT NULL THEN
        v_sql := v_sql || format(' DEFAULT %s', p_default);
        END IF;

        EXECUTE v_sql;
        RAISE NOTICE '✓ Added column % to %', p_column, p_table;
    END IF;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
    v_table_type TEXT;
    v_inserted BIGINT := 0;
BEGIN
    SELECT table_type INTO v_table_type
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'gl_entry_lines';

    IF v_table_type IS NULL THEN
        RAISE NOTICE '⚠ gl_entry_lines table not found. Migration skipped.';
        RETURN;
    ELSIF v_table_type <> 'BASE TABLE' THEN
        RAISE NOTICE '⚠ gl_entry_lines is %, cannot alter structure. Migration skipped.', v_table_type;
        RETURN;
    END IF;

    -- Ensure required columns exist
    PERFORM ensure_column('gl_entry_lines', 'account_id', 'UUID', NULL);
    PERFORM ensure_column('gl_entry_lines', 'account_code', 'TEXT', NULL);
    PERFORM ensure_column('gl_entry_lines', 'debit', 'NUMERIC(18,2)', '0');
    PERFORM ensure_column('gl_entry_lines', 'credit', 'NUMERIC(18,2)', '0');
    PERFORM ensure_column('gl_entry_lines', 'description', 'TEXT', NULL);
    PERFORM ensure_column('gl_entry_lines', 'line_number', 'INTEGER', NULL);
    PERFORM ensure_column('gl_entry_lines', 'currency_code', 'TEXT', NULL);
    PERFORM ensure_column('gl_entry_lines', 'org_id', 'UUID', '''00000000-0000-0000-0000-000000000001''::uuid');
    PERFORM ensure_column('gl_entry_lines', 'created_at', 'TIMESTAMPTZ', 'now()');
    PERFORM ensure_column('gl_entry_lines', 'updated_at', 'TIMESTAMPTZ', 'now()');
    
    -- إزالة قيد NOT NULL من account_code إذا كان موجوداً
    BEGIN
        ALTER TABLE gl_entry_lines ALTER COLUMN account_code DROP NOT NULL;
        RAISE NOTICE '✓ Removed NOT NULL constraint from account_code';
    EXCEPTION
        WHEN OTHERS THEN
            -- تجاهل الخطأ إذا كان القيد غير موجود
    END;
    
    -- إزالة قيد CHECK المؤقت للسماح بالترحيل
    BEGIN
        ALTER TABLE gl_entry_lines DROP CONSTRAINT IF EXISTS gl_entry_lines_debit_or_credit;
        RAISE NOTICE '✓ Temporarily removed CHECK constraint';
    EXCEPTION
        WHEN OTHERS THEN
            -- تجاهل الخطأ
    END;

    WITH moved AS (
        INSERT INTO gl_entry_lines (
            id,
            entry_id,
            account_id,
            debit,
            credit,
            description,
            line_number,
            currency_code,
            org_id,
            created_at,
            updated_at
        )
        SELECT jl.id,
               jl.entry_id,
               jl.account_id,
               jl.debit,
               jl.credit,
               jl.description,
               jl.line_number,
               COALESCE(jl.currency_code, 'SAR'::text),
               COALESCE(jl.org_id, '00000000-0000-0000-0000-000000000001'::uuid),
               COALESCE(jl.created_at, now()),
               now() -- use current timestamp for updated_at
        FROM journal_lines jl
        LEFT JOIN gl_entry_lines gl ON gl.id = jl.id
        -- تأكد من وجود entry_id في gl_entries (تجنب البيانات اليتيمة)
        INNER JOIN gl_entries ge ON jl.entry_id = ge.id
        WHERE gl.id IS NULL
          AND jl.entry_id IS NOT NULL
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_inserted FROM moved;

    RAISE NOTICE '✓ Inserted % rows from journal_lines into gl_entry_lines', v_inserted;

    -- تحديث account_code
    UPDATE gl_entry_lines el
    SET account_code = ga.code
    FROM gl_accounts ga
    WHERE el.account_code IS NULL
      AND el.account_id = ga.id;
    RAISE NOTICE '✓ Backfilled account_code where possible';
    
    -- إعادة إنشاء قيد CHECK (اختياري - سيمنع البيانات الخاطئة مستقبلاً)
    BEGIN
        ALTER TABLE gl_entry_lines 
        ADD CONSTRAINT gl_entry_lines_debit_or_credit 
        CHECK (debit > 0 OR credit > 0);
        RAISE NOTICE '✓ Re-added CHECK constraint for data integrity';
    EXCEPTION
        WHEN OTHERS THEN
            RAISE NOTICE '⚠ Could not re-add CHECK constraint (data may have zeros)';
    END;
END $$;

