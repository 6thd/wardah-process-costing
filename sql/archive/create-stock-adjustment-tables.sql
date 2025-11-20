-- ==============================================================================
-- Stock Adjustments System - Database Schema
-- Following International Accounting Best Practices (ERPNext, SAP, Oracle)
-- ==============================================================================

-- Drop existing tables if needed (in correct order due to foreign keys)
DROP TABLE IF EXISTS physical_count_items CASCADE;
DROP TABLE IF EXISTS physical_count_sessions CASCADE;
DROP TABLE IF EXISTS stock_adjustment_items CASCADE;
DROP TABLE IF EXISTS stock_adjustments CASCADE;

-- ==============================================================================
-- 1. Stock Adjustments (Header Table)
-- ==============================================================================
CREATE TABLE stock_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Document Details
  adjustment_number VARCHAR(50) UNIQUE NOT NULL,
  adjustment_date DATE NOT NULL,
  posting_date DATE NOT NULL DEFAULT CURRENT_DATE,
  
  -- Adjustment Type
  adjustment_type VARCHAR(50) NOT NULL CHECK (adjustment_type IN (
    'PHYSICAL_COUNT',    -- جرد فعلي
    'DAMAGE',            -- تالف
    'THEFT',             -- فقد/سرقة
    'EXPIRY',            -- منتهي الصلاحية
    'QUALITY_ISSUE',     -- مشكلة جودة
    'REVALUATION',       -- إعادة تقييم
    'OTHER'              -- أخرى
  )),
  
  -- Reference and Reason
  reason TEXT NOT NULL,
  reference_number VARCHAR(100),
  
  -- Warehouse (optional - can be multi-warehouse adjustment)
  warehouse_id UUID REFERENCES warehouses(id),
  
  -- Status Workflow
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
    'DRAFT',      -- مسودة
    'SUBMITTED',  -- مرحل
    'CANCELLED'   -- ملغي
  )),
  
  -- Accounting Integration
  journal_entry_id UUID REFERENCES journal_entries(id),
  reversal_journal_entry_id UUID REFERENCES journal_entries(id),
  
  -- Approval Workflow (for high-value adjustments)
  requires_approval BOOLEAN DEFAULT FALSE,
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMP WITH TIME ZONE,
  approval_notes TEXT,
  
  -- Physical Count Reference
  physical_count_session_id UUID,
  
  -- Totals (calculated)
  total_items INTEGER NOT NULL DEFAULT 0,
  total_qty_difference DECIMAL(15,4) DEFAULT 0,
  total_value_difference DECIMAL(15,2) DEFAULT 0,
  
  -- Audit Trail
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMP WITH TIME ZONE,
  submitted_by UUID REFERENCES auth.users(id),
  submitted_at TIMESTAMP WITH TIME ZONE,
  cancelled_by UUID REFERENCES auth.users(id),
  cancelled_at TIMESTAMP WITH TIME ZONE,
  cancellation_reason TEXT,
  
  -- Indexes
  CONSTRAINT stock_adjustments_org_check FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

-- Indexes for performance
CREATE INDEX idx_stock_adjustments_org ON stock_adjustments(organization_id);
CREATE INDEX idx_stock_adjustments_date ON stock_adjustments(adjustment_date);
CREATE INDEX idx_stock_adjustments_status ON stock_adjustments(status);
CREATE INDEX idx_stock_adjustments_type ON stock_adjustments(adjustment_type);
CREATE INDEX idx_stock_adjustments_number ON stock_adjustments(adjustment_number);

