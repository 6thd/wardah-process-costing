CREATE TABLE IF NOT EXISTS journals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  code VARCHAR(20) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  name_ar VARCHAR(100),
  type VARCHAR(50) NOT NULL, -- e.g., 'general', 'sales', 'purchases', 'cash_receipt', 'cash_disbursement'
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  journal_id UUID REFERENCES journals(id) ON DELETE RESTRICT NOT NULL,
  entry_number VARCHAR(50) UNIQUE NOT NULL,
  entry_date DATE NOT NULL,
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'draft', -- 'draft', 'posted', 'reversed'
  total_debit NUMERIC(18, 6) NOT NULL,
  total_credit NUMERIC(18, 6) NOT NULL,
  posted_at TIMESTAMPTZ,
  reversed_at TIMESTAMPTZ,
  reference_number VARCHAR(100),
  created_by UUID,
  updated_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS journal_entry_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE CASCADE NOT NULL,
  account_code VARCHAR(50) NOT NULL,
  debit NUMERIC(18, 6) NOT NULL DEFAULT 0,
  credit NUMERIC(18, 6) NOT NULL DEFAULT 0,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
