-- ===================================================================
-- إصلاح أخطاء Journal Entries و Attachments
-- Fix Journal Entries and Attachments Errors
-- ===================================================================
-- تاريخ: 2025-01-17
-- الهدف: إصلاح 406, 400, 403 errors في Journal Entries
-- ===================================================================

-- ===================================================================
-- 1. إنشاء جدول journal_entry_attachments إذا لم يكن موجوداً
-- ===================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'journal_entry_attachments'
    ) THEN
        CREATE TABLE journal_entry_attachments (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            entry_id UUID NOT NULL,
            file_name TEXT NOT NULL,
            file_path TEXT NOT NULL,
            file_size INTEGER,
            file_type TEXT,
            uploaded_by UUID,
            org_id UUID NOT NULL,
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ DEFAULT now()
        );
        
        -- Index for performance
        CREATE INDEX idx_journal_attachments_entry ON journal_entry_attachments(entry_id);
        CREATE INDEX idx_journal_attachments_org ON journal_entry_attachments(org_id);
        
        RAISE NOTICE 'Created journal_entry_attachments table';
    ELSE
        RAISE NOTICE 'journal_entry_attachments table already exists';
    END IF;
END $$;

-- ===================================================================
-- 2. إضافة org_id إلى journal_entry_attachments إذا لم يكن موجوداً
-- ===================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'journal_entry_attachments' 
        AND column_name = 'org_id'
    ) THEN
        ALTER TABLE journal_entry_attachments 
        ADD COLUMN org_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid;
        
        CREATE INDEX IF NOT EXISTS idx_journal_attachments_org 
        ON journal_entry_attachments(org_id);
        
        RAISE NOTICE 'Added org_id column to journal_entry_attachments';
    ELSE
        RAISE NOTICE 'org_id column already exists in journal_entry_attachments';
    END IF;
END $$;

-- ===================================================================
-- 3. RLS Policies لـ journal_entry_attachments
-- ===================================================================
ALTER TABLE journal_entry_attachments ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS journal_attachments_org_isolation ON journal_entry_attachments;
DROP POLICY IF EXISTS journal_attachments_select ON journal_entry_attachments;
DROP POLICY IF EXISTS journal_attachments_insert ON journal_entry_attachments;
DROP POLICY IF EXISTS journal_attachments_update ON journal_entry_attachments;
DROP POLICY IF EXISTS journal_attachments_delete ON journal_entry_attachments;

-- Create comprehensive policy
CREATE POLICY journal_attachments_org_isolation 
ON journal_entry_attachments
FOR ALL
USING (org_id::text = current_setting('app.current_org_id', true))
WITH CHECK (org_id::text = current_setting('app.current_org_id', true));

DO $$ BEGIN
    RAISE NOTICE 'Created RLS policies for journal_entry_attachments';
END $$;

-- ===================================================================
-- 4. إصلاح gl_entry_lines: إضافة account_code إذا لم يكن موجوداً
-- ===================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'gl_entry_lines' 
        AND column_name = 'account_code'
    ) THEN
        ALTER TABLE gl_entry_lines 
        ADD COLUMN account_code TEXT;
        
        -- Update existing records
        UPDATE gl_entry_lines el
        SET account_code = ga.code
        FROM gl_accounts ga
        WHERE el.account_id = ga.id
        AND el.account_code IS NULL;
        
        CREATE INDEX IF NOT EXISTS idx_gl_entry_lines_account_code 
        ON gl_entry_lines(account_code);
        
        RAISE NOTICE 'Added account_code column to gl_entry_lines';
    ELSE
        RAISE NOTICE 'account_code column already exists in gl_entry_lines';
    END IF;
END $$;

-- ===================================================================
-- 5. إنشاء journals table إذا لم يكن موجوداً
-- ===================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'journals'
    ) THEN
        CREATE TABLE journals (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            code TEXT NOT NULL,
            name TEXT NOT NULL,
            name_ar TEXT,
            journal_type TEXT,
            is_active BOOLEAN DEFAULT true,
            org_id UUID NOT NULL,
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ DEFAULT now(),
            UNIQUE(org_id, code)
        );
        
        -- Insert default journals
        INSERT INTO journals (code, name, name_ar, journal_type, org_id)
        SELECT 
            'GEN', 'General Journal', 'قيد عام', 'general', o.id
        FROM organizations o
        WHERE NOT EXISTS (
            SELECT 1 FROM journals j WHERE j.org_id = o.id AND j.code = 'GEN'
        );
        
        -- Enable RLS
        ALTER TABLE journals ENABLE ROW LEVEL SECURITY;
        
        CREATE POLICY journals_org_isolation ON journals
        FOR ALL
        USING (org_id::text = current_setting('app.current_org_id', true))
        WITH CHECK (org_id::text = current_setting('app.current_org_id', true));
        
        RAISE NOTICE 'Created journals table';
    ELSE
        RAISE NOTICE 'journals table already exists';
    END IF;
END $$;