-- ==============================================================================
-- 2. Stock Adjustment Items (Line Items)
-- ==============================================================================
CREATE TABLE stock_adjustment_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  adjustment_id UUID NOT NULL REFERENCES stock_adjustments(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Product and Warehouse
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  warehouse_id UUID REFERENCES warehouses(id),
  
  -- Quantity Details
  current_qty DECIMAL(15,4) NOT NULL DEFAULT 0,  -- System quantity before adjustment
  new_qty DECIMAL(15,4) NOT NULL,                 -- Physical count or adjusted quantity
  difference_qty DECIMAL(15,4) NOT NULL,          -- new_qty - current_qty
  
  -- Valuation Details
  current_rate DECIMAL(15,4) NOT NULL DEFAULT 0,  -- Current cost per unit
  new_rate DECIMAL(15,4),                         -- New rate (for revaluation only)
  value_difference DECIMAL(15,2) NOT NULL,        -- Financial impact
  
  -- Item-level details
  reason TEXT,                                     -- Specific reason for this item
  serial_numbers TEXT[],                           -- If using serial number tracking
  batch_numbers TEXT[],                            -- If using batch tracking
  
  -- Audit
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  
  CONSTRAINT stock_adjustment_items_org_check FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

-- Indexes
CREATE INDEX idx_stock_adjustment_items_adjustment ON stock_adjustment_items(adjustment_id);
CREATE INDEX idx_stock_adjustment_items_product ON stock_adjustment_items(product_id);
CREATE INDEX idx_stock_adjustment_items_org ON stock_adjustment_items(organization_id);

-- ==============================================================================
-- 3. Physical Count Sessions (Inventory Counting Process)
-- ==============================================================================
CREATE TABLE physical_count_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Session Details
  session_number VARCHAR(50) UNIQUE NOT NULL,
  count_date DATE NOT NULL,
  warehouse_id UUID REFERENCES warehouses(id),
  
  -- Count Type
  count_type VARCHAR(30) NOT NULL CHECK (count_type IN (
    'FULL',           -- جرد كامل
    'CYCLE',          -- جرد دوري
    'SPOT',           -- جرد عشوائي
    'ABC_ANALYSIS'    -- جرد حسب تصنيف ABC
  )),
  
  -- Status
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN (
    'OPEN',       -- جاري العد
    'COMPLETED',  -- مكتمل
    'CANCELLED'   -- ملغي
  )),
  
  -- Count Team
  counter_user_ids UUID[] NOT NULL,  -- Users performing the count
  supervisor_id UUID REFERENCES auth.users(id),
  
  -- Results
  total_items_counted INTEGER DEFAULT 0,
  discrepancies_found INTEGER DEFAULT 0,
  adjustment_created BOOLEAN DEFAULT FALSE,
  adjustment_id UUID REFERENCES stock_adjustments(id),
  
  -- Notes
  notes TEXT,
  
  -- Audit
  created_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  
  CONSTRAINT physical_count_sessions_org_check FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

-- Indexes
CREATE INDEX idx_physical_count_sessions_org ON physical_count_sessions(organization_id);
CREATE INDEX idx_physical_count_sessions_date ON physical_count_sessions(count_date);
CREATE INDEX idx_physical_count_sessions_status ON physical_count_sessions(status);

-- ==============================================================================
-- 4. Physical Count Items (Individual Count Records)
-- ==============================================================================
CREATE TABLE physical_count_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES physical_count_sessions(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Product Details
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  warehouse_id UUID REFERENCES warehouses(id),
  
  -- Count Details
  system_qty DECIMAL(15,4) NOT NULL,      -- Quantity in system
  counted_qty DECIMAL(15,4),              -- Physically counted quantity
  difference_qty DECIMAL(15,4),           -- Discrepancy
  
  -- Count Status
  count_status VARCHAR(20) DEFAULT 'PENDING' CHECK (count_status IN (
    'PENDING',    -- لم يتم العد
    'COUNTED',    -- تم العد
    'RECOUNTED',  -- تم إعادة العد
    'VERIFIED'    -- تم التحقق
  )),
  
  -- Multiple Counts (for accuracy)
  first_count DECIMAL(15,4),
  second_count DECIMAL(15,4),
  third_count DECIMAL(15,4),
  
  -- Counter Information
  counted_by UUID REFERENCES auth.users(id),
  counted_at TIMESTAMP WITH TIME ZONE,
  verified_by UUID REFERENCES auth.users(id),
  verified_at TIMESTAMP WITH TIME ZONE,
  
  -- Notes
  notes TEXT,
  
  -- Audit
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE,
  
  CONSTRAINT physical_count_items_org_check FOREIGN KEY (organization_id) REFERENCES organizations(id)
);

