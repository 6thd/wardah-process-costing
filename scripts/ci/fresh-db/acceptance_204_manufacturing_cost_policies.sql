-- Acceptance for Migration 204: run on a fresh database through 204.
--
-- Owner decision (2026-10-22): per-company cost policies. Proves:
--   1. storage is private (no client privilege) and only the four RPCs are
--      granted, to authenticated only; nothing is seeded;
--   2. reading needs manufacturing.settings.read or the M201 update right;
--      writing needs the M201 update right (key holder or org admin);
--   3. every validation rule refuses before any write (no partial rows);
--   4. creation is idempotent per key, version-checked, append-only in time;
--   5. absorption arithmetic for both labor sources, both bases, work-center
--      override and exclusion, missing vs zero drivers, rounding;
--   6. an MO is pinned to the version in force on its creation day, once;
--   7. withdrawal only before use; versions, pools, rules and pins immutable;
--   8. org isolation for reads, writes, versions and work centers.
--
-- Fixture rows are written as the table owner; every probe of a client path
-- runs as authenticated through the public RPCs. Rolled back at the end.
\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Catalog and privileges.
-- ---------------------------------------------------------------------
DO $catalog$
DECLARE
  v_table text;
  v_fn text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'wardah_internal.mfg_cost_policy_versions', 'wardah_internal.mfg_cost_policy_pools',
    'wardah_internal.mfg_cost_policy_wc_rules', 'wardah_internal.mfg_cost_policy_wc_pool_rules',
    'wardah_internal.mo_cost_policy_pins'] LOOP
    IF has_table_privilege('authenticated', v_table, 'SELECT')
       OR has_table_privilege('authenticated', v_table, 'INSERT')
       OR has_table_privilege('authenticated', v_table, 'UPDATE')
       OR has_table_privilege('authenticated', v_table, 'DELETE')
       OR has_table_privilege('anon', v_table, 'SELECT')
       OR has_table_privilege('service_role', v_table, 'SELECT') THEN
      RAISE EXCEPTION 'CP204_TABLE_EXPOSED: %', v_table;
    END IF;
  END LOOP;
  FOREACH v_fn IN ARRAY ARRAY[
    'public.rpc_get_mfg_cost_policy(uuid)',
    'public.rpc_create_mfg_cost_policy_version(uuid,jsonb,integer,uuid)',
    'public.rpc_withdraw_mfg_cost_policy_version(uuid,uuid,text)',
    'public.rpc_preview_mfg_cost_absorption(uuid,uuid,uuid,numeric,numeric,numeric)'] LOOP
    IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR has_function_privilege('anon', v_fn, 'EXECUTE')
       OR has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'CP204_RPC_ACL_UNEXPECTED: %', v_fn;
    END IF;
  END LOOP;
  FOREACH v_fn IN ARRAY ARRAY[
    'wardah_internal.mfg_cost_policy_compute_204(uuid,uuid,uuid,numeric,numeric,numeric)',
    'wardah_internal.mfg_cost_policy_version_at_204(uuid,date)',
    'wardah_internal.mfg_cost_policy_org_today_204(uuid,boolean)',
    'wardah_internal.mfg_cost_policy_can_read_204(uuid)',
    'wardah_internal.mfg_cost_policy_version_json_204(uuid,date)',
    'wardah_internal.pin_mo_cost_policy_204()',
    'wardah_internal.mfg_cost_policy_immutable_204()'] LOOP
    IF has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR has_function_privilege('anon', v_fn, 'EXECUTE')
       OR has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'CP204_INTERNAL_EXPOSED: %', v_fn;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'pin_mo_cost_policy_204'
                 AND tgrelid = 'public.manufacturing_orders'::regclass AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'CP204_PIN_TRIGGER_MISSING';
  END IF;
  IF EXISTS (SELECT 1 FROM wardah_internal.mfg_cost_policy_versions) THEN
    RAISE EXCEPTION 'CP204_UNEXPECTED_SEED';
  END IF;
  RAISE NOTICE 'CP204_CATALOG_OK';
END
$catalog$;

-- ---------------------------------------------------------------------
-- Fixtures. Org A: admin by role, key holder (update), reader (read only),
-- plain member; org B with its own admin. Work centers in both orgs.
-- ---------------------------------------------------------------------
INSERT INTO public.organizations (id, name, code) VALUES
  ('52040204-0000-0000-0000-0000000000a1', 'Cost Policy 204 A', 'CP204-A'),
  ('52040204-0000-0000-0000-0000000000b1', 'Cost Policy 204 B', 'CP204-B');

INSERT INTO auth.users (id, email) VALUES
  ('52040204-0000-0000-0000-0000000000a2', 'cp204-admin@example.test'),
  ('52040204-0000-0000-0000-0000000000a3', 'cp204-editor@example.test'),
  ('52040204-0000-0000-0000-0000000000a4', 'cp204-reader@example.test'),
  ('52040204-0000-0000-0000-0000000000a6', 'cp204-member@example.test'),
  ('52040204-0000-0000-0000-0000000000b2', 'cp204-other-admin@example.test');

INSERT INTO public.user_organizations (user_id, org_id, role, is_active, is_org_admin) VALUES
  ('52040204-0000-0000-0000-0000000000a2', '52040204-0000-0000-0000-0000000000a1', 'admin', true, false),
  ('52040204-0000-0000-0000-0000000000a3', '52040204-0000-0000-0000-0000000000a1', 'user', true, false),
  ('52040204-0000-0000-0000-0000000000a4', '52040204-0000-0000-0000-0000000000a1', 'user', true, false),
  ('52040204-0000-0000-0000-0000000000a6', '52040204-0000-0000-0000-0000000000a1', 'user', true, false),
  ('52040204-0000-0000-0000-0000000000b2', '52040204-0000-0000-0000-0000000000b1', 'admin', true, false);

