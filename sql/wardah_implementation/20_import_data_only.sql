-- Wardah ERP - Import Data Only
-- For existing databases with tables and functions already created

-- Create a default organization if it doesn't exist
INSERT INTO organizations (id, name, code)
VALUES ('00000000-0000-0000-0000-000000000001', 'Wardah Factory', 'WARD')
ON CONFLICT (id) DO NOTHING;

-- Create a default user organization mapping if it doesn't exist
-- Note: You'll need to replace 'YOUR_USER_ID' with your actual Supabase user ID
-- Uncomment and modify the following lines with your actual user ID:
-- INSERT INTO user_organizations (user_id, org_id, role)
-- VALUES ('YOUR_USER_ID', '00000000-0000-0000-0000-000000000001', 'admin')
-- ON CONFLICT (user_id, org_id) DO NOTHING;

-- Ensure import functions exist
CREATE OR REPLACE FUNCTION import_chart_of_accounts(
    p_org_id UUID,
    p_coa_data JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_record JSONB;
    v_count INTEGER := 0;
BEGIN
    -- Process each record in the JSON array
    FOR v_record IN SELECT * FROM jsonb_array_elements(p_coa_data)
    LOOP
        -- Insert or update GL account
        INSERT INTO gl_accounts (
            org_id,
            code,
            name,
            category,
            subtype,
            parent_code,
            normal_balance,
            allow_posting,
            is_active,
            currency,
            notes
        ) VALUES (
            p_org_id,
            v_record->>'code',
            v_record->>'name',
            v_record->>'category',
            v_record->>'subtype',
            v_record->>'parent_code',
            v_record->>'normal_balance',
            (v_record->>'allow_posting')::BOOLEAN,
            (v_record->>'is_active')::BOOLEAN,
            v_record->>'currency',
            v_record->>'notes'
        )
        ON CONFLICT (org_id, code) 
        DO UPDATE SET
            name = EXCLUDED.name,
            category = EXCLUDED.category,
            subtype = EXCLUDED.subtype,
            parent_code = EXCLUDED.parent_code,
            normal_balance = EXCLUDED.normal_balance,
            allow_posting = EXCLUDED.allow_posting,
            is_active = EXCLUDED.is_active,
            currency = EXCLUDED.currency,
            notes = EXCLUDED.notes,
            updated_at = NOW();
        
        v_count := v_count + 1;
    END LOOP;
    
    RAISE NOTICE 'Imported % GL accounts', v_count;
    RETURN v_count;
END;
$$;

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

-- Import the chart of accounts data
-- Note: You'll need to copy the SELECT statement from import-coa-generated.sql here
-- Or run import-coa-generated.sql separately

-- Import the GL mappings data
-- Note: You'll need to copy the SELECT statement from import-mappings-generated.sql here
-- Or run import-mappings-generated.sql separately