-- Indexes
CREATE INDEX idx_physical_count_items_session ON physical_count_items(session_id);
CREATE INDEX idx_physical_count_items_product ON physical_count_items(product_id);
CREATE INDEX idx_physical_count_items_org ON physical_count_items(organization_id);

-- ==============================================================================
-- 5. Triggers for Auto-Increment Numbers
-- ==============================================================================

-- Adjustment Number Generator
CREATE OR REPLACE FUNCTION generate_adjustment_number()
RETURNS TRIGGER AS $$
DECLARE
  next_num INTEGER;
BEGIN
  -- Get next number for this organization
  SELECT COALESCE(MAX(
    CAST(SUBSTRING(adjustment_number FROM 'ADJ-(\d+)') AS INTEGER)
  ), 0) + 1 
  INTO next_num
  FROM stock_adjustments
  WHERE organization_id = NEW.organization_id;
  
  -- Generate formatted number
  NEW.adjustment_number := 'ADJ-' || LPAD(next_num::TEXT, 6, '0');
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_generate_adjustment_number
  BEFORE INSERT ON stock_adjustments
  FOR EACH ROW
  WHEN (NEW.adjustment_number IS NULL)
  EXECUTE FUNCTION generate_adjustment_number();

-- Physical Count Session Number Generator
CREATE OR REPLACE FUNCTION generate_count_session_number()
RETURNS TRIGGER AS $$
DECLARE
  next_num INTEGER;
BEGIN
  SELECT COALESCE(MAX(
    CAST(SUBSTRING(session_number FROM 'CNT-(\d+)') AS INTEGER)
  ), 0) + 1 
  INTO next_num
  FROM physical_count_sessions
  WHERE organization_id = NEW.organization_id;
  
  NEW.session_number := 'CNT-' || LPAD(next_num::TEXT, 6, '0');
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_generate_count_session_number
  BEFORE INSERT ON physical_count_sessions
  FOR EACH ROW
  WHEN (NEW.session_number IS NULL)
  EXECUTE FUNCTION generate_count_session_number();

-- ==============================================================================
-- 6. Triggers for Totals Calculation
-- ==============================================================================

-- Update adjustment totals when items change
CREATE OR REPLACE FUNCTION update_adjustment_totals()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE stock_adjustments
  SET 
    total_items = (
      SELECT COUNT(*) 
      FROM stock_adjustment_items 
      WHERE adjustment_id = COALESCE(NEW.adjustment_id, OLD.adjustment_id)
    ),
    total_qty_difference = (
      SELECT COALESCE(SUM(difference_qty), 0)
      FROM stock_adjustment_items
      WHERE adjustment_id = COALESCE(NEW.adjustment_id, OLD.adjustment_id)
    ),
    total_value_difference = (
      SELECT COALESCE(SUM(value_difference), 0)
      FROM stock_adjustment_items
      WHERE adjustment_id = COALESCE(NEW.adjustment_id, OLD.adjustment_id)
    ),
    updated_at = NOW()
  WHERE id = COALESCE(NEW.adjustment_id, OLD.adjustment_id);
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_adjustment_totals
  AFTER INSERT OR UPDATE OR DELETE ON stock_adjustment_items
  FOR EACH ROW
  EXECUTE FUNCTION update_adjustment_totals();

-- ==============================================================================
-- 7. Approval Threshold Trigger
-- ==============================================================================

-- Automatically flag adjustments requiring approval
CREATE OR REPLACE FUNCTION check_approval_required()
RETURNS TRIGGER AS $$
BEGIN
  -- Require approval if absolute value difference > 10,000
  IF ABS(NEW.total_value_difference) > 10000 THEN
    NEW.requires_approval := TRUE;
  ELSE
    NEW.requires_approval := FALSE;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_approval_required
  BEFORE UPDATE OF total_value_difference ON stock_adjustments
  FOR EACH ROW
  EXECUTE FUNCTION check_approval_required();