INSERT INTO public.roles (id, org_id, name, name_ar, is_active) VALUES
  ('52040204-0000-0000-0000-0000000000c1', '52040204-0000-0000-0000-0000000000a1',
   'Cost Policy Editor', 'محرر سياسات التكلفة', true),
  ('52040204-0000-0000-0000-0000000000c2', '52040204-0000-0000-0000-0000000000a1',
   'Cost Policy Reader', 'قارئ سياسات التكلفة', true);
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT '52040204-0000-0000-0000-0000000000c1'::uuid, p.id FROM public.permissions p
WHERE p.permission_key IN ('manufacturing.settings.read', 'manufacturing.settings.update');
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT '52040204-0000-0000-0000-0000000000c2'::uuid, p.id FROM public.permissions p
WHERE p.permission_key = 'manufacturing.settings.read';
INSERT INTO public.user_roles (user_id, role_id, org_id) VALUES
  ('52040204-0000-0000-0000-0000000000a3', '52040204-0000-0000-0000-0000000000c1', '52040204-0000-0000-0000-0000000000a1'),
  ('52040204-0000-0000-0000-0000000000a4', '52040204-0000-0000-0000-0000000000c2', '52040204-0000-0000-0000-0000000000a1');

INSERT INTO public.work_centers (id, org_id, code, name, is_active) VALUES
  ('52040204-0000-0000-0000-0000000000d1', '52040204-0000-0000-0000-0000000000a1', 'WC-A', 'Mixing', true),
  ('52040204-0000-0000-0000-0000000000d2', '52040204-0000-0000-0000-0000000000a1', 'WC-B', 'Packing', true),
  ('52040204-0000-0000-0000-0000000000d3', '52040204-0000-0000-0000-0000000000a1', 'WC-C', 'Curing', true),
  ('52040204-0000-0000-0000-0000000000d4', '52040204-0000-0000-0000-0000000000a1', 'WC-OFF', 'Retired', false),
  ('52040204-0000-0000-0000-0000000000e1', '52040204-0000-0000-0000-0000000000b1', 'WC-B1', 'Other org', true);

-- Org "today" for A and B, and the base policy, kept in session settings so
-- the authenticated probes can read them.
SELECT set_config('cp.today_a', wardah_internal.mfg_cost_policy_org_today_204(
  '52040204-0000-0000-0000-0000000000a1', true)::text, false);
SELECT set_config('cp.base', jsonb_build_object(
  'effective_from', current_setting('cp.today_a'),
  'labor_cost_source', 'work_center_rate',
  'default_labor_rate_per_hour', 30,
  'note', 'Initial policy',
  'overhead_pools', jsonb_build_array(
    jsonb_build_object('pool_code', 'LABOR_OH', 'name', 'Labor-driven overhead',
                       'name_ar', 'أعباء على ساعات العمل', 'basis', 'labor_hours', 'rate', 12),
    jsonb_build_object('pool_code', 'MACHINE_OH', 'name', 'Machine overhead',
                       'basis', 'machine_hours', 'rate', 40)),
  'work_center_rules', jsonb_build_array(
    jsonb_build_object('work_center_id', '52040204-0000-0000-0000-0000000000d1',
                       'labor_rate_per_hour', 35,
                       'pools', jsonb_build_array(jsonb_build_object(
                         'pool_code', 'MACHINE_OH', 'applies', true, 'rate', 55))),
    jsonb_build_object('work_center_id', '52040204-0000-0000-0000-0000000000d2',
                       'pools', jsonb_build_array(jsonb_build_object(
                         'pool_code', 'LABOR_OH', 'applies', false)))))::text, false);

CREATE FUNCTION pg_temp.cp_as(p_user uuid, p_org uuid) RETURNS void
LANGUAGE sql AS $fn$
  SELECT set_config('request.jwt.claim.sub', p_user::text, true);
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'org_id', p_org)::text, true);
$fn$;

