-- ===================================================================
-- Phase B: Complete Database Fixes
-- المرحلة B: إصلاحات قاعدة البيانات الكاملة
-- ===================================================================
-- This combines critical fixes from scripts 06, 07, 08, 09
-- يجمع الإصلاحات الحرجة من السكريبتات 06، 07، 08، 09
-- ===================================================================

-- ===================================================================
-- 1. SALES MODULE FIXES
-- إصلاحات وحدة المبيعات
-- ===================================================================

-- Ensure sales_invoices has all required columns
DO $$
BEGIN
    -- Add org_id if missing (should already exist from 00_critical_schema_fixes.sql)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'sales_invoices' AND column_name = 'org_id'
    ) THEN
        ALTER TABLE sales_invoices ADD COLUMN org_id UUID REFERENCES organizations(id);
        RAISE NOTICE 'Added org_id to sales_invoices';
    END IF;
    
    -- Ensure status column exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'sales_invoices' AND column_name = 'status'
    ) THEN
        ALTER TABLE sales_invoices ADD COLUMN status VARCHAR(50) DEFAULT 'DRAFT';
        RAISE NOTICE 'Added status to sales_invoices';
    END IF;
END $$;

-- ===================================================================
-- SMART TABLE STRUCTURE FIX: sales_invoice_lines
-- إصلاح ذكي لهيكل الجدول: sales_invoice_lines
-- ===================================================================
-- This handles all possible column naming scenarios
-- يتعامل مع جميع سيناريوهات تسمية الأعمدة المحتملة
-- ===================================================================

DO $$
DECLARE
    v_column_name TEXT;
BEGIN
    -- Check if table exists
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sales_invoice_lines') THEN
        -- Create table if it doesn't exist with correct structure
        CREATE TABLE sales_invoice_lines (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            invoice_id UUID NOT NULL REFERENCES sales_invoices(id) ON DELETE CASCADE,
            item_id UUID REFERENCES items(id),
            product_id UUID REFERENCES products(id),
            description TEXT,
            quantity NUMERIC NOT NULL DEFAULT 0,
            unit_price NUMERIC NOT NULL DEFAULT 0,
            discount_percent NUMERIC DEFAULT 0,
            discount_amount NUMERIC DEFAULT 0,
            tax_percent NUMERIC DEFAULT 0,
            tax_amount NUMERIC DEFAULT 0,
            line_total NUMERIC NOT NULL DEFAULT 0,
            line_number INTEGER,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        RAISE NOTICE '✅ Created sales_invoice_lines table with correct structure';
    ELSE
        RAISE NOTICE '📋 Table sales_invoice_lines exists, checking structure...';
        
        -- ============================================================
        -- FIX INVOICE_ID COLUMN (handle all naming variations)
        -- ============================================================
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'sales_invoice_lines' AND column_name = 'invoice_id'
        ) THEN
            -- Check for common naming variations and rename to standard
            IF EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'sales_invoice_lines' AND column_name = 'sales_invoice_id'
            ) THEN
                ALTER TABLE sales_invoice_lines RENAME COLUMN sales_invoice_id TO invoice_id;
                RAISE NOTICE '✅ Renamed sales_invoice_id → invoice_id';
            ELSIF EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'sales_invoice_lines' AND column_name = 'invoiceid'
            ) THEN
                ALTER TABLE sales_invoice_lines RENAME COLUMN invoiceid TO invoice_id;
                RAISE NOTICE '✅ Renamed invoiceid → invoice_id';
            ELSIF EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'sales_invoice_lines' AND column_name = 'invoice'
            ) THEN
                ALTER TABLE sales_invoice_lines RENAME COLUMN invoice TO invoice_id;
                RAISE NOTICE '✅ Renamed invoice → invoice_id';
            ELSE
                -- Column doesn't exist in any form, add it
                ALTER TABLE sales_invoice_lines ADD COLUMN invoice_id UUID;
                -- Try to add foreign key if sales_invoices exists
                IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sales_invoices') THEN
                    ALTER TABLE sales_invoice_lines 
                    ADD CONSTRAINT fk_sales_invoice_lines_invoice 
                    FOREIGN KEY (invoice_id) REFERENCES sales_invoices(id) ON DELETE CASCADE;
                END IF;
                RAISE NOTICE '✅ Added invoice_id column to sales_invoice_lines';
            END IF;
        ELSE
            RAISE NOTICE '✓ invoice_id column already exists';
        END IF;
        
        -- ============================================================
        -- ADD OTHER MISSING COLUMNS
        -- ============================================================
        
        -- line_number
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sales_invoice_lines' AND column_name = 'line_number') THEN
            ALTER TABLE sales_invoice_lines ADD COLUMN line_number INTEGER;
            RAISE NOTICE '✅ Added line_number column';
        END IF;
        
        -- item_id
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sales_invoice_lines' AND column_name = 'item_id') THEN
            ALTER TABLE sales_invoice_lines ADD COLUMN item_id UUID REFERENCES items(id);
            RAISE NOTICE '✅ Added item_id column';
        END IF;
        
        -- product_id
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sales_invoice_lines' AND column_name = 'product_id') THEN
            ALTER TABLE sales_invoice_lines ADD COLUMN product_id UUID REFERENCES products(id);
            RAISE NOTICE '✅ Added product_id column';
        END IF;
        
        RAISE NOTICE '✅ sales_invoice_lines structure updated successfully';
    END IF;
    
    -- ============================================================
    -- FINAL VERIFICATION - Show current structure
    -- ============================================================
    RAISE NOTICE '==================================================';
    RAISE NOTICE 'Final structure verification:';
    FOR v_column_name IN 
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'sales_invoice_lines'
        ORDER BY ordinal_position
    LOOP
        RAISE NOTICE '  - Column: %', v_column_name;
    END LOOP;
    RAISE NOTICE '==================================================';
    
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE '❌ Error updating sales_invoice_lines: %', SQLERRM;
        RAISE NOTICE 'Continuing with script execution...';
