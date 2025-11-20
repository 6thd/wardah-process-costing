-- ===================================================================
-- RLS POLICIES FOR ENHANCED TABLES
-- ===================================================================

-- ===================================================================
-- JOURNAL ENTRY APPROVALS
-- ===================================================================
DROP POLICY IF EXISTS journal_entry_approvals_tenant_isolation ON journal_entry_approvals;
CREATE POLICY journal_entry_approvals_tenant_isolation 
ON journal_entry_approvals
FOR ALL 
USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

-- ===================================================================
-- JOURNAL APPROVAL RULES
-- ===================================================================
DROP POLICY IF EXISTS journal_approval_rules_tenant_isolation ON journal_approval_rules;
CREATE POLICY journal_approval_rules_tenant_isolation 
ON journal_approval_rules
FOR ALL 
USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

-- ===================================================================
-- JOURNAL ENTRY ATTACHMENTS
-- ===================================================================
DROP POLICY IF EXISTS journal_entry_attachments_tenant_isolation ON journal_entry_attachments;
CREATE POLICY journal_entry_attachments_tenant_isolation 
ON journal_entry_attachments
FOR ALL 
USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

-- ===================================================================
-- JOURNAL ENTRY COMMENTS
-- ===================================================================
DROP POLICY IF EXISTS journal_entry_comments_tenant_isolation ON journal_entry_comments;
CREATE POLICY journal_entry_comments_tenant_isolation 
ON journal_entry_comments
FOR ALL 
USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

-- ===================================================================
-- COST CENTERS
-- ===================================================================
DROP POLICY IF EXISTS cost_centers_tenant_isolation ON cost_centers;
CREATE POLICY cost_centers_tenant_isolation 
ON cost_centers
FOR ALL 
USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

-- ===================================================================
-- PROFIT CENTERS
-- ===================================================================
DROP POLICY IF EXISTS profit_centers_tenant_isolation ON profit_centers;
CREATE POLICY profit_centers_tenant_isolation 
ON profit_centers
FOR ALL 
USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

-- ===================================================================
-- ACCOUNT SEGMENTS
-- ===================================================================
DROP POLICY IF EXISTS account_segments_tenant_isolation ON account_segments;
CREATE POLICY account_segments_tenant_isolation 
ON account_segments
FOR ALL 
USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

-- ===================================================================
-- CURRENCY EXCHANGE RATES
-- ===================================================================
DROP POLICY IF EXISTS currency_exchange_rates_tenant_isolation ON currency_exchange_rates;
CREATE POLICY currency_exchange_rates_tenant_isolation 
ON currency_exchange_rates
FOR ALL 
USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

-- ===================================================================
-- CURRENCY TRANSLATIONS
-- ===================================================================
DROP POLICY IF EXISTS currency_translations_tenant_isolation ON currency_translations;
CREATE POLICY currency_translations_tenant_isolation 
ON currency_translations
FOR ALL 
USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

-- ===================================================================
-- ACCOUNT RECONCILIATIONS
-- ===================================================================
DROP POLICY IF EXISTS account_reconciliations_tenant_isolation ON account_reconciliations;
CREATE POLICY account_reconciliations_tenant_isolation 
ON account_reconciliations
FOR ALL 
USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

-- ===================================================================
-- RECONCILIATION ITEMS
-- ===================================================================
DROP POLICY IF EXISTS reconciliation_items_tenant_isolation ON reconciliation_items;
CREATE POLICY reconciliation_items_tenant_isolation 
ON reconciliation_items
FOR ALL 
USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

-- ===================================================================
-- VERIFICATION QUERIES
-- ===================================================================

-- التحقق من تفعيل RLS
SELECT 
    tablename, 
    rowsecurity,
    CASE WHEN rowsecurity THEN '✅ Enabled' ELSE '❌ Disabled' END as status
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN (
  'journal_entry_approvals',
  'journal_approval_rules',
  'journal_entry_attachments',
  'journal_entry_comments',
  'cost_centers',
  'profit_centers',
  'account_segments',
  'currency_exchange_rates',
  'currency_translations',
  'account_reconciliations',
  'reconciliation_items'
)
ORDER BY tablename;

-- التحقق من وجود Policies
SELECT 
    t.schemaname,
    t.tablename,
    p.policyname,
    CASE WHEN p.policyname IS NOT NULL THEN '✅ Policy exists' ELSE '❌ No policy' END as status
FROM pg_tables t
LEFT JOIN pg_policies p ON t.tablename = p.tablename AND t.schemaname = p.schemaname
WHERE t.schemaname = 'public' 
AND t.tablename IN (
  'journal_entry_approvals',
  'journal_approval_rules',
  'journal_entry_attachments',
  'journal_entry_comments',
  'cost_centers',
  'profit_centers',
  'account_segments',
  'currency_exchange_rates',
  'currency_translations',
  'account_reconciliations',
  'reconciliation_items'
)
ORDER BY t.tablename, p.policyname;

