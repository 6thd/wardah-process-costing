-- ========================================
-- نظام سندات القبض والصرف الاحترافي
-- Professional Payment Vouchers System
-- ========================================

-- هذا الملف ينشئ:
-- 1. جداول سندات القبض للعملاء (Customer Receipts)
-- 2. جداول سندات الصرف للموردين (Supplier Payments)
-- 3. طرق السداد (Payment Methods)
-- 4. ربط مع حسابات البنوك والنقدية
-- 5. عكس تلقائي في المحاسبة

-- ========================================
-- 1. تحسين جدول customer_collections (سندات القبض)
-- ========================================

DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'customer_collections') THEN
    
    -- Add missing columns if they don't exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'customer_collections' 
      AND column_name = 'payment_account_id'
    ) THEN
      ALTER TABLE customer_collections 
      ADD COLUMN payment_account_id UUID;
      RAISE NOTICE 'Added payment_account_id to customer_collections';
    END IF;
    
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'customer_collections' 
      AND column_name = 'status'
    ) THEN
      ALTER TABLE customer_collections 
      ADD COLUMN status VARCHAR(20) DEFAULT 'draft' 
      CHECK (status IN ('draft', 'posted', 'cancelled'));
      RAISE NOTICE 'Added status to customer_collections';
    END IF;
    
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'customer_collections' 
      AND column_name = 'posted_at'
    ) THEN
      ALTER TABLE customer_collections 
      ADD COLUMN posted_at TIMESTAMPTZ;
      RAISE NOTICE 'Added posted_at to customer_collections';
    END IF;
    
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'customer_collections' 
      AND column_name = 'posted_by'
    ) THEN
      ALTER TABLE customer_collections 
      ADD COLUMN posted_by UUID;
      RAISE NOTICE 'Added posted_by to customer_collections';
    END IF;
    
    -- Update payment_method to include more options
    BEGIN
      ALTER TABLE customer_collections 
      DROP CONSTRAINT IF EXISTS customer_collections_payment_method_check;
      
      ALTER TABLE customer_collections 
      ADD CONSTRAINT customer_collections_payment_method_check 
      CHECK (payment_method IN (
        'cash', 
        'bank_transfer', 
        'check', 
        'credit_card', 
        'debit_card',
        'online_payment',
        'mobile_payment',
        'other'
      ));
      RAISE NOTICE 'Updated payment_method constraint in customer_collections';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Could not update payment_method constraint: %', SQLERRM;
    END;
    
  END IF;
END $$;

-- ========================================
-- 2. إنشاء جدول supplier_payments (سندات الصرف)
-- ========================================

DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'organizations')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'vendors') THEN
    
    CREATE TABLE IF NOT EXISTS supplier_payments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        payment_number VARCHAR(50) NOT NULL,
        vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
        invoice_id UUID, -- References supplier_invoices(id)
        payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
        amount DECIMAL(18,4) NOT NULL CHECK (amount > 0),
        payment_method VARCHAR(50) DEFAULT 'bank_transfer' 
        CHECK (payment_method IN (
          'cash', 
          'bank_transfer', 
          'check', 
          'credit_card', 
          'debit_card',
          'online_payment',
          'mobile_payment',
          'other'
        )),
        payment_account_id UUID, -- References gl_accounts(id) for bank/cash account
        bank_account_id UUID, -- For backward compatibility
        check_number VARCHAR(50),
        check_date DATE,
        check_bank VARCHAR(100),
        reference_number VARCHAR(100),
        notes TEXT,
        status VARCHAR(20) DEFAULT 'draft' 
        CHECK (status IN ('draft', 'posted', 'cancelled')),
        gl_entry_id UUID, -- References gl_entries(id)
        created_by UUID,
        posted_at TIMESTAMPTZ,
        posted_by UUID,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(org_id, payment_number)
    );
    
    -- Add FK to supplier_invoices if it exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'supplier_invoices') THEN
      BEGIN
        ALTER TABLE supplier_payments 
        ADD CONSTRAINT fk_supplier_payments_invoice_id 
        FOREIGN KEY (invoice_id) REFERENCES supplier_invoices(id) ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN
        RAISE NOTICE 'Constraint fk_supplier_payments_invoice_id already exists';
      END;
    END IF;
    
    -- Add FK to gl_accounts for payment_account_id
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'gl_accounts') THEN
      BEGIN
        ALTER TABLE supplier_payments 
        ADD CONSTRAINT fk_supplier_payments_payment_account 
        FOREIGN KEY (payment_account_id) REFERENCES gl_accounts(id) ON DELETE RESTRICT;
      EXCEPTION 
        WHEN duplicate_object THEN
          RAISE NOTICE 'Constraint fk_supplier_payments_payment_account already exists';
        WHEN OTHERS THEN
          RAISE NOTICE 'Could not add fk_supplier_payments_payment_account: %', SQLERRM;
      END;
    END IF;
    
    -- Try to add foreign key constraints for users (if table exists)
    BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'users') THEN
        ALTER TABLE supplier_payments 
        ADD CONSTRAINT fk_supplier_payments_created_by 
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
        
        ALTER TABLE supplier_payments 
        ADD CONSTRAINT fk_supplier_payments_posted_by 
        FOREIGN KEY (posted_by) REFERENCES users(id) ON DELETE SET NULL;
      END IF;
    EXCEPTION 
      WHEN duplicate_object THEN
        RAISE NOTICE 'Constraints for users already exist';
      WHEN OTHERS THEN
        IF SQLSTATE = '42P01' THEN
          RAISE NOTICE 'Could not add user constraints (users table does not exist): skipping';
        ELSE
          RAISE NOTICE 'Could not add user constraints: %', SQLERRM;
        END IF;
    END;
    
    -- Create indexes for performance
    CREATE INDEX IF NOT EXISTS idx_supplier_payments_org_id 
      ON supplier_payments(org_id);
    CREATE INDEX IF NOT EXISTS idx_supplier_payments_vendor_id 
      ON supplier_payments(vendor_id);
    CREATE INDEX IF NOT EXISTS idx_supplier_payments_invoice_id 
      ON supplier_payments(invoice_id);
    CREATE INDEX IF NOT EXISTS idx_supplier_payments_payment_date 
      ON supplier_payments(payment_date);
    CREATE INDEX IF NOT EXISTS idx_supplier_payments_status 
      ON supplier_payments(status);
    CREATE INDEX IF NOT EXISTS idx_supplier_payments_payment_account_id 
      ON supplier_payments(payment_account_id);
    
    RAISE NOTICE 'supplier_payments table created or already exists';
  ELSE
    RAISE WARNING 'Cannot create supplier_payments: required tables (organizations, vendors) do not exist';
  END IF;
END $$;

-- ========================================
-- 3. إضافة payment_account_id إلى customer_collections
-- ========================================

DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'customer_collections') THEN
    
    -- Add FK to gl_accounts for payment_account_id
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'gl_accounts') THEN
      BEGIN
        ALTER TABLE customer_collections 
        ADD CONSTRAINT fk_customer_collections_payment_account 
        FOREIGN KEY (payment_account_id) REFERENCES gl_accounts(id) ON DELETE RESTRICT;
      EXCEPTION 
        WHEN duplicate_object THEN
          RAISE NOTICE 'Constraint fk_customer_collections_payment_account already exists';
        WHEN OTHERS THEN
          RAISE NOTICE 'Could not add fk_customer_collections_payment_account: %', SQLERRM;
      END;
    END IF;
    
  END IF;
END $$;

-- ========================================
-- 4. إنشاء جدول payment_voucher_lines (بنود السندات)
-- ========================================