END $$;

-- Create indexes for sales tables
CREATE INDEX IF NOT EXISTS idx_sales_invoices_org_id ON sales_invoices(org_id);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_customer_id ON sales_invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_invoice_date ON sales_invoices(invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_status ON sales_invoices(status);

CREATE INDEX IF NOT EXISTS idx_sales_invoice_lines_invoice_id ON sales_invoice_lines(invoice_id);
CREATE INDEX IF NOT EXISTS idx_sales_invoice_lines_item_id ON sales_invoice_lines(item_id);
CREATE INDEX IF NOT EXISTS idx_sales_invoice_lines_product_id ON sales_invoice_lines(product_id);

-- ===================================================================
-- 2. PAYMENT VOUCHERS SYSTEM
-- نظام سندات القبض والصرف
-- ===================================================================

-- Create payment_vouchers table (سندات الصرف للموردين)
-- Note: Foreign keys are added conditionally based on table existence
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'payment_vouchers') THEN
        -- Create table without foreign keys first
        CREATE TABLE payment_vouchers (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            org_id UUID NOT NULL,
            voucher_number VARCHAR(50) UNIQUE NOT NULL,
            voucher_date DATE NOT NULL DEFAULT CURRENT_DATE,
            supplier_id UUID,
            vendor_id UUID,
            payment_method VARCHAR(50) NOT NULL,
            payment_account_id UUID NOT NULL,
            amount NUMERIC NOT NULL DEFAULT 0,
            reference VARCHAR(255),
            notes TEXT,
            status VARCHAR(50) DEFAULT 'DRAFT',
            gl_entry_id UUID,
            created_by UUID,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        
        -- Add foreign keys conditionally
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'organizations') THEN
            ALTER TABLE payment_vouchers ADD CONSTRAINT fk_payment_vouchers_org 
            FOREIGN KEY (org_id) REFERENCES organizations(id);
        END IF;
        
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'suppliers') THEN
            ALTER TABLE payment_vouchers ADD CONSTRAINT fk_payment_vouchers_supplier 
            FOREIGN KEY (supplier_id) REFERENCES suppliers(id);
        END IF;
        
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'vendors') THEN
            ALTER TABLE payment_vouchers ADD CONSTRAINT fk_payment_vouchers_vendor 
            FOREIGN KEY (vendor_id) REFERENCES vendors(id);
        END IF;
        
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'gl_accounts') THEN
            ALTER TABLE payment_vouchers ADD CONSTRAINT fk_payment_vouchers_account 
            FOREIGN KEY (payment_account_id) REFERENCES gl_accounts(id);
        END IF;
        
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'gl_entries') THEN
            ALTER TABLE payment_vouchers ADD CONSTRAINT fk_payment_vouchers_entry 
            FOREIGN KEY (gl_entry_id) REFERENCES gl_entries(id);
        END IF;
        
        RAISE NOTICE '✅ Created payment_vouchers table';
    ELSE
        RAISE NOTICE '✓ payment_vouchers table already exists';
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE '❌ Error creating payment_vouchers: %', SQLERRM;
END $$;

