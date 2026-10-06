-- 203: stage-WIP insert lock compatible with M195 containment.
--
-- Additive. Does not edit migrations 194-202. After M195 revokes UPDATE on
-- manufacturing_orders, the invoker trigger guard_stage_wip_write_194 can no
-- longer take its manufacturing-order FOR UPDATE as authenticated. This
-- migration adds a postgres-owned definer helper that locks only an order
-- already in the authorized org, and points the non-owner INSERT path at it.
-- The table-owner path, including M192's definer writer, keeps the original
-- FOR UPDATE. Lock order stays manufacturing order FOR UPDATE, then stage
-- FOR SHARE. No UPDATE grant is added.
--
-- Reviewed order on a restored database: 195 through 201, the explicit
-- pre-M202 CRLF script, unmodified 202, then this file. Fresh DB already has
-- the LF function body, so the CRLF script is a no-op there. This file may
-- also run after 195 and before 202; it does not change any body M202 pins.
-- When 202 is already installed, the postflight re-runs its closed-graph
-- assertion.
--
-- The preflight pins the M194 guard body, its attributes and owner, and the
-- zz_guard_stage_wip_write_194 binding. Any other pre-image raises before
-- the helper is created.
BEGIN;
SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '5min';

DO $preflight$
BEGIN
  IF to_regprocedure('wardah_internal.guard_stage_wip_write_194()') IS NULL
     OR to_regprocedure('public.wardah_assert_stage_wip_editor_194(uuid,text)') IS NULL
     OR to_regclass('public.stage_wip_log') IS NULL
     OR to_regclass('public.manufacturing_orders') IS NULL THEN
    RAISE EXCEPTION 'STAGE_WIP_LOCK_203_REQUIRES_M194';
  END IF;
  IF (SELECT pg_catalog.pg_get_userbyid(c.relowner) FROM pg_catalog.pg_class c
      WHERE c.oid = 'public.stage_wip_log'::regclass) IS DISTINCT FROM current_user
     OR (SELECT pg_catalog.pg_get_userbyid(c.relowner) FROM pg_catalog.pg_class c
      WHERE c.oid = 'public.manufacturing_orders'::regclass) IS DISTINCT FROM current_user THEN
    RAISE EXCEPTION 'STAGE_WIP_LOCK_203_OWNER_MISMATCH';
  END IF;
  IF has_table_privilege('authenticated', 'public.manufacturing_orders', 'UPDATE')
     OR has_table_privilege('anon', 'public.manufacturing_orders', 'UPDATE')
     OR has_table_privilege('service_role', 'public.manufacturing_orders', 'UPDATE') THEN
    RAISE EXCEPTION 'STAGE_WIP_LOCK_203_REQUIRES_M195_CONTAINMENT';
  END IF;
  IF to_regprocedure('public.wardah_lock_mo_for_stage_wip_203(uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'STAGE_WIP_LOCK_203_ALREADY_APPLIED';
  END IF;
  -- Exact M194 catalog image: body md5 2068a97aea07127affa5dc6aef4d3394,
  -- 3310 bytes, the file body of guard_stage_wip_write_194. Attributes,
  -- ownership, and the one trigger binding are part of the same pre-image.
  -- A mismatch raises here, before any CREATE, so the transaction aborts
  -- with no catalog change.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_language l ON l.oid = p.prolang
    WHERE p.oid = 'wardah_internal.guard_stage_wip_write_194()'::regprocedure
      AND pg_catalog.md5(p.prosrc) = '2068a97aea07127affa5dc6aef4d3394'
      AND pg_catalog.octet_length(p.prosrc) = 3310
      AND NOT p.prosecdef
      AND l.lanname = 'plpgsql'
      AND p.provolatile = 'v'
      AND p.proparallel = 'u'
      AND NOT p.proisstrict
      AND NOT p.proleakproof
      AND p.procost = 100
      AND p.prorows = 0
      AND p.prokind = 'f'
      AND p.proconfig = ARRAY['search_path=public, pg_temp']::pg_catalog.text[]
      AND pg_catalog.pg_get_userbyid(p.proowner) = current_user
      AND pg_catalog.pg_get_function_identity_arguments(p.oid) = ''
      AND pg_catalog.pg_get_function_result(p.oid) = 'trigger'
      AND COALESCE((
            SELECT pg_catalog.string_agg(
                     pg_catalog.format('%s=%s/%s', gr.rolname, a.privilege_type, gtor.rolname),
                     ',' ORDER BY gr.rolname, a.privilege_type)
            FROM pg_catalog.aclexplode(p.proacl) a
            JOIN pg_catalog.pg_roles gr ON gr.oid = a.grantee
            JOIN pg_catalog.pg_roles gtor ON gtor.oid = a.grantor
          ), '') = 'postgres=EXECUTE/postgres'
      AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a WHERE a.grantee = 0
          )
  ) THEN
    RAISE EXCEPTION 'STAGE_WIP_LOCK_203_PREIMAGE_REFUSED';
  END IF;
  IF (
    SELECT count(*) FROM pg_catalog.pg_trigger t
    WHERE NOT t.tgisinternal
      AND t.tgname = 'zz_guard_stage_wip_write_194'
      AND t.tgrelid = 'public.stage_wip_log'::regclass
      AND t.tgfoid = 'wardah_internal.guard_stage_wip_write_194()'::regprocedure
      AND t.tgenabled = 'O'
      AND t.tgtype = 23
  ) IS DISTINCT FROM 1
  OR (
    SELECT count(*) FROM pg_catalog.pg_trigger t
    WHERE NOT t.tgisinternal
      AND t.tgname = 'zz_guard_stage_wip_write_194'
  ) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'STAGE_WIP_LOCK_203_TRIGGER_BINDING_REFUSED';
  END IF;
END
$preflight$;

-- p_org is the org the caller claims and must already be allowed to use.
-- It is not identity. auth.uid(), an active membership, and
-- manufacturing.stage_costs.create are checked before the lock and again
-- after it. The locked row must match both the MO id and that org, so a
-- foreign-org order is not locked and then compared.
CREATE FUNCTION public.wardah_lock_mo_for_stage_wip_203(
  p_mo_id uuid,
  p_org uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_org uuid;
BEGIN
  IF p_mo_id IS NULL OR p_org IS NULL THEN
    RAISE EXCEPTION 'WIP_LOCK_TARGET_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  PERFORM public.wardah_assert_org_member(p_org);
  IF NOT COALESCE(public.has_permission(
       auth.uid(), p_org, 'manufacturing.stage_costs.create'), false) THEN
    RAISE EXCEPTION 'WIP_CREATE_PERMISSION_DENIED' USING ERRCODE = 'P0001';
  END IF;

  SELECT mo.org_id INTO v_org
  FROM public.manufacturing_orders mo
  WHERE mo.id = p_mo_id
    AND mo.org_id = p_org
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WIP_MO_NOT_IN_AUTHORIZED_ORG' USING ERRCODE = 'P0001';
  END IF;

  PERFORM public.wardah_assert_org_member(p_org);
  IF NOT COALESCE(public.has_permission(
       auth.uid(), p_org, 'manufacturing.stage_costs.create'), false) THEN
    RAISE EXCEPTION 'WIP_CREATE_PERMISSION_DENIED' USING ERRCODE = 'P0001';
  END IF;
  RETURN v_org;
END
$fn$;

REVOKE ALL ON FUNCTION public.wardah_lock_mo_for_stage_wip_203(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wardah_lock_mo_for_stage_wip_203(uuid, uuid)
  TO authenticated;

-- Same business rules as M194. Only the non-owner INSERT lock changes.
CREATE OR REPLACE FUNCTION wardah_internal.guard_stage_wip_write_194()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_owner text;
  v_mo_org uuid;
  v_stage_org uuid;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO v_owner
    FROM pg_class WHERE oid = 'public.stage_wip_log'::regclass;

  IF TG_OP = 'INSERT' THEN
    IF current_user = v_owner THEN
      SELECT org_id INTO v_mo_org FROM public.manufacturing_orders
        WHERE id = NEW.mo_id FOR UPDATE;
    ELSE
      v_mo_org := public.wardah_lock_mo_for_stage_wip_203(NEW.mo_id, NEW.org_id);
    END IF;
    SELECT org_id INTO v_stage_org FROM public.manufacturing_stages
      WHERE id = NEW.stage_id FOR SHARE;
    IF v_mo_org IS DISTINCT FROM NEW.org_id
       OR v_stage_org IS DISTINCT FROM NEW.org_id THEN
      RAISE EXCEPTION 'WIP_PARENT_ORG_MISMATCH' USING ERRCODE = 'P0001';
    END IF;
    IF COALESCE(NEW.cost_material, 0) <> 0
       OR COALESCE(NEW.is_closed, false)
       OR NEW.closed_at IS NOT NULL OR NEW.closed_by IS NOT NULL THEN
      RAISE EXCEPTION 'WIP_CLIENT_POSTED_FIELDS_DENIED' USING ERRCODE = 'P0001';
    END IF;
    IF current_user <> v_owner THEN
      PERFORM public.wardah_assert_stage_wip_editor_194(NEW.org_id, 'create');
    END IF;
    IF NOT COALESCE(NEW.is_closed, false) AND EXISTS (
      SELECT 1 FROM public.stage_wip_log w
      WHERE w.org_id = NEW.org_id AND w.mo_id = NEW.mo_id
        AND w.stage_id = NEW.stage_id
        AND COALESCE(w.is_closed, false) = false
        AND NEW.period_start <= w.period_end
        AND w.period_start <= NEW.period_end
    ) THEN
      RAISE EXCEPTION 'WIP_OPEN_PERIOD_OVERLAP' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF (NEW.id, NEW.org_id, NEW.mo_id, NEW.stage_id, NEW.period_start, NEW.period_end)
      IS DISTINCT FROM
     (OLD.id, OLD.org_id, OLD.mo_id, OLD.stage_id, OLD.period_start, OLD.period_end) THEN
    RAISE EXCEPTION 'WIP_IDENTITY_OR_PERIOD_IMMUTABLE' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.is_closed IS DISTINCT FROM OLD.is_closed
     OR NEW.closed_at IS DISTINCT FROM OLD.closed_at
     OR NEW.closed_by IS DISTINCT FROM OLD.closed_by THEN
    IF NOT COALESCE((
      current_user = v_owner
      AND current_setting('wardah.stage_wip_close_194', true) = OLD.id::text
      AND COALESCE(OLD.is_closed, false) = false
      AND NEW.is_closed IS TRUE
      AND NEW.closed_at IS NOT NULL AND NEW.closed_by = auth.uid()
    ), false) THEN
      RAISE EXCEPTION 'WIP_CLOSE_REQUIRES_RPC' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF NEW.cost_material IS DISTINCT FROM OLD.cost_material
     AND NOT COALESCE(current_user = v_owner AND
       current_setting('wardah.material_issue_wip_194', true) = OLD.id::text, false) THEN
    RAISE EXCEPTION 'WIP_POSTED_MATERIAL_IMMUTABLE' USING ERRCODE = 'P0001';
  END IF;
  IF current_user <> v_owner THEN
    PERFORM public.wardah_assert_stage_wip_editor_194(OLD.org_id, 'update');
  END IF;
  RETURN NEW;
END
$fn$;

REVOKE ALL ON FUNCTION wardah_internal.guard_stage_wip_write_194()
  FROM PUBLIC, anon, authenticated, service_role;

DO $postflight$
DECLARE
  v_client text;
  v_priv text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = 'public.wardah_lock_mo_for_stage_wip_203(uuid,uuid)'::regprocedure
      AND p.prosecdef
      AND p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']
      AND pg_get_userbyid(p.proowner) = current_user
  ) THEN
    RAISE EXCEPTION 'STAGE_WIP_LOCK_203_HELPER_CONTRACT';
  END IF;
  IF EXISTS (
       SELECT 1 FROM pg_proc p
       WHERE p.oid = 'public.wardah_lock_mo_for_stage_wip_203(uuid,uuid)'::regprocedure
         AND (p.proacl IS NULL OR EXISTS (
           SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0))
     )
     OR has_function_privilege('anon', 'public.wardah_lock_mo_for_stage_wip_203(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.wardah_lock_mo_for_stage_wip_203(uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.wardah_lock_mo_for_stage_wip_203(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'STAGE_WIP_LOCK_203_HELPER_ACL';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = 'wardah_internal.guard_stage_wip_write_194()'::regprocedure
      AND (p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp'])
  ) THEN
    RAISE EXCEPTION 'STAGE_WIP_LOCK_203_GUARD_CONTRACT';
  END IF;
  FOREACH v_client IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF has_table_privilege(v_client, 'public.manufacturing_orders', v_priv)
         OR (v_priv IN ('INSERT', 'UPDATE', 'REFERENCES')
             AND has_any_column_privilege(v_client, 'public.manufacturing_orders', v_priv)) THEN
        RAISE EXCEPTION 'STAGE_WIP_LOCK_203_CONTAINMENT_DRIFT: % %', v_client, v_priv;
      END IF;
    END LOOP;
  END LOOP;
  IF to_regprocedure('wardah_internal.qc_assert_closed_graph_202()') IS NOT NULL THEN
    PERFORM wardah_internal.qc_assert_closed_graph_202();
  END IF;
END
$postflight$;
COMMIT;