-- ==============================================================================
-- 8. Row Level Security (RLS)
-- ==============================================================================

-- Enable RLS on all tables
ALTER TABLE stock_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_adjustment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE physical_count_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE physical_count_items ENABLE ROW LEVEL SECURITY;

-- Policies for stock_adjustments
CREATE POLICY "Users can view their organization's stock adjustments"
  ON stock_adjustments FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM user_organizations 
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create stock adjustments in their organization"
  ON stock_adjustments FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT organization_id FROM user_organizations 
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update draft stock adjustments"
  ON stock_adjustments FOR UPDATE
  USING (
    organization_id IN (
      SELECT organization_id FROM user_organizations 
      WHERE user_id = auth.uid()
    )
    AND status = 'DRAFT'
  );

-- Policies for stock_adjustment_items
CREATE POLICY "Users can view their organization's adjustment items"
  ON stock_adjustment_items FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM user_organizations 
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can manage adjustment items"
  ON stock_adjustment_items FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM user_organizations 
      WHERE user_id = auth.uid()
    )
  );

-- Policies for physical_count_sessions
CREATE POLICY "Users can view their organization's count sessions"
  ON physical_count_sessions FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM user_organizations 
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can manage count sessions"
  ON physical_count_sessions FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM user_organizations 
      WHERE user_id = auth.uid()
    )
  );

-- Policies for physical_count_items
CREATE POLICY "Users can view their organization's count items"
  ON physical_count_items FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM user_organizations 
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can manage count items"
  ON physical_count_items FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM user_organizations 
      WHERE user_id = auth.uid()
    )
  );

-- ==============================================================================
-- 9. Sample Data Comments
-- ==============================================================================

COMMENT ON TABLE stock_adjustments IS 'Stock adjustment headers - tracks inventory corrections following international accounting standards';
COMMENT ON TABLE stock_adjustment_items IS 'Stock adjustment line items - individual product adjustments';
COMMENT ON TABLE physical_count_sessions IS 'Physical inventory count sessions - organized counting events';
COMMENT ON TABLE physical_count_items IS 'Physical count details - actual count records per product';

COMMENT ON COLUMN stock_adjustments.adjustment_type IS 'Type: PHYSICAL_COUNT, DAMAGE, THEFT, EXPIRY, QUALITY_ISSUE, REVALUATION, OTHER';
COMMENT ON COLUMN stock_adjustments.requires_approval IS 'Automatically set to TRUE if ABS(total_value_difference) > 10,000';
COMMENT ON COLUMN stock_adjustment_items.difference_qty IS 'Positive = gain/increase, Negative = loss/decrease';
COMMENT ON COLUMN stock_adjustment_items.value_difference IS 'Financial impact: difference_qty × current_rate';

-- ==============================================================================
-- 10. Grant Permissions (adjust based on your role setup)
-- ==============================================================================

-- Grant to authenticated users (adjust as needed)
GRANT SELECT, INSERT, UPDATE ON stock_adjustments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON stock_adjustment_items TO authenticated;
GRANT SELECT, INSERT, UPDATE ON physical_count_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON physical_count_items TO authenticated;

-- ==============================================================================
-- Complete! Ready to use.
-- ==============================================================================

-- Usage Examples:
--
-- 1. Create a new adjustment:
--    INSERT INTO stock_adjustments (organization_id, adjustment_date, adjustment_type, reason, created_by)
--    VALUES ('org-uuid', '2024-01-15', 'PHYSICAL_COUNT', 'Annual inventory count', 'user-uuid');
--
-- 2. Add items to adjustment:
--    INSERT INTO stock_adjustment_items (adjustment_id, organization_id, product_id, current_qty, new_qty, difference_qty, current_rate, value_difference)
--    VALUES ('adj-uuid', 'org-uuid', 'prod-uuid', 100, 95, -5, 50.00, -250.00);
--
-- 3. Submit adjustment (in application code, this triggers stock ledger entries and journal entries)
--
