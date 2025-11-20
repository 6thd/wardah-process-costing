-- FIX_GL_ACCOUNTS_RLS_V2.sql
-- Updated script to enable and configure RLS for gl_accounts tables
-- This version first drops existing policies to avoid conflicts

-- Enable RLS on gl_accounts tables (this is safe to run even if already enabled)
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

-- Create RLS policies for gl_accounts
-- Allow authenticated users to read gl_accounts
CREATE POLICY "Users can read gl_accounts" ON public.gl_accounts
FOR SELECT USING (
  auth.role() = 'authenticated'
);

-- Allow authenticated users to insert gl_accounts
CREATE POLICY "Users can insert gl_accounts" ON public.gl_accounts
FOR INSERT WITH CHECK (
  auth.role() = 'authenticated'
);

-- Allow authenticated users to update gl_accounts
CREATE POLICY "Users can update gl_accounts" ON public.gl_accounts
FOR UPDATE USING (
  auth.role() = 'authenticated'
);

-- Allow authenticated users to delete gl_accounts
CREATE POLICY "Users can delete gl_accounts" ON public.gl_accounts
FOR DELETE USING (
  auth.role() = 'authenticated'
);

-- Create RLS policies for gl_accounts_backup
-- Allow authenticated users to read gl_accounts_backup
CREATE POLICY "Users can read gl_accounts_backup" ON public.gl_accounts_backup
FOR SELECT USING (
  auth.role() = 'authenticated'
);

-- Allow authenticated users to insert gl_accounts_backup
CREATE POLICY "Users can insert gl_accounts_backup" ON public.gl_accounts_backup
FOR INSERT WITH CHECK (
  auth.role() = 'authenticated'
);

-- Allow authenticated users to update gl_accounts_backup
CREATE POLICY "Users can update gl_accounts_backup" ON public.gl_accounts_backup
FOR UPDATE USING (
  auth.role() = 'authenticated'
);

-- Allow authenticated users to delete gl_accounts_backup
CREATE POLICY "Users can delete gl_accounts_backup" ON public.gl_accounts_backup
FOR DELETE USING (
  auth.role() = 'authenticated'
);

-- Grant necessary permissions
GRANT ALL ON TABLE public.gl_accounts TO authenticated;
GRANT ALL ON TABLE public.gl_accounts_backup TO authenticated;