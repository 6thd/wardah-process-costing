-- M199 RED: on a database built through M198 (no M199) the quality-control
-- gaps recorded in the 2026-10-02 inventory are real. Rolled back.
\set ON_ERROR_STOP on
BEGIN;
\ir ../manufacturing-inventory-red-20260925/_helpers.sql

CREATE FUNCTION pg_temp.reproduced(p_cond boolean, p_label text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF p_cond IS NOT TRUE THEN RAISE EXCEPTION 'M199_RED_NOT_REPRODUCED: %', p_label; END IF;
  RAISE NOTICE 'reproduced  %', p_label;
END $fn$;

SELECT pg_temp.reproduced(NOT EXISTS (SELECT 1 FROM public.permissions
  WHERE permission_key LIKE '%quality%' OR permission_key LIKE '%inspect%'),
  'QC-02: no quality permission key exists');

SELECT pg_temp.reproduced(has_table_privilege('authenticated','public.quality_inspections','UPDATE')
  AND has_table_privilege('anon','public.quality_inspections','INSERT'),
  'QC-06/QC-14: inspections are directly writable by clients (and anon holds INSERT)');

-- A member with only manufacturing.orders.read writes a "passing" inspection
-- directly; nobody required the inspection_quality key or set the inspector.
INSERT INTO public.work_centers(id, org_id, code, name)
VALUES ('ed000000-0000-4000-8000-0000000000f9', pg_temp.org(), 'RED-QC-WC', 'RED QC WC')
ON CONFLICT DO NOTHING;
CREATE TEMP TABLE red_mo(id uuid) ON COMMIT DROP;
WITH x AS (
  INSERT INTO public.manufacturing_orders(org_id, order_number, product_id, quantity, status, created_by)
  VALUES (pg_temp.org(), 'RED-QC-1', pg_temp.fg(), 10, 'quality_check', pg_temp.admin())
  RETURNING id)
INSERT INTO red_mo SELECT id FROM x;
SELECT set_config('request.jwt.claim.sub', pg_temp.admin()::text, true);
SELECT set_config('request.jwt.claims',
  json_build_object('sub', pg_temp.admin(), 'role', 'authenticated')::text, true);
INSERT INTO public.work_orders(id, org_id, mo_id, work_center_id, work_order_number,
  operation_sequence, operation_name, planned_quantity, status)
SELECT 'ed000000-0000-4000-8000-0000000000fa', pg_temp.org(), id,
  'ed000000-0000-4000-8000-0000000000f9', 'RED-QC-1-WO', 1, 'QC', 10, 'READY' FROM red_mo;
SELECT pg_temp.reproduced((pg_temp.try_as(pg_temp.reader(), $q$
  WITH i AS (INSERT INTO public.quality_inspections(org_id, work_order_id, inspection_number, result,
     passed_quantity, failed_quantity)
   VALUES ('ed000000-0000-4000-8000-000000000001','ed000000-0000-4000-8000-0000000000fa',
           'RED-QI-1','PASS',10,0) RETURNING inspector_id)
  SELECT to_jsonb(count(*) FILTER (WHERE inspector_id IS NULL)) FROM i$q$) -> 'result')::int = 1,
  'QC-06: a read-only member records a PASS with no inspector identity');
SELECT pg_temp.reproduced((pg_temp.try_as(pg_temp.reader(), $q$
  WITH u AS (UPDATE public.quality_inspections SET result = 'FAIL'
             WHERE inspection_number = 'RED-QI-1' RETURNING 1)
  SELECT to_jsonb(count(*)) FROM u$q$) -> 'result')::int = 1,
  'QC-06: the recorded result can be rewritten afterwards');

-- QC-01: an order leaves quality_check for done with no inspection at all.
UPDATE public.manufacturing_orders SET status = 'done', completed_quantity = 10
WHERE id = (SELECT id FROM red_mo);
SELECT pg_temp.reproduced((SELECT status FROM public.manufacturing_orders WHERE id = (SELECT id FROM red_mo)) = 'done',
  'QC-01: no release gate between quality_check and done');

SELECT 'M199_RED_REPRODUCED' AS result;
ROLLBACK;
