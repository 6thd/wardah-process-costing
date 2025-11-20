-- ========================================
-- إصلاح Schema جداول المبيعات
-- Sales Schema Fix - Relationships and Columns
-- ========================================

-- هذا الملف يصلح العلاقات المفقودة والأعمدة المفقودة في جداول المبيعات

-- ========================================
-- 1. إصلاح sales_invoice_lines - إضافة FK إلى items
-- ========================================

DO $$ 
BEGIN
  -- Check if sales_invoice_lines table exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sales_invoice_lines') THEN
    
    -- Check if product_id column exists and items table exists
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'sales_invoice_lines' 
      AND column_name = 'product_id'
    ) AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'items') THEN
      
      -- Try to add FK constraint from product_id to items
      BEGIN
        ALTER TABLE sales_invoice_lines 
        ADD CONSTRAINT fk_sales_invoice_lines_item_id 
        FOREIGN KEY (product_id) REFERENCES items(id) ON DELETE RESTRICT;
        
        RAISE NOTICE 'Added FK constraint from sales_invoice_lines.product_id to items.id';
      EXCEPTION 
        WHEN duplicate_object THEN
          RAISE NOTICE 'FK constraint fk_sales_invoice_lines_item_id already exists';
        WHEN OTHERS THEN
          RAISE NOTICE 'Could not add FK constraint: %', SQLERRM;
      END;
    END IF;
    
    -- Also check if item_id column exists (alternative naming)
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'sales_invoice_lines' 
      AND column_name = 'item_id'
    ) AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'items') THEN
      
      BEGIN
        ALTER TABLE sales_invoice_lines 
        ADD CONSTRAINT fk_sales_invoice_lines_item_id_alt 
        FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE RESTRICT;
        
        RAISE NOTICE 'Added FK constraint from sales_invoice_lines.item_id to items.id';
      EXCEPTION 
        WHEN duplicate_object THEN
          RAISE NOTICE 'FK constraint fk_sales_invoice_lines_item_id_alt already exists';
        WHEN OTHERS THEN
          RAISE NOTICE 'Could not add FK constraint for item_id: %', SQLERRM;
      END;
    END IF;
    
    -- Add item_id column if it doesn't exist and product_id exists
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'sales_invoice_lines' 
      AND column_name = 'product_id'
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'sales_invoice_lines' 
      AND column_name = 'item_id'
    ) THEN
      -- Create item_id as a copy of product_id for compatibility
      ALTER TABLE sales_invoice_lines 
      ADD COLUMN item_id UUID;
      
      -- Copy values from product_id
      UPDATE sales_invoice_lines 
      SET item_id = product_id 
      WHERE item_id IS NULL;
      
      -- Add FK constraint
      BEGIN
        ALTER TABLE sales_invoice_lines 
        ADD CONSTRAINT fk_sales_invoice_lines_item_id_new 
        FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE RESTRICT;
        
        RAISE NOTICE 'Added item_id column and FK constraint to items';
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Could not add FK constraint for new item_id: %', SQLERRM;
      END;
    END IF;
    
  ELSE
    RAISE NOTICE 'sales_invoice_lines table does not exist';
  END IF;
END $$;

-- ========================================
-- 2. إصلاح delivery_note_lines - إضافة الأعمدة المفقودة
-- ========================================

DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'delivery_note_lines') THEN
    
    -- Add quantity_delivered if it doesn't exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'delivery_note_lines' 
      AND column_name = 'quantity_delivered'
    ) THEN
      -- Check what quantity column exists
      IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'delivery_note_lines' 
        AND column_name = 'quantity'
      ) THEN
        -- Add quantity_delivered and copy from quantity
        ALTER TABLE delivery_note_lines 
        ADD COLUMN quantity_delivered DECIMAL(14,4);
        
        UPDATE delivery_note_lines 
        SET quantity_delivered = quantity 
        WHERE quantity_delivered IS NULL;
        
        RAISE NOTICE 'Added quantity_delivered column to delivery_note_lines';
      ELSE
        -- Add quantity_delivered with default
        ALTER TABLE delivery_note_lines 
        ADD COLUMN quantity_delivered DECIMAL(14,4) DEFAULT 0;
        
        RAISE NOTICE 'Added quantity_delivered column to delivery_note_lines (default 0)';
      END IF;
    ELSE
      RAISE NOTICE 'quantity_delivered column already exists in delivery_note_lines';
    END IF;
    
    -- Add unit_cost_at_delivery if it doesn't exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'delivery_note_lines' 
      AND column_name = 'unit_cost_at_delivery'
    ) THEN
      -- Check what cost column exists
      IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'delivery_note_lines' 
        AND column_name = 'unit_cost'
      ) THEN
        -- Add unit_cost_at_delivery and copy from unit_cost
        ALTER TABLE delivery_note_lines 
        ADD COLUMN unit_cost_at_delivery DECIMAL(18,6);
        
        UPDATE delivery_note_lines 
        SET unit_cost_at_delivery = unit_cost 
        WHERE unit_cost_at_delivery IS NULL;
        
        RAISE NOTICE 'Added unit_cost_at_delivery column to delivery_note_lines';
      ELSE
        -- Add unit_cost_at_delivery with default
        ALTER TABLE delivery_note_lines 
        ADD COLUMN unit_cost_at_delivery DECIMAL(18,6) DEFAULT 0;
        
        RAISE NOTICE 'Added unit_cost_at_delivery column to delivery_note_lines (default 0)';
      END IF;
    ELSE
      RAISE NOTICE 'unit_cost_at_delivery column already exists in delivery_note_lines';
    END IF;
    
  ELSE
    RAISE NOTICE 'delivery_note_lines table does not exist';
  END IF;
END $$;

-- ========================================
-- 3. إصلاح sales_invoice_lines - إضافة الأعمدة المفقودة
-- ========================================

DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sales_invoice_lines') THEN
    
    -- Add unit_cost_at_sale if it doesn't exist
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'sales_invoice_lines' 
      AND column_name = 'unit_cost_at_sale'
    ) THEN
      -- Check if unit_cost exists
      IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'sales_invoice_lines' 
        AND column_name = 'unit_cost'
      ) THEN
        -- Add unit_cost_at_sale and copy from unit_cost
        ALTER TABLE sales_invoice_lines 
        ADD COLUMN unit_cost_at_sale DECIMAL(18,6);
        
        UPDATE sales_invoice_lines 
        SET unit_cost_at_sale = unit_cost 
        WHERE unit_cost_at_sale IS NULL;
        
        RAISE NOTICE 'Added unit_cost_at_sale column to sales_invoice_lines';
      ELSE
        -- Add unit_cost_at_sale with default
        ALTER TABLE sales_invoice_lines 
        ADD COLUMN unit_cost_at_sale DECIMAL(18,6) DEFAULT 0;
        
        RAISE NOTICE 'Added unit_cost_at_sale column to sales_invoice_lines (default 0)';
      END IF;
    ELSE
      RAISE NOTICE 'unit_cost_at_sale column already exists in sales_invoice_lines';
    END IF;
    
    -- Ensure sales_invoice_id column exists (some schemas use invoice_id)
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'sales_invoice_lines' 
      AND column_name = 'sales_invoice_id'
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'sales_invoice_lines' 
      AND column_name = 'invoice_id'
    ) THEN
      -- Add sales_invoice_id as a copy of invoice_id
      ALTER TABLE sales_invoice_lines 
      ADD COLUMN sales_invoice_id UUID;
      
      UPDATE sales_invoice_lines 
      SET sales_invoice_id = invoice_id 
      WHERE sales_invoice_id IS NULL;
      
      -- Add FK constraint
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sales_invoices') THEN
        BEGIN
          ALTER TABLE sales_invoice_lines 
          ADD CONSTRAINT fk_sales_invoice_lines_invoice_id_new 
          FOREIGN KEY (sales_invoice_id) REFERENCES sales_invoices(id) ON DELETE CASCADE;
          
          RAISE NOTICE 'Added sales_invoice_id column and FK constraint';
        EXCEPTION WHEN OTHERS THEN
          RAISE NOTICE 'Could not add FK constraint for sales_invoice_id: %', SQLERRM;
        END;
      END IF;
    END IF;
    
  ELSE
    RAISE NOTICE 'sales_invoice_lines table does not exist';
  END IF;
END $$;

-- ========================================
-- 4. إنشاء delivery_note_lines إذا لم يكن موجوداً
-- ========================================

DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'delivery_note_lines') THEN
    
    -- Check if delivery_notes exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'delivery_notes')
       AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'items') THEN
      
      CREATE TABLE delivery_note_lines (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          delivery_note_id UUID NOT NULL REFERENCES delivery_notes(id) ON DELETE CASCADE,
          item_id UUID REFERENCES items(id) ON DELETE RESTRICT,
          product_id UUID, -- For compatibility
          line_number INTEGER NOT NULL DEFAULT 1,
          quantity DECIMAL(14,4) NOT NULL DEFAULT 0,
          quantity_delivered DECIMAL(14,4) NOT NULL DEFAULT 0,
          unit_price DECIMAL(18,6) DEFAULT 0,
          unit_cost DECIMAL(18,6) DEFAULT 0,
          unit_cost_at_delivery DECIMAL(18,6) DEFAULT 0,
          line_total DECIMAL(18,4) GENERATED ALWAYS AS (quantity_delivered * unit_price) STORED,
          notes TEXT,
          org_id UUID,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(delivery_note_id, line_number)
      );
      
      -- Add FK to items if product_id is used
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'items') THEN
        BEGIN
          ALTER TABLE delivery_note_lines 
          ADD CONSTRAINT fk_delivery_note_lines_item_id 
          FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE RESTRICT;
        EXCEPTION WHEN OTHERS THEN
          RAISE NOTICE 'Could not add FK constraint for delivery_note_lines.item_id: %', SQLERRM;
        END;
      END IF;
      
      -- Add org_id FK if organizations exists
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'organizations') THEN
        BEGIN
          ALTER TABLE delivery_note_lines 
          ADD CONSTRAINT fk_delivery_note_lines_org_id 
          FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
        EXCEPTION WHEN OTHERS THEN
          RAISE NOTICE 'Could not add FK constraint for delivery_note_lines.org_id: %', SQLERRM;
        END;
      END IF;
      
      -- Create indexes
      CREATE INDEX IF NOT EXISTS idx_delivery_note_lines_delivery_note_id 
        ON delivery_note_lines(delivery_note_id);
      CREATE INDEX IF NOT EXISTS idx_delivery_note_lines_item_id 
        ON delivery_note_lines(item_id);
      
      RAISE NOTICE 'Created delivery_note_lines table';
    ELSE
      RAISE WARNING 'Cannot create delivery_note_lines: required tables (delivery_notes, items) do not exist';
    END IF;
  ELSE
    RAISE NOTICE 'delivery_note_lines table already exists';
  END IF;
END $$;

-- ========================================
-- 5. إضافة indexes للأداء
-- ========================================

-- Indexes for sales_invoice_lines
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sales_invoice_lines') THEN
    
    -- Index for product_id (if exists)
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'sales_invoice_lines' 
      AND column_name = 'product_id'
    ) THEN
      CREATE INDEX IF NOT EXISTS idx_sales_invoice_lines_product_id 
        ON sales_invoice_lines(product_id);
    END IF;
    
    -- Index for item_id (if exists)
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'sales_invoice_lines' 
      AND column_name = 'item_id'
    ) THEN
      CREATE INDEX IF NOT EXISTS idx_sales_invoice_lines_item_id 
        ON sales_invoice_lines(item_id) WHERE item_id IS NOT NULL;
    END IF;
    
    -- Index for sales_invoice_id (if exists)
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'sales_invoice_lines' 
      AND column_name = 'sales_invoice_id'
    ) THEN
      CREATE INDEX IF NOT EXISTS idx_sales_invoice_lines_sales_invoice_id 
        ON sales_invoice_lines(sales_invoice_id) WHERE sales_invoice_id IS NOT NULL;
    END IF;
    
    -- Index for invoice_id (if exists - alternative naming)
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'sales_invoice_lines' 
      AND column_name = 'invoice_id'
    ) THEN
      CREATE INDEX IF NOT EXISTS idx_sales_invoice_lines_invoice_id 
        ON sales_invoice_lines(invoice_id) WHERE invoice_id IS NOT NULL;
    END IF;
    
    RAISE NOTICE 'Created indexes for sales_invoice_lines';
  END IF;
END $$;

-- ========================================
-- 6. ملاحظات
-- ========================================

-- هذا الملف:
-- 1. يضيف FK من sales_invoice_lines.product_id إلى items.id
-- 2. يضيف عمود item_id في sales_invoice_lines إذا لم يكن موجوداً
-- 3. يضيف quantity_delivered و unit_cost_at_delivery في delivery_note_lines
-- 4. يضيف unit_cost_at_sale في sales_invoice_lines
-- 5. ينشئ delivery_note_lines إذا لم يكن موجوداً
-- 6. يضيف indexes للأداء

-- بعد تنفيذ هذا الملف، يجب أن تعمل تقارير المبيعات بشكل صحيح.


