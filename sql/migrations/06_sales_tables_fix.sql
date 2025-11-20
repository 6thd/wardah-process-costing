-- ========================================
-- إصلاح جداول المبيعات
-- Sales Tables Fix
-- ========================================

-- هذا الملف يصلح المشاكل في جداول المبيعات
-- ويضيف الجداول المفقودة إذا لزم الأمر

-- ========================================
-- 0. التحقق من وجود الجداول الأساسية
-- ========================================

DO $$ 
DECLARE
  org_exists BOOLEAN;
  customers_exists BOOLEAN;
  items_exists BOOLEAN;
  sales_invoices_exists BOOLEAN;
BEGIN
  -- Check which tables exist
  SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'organizations') INTO org_exists;
  SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'customers') INTO customers_exists;
  SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'items') INTO items_exists;
  SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sales_invoices') INTO sales_invoices_exists;
  
  -- Log status
  IF org_exists THEN
    RAISE NOTICE 'Table "organizations" exists';
  ELSE
    RAISE WARNING 'Table "organizations" does not exist. Some operations may fail.';
  END IF;
  
  IF customers_exists THEN
    RAISE NOTICE 'Table "customers" exists';
  ELSE
    RAISE WARNING 'Table "customers" does not exist. Some operations may fail.';
  END IF;
  
  IF items_exists THEN
    RAISE NOTICE 'Table "items" exists';
  ELSE
    RAISE WARNING 'Table "items" does not exist. Some operations may fail.';
  END IF;
  
  IF sales_invoices_exists THEN
    RAISE NOTICE 'Table "sales_invoices" exists';
  ELSE
    RAISE WARNING 'Table "sales_invoices" does not exist. Some operations may fail.';
  END IF;
  
  RAISE NOTICE 'Proceeding with fixes for existing tables...';
END $$;

-- ========================================
-- 1. إضافة عمود org_id لجدول sales_invoices إذا لم يكن موجوداً
-- ========================================

DO $$ 
BEGIN
  -- Check if sales_invoices table exists first
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sales_invoices') THEN
    -- Check if org_id column exists in sales_invoices
    IF NOT EXISTS (
      SELECT 1 
      FROM information_schema.columns 
      WHERE table_name = 'sales_invoices' 
      AND column_name = 'org_id'
    ) THEN
      -- Add org_id column
      ALTER TABLE sales_invoices 
      ADD COLUMN org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
      
      -- If tenant_id exists, copy values from tenant_id to org_id
      IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'sales_invoices' 
        AND column_name = 'tenant_id'
      ) THEN
        UPDATE sales_invoices 
        SET org_id = tenant_id 
        WHERE org_id IS NULL AND tenant_id IS NOT NULL;
      END IF;
      
      -- Make org_id NOT NULL if we have data (only if table has rows)
      IF EXISTS (SELECT 1 FROM sales_invoices LIMIT 1) THEN
        -- Check if all rows have org_id
        IF NOT EXISTS (SELECT 1 FROM sales_invoices WHERE org_id IS NULL) THEN
          ALTER TABLE sales_invoices 
          ALTER COLUMN org_id SET NOT NULL;
        END IF;
      ELSE
        -- Table is empty, can set NOT NULL directly
        ALTER TABLE sales_invoices 
        ALTER COLUMN org_id SET NOT NULL;
      END IF;
      
      -- Add index for performance
      CREATE INDEX IF NOT EXISTS idx_sales_invoices_org_id ON sales_invoices(org_id);
      
      RAISE NOTICE 'Added org_id column to sales_invoices';
    ELSE
      RAISE NOTICE 'org_id column already exists in sales_invoices';
    END IF;
  ELSE
    RAISE NOTICE 'sales_invoices table does not exist, skipping org_id addition';
  END IF;
END $$;

-- ========================================
-- 2. إضافة عمود name_ar لجدول customers إذا لم يكن موجوداً (اختياري)
-- ========================================

DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'customers') THEN
    IF NOT EXISTS (
      SELECT 1 
      FROM information_schema.columns 
      WHERE table_name = 'customers' 
      AND column_name = 'name_ar'
    ) THEN
      ALTER TABLE customers 
      ADD COLUMN name_ar TEXT;
      
      RAISE NOTICE 'Added name_ar column to customers';
    ELSE
      RAISE NOTICE 'name_ar column already exists in customers';
    END IF;
  ELSE
    RAISE NOTICE 'customers table does not exist, skipping name_ar addition';
  END IF;
END $$;

