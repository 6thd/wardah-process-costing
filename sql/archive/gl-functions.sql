-- =======================================
-- دوال مساعدة للحسابات العامة
-- نسخة مبسطة للجداول الموجودة
-- =======================================

-- دالة: الحصول على تفاصيل الحساب
CREATE OR REPLACE FUNCTION get_account_details(
    p_org_id UUID,
    p_account_code VARCHAR(20)
)
RETURNS TABLE (
    account_id UUID,
    code VARCHAR(20),
    name VARCHAR(255),
    category VARCHAR(50),
    subtype VARCHAR(50),
    parent_code VARCHAR(20),
    normal_balance VARCHAR(10),
    allow_posting BOOLEAN
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        id,
        gl_accounts.code,
        gl_accounts.name,
        gl_accounts.category,
        gl_accounts.subtype,
        gl_accounts.parent_code,
        gl_accounts.normal_balance,
        gl_accounts.allow_posting
    FROM gl_accounts
    WHERE gl_accounts.org_id = p_org_id
    AND gl_accounts.code = p_account_code
    AND is_active = true;
END;
$$;

-- دالة: الحصول على خريطة الحدث
CREATE OR REPLACE FUNCTION get_gl_mapping(
    p_org_id UUID,
    p_event_key VARCHAR(100)
)
RETURNS TABLE (
    mapping_id UUID,
    debit_account VARCHAR(20),
    credit_account VARCHAR(20),
    description TEXT
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        id,
        debit_account_code,
        credit_account_code,
        gl_mappings.description
    FROM gl_mappings
    WHERE gl_mappings.org_id = p_org_id
    AND key_type = 'EVENT'
    AND key_value = p_event_key
    AND is_active = true
    LIMIT 1;
END;
$$;

-- دالة: الحصول على الحسابات الفرعية
CREATE OR REPLACE FUNCTION get_child_accounts(
    p_org_id UUID,
    p_parent_code VARCHAR(20)
)
RETURNS TABLE (
    account_id UUID,
    code VARCHAR(20),
    name VARCHAR(255),
    category VARCHAR(50),
    level INT
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    RETURN QUERY
    WITH RECURSIVE account_tree AS (
        -- المستوى الأول: الحسابات الفرعية المباشرة
        SELECT 
            id,
            gl_accounts.code,
            gl_accounts.name,
            gl_accounts.category,
            1 as level
        FROM gl_accounts
        WHERE gl_accounts.org_id = p_org_id
        AND parent_code = p_parent_code
        AND is_active = true
        
        UNION ALL
        
        -- المستويات التالية: الحسابات الفرعية للحسابات الفرعية
        SELECT 
            a.id,
            a.code,
            a.name,
            a.category,
            t.level + 1
        FROM gl_accounts a
        INNER JOIN account_tree t ON a.parent_code = t.code
        WHERE a.org_id = p_org_id
        AND a.is_active = true
    )
    SELECT * FROM account_tree
    ORDER BY level, code;
END;
$$;

-- دالة: التحقق من صحة الحساب للترحيل
CREATE OR REPLACE FUNCTION validate_posting_account(
    p_org_id UUID,
    p_account_code VARCHAR(20)
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_allow_posting BOOLEAN;
    v_is_active BOOLEAN;
BEGIN
    SELECT allow_posting, is_active
    INTO v_allow_posting, v_is_active
    FROM gl_accounts
    WHERE org_id = p_org_id
    AND code = p_account_code;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Account % not found', p_account_code;
    END IF;
    
    IF NOT v_is_active THEN
        RAISE EXCEPTION 'Account % is not active', p_account_code;
    END IF;
    
    IF NOT v_allow_posting THEN
        RAISE EXCEPTION 'Account % does not allow posting', p_account_code;
    END IF;
    
    RETURN true;
END;
$$;

-- دالة: الحصول على شجرة الحسابات الكاملة
CREATE OR REPLACE FUNCTION get_account_tree(
    p_org_id UUID,
    p_category VARCHAR(50) DEFAULT NULL
)
RETURNS TABLE (
    account_id UUID,
    code VARCHAR(20),
    name VARCHAR(255),
    category VARCHAR(50),
    parent_code VARCHAR(20),
    level INT,
    path TEXT
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    RETURN QUERY
    WITH RECURSIVE account_tree AS (
        -- المستوى الأول: الحسابات الرئيسية
        SELECT 
            gl_accounts.id,
            gl_accounts.code,
            gl_accounts.name,
            gl_accounts.category,
            gl_accounts.parent_code,
            1 as level,
            gl_accounts.code::TEXT as path
        FROM gl_accounts
        WHERE gl_accounts.org_id = p_org_id
        AND gl_accounts.parent_code IS NULL
        AND gl_accounts.is_active = true
        AND (p_category IS NULL OR gl_accounts.category = p_category)
        
        UNION ALL
        
        -- المستويات التالية
        SELECT 
            a.id,
            a.code,
            a.name,
            a.category,
            a.parent_code,
            t.level + 1,
            t.path || ' > ' || a.code
        FROM gl_accounts a
        INNER JOIN account_tree t ON a.parent_code = t.code
        WHERE a.org_id = p_org_id
        AND a.is_active = true
    )
    SELECT * FROM account_tree
    ORDER BY path;
END;
$$;

-- دالة: البحث في الحسابات
CREATE OR REPLACE FUNCTION search_accounts(
    p_org_id UUID,
    p_search_term VARCHAR(255)
)
RETURNS TABLE (
    account_id UUID,
    code VARCHAR(20),
    name VARCHAR(255),
    category VARCHAR(50),
    subtype VARCHAR(50)
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        id,
        gl_accounts.code,
        gl_accounts.name,
        gl_accounts.category,
        gl_accounts.subtype
    FROM gl_accounts
    WHERE gl_accounts.org_id = p_org_id
    AND is_active = true
    AND (
        LOWER(gl_accounts.code) LIKE LOWER('%' || p_search_term || '%')
        OR LOWER(gl_accounts.name) LIKE LOWER('%' || p_search_term || '%')
    )
    ORDER BY gl_accounts.code
    LIMIT 50;
END;
$$;

-- =======================================
-- Trigger: تحديث updated_at تلقائياً
-- =======================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- تطبيق Trigger على gl_accounts
DROP TRIGGER IF EXISTS update_gl_accounts_updated_at ON gl_accounts;
CREATE TRIGGER update_gl_accounts_updated_at
    BEFORE UPDATE ON gl_accounts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- تطبيق Trigger على gl_mappings
DROP TRIGGER IF EXISTS update_gl_mappings_updated_at ON gl_mappings;
CREATE TRIGGER update_gl_mappings_updated_at
    BEFORE UPDATE ON gl_mappings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =======================================
-- رسالة نجاح
-- =======================================

DO $$
BEGIN
    RAISE NOTICE '✅ تم تثبيت دوال الحسابات العامة بنجاح!';
    RAISE NOTICE '📊 الدوال المتاحة:';
    RAISE NOTICE '  - get_account_details(org_id, account_code)';
    RAISE NOTICE '  - get_gl_mapping(org_id, event_key)';
    RAISE NOTICE '  - get_child_accounts(org_id, parent_code)';
    RAISE NOTICE '  - validate_posting_account(org_id, account_code)';
    RAISE NOTICE '  - get_account_tree(org_id, category)';
    RAISE NOTICE '  - search_accounts(org_id, search_term)';
    RAISE NOTICE '🔄 Triggers للتحديث التلقائي مُفعّلة';
END $$;
