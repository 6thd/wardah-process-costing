-- =======================================
-- إنشاء جداول gl_accounts و gl_mappings فقط
-- من wardah-migration-schema.sql
-- =======================================

-- Chart of Accounts (Enhanced)
CREATE TABLE IF NOT EXISTS gl_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    code VARCHAR(20) NOT NULL,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(50) NOT NULL CHECK (category IN ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE')),
    subtype VARCHAR(50) NOT NULL,
    parent_code VARCHAR(20),
    normal_balance VARCHAR(10) NOT NULL CHECK (normal_balance IN ('DEBIT', 'CREDIT')),
    allow_posting BOOLEAN DEFAULT true,
    is_active BOOLEAN DEFAULT true,
    currency VARCHAR(3) DEFAULT 'SAR',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, code)
);

-- GL Event Mappings (for automatic journal entries)
CREATE TABLE IF NOT EXISTS gl_mappings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    key_type VARCHAR(50) NOT NULL,
    key_value VARCHAR(100) NOT NULL,
    debit_account_code VARCHAR(20) NOT NULL,
    credit_account_code VARCHAR(20) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, key_type, key_value)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_gl_accounts_org ON gl_accounts(org_id);
CREATE INDEX IF NOT EXISTS idx_gl_accounts_code ON gl_accounts(org_id, code);
CREATE INDEX IF NOT EXISTS idx_gl_accounts_parent ON gl_accounts(org_id, parent_code);
CREATE INDEX IF NOT EXISTS idx_gl_mappings_org ON gl_mappings(org_id);
CREATE INDEX IF NOT EXISTS idx_gl_mappings_key ON gl_mappings(org_id, key_type, key_value);

SELECT 'تم إنشاء الجداول بنجاح' as status;