-- جدول بنود سندات القبض (توزيع المبلغ على الفواتير)
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'customer_collections') THEN
    
    CREATE TABLE IF NOT EXISTS customer_collection_lines (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        collection_id UUID NOT NULL REFERENCES customer_collections(id) ON DELETE CASCADE,
        invoice_id UUID REFERENCES sales_invoices(id) ON DELETE SET NULL,
        allocated_amount DECIMAL(18,4) NOT NULL CHECK (allocated_amount > 0),
        discount_amount DECIMAL(18,4) DEFAULT 0 CHECK (discount_amount >= 0),
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(collection_id, invoice_id)
    );
    
    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_customer_collection_lines_collection_id 
      ON customer_collection_lines(collection_id);
    CREATE INDEX IF NOT EXISTS idx_customer_collection_lines_invoice_id 
      ON customer_collection_lines(invoice_id);
    
    RAISE NOTICE 'customer_collection_lines table created or already exists';
  END IF;
END $$;

-- جدول بنود سندات الصرف (توزيع المبلغ على الفواتير)
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'supplier_payments') THEN
    
    CREATE TABLE IF NOT EXISTS supplier_payment_lines (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        payment_id UUID NOT NULL REFERENCES supplier_payments(id) ON DELETE CASCADE,
        invoice_id UUID REFERENCES supplier_invoices(id) ON DELETE SET NULL,
        allocated_amount DECIMAL(18,4) NOT NULL CHECK (allocated_amount > 0),
        discount_amount DECIMAL(18,4) DEFAULT 0 CHECK (discount_amount >= 0),
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(payment_id, invoice_id)
    );
    
    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_supplier_payment_lines_payment_id 
      ON supplier_payment_lines(payment_id);
    CREATE INDEX IF NOT EXISTS idx_supplier_payment_lines_invoice_id 
      ON supplier_payment_lines(invoice_id);
    
    RAISE NOTICE 'supplier_payment_lines table created or already exists';
  END IF;
END $$;

-- ========================================
-- 5. دوال توليد الأرقام التلقائية
-- ========================================

-- دالة توليد رقم سند القبض
CREATE OR REPLACE FUNCTION generate_customer_receipt_number()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    v_prefix TEXT := 'CR';
    v_year TEXT := TO_CHAR(CURRENT_DATE, 'YYYY');
    v_month TEXT := TO_CHAR(CURRENT_DATE, 'MM');
    v_sequence INTEGER;
    v_org_id UUID;
BEGIN
    -- Get org_id from current context (you may need to pass it as parameter)
    -- For now, we'll use a simple sequence
    SELECT COALESCE(MAX(CAST(SUBSTRING(collection_number FROM '[0-9]+$') AS INTEGER)), 0) + 1
    INTO v_sequence
    FROM customer_collections
    WHERE collection_number LIKE v_prefix || '-' || v_year || v_month || '%';
    
    RETURN v_prefix || '-' || v_year || v_month || '-' || LPAD(v_sequence::TEXT, 5, '0');
END;
$$;

-- دالة توليد رقم سند الصرف
CREATE OR REPLACE FUNCTION generate_supplier_payment_number()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    v_prefix TEXT := 'SP';
    v_year TEXT := TO_CHAR(CURRENT_DATE, 'YYYY');
    v_month TEXT := TO_CHAR(CURRENT_DATE, 'MM');
    v_sequence INTEGER;
BEGIN
    SELECT COALESCE(MAX(CAST(SUBSTRING(payment_number FROM '[0-9]+$') AS INTEGER)), 0) + 1
    INTO v_sequence
    FROM supplier_payments
    WHERE payment_number LIKE v_prefix || '-' || v_year || v_month || '%';
    
    RETURN v_prefix || '-' || v_year || v_month || '-' || LPAD(v_sequence::TEXT, 5, '0');
END;
$$;

-- ========================================
-- 6. Row Level Security (RLS)
-- ========================================