-- Runs p_call and requires the outcome to contain p_expected ('OK' or an
-- error code). A refused call leaves no trace (subtransaction).
CREATE FUNCTION pg_temp.cp_expect(p_label text, p_call text, p_expected text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE v_got text;
BEGIN
  BEGIN
    EXECUTE p_call;
    v_got := 'OK';
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE || ':' || SQLERRM;
  END;
  IF position(p_expected IN v_got) = 0 THEN
    RAISE EXCEPTION 'CP204_EXPECT_FAILED [%]: expected % got %', p_label, p_expected, v_got;
  END IF;
  RETURN v_got;
END
$fn$;

CREATE FUNCTION pg_temp.cp_create(p_policy jsonb, p_expected integer, p_key uuid) RETURNS text
LANGUAGE sql AS $fn$
  SELECT format('SELECT public.rpc_create_mfg_cost_policy_version(%L, %L::jsonb, %s, %L)',
                '52040204-0000-0000-0000-0000000000a1', p_policy, COALESCE(p_expected::text, 'NULL'), p_key);
$fn$;

CREATE FUNCTION pg_temp.cp_preview(p_org uuid, p_version uuid, p_wc uuid,
  p_lh numeric, p_mh numeric, p_rec numeric) RETURNS jsonb
LANGUAGE sql AS $fn$
  SELECT public.rpc_preview_mfg_cost_absorption(p_org, p_version, p_wc, p_lh, p_mh, p_rec);
$fn$;

GRANT EXECUTE ON FUNCTION pg_temp.cp_as(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.cp_expect(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.cp_create(jsonb, integer, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.cp_preview(uuid, uuid, uuid, numeric, numeric, numeric) TO authenticated;

-- ---------------------------------------------------------------------
-- 2. Guards. Plain member: no read, no write. Reader: read only. Other
-- org's admin: not a member here.
-- ---------------------------------------------------------------------
SET LOCAL ROLE authenticated;

SELECT pg_temp.cp_as('52040204-0000-0000-0000-0000000000a6', '52040204-0000-0000-0000-0000000000a1');
SELECT pg_temp.cp_expect('member get', $$SELECT public.rpc_get_mfg_cost_policy('52040204-0000-0000-0000-0000000000a1')$$,
  '42501:MANUFACTURING_SETTINGS_READ_DENIED');
SELECT pg_temp.cp_expect('member create', pg_temp.cp_create(current_setting('cp.base')::jsonb, 0,
  '52040204-0000-0000-0000-00000000f001'), '42501:MANUFACTURING_SETTINGS_UPDATE_DENIED');

SELECT pg_temp.cp_as('52040204-0000-0000-0000-0000000000a4', '52040204-0000-0000-0000-0000000000a1');
DO $reader$
DECLARE v jsonb;
BEGIN
  v := public.rpc_get_mfg_cost_policy('52040204-0000-0000-0000-0000000000a1');
  IF (v->'capabilities'->>'can_manage')::boolean OR v->>'latest_version_no' <> '0'
     OR jsonb_array_length(v->'versions') <> 0 OR v->>'current_version_id' IS NOT NULL
     OR v->'supported'->'stage_costing_methods' <> '["weighted_average"]'::jsonb
     OR v->'supported'->'overhead_bases' <> '["labor_hours", "machine_hours"]'::jsonb THEN
    RAISE EXCEPTION 'CP204_READER_VIEW_UNEXPECTED: %', v;
  END IF;
END
$reader$;
SELECT pg_temp.cp_expect('reader create', pg_temp.cp_create(current_setting('cp.base')::jsonb, 0,
  '52040204-0000-0000-0000-00000000f002'), '42501:MANUFACTURING_SETTINGS_UPDATE_DENIED');

SELECT pg_temp.cp_as('52040204-0000-0000-0000-0000000000b2', '52040204-0000-0000-0000-0000000000b1');
SELECT pg_temp.cp_expect('other org get', $$SELECT public.rpc_get_mfg_cost_policy('52040204-0000-0000-0000-0000000000a1')$$,
  'NOT_ORG_MEMBER');
SELECT pg_temp.cp_expect('other org create', pg_temp.cp_create(current_setting('cp.base')::jsonb, 0,
  '52040204-0000-0000-0000-00000000f003'), 'NOT_ORG_MEMBER');

DO $guards$ BEGIN RAISE NOTICE 'CP204_GUARDS_OK'; END $guards$;

-- ---------------------------------------------------------------------
-- 3. Validation: each case refused with its code; nothing written.
-- ---------------------------------------------------------------------
SELECT pg_temp.cp_as('52040204-0000-0000-0000-0000000000a2', '52040204-0000-0000-0000-0000000000a1');
DO $validation$
DECLARE
  b jsonb := current_setting('cp.base')::jsonb;
  t date := current_setting('cp.today_a')::date;
  c record;
  n int := 0;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('not an object', '"x"'::jsonb, 'COST_POLICY_INVALID'),
    ('unknown key', b || '{"rate_mode":"x"}', 'COST_POLICY_UNKNOWN_KEY: rate_mode'),
    ('past date', b || jsonb_build_object('effective_from', (t - 1)::text), 'COST_POLICY_EFFECTIVE_DATE_IN_PAST'),
    ('bad date', b || '{"effective_from":"2026-13-40"}', 'COST_POLICY_INVALID: effective_from'),
    ('date type', b || '{"effective_from":20261101}', 'COST_POLICY_INVALID: effective_from'),
    ('labor source', b || '{"labor_cost_source":"standard_hours"}', 'COST_POLICY_LABOR_SOURCE_UNSUPPORTED'),
    ('labor rate missing', b - 'default_labor_rate_per_hour', 'COST_POLICY_LABOR_RATE_MISSING'),
    ('labor rate zero', b || '{"default_labor_rate_per_hour":0}', 'COST_POLICY_RATE_INVALID: default_labor_rate_per_hour'),
    ('labor rate scale', b || '{"default_labor_rate_per_hour":30.1234567}', 'COST_POLICY_RATE_INVALID: default_labor_rate_per_hour'),
    ('recorded with default rate', b || '{"labor_cost_source":"recorded_entry_rate"}',
      'COST_POLICY_LABOR_RATE_NOT_APPLICABLE: default_labor_rate_per_hour'),
    ('recorded with wc labor rate', (b - 'default_labor_rate_per_hour') || '{"labor_cost_source":"recorded_entry_rate"}',
      'COST_POLICY_LABOR_RATE_NOT_APPLICABLE: work_center_rules[1]'),
    ('stage method fifo', b || '{"stage_costing_method":"fifo"}', 'COST_POLICY_STAGE_METHOD_UNSUPPORTED'),
    ('pools empty', b || '{"overhead_pools":[]}', 'COST_POLICY_POOLS_REQUIRED'),
    ('pools missing', b - 'overhead_pools', 'COST_POLICY_POOLS_REQUIRED'),
    ('pool basis', jsonb_set(b, '{overhead_pools,0,basis}', '"units_produced"'),
      'COST_POLICY_POOL_BASIS_UNSUPPORTED: overhead_pools[1]'),
    ('pool duplicate', jsonb_set(b, '{overhead_pools,1,pool_code}', '"LABOR_OH"'), 'COST_POLICY_POOL_DUPLICATE: LABOR_OH'),
    ('pool rate negative', jsonb_set(b, '{overhead_pools,1,rate}', '-1'), 'COST_POLICY_RATE_INVALID: overhead_pools[2].rate'),
    ('pool code format', jsonb_set(b, '{overhead_pools,0,pool_code}', '"labor_oh"'),
      'COST_POLICY_INVALID: overhead_pools[1].pool_code'),
    ('pool unknown key', jsonb_set(b, '{overhead_pools,0,uom}', '"minute"'), 'COST_POLICY_UNKNOWN_KEY: overhead_pools[1].uom'),
    ('wc other org', jsonb_set(b, '{work_center_rules,0,work_center_id}', '"52040204-0000-0000-0000-0000000000e1"'),
      'COST_POLICY_WORK_CENTER_UNKNOWN: work_center_rules[1]'),
    ('wc inactive', jsonb_set(b, '{work_center_rules,0,work_center_id}', '"52040204-0000-0000-0000-0000000000d4"'),
      'COST_POLICY_WORK_CENTER_UNKNOWN: work_center_rules[1]'),
    ('wc duplicate', jsonb_set(b, '{work_center_rules,1,work_center_id}', '"52040204-0000-0000-0000-0000000000d1"'),
      'COST_POLICY_WORK_CENTER_DUPLICATE: work_center_rules[2]'),
    ('wc pool unknown', jsonb_set(b, '{work_center_rules,0,pools,0,pool_code}', '"PAINT_OH"'),
      'COST_POLICY_WC_POOL_UNKNOWN: work_center_rules[1].pools[1]'),
    ('wc pool duplicate', jsonb_set(b, '{work_center_rules,0,pools}',
      '[{"pool_code":"MACHINE_OH","applies":true,"rate":55},{"pool_code":"MACHINE_OH","applies":false}]'),
      'COST_POLICY_WC_POOL_DUPLICATE: work_center_rules[1].pools[2]'),
    ('wc pool applies without rate', jsonb_set(b, '{work_center_rules,0,pools,0}', '{"pool_code":"MACHINE_OH","applies":true}'),
      'COST_POLICY_WC_POOL_RATE_INVALID: work_center_rules[1].pools[1]'),
    ('wc pool excluded with rate', jsonb_set(b, '{work_center_rules,1,pools,0,rate}', '9'),
      'COST_POLICY_WC_POOL_RATE_INVALID: work_center_rules[2].pools[1]'),
    ('wc rule empty', jsonb_set(b, '{work_center_rules,1,pools}', '[]'), 'COST_POLICY_WC_RULE_EMPTY: work_center_rules[2]')
  ) AS v(label, payload, expected) LOOP
    PERFORM pg_temp.cp_expect(c.label, pg_temp.cp_create(c.payload, 0, gen_random_uuid()), c.expected);
    n := n + 1;
  END LOOP;
  PERFORM pg_temp.cp_expect('no key', pg_temp.cp_create(b, 0, NULL), 'COST_POLICY_IDEMPOTENCY_KEY_REQUIRED');
  PERFORM pg_temp.cp_expect('stale expected', pg_temp.cp_create(b, 1, gen_random_uuid()),
    'COST_POLICY_VERSION_CONFLICT: latest=0');
  PERFORM pg_temp.cp_expect('null expected', pg_temp.cp_create(b, NULL, gen_random_uuid()),
    'COST_POLICY_VERSION_CONFLICT: latest=0');
  IF (public.rpc_get_mfg_cost_policy('52040204-0000-0000-0000-0000000000a1')->>'latest_version_no') <> '0' THEN
    RAISE EXCEPTION 'CP204_PARTIAL_WRITE_AFTER_REFUSAL';
  END IF;
  RAISE NOTICE 'CP204_VALIDATION_OK cases=%', n + 3;
END
$validation$;

-- ---------------------------------------------------------------------
-- 4. Creation by a key holder who is not an admin; replay; conflicts; the
-- next version must start strictly later; a recorded-cost version.
-- ---------------------------------------------------------------------
SELECT pg_temp.cp_as('52040204-0000-0000-0000-0000000000a3', '52040204-0000-0000-0000-0000000000a1');
DO $create$
DECLARE
  b jsonb := current_setting('cp.base')::jsonb;
  t date := current_setting('cp.today_a')::date;
  r jsonb;
  v1 jsonb;
BEGIN
  r := public.rpc_create_mfg_cost_policy_version('52040204-0000-0000-0000-0000000000a1', b, 0,
    '52040204-0000-0000-0000-00000000f101');
  v1 := r->'versions'->0;
  IF (r->>'replayed')::boolean OR r->>'latest_version_no' <> '1'
     OR v1->>'version_no' <> '1' OR v1->>'status' <> 'current'
     OR r->>'current_version_id' <> v1->>'id' OR r->>'policy_version_id' <> v1->>'id'
     OR jsonb_array_length(v1->'overhead_pools') <> 2
     OR jsonb_array_length(v1->'work_center_rules') <> 2
     OR v1->>'stage_costing_method' <> 'weighted_average'
     OR (v1->>'default_labor_rate_per_hour')::numeric <> 30
     OR v1->>'pinned_order_count' <> '0' THEN
    RAISE EXCEPTION 'CP204_CREATE_UNEXPECTED: %', r;
  END IF;
  PERFORM set_config('cp.v1', v1->>'id', false);

  r := public.rpc_create_mfg_cost_policy_version('52040204-0000-0000-0000-0000000000a1', b, 0,
    '52040204-0000-0000-0000-00000000f101');
  IF NOT (r->>'replayed')::boolean OR r->>'policy_version_id' <> current_setting('cp.v1')
     OR r->>'latest_version_no' <> '1' THEN
    RAISE EXCEPTION 'CP204_REPLAY_UNEXPECTED: %', r;
  END IF;
  PERFORM pg_temp.cp_expect('same key other payload',
    pg_temp.cp_create(b || '{"note":"changed"}', 1, '52040204-0000-0000-0000-00000000f101'),
    'COST_POLICY_IDEMPOTENCY_CONFLICT');
  PERFORM pg_temp.cp_expect('stale after create', pg_temp.cp_create(b, 0, gen_random_uuid()),
    'COST_POLICY_VERSION_CONFLICT: latest=1');
  PERFORM pg_temp.cp_expect('same start date', pg_temp.cp_create(b, 1, gen_random_uuid()),
    'COST_POLICY_EFFECTIVE_DATE_NOT_AFTER_LATEST');

  -- Version 2 from today+30: labor at recorded cost, new pool rates, no rules.
  r := public.rpc_create_mfg_cost_policy_version('52040204-0000-0000-0000-0000000000a1',
    jsonb_build_object(
      'effective_from', (t + 30)::text,
      'labor_cost_source', 'recorded_entry_rate',
      'overhead_pools', jsonb_build_array(
        jsonb_build_object('pool_code', 'LABOR_OH', 'name', 'Labor-driven overhead', 'basis', 'labor_hours', 'rate', 13),
        jsonb_build_object('pool_code', 'MACHINE_OH', 'name', 'Machine overhead', 'basis', 'machine_hours', 'rate', 42))),
    1, '52040204-0000-0000-0000-00000000f102');
  IF r->'versions'->0->>'status' <> 'scheduled' OR r->'versions'->1->>'status' <> 'current'
     OR r->'versions'->0->>'default_labor_rate_per_hour' IS NOT NULL THEN
    RAISE EXCEPTION 'CP204_SCHEDULED_UNEXPECTED: %', r;
  END IF;
  PERFORM set_config('cp.v2', r->>'policy_version_id', false);
  PERFORM pg_temp.cp_expect('between current and scheduled',
    pg_temp.cp_create(b || jsonb_build_object('effective_from', (t + 10)::text), 2, gen_random_uuid()),
    'COST_POLICY_EFFECTIVE_DATE_NOT_AFTER_LATEST');
  RAISE NOTICE 'CP204_CREATE_OK';
END
$create$;

-- ---------------------------------------------------------------------
-- 5. Absorption (the reader may preview). Worked numbers:
--   v1 @ WC-A, 10 LH, 6 MH: labor 10 x 35 = 350; LABOR_OH 10 x 12 = 120;
--      MACHINE_OH 6 x 55 = 330; total 800.
--   v1 @ WC-B: labor 10 x 30 = 300; LABOR_OH excluded; MACHINE_OH 6 x 40 = 240; 540.
--   v1 @ WC-C (no rule): 300 + 120 + 240 = 660.
--   v2 @ WC-C, recorded labor 512.40: 512.40 + 10 x 13 + 6 x 42 = 894.40.
--   Rounding per line: WC-A, 0.3333 LH and MH: 11.67 + 4.00 + 18.33 = 34.00.
-- ---------------------------------------------------------------------
SELECT pg_temp.cp_as('52040204-0000-0000-0000-0000000000a4', '52040204-0000-0000-0000-0000000000a1');
DO $compute$
DECLARE
  a uuid := '52040204-0000-0000-0000-0000000000a1';
  v1 uuid := current_setting('cp.v1')::uuid;
  v2 uuid := current_setting('cp.v2')::uuid;
  r jsonb;
BEGIN
  r := pg_temp.cp_preview(a, v1, '52040204-0000-0000-0000-0000000000d1', 10, 6, NULL);
  IF (r->'labor'->>'amount')::numeric <> 350 OR r->'labor'->>'rate_source' <> 'work_center_rule'
     OR r->'overhead' <> jsonb_build_array(
          jsonb_build_object('pool_code','LABOR_OH','basis','labor_hours','driver_hours',10,
                             'rate_per_hour',12.000000,'rate_source','policy_default','amount',120.00),
          jsonb_build_object('pool_code','MACHINE_OH','basis','machine_hours','driver_hours',6,
                             'rate_per_hour',55.000000,'rate_source','work_center_rule','amount',330.00))
     OR (r->>'overhead_total')::numeric <> 450 OR (r->>'total')::numeric <> 800
     OR r->'excluded_pools' <> '[]'::jsonb THEN
    RAISE EXCEPTION 'CP204_COMPUTE_WC_A: %', r;
  END IF;

  r := pg_temp.cp_preview(a, v1, '52040204-0000-0000-0000-0000000000d2', 10, 6, NULL);
  IF (r->'labor'->>'amount')::numeric <> 300 OR r->'labor'->>'rate_source' <> 'policy_default'
     OR jsonb_array_length(r->'overhead') <> 1 OR r->'overhead'->0->>'pool_code' <> 'MACHINE_OH'
     OR (r->'overhead'->0->>'amount')::numeric <> 240 OR r->'excluded_pools' <> '["LABOR_OH"]'::jsonb
     OR (r->>'total')::numeric <> 540 THEN
    RAISE EXCEPTION 'CP204_COMPUTE_WC_B: %', r;
  END IF;

  r := pg_temp.cp_preview(a, v1, '52040204-0000-0000-0000-0000000000d3', 10, 6, NULL);
  IF (r->>'total')::numeric <> 660 THEN RAISE EXCEPTION 'CP204_COMPUTE_WC_C: %', r; END IF;

  r := pg_temp.cp_preview(a, v1, '52040204-0000-0000-0000-0000000000d1', 0, 0, NULL);
  IF (r->>'total')::numeric <> 0 OR jsonb_array_length(r->'overhead') <> 2 THEN
    RAISE EXCEPTION 'CP204_COMPUTE_ZERO: %', r;
  END IF;

  r := pg_temp.cp_preview(a, v1, '52040204-0000-0000-0000-0000000000d1', 0.3333, 0.3333, NULL);
  IF (r->'labor'->>'amount')::numeric <> 11.67 OR (r->'overhead'->0->>'amount')::numeric <> 4.00
     OR (r->'overhead'->1->>'amount')::numeric <> 18.33 OR (r->>'total')::numeric <> 34.00 THEN
    RAISE EXCEPTION 'CP204_COMPUTE_ROUNDING: %', r;
  END IF;

  r := pg_temp.cp_preview(a, v2, '52040204-0000-0000-0000-0000000000d3', 10, 6, 512.40);
  IF r->'labor'->>'source' <> 'recorded_entry_rate' OR r->'labor'->>'rate_per_hour' IS NOT NULL
     OR (r->'labor'->>'amount')::numeric <> 512.40 OR (r->>'overhead_total')::numeric <> 382
     OR (r->>'total')::numeric <> 894.40 THEN
    RAISE EXCEPTION 'CP204_COMPUTE_RECORDED: %', r;
  END IF;

  PERFORM pg_temp.cp_expect('machine hours missing',
    format('SELECT pg_temp.cp_preview(%L,%L,%L,10,NULL,NULL)', a, v1, '52040204-0000-0000-0000-0000000000d1'),
    'COST_POLICY_DRIVER_MISSING: machine_hours');
  -- WC-B excludes LABOR_OH, but labor itself still needs labor hours.
  PERFORM pg_temp.cp_expect('labor hours missing',
    format('SELECT pg_temp.cp_preview(%L,%L,%L,NULL,6,NULL)', a, v1, '52040204-0000-0000-0000-0000000000d2'),
    'COST_POLICY_DRIVER_MISSING: labor_hours');
  PERFORM pg_temp.cp_expect('recorded cost missing',
    format('SELECT pg_temp.cp_preview(%L,%L,%L,10,6,NULL)', a, v2, '52040204-0000-0000-0000-0000000000d3'),
    'COST_POLICY_DRIVER_MISSING: recorded_labor_cost');
  PERFORM pg_temp.cp_expect('recorded cost not applicable',
    format('SELECT pg_temp.cp_preview(%L,%L,%L,10,6,100)', a, v1, '52040204-0000-0000-0000-0000000000d1'),
    'COST_POLICY_INPUT_NOT_APPLICABLE: recorded_labor_cost');
  PERFORM pg_temp.cp_expect('negative driver',
    format('SELECT pg_temp.cp_preview(%L,%L,%L,-1,6,NULL)', a, v1, '52040204-0000-0000-0000-0000000000d1'),
    'COST_POLICY_DRIVER_INVALID');
  PERFORM pg_temp.cp_expect('other org work center',
    format('SELECT pg_temp.cp_preview(%L,%L,%L,10,6,NULL)', a, v1, '52040204-0000-0000-0000-0000000000e1'),
    'COST_POLICY_WORK_CENTER_UNKNOWN');
  RAISE NOTICE 'CP204_COMPUTE_OK';
END
$compute$;

SELECT pg_temp.cp_as('52040204-0000-0000-0000-0000000000a6', '52040204-0000-0000-0000-0000000000a1');
SELECT pg_temp.cp_expect('member preview',
  format('SELECT pg_temp.cp_preview(%L,%L,%L,10,6,NULL)', '52040204-0000-0000-0000-0000000000a1',
         current_setting('cp.v1'), '52040204-0000-0000-0000-0000000000d1'),
  '42501:MANUFACTURING_SETTINGS_READ_DENIED');
-- Org B's admin passes A's version under B: the version is not B's.
SELECT pg_temp.cp_as('52040204-0000-0000-0000-0000000000b2', '52040204-0000-0000-0000-0000000000b1');
SELECT pg_temp.cp_expect('cross-org version',
  format('SELECT pg_temp.cp_preview(%L,%L,%L,10,6,NULL)', '52040204-0000-0000-0000-0000000000b1',
         current_setting('cp.v1'), '52040204-0000-0000-0000-0000000000e1'),
  'COST_POLICY_VERSION_UNKNOWN');

-- ---------------------------------------------------------------------
-- 6. Pins. Orders are created by definer RPCs since 195; insert as owner.
-- ---------------------------------------------------------------------
RESET ROLE;
INSERT INTO public.manufacturing_orders (id, org_id, order_number, quantity) VALUES
  ('52040204-0000-0000-0000-0000000000f1', '52040204-0000-0000-0000-0000000000a1', 'CP204-MO-1', 100),
  ('52040204-0000-0000-0000-0000000000f2', '52040204-0000-0000-0000-0000000000b1', 'CP204-MO-2', 100);
DO $pins$
DECLARE p wardah_internal.mo_cost_policy_pins%ROWTYPE;
BEGIN
  SELECT * INTO p FROM wardah_internal.mo_cost_policy_pins WHERE mo_id = '52040204-0000-0000-0000-0000000000f1';
  IF NOT FOUND OR p.policy_version_id <> current_setting('cp.v1')::uuid
     OR p.pinned_on <> current_setting('cp.today_a')::date OR p.pin_source <> 'mo_created' THEN
    RAISE EXCEPTION 'CP204_PIN_UNEXPECTED';
  END IF;
  IF EXISTS (SELECT 1 FROM wardah_internal.mo_cost_policy_pins WHERE mo_id = '52040204-0000-0000-0000-0000000000f2') THEN
    RAISE EXCEPTION 'CP204_PIN_WITHOUT_POLICY';
  END IF;
  RAISE NOTICE 'CP204_PINS_OK';
END
$pins$;

-- ---------------------------------------------------------------------
-- 7. Withdrawal and immutability.
-- ---------------------------------------------------------------------
-- A version of org B that is already in force (fixture inserted directly).
INSERT INTO wardah_internal.mfg_cost_policy_versions
  (id, org_id, version_no, effective_from, labor_cost_source, default_labor_rate_per_hour,
   idempotency_key, payload_hash)
VALUES ('52040204-0000-0000-0000-0000000000c9', '52040204-0000-0000-0000-0000000000b1', 1,
        current_date - 5, 'work_center_rate', 20, gen_random_uuid(), 'fixture');

SET LOCAL ROLE authenticated;
SELECT pg_temp.cp_as('52040204-0000-0000-0000-0000000000b2', '52040204-0000-0000-0000-0000000000b1');
SELECT pg_temp.cp_expect('withdraw in force', $$SELECT public.rpc_withdraw_mfg_cost_policy_version(
  '52040204-0000-0000-0000-0000000000b1', '52040204-0000-0000-0000-0000000000c9', 'typo')$$,
  'COST_POLICY_VERSION_ALREADY_IN_FORCE');
SELECT pg_temp.cp_expect('withdraw other org version', format(
  'SELECT public.rpc_withdraw_mfg_cost_policy_version(%L, %L, %L)', '52040204-0000-0000-0000-0000000000b1',
  current_setting('cp.v2'), 'not mine'), 'COST_POLICY_VERSION_UNKNOWN');

SELECT pg_temp.cp_as('52040204-0000-0000-0000-0000000000a4', '52040204-0000-0000-0000-0000000000a1');
SELECT pg_temp.cp_expect('reader withdraw', format(
  'SELECT public.rpc_withdraw_mfg_cost_policy_version(%L, %L, %L)', '52040204-0000-0000-0000-0000000000a1',
  current_setting('cp.v2'), 'x'), '42501:MANUFACTURING_SETTINGS_UPDATE_DENIED');

SELECT pg_temp.cp_as('52040204-0000-0000-0000-0000000000a2', '52040204-0000-0000-0000-0000000000a1');
DO $withdraw$
DECLARE
  a uuid := '52040204-0000-0000-0000-0000000000a1';
  t date := current_setting('cp.today_a')::date;
  r jsonb;
BEGIN
  PERFORM pg_temp.cp_expect('withdraw pinned', format(
    'SELECT public.rpc_withdraw_mfg_cost_policy_version(%L, %L, %L)', a, current_setting('cp.v1'), 'wrong rate'),
    'COST_POLICY_VERSION_PINNED');
  PERFORM pg_temp.cp_expect('withdraw no reason', format(
    'SELECT public.rpc_withdraw_mfg_cost_policy_version(%L, %L, %L)', a, current_setting('cp.v2'), '  '),
    'COST_POLICY_WITHDRAW_REASON_REQUIRED');
  r := public.rpc_withdraw_mfg_cost_policy_version(a, current_setting('cp.v2')::uuid, 'Rates not approved');
  IF r->'versions'->0->>'status' <> 'withdrawn' OR r->'versions'->0->>'withdraw_reason' <> 'Rates not approved' THEN
    RAISE EXCEPTION 'CP204_WITHDRAW_UNEXPECTED: %', r;
  END IF;
  PERFORM pg_temp.cp_expect('withdraw twice', format(
    'SELECT public.rpc_withdraw_mfg_cost_policy_version(%L, %L, %L)', a, current_setting('cp.v2'), 'again'),
    'COST_POLICY_VERSION_ALREADY_WITHDRAWN');
  PERFORM pg_temp.cp_expect('preview withdrawn',
    format('SELECT pg_temp.cp_preview(%L,%L,%L,10,6,1)', a, current_setting('cp.v2'), '52040204-0000-0000-0000-0000000000d3'),
    'COST_POLICY_VERSION_UNKNOWN');
  -- The withdrawn start date is free again; numbering continues.
  r := public.rpc_create_mfg_cost_policy_version(a,
    current_setting('cp.base')::jsonb || jsonb_build_object('effective_from', (t + 30)::text,
                                                             'default_labor_rate_per_hour', 32),
    2, '52040204-0000-0000-0000-00000000f103');
  IF r->'versions'->0->>'version_no' <> '3' OR r->'versions'->0->>'status' <> 'scheduled'
     OR r->'versions'->1->>'status' <> 'withdrawn' OR r->'versions'->2->>'status' <> 'current'
     OR (r->'versions'->2->>'pinned_order_count') <> '1' THEN
    RAISE EXCEPTION 'CP204_AFTER_WITHDRAW_UNEXPECTED: %', r;
  END IF;
  RAISE NOTICE 'CP204_WITHDRAW_OK';
END
$withdraw$;

RESET ROLE;
DO $immutable$
DECLARE
  v1 uuid := current_setting('cp.v1')::uuid;
BEGIN
  PERFORM pg_temp.cp_expect('update pool', format(
    'UPDATE wardah_internal.mfg_cost_policy_pools SET rate = 1 WHERE policy_version_id = %L', v1),
    'COST_POLICY_IMMUTABLE');
  PERFORM pg_temp.cp_expect('update version', format(
    'UPDATE wardah_internal.mfg_cost_policy_versions SET note = %L WHERE id = %L', 'edited', v1),
    'COST_POLICY_IMMUTABLE');
  PERFORM pg_temp.cp_expect('un-withdraw', format(
    'UPDATE wardah_internal.mfg_cost_policy_versions SET withdrawn_at = NULL, withdrawn_by = NULL, withdraw_reason = NULL WHERE id = %L',
    current_setting('cp.v2')), 'COST_POLICY_IMMUTABLE');
  PERFORM pg_temp.cp_expect('delete version', format(
    'DELETE FROM wardah_internal.mfg_cost_policy_versions WHERE id = %L', v1), 'COST_POLICY_IMMUTABLE');
  PERFORM pg_temp.cp_expect('delete wc pool rule', format(
    'DELETE FROM wardah_internal.mfg_cost_policy_wc_pool_rules WHERE policy_version_id = %L', v1), 'COST_POLICY_IMMUTABLE');
  PERFORM pg_temp.cp_expect('update pin',
    'UPDATE wardah_internal.mo_cost_policy_pins SET pinned_on = pinned_on - 1', 'COST_POLICY_IMMUTABLE');
  PERFORM pg_temp.cp_expect('delete pin',
    'DELETE FROM wardah_internal.mo_cost_policy_pins', 'COST_POLICY_IMMUTABLE');
  RAISE NOTICE 'CP204_IMMUTABLE_OK';
END
$immutable$;

-- Audit trail: two creations kept, one withdrawal, one more creation.
DO $audit$
BEGIN
  IF (SELECT count(*) FROM public.audit_logs WHERE org_id = '52040204-0000-0000-0000-0000000000a1'
      AND action = 'manufacturing.cost_policy.create') <> 3
     OR (SELECT count(*) FROM public.audit_logs WHERE org_id = '52040204-0000-0000-0000-0000000000a1'
         AND action = 'manufacturing.cost_policy.withdraw') <> 1 THEN
    RAISE EXCEPTION 'CP204_AUDIT_UNEXPECTED';
  END IF;
  RAISE NOTICE 'CP204_AUDIT_OK';
END
$audit$;

-- ---------------------------------------------------------------------
-- 8. Timezone: a strict writer refuses an unknown zone; reads and MO pinning
-- fall back to UTC instead of blocking.
-- ---------------------------------------------------------------------
UPDATE public.organizations SET timezone = 'Mars/Phobos' WHERE id = '52040204-0000-0000-0000-0000000000b1';
SET LOCAL ROLE authenticated;
SELECT pg_temp.cp_as('52040204-0000-0000-0000-0000000000b2', '52040204-0000-0000-0000-0000000000b1');
SELECT pg_temp.cp_expect('bad timezone create', format(
  'SELECT public.rpc_create_mfg_cost_policy_version(%L, %L::jsonb, 1, %L)', '52040204-0000-0000-0000-0000000000b1',
  (current_setting('cp.base')::jsonb - 'work_center_rules') || jsonb_build_object('effective_from', (current_date + 400)::text),
  gen_random_uuid()), 'COST_POLICY_ORG_TIMEZONE_INVALID');
SELECT pg_temp.cp_expect('bad timezone get',
  $$SELECT public.rpc_get_mfg_cost_policy('52040204-0000-0000-0000-0000000000b1')$$, 'OK');
RESET ROLE;
INSERT INTO public.manufacturing_orders (id, org_id, order_number, quantity) VALUES
  ('52040204-0000-0000-0000-0000000000f3', '52040204-0000-0000-0000-0000000000b1', 'CP204-MO-3', 1);
DO $tz$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM wardah_internal.mo_cost_policy_pins
                 WHERE mo_id = '52040204-0000-0000-0000-0000000000f3'
                   AND policy_version_id = '52040204-0000-0000-0000-0000000000c9') THEN
    RAISE EXCEPTION 'CP204_TZ_FALLBACK_PIN_MISSING';
  END IF;
  RAISE NOTICE 'CP204_TIMEZONE_OK';
END
$tz$;

-- ---------------------------------------------------------------------
-- 9. Deleting an organization removes its policy rows (immutability does not
-- block the cascade).
-- ---------------------------------------------------------------------
INSERT INTO public.organizations (id, name, code) VALUES
  ('52040204-0000-0000-0000-0000000000a9', 'Cost Policy 204 Z', 'CP204-Z');
INSERT INTO public.work_centers (id, org_id, code, name, is_active) VALUES
  ('52040204-0000-0000-0000-0000000000d9', '52040204-0000-0000-0000-0000000000a9', 'WC-Z', 'Z', true);
INSERT INTO wardah_internal.mfg_cost_policy_versions
  (id, org_id, version_no, effective_from, labor_cost_source, default_labor_rate_per_hour, idempotency_key, payload_hash)
VALUES ('52040204-0000-0000-0000-0000000000c8', '52040204-0000-0000-0000-0000000000a9', 1, current_date,
        'work_center_rate', 10, gen_random_uuid(), 'fixture');
INSERT INTO wardah_internal.mfg_cost_policy_pools (policy_version_id, org_id, pool_code, name, basis, rate)
VALUES ('52040204-0000-0000-0000-0000000000c8', '52040204-0000-0000-0000-0000000000a9', 'MACHINE_OH', 'M', 'machine_hours', 5);
INSERT INTO wardah_internal.mfg_cost_policy_wc_rules (policy_version_id, org_id, work_center_id, labor_rate_per_hour)
VALUES ('52040204-0000-0000-0000-0000000000c8', '52040204-0000-0000-0000-0000000000a9', '52040204-0000-0000-0000-0000000000d9', 11);
INSERT INTO wardah_internal.mfg_cost_policy_wc_pool_rules (policy_version_id, org_id, work_center_id, pool_code, applies)
VALUES ('52040204-0000-0000-0000-0000000000c8', '52040204-0000-0000-0000-0000000000a9', '52040204-0000-0000-0000-0000000000d9', 'MACHINE_OH', false);
DELETE FROM public.organizations WHERE id = '52040204-0000-0000-0000-0000000000a9';
DO $cascade$
BEGIN
  IF EXISTS (SELECT 1 FROM wardah_internal.mfg_cost_policy_versions WHERE org_id = '52040204-0000-0000-0000-0000000000a9')
     OR EXISTS (SELECT 1 FROM wardah_internal.mfg_cost_policy_pools WHERE org_id = '52040204-0000-0000-0000-0000000000a9')
     OR EXISTS (SELECT 1 FROM wardah_internal.mfg_cost_policy_wc_pool_rules WHERE org_id = '52040204-0000-0000-0000-0000000000a9') THEN
    RAISE EXCEPTION 'CP204_CASCADE_LEFT_ROWS';
  END IF;
  RAISE NOTICE 'CP204_CASCADE_OK';
END
$cascade$;

DO $done$ BEGIN RAISE NOTICE 'MFG_COST_POLICY_204_ACCEPTANCE_PASS'; END $done$;
ROLLBACK;
