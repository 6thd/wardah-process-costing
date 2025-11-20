-- Add GL Account columns to stock_adjustments table
-- إضافة أعمدة حسابات شجرة الحسابات لجدول تسويات المخزون

-- Add increase_account_id column (for inventory increases)
ALTER TABLE stock_adjustments 
ADD COLUMN IF NOT EXISTS increase_account_id UUID REFERENCES gl_accounts(id);

-- Add decrease_account_id column (for inventory decreases)
ALTER TABLE stock_adjustments 
ADD COLUMN IF NOT EXISTS decrease_account_id UUID REFERENCES gl_accounts(id);

-- Add comments for documentation
COMMENT ON COLUMN stock_adjustments.increase_account_id IS 'حساب الزيادة في المخزون - Account for inventory increases (e.g., found items, corrections)';
COMMENT ON COLUMN stock_adjustments.decrease_account_id IS 'حساب النقص في المخزون - Account for inventory decreases (e.g., damage, theft, expiry)';

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_increase_account 
ON stock_adjustments(increase_account_id);

CREATE INDEX IF NOT EXISTS idx_stock_adjustments_decrease_account 
ON stock_adjustments(decrease_account_id);

-- Success message
SELECT 'GL Account columns added successfully to stock_adjustments table' AS status;