-- Create receipt_vouchers table (سندات القبض من العملاء)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'receipt_vouchers') THEN
        -- Create table without foreign keys first
        CREATE TABLE receipt_vouchers (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            org_id UUID NOT NULL,
            voucher_number VARCHAR(50) UNIQUE NOT NULL,
            voucher_date DATE NOT NULL DEFAULT CURRENT_DATE,
            customer_id UUID NOT NULL,
            payment_method VARCHAR(50) NOT NULL,
            payment_account_id UUID NOT NULL,
            amount NUMERIC NOT NULL DEFAULT 0,
            reference VARCHAR(255),
            notes TEXT,
            status VARCHAR(50) DEFAULT 'DRAFT',
            gl_entry_id UUID,
            created_by UUID,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        
        -- Add foreign keys conditionally
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'organizations') THEN
            ALTER TABLE receipt_vouchers ADD CONSTRAINT fk_receipt_vouchers_org 
            FOREIGN KEY (org_id) REFERENCES organizations(id);
        END IF;
        
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'customers') THEN
            ALTER TABLE receipt_vouchers ADD CONSTRAINT fk_receipt_vouchers_customer 
            FOREIGN KEY (customer_id) REFERENCES customers(id);
        END IF;
        
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'gl_accounts') THEN
            ALTER TABLE receipt_vouchers ADD CONSTRAINT fk_receipt_vouchers_account 
            FOREIGN KEY (payment_account_id) REFERENCES gl_accounts(id);
        END IF;
        
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'gl_entries') THEN
            ALTER TABLE receipt_vouchers ADD CONSTRAINT fk_receipt_vouchers_entry 
            FOREIGN KEY (gl_entry_id) REFERENCES gl_entries(id);
        END IF;
        
        RAISE NOTICE '✅ Created receipt_vouchers table';
    ELSE
        RAISE NOTICE '✓ receipt_vouchers table already exists';
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE '❌ Error creating receipt_vouchers: %', SQLERRM;
END $$;

-- Create indexes for payment vouchers
CREATE INDEX IF NOT EXISTS idx_payment_vouchers_org_id ON payment_vouchers(org_id);
CREATE INDEX IF NOT EXISTS idx_payment_vouchers_supplier_id ON payment_vouchers(supplier_id);
CREATE INDEX IF NOT EXISTS idx_payment_vouchers_vendor_id ON payment_vouchers(vendor_id);
CREATE INDEX IF NOT EXISTS idx_payment_vouchers_voucher_date ON payment_vouchers(voucher_date DESC);
CREATE INDEX IF NOT EXISTS idx_payment_vouchers_status ON payment_vouchers(status);

