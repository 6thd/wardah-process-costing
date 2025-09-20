-- =======================================
-- Import Chart of Accounts
-- =======================================

-- Function to import chart of accounts from CSV data
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

-- Sample usage:
/*
SELECT import_chart_of_accounts(
    '00000000-0000-0000-0000-000000000001',
    '[
        {
            "code": "100000",
            "name": "الأصول",
            "category": "ASSET",
            "subtype": "OTHER",
            "parent_code": null,
            "normal_balance": "DEBIT",
            "allow_posting": false,
            "is_active": true,
            "currency": "SAR",
            "notes": "رأس الأصول الرئيسي"
        }
    ]'::JSONB
);
*/