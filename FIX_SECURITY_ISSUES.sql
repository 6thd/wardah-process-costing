-- FIX_SECURITY_ISSUES.sql
-- Script to address security issues found in Supabase CSV logs

-- 1. Enable RLS on gl_accounts tables
ALTER TABLE public.gl_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gl_accounts_backup ENABLE ROW LEVEL SECURITY;

-- 2. Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can read gl_accounts" ON public.gl_accounts;
DROP POLICY IF EXISTS "Users can insert gl_accounts" ON public.gl_accounts;
DROP POLICY IF EXISTS "Users can update gl_accounts" ON public.gl_accounts;
DROP POLICY IF EXISTS "Users can delete gl_accounts" ON public.gl_accounts;

DROP POLICY IF EXISTS "Users can read gl_accounts_backup" ON public.gl_accounts_backup;
DROP POLICY IF EXISTS "Users can insert gl_accounts_backup" ON public.gl_accounts_backup;
DROP POLICY IF EXISTS "Users can update gl_accounts_backup" ON public.gl_accounts_backup;
DROP POLICY IF EXISTS "Users can delete gl_accounts_backup" ON public.gl_accounts_backup;

-- 3. Create basic RLS policies for gl_accounts (adjust as needed for your business logic)
-- Allow authenticated users to read gl_accounts
CREATE POLICY "Users can read gl_accounts" ON public.gl_accounts
FOR SELECT USING (auth.role() = 'authenticated');

-- Allow authenticated users to insert gl_accounts
CREATE POLICY "Users can insert gl_accounts" ON public.gl_accounts
FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Allow authenticated users to update gl_accounts
CREATE POLICY "Users can update gl_accounts" ON public.gl_accounts
FOR UPDATE USING (auth.role() = 'authenticated');

-- Allow authenticated users to delete gl_accounts
CREATE POLICY "Users can delete gl_accounts" ON public.gl_accounts
FOR DELETE USING (auth.role() = 'authenticated');

-- Repeat for gl_accounts_backup
CREATE POLICY "Users can read gl_accounts_backup" ON public.gl_accounts_backup
FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Users can insert gl_accounts_backup" ON public.gl_accounts_backup
FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Users can update gl_accounts_backup" ON public.gl_accounts_backup
FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Users can delete gl_accounts_backup" ON public.gl_accounts_backup
FOR DELETE USING (auth.role() = 'authenticated');

-- 3. Fix function search_path issues by setting search_path for each function
-- First, let's check what these functions do and set appropriate search paths
-- For auth_org_id function
ALTER FUNCTION public.auth_org_id() SET search_path = public, pg_temp;

-- For import_gl_mappings function
ALTER FUNCTION public.import_gl_mappings() SET search_path = public, pg_temp;

-- For has_any_role function
ALTER FUNCTION public.has_any_role() SET search_path = public, pg_temp;

-- For has_org_role function
ALTER FUNCTION public.has_org_role() SET search_path = public, pg_temp;

-- For import_chart_of_accounts function
ALTER FUNCTION public.import_chart_of_accounts() SET search_path = public, pg_temp;

-- 4. Address tables with RLS enabled but no policies
-- We'll create basic policies for each table (you may need to adjust based on your business logic)

-- bom_headers
CREATE POLICY "Users can read bom_headers" ON public.bom_headers
FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Users can insert bom_headers" ON public.bom_headers
FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Users can update bom_headers" ON public.bom_headers
FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Users can delete bom_headers" ON public.bom_headers
FOR DELETE USING (auth.role() = 'authenticated');

-- bom_lines
CREATE POLICY "Users can read bom_lines" ON public.bom_lines
FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Users can insert bom_lines" ON public.bom_lines
FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Users can update bom_lines" ON public.bom_lines
FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Users can delete bom_lines" ON public.bom_lines
FOR DELETE USING (auth.role() = 'authenticated');

-- cost_settings
CREATE POLICY "Users can read cost_settings" ON public.cost_settings
FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Users can insert cost_settings" ON public.cost_settings
FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Users can update cost_settings" ON public.cost_settings
FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Users can delete cost_settings" ON public.cost_settings
FOR DELETE USING (auth.role() = 'authenticated');

-- customers
CREATE POLICY "Users can read customers" ON public.customers
FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Users can insert customers" ON public.customers
FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Users can update customers" ON public.customers
FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Users can delete customers" ON public.customers
FOR DELETE USING (auth.role() = 'authenticated');

-- grns
CREATE POLICY "Users can read grns" ON public.grns
FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Users can insert grns" ON public.grns
FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Users can update grns" ON public.grns
FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Users can delete grns" ON public.grns
FOR DELETE USING (auth.role() = 'authenticated');

-- labor_entries
CREATE POLICY "Users can read labor_entries" ON public.labor_entries
FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Users can insert labor_entries" ON public.labor_entries
FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Users can update labor_entries" ON public.labor_entries
FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Users can delete labor_entries" ON public.labor_entries
FOR DELETE USING (auth.role() = 'authenticated');

