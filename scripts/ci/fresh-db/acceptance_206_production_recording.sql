-- Acceptance for Migration 206 on a fresh database through 206 (owner decision group B, 2026-11-25;
-- runbook docs/db/PRODUCTION_RECORDING_206_RUNBOOK.md).
--
-- Proves, through the public RPCs as authenticated (fixtures and storage checks as the table owner):
--   1. catalog: private storage, RPC grants to authenticated only, internals closed, eight ordinary keys;
--   2. B6 calendar: month-start only, timezone captured, a later version cannot re-date recorded periods;
--   3. B3 stage map by operation sequence AND work center; a mismatch refuses naming the operation;
--   4. B1 a line with yield_percentage <> 100 blocks approval naming the line; phantom lines refused;
--   3b. B3 work orders: a record linked to a work order must match the snapshot operation (sequence
--      and work center) at entry and again at approval;
--   5. THE KEY SCENARIO (owner's acceptance criterion): an order runs on snapshot 1; a second BOM is
--      approved during execution and a change snapshot takes effect at T; production processed before T
--      and entered after the change stays on snapshot 1, production after T goes to snapshot 2, a record
--      across T is refused, a change that would re-attribute live records is refused, and every quantity
--      keeps its snapshot and period;
--   6. B6 local midnight: two executions 30 minutes either side of local midnight fall in two months;
--   7. B5 late window: unset = only the same local day is on time; exceptional approval needs its own
--      key and a reason; a configured window is honoured; the setting is audited;
--   8. B7 inputs: separate approve key; the recorder can never approve or reject their own entry;
--   9. permissions, org isolation, idempotency, immutability (no update or delete of history).
-- Rolled back at the end.
\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Catalog and privileges.
-- ---------------------------------------------------------------------
DO $catalog$
DECLARE
  v_t text;
  v_fn text;
BEGIN
  FOREACH v_t IN ARRAY ARRAY[
    'wardah_internal.mfg_period_calendars_206', 'wardah_internal.mfg_recording_settings_206',
    'wardah_internal.mfg_recording_settings_audit_206', 'wardah_internal.mo_bom_snapshots_206',
    'wardah_internal.mo_bom_snapshot_lines_206', 'wardah_internal.mo_bom_snapshot_operations_206',
    'wardah_internal.mfg_production_records_206', 'wardah_internal.mfg_production_inputs_206'] LOOP
    IF has_table_privilege('authenticated', v_t, 'SELECT') OR has_table_privilege('authenticated', v_t, 'INSERT')
       OR has_table_privilege('authenticated', v_t, 'UPDATE') OR has_table_privilege('authenticated', v_t, 'DELETE')
       OR has_table_privilege('anon', v_t, 'SELECT') OR has_table_privilege('service_role', v_t, 'SELECT') THEN
      RAISE EXCEPTION 'PR206_TABLE_EXPOSED: %', v_t;
    END IF;
  END LOOP;
  FOREACH v_fn IN ARRAY ARRAY[
    'public.rpc_add_mfg_period_calendar_206(uuid,date,text)',
    'public.rpc_set_mfg_late_entry_window_206(uuid,integer,text)',
    'public.rpc_create_mo_bom_snapshot_206(uuid,uuid,uuid,timestamp with time zone,text,uuid)',
    'public.rpc_approve_mo_bom_snapshot_206(uuid,uuid)',
    'public.rpc_withdraw_mo_bom_snapshot_206(uuid,uuid,text)',
    'public.rpc_record_production_206(uuid,uuid,integer,uuid,numeric,numeric,timestamp with time zone,timestamp with time zone,text,uuid)',
    'public.rpc_record_production_input_206(uuid,uuid,integer,text,text,numeric,text,timestamp with time zone,timestamp with time zone,text,uuid)',
    'public.rpc_transition_production_entry_206(uuid,text,uuid,text,text)',
    'public.rpc_get_mo_production_206(uuid,uuid)'] LOOP
    IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') OR has_function_privilege('anon', v_fn, 'EXECUTE')
       OR has_function_privilege('service_role', v_fn, 'EXECUTE')
       OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_fn::regprocedure) THEN
      RAISE EXCEPTION 'PR206_RPC_ACL_UNEXPECTED: %', v_fn;
    END IF;
  END LOOP;
  FOR v_fn IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'wardah_internal' AND p.proname LIKE '%\_206' ESCAPE '\' LOOP
    IF has_function_privilege('authenticated', v_fn, 'EXECUTE') OR has_function_privilege('anon', v_fn, 'EXECUTE')
       OR has_function_privilege('service_role', v_fn, 'EXECUTE')
       OR (SELECT prosecdef FROM pg_proc WHERE oid = v_fn::regprocedure) THEN
      RAISE EXCEPTION 'PR206_INTERNAL_EXPOSED: %', v_fn;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.permissions p JOIN public.modules m ON m.id = p.module_id
      WHERE m.name = 'manufacturing' AND p.permission_key IN (
        'manufacturing.bom_snapshots.create','manufacturing.bom_snapshots.change','manufacturing.bom_snapshots.approve',
        'manufacturing.production_records.record','manufacturing.production_records.approve',
        'manufacturing.production_records.approve_late','manufacturing.production_inputs.record',
        'manufacturing.production_inputs.approve')) <> 8 THEN
    RAISE EXCEPTION 'PR206_PERMISSION_CATALOG_UNEXPECTED';
  END IF;
  IF col_description('public.bom_lines'::regclass,
       (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.bom_lines'::regclass AND attname = 'scrap_factor'))
     NOT LIKE '%PERCENT, 0..100 (2 = 2%%)%' THEN
    RAISE EXCEPTION 'PR206_SCRAP_UNIT_COMMENT_MISSING';
  END IF;
  RAISE NOTICE 'PR206_CATALOG_OK';
END
$catalog$;

-- ---------------------------------------------------------------------
-- Fixtures (as owner). Org A in Asia/Riyadh (+03:00, no DST), org B.
-- ---------------------------------------------------------------------
INSERT INTO public.organizations (id, name, code, timezone) VALUES
  ('52060206-0000-0000-0000-0000000000a1', 'Production 206 A', 'PR206-A', 'Asia/Riyadh'),
  ('52060206-0000-0000-0000-0000000000b1', 'Production 206 B', 'PR206-B', 'UTC');

CREATE TEMP TABLE pr_users (k text PRIMARY KEY, id uuid NOT NULL);
INSERT INTO pr_users VALUES
  ('admin',     '52060206-0000-0000-0000-000000000a01'),  -- org admin of A
  ('planner',   '52060206-0000-0000-0000-000000000a02'),  -- bom_snapshots.create + change
  ('snapappr',  '52060206-0000-0000-0000-000000000a03'),  -- bom_snapshots.approve
  ('recorder',  '52060206-0000-0000-0000-000000000a04'),  -- production_records.record + production_inputs.record
  ('approver',  '52060206-0000-0000-0000-000000000a05'),  -- production_records.approve + production_inputs.approve
  ('lateappr',  '52060206-0000-0000-0000-000000000a06'),  -- production_records.approve + approve_late + inputs.record
  ('settings',  '52060206-0000-0000-0000-000000000a07'),  -- manufacturing.settings.update
  ('member',    '52060206-0000-0000-0000-000000000a08'),  -- plain member of A
  ('b_user',    '52060206-0000-0000-0000-000000000b02');  -- org admin of B only
GRANT SELECT ON pr_users TO authenticated;
INSERT INTO auth.users (id, email) SELECT id, k || '@pr206.example.test' FROM pr_users;
INSERT INTO public.user_organizations (user_id, org_id, role, is_active, is_org_admin)
SELECT u.id, '52060206-0000-0000-0000-0000000000a1', CASE WHEN u.k = 'admin' THEN 'admin' ELSE 'user' END, true, u.k = 'admin'
FROM pr_users u WHERE u.k <> 'b_user';
INSERT INTO public.user_organizations (user_id, org_id, role, is_active, is_org_admin) VALUES
  ('52060206-0000-0000-0000-000000000b02', '52060206-0000-0000-0000-0000000000b1', 'admin', true, true);
INSERT INTO public.roles (id, org_id, name, name_ar, is_active) VALUES
  ('52060206-0000-0000-0000-0000000000c1', '52060206-0000-0000-0000-0000000000a1', 'PR206 planner', 'مخطط', true),
  ('52060206-0000-0000-0000-0000000000c2', '52060206-0000-0000-0000-0000000000a1', 'PR206 snapshot approver', 'معتمد لقطة', true),
  ('52060206-0000-0000-0000-0000000000c3', '52060206-0000-0000-0000-0000000000a1', 'PR206 recorder', 'مسجل', true),
  ('52060206-0000-0000-0000-0000000000c4', '52060206-0000-0000-0000-0000000000a1', 'PR206 approver', 'معتمد', true),
  ('52060206-0000-0000-0000-0000000000c5', '52060206-0000-0000-0000-0000000000a1', 'PR206 late approver', 'معتمد متأخر', true),
  ('52060206-0000-0000-0000-0000000000c6', '52060206-0000-0000-0000-0000000000a1', 'PR206 settings', 'إعدادات', true);
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.role_id::uuid, p.id FROM (VALUES
  ('52060206-0000-0000-0000-0000000000c1', 'manufacturing.bom_snapshots.create'),
  ('52060206-0000-0000-0000-0000000000c1', 'manufacturing.bom_snapshots.change'),
  ('52060206-0000-0000-0000-0000000000c2', 'manufacturing.bom_snapshots.approve'),
  ('52060206-0000-0000-0000-0000000000c3', 'manufacturing.production_records.record'),
  ('52060206-0000-0000-0000-0000000000c3', 'manufacturing.production_inputs.record'),
  ('52060206-0000-0000-0000-0000000000c4', 'manufacturing.production_records.approve'),
  ('52060206-0000-0000-0000-0000000000c4', 'manufacturing.production_inputs.approve'),
  ('52060206-0000-0000-0000-0000000000c5', 'manufacturing.production_records.approve'),
  ('52060206-0000-0000-0000-0000000000c5', 'manufacturing.production_records.approve_late'),
  ('52060206-0000-0000-0000-0000000000c5', 'manufacturing.production_inputs.approve'),
  ('52060206-0000-0000-0000-0000000000c5', 'manufacturing.production_inputs.record'),
  ('52060206-0000-0000-0000-0000000000c6', 'manufacturing.settings.update')
) r(role_id, key) JOIN public.permissions p ON p.permission_key = r.key;
INSERT INTO public.user_roles (user_id, role_id, org_id)
SELECT u.id, r.role_id::uuid, '52060206-0000-0000-0000-0000000000a1' FROM (VALUES
  ('planner',  '52060206-0000-0000-0000-0000000000c1'),
  ('snapappr', '52060206-0000-0000-0000-0000000000c2'),
  ('recorder', '52060206-0000-0000-0000-0000000000c3'),
  ('approver', '52060206-0000-0000-0000-0000000000c4'),
  ('lateappr', '52060206-0000-0000-0000-0000000000c5'),
  ('settings', '52060206-0000-0000-0000-0000000000c6')
) r(k, role_id) JOIN pr_users u ON u.k = r.k;

INSERT INTO public.work_centers (id, org_id, code, name, is_active) VALUES
  ('52060206-0000-0000-0000-0000000000d1', '52060206-0000-0000-0000-0000000000a1', 'WC-EXT', 'Extrusion', true),
  ('52060206-0000-0000-0000-0000000000d2', '52060206-0000-0000-0000-0000000000a1', 'WC-PCK', 'Packing', true),
  ('52060206-0000-0000-0000-0000000000d3', '52060206-0000-0000-0000-0000000000a1', 'WC-OTH', 'Unmapped', true);
INSERT INTO public.manufacturing_stages (id, org_id, code, name, order_sequence, work_center_id, is_active) VALUES
  ('52060206-0000-0000-0000-0000000000e1', '52060206-0000-0000-0000-0000000000a1', 'ST-1', 'Extrusion', 10, '52060206-0000-0000-0000-0000000000d1', true),
  ('52060206-0000-0000-0000-0000000000e2', '52060206-0000-0000-0000-0000000000a1', 'ST-2', 'Packing', 20, '52060206-0000-0000-0000-0000000000d2', true);

-- A 204 cost policy version in force since 60 days ago, pinned on creation.
INSERT INTO wardah_internal.mfg_cost_policy_versions
  (id, org_id, version_no, effective_from, labor_cost_source, default_labor_rate_per_hour, pin_event, idempotency_key, payload_hash)
VALUES ('52060206-0000-0000-0000-0000000000f0', '52060206-0000-0000-0000-0000000000a1', 1,
        wardah_internal.mfg_cost_policy_org_today_204('52060206-0000-0000-0000-0000000000a1', true) - 60,
        'work_center_rate', 30, 'mo_created', gen_random_uuid(), 'pr206');

-- Item X: BOM-3 approved (film 0.05 kg/unit, scrap 2%), BOM-4 still a draft (film 0.06 kg/unit, scrap 2%).
-- Item Y: yield 98 on a line (B1). Item Z: operation 20 on the wrong work center (B3). Item P: phantom line.
INSERT INTO public.bom_headers (id, org_id, bom_number, item_id, quantity, bom_version, effective_date, status, is_active) VALUES
  ('52060206-0000-0000-0000-000000000103', '52060206-0000-0000-0000-0000000000a1', 'BOM-3', '52060206-0000-0000-0000-0000000001aa', 1, 3, '2026-01-01', 'APPROVED', true),
  ('52060206-0000-0000-0000-000000000104', '52060206-0000-0000-0000-0000000000a1', 'BOM-4', '52060206-0000-0000-0000-0000000001aa', 1, 4, '2026-01-01', 'DRAFT', true),
  ('52060206-0000-0000-0000-000000000105', '52060206-0000-0000-0000-0000000000a1', 'BOM-Y', '52060206-0000-0000-0000-0000000001bb', 1, 1, '2026-01-01', 'APPROVED', true),
  ('52060206-0000-0000-0000-000000000106', '52060206-0000-0000-0000-0000000000a1', 'BOM-Z', '52060206-0000-0000-0000-0000000001cc', 1, 1, '2026-01-01', 'APPROVED', true),
  ('52060206-0000-0000-0000-000000000107', '52060206-0000-0000-0000-0000000000a1', 'BOM-P', '52060206-0000-0000-0000-0000000001dd', 1, 1, '2026-01-01', 'APPROVED', true);
INSERT INTO public.bom_operations (org_id, bom_id, operation_sequence, operation_code, operation_name, work_center_id)
SELECT '52060206-0000-0000-0000-0000000000a1', b.id::uuid, o.seq, o.code, o.name, o.wc::uuid
FROM (VALUES ('52060206-0000-0000-0000-000000000103'), ('52060206-0000-0000-0000-000000000104'),
             ('52060206-0000-0000-0000-000000000105'), ('52060206-0000-0000-0000-000000000107')) b(id)
CROSS JOIN (VALUES (10, 'EXT', 'Extrude', '52060206-0000-0000-0000-0000000000d1'),
                   (20, 'PCK', 'Pack', '52060206-0000-0000-0000-0000000000d2')) o(seq, code, name, wc);
INSERT INTO public.bom_operations (org_id, bom_id, operation_sequence, operation_code, operation_name, work_center_id) VALUES
  ('52060206-0000-0000-0000-0000000000a1', '52060206-0000-0000-0000-000000000106', 10, 'EXT', 'Extrude', '52060206-0000-0000-0000-0000000000d1'),
  ('52060206-0000-0000-0000-0000000000a1', '52060206-0000-0000-0000-000000000106', 20, 'PCK-OTH', 'Pack elsewhere', '52060206-0000-0000-0000-0000000000d3');
ALTER TABLE public.bom_lines DISABLE TRIGGER USER;
INSERT INTO public.bom_lines (id, org_id, bom_id, sequence, item_id, quantity, quantity_base, scrap_factor, yield_percentage, operation_sequence, line_type) VALUES
  ('52060206-0000-0000-0000-000000000213', '52060206-0000-0000-0000-0000000000a1', '52060206-0000-0000-0000-000000000103', 1, '52060206-0000-0000-0000-0000000002f1', 0.05, 0.05, 2, 100, 10, 'COMPONENT'),
  ('52060206-0000-0000-0000-000000000214', '52060206-0000-0000-0000-0000000000a1', '52060206-0000-0000-0000-000000000104', 1, '52060206-0000-0000-0000-0000000002f1', 0.06, 0.06, 2, 100, 10, 'COMPONENT'),
  ('52060206-0000-0000-0000-000000000215', '52060206-0000-0000-0000-0000000000a1', '52060206-0000-0000-0000-000000000105', 1, '52060206-0000-0000-0000-0000000002f1', 0.05, 0.05, 0, 100, 10, 'COMPONENT'),
  ('52060206-0000-0000-0000-000000000216', '52060206-0000-0000-0000-0000000000a1', '52060206-0000-0000-0000-000000000105', 2, '52060206-0000-0000-0000-0000000002f2', 1, 1, 0, 98, 20, 'COMPONENT'),
  ('52060206-0000-0000-0000-000000000217', '52060206-0000-0000-0000-0000000000a1', '52060206-0000-0000-0000-000000000106', 1, '52060206-0000-0000-0000-0000000002f1', 0.05, 0.05, 0, 100, 10, 'COMPONENT'),
  ('52060206-0000-0000-0000-000000000218', '52060206-0000-0000-0000-0000000000a1', '52060206-0000-0000-0000-000000000107', 1, '52060206-0000-0000-0000-0000000002f3', 1, 1, 0, 100, 10, 'PHANTOM');
ALTER TABLE public.bom_lines ENABLE TRIGGER USER;

INSERT INTO public.manufacturing_orders (id, org_id, order_number, item_id, quantity, status) VALUES
  ('52060206-0000-0000-0000-0000000003a1', '52060206-0000-0000-0000-0000000000a1', 'PR206-MO-X', '52060206-0000-0000-0000-0000000001aa', 1000, 'in_progress'),
  ('52060206-0000-0000-0000-0000000003a2', '52060206-0000-0000-0000-0000000000a1', 'PR206-MO-Y', '52060206-0000-0000-0000-0000000001bb', 10, 'in_progress'),
  ('52060206-0000-0000-0000-0000000003a3', '52060206-0000-0000-0000-0000000000a1', 'PR206-MO-Z', '52060206-0000-0000-0000-0000000001cc', 10, 'in_progress'),
  ('52060206-0000-0000-0000-0000000003a4', '52060206-0000-0000-0000-0000000000a1', 'PR206-MO-P', '52060206-0000-0000-0000-0000000001dd', 10, 'in_progress');

-- Work-order triggers need a session user (maintenance version, load); fixtures are written as owner.
ALTER TABLE public.work_orders DISABLE TRIGGER USER;
INSERT INTO public.work_orders (id, org_id, mo_id, work_center_id, work_order_number, operation_sequence, operation_name, planned_quantity) VALUES
  ('52060206-0000-0000-0000-0000000004a1', '52060206-0000-0000-0000-0000000000a1', '52060206-0000-0000-0000-0000000003a1',
   '52060206-0000-0000-0000-0000000000d1', 'PR206-WO-10', 10, 'Extrude', 1000),
  ('52060206-0000-0000-0000-0000000004a2', '52060206-0000-0000-0000-0000000000a1', '52060206-0000-0000-0000-0000000003a1',
   '52060206-0000-0000-0000-0000000000d1', 'PR206-WO-20-WRONG-WC', 20, 'Pack on the extruder', 1000),
  ('52060206-0000-0000-0000-0000000004a3', '52060206-0000-0000-0000-0000000000a1', '52060206-0000-0000-0000-0000000003a2',
   '52060206-0000-0000-0000-0000000000d1', 'PR206-WO-OTHER-MO', 10, 'Extrude Y', 10);
ALTER TABLE public.work_orders ENABLE TRIGGER USER;

-- Times. T = the change effective time, two days ago (whole minutes). M = local midnight that starts
-- the previous month in Riyadh; the calendar starts the month before that.
SELECT set_config('pr.t', (date_trunc('minute', now()) - interval '2 days')::text, false);
SELECT set_config('pr.m', ((date_trunc('month', now() AT TIME ZONE 'Asia/Riyadh') - interval '1 month')
                            AT TIME ZONE 'Asia/Riyadh')::text, false);
SELECT set_config('pr.cal', (date_trunc('month', now() AT TIME ZONE 'Asia/Riyadh') - interval '2 months')::date::text, false);

CREATE TEMP TABLE pr_ids (k text PRIMARY KEY, id uuid);
GRANT SELECT, INSERT, UPDATE ON pr_ids TO authenticated;

-- Runs p_call as p_user (authenticated) and requires the outcome to contain p_expected ('OK' or a code).
-- A refused call leaves no trace (subtransaction). p_call may store a jsonb result in pr.last.
CREATE FUNCTION pg_temp.pr(p_user text, p_label text, p_call text, p_expected text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE v_got text; v_uid text; v_res jsonb;
BEGIN
  SELECT COALESCE((SELECT id::text FROM pr_users WHERE k = p_user), '') INTO v_uid;
  PERFORM set_config('request.jwt.claim.sub', v_uid, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', NULLIF(v_uid, ''), 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    EXECUTE 'SELECT (' || p_call || ')::jsonb' INTO v_res;
    PERFORM set_config('pr.last', COALESCE(v_res::text, 'null'), true);
    v_got := 'OK';
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE || ':' || SQLERRM;
  END;
  PERFORM set_config('role', 'none', true);
  IF (p_expected = 'OK' AND v_got <> 'OK') OR position(p_expected IN v_got) = 0 THEN
    RAISE EXCEPTION 'PR206_EXPECT_FAILED [%]: expected % got %', p_label, p_expected, v_got;
  END IF;
  RETURN v_got;
END
$fn$;
CREATE FUNCTION pg_temp.last(p_key text) RETURNS text LANGUAGE sql AS $fn$
  SELECT current_setting('pr.last')::jsonb ->> p_key;
$fn$;
CREATE FUNCTION pg_temp.keep(p_k text, p_key text) RETURNS void LANGUAGE sql AS $fn$
  INSERT INTO pr_ids VALUES (p_k, (current_setting('pr.last')::jsonb ->> p_key)::uuid)
  ON CONFLICT (k) DO UPDATE SET id = EXCLUDED.id;
$fn$;
CREATE FUNCTION pg_temp.id(p_k text) RETURNS text LANGUAGE sql AS $fn$
  SELECT quote_literal(id::text) || '::uuid' FROM pr_ids WHERE k = p_k;
$fn$;
CREATE FUNCTION pg_temp.eq(p_label text, p_got text, p_want text) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF p_got IS DISTINCT FROM p_want THEN
    RAISE EXCEPTION 'PR206_CHECK_FAILED [%]: got % want %', p_label, p_got, p_want;
  END IF;
END
$fn$;
-- A timestamp literal relative to T or M, e.g. pg_temp.at('t', '-1 day').
CREATE FUNCTION pg_temp.at(p_base text, p_offset text) RETURNS text LANGUAGE sql AS $fn$
  SELECT quote_literal((current_setting('pr.' || p_base)::timestamptz + p_offset::interval)::text) || '::timestamptz';
$fn$;
CREATE FUNCTION pg_temp.rec(p_label text, p_from_base text, p_from text, p_to_base text, p_to text, p_good numeric,
                            p_seq integer DEFAULT 10, p_user text DEFAULT 'recorder', p_expected text DEFAULT 'OK') RETURNS text
LANGUAGE sql AS $fn$
  SELECT pg_temp.pr(p_user, p_label, format(
    'public.rpc_record_production_206(%L, %L, %s, NULL, %s, 0, %s, %s, %L, gen_random_uuid())',
    '52060206-0000-0000-0000-0000000000a1', '52060206-0000-0000-0000-0000000003a1', p_seq, p_good,
    pg_temp.at(p_from_base, p_from), pg_temp.at(p_to_base, p_to), p_label), p_expected);
$fn$;
CREATE FUNCTION pg_temp.tr(p_user text, p_label text, p_kind text, p_k text, p_action text, p_reason text, p_expected text DEFAULT 'OK')
RETURNS text LANGUAGE sql AS $fn$
  SELECT pg_temp.pr(p_user, p_label, format('public.rpc_transition_production_entry_206(%L, %L, %s, %L, %L)',
    '52060206-0000-0000-0000-0000000000a1', p_kind, pg_temp.id(p_k), p_action, p_reason), p_expected);
$fn$;

-- ---------------------------------------------------------------------
-- 2. B6 calendar and B5 settings.
-- ---------------------------------------------------------------------
SELECT pg_temp.pr('recorder', 'calendar needs settings.update',
  format('public.rpc_add_mfg_period_calendar_206(%L, %L, %L)', '52060206-0000-0000-0000-0000000000a1', current_setting('pr.cal'), 'start'),
  'MANUFACTURING_SETTINGS_UPDATE_DENIED');
SELECT pg_temp.pr('settings', 'calendar month start only',
  format('public.rpc_add_mfg_period_calendar_206(%L, %L, %L)', '52060206-0000-0000-0000-0000000000a1',
         (current_setting('pr.cal')::date + 1)::text, 'start'), 'MFG_PERIOD_CALENDAR_START_NOT_MONTH_START');
SELECT pg_temp.pr('settings', 'calendar reason required',
  format('public.rpc_add_mfg_period_calendar_206(%L, %L, %L)', '52060206-0000-0000-0000-0000000000a1', current_setting('pr.cal'), ' '),
  'MFG_PRODUCTION_REASON_REQUIRED');

-- Recording before any calendar exists is refused (needs a snapshot first, checked below).
SELECT pg_temp.pr('settings', 'calendar v1',
  format('public.rpc_add_mfg_period_calendar_206(%L, %L, %L)', '52060206-0000-0000-0000-0000000000a1', current_setting('pr.cal'),
         'monthly periods in company time (B6)'), 'OK');
SELECT pg_temp.eq('calendar timezone captured', pg_temp.last('timezone'), 'Asia/Riyadh');
SELECT pg_temp.pr('b_user', 'other org cannot touch A calendar',
  format('public.rpc_add_mfg_period_calendar_206(%L, %L, %L)', '52060206-0000-0000-0000-0000000000a1', '2030-01-01', 'x'), 'NOT_ORG_MEMBER');

SELECT pg_temp.pr('settings', 'late window negative refused',
  format('public.rpc_set_mfg_late_entry_window_206(%L, -1, %L)', '52060206-0000-0000-0000-0000000000a1', 'x'),
  'MFG_LATE_WINDOW_INVALID');
SELECT pg_temp.pr('member', 'late window needs settings.update',
  format('public.rpc_set_mfg_late_entry_window_206(%L, 3, %L)', '52060206-0000-0000-0000-0000000000a1', 'x'),
  'MANUFACTURING_SETTINGS_UPDATE_DENIED');

-- ---------------------------------------------------------------------
-- 3/4. Snapshot creation guards: B3, B1, phantom, permissions, isolation.
-- ---------------------------------------------------------------------
SELECT pg_temp.pr('recorder', 'snapshot create needs its key',
  format('public.rpc_create_mo_bom_snapshot_206(%L, %L, NULL, NULL, NULL, gen_random_uuid())',
         '52060206-0000-0000-0000-0000000000a1', '52060206-0000-0000-0000-0000000003a1'),
  'MFG_PRODUCTION_PERMISSION_DENIED: manufacturing.bom_snapshots.create');
SELECT pg_temp.pr('b_user', 'snapshot other org refused',
  format('public.rpc_create_mo_bom_snapshot_206(%L, %L, NULL, NULL, NULL, gen_random_uuid())',
         '52060206-0000-0000-0000-0000000000a1', '52060206-0000-0000-0000-0000000003a1'), 'NOT_ORG_MEMBER');
SELECT pg_temp.pr('b_user', 'snapshot org/MO mismatch refused',
  format('public.rpc_create_mo_bom_snapshot_206(%L, %L, NULL, NULL, NULL, gen_random_uuid())',
         '52060206-0000-0000-0000-0000000000b1', '52060206-0000-0000-0000-0000000003a1'), 'MFG_PRODUCTION_MO_NOT_FOUND');
SELECT pg_temp.pr('planner', 'B3 stage map refuses naming the operation',
  format('public.rpc_create_mo_bom_snapshot_206(%L, %L, NULL, NULL, NULL, gen_random_uuid())',
         '52060206-0000-0000-0000-0000000000a1', '52060206-0000-0000-0000-0000000003a3'),
  'MFG_BOM_STAGE_MAP_NO_MATCH: operation 20 (PCK-OTH)');
SELECT pg_temp.pr('planner', 'phantom lines not pinned by 206',
  format('public.rpc_create_mo_bom_snapshot_206(%L, %L, NULL, NULL, NULL, gen_random_uuid())',
         '52060206-0000-0000-0000-0000000000a1', '52060206-0000-0000-0000-0000000003a4'),
  'MFG_BOM_SNAPSHOT_PHANTOM_UNSUPPORTED: line 1');
SELECT pg_temp.pr('planner', 'B1 draft with yield 98 is created',
  format('public.rpc_create_mo_bom_snapshot_206(%L, %L, NULL, NULL, NULL, gen_random_uuid())',
         '52060206-0000-0000-0000-0000000000a1', '52060206-0000-0000-0000-0000000003a2'), 'OK');
SELECT pg_temp.keep('snapY', 'id');
SELECT pg_temp.pr('snapappr', 'B1 approval refused naming the line',
  format('public.rpc_approve_mo_bom_snapshot_206(%L, %s)', '52060206-0000-0000-0000-0000000000a1', pg_temp.id('snapY')),
  'MFG_BOM_SNAPSHOT_YIELD_UNDECIDED: line 2');
SELECT pg_temp.pr('recorder', 'withdraw by someone else needs approve key',
  format('public.rpc_withdraw_mo_bom_snapshot_206(%L, %s, %L)', '52060206-0000-0000-0000-0000000000a1', pg_temp.id('snapY'), 'x'),
  'MFG_PRODUCTION_PERMISSION_DENIED');
SELECT pg_temp.pr('planner', 'withdraw own draft',
  format('public.rpc_withdraw_mo_bom_snapshot_206(%L, %s, %L)', '52060206-0000-0000-0000-0000000000a1', pg_temp.id('snapY'),
         'yield undecided'), 'OK');

-- ---------------------------------------------------------------------
-- 5. THE KEY SCENARIO on MO-X.
-- ---------------------------------------------------------------------
SELECT pg_temp.rec('no snapshot yet', 't', '-1 day', 't', '-1 day +1 hour', 10, 10, 'recorder', 'MFG_BOM_SNAPSHOT_NOT_APPROVED');
SELECT pg_temp.pr('planner', 'snapshot 1 draft (BOM-3 by pin date)',
  format('public.rpc_create_mo_bom_snapshot_206(%L, %L, NULL, NULL, NULL, %L)',
         '52060206-0000-0000-0000-0000000000a1', '52060206-0000-0000-0000-0000000003a1', '52060206-0000-0000-0000-00000000aaa1'), 'OK');
SELECT pg_temp.keep('snap1', 'id');
SELECT pg_temp.eq('snapshot 1 source', pg_temp.last('bom_number'), 'BOM-3');
SELECT pg_temp.pr('planner', 'snapshot 1 replay', format('public.rpc_create_mo_bom_snapshot_206(%L, %L, NULL, NULL, NULL, %L)',
         '52060206-0000-0000-0000-0000000000a1', '52060206-0000-0000-0000-0000000003a1', '52060206-0000-0000-0000-00000000aaa1'), 'OK');
SELECT pg_temp.eq('snapshot 1 replayed', pg_temp.last('replayed') || '/' || pg_temp.last('id'),
                     'true/' || (SELECT id::text FROM pr_ids WHERE k = 'snap1'));
SELECT pg_temp.eq('snapshot 1 stage map (B3)',
  (SELECT string_agg(o.operation_sequence || '->' || st.code, ',' ORDER BY o.operation_sequence)
   FROM wardah_internal.mo_bom_snapshot_operations_206 o JOIN public.manufacturing_stages st ON st.id = o.stage_id
   WHERE o.snapshot_id = (SELECT id FROM pr_ids WHERE k = 'snap1')), '10->ST-1,20->ST-2');
SELECT pg_temp.eq('snapshot 1 qty per unit (scrap as percent, B2)',
  (SELECT (qty_per_unit = 0.051)::text FROM wardah_internal.mo_bom_snapshot_lines_206 WHERE snapshot_id = (SELECT id FROM pr_ids WHERE k = 'snap1')),
  'true');
SELECT pg_temp.pr('snapappr', 'snapshot 1 approved',
  format('public.rpc_approve_mo_bom_snapshot_206(%L, %s)', '52060206-0000-0000-0000-0000000000a1', pg_temp.id('snap1')), 'OK');

-- Before the change: record A (three days ago).
SELECT pg_temp.rec('record A pre-change', 't', '-1 day', 't', '-1 day +4 hours', 400);
SELECT pg_temp.keep('recA', 'id');
SELECT pg_temp.eq('record A on snapshot 1', pg_temp.last('snapshot_id'), (SELECT id::text FROM pr_ids WHERE k = 'snap1'));
SELECT pg_temp.eq('record A late with window unset (B5)', pg_temp.last('is_late'), 'true');
-- Record D: executed after T, entered before the change is approved (on snapshot 1 at entry).
SELECT pg_temp.rec('record D after T before change approval', 't', '+1 day', 't', '+1 day +2 hours', 50);
SELECT pg_temp.keep('recD', 'id');

-- BOM-4 is approved during execution, and a change snapshot from T is drafted.
UPDATE public.bom_headers SET status = 'APPROVED' WHERE id = '52060206-0000-0000-0000-000000000104';
SELECT pg_temp.pr('planner', 'change needs bom, time and reason',
  format('public.rpc_create_mo_bom_snapshot_206(%L, %L, %L, %s, NULL, gen_random_uuid())',
         '52060206-0000-0000-0000-0000000000a1', '52060206-0000-0000-0000-0000000003a1',
         '52060206-0000-0000-0000-000000000104', pg_temp.at('t', '0')), 'MFG_BOM_SNAPSHOT_CHANGE_INCOMPLETE');
SELECT pg_temp.pr('planner', 'change snapshot draft (BOM-4 from T)',
  format('public.rpc_create_mo_bom_snapshot_206(%L, %L, %L, %s, %L, gen_random_uuid())',
         '52060206-0000-0000-0000-0000000000a1', '52060206-0000-0000-0000-0000000003a1',
         '52060206-0000-0000-0000-000000000104', pg_temp.at('t', '0'), 'film gauge change (BOM-4)'), 'OK');
SELECT pg_temp.keep('snap2', 'id');
SELECT pg_temp.pr('snapappr', 'change refused while record D ends after T',
  format('public.rpc_approve_mo_bom_snapshot_206(%L, %s)', '52060206-0000-0000-0000-0000000000a1', pg_temp.id('snap2')),
  'MFG_BOM_SNAPSHOT_CHANGE_CONFLICTS_RECORDS: 1 record(s)');
SELECT pg_temp.tr('recorder', 'withdraw record D', 'record', 'recD', 'withdraw', 'entered on the wrong BOM');
SELECT pg_temp.pr('snapappr', 'change snapshot approved',
  format('public.rpc_approve_mo_bom_snapshot_206(%L, %s)', '52060206-0000-0000-0000-0000000000a1', pg_temp.id('snap2')), 'OK');
SELECT pg_temp.eq('snapshot 2 qty per unit', (SELECT (qty_per_unit = 0.0612)::text FROM wardah_internal.mo_bom_snapshot_lines_206
  WHERE snapshot_id = (SELECT id FROM pr_ids WHERE k = 'snap2')), 'true');

-- After the change: record B processed after T -> snapshot 2.
SELECT pg_temp.rec('record B post-change', 't', '+1 day', 't', '+1 day +4 hours', 600);
SELECT pg_temp.keep('recB', 'id');
SELECT pg_temp.eq('record B on snapshot 2', pg_temp.last('snapshot_id'), (SELECT id::text FROM pr_ids WHERE k = 'snap2'));
-- Shift entered late: processed before T, entered after the change -> snapshot 1.
SELECT pg_temp.rec('record C late, processed before T', 't', '-6 hours', 't', '-2 hours', 100);
SELECT pg_temp.keep('recC', 'id');
SELECT pg_temp.eq('record C stays on snapshot 1', pg_temp.last('snapshot_id'), (SELECT id::text FROM pr_ids WHERE k = 'snap1'));
-- Ends exactly at T: still snapshot 1 (half-open interval).
SELECT pg_temp.rec('record ending at T', 't', '-1 hour', 't', '0', 5);
SELECT pg_temp.eq('ending at T on snapshot 1', pg_temp.last('snapshot_id'), (SELECT id::text FROM pr_ids WHERE k = 'snap1'));
-- Starts exactly at T: snapshot 2.
SELECT pg_temp.rec('record starting at T', 't', '0', 't', '+1 hour', 5);
SELECT pg_temp.eq('starting at T on snapshot 2', pg_temp.last('snapshot_id'), (SELECT id::text FROM pr_ids WHERE k = 'snap2'));
SELECT pg_temp.rec('record across T refused', 't', '-1 hour', 't', '+1 hour', 10, 10, 'recorder', 'MFG_PRODUCTION_SPANS_SNAPSHOT_CHANGE');
SELECT pg_temp.rec('future execution refused', 't', '+2 days', 't', '+3 days', 10, 10, 'recorder', 'MFG_PRODUCTION_EXECUTION_IN_FUTURE');
SELECT pg_temp.rec('to before from refused', 't', '+1 hour', 't', '0', 10, 10, 'recorder', 'MFG_PRODUCTION_EXECUTION_INVALID');
SELECT pg_temp.rec('operation not in snapshot', 't', '+1 day', 't', '+1 day +1 hour', 10, 30, 'recorder', 'MFG_PRODUCTION_OPERATION_NOT_IN_SNAPSHOT: 30');
SELECT pg_temp.rec('stage 20 attributed', 't', '+1 day', 't', '+1 day +1 hour', 7, 20);
SELECT pg_temp.eq('operation 20 -> ST-2', (SELECT code FROM public.manufacturing_stages WHERE id = pg_temp.last('stage_id')::uuid), 'ST-2');
-- B3 (owner, 2026-11-25): a record linked to a work order must match the snapshot operation.
CREATE FUNCTION pg_temp.recwo(p_label text, p_seq integer, p_wo text, p_expected text) RETURNS text LANGUAGE sql AS $fn$
  SELECT pg_temp.pr('recorder', p_label, format(
    'public.rpc_record_production_206(%L, %L, %s, %L, 11, 0, %s, %s, %L, gen_random_uuid())',
    '52060206-0000-0000-0000-0000000000a1', '52060206-0000-0000-0000-0000000003a1', p_seq, p_wo,
    pg_temp.at('t', '+1 day'), pg_temp.at('t', '+1 day +1 hour'), p_label), p_expected);
$fn$;
SELECT pg_temp.recwo('work order on the snapshot operation', 10, '52060206-0000-0000-0000-0000000004a1', 'OK');
SELECT pg_temp.keep('recWO', 'id');
SELECT pg_temp.recwo('work order at another work center', 20, '52060206-0000-0000-0000-0000000004a2',
  'MFG_PRODUCTION_WORK_ORDER_STAGE_MISMATCH: work order PR206-WO-20-WRONG-WC');
SELECT pg_temp.recwo('work order of another operation', 20, '52060206-0000-0000-0000-0000000004a1',
  'MFG_PRODUCTION_WORK_ORDER_STAGE_MISMATCH: work order PR206-WO-10 (operation 10) vs snapshot operation 20');
SELECT pg_temp.recwo('work order of another order', 10, '52060206-0000-0000-0000-0000000004a3', 'MFG_PRODUCTION_WORK_ORDER_NOT_ON_ORDER');
SELECT pg_temp.tr('recorder', 'submit WO record', 'record', 'recWO', 'submit', NULL);
-- The work order is moved to another work center before approval: the approval re-checks and refuses.
ALTER TABLE public.work_orders DISABLE TRIGGER USER;
UPDATE public.work_orders SET work_center_id = '52060206-0000-0000-0000-0000000000d2' WHERE id = '52060206-0000-0000-0000-0000000004a1';
ALTER TABLE public.work_orders ENABLE TRIGGER USER;
SELECT pg_temp.tr('lateappr', 'approval re-checks the work order', 'record', 'recWO', 'approve', 'late sheet',
                  'MFG_PRODUCTION_WORK_ORDER_STAGE_MISMATCH');
ALTER TABLE public.work_orders DISABLE TRIGGER USER;
UPDATE public.work_orders SET work_center_id = '52060206-0000-0000-0000-0000000000d1' WHERE id = '52060206-0000-0000-0000-0000000004a1';
ALTER TABLE public.work_orders ENABLE TRIGGER USER;
SELECT pg_temp.tr('lateappr', 'WO record approved once it matches', 'record', 'recWO', 'approve', 'late sheet');
SELECT pg_temp.rec('member cannot record', 't', '+1 day', 't', '+1 day +1 hour', 7, 10, 'member',
                   'MFG_PRODUCTION_PERMISSION_DENIED: manufacturing.production_records.record');
SELECT pg_temp.pr('snapappr', 'a second change cannot start at or before T',
  format('public.rpc_create_mo_bom_snapshot_206(%L, %L, %L, %s, %L, gen_random_uuid())',
         '52060206-0000-0000-0000-0000000000a1', '52060206-0000-0000-0000-0000000003a1',
         '52060206-0000-0000-0000-000000000103', pg_temp.at('t', '0'), 'x'), 'MFG_PRODUCTION_PERMISSION_DENIED');
SELECT pg_temp.pr('planner', 'a second change cannot start at or before T (planner)',
  format('public.rpc_create_mo_bom_snapshot_206(%L, %L, %L, %s, %L, gen_random_uuid())',
         '52060206-0000-0000-0000-0000000000a1', '52060206-0000-0000-0000-0000000003a1',
         '52060206-0000-0000-0000-000000000103', pg_temp.at('t', '0'), 'x'), 'MFG_BOM_SNAPSHOT_EFFECTIVE_NOT_AFTER_LATEST');

-- Approvals: submit, self-approval refused, late needs approve_late and a reason.
SELECT pg_temp.tr('approver', 'only the recorder submits', 'record', 'recA', 'submit', NULL, 'MFG_PRODUCTION_NOT_RECORDER');
SELECT pg_temp.tr('recorder', 'submit A', 'record', 'recA', 'submit', NULL);
SELECT pg_temp.tr('recorder', 'submit B', 'record', 'recB', 'submit', NULL);
SELECT pg_temp.tr('recorder', 'submit C', 'record', 'recC', 'submit', NULL);
SELECT pg_temp.tr('recorder', 'recorder cannot approve', 'record', 'recA', 'approve', NULL, 'MFG_PRODUCTION_PERMISSION_DENIED');
SELECT pg_temp.tr('approver', 'late A needs approve_late', 'record', 'recA', 'approve', 'shift sheet arrived late',
                  'MFG_PRODUCTION_PERMISSION_DENIED: manufacturing.production_records.approve_late');
SELECT pg_temp.tr('lateappr', 'late A needs a reason', 'record', 'recA', 'approve', NULL, 'MFG_PRODUCTION_LATE_REASON_REQUIRED');
SELECT pg_temp.tr('lateappr', 'late A approved exceptionally', 'record', 'recA', 'approve', 'shift sheet arrived late');
SELECT pg_temp.eq('A late approval recorded', pg_temp.last('late_approval'), 'true');
SELECT pg_temp.tr('approver', 'B entered the day after needs approve_late', 'record', 'recB', 'approve', NULL,
                  'MFG_PRODUCTION_PERMISSION_DENIED: manufacturing.production_records.approve_late');

-- B5: a configured window. B ended about one day ago, C about two days ago (local dates).
SELECT pg_temp.pr('settings', 'late window 2 days',
  format('public.rpc_set_mfg_late_entry_window_206(%L, 2, %L)', '52060206-0000-0000-0000-0000000000a1', 'shift sheets within 2 days'), 'OK');
SELECT pg_temp.eq('settings audited', (SELECT count(*)::text FROM wardah_internal.mfg_recording_settings_audit_206
  WHERE org_id = '52060206-0000-0000-0000-0000000000a1' AND new_value = '2'::jsonb AND old_value IS NULL), '1');
-- The window is captured on the record at entry; B and C were entered with the window unset.
SELECT pg_temp.eq('B keeps the entry-time window', (SELECT is_late::text || '/' || COALESCE(late_window_days::text, 'unset')
  FROM wardah_internal.mfg_production_records_206 WHERE id = (SELECT id FROM pr_ids WHERE k = 'recB')), 'true/unset');
SELECT pg_temp.rec('record E within the window', 't', '+1 day', 't', '+1 day +3 hours', 20);
SELECT pg_temp.keep('recE', 'id');
SELECT pg_temp.eq('E on time within window', pg_temp.last('is_late') || '/' || pg_temp.last('late_window_days'), 'false/2');
SELECT pg_temp.tr('recorder', 'submit E', 'record', 'recE', 'submit', NULL);
SELECT pg_temp.tr('approver', 'E approved without approve_late', 'record', 'recE', 'approve', NULL);
SELECT pg_temp.tr('lateappr', 'B approved exceptionally', 'record', 'recB', 'approve', 'entered next day');
SELECT pg_temp.tr('approver', 'reject C needs a reason', 'record', 'recC', 'reject', NULL, 'MFG_PRODUCTION_REASON_REQUIRED');
SELECT pg_temp.tr('lateappr', 'C approved exceptionally', 'record', 'recC', 'approve', 'night shift sheet');
SELECT pg_temp.tr('lateappr', 'approved is final', 'record', 'recC', 'reject', 'x', 'MFG_PRODUCTION_STATUS_INVALID: approved');

-- Attribution summary: every approved quantity keeps its snapshot; expected film follows the snapshot
-- of the processing time (400 + 100 at 0.051 on snapshot 1; 600 + 20 + 11 at 0.0612 on snapshot 2).
SELECT pg_temp.eq('approved quantities by snapshot',
  (SELECT string_agg(s.snapshot_no || ':' || sum_good, ',' ORDER BY s.snapshot_no) FROM (
     SELECT r.snapshot_id, sum(r.good_quantity)::text AS sum_good FROM wardah_internal.mfg_production_records_206 r
     WHERE r.mo_id = '52060206-0000-0000-0000-0000000003a1' AND r.status = 'approved' GROUP BY r.snapshot_id) x
   JOIN wardah_internal.mo_bom_snapshots_206 s ON s.id = x.snapshot_id), '1:500,2:631');
SELECT pg_temp.eq('expected film from each record''s own snapshot',
  (SELECT round(sum(r.good_quantity * l.qty_per_unit), 4)::text FROM wardah_internal.mfg_production_records_206 r
   JOIN wardah_internal.mo_bom_snapshot_lines_206 l ON l.snapshot_id = r.snapshot_id
   WHERE r.mo_id = '52060206-0000-0000-0000-0000000003a1' AND r.status = 'approved'), '64.1172');
SELECT pg_temp.eq('withdrawn D stays traceable on snapshot 1',
  (SELECT status || '/' || (snapshot_id = (SELECT id FROM pr_ids WHERE k = 'snap1'))::text
   FROM wardah_internal.mfg_production_records_206 WHERE id = (SELECT id FROM pr_ids WHERE k = 'recD')), 'withdrawn/true');

-- ---------------------------------------------------------------------
-- 6. B6 local midnight at the start of the previous month (Riyadh +03:00).
-- ---------------------------------------------------------------------
SELECT pg_temp.rec('30 min before local midnight', 'm', '-40 minutes', 'm', '-30 minutes', 3);
SELECT pg_temp.eq('before midnight -> earlier month', pg_temp.last('execution_period_start'),
  ((current_setting('pr.m')::timestamptz AT TIME ZONE 'Asia/Riyadh')::date - interval '1 month')::date::text);
SELECT pg_temp.rec('30 min after local midnight', 'm', '+30 minutes', 'm', '+40 minutes', 3);
SELECT pg_temp.eq('after midnight -> the month M starts', pg_temp.last('execution_period_start'),
  (current_setting('pr.m')::timestamptz AT TIME ZONE 'Asia/Riyadh')::date::text);
SELECT pg_temp.eq('UTC date of the after-midnight record is still the previous day',
  ((current_setting('pr.m')::timestamptz + interval '30 minutes') AT TIME ZONE 'UTC')::date::text,
  ((current_setting('pr.m')::timestamptz AT TIME ZONE 'Asia/Riyadh')::date - 1)::text);
SELECT pg_temp.pr('settings', 'a later calendar version cannot re-date recorded periods',
  format('public.rpc_add_mfg_period_calendar_206(%L, %L, %L)', '52060206-0000-0000-0000-0000000000a1',
         (current_setting('pr.m')::timestamptz AT TIME ZONE 'Asia/Riyadh')::date::text, 'x'), 'MFG_PERIOD_CALENDAR_RECORDS_EXIST');
SELECT pg_temp.pr('settings', 'a calendar version cannot precede the latest',
  format('public.rpc_add_mfg_period_calendar_206(%L, %L, %L)', '52060206-0000-0000-0000-0000000000a1', '2020-01-01', 'x'),
  'MFG_PERIOD_CALENDAR_NOT_AFTER_LATEST');
SELECT pg_temp.rec('before the calendar starts refused', 'm', '-90 days', 'm', '-90 days +1 hour', 3, 10, 'recorder',
                   'MFG_PERIOD_CALENDAR_NOT_IN_FORCE');

-- ---------------------------------------------------------------------
-- 8. B7 inputs.
-- ---------------------------------------------------------------------
SELECT pg_temp.pr('recorder', 'labor hours need an activity',
  format('public.rpc_record_production_input_206(%L, %L, 10, %L, NULL, 8, NULL, %s, %s, NULL, gen_random_uuid())',
         '52060206-0000-0000-0000-0000000000a1', '52060206-0000-0000-0000-0000000003a1', 'labor_hours',
         pg_temp.at('t', '+1 day'), pg_temp.at('t', '+1 day +8 hours')), 'MFG_PRODUCTION_INPUT_KIND_INVALID');
SELECT pg_temp.pr('recorder', 'count needs a unit',
  format('public.rpc_record_production_input_206(%L, %L, 10, %L, NULL, 8, NULL, %s, %s, NULL, gen_random_uuid())',
         '52060206-0000-0000-0000-0000000000a1', '52060206-0000-0000-0000-0000000003a1', 'count',
         pg_temp.at('t', '+1 day'), pg_temp.at('t', '+1 day +8 hours')), 'MFG_PRODUCTION_INPUT_KIND_INVALID');
SELECT pg_temp.pr('lateappr', 'machine hours by lateappr',
  format('public.rpc_record_production_input_206(%L, %L, 10, %L, %L, 6.5, NULL, %s, %s, NULL, gen_random_uuid())',
         '52060206-0000-0000-0000-0000000000a1', '52060206-0000-0000-0000-0000000003a1', 'machine_hours', 'run',
         pg_temp.at('t', '+1 day'), pg_temp.at('t', '+1 day +7 hours')), 'OK');
SELECT pg_temp.keep('inM', 'id');
SELECT pg_temp.eq('input on snapshot 2 and stage ST-1', (SELECT st.code || '/' || s.snapshot_no
  FROM wardah_internal.mfg_production_inputs_206 i JOIN public.manufacturing_stages st ON st.id = i.stage_id
  JOIN wardah_internal.mo_bom_snapshots_206 s ON s.id = i.snapshot_id WHERE i.id = (SELECT id FROM pr_ids WHERE k = 'inM')), 'ST-1/2');
SELECT pg_temp.tr('lateappr', 'submit input', 'input', 'inM', 'submit', NULL);
SELECT pg_temp.tr('lateappr', 'B7 recorder never approves own input', 'input', 'inM', 'approve', NULL, 'MFG_PRODUCTION_SELF_APPROVAL_DENIED');
SELECT pg_temp.tr('lateappr', 'B7 nor rejects it', 'input', 'inM', 'reject', 'x', 'MFG_PRODUCTION_SELF_APPROVAL_DENIED');
SELECT pg_temp.tr('planner', 'input approval needs its key', 'input', 'inM', 'approve', NULL,
                  'MFG_PRODUCTION_PERMISSION_DENIED: manufacturing.production_inputs.approve');
SELECT pg_temp.tr('approver', 'input approved by another user', 'input', 'inM', 'approve', NULL);
SELECT pg_temp.pr('recorder', 'count input',
  format('public.rpc_record_production_input_206(%L, %L, 20, %L, NULL, 120, %L, %s, %s, NULL, gen_random_uuid())',
         '52060206-0000-0000-0000-0000000000a1', '52060206-0000-0000-0000-0000000003a1', 'count', 'cartons',
         pg_temp.at('t', '+1 day'), pg_temp.at('t', '+1 day +7 hours')), 'OK');
-- The org admin bypass of has_permission does not bypass B7: an admin cannot approve their own entry.
SELECT pg_temp.pr('admin', 'admin records an input',
  format('public.rpc_record_production_input_206(%L, %L, 10, %L, %L, 1, NULL, %s, %s, NULL, gen_random_uuid())',
         '52060206-0000-0000-0000-0000000000a1', '52060206-0000-0000-0000-0000000003a1', 'labor_hours', 'setup',
         pg_temp.at('t', '+1 day'), pg_temp.at('t', '+1 day +1 hour')), 'OK');
SELECT pg_temp.keep('inAdmin', 'id');
SELECT pg_temp.tr('admin', 'admin submits', 'input', 'inAdmin', 'submit', NULL);
SELECT pg_temp.tr('admin', 'admin cannot self-approve', 'input', 'inAdmin', 'approve', NULL, 'MFG_PRODUCTION_SELF_APPROVAL_DENIED');

-- ---------------------------------------------------------------------
-- 9. Idempotency, reads, immutability.
-- ---------------------------------------------------------------------
SELECT pg_temp.pr('recorder', 'record with key',
  format('public.rpc_record_production_206(%L, %L, 10, NULL, 9, 1, %s, %s, NULL, %L)', '52060206-0000-0000-0000-0000000000a1',
         '52060206-0000-0000-0000-0000000003a1', pg_temp.at('t', '+1 day'), pg_temp.at('t', '+1 day +1 hour'),
         '52060206-0000-0000-0000-00000000bbb1'), 'OK');
SELECT pg_temp.pr('recorder', 'same key same payload replays',
  format('public.rpc_record_production_206(%L, %L, 10, NULL, 9, 1, %s, %s, NULL, %L)', '52060206-0000-0000-0000-0000000000a1',
         '52060206-0000-0000-0000-0000000003a1', pg_temp.at('t', '+1 day'), pg_temp.at('t', '+1 day +1 hour'),
         '52060206-0000-0000-0000-00000000bbb1'), 'OK');
SELECT pg_temp.eq('replayed', pg_temp.last('replayed'), 'true');
SELECT pg_temp.pr('recorder', 'same key other payload conflicts',
  format('public.rpc_record_production_206(%L, %L, 10, NULL, 8, 1, %s, %s, NULL, %L)', '52060206-0000-0000-0000-0000000000a1',
         '52060206-0000-0000-0000-0000000003a1', pg_temp.at('t', '+1 day'), pg_temp.at('t', '+1 day +1 hour'),
         '52060206-0000-0000-0000-00000000bbb1'), 'MFG_PRODUCTION_IDEMPOTENCY_CONFLICT');
SELECT pg_temp.pr('recorder', 'read MO production',
  format('public.rpc_get_mo_production_206(%L, %L)', '52060206-0000-0000-0000-0000000000a1', '52060206-0000-0000-0000-0000000003a1'), 'OK');
SELECT pg_temp.eq('read shows two approved snapshots', (SELECT count(*)::text FROM jsonb_array_elements(current_setting('pr.last')::jsonb->'snapshots') e
  WHERE e->>'status' = 'approved'), '2');
SELECT pg_temp.pr('member', 'read needs a manufacturing key',
  format('public.rpc_get_mo_production_206(%L, %L)', '52060206-0000-0000-0000-0000000000a1', '52060206-0000-0000-0000-0000000003a1'),
  'MFG_PRODUCTION_PERMISSION_DENIED');
SELECT pg_temp.pr('b_user', 'read other org refused',
  format('public.rpc_get_mo_production_206(%L, %L)', '52060206-0000-0000-0000-0000000000a1', '52060206-0000-0000-0000-0000000003a1'), 'NOT_ORG_MEMBER');

DO $immutable$
DECLARE v_err text;
BEGIN
  BEGIN
    UPDATE wardah_internal.mfg_production_records_206 SET good_quantity = 1 WHERE id = (SELECT id FROM pr_ids WHERE k = 'recA');
    RAISE EXCEPTION 'PR206_UPDATE_NOT_REFUSED';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    UPDATE wardah_internal.mfg_production_records_206 SET status = 'draft' WHERE id = (SELECT id FROM pr_ids WHERE k = 'recA');
    RAISE EXCEPTION 'PR206_STATUS_BACK_NOT_REFUSED';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    DELETE FROM wardah_internal.mfg_production_records_206 WHERE id = (SELECT id FROM pr_ids WHERE k = 'recA');
    RAISE EXCEPTION 'PR206_DELETE_NOT_REFUSED';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    UPDATE wardah_internal.mo_bom_snapshot_lines_206 SET qty_per_unit = 1 WHERE snapshot_id = (SELECT id FROM pr_ids WHERE k = 'snap1');
    RAISE EXCEPTION 'PR206_LINE_UPDATE_NOT_REFUSED';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    INSERT INTO wardah_internal.mo_bom_snapshot_lines_206 (snapshot_id, org_id, bom_line_id, item_id, line_type, quantity, scrap_factor_percent, qty_per_unit)
    VALUES ((SELECT id FROM pr_ids WHERE k = 'snap1'), '52060206-0000-0000-0000-0000000000a1', gen_random_uuid(), gen_random_uuid(), 'COMPONENT', 1, 0, 1);
    RAISE EXCEPTION 'PR206_LINE_INSERT_AFTER_APPROVAL_NOT_REFUSED';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    UPDATE wardah_internal.mo_bom_snapshots_206 SET effective_from_at = now() WHERE id = (SELECT id FROM pr_ids WHERE k = 'snap2');
    RAISE EXCEPTION 'PR206_SNAPSHOT_UPDATE_NOT_REFUSED';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    DELETE FROM public.manufacturing_orders WHERE id = '52060206-0000-0000-0000-0000000003a1';
    RAISE EXCEPTION 'PR206_MO_DELETE_WITH_HISTORY_NOT_REFUSED';
  EXCEPTION WHEN foreign_key_violation OR SQLSTATE '55000' THEN NULL;
  END;
  -- The 204 pin rows and the source BOM are unchanged by 206.
  IF (SELECT count(*) FROM wardah_internal.mo_cost_policy_pins WHERE org_id = '52060206-0000-0000-0000-0000000000a1') <> 4 THEN
    RAISE EXCEPTION 'PR206_204_PINS_CHANGED';
  END IF;
  IF (SELECT count(*) FROM public.audit_logs WHERE org_id = '52060206-0000-0000-0000-0000000000a1'
      AND metadata->>'migration' = '206') < 20 THEN
    RAISE EXCEPTION 'PR206_AUDIT_MISSING';
  END IF;
  RAISE NOTICE 'PR206_IMMUTABILITY_OK';
END
$immutable$;

DO $done$ BEGIN RAISE NOTICE 'PRODUCTION_RECORDING_206_ACCEPTANCE_OK'; END $done$;

ROLLBACK;