-- ===================================================================
-- 6. إضافة journal_id إلى gl_entries إذا لم يكن موجوداً
-- ===================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'gl_entries' 
        AND column_name = 'journal_id'
    ) THEN
        ALTER TABLE gl_entries 
        ADD COLUMN journal_id UUID;
        
        -- Update existing records with default journal
        UPDATE gl_entries e
        SET journal_id = j.id
        FROM journals j
        WHERE j.code = 'GEN' 
        AND j.org_id = e.org_id
        AND e.journal_id IS NULL;
        
        -- Add foreign key (optional, may fail if journals don't exist)
        BEGIN
            ALTER TABLE gl_entries 
            ADD CONSTRAINT fk_gl_entries_journal 
            FOREIGN KEY (journal_id) REFERENCES journals(id);
        EXCEPTION
            WHEN OTHERS THEN
                RAISE NOTICE 'Could not add foreign key for journal_id: %', SQLERRM;
        END;
        
        RAISE NOTICE 'Added journal_id column to gl_entries';
    ELSE
        RAISE NOTICE 'journal_id column already exists in gl_entries';
    END IF;
END $$;

-- ===================================================================
-- 7. تحديث journal_entries view لتضمين journals relationship
-- ===================================================================
DO $$
DECLARE
    v_table_type TEXT;
BEGIN
    -- Check if journal_entries exists and what type it is
    SELECT table_type INTO v_table_type
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'journal_entries';
    
    -- Drop based on type
    IF v_table_type = 'VIEW' THEN
        DROP VIEW IF EXISTS journal_entries CASCADE;
        RAISE NOTICE 'Dropped existing journal_entries view';
    ELSIF v_table_type = 'BASE TABLE' THEN
        -- It's a table, skip creating view
        RAISE NOTICE 'journal_entries is a table, skipping view creation';
        RETURN;
    END IF;
    
    -- Recreate view with journals relationship (only if gl_entries exists)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'gl_entries') THEN
        CREATE OR REPLACE VIEW journal_entries AS
        SELECT 
            e.id,
            e.org_id,
            e.entry_date,
            e.reference,
            e.description,
            e.status,
            e.created_by,
            e.created_at,
            e.updated_at,
            e.journal_id,
            e.org_id as tenant_id,
            -- Add journals data inline (simulating join)
            COALESCE(j.name, 'General Journal') as journal_name,
            COALESCE(j.name_ar, 'قيد عام') as journal_name_ar
        FROM gl_entries e
        LEFT JOIN journals j ON e.journal_id = j.id;
        
        RAISE NOTICE 'Created journal_entries view with journals relationship';
    END IF;
END $$;

-- ===================================================================
-- 8. تحديث journal_lines view لتضمين gl_accounts relationship
-- ===================================================================
DO $$
DECLARE
    v_table_type TEXT;
BEGIN
    -- Check if journal_lines exists and what type it is
    SELECT table_type INTO v_table_type
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'journal_lines';
    
    -- Drop based on type
    IF v_table_type = 'VIEW' THEN
        DROP VIEW IF EXISTS journal_lines CASCADE;
        RAISE NOTICE 'Dropped existing journal_lines view';
    ELSIF v_table_type = 'BASE TABLE' THEN
        -- It's a table, skip creating view
        RAISE NOTICE 'journal_lines is a table, skipping view creation';
        RETURN;
    END IF;
    
    -- Recreate view with gl_accounts relationship (only if gl_entry_lines exists)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'gl_entry_lines') THEN
        CREATE OR REPLACE VIEW journal_lines AS
        SELECT 
            el.id,
            el.entry_id,
            el.account_id,
            el.debit,
            el.credit,
            el.description,
            el.line_number,
            el.org_id,
            el.created_at,
            -- Add gl_accounts data inline (simulating join)
            COALESCE(ga.code, '') as account_code,
            COALESCE(ga.name, '') as account_name,
            COALESCE(ga.name_ar, ga.name, '') as account_name_ar
        FROM gl_entry_lines el
        LEFT JOIN gl_accounts ga ON el.account_id = ga.id;
        
        RAISE NOTICE 'Created journal_lines view with gl_accounts relationship';
    END IF;
END $$;

-- ===================================================================
-- 9. Audit Trigger لـ journal_entry_attachments
-- ===================================================================
CREATE OR REPLACE FUNCTION update_journal_attachments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_journal_attachments_updated_at ON journal_entry_attachments;

CREATE TRIGGER trigger_journal_attachments_updated_at
    BEFORE UPDATE ON journal_entry_attachments
    FOR EACH ROW
    EXECUTE FUNCTION update_journal_attachments_updated_at();

-- ===================================================================
-- 10. Verification Queries
-- ===================================================================
DO $$
BEGIN
    RAISE NOTICE '=== Verification Results ===';
    RAISE NOTICE 'journal_entry_attachments exists: %', 
        EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'journal_entry_attachments');
    RAISE NOTICE 'journals exists: %', 
        EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'journals');
    RAISE NOTICE 'journal_entries view exists: %', 
        EXISTS(SELECT 1 FROM information_schema.views WHERE table_name = 'journal_entries');
    RAISE NOTICE 'journal_lines view exists: %', 
        EXISTS(SELECT 1 FROM information_schema.views WHERE table_name = 'journal_lines');
    RAISE NOTICE '=== Script Completed Successfully ===';
END $$;