-- ========================================
-- 3. إنشاء جدول sales_orders إذا لم يكن موجوداً
-- ========================================

DO $$ 
BEGIN
  -- Only create sales_orders if required tables exist
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'organizations')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'customers') THEN
    
    CREATE TABLE IF NOT EXISTS sales_orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        so_number VARCHAR(50) NOT NULL,
        customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    so_date DATE NOT NULL DEFAULT CURRENT_DATE,
    delivery_date DATE,
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'in_production', 'ready', 'delivered', 'cancelled')),
    currency VARCHAR(10) DEFAULT 'SAR',
    total_amount DECIMAL(18,4) DEFAULT 0,
    tax_amount DECIMAL(18,4) DEFAULT 0,
    discount_amount DECIMAL(18,4) DEFAULT 0,
    final_amount DECIMAL(18,4) DEFAULT 0,
    cogs_amount DECIMAL(18,4) DEFAULT 0,
    notes TEXT,
        created_by UUID, -- References auth.users(id) or users(id) if exists
        approved_by UUID, -- References auth.users(id) or users(id) if exists
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(org_id, so_number)
    );
    
    -- Try to add foreign key constraints for users (if table exists)
    -- We'll try to add them and catch any errors gracefully
    BEGIN
      ALTER TABLE sales_orders 
      ADD CONSTRAINT fk_sales_orders_created_by 
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
    EXCEPTION 
      WHEN duplicate_object THEN
        RAISE NOTICE 'Constraint fk_sales_orders_created_by already exists';
      WHEN OTHERS THEN
        IF SQLSTATE = '42P01' THEN
          RAISE NOTICE 'Could not add fk_sales_orders_created_by (users table does not exist): skipping';
        ELSE
          RAISE NOTICE 'Could not add fk_sales_orders_created_by: %', SQLERRM;
        END IF;
    END;
    
    BEGIN
      ALTER TABLE sales_orders 
      ADD CONSTRAINT fk_sales_orders_approved_by 
      FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL;
    EXCEPTION 
      WHEN duplicate_object THEN
        RAISE NOTICE 'Constraint fk_sales_orders_approved_by already exists';
      WHEN OTHERS THEN
        IF SQLSTATE = '42P01' THEN
          RAISE NOTICE 'Could not add fk_sales_orders_approved_by (users table does not exist): skipping';
        ELSE
          RAISE NOTICE 'Could not add fk_sales_orders_approved_by: %', SQLERRM;
        END IF;
    END;
    
    -- Create index for performance
    CREATE INDEX IF NOT EXISTS idx_sales_orders_org_id ON sales_orders(org_id);
    CREATE INDEX IF NOT EXISTS idx_sales_orders_customer_id ON sales_orders(customer_id);
    CREATE INDEX IF NOT EXISTS idx_sales_orders_so_date ON sales_orders(so_date);
    
    RAISE NOTICE 'sales_orders table created or already exists';
  ELSE
    RAISE WARNING 'Cannot create sales_orders: required tables (organizations, customers) do not exist';
  END IF;
END $$;

-- ========================================
-- 4. إنشاء جدول sales_order_lines إذا لم يكن موجوداً
-- ========================================

DO $$ 
BEGIN
  -- Only create sales_order_lines if required tables exist
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sales_orders')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'items')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'organizations') THEN
    
    CREATE TABLE IF NOT EXISTS sales_order_lines (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        so_id UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
        item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
        line_number INTEGER NOT NULL,
        quantity DECIMAL(14,4) NOT NULL,
        unit_price DECIMAL(18,6) NOT NULL,
        total_price DECIMAL(18,4) GENERATED ALWAYS AS (quantity * unit_price) STORED,
        delivered_quantity DECIMAL(14,4) DEFAULT 0,
        unit_cost DECIMAL(18,6) DEFAULT 0,
        total_cogs DECIMAL(18,4) DEFAULT 0,
        delivery_date DATE,
        notes TEXT,
        org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(so_id, line_number)
    );
    
    -- Create index for performance
    CREATE INDEX IF NOT EXISTS idx_sales_order_lines_so_id ON sales_order_lines(so_id);
    CREATE INDEX IF NOT EXISTS idx_sales_order_lines_item_id ON sales_order_lines(item_id);
    CREATE INDEX IF NOT EXISTS idx_sales_order_lines_org_id ON sales_order_lines(org_id);
    
    RAISE NOTICE 'sales_order_lines table created or already exists';
  ELSE
    RAISE WARNING 'Cannot create sales_order_lines: required tables (sales_orders, items, organizations) do not exist';
  END IF;
