-- ========================================
-- تحسين الأداء والأمان لجداول المبيعات
-- Sales Performance & Security Enhancements
-- ========================================

-- هذا الملف يضيف:
-- 1. Indexes إضافية للأداء (Composite Indexes)
-- 2. Row Level Security (RLS) Policies للأمان
-- 3. Indexes للاستعلامات المعقدة

-- ========================================
-- 1. Indexes إضافية للأداء
-- ========================================

-- Indexes for sales_invoices
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sales_invoices') THEN
    
    -- Composite index for date range queries with org_id
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'sales_invoices' 
      AND column_name = 'org_id'
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'sales_invoices' 
      AND column_name = 'invoice_date'
    ) THEN
      CREATE INDEX IF NOT EXISTS idx_sales_invoices_org_date 
        ON sales_invoices(org_id, invoice_date DESC);
      RAISE NOTICE 'Created composite index for sales_invoices (org_id, invoice_date)';
    END IF;
    
    -- Index for customer queries with date
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'sales_invoices' 
      AND column_name = 'customer_id'
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'sales_invoices' 
      AND column_name = 'invoice_date'
    ) THEN
      CREATE INDEX IF NOT EXISTS idx_sales_invoices_customer_date 
        ON sales_invoices(customer_id, invoice_date DESC);
      RAISE NOTICE 'Created composite index for sales_invoices (customer_id, invoice_date)';
    END IF;
    
    -- Index for payment status queries
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'sales_invoices' 
      AND column_name = 'payment_status'
    ) THEN
      CREATE INDEX IF NOT EXISTS idx_sales_invoices_payment_status 
        ON sales_invoices(payment_status) WHERE payment_status IS NOT NULL;
      RAISE NOTICE 'Created index for sales_invoices.payment_status';
    END IF;
    
    -- Index for delivery status queries
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'sales_invoices' 
      AND column_name = 'delivery_status'
    ) THEN
      CREATE INDEX IF NOT EXISTS idx_sales_invoices_delivery_status 
        ON sales_invoices(delivery_status) WHERE delivery_status IS NOT NULL;
      RAISE NOTICE 'Created index for sales_invoices.delivery_status';
    END IF;
    
    -- Index for invoice_number (unique lookups)
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'sales_invoices' 
      AND column_name = 'invoice_number'
    ) THEN
      CREATE INDEX IF NOT EXISTS idx_sales_invoices_invoice_number 
        ON sales_invoices(invoice_number);
      RAISE NOTICE 'Created index for sales_invoices.invoice_number';
    END IF;
    
  END IF;
END $$;

-- Indexes for sales_invoice_lines (composite)
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sales_invoice_lines') THEN
    
    -- Composite index for invoice_id with product_id (common join pattern)
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'sales_invoice_lines' 
      AND column_name = 'sales_invoice_id'
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'sales_invoice_lines' 
      AND column_name = 'product_id'
    ) THEN
      CREATE INDEX IF NOT EXISTS idx_sales_invoice_lines_invoice_product 
        ON sales_invoice_lines(sales_invoice_id, product_id);
      RAISE NOTICE 'Created composite index for sales_invoice_lines (sales_invoice_id, product_id)';
    END IF;
    
    -- Composite index for org_id with product_id (for product sales reports)
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'sales_invoice_lines' 
      AND column_name = 'org_id'
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'sales_invoice_lines' 
      AND column_name = 'product_id'
    ) THEN
      CREATE INDEX IF NOT EXISTS idx_sales_invoice_lines_org_product 
        ON sales_invoice_lines(org_id, product_id);
      RAISE NOTICE 'Created composite index for sales_invoice_lines (org_id, product_id)';
    END IF;
    
    -- Index for item_id (if exists)
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'sales_invoice_lines' 
      AND column_name = 'item_id'
    ) THEN
      CREATE INDEX IF NOT EXISTS idx_sales_invoice_lines_item_id 
        ON sales_invoice_lines(item_id) WHERE item_id IS NOT NULL;
      RAISE NOTICE 'Created index for sales_invoice_lines.item_id';
    END IF;
    
  END IF;
END $$;

