-- Seed legacy overlap before M194; the migration must preserve these rows.
\set ON_ERROR_STOP on
BEGIN;
\ir ../posted-history-193/_fixture.sql
DO $fixture$
DECLARE v_mo uuid; v_current uuid; v_stage uuid:=pg_temp.stage();
BEGIN
  v_mo:=pg_temp.mk_mo('GREEN-278-HISTORICAL',5,20,'in_progress','IN_PROGRESS');
  UPDATE public.stage_wip_log SET
    period_start=DATE '2025-11-16',period_end=DATE '2025-11-23',cost_material=1000
    WHERE mo_id=v_mo;
  INSERT INTO public.stage_wip_log(
    org_id,mo_id,stage_id,period_start,period_end,cost_material
  ) VALUES (
    pg_temp.org(),v_mo,v_stage,DATE '2025-11-17',DATE '2025-11-24',1000
  );

  -- A second legacy overlap eligible today proves that M192 rejects
  -- ambiguity before posting stock or a receipt.
  v_current:=pg_temp.mk_mo('GREEN-278-AMBIGUOUS',5,20,'in_progress','IN_PROGRESS');
  INSERT INTO public.stage_wip_log(org_id,mo_id,stage_id,period_start,period_end)
    SELECT org_id,mo_id,stage_id,period_start,period_end+1
    FROM public.stage_wip_log WHERE mo_id=v_current;

  PERFORM pg_temp.mk_mo('GREEN-278-RACE-ISSUE-A',5,20,'in_progress','IN_PROGRESS');
  PERFORM pg_temp.mk_mo('GREEN-278-RACE-ISSUE-B',5,20,'in_progress','IN_PROGRESS');
END
$fixture$;
COMMIT;
