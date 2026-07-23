-- Acceptance for migration 146 trusted seed/service-role product inserts.
-- No auth.uid() is configured: valid structural imports remain possible, while
-- illegal product/base-UoM combinations fail closed at the database boundary.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.expect_error(p_sql text, p_needle text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_succeeded boolean := false;
BEGIN
  BEGIN
    EXECUTE p_sql;
    v_succeeded := true;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%' || p_needle || '%' THEN
      RAISE EXCEPTION 'ACCEPTANCE_FAIL: expected [%] for [%], got [%]',
        p_needle, p_sql, SQLERRM;
    END IF;
  END;
  IF v_succeeded THEN
    RAISE EXCEPTION 'ACCEPTANCE_FAIL: expected error [%] for [%], but it succeeded',
      p_needle, p_sql;
  END IF;
END $$;

SELECT set_config('request.jwt.claim.sub', '', false);

BEGIN;
INSERT INTO public.organizations (id, code, name) VALUES
  ('47111111-1111-1111-1111-111111111111', 'U147A', 'Trusted Insert Org A'),
  ('47222222-2222-2222-2222-222222222222', 'U147B', 'Trusted Insert Org B');

INSERT INTO public.uom_categories (id, code, name, dimension) VALUES
  ('47c00000-0000-0000-0000-000000000001', 'U147_COUNT', 'Trusted Count', 'count');

INSERT INTO public.uoms
  (id, category_id, code, name, symbol, factor_to_category_base,
   is_category_base, is_product_specific, org_id, is_active) VALUES
  ('47400000-0000-0000-0000-000000000001',
   '47c00000-0000-0000-0000-000000000001',
   'U147_PCS', 'Trusted Piece', 'u147p', 1, true, false, NULL, true),
  ('47400000-0000-0000-0000-000000000002',
   '47c00000-0000-0000-0000-000000000001',
   'U147_SPEC', 'Trusted Specific', 'u147s', NULL, false, true, NULL, true),
  ('47400000-0000-0000-0000-000000000003',
   '47c00000-0000-0000-0000-000000000001',
   'U147_ORGB', 'Org B Unit', 'u147b', 2, false, false,
   '47222222-2222-2222-2222-222222222222', true);
COMMIT;

-- Valid trusted insert: shared, active, non-product-specific base unit.
INSERT INTO public.products
  (id, org_id, code, name, unit, base_uom_id, uom_migration_status) VALUES
  ('47d00000-0000-0000-0000-000000000001',
   '47111111-1111-1111-1111-111111111111',
   'U147-OK', 'Trusted legal product', 'pcs',
   '47400000-0000-0000-0000-000000000001', 'MAPPED');

SELECT pg_temp.expect_error(
  $$ INSERT INTO public.products
       (id,org_id,code,name,unit,base_uom_id,uom_migration_status)
     VALUES
       ('47d00000-0000-0000-0000-000000000002',
        '47111111-1111-1111-1111-111111111111',
        'U147-SPEC','Illegal specific base','box',
        '47400000-0000-0000-0000-000000000002','MAPPED') $$,
  'PRODUCT_BASE_UOM_CANNOT_BE_PRODUCT_SPECIFIC');

SELECT pg_temp.expect_error(
  $$ INSERT INTO public.products
       (id,org_id,code,name,unit,base_uom_id,uom_migration_status)
     VALUES
       ('47d00000-0000-0000-0000-000000000003',
        '47111111-1111-1111-1111-111111111111',
        'U147-XORG','Illegal cross-org base','box',
        '47400000-0000-0000-0000-000000000003','MAPPED') $$,
  'PRODUCT_BASE_UOM_INVALID');

SELECT pg_temp.expect_error(
  $$ INSERT INTO public.products
       (id,org_id,code,name,unit,base_uom_id,uom_migration_status)
     VALUES
       ('47d00000-0000-0000-0000-000000000004',
        '47111111-1111-1111-1111-111111111111',
        'U147-NOBASE','Mapped without base','pcs',NULL,'MAPPED') $$,
  'PRODUCT_BASE_UOM_REQUIRED');

\echo '✅ acceptance_146_trusted_product_insert_guard: all assertions passed'
