-- migration_number: 130
-- description: Seed canonical UoMs, backfill only unambiguous legacy units and
--              widen legal quantity precision to numeric(18,6).
-- safety: ambiguous units are logged, never guessed. Numeric changes are widening.

INSERT INTO public.uom_categories(code, name, name_ar, dimension, is_system)
VALUES
  ('COUNT', 'Count', 'عدد', 'count', true),
  ('MASS', 'Mass', 'كتلة', 'mass', true),
  ('VOLUME', 'Volume', 'حجم', 'volume', true),
  ('LENGTH', 'Length', 'طول', 'length', true),
  ('AREA', 'Area', 'مساحة', 'area', true),
  ('TIME', 'Time', 'زمن', 'time', true)
ON CONFLICT (code) DO UPDATE
SET name=EXCLUDED.name, name_ar=EXCLUDED.name_ar,
    dimension=EXCLUDED.dimension, updated_at=now();

WITH c AS (SELECT id, code FROM public.uom_categories)
INSERT INTO public.uoms(category_id, code, name, name_ar, symbol,
  factor_to_category_base, is_category_base, is_product_specific, decimal_places)
SELECT c.id, x.code, x.name, x.name_ar, x.symbol,
       x.factor, x.is_base, x.product_specific, x.decimals
FROM c
JOIN (VALUES
  ('COUNT','PCS','Piece','قطعة','pcs',1::numeric,true,false,6::smallint),
  ('COUNT','DOZEN','Dozen','دستة','doz',12::numeric,false,false,6::smallint),
  ('COUNT','CARTON','Carton','كرتون','ctn',NULL::numeric,false,true,6::smallint),
  ('COUNT','BOX','Box','علبة','box',NULL::numeric,false,true,6::smallint),
  ('COUNT','BAG','Bag','كيس','bag',NULL::numeric,false,true,6::smallint),
  ('COUNT','ROLL','Roll','رول','roll',NULL::numeric,false,true,6::smallint),
  ('COUNT','PALLET','Pallet','طبلية','plt',NULL::numeric,false,true,6::smallint),
  ('MASS','KG','Kilogram','كيلوجرام','kg',1::numeric,true,false,6::smallint),
  ('MASS','G','Gram','جرام','g',0.001::numeric,false,false,6::smallint),
  ('MASS','TON','Metric ton','طن','t',1000::numeric,false,false,6::smallint),
  ('VOLUME','L','Litre','لتر','L',1::numeric,true,false,6::smallint),
  ('VOLUME','ML','Millilitre','ملليلتر','mL',0.001::numeric,false,false,6::smallint),
  ('LENGTH','M','Metre','متر','m',1::numeric,true,false,6::smallint),
  ('LENGTH','CM','Centimetre','سنتيمتر','cm',0.01::numeric,false,false,6::smallint),
  ('AREA','M2','Square metre','متر مربع','m²',1::numeric,true,false,6::smallint),
  ('TIME','HOUR','Hour','ساعة','h',1::numeric,true,false,6::smallint),
  ('TIME','MINUTE','Minute','دقيقة','min',0.016666666667::numeric,false,false,6::smallint)
) AS x(category_code,code,name,name_ar,symbol,factor,is_base,product_specific,decimals)
  ON x.category_code=c.code
ON CONFLICT (code) DO UPDATE
SET name=EXCLUDED.name, name_ar=EXCLUDED.name_ar, symbol=EXCLUDED.symbol,
    factor_to_category_base=EXCLUDED.factor_to_category_base,
    is_category_base=EXCLUDED.is_category_base,
    is_product_specific=EXCLUDED.is_product_specific,
    decimal_places=EXCLUDED.decimal_places, updated_at=now();

WITH aliases(alias_display, uom_code) AS (
  VALUES
    ('PCS','PCS'), ('PC','PCS'), ('PIECE','PCS'), ('PIECES','PCS'),
    ('قطعة','PCS'), ('قطع','PCS'), ('وحدة','PCS'), ('وحدات','PCS'),
    ('DOZEN','DOZEN'), ('دستة','DOZEN'),
    ('KG','KG'), ('KGS','KG'), ('KILOGRAM','KG'), ('KILOGRAMS','KG'),
    ('كجم','KG'), ('كغ','KG'), ('كيلو','KG'), ('كيلوجرام','KG'),
    ('G','G'), ('GRAM','G'), ('جرام','G'), ('جم','G'),
    ('TON','TON'), ('TONNE','TON'), ('طن','TON'),
    ('L','L'), ('LITER','L'), ('LITRE','L'), ('لتر','L'),
    ('ML','ML'), ('MILLILITER','ML'), ('مل','ML'),
    ('M','M'), ('METER','M'), ('METRE','M'), ('متر','M'),
    ('CM','CM'), ('CENTIMETER','CM'), ('سنتيمتر','CM'),
    ('M2','M2'), ('SQM','M2'), ('مترمربع','M2'),
    ('HOUR','HOUR'), ('HR','HOUR'), ('ساعة','HOUR'),
    ('MINUTE','MINUTE'), ('MIN','MINUTE'), ('دقيقة','MINUTE'),
    ('CARTON','CARTON'), ('CTN','CARTON'), ('كرتون','CARTON'),
    ('BOX','BOX'), ('علبة','BOX'), ('BAG','BAG'), ('كيس','BAG'),
    ('ROLL','ROLL'), ('رول','ROLL'), ('PALLET','PALLET'), ('طبلية','PALLET')
)
INSERT INTO public.uom_aliases(alias_normalized, alias_display, uom_id, source)
SELECT public.uom_normalize_alias(a.alias_display), a.alias_display, u.id, 'system'
FROM aliases a JOIN public.uoms u ON u.code=a.uom_code
ON CONFLICT (alias_normalized) DO UPDATE
SET alias_display=EXCLUDED.alias_display, uom_id=EXCLUDED.uom_id;

UPDATE public.products p
SET base_uom_id = a.uom_id, uom_migration_status = 'MAPPED'
FROM public.uom_aliases a JOIN public.uoms u ON u.id=a.uom_id
WHERE p.base_uom_id IS NULL
  AND a.alias_normalized=public.uom_normalize_alias(p.unit)
  AND NOT u.is_product_specific;

UPDATE public.products
SET uom_migration_status = CASE
  WHEN NULLIF(trim(COALESCE(unit,'')),'') IS NULL THEN 'NO_UNIT' ELSE 'AMBIGUOUS' END
WHERE base_uom_id IS NULL;

INSERT INTO public.uom_backfill_issues(org_id, source_table, source_id, source_value, issue_code, details)
SELECT p.org_id, 'products', p.id, p.unit,
       CASE WHEN NULLIF(trim(COALESCE(p.unit,'')),'') IS NULL THEN 'UNIT_MISSING' ELSE 'UNIT_AMBIGUOUS_OR_UNKNOWN' END,
       jsonb_build_object('product_code',p.code,'product_name',p.name)
FROM public.products p WHERE p.base_uom_id IS NULL ON CONFLICT DO NOTHING;

UPDATE public.items i
SET base_uom_id = a.uom_id, uom_migration_status = 'MAPPED'
FROM public.uom_aliases a JOIN public.uoms u ON u.id=a.uom_id
WHERE i.base_uom_id IS NULL
  AND a.alias_normalized=public.uom_normalize_alias(i.unit)
  AND NOT u.is_product_specific;

UPDATE public.items
SET uom_migration_status = CASE
  WHEN NULLIF(trim(COALESCE(unit,'')),'') IS NULL THEN 'NO_UNIT' ELSE 'AMBIGUOUS' END
WHERE base_uom_id IS NULL;

INSERT INTO public.uom_backfill_issues(org_id, source_table, source_id, source_value, issue_code, details)
SELECT i.org_id, 'items', i.id, i.unit,
       CASE WHEN NULLIF(trim(COALESCE(i.unit,'')),'') IS NULL THEN 'UNIT_MISSING' ELSE 'UNIT_AMBIGUOUS_OR_UNKNOWN' END,
       jsonb_build_object('item_code',i.code,'item_name',i.name)
FROM public.items i WHERE i.base_uom_id IS NULL ON CONFLICT DO NOTHING;

UPDATE public.bom_lines bl SET uom_id=a.uom_id
FROM public.uom_aliases a
WHERE bl.uom_id IS NULL AND a.alias_normalized=public.uom_normalize_alias(bl.uom);

INSERT INTO public.uom_backfill_issues(org_id, source_table, source_id, source_value, issue_code, details)
SELECT bl.org_id, 'bom_lines', bl.id, bl.uom, 'BOM_UOM_UNRESOLVED',
       jsonb_build_object('bom_id',bl.bom_id,'item_id',bl.item_id)
FROM public.bom_lines bl WHERE bl.uom_id IS NULL ON CONFLICT DO NOTHING;

DO $$
DECLARE v_target record;
BEGIN
  FOR v_target IN SELECT * FROM (VALUES
    ('products','stock_quantity'), ('products','minimum_stock'),
    ('items','stock_quantity'), ('items','minimum_stock'), ('items','maximum_stock'), ('items','reorder_level'),
    ('purchase_order_lines','quantity'), ('purchase_order_lines','received_quantity'),
    ('goods_receipt_lines','ordered_quantity'), ('goods_receipt_lines','received_quantity'),
    ('sales_invoice_lines','quantity'), ('sales_invoice_lines','delivered_quantity'),
    ('delivery_note_lines','invoiced_quantity'), ('delivery_note_lines','delivered_quantity'),
    ('delivery_note_lines','quantity_delivered'),
    ('stock_adjustment_items','current_qty'), ('stock_adjustment_items','new_qty'), ('stock_adjustment_items','difference_qty'),
    ('bins','actual_qty'), ('bins','reserved_qty'), ('bins','ordered_qty'), ('bins','planned_qty'), ('bins','projected_qty'),
    ('stock_ledger_entries','actual_qty'), ('stock_ledger_entries','qty_after_transaction')
  ) AS x(table_name,column_name)
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=v_target.table_name AND column_name=v_target.column_name) THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I TYPE numeric(18,6) USING %I::numeric(18,6)',
        v_target.table_name, v_target.column_name, v_target.column_name);
    END IF;
  END LOOP;
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.stock_ledger_entries WHERE org_id IS NULL) THEN
    RAISE EXCEPTION 'SLE_NULL_ORG_REQUIRES_REMEDIATION';
  END IF;
  ALTER TABLE public.stock_ledger_entries ALTER COLUMN org_id SET NOT NULL;
  IF EXISTS (SELECT 1 FROM public.stock_reposting_queue WHERE org_id IS NULL) THEN
    RAISE EXCEPTION 'REPOSTING_QUEUE_NULL_ORG_REQUIRES_REMEDIATION';
  END IF;
  ALTER TABLE public.stock_reposting_queue ALTER COLUMN org_id SET NOT NULL;
END
$$;

CREATE INDEX IF NOT EXISTS idx_stock_adjustments_canonical_gl_entry ON public.stock_adjustments(canonical_gl_entry_id);
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_canonical_reversal_gl_entry ON public.stock_adjustments(canonical_reversal_gl_entry_id);
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_inventory_account ON public.stock_adjustments(inventory_account_id);

COMMENT ON COLUMN public.goods_receipt_lines.received_quantity IS
  'Legal base-UoM quantity. Original entered quantity and factor are immutable snapshots.';
COMMENT ON COLUMN public.delivery_note_lines.delivered_quantity IS
  'Legal base-UoM quantity. Original entered quantity and factor are immutable snapshots.';