CREATE INDEX IF NOT EXISTS idx_receipt_vouchers_org_id ON receipt_vouchers(org_id);
CREATE INDEX IF NOT EXISTS idx_receipt_vouchers_customer_id ON receipt_vouchers(customer_id);
CREATE INDEX IF NOT EXISTS idx_receipt_vouchers_voucher_date ON receipt_vouchers(voucher_date DESC);
CREATE INDEX IF NOT EXISTS idx_receipt_vouchers_status ON receipt_vouchers(status);

-- ===================================================================
-- 3. RLS POLICIES FOR NEW TABLES
-- سياسات الأمان للجداول الجديدة
-- ===================================================================

-- RLS for sales_invoice_lines
-- Note: We wrap each policy in its own transaction to handle errors gracefully
DO $$
BEGIN
    -- Enable RLS on sales_invoice_lines
    EXECUTE 'ALTER TABLE IF EXISTS sales_invoice_lines ENABLE ROW LEVEL SECURITY';
    RAISE NOTICE 'Enabled RLS for sales_invoice_lines';
EXCEPTION
    WHEN undefined_table THEN
        RAISE NOTICE 'Table sales_invoice_lines does not exist, skipping RLS';
    WHEN OTHERS THEN
        RAISE NOTICE 'Could not enable RLS for sales_invoice_lines: %', SQLERRM;
END $$;

-- Drop existing policy
DO $$
BEGIN
    DROP POLICY IF EXISTS sales_invoice_lines_org_isolation ON sales_invoice_lines;
    RAISE NOTICE 'Dropped existing policy on sales_invoice_lines';
EXCEPTION
    WHEN undefined_table THEN
        RAISE NOTICE 'Table sales_invoice_lines does not exist';
    WHEN OTHERS THEN
        RAISE NOTICE 'Could not drop policy: %', SQLERRM;
END $$;

-- Create new policy
DO $$
BEGIN
    EXECUTE format($SQL$
        CREATE POLICY sales_invoice_lines_org_isolation ON sales_invoice_lines
            FOR ALL
            USING (
                invoice_id IN (
                    SELECT id FROM sales_invoices 
                    WHERE org_id = COALESCE(
                        current_setting('app.current_org_id', true)::uuid,
                        '00000000-0000-0000-0000-000000000001'::uuid
                    )
                )
            )
            WITH CHECK (
                invoice_id IN (
                    SELECT id FROM sales_invoices 
                    WHERE org_id = COALESCE(
                        current_setting('app.current_org_id', true)::uuid,
                        '00000000-0000-0000-0000-000000000001'::uuid
                    )
                )
            )
    $SQL$);
    RAISE NOTICE 'Created RLS policy for sales_invoice_lines';
EXCEPTION
    WHEN undefined_table THEN
        RAISE NOTICE 'Table sales_invoice_lines does not exist, skipping policy creation';
    WHEN undefined_column THEN
        RAISE NOTICE 'Column invoice_id does not exist in sales_invoice_lines, skipping policy';
    WHEN OTHERS THEN
        RAISE NOTICE 'Could not create policy for sales_invoice_lines: %', SQLERRM;
END $$;

-- RLS for payment_vouchers
ALTER TABLE payment_vouchers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_vouchers_org_isolation ON payment_vouchers;
CREATE POLICY payment_vouchers_org_isolation ON payment_vouchers
    FOR ALL
    USING (org_id = COALESCE(
        current_setting('app.current_org_id', true)::uuid,
        '00000000-0000-0000-0000-000000000001'::uuid
    ))
    WITH CHECK (org_id = COALESCE(
        current_setting('app.current_org_id', true)::uuid,
        '00000000-0000-0000-0000-000000000001'::uuid
    ));