END $$;

-- ========================================
-- 5. إنشاء جدول customer_collections إذا لم يكن موجوداً
-- ========================================

DO $$ 
BEGIN
  -- Only create customer_collections if required tables exist
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'organizations')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'customers') THEN
    
    CREATE TABLE IF NOT EXISTS customer_collections (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        collection_number VARCHAR(50) NOT NULL,
        customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
        invoice_id UUID,
        collection_date DATE NOT NULL DEFAULT CURRENT_DATE,
        amount DECIMAL(18,4) NOT NULL CHECK (amount > 0),
        payment_method VARCHAR(50) DEFAULT 'cash' CHECK (payment_method IN ('cash', 'bank_transfer', 'check', 'credit_card', 'other')),
        bank_account_id UUID,
        check_number VARCHAR(50),
        check_date DATE,
        reference_number VARCHAR(100),
        notes TEXT,
        gl_entry_id UUID,
        created_by UUID, -- References auth.users(id) or users(id) if exists
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(org_id, collection_number)
    );
    
    -- Add FK to sales_invoices if it exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sales_invoices') THEN
      BEGIN
        ALTER TABLE customer_collections 
        ADD CONSTRAINT fk_customer_collections_invoice_id 
        FOREIGN KEY (invoice_id) REFERENCES sales_invoices(id) ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN
        RAISE NOTICE 'Constraint fk_customer_collections_invoice_id already exists';
      END;
    END IF;
    
    -- Try to add foreign key constraints for users (if table exists)
    BEGIN
      ALTER TABLE customer_collections 
      ADD CONSTRAINT fk_customer_collections_created_by 
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
    EXCEPTION 
      WHEN duplicate_object THEN
        RAISE NOTICE 'Constraint fk_customer_collections_created_by already exists';
      WHEN OTHERS THEN
        IF SQLSTATE = '42P01' THEN
          RAISE NOTICE 'Could not add fk_customer_collections_created_by (users table does not exist): skipping';
        ELSE
          RAISE NOTICE 'Could not add fk_customer_collections_created_by: %', SQLERRM;
        END IF;
    END;
    
    -- Create index for performance
    CREATE INDEX IF NOT EXISTS idx_customer_collections_org_id ON customer_collections(org_id);
    CREATE INDEX IF NOT EXISTS idx_customer_collections_customer_id ON customer_collections(customer_id);
    CREATE INDEX IF NOT EXISTS idx_customer_collections_invoice_id ON customer_collections(invoice_id);
    CREATE INDEX IF NOT EXISTS idx_customer_collections_collection_date ON customer_collections(collection_date);
    
    RAISE NOTICE 'customer_collections table created or already exists';
  ELSE
    RAISE WARNING 'Cannot create customer_collections: required tables (organizations, customers) do not exist';
  END IF;
END $$;

-- ========================================
-- 6. إضافة عمود name_ar لجدول items إذا لم يكن موجوداً (اختياري)
-- ========================================

DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'items') THEN
    IF NOT EXISTS (
      SELECT 1 
      FROM information_schema.columns 
      WHERE table_name = 'items' 
      AND column_name = 'name_ar'
    ) THEN
      ALTER TABLE items 
      ADD COLUMN name_ar TEXT;
      
      RAISE NOTICE 'Added name_ar column to items';
    ELSE
      RAISE NOTICE 'name_ar column already exists in items';
    END IF;
  ELSE
    RAISE NOTICE 'items table does not exist, skipping name_ar addition';
  END IF;
END $$;

-- ========================================
-- 7. إضافة RLS Policies للجداول الجديدة
-- ========================================

DO $$ 
BEGIN
  -- Enable RLS on sales_orders if it exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sales_orders') THEN
    ALTER TABLE sales_orders ENABLE ROW LEVEL SECURITY;
    
    DROP POLICY IF EXISTS sales_orders_org_isolation ON sales_orders;
    CREATE POLICY sales_orders_org_isolation ON sales_orders
      FOR ALL
      USING (org_id = current_setting('app.current_org_id', true)::UUID);
    
    RAISE NOTICE 'RLS enabled on sales_orders';
  END IF;
  
  -- Enable RLS on sales_order_lines if it exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sales_order_lines') THEN
    ALTER TABLE sales_order_lines ENABLE ROW LEVEL SECURITY;
    
    DROP POLICY IF EXISTS sales_order_lines_org_isolation ON sales_order_lines;
    CREATE POLICY sales_order_lines_org_isolation ON sales_order_lines
      FOR ALL
      USING (org_id = current_setting('app.current_org_id', true)::UUID);
    
    RAISE NOTICE 'RLS enabled on sales_order_lines';
  END IF;
  
  -- Enable RLS on customer_collections if it exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'customer_collections') THEN
    ALTER TABLE customer_collections ENABLE ROW LEVEL SECURITY;
    
    DROP POLICY IF EXISTS customer_collections_org_isolation ON customer_collections;
    CREATE POLICY customer_collections_org_isolation ON customer_collections
      FOR ALL
      USING (org_id = current_setting('app.current_org_id', true)::UUID);
    
    RAISE NOTICE 'RLS enabled on customer_collections';
  END IF;
