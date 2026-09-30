-- Seed legacy overlap before M194; the migration must preserve these rows.
\set ON_ERROR_STOP on
BEGIN;
\ir ../posted-history-193/_fixture.sql
DO $fixture$
DECLARE v_mo uuid; v_current uuid; v_null uuid; v_amb_null uuid; v_stage uuid:=pg_temp.stage();
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

  -- The RED fixture holds one shared RAW stock of 1000 that the later M192 suites
  -- also draw on, so the MOs below reserve only what their scenario really issues
  -- (10 per single issue; 1 where the call is refused before any reservation).
  -- Legacy rows may carry is_closed IS NULL, which M192 treats as open
  -- (COALESCE(is_closed,false)=false). An existing NULL-open row must still
  -- block an overlapping new interval, and must still count toward ambiguity.
  v_null:=pg_temp.mk_mo('GREEN-278-NULL-OPEN',5,1,'in_progress','IN_PROGRESS');
  UPDATE public.stage_wip_log SET is_closed=NULL WHERE mo_id=v_null;
  v_amb_null:=pg_temp.mk_mo('GREEN-278-AMBIGUOUS-NULL',5,1,'in_progress','IN_PROGRESS');
  INSERT INTO public.stage_wip_log(org_id,mo_id,stage_id,period_start,period_end,is_closed)
    SELECT org_id,mo_id,stage_id,period_start,period_end+1,NULL
    FROM public.stage_wip_log WHERE mo_id=v_amb_null;

  PERFORM pg_temp.mk_mo('GREEN-278-RACE-ISSUE-A',5,20,'in_progress','IN_PROGRESS');
  PERFORM pg_temp.mk_mo('GREEN-278-RACE-ISSUE-B',5,20,'in_progress','IN_PROGRESS');
  PERFORM pg_temp.mk_mo('GREEN-278-RACE-WIP-C',5,20,'in_progress','IN_PROGRESS');
  PERFORM pg_temp.mk_mo('GREEN-278-RACE-WIP-D',5,20,'in_progress','IN_PROGRESS');
  -- Close-RPC races: M192 frozen between its MO and WIP locks, and close
  -- versus issue in both orders. One MO per scenario (each issues once).
  PERFORM pg_temp.mk_mo('GREEN-278-RACE-PAUSE',5,10,'in_progress','IN_PROGRESS');
  PERFORM pg_temp.mk_mo('GREEN-278-RACE-CLOSE-A',5,1,'in_progress','IN_PROGRESS');
  PERFORM pg_temp.mk_mo('GREEN-278-RACE-CLOSE-B',5,10,'in_progress','IN_PROGRESS');
  -- A real issue from a brand-new backend (marker never defined there).
  PERFORM pg_temp.mk_mo('GREEN-278-FRESH-ISSUE',5,10,'in_progress','IN_PROGRESS');
END
$fixture$;
COMMIT;
