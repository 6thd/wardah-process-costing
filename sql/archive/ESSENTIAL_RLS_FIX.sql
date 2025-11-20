-- ESSENTIAL_RLS_FIX.sql
-- Minimal script to fix RLS issues on gl_accounts tables

-- Enable RLS on gl_accounts tables
ALTER TABLE public.gl_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gl_accounts_backup ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can read gl_accounts" ON public.gl_accounts;
DROP POLICY IF EXISTS "Users can insert gl_accounts" ON public.gl_accounts;
DROP POLICY IF EXISTS "Users can update gl_accounts" ON public.gl_accounts;
DROP POLICY IF EXISTS "Users can delete gl_accounts" ON public.gl_accounts;

DROP POLICY IF EXISTS "Users can read gl_accounts_backup" ON public.gl_accounts_backup;
DROP POLICY IF EXISTS "Users can insert gl_accounts_backup" ON public.gl_accounts_backup;
DROP POLICY IF EXISTS "Users can update gl_accounts_backup" ON public.gl_accounts_backup;
DROP POLICY IF EXISTS "Users can delete gl_accounts_backup" ON public.gl_accounts_backup;

-- Create simple policies that allow all operations for authenticated users
CREATE POLICY "Users can read gl_accounts" ON public.gl_accounts FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Users can insert gl_accounts" ON public.gl_accounts FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Users can update gl_accounts" ON public.gl_accounts FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Users can delete gl_accounts" ON public.gl_accounts FOR DELETE USING (auth.role() = 'authenticated');

CREATE POLICY "Users can read gl_accounts_backup" ON public.gl_accounts_backup FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Users can insert gl_accounts_backup" ON public.gl_accounts_backup FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Users can update gl_accounts_backup" ON public.gl_accounts_backup FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Users can delete gl_accounts_backup" ON public.gl_accounts_backup FOR DELETE USING (auth.role() = 'authenticated');

-- Grant necessary permissions
GRANT ALL ON TABLE public.gl_accounts TO authenticated;
GRANT ALL ON TABLE public.gl_accounts_backup TO authenticated;