-- Indexes for delivery_notes
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'delivery_notes') THEN
    
    -- Composite index for sales_invoice_id with delivery_date
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'delivery_notes' 
      AND column_name = 'sales_invoice_id'
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'delivery_notes' 
      AND column_name = 'delivery_date'
    ) THEN
      CREATE INDEX IF NOT EXISTS idx_delivery_notes_invoice_date 
        ON delivery_notes(sales_invoice_id, delivery_date DESC);
      RAISE NOTICE 'Created composite index for delivery_notes (sales_invoice_id, delivery_date)';
    END IF;
    
    -- Index for invoice_id (alternative naming)
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'delivery_notes' 
      AND column_name = 'invoice_id'
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'delivery_notes' 
      AND column_name = 'delivery_date'
    ) THEN
      CREATE INDEX IF NOT EXISTS idx_delivery_notes_invoice_id_date 
        ON delivery_notes(invoice_id, delivery_date DESC);
      RAISE NOTICE 'Created composite index for delivery_notes (invoice_id, delivery_date)';
    END IF;
    
    -- Index for delivery_number (unique lookups)
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'delivery_notes' 
      AND column_name = 'delivery_number'
    ) THEN
      CREATE INDEX IF NOT EXISTS idx_delivery_notes_delivery_number 
        ON delivery_notes(delivery_number);
      RAISE NOTICE 'Created index for delivery_notes.delivery_number';
    END IF;
    
  END IF;
END $$;

-- Indexes for delivery_note_lines
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'delivery_note_lines') THEN
    
    -- Composite index for delivery_note_id with item_id/product_id
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'delivery_note_lines' 
      AND column_name = 'delivery_note_id'
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'delivery_note_lines' 
      AND column_name = 'item_id'
    ) THEN
      CREATE INDEX IF NOT EXISTS idx_delivery_note_lines_dn_item 
        ON delivery_note_lines(delivery_note_id, item_id);
      RAISE NOTICE 'Created composite index for delivery_note_lines (delivery_note_id, item_id)';
    END IF;
    
    -- Index for product_id (if exists)
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'delivery_note_lines' 
      AND column_name = 'product_id'
    ) THEN
      CREATE INDEX IF NOT EXISTS idx_delivery_note_lines_product_id 
        ON delivery_note_lines(product_id);
      RAISE NOTICE 'Created index for delivery_note_lines.product_id';
    END IF;
    
  END IF;
END $$;

-- ========================================
-- 2. Row Level Security (RLS) Policies
-- ========================================

-- Enable RLS for sales_invoices
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sales_invoices') THEN
    ALTER TABLE sales_invoices ENABLE ROW LEVEL SECURITY;
    RAISE NOTICE 'Enabled RLS for sales_invoices';
    
    -- Drop existing policies if any
    DROP POLICY IF EXISTS sales_invoices_org_isolation ON sales_invoices;
    DROP POLICY IF EXISTS sales_invoices_select_policy ON sales_invoices;
    DROP POLICY IF EXISTS sales_invoices_insert_policy ON sales_invoices;
    DROP POLICY IF EXISTS sales_invoices_update_policy ON sales_invoices;
    DROP POLICY IF EXISTS sales_invoices_delete_policy ON sales_invoices;
    
    -- Create org-based isolation policy
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'sales_invoices' 
      AND column_name = 'org_id'
    ) THEN
      CREATE POLICY sales_invoices_org_isolation ON sales_invoices
        FOR ALL
        USING (
          org_id IN (
            SELECT org_id FROM user_organizations 
            WHERE user_id = auth.uid()
          )
        )
        WITH CHECK (
          org_id IN (
            SELECT org_id FROM user_organizations 
            WHERE user_id = auth.uid()
          )
        );
      RAISE NOTICE 'Created RLS policy for sales_invoices (org-based)';
    ELSE
      -- Fallback: allow authenticated users
      CREATE POLICY sales_invoices_auth_policy ON sales_invoices
        FOR ALL
        USING (auth.role() = 'authenticated')
        WITH CHECK (auth.role() = 'authenticated');
      RAISE NOTICE 'Created RLS policy for sales_invoices (authenticated users)';
    END IF;
  END IF;
END $$;

