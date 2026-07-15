CREATE TABLE IF NOT EXISTS public.categories (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    code text NOT NULL,
    name text NOT NULL,
    name_ar text NOT NULL,
    description text,
    parent_id uuid REFERENCES categories(id) ON DELETE SET NULL,
    tenant_id uuid NOT NULL,
    is_active boolean DEFAULT true,
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, code)
);

ALTER TABLE public.categories
ADD CONSTRAINT categories_pkey PRIMARY KEY (id);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_categories_tenant_id ON public.categories(tenant_id);
CREATE INDEX IF NOT EXISTS idx_categories_code ON public.categories(tenant_id, code);
CREATE INDEX IF NOT EXISTS idx_categories_parent_id ON public.categories(parent_id);

-- Enable Row Level Security
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for categories
DROP POLICY IF EXISTS tenant_select_categories ON public.categories;
CREATE POLICY tenant_select_categories ON public.categories
  FOR SELECT 
  USING (tenant_id = get_current_tenant_id());

DROP POLICY IF EXISTS tenant_insert_categories ON public.categories;
CREATE POLICY tenant_insert_categories ON public.categories
  FOR INSERT 
  WITH CHECK (
    tenant_id = get_current_tenant_id() AND
    get_current_user_role() IN ('admin', 'manager')
  );

DROP POLICY IF EXISTS tenant_update_categories ON public.categories;
CREATE POLICY tenant_update_categories ON public.categories
  FOR UPDATE 
  USING (tenant_id = get_current_tenant_id())
  WITH CHECK (
    tenant_id = get_current_tenant_id() AND
    get_current_user_role() IN ('admin', 'manager')
  );

DROP POLICY IF EXISTS tenant_delete_categories ON public.categories;
CREATE POLICY tenant_delete_categories ON public.categories
  FOR DELETE 
  USING (
    tenant_id = get_current_tenant_id() AND
    get_current_user_role() = 'admin'
  );

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE categories_id_seq TO authenticated;