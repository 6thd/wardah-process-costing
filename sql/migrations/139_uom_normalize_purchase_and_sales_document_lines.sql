-- migration_number: 139
-- description: Normalize purchase-order and sales-invoice lines at document entry
--              so ordered/invoiced quantities and prices are legal base-UoM values.
-- safety: existing rows are snapshotted as base-UoM legacy values; new/edited lines
--         are converted fail-closed by BEFORE triggers.

-- Existing document quantities are already interpreted by the system as legal stock
-- quantities. Preserve them with an explicit factor-1 snapshot; do not reinterpret history.
UPDATE public.purchase_order_lines l
SET uom_id=p.base_uom_id,
    qty_entered=COALESCE(l.qty_entered,l.quantity),
    conversion_factor_snapshot=COALESCE(l.conversion_factor_snapshot,1),
    unit_price_entered=COALESCE(l.unit_price_entered,l.unit_price)
FROM public.products p
WHERE l.product_id=p.id AND l.org_id=p.org_id AND l.uom_id IS NULL;

UPDATE public.sales_invoice_lines l
SET uom_id=p.base_uom_id,
    qty_entered=COALESCE(l.qty_entered,l.quantity),
    conversion_factor_snapshot=COALESCE(l.conversion_factor_snapshot,1),
    unit_price_entered=COALESCE(l.unit_price_entered,l.unit_price)
FROM public.products p
WHERE l.product_id=p.id AND l.org_id=p.org_id AND l.uom_id IS NULL;

CREATE OR REPLACE FUNCTION public.trg_normalize_purchase_order_line_uom()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_uom uuid; v_factor numeric; v_qty_entered numeric; v_price_entered numeric;
BEGIN
  SELECT COALESCE(NEW.uom_id,p.base_uom_id) INTO v_uom
  FROM public.products p WHERE p.id=NEW.product_id AND p.org_id=NEW.org_id;
  IF NOT FOUND OR v_uom IS NULL THEN RAISE EXCEPTION 'PO_LINE_PRODUCT_BASE_UOM_REQUIRED'; END IF;

  IF TG_OP='INSERT'
     OR NEW.qty_entered IS DISTINCT FROM OLD.qty_entered
     OR NEW.uom_id IS DISTINCT FROM OLD.uom_id THEN
    v_qty_entered:=COALESCE(NEW.qty_entered,NEW.quantity);
  ELSIF NEW.quantity IS DISTINCT FROM OLD.quantity THEN
    v_qty_entered:=NEW.quantity;
  ELSE
    v_qty_entered:=COALESCE(NEW.qty_entered,NEW.quantity);
  END IF;

  IF TG_OP='INSERT'
     OR NEW.unit_price_entered IS DISTINCT FROM OLD.unit_price_entered
     OR NEW.uom_id IS DISTINCT FROM OLD.uom_id THEN
    v_price_entered:=COALESCE(NEW.unit_price_entered,NEW.unit_price);
  ELSIF NEW.unit_price IS DISTINCT FROM OLD.unit_price THEN
    v_price_entered:=NEW.unit_price;
  ELSE
    v_price_entered:=COALESCE(NEW.unit_price_entered,NEW.unit_price);
  END IF;

  IF v_qty_entered IS NULL OR v_qty_entered<=0 THEN RAISE EXCEPTION 'PO_LINE_QUANTITY_MUST_BE_POSITIVE'; END IF;
  IF v_price_entered IS NULL OR v_price_entered<0 THEN RAISE EXCEPTION 'PO_LINE_PRICE_MUST_BE_NONNEGATIVE'; END IF;
  v_factor:=public.wardah_uom_factor(NEW.org_id,NEW.product_id,v_uom,COALESCE(NEW.created_at,now()));

  NEW.uom_id:=v_uom;
  NEW.qty_entered:=v_qty_entered;
  NEW.conversion_factor_snapshot:=v_factor;
  NEW.unit_price_entered:=v_price_entered;
  NEW.quantity:=round(v_qty_entered*v_factor,6);
  NEW.unit_price:=round(v_price_entered/v_factor,6);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_normalize_sales_invoice_line_uom()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_uom uuid; v_factor numeric; v_qty_entered numeric; v_price_entered numeric;
BEGIN
  SELECT COALESCE(NEW.uom_id,p.base_uom_id) INTO v_uom
  FROM public.products p WHERE p.id=NEW.product_id AND p.org_id=NEW.org_id;
  IF NOT FOUND OR v_uom IS NULL THEN RAISE EXCEPTION 'SALES_LINE_PRODUCT_BASE_UOM_REQUIRED'; END IF;

  IF TG_OP='INSERT'
     OR NEW.qty_entered IS DISTINCT FROM OLD.qty_entered
     OR NEW.uom_id IS DISTINCT FROM OLD.uom_id THEN
    v_qty_entered:=COALESCE(NEW.qty_entered,NEW.quantity);
  ELSIF NEW.quantity IS DISTINCT FROM OLD.quantity THEN
    v_qty_entered:=NEW.quantity;
  ELSE
    v_qty_entered:=COALESCE(NEW.qty_entered,NEW.quantity);
  END IF;

  IF TG_OP='INSERT'
     OR NEW.unit_price_entered IS DISTINCT FROM OLD.unit_price_entered
     OR NEW.uom_id IS DISTINCT FROM OLD.uom_id THEN
    v_price_entered:=COALESCE(NEW.unit_price_entered,NEW.unit_price);
  ELSIF NEW.unit_price IS DISTINCT FROM OLD.unit_price THEN
    v_price_entered:=NEW.unit_price;
  ELSE
    v_price_entered:=COALESCE(NEW.unit_price_entered,NEW.unit_price);
  END IF;

  IF v_qty_entered IS NULL OR v_qty_entered<=0 THEN RAISE EXCEPTION 'SALES_LINE_QUANTITY_MUST_BE_POSITIVE'; END IF;
  IF v_price_entered IS NULL OR v_price_entered<0 THEN RAISE EXCEPTION 'SALES_LINE_PRICE_MUST_BE_NONNEGATIVE'; END IF;
  v_factor:=public.wardah_uom_factor(NEW.org_id,NEW.product_id,v_uom,COALESCE(NEW.created_at,now()));

  NEW.uom_id:=v_uom;
  NEW.qty_entered:=v_qty_entered;
  NEW.conversion_factor_snapshot:=v_factor;
  NEW.unit_price_entered:=v_price_entered;
  NEW.quantity:=round(v_qty_entered*v_factor,6);
  NEW.unit_price:=round(v_price_entered/v_factor,6);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS normalize_purchase_order_line_uom ON public.purchase_order_lines;
CREATE TRIGGER normalize_purchase_order_line_uom
BEFORE INSERT OR UPDATE OF org_id,product_id,uom_id,qty_entered,quantity,unit_price_entered,unit_price
ON public.purchase_order_lines FOR EACH ROW EXECUTE FUNCTION public.trg_normalize_purchase_order_line_uom();

DROP TRIGGER IF EXISTS normalize_sales_invoice_line_uom ON public.sales_invoice_lines;
CREATE TRIGGER normalize_sales_invoice_line_uom
BEFORE INSERT OR UPDATE OF org_id,product_id,uom_id,qty_entered,quantity,unit_price_entered,unit_price
ON public.sales_invoice_lines FOR EACH ROW EXECUTE FUNCTION public.trg_normalize_sales_invoice_line_uom();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.purchase_order_lines'::regclass AND conname='purchase_order_lines_uom_snapshot_check') THEN
    ALTER TABLE public.purchase_order_lines ADD CONSTRAINT purchase_order_lines_uom_snapshot_check
      CHECK (qty_entered>0 AND conversion_factor_snapshot>0 AND unit_price_entered>=0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.sales_invoice_lines'::regclass AND conname='sales_invoice_lines_uom_snapshot_check') THEN
    ALTER TABLE public.sales_invoice_lines ADD CONSTRAINT sales_invoice_lines_uom_snapshot_check
      CHECK (qty_entered>0 AND conversion_factor_snapshot>0 AND unit_price_entered>=0) NOT VALID;
  END IF;
END
$$;

REVOKE EXECUTE ON FUNCTION public.trg_normalize_purchase_order_line_uom() FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_normalize_sales_invoice_line_uom() FROM PUBLIC,anon,authenticated;

COMMENT ON COLUMN public.purchase_order_lines.quantity IS
  'Legal base-UoM ordered quantity; qty_entered/uom_id/factor preserve the commercial entry.';
COMMENT ON COLUMN public.sales_invoice_lines.quantity IS
  'Legal base-UoM invoiced quantity; qty_entered/uom_id/factor preserve the commercial entry.';