-- manufacturing_orders
CREATE POLICY "Users can read manufacturing_orders" ON public.manufacturing_orders
FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Users can insert manufacturing_orders" ON public.manufacturing_orders
FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Users can update manufacturing_orders" ON public.manufacturing_orders
FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Users can delete manufacturing_orders" ON public.manufacturing_orders
FOR DELETE USING (auth.role() = 'authenticated');

-- overhead_allocations
CREATE POLICY "Users can read overhead_allocations" ON public.overhead_allocations
FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Users can insert overhead_allocations" ON public.overhead_allocations
FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Users can update overhead_allocations" ON public.overhead_allocations
FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Users can delete overhead_allocations" ON public.overhead_allocations
FOR DELETE USING (auth.role() = 'authenticated');

-- overhead_rates
CREATE POLICY "Users can read overhead_rates" ON public.overhead_rates
FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Users can insert overhead_rates" ON public.overhead_rates
FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Users can update overhead_rates" ON public.overhead_rates
FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Users can delete overhead_rates" ON public.overhead_rates
FOR DELETE USING (auth.role() = 'authenticated');

-- purchase_lines
CREATE POLICY "Users can read purchase_lines" ON public.purchase_lines
FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Users can insert purchase_lines" ON public.purchase_lines
FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Users can update purchase_lines" ON public.purchase_lines
FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Users can delete purchase_lines" ON public.purchase_lines
FOR DELETE USING (auth.role() = 'authenticated');

-- purchase_orders
CREATE POLICY "Users can read purchase_orders" ON public.purchase_orders
FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Users can insert purchase_orders" ON public.purchase_orders
FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Users can update purchase_orders" ON public.purchase_orders
FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Users can delete purchase_orders" ON public.purchase_orders
FOR DELETE USING (auth.role() = 'authenticated');

-- sales_lines
CREATE POLICY "Users can read sales_lines" ON public.sales_lines
FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Users can insert sales_lines" ON public.sales_lines
FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Users can update sales_lines" ON public.sales_lines
FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Users can delete sales_lines" ON public.sales_lines
FOR DELETE USING (auth.role() = 'authenticated');

-- sales_orders
CREATE POLICY "Users can read sales_orders" ON public.sales_orders
FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Users can insert sales_orders" ON public.sales_orders
FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Users can update sales_orders" ON public.sales_orders
FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Users can delete sales_orders" ON public.sales_orders
FOR DELETE USING (auth.role() = 'authenticated');

-- stage_costs
CREATE POLICY "Users can read stage_costs" ON public.stage_costs
FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Users can insert stage_costs" ON public.stage_costs
FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Users can update stage_costs" ON public.stage_costs
FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Users can delete stage_costs" ON public.stage_costs
FOR DELETE USING (auth.role() = 'authenticated');

-- stock_moves
CREATE POLICY "Users can read stock_moves" ON public.stock_moves
FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Users can insert stock_moves" ON public.stock_moves
FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Users can update stock_moves" ON public.stock_moves
FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Users can delete stock_moves" ON public.stock_moves
FOR DELETE USING (auth.role() = 'authenticated');

-- stock_quants
CREATE POLICY "Users can read stock_quants" ON public.stock_quants
FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Users can insert stock_quants" ON public.stock_quants
FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Users can update stock_quants" ON public.stock_quants
FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Users can delete stock_quants" ON public.stock_quants
FOR DELETE USING (auth.role() = 'authenticated');

-- uoms
CREATE POLICY "Users can read uoms" ON public.uoms
FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Users can insert uoms" ON public.uoms
FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Users can update uoms" ON public.uoms
FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Users can delete uoms" ON public.uoms
FOR DELETE USING (auth.role() = 'authenticated');

-- vendors
CREATE POLICY "Users can read vendors" ON public.vendors
FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Users can insert vendors" ON public.vendors
FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Users can update vendors" ON public.vendors
FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Users can delete vendors" ON public.vendors
FOR DELETE USING (auth.role() = 'authenticated');

-- warehouses
CREATE POLICY "Users can read warehouses" ON public.warehouses
FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Users can insert warehouses" ON public.warehouses
FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Users can update warehouses" ON public.warehouses
FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Users can delete warehouses" ON public.warehouses
FOR DELETE USING (auth.role() = 'authenticated');

-- work_centers
CREATE POLICY "Users can read work_centers" ON public.work_centers
FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Users can insert work_centers" ON public.work_centers
FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Users can update work_centers" ON public.work_centers
FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Users can delete work_centers" ON public.work_centers
FOR DELETE USING (auth.role() = 'authenticated');

-- 5. Enable leaked password protection and MFA in Supabase Auth settings
-- Note: These settings need to be configured in the Supabase Dashboard, not via SQL
-- Go to Supabase Dashboard -> Authentication -> Settings to enable:
-- - Password strength and leaked password protection
-- - Additional MFA options

-- 6. Move ltree extension to a separate schema (optional but recommended)
-- This requires more careful handling and may affect existing code
-- CREATE SCHEMA extensions;
-- ALTER EXTENSION ltree SET SCHEMA extensions;