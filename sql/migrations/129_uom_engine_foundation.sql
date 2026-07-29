-- migration_number: 129
-- description: Add the normalized UoM catalog, product-specific conversions,
--              aliases, audit issues and document conversion snapshots.
-- safety: additive only. No legacy text unit is deleted or overwritten.

CREATE TABLE IF NOT EXISTS public.uom_categories (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  name_ar text,
  dimension text NOT NULL,
  is_system boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uom_categories_code_format CHECK (code ~ '^[A-Z][A-Z0-9_]*$'),
  CONSTRAINT uom_categories_dimension_check
    CHECK (dimension IN ('count','mass','volume','length','area','time','other'))
);

CREATE TABLE IF NOT EXISTS public.uoms (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_id uuid NOT NULL REFERENCES public.uom_categories(id),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  name_ar text,
  symbol text NOT NULL,
  factor_to_category_base numeric(30,12),
  is_category_base boolean NOT NULL DEFAULT false,
  is_product_specific boolean NOT NULL DEFAULT false,
  decimal_places smallint NOT NULL DEFAULT 6,
  rounding_mode text NOT NULL DEFAULT 'HALF_UP',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uoms_code_format CHECK (code ~ '^[A-Z][A-Z0-9_]*$'),
  CONSTRAINT uoms_factor_check CHECK (
    (is_product_specific AND factor_to_category_base IS NULL)
    OR (NOT is_product_specific AND factor_to_category_base > 0)
  ),
  CONSTRAINT uoms_decimal_places_check CHECK (decimal_places BETWEEN 0 AND 12),
  CONSTRAINT uoms_rounding_mode_check CHECK (rounding_mode IN ('HALF_UP','HALF_EVEN','DOWN','UP'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_uoms_one_category_base
  ON public.uoms(category_id)
  WHERE is_category_base AND is_active;

CREATE TABLE IF NOT EXISTS public.uom_aliases (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  alias_normalized text NOT NULL UNIQUE,
  alias_display text NOT NULL,
  uom_id uuid NOT NULL REFERENCES public.uoms(id),
  source text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.product_uom_conversions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  product_id uuid NOT NULL REFERENCES public.products(id),
  uom_id uuid NOT NULL REFERENCES public.uoms(id),
  factor_to_base numeric(30,12) NOT NULL,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  use_for_purchase boolean NOT NULL DEFAULT false,
  use_for_sale boolean NOT NULL DEFAULT false,
  barcode text,
  notes text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_uom_factor_positive CHECK (factor_to_base > 0),
  CONSTRAINT product_uom_validity_check CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT product_uom_org_product_unique UNIQUE (id, org_id, product_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_product_uom_conversion_current
  ON public.product_uom_conversions(org_id, product_id, uom_id)
  WHERE is_active AND valid_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_product_uom_conversions_lookup
  ON public.product_uom_conversions(org_id, product_id, uom_id, valid_from DESC);

CREATE TABLE IF NOT EXISTS public.uom_backfill_issues (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id uuid REFERENCES public.organizations(id),
  source_table text NOT NULL,
  source_id uuid,
  source_value text,
  issue_code text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'OPEN',
  resolved_uom_id uuid REFERENCES public.uoms(id),
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uom_backfill_issue_status_check CHECK (status IN ('OPEN','RESOLVED','IGNORED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_uom_backfill_open_issue
  ON public.uom_backfill_issues(source_table, source_id, issue_code)
  WHERE status = 'OPEN';

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS base_uom_id uuid REFERENCES public.uoms(id),
  ADD COLUMN IF NOT EXISTS uom_migration_status text NOT NULL DEFAULT 'PENDING';

ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS base_uom_id uuid REFERENCES public.uoms(id),
  ADD COLUMN IF NOT EXISTS uom_migration_status text NOT NULL DEFAULT 'PENDING';

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'purchase_order_lines','goods_receipt_lines','sales_invoice_lines',
    'delivery_note_lines','stock_adjustment_items','bom_lines',
    'material_reservations','stock_ledger_entries'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS uom_id uuid REFERENCES public.uoms(id)', v_table);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS qty_entered numeric(18,6)', v_table);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS conversion_factor_snapshot numeric(30,12)', v_table);
  END LOOP;
END
$$;

ALTER TABLE public.purchase_order_lines ADD COLUMN IF NOT EXISTS unit_price_entered numeric(18,6);
ALTER TABLE public.goods_receipt_lines ADD COLUMN IF NOT EXISTS unit_cost_entered numeric(18,6);
ALTER TABLE public.sales_invoice_lines ADD COLUMN IF NOT EXISTS unit_price_entered numeric(18,6);
ALTER TABLE public.delivery_note_lines
  ADD COLUMN IF NOT EXISTS unit_price_entered numeric(18,6),
  ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES public.warehouses(id);
ALTER TABLE public.stock_adjustment_items
  ADD COLUMN IF NOT EXISTS new_qty_entered numeric(18,6),
  ADD COLUMN IF NOT EXISTS current_qty_entered numeric(18,6);
ALTER TABLE public.bom_lines
  ADD COLUMN IF NOT EXISTS quantity_base numeric(18,6),
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.products(id);
ALTER TABLE public.material_reservations ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.products(id);
ALTER TABLE public.stock_ledger_entries ADD COLUMN IF NOT EXISTS source_line_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.products'::regclass AND conname='products_uom_migration_status_check') THEN
    ALTER TABLE public.products ADD CONSTRAINT products_uom_migration_status_check
      CHECK (uom_migration_status IN ('PENDING','MAPPED','AMBIGUOUS','NO_UNIT')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.items'::regclass AND conname='items_uom_migration_status_check') THEN
    ALTER TABLE public.items ADD CONSTRAINT items_uom_migration_status_check
      CHECK (uom_migration_status IN ('PENDING','MAPPED','AMBIGUOUS','NO_UNIT')) NOT VALID;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.uom_normalize_alias(p_value text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $function$
  SELECT upper(regexp_replace(trim(COALESCE(p_value, '')), '[[:space:]_.-]+', '', 'g'));
$function$;

ALTER TABLE public.uom_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.uoms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.uom_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_uom_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.uom_backfill_issues ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS uom_categories_read ON public.uom_categories;
CREATE POLICY uom_categories_read ON public.uom_categories FOR SELECT TO authenticated USING ((SELECT auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS uoms_read ON public.uoms;
CREATE POLICY uoms_read ON public.uoms FOR SELECT TO authenticated USING ((SELECT auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS uom_aliases_read ON public.uom_aliases;
CREATE POLICY uom_aliases_read ON public.uom_aliases FOR SELECT TO authenticated USING ((SELECT auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS product_uom_conversions_read ON public.product_uom_conversions;
CREATE POLICY product_uom_conversions_read ON public.product_uom_conversions FOR SELECT TO authenticated
  USING (org_id = public.wardah_org_id(NULL::uuid));
DROP POLICY IF EXISTS product_uom_conversions_write ON public.product_uom_conversions;
DROP POLICY IF EXISTS uom_backfill_issues_admin ON public.uom_backfill_issues;
CREATE POLICY uom_backfill_issues_admin ON public.uom_backfill_issues FOR ALL TO authenticated
  USING (org_id IS NOT NULL AND public.wardah_is_org_admin(org_id))
  WITH CHECK (org_id IS NOT NULL AND public.wardah_is_org_admin(org_id));

REVOKE INSERT, UPDATE, DELETE ON public.uom_categories, public.uoms, public.uom_aliases FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.product_uom_conversions FROM authenticated, anon;
GRANT SELECT ON public.uom_categories, public.uoms, public.uom_aliases TO authenticated;
GRANT SELECT ON public.product_uom_conversions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.uom_backfill_issues TO authenticated;

COMMENT ON TABLE public.product_uom_conversions IS
  'RPC-only time-bounded product conversion history. Authenticated clients may read current/history rows but cannot insert, overwrite or delete them directly.';
COMMENT ON COLUMN public.products.base_uom_id IS
  'Legal inventory unit. All SLE/bin quantities are stored in this unit.';