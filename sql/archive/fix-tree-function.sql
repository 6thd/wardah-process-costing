-- تحديث الدالة فقط
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

SELECT 'تم تحديث الدالة بنجاح' as status;
