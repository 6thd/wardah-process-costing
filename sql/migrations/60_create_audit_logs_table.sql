-- =====================================
-- Create/Verify Audit Logs Table
-- =====================================
-- This migration ensures the audit_logs table exists with proper structure
-- If table already exists, it will verify the structure

BEGIN;

-- Check if table exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'audit_logs'
    ) THEN
        -- Create audit_logs table
        CREATE TABLE audit_logs (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
            action VARCHAR(50) NOT NULL,
            entity_type VARCHAR(50) NOT NULL,
            entity_id TEXT,
            old_data JSONB,
            new_data JSONB,
            changes JSONB,
            metadata JSONB,
            ip_address INET,
            user_agent TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            
            -- Indexes for performance
            CONSTRAINT audit_logs_action_check CHECK (
                action IN (
                    'create', 'update', 'delete', 'view', 'export',
                    'login', 'logout', 'approve', 'reject', 'cancel',
                    'complete', 'start', 'stop', 'import', 'backup',
                    'restore', 'permission_change', 'role_assignment',
                    'role_removal', 'settings_change'
                )
            )
        );

        -- Create indexes
        CREATE INDEX idx_audit_logs_org_id ON audit_logs(org_id);
        CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
        CREATE INDEX idx_audit_logs_action ON audit_logs(action);
        CREATE INDEX idx_audit_logs_entity_type ON audit_logs(entity_type);
        CREATE INDEX idx_audit_logs_entity_id ON audit_logs(entity_id);
        CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);
        CREATE INDEX idx_audit_logs_org_created ON audit_logs(org_id, created_at DESC);

        -- Composite index for common queries
        CREATE INDEX idx_audit_logs_org_entity ON audit_logs(org_id, entity_type, created_at DESC);

        RAISE NOTICE '✓ Created audit_logs table';
    ELSE
        RAISE NOTICE '✓ audit_logs table already exists';
        
        -- Verify structure and add missing columns/indexes
        -- Add ip_address if missing
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'audit_logs' 
            AND column_name = 'ip_address'
        ) THEN
            ALTER TABLE audit_logs ADD COLUMN ip_address INET;
            RAISE NOTICE '✓ Added ip_address column';
        END IF;
        
        -- Add user_agent if missing
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'audit_logs' 
            AND column_name = 'user_agent'
        ) THEN
            ALTER TABLE audit_logs ADD COLUMN user_agent TEXT;
            RAISE NOTICE '✓ Added user_agent column';
        END IF;
        
        -- Create indexes if missing
        IF NOT EXISTS (
            SELECT 1 FROM pg_indexes 
            WHERE tablename = 'audit_logs' 
            AND indexname = 'idx_audit_logs_org_created'
        ) THEN
            CREATE INDEX idx_audit_logs_org_created ON audit_logs(org_id, created_at DESC);
            RAISE NOTICE '✓ Created composite index';
        END IF;
        
        RAISE NOTICE 'Audit logs table setup completed.';
    END IF;
END $$;

-- Enable RLS
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "audit_logs_select" ON audit_logs;
DROP POLICY IF EXISTS "audit_logs_insert" ON audit_logs;
DROP POLICY IF EXISTS "audit_logs_super_admin" ON audit_logs;

-- SELECT policy: Users can view their org's audit logs
CREATE POLICY "audit_logs_select" ON audit_logs
    FOR SELECT USING (
        org_id = auth_org_id()
        OR is_super_admin()
    );

-- INSERT policy: System can insert audit logs
CREATE POLICY "audit_logs_insert" ON audit_logs
    FOR INSERT WITH CHECK (
        org_id = auth_org_id()
        OR is_super_admin()
    );

-- Super admin can view all
CREATE POLICY "audit_logs_super_admin" ON audit_logs
    FOR ALL USING (is_super_admin());

COMMIT;