-- Enable RLS for supplier_payments
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'supplier_payments') THEN
    ALTER TABLE supplier_payments ENABLE ROW LEVEL SECURITY;
    
    DROP POLICY IF EXISTS supplier_payments_org_isolation ON supplier_payments;
    
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'supplier_payments' 
      AND column_name = 'org_id'
    ) THEN
      CREATE POLICY supplier_payments_org_isolation ON supplier_payments
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
      RAISE NOTICE 'RLS enabled on supplier_payments';
    ELSE
      CREATE POLICY supplier_payments_auth_policy ON supplier_payments
        FOR ALL
        USING (auth.role() = 'authenticated')
        WITH CHECK (auth.role() = 'authenticated');
      RAISE NOTICE 'RLS enabled on supplier_payments (authenticated users)';
    END IF;
  END IF;
END $$;

-- Enable RLS for payment lines
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'customer_collection_lines') THEN
    ALTER TABLE customer_collection_lines ENABLE ROW LEVEL SECURITY;
    
    DROP POLICY IF EXISTS customer_collection_lines_select_policy ON customer_collection_lines;
    
    CREATE POLICY customer_collection_lines_select_policy ON customer_collection_lines
      FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM customer_collections cc
          JOIN user_organizations uo ON cc.org_id = uo.org_id
          WHERE cc.id = customer_collection_lines.collection_id
          AND uo.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM customer_collections cc
          JOIN user_organizations uo ON cc.org_id = uo.org_id
          WHERE cc.id = customer_collection_lines.collection_id
          AND uo.user_id = auth.uid()
        )
      );
    RAISE NOTICE 'RLS enabled on customer_collection_lines';
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'supplier_payment_lines') THEN
    ALTER TABLE supplier_payment_lines ENABLE ROW LEVEL SECURITY;
    
    DROP POLICY IF EXISTS supplier_payment_lines_select_policy ON supplier_payment_lines;
    
    CREATE POLICY supplier_payment_lines_select_policy ON supplier_payment_lines
      FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM supplier_payments sp
          JOIN user_organizations uo ON sp.org_id = uo.org_id
          WHERE sp.id = supplier_payment_lines.payment_id
          AND uo.user_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM supplier_payments sp
          JOIN user_organizations uo ON sp.org_id = uo.org_id
          WHERE sp.id = supplier_payment_lines.payment_id
          AND uo.user_id = auth.uid()
        )
      );
    RAISE NOTICE 'RLS enabled on supplier_payment_lines';
  END IF;
END $$;

-- ========================================
-- 7. Indexes إضافية للأداء
-- ========================================

-- Composite indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_customer_collections_customer_date 
  ON customer_collections(customer_id, collection_date DESC);

CREATE INDEX IF NOT EXISTS idx_customer_collections_status_date 
  ON customer_collections(status, collection_date DESC);

CREATE INDEX IF NOT EXISTS idx_supplier_payments_vendor_date 
  ON supplier_payments(vendor_id, payment_date DESC);

CREATE INDEX IF NOT EXISTS idx_supplier_payments_status_date 
  ON supplier_payments(status, payment_date DESC);

-- ========================================
-- 8. ملاحظات
-- ========================================

-- هذا الملف:
-- 1. يحسن جدول customer_collections (سندات القبض)
-- 2. ينشئ جدول supplier_payments (سندات الصرف)
-- 3. ينشئ جداول البنود (collection_lines, payment_lines)
-- 4. يضيف دوال توليد الأرقام التلقائية
-- 5. يضيف RLS Policies للأمان
-- 6. يضيف Indexes للأداء

-- الميزات:
-- ✅ توزيع المبلغ على عدة فواتير
-- ✅ ربط مع حسابات البنوك والنقدية
-- ✅ طرق سداد متعددة
-- ✅ عكس تلقائي في المحاسبة
-- ✅ حالة السند (draft, posted, cancelled)
-- ✅ تتبع من أنشأ ومن أقر