END $$;

-- ========================================
-- 8. تحديث sales_invoices_lines لإضافة org_id إذا لم يكن موجوداً
-- ========================================

DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sales_invoice_lines') THEN
    IF NOT EXISTS (
      SELECT 1 
      FROM information_schema.columns 
      WHERE table_name = 'sales_invoice_lines' 
      AND column_name = 'org_id'
    ) THEN
      ALTER TABLE sales_invoice_lines 
      ADD COLUMN org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
      
      -- Try to get org_id from parent invoice
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sales_invoices') THEN
        UPDATE sales_invoice_lines sil
        SET org_id = si.org_id
        FROM sales_invoices si
        WHERE sil.sales_invoice_id = si.id
        AND sil.org_id IS NULL;
      END IF;
      
      -- Make org_id NOT NULL if we have data
      IF EXISTS (SELECT 1 FROM sales_invoice_lines LIMIT 1) THEN
        IF NOT EXISTS (SELECT 1 FROM sales_invoice_lines WHERE org_id IS NULL) THEN
          ALTER TABLE sales_invoice_lines 
          ALTER COLUMN org_id SET NOT NULL;
        END IF;
      ELSE
        ALTER TABLE sales_invoice_lines 
        ALTER COLUMN org_id SET NOT NULL;
      END IF;
      
      -- Add index
      CREATE INDEX IF NOT EXISTS idx_sales_invoice_lines_org_id ON sales_invoice_lines(org_id);
      
      RAISE NOTICE 'Added org_id column to sales_invoice_lines';
    ELSE
      RAISE NOTICE 'org_id column already exists in sales_invoice_lines';
    END IF;
  ELSE
    RAISE NOTICE 'sales_invoice_lines table does not exist, skipping org_id addition';
  END IF;
END $$;

-- ========================================
-- 9. إنشاء دالة لتوليد أرقام تلقائية للجداول الجديدة
-- ========================================

-- Function to generate sales order number
CREATE OR REPLACE FUNCTION generate_sales_order_number(org_uuid UUID)
RETURNS TEXT AS $$
DECLARE
  next_num INTEGER;
  prefix TEXT := 'SO-';
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(so_number FROM LENGTH(prefix) + 1) AS INTEGER)), 0) + 1
  INTO next_num
  FROM sales_orders
  WHERE org_id = org_uuid;
  
  RETURN prefix || LPAD(next_num::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql;

-- Function to generate collection number
CREATE OR REPLACE FUNCTION generate_collection_number(org_uuid UUID)
RETURNS TEXT AS $$
DECLARE
  next_num INTEGER;
  prefix TEXT := 'COL-';
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(collection_number FROM LENGTH(prefix) + 1) AS INTEGER)), 0) + 1
  INTO next_num
  FROM customer_collections
  WHERE org_id = org_uuid;
  
  RETURN prefix || LPAD(next_num::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql;

-- ========================================
-- 10. ملاحظات
-- ========================================

-- هذا الملف:
-- 1. يضيف عمود org_id لـ sales_invoices إذا لم يكن موجوداً
-- 2. يضيف عمود name_ar لـ customers و items (اختياري)
-- 3. ينشئ جدول sales_orders إذا لم يكن موجوداً
-- 4. ينشئ جدول sales_order_lines إذا لم يكن موجوداً
-- 5. ينشئ جدول customer_collections إذا لم يكن موجوداً
-- 6. يضيف RLS policies للجداول الجديدة
-- 7. يضيف org_id لـ sales_invoice_lines إذا لم يكن موجوداً
-- 8. ينشئ دوال لتوليد الأرقام التلقائية

-- بعد تنفيذ هذا الملف، يجب أن تعمل تقارير المبيعات بشكل صحيح.