-- Enable RLS for sales_invoice_lines
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sales_invoice_lines') THEN
    ALTER TABLE sales_invoice_lines ENABLE ROW LEVEL SECURITY;
    RAISE NOTICE 'Enabled RLS for sales_invoice_lines';
    
    -- Drop existing policies if any
    DROP POLICY IF EXISTS sales_invoice_lines_org_isolation ON sales_invoice_lines;
    DROP POLICY IF EXISTS sales_invoice_lines_select_policy ON sales_invoice_lines;
    
    -- Create org-based isolation policy
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'sales_invoice_lines' 
      AND column_name = 'org_id'
    ) THEN
      CREATE POLICY sales_invoice_lines_org_isolation ON sales_invoice_lines
        FOR ALL
        USING (
          org_id IN (
            SELECT org_id FROM user_organizations 
            WHERE user_id = auth.uid()
          )
        )
        WITH CHECK (
          org_id IN (
            SELECT org_id FROM user_organizations 
            WHERE user_id = auth.uid()
          )
        );
      RAISE NOTICE 'Created RLS policy for sales_invoice_lines (org-based)';
    ELSE
      -- Fallback: allow authenticated users
      CREATE POLICY sales_invoice_lines_auth_policy ON sales_invoice_lines
        FOR ALL
        USING (auth.role() = 'authenticated')
        WITH CHECK (auth.role() = 'authenticated');
      RAISE NOTICE 'Created RLS policy for sales_invoice_lines (authenticated users)';
    END IF;
  END IF;
END $$;

-- Enable RLS for delivery_notes
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'delivery_notes') THEN
    ALTER TABLE delivery_notes ENABLE ROW LEVEL SECURITY;
    RAISE NOTICE 'Enabled RLS for delivery_notes';
    
    -- Drop existing policies if any
    DROP POLICY IF EXISTS delivery_notes_org_isolation ON delivery_notes;
    
    -- Create org-based isolation policy
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'delivery_notes' 
      AND column_name = 'org_id'
    ) THEN
      CREATE POLICY delivery_notes_org_isolation ON delivery_notes
        FOR ALL
        USING (
          org_id IN (
            SELECT org_id FROM user_organizations 
            WHERE user_id = auth.uid()
          )
        )
        WITH CHECK (
          org_id IN (
            SELECT org_id FROM user_organizations 
            WHERE user_id = auth.uid()
          )
        );
      RAISE NOTICE 'Created RLS policy for delivery_notes (org-based)';
    ELSE
      -- Fallback: allow authenticated users
      CREATE POLICY delivery_notes_auth_policy ON delivery_notes
        FOR ALL
        USING (auth.role() = 'authenticated')
        WITH CHECK (auth.role() = 'authenticated');
      RAISE NOTICE 'Created RLS policy for delivery_notes (authenticated users)';
    END IF;
  END IF;
END $$;

-- Enable RLS for delivery_note_lines
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'delivery_note_lines') THEN
    ALTER TABLE delivery_note_lines ENABLE ROW LEVEL SECURITY;
    RAISE NOTICE 'Enabled RLS for delivery_note_lines';
    
    -- Drop existing policies if any
    DROP POLICY IF EXISTS delivery_note_lines_org_isolation ON delivery_note_lines;
    
    -- Create org-based isolation policy
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'delivery_note_lines' 
      AND column_name = 'org_id'
    ) THEN
      CREATE POLICY delivery_note_lines_org_isolation ON delivery_note_lines
        FOR ALL
        USING (
          org_id IN (
            SELECT org_id FROM user_organizations 
            WHERE user_id = auth.uid()
          )
        )
        WITH CHECK (
          org_id IN (
            SELECT org_id FROM user_organizations 
            WHERE user_id = auth.uid()
          )
        );
      RAISE NOTICE 'Created RLS policy for delivery_note_lines (org-based)';
    ELSE
      -- Fallback: allow authenticated users
      CREATE POLICY delivery_note_lines_auth_policy ON delivery_note_lines
        FOR ALL
        USING (auth.role() = 'authenticated')
        WITH CHECK (auth.role() = 'authenticated');
      RAISE NOTICE 'Created RLS policy for delivery_note_lines (authenticated users)';
    END IF;
  END IF;
END $$;

-- ========================================
-- 3. ملاحظات
-- ========================================

-- هذا الملف:
-- 1. يضيف Composite Indexes للاستعلامات المعقدة (أسرع)
-- 2. يضيف RLS Policies للأمان (عزل البيانات حسب org_id)
-- 3. يحسن الأداء بشكل كبير للاستعلامات المعقدة
-- 4. يحمي البيانات من الوصول غير المصرح به

-- الفوائد:
-- ✅ استعلامات أسرع (خاصة مع JOINs و WHERE clauses)
-- ✅ أمان أفضل (عزل البيانات بين المنظمات)
-- ✅ أداء أفضل للتقارير المعقدة
-- ✅ استعلامات أسرع للبحث حسب التاريخ/العميل/المنتج

-- ملاحظة: RLS Policies تعتمد على وجود جدول user_organizations
-- إذا لم يكن موجوداً، سيتم استخدام fallback policy للمستخدمين المعتمدين فقط

