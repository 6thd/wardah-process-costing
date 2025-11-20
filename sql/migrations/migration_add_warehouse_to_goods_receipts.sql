-- =====================================================
-- Migration: Add warehouse_id to goods_receipts table
-- Date: 2025-11-08
-- Purpose: Link Goods Receipts to Warehouses for Stock Ledger System
-- =====================================================

-- Add warehouse_id column to goods_receipts table
ALTER TABLE goods_receipts 
ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES warehouses(id);

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_goods_receipts_warehouse 
    ON goods_receipts(warehouse_id);

-- Add comment
COMMENT ON COLUMN goods_receipts.warehouse_id IS 'Target warehouse for goods receipt (required for Stock Ledger System)';

-- Update existing records to use default warehouse (WH-001)
-- This ensures existing data remains valid
UPDATE goods_receipts
SET warehouse_id = (SELECT id FROM warehouses WHERE code = 'WH-001' LIMIT 1)
WHERE warehouse_id IS NULL;

-- Make warehouse_id NOT NULL after updating existing records
-- ALTER TABLE goods_receipts 
-- ALTER COLUMN warehouse_id SET NOT NULL;
-- Note: Commented out to allow NULL for now. Uncomment after testing.

-- Verification
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'goods_receipts' 
        AND column_name = 'warehouse_id'
    ) THEN
        RAISE NOTICE '✅ Migration successful: warehouse_id column added to goods_receipts';
    ELSE
        RAISE EXCEPTION '❌ Migration failed: warehouse_id column not found';
    END IF;
END $$;