-- RLS for receipt_vouchers
ALTER TABLE receipt_vouchers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS receipt_vouchers_org_isolation ON receipt_vouchers;
CREATE POLICY receipt_vouchers_org_isolation ON receipt_vouchers
    FOR ALL
    USING (org_id = COALESCE(
        current_setting('app.current_org_id', true)::uuid,
        '00000000-0000-0000-0000-000000000001'::uuid
    ))
    WITH CHECK (org_id = COALESCE(
        current_setting('app.current_org_id', true)::uuid,
        '00000000-0000-0000-0000-000000000001'::uuid
    ));

-- ===================================================================
-- 4. HELPER FUNCTIONS FOR VOUCHERS
-- دوال مساعدة للسندات
-- ===================================================================

-- Function to generate next voucher number
CREATE OR REPLACE FUNCTION generate_voucher_number(
    p_voucher_type VARCHAR,
    p_org_id UUID
)
RETURNS VARCHAR AS $$
DECLARE
    v_next_number INTEGER;
    v_prefix VARCHAR;
BEGIN
    -- Set prefix based on voucher type
    v_prefix := CASE p_voucher_type
        WHEN 'RECEIPT' THEN 'RC'
        WHEN 'PAYMENT' THEN 'PV'
        ELSE 'VC'
    END;
    
    -- Get next number
    IF p_voucher_type = 'RECEIPT' THEN
        SELECT COALESCE(MAX(CAST(SUBSTRING(voucher_number FROM '[0-9]+') AS INTEGER)), 0) + 1
        INTO v_next_number
        FROM receipt_vouchers
        WHERE org_id = p_org_id
        AND voucher_number ~ ('^' || v_prefix || '[0-9]+$');
    ELSE
        SELECT COALESCE(MAX(CAST(SUBSTRING(voucher_number FROM '[0-9]+') AS INTEGER)), 0) + 1
        INTO v_next_number
        FROM payment_vouchers
        WHERE org_id = p_org_id
        AND voucher_number ~ ('^' || v_prefix || '[0-9]+$');
    END IF;
    
    -- Return formatted number
    RETURN v_prefix || LPAD(v_next_number::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===================================================================
-- 5. AUDIT TRIGGERS
-- محفزات التدقيق
-- ===================================================================

-- Create audit trigger function if it doesn't exist
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add triggers to new tables
DROP TRIGGER IF EXISTS update_sales_invoice_lines_updated_at ON sales_invoice_lines;
CREATE TRIGGER update_sales_invoice_lines_updated_at
    BEFORE UPDATE ON sales_invoice_lines
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_payment_vouchers_updated_at ON payment_vouchers;
CREATE TRIGGER update_payment_vouchers_updated_at
    BEFORE UPDATE ON payment_vouchers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS update_receipt_vouchers_updated_at ON receipt_vouchers;
CREATE TRIGGER update_receipt_vouchers_updated_at
    BEFORE UPDATE ON receipt_vouchers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- ===================================================================
-- SUMMARY / الملخص
-- ===================================================================

DO $$
BEGIN
    RAISE NOTICE '==================================================';
    RAISE NOTICE '✅ Phase B Complete!';
    RAISE NOTICE '';
    RAISE NOTICE 'Sales Module:';
    RAISE NOTICE '  - sales_invoices updated';
    RAISE NOTICE '  - sales_invoice_lines created';
    RAISE NOTICE '  - Indexes added';
    RAISE NOTICE '';
    RAISE NOTICE 'Payment Vouchers:';
    RAISE NOTICE '  - payment_vouchers created (سندات الصرف)';
    RAISE NOTICE '  - receipt_vouchers created (سندات القبض)';
    RAISE NOTICE '  - Helper functions added';
    RAISE NOTICE '';
    RAISE NOTICE 'Security:';
    RAISE NOTICE '  - RLS policies applied';
    RAISE NOTICE '  - Audit triggers added';
    RAISE NOTICE '';
    RAISE NOTICE '⚠️  REMINDER: Create "documents" bucket in Storage!';
    RAISE NOTICE '==================================================';
END $$;

