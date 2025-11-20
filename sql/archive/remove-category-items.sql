-- ============================================
-- Remove Category Items from Products Table
-- ERPNext-inspired: Category items should not be in products table
-- ============================================

-- Step 1: Display category items that will be deleted
SELECT 
    'Category items to be deleted:' as info,
    id,
    code,
    name,
    name_ar,
    category_id
FROM products
WHERE code IN ('FG-001', 'RM-001')
   OR name LIKE '%All /%'
ORDER BY code;

-- Step 2: OPTION A - Delete permanently (Recommended)
-- DELETE FROM products
-- WHERE code IN ('FG-001', 'RM-001')
--    OR name LIKE '%All /%';

-- Step 3: OPTION B - Add is_group flag (ERPNext pattern, more flexible)
-- This allows keeping category items but marking them as groups

-- Add is_group column if not exists
-- ALTER TABLE products 
-- ADD COLUMN IF NOT EXISTS is_group BOOLEAN DEFAULT FALSE;

-- Mark category items as groups
-- UPDATE products
-- SET is_group = TRUE
-- WHERE code IN ('FG-001', 'RM-001')
--    OR name LIKE '%All /%';

-- Step 4: OPTION C - Move to separate table (Best for large systems)
-- CREATE TABLE IF NOT EXISTS product_groups (
--     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
--     org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
--     code VARCHAR(50) NOT NULL UNIQUE,
--     name VARCHAR(255) NOT NULL,
--     name_ar VARCHAR(255),
--     category_id UUID REFERENCES categories(id),
--     product_count INTEGER DEFAULT 0,
--     created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
--     updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
--     UNIQUE(org_id, code)
-- );

-- Verify after deletion
-- SELECT COUNT(*) as remaining_category_items
-- FROM products
-- WHERE code IN ('FG-001', 'RM-001')
--    OR name LIKE '%All /%';

-- Expected result: 0

-- ============================================
-- NOTES:
-- ============================================
-- 1. ERPNext separates "Item Groups" from "Items"
-- 2. Item Groups are hierarchical categories
-- 3. Items are actual purchasable/sellable products
-- 4. In Wardah, we currently mix them - need to separate
-- 5. For now, we exclude them by code in frontend
-- 6. Future: Move to proper Item Groups table
-- ============================================
