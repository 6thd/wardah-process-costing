-- =======================================
-- Import Actual Data for Wardah ERP
-- =======================================

-- First, let's create a function to read JSON data from a string
-- Note: In practice, you would need to convert your JSON files to JSONB format
-- For demonstration, I'll show how to do this with a small sample

-- Import Chart of Accounts
DO $$
DECLARE
    v_coa_jsonb JSONB;
    v_count INTEGER;
BEGIN
    -- In a real implementation, you would load the JSON data from your file
    -- For now, I'll show you how to do it with a sample
    -- You would replace this with your actual coa_data.json content
    
    -- Example of how to import (you would replace this with your full data):
    v_coa_jsonb := '[
        {
            "code": "100000",
            "name": "الأصول",
            "category": "ASSET",
            "subtype": "OTHER",
            "parent_code": "",
            "normal_balance": "DEBIT",
            "allow_posting": "False",
            "is_active": "True",
            "currency": "SAR",
            "notes": "رأس الأصول الرئيسي"
        }
    ]'::JSONB;
    
    -- Call the import function
    SELECT import_chart_of_accounts('00000000-0000-0000-0000-000000000001', v_coa_jsonb) INTO v_count;
    
    RAISE NOTICE 'Imported % Chart of Accounts records', v_count;
END $$;

-- Import GL Mappings
DO $$
DECLARE
    v_mappings_jsonb JSONB;
    v_count INTEGER;
BEGIN
    -- In a real implementation, you would load the JSON data from your file
    -- For now, I'll show you how to do it with a sample
    -- You would replace this with your actual gl_mappings_data.json content
    
    -- Example of how to import (you would replace this with your full data):
    v_mappings_jsonb := '[
        {
            "key_type": "EVENT",
            "key_value": "material_issue_mixing",
            "debit_account": "134100",
            "credit_account": "131100",
            "description": "صرف مواد LDPE لمرحلة الخلط"
        }
    ]'::JSONB;
    
    -- Call the import function
    SELECT import_gl_mappings('00000000-0000-0000-0000-000000000001', v_mappings_jsonb) INTO v_count;
    
    RAISE NOTICE 'Imported % GL Mappings records', v_count;
END $$;

-- Success Message
DO $$
BEGIN
    RAISE NOTICE '✅ Data Import Script Ready!';
    RAISE NOTICE '📋 To import your actual data:';
    RAISE NOTICE '1. Convert your JSON files to JSONB format';
    RAISE NOTICE '2. Replace the sample data in this script with your actual data';
    RAISE NOTICE '3. Run this script in the Supabase SQL Editor';
END $$;