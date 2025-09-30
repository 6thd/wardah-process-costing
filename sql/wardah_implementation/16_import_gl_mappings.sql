-- =======================================
-- Import GL Mappings
-- =======================================

-- Function to import GL mappings from CSV data
CREATE OR REPLACE FUNCTION import_gl_mappings(
    p_org_id UUID,
    p_mappings_data JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_record JSONB;
    v_count INTEGER := 0;
BEGIN
    -- Process each record in the JSON array
    FOR v_record IN SELECT * FROM jsonb_array_elements(p_mappings_data)
    LOOP
        -- Insert or update GL mapping
        INSERT INTO gl_mappings (
            org_id,
            key_type,
            key_value,
            debit_account_code,
            credit_account_code,
            description,
            is_active
        ) VALUES (
            p_org_id,
            v_record->>'key_type',
            v_record->>'key_value',
            v_record->>'debit_account',
            v_record->>'credit_account',
            v_record->>'description',
            true
        )
        ON CONFLICT (org_id, key_type, key_value) 
        DO UPDATE SET
            debit_account_code = EXCLUDED.debit_account_code,
            credit_account_code = EXCLUDED.credit_account_code,
            description = EXCLUDED.description,
            is_active = EXCLUDED.is_active;
        
        v_count := v_count + 1;
    END LOOP;
    
    RAISE NOTICE 'Imported % GL mappings', v_count;
    RETURN v_count;
END;
$$;

-- Sample usage:
/*
SELECT import_gl_mappings(
    '00000000-0000-0000-0000-000000000001',
    '[
        {
            "key_type": "EVENT",
            "key_value": "material_issue_mixing",
            "debit_account": "134100",
            "credit_account": "131100",
            "description": "صرف مواد LDPE لمرحلة الخلط"
        }
    ]'::JSONB
);
*/