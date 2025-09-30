-- =======================================
-- Wardah ERP - Setup Import Functions Only
-- For existing databases with tables already created
-- =======================================

-- Setting up import functions for existing database...

-- 1. Create import functions (these can be safely recreated)
-- Creating import functions...

-- Import the functions directly instead of using \ir
-- Function to import chart of accounts from JSON data
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

-- Function to import GL mappings from JSON data
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

-- Import functions setup complete!
-- Next steps:
-- 1. Run import-coa-generated.sql to import chart of accounts
-- 2. Run import-mappings-generated.sql to import GL mappings