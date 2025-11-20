-- Fix RLS policies for stock_adjustments table
-- إصلاح سياسات Row Level Security لجدول تسويات المخزون

-- Drop existing policy if exists
DROP POLICY IF EXISTS stock_adjustments_org_policy ON stock_adjustments;

-- Create comprehensive RLS policy for all operations (SELECT, INSERT, UPDATE, DELETE)
CREATE POLICY stock_adjustments_org_policy ON stock_adjustments
  FOR ALL
  USING (
    organization_id IN (
      SELECT org_id FROM user_organizations 
      WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT org_id FROM user_organizations 
      WHERE user_id = auth.uid()
    )
  );

-- Also fix stock_adjustment_items policy
DROP POLICY IF EXISTS stock_adjustment_items_org_policy ON stock_adjustment_items;

CREATE POLICY stock_adjustment_items_org_policy ON stock_adjustment_items
  FOR ALL
  USING (
    organization_id IN (
      SELECT org_id FROM user_organizations 
      WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT org_id FROM user_organizations 
      WHERE user_id = auth.uid()
    )
  );

-- Success message
SELECT 'RLS policies fixed successfully for stock_adjustments and stock_adjustment_items' AS status;
