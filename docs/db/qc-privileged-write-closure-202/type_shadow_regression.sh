#!/usr/bin/env bash
# M202 type-shadow regression: proves that an ordinary, non-admin authenticated
# login's own pg_temp domain (shadowing a builtin type name, e.g. "text") does
# NOT execute as a more-privileged current_user during the ordinary hold action
# or the QC write-path RPC, on a correctly-fixed chain (GREEN) — and DOES on a
# chain where the fix is reverted on one function (RED, non-vacuity: proves the
# probe itself is capable of catching the defect it claims to close). Each
# phase runs in its OWN, brand-new backend connection, so no statement in it
# can rely on a plan cached by an earlier call in this script.
#
# Usage: PGHOST=... PGPORT=... PGUSER=... bash type_shadow_regression.sh <base_db>
# <base_db> needs only the shared manufacturing fixture
# (docs/db/manufacturing-inventory-red-20260925/00_fixture.sql: org
# ed000000-0000-4000-8000-000000000001, admin a1, product c2) — this script
# seeds its own inspector and QC role on top. Callers pass a throwaway copy.
set -Eeuo pipefail
DB="$1"
psqlc() { psql -X -v ON_ERROR_STOP=1 -d "$DB" "$@"; }

MO_HOLD="ed000000-0000-4000-8000-00000000d001"
MO_WRITE="ed000000-0000-4000-8000-00000000d002"

psqlc -q <<SQL
INSERT INTO auth.users(id,email) VALUES ('ed000000-0000-4000-8000-0000000000a4','tsr-inspector@example.test')
  ON CONFLICT DO NOTHING;
INSERT INTO public.user_organizations(user_id,org_id,role,is_active,is_org_admin)
  VALUES ('ed000000-0000-4000-8000-0000000000a4','ed000000-0000-4000-8000-000000000001','user',true,false)
  ON CONFLICT DO NOTHING;
INSERT INTO public.roles(id,org_id,name,name_ar,is_active)
  VALUES ('ed000000-0000-4000-8000-00000000d0b4','ed000000-0000-4000-8000-000000000001','TSR QC','x',true)
  ON CONFLICT DO NOTHING;
INSERT INTO public.role_permissions(role_id,permission_id)
  SELECT 'ed000000-0000-4000-8000-00000000d0b4', id FROM public.permissions
  WHERE permission_key IN ('manufacturing.quality_inspections.read','manufacturing.quality_inspections.create')
  ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles(user_id,role_id,org_id,expires_at)
  VALUES ('ed000000-0000-4000-8000-0000000000a4','ed000000-0000-4000-8000-00000000d0b4','ed000000-0000-4000-8000-000000000001',NULL)
  ON CONFLICT DO NOTHING;
INSERT INTO public.manufacturing_orders(id,org_id,order_number,product_id,quantity,status,created_by)
  VALUES ('$MO_HOLD','ed000000-0000-4000-8000-000000000001','TSR-HOLD','ed000000-0000-4000-8000-0000000000c2',10,'in_progress','ed000000-0000-4000-8000-0000000000a1'),
         ('$MO_WRITE','ed000000-0000-4000-8000-000000000001','TSR-WRITE','ed000000-0000-4000-8000-0000000000c2',10,'quality_check','ed000000-0000-4000-8000-0000000000a1');
-- The AFTER INSERT trigger already opened QC cycle 1 for $MO_WRITE (born in
-- quality_check); no manual mo_quality_cycles row needed.
DROP ROLE IF EXISTS zz_tsr_login;
CREATE ROLE zz_tsr_login NOLOGIN;
GRANT authenticated TO zz_tsr_login;
SQL
trap 'psql -X -v ON_ERROR_STOP=0 -d "$DB" -qc "DROP ROLE IF EXISTS zz_tsr_login" >/dev/null 2>&1 || true' EXIT

# Each probe: a fresh connection, sentinel domains for every base type the real
# functions cast to, then the real call. Prints one NOTICE line per shadow hit,
# tagged with current_user. The caller classifies lines by current_user itself
# (the harness cannot know in advance which role a given deployment's entry
# role or table owner will be named).
probe_hold() {
  psqlc -At 2>&1 <<'SQL'
BEGIN;
SET LOCAL SESSION AUTHORIZATION zz_tsr_login;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','ed000000-0000-4000-8000-0000000000a4',true);
SELECT set_config('request.jwt.claims','{"sub":"ed000000-0000-4000-8000-0000000000a4","role":"authenticated"}',true);
DO $setup$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['uuid','numeric','text','int4','int8','bool','timestamptz','jsonb','regclass','regprocedure','regnamespace','oid'] LOOP
    EXECUTE format($f$CREATE FUNCTION pg_temp.sentinel_%1$s() RETURNS boolean LANGUAGE plpgsql AS
      $b$ BEGIN RAISE NOTICE 'TSR_SHADOW %1$s %%', current_user; RETURN true; END $b$$f$, t);
    EXECUTE format('CREATE DOMAIN pg_temp.%1$I AS pg_catalog.%1$I CHECK (pg_temp.sentinel_%1$s())', t);
  END LOOP;
END $setup$;
PREPARE call_hold(uuid, text, bigint, text) AS SELECT public.rpc_set_mo_quality_hold($1,$2,$3,$4);
EXECUTE call_hold('ed000000-0000-4000-8000-00000000d001', 'hold', 1, NULL);
RESET SESSION AUTHORIZATION;
ROLLBACK;
SQL
}

probe_write() {
  psqlc -At 2>&1 <<'SQL'
BEGIN;
SET LOCAL SESSION AUTHORIZATION zz_tsr_login;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','ed000000-0000-4000-8000-0000000000a4',true);
SELECT set_config('request.jwt.claims','{"sub":"ed000000-0000-4000-8000-0000000000a4","role":"authenticated"}',true);
DO $setup$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['uuid','numeric','text','int4','int8','bool','timestamptz','jsonb','regclass','regprocedure','regnamespace','oid'] LOOP
    EXECUTE format($f$CREATE FUNCTION pg_temp.sentinel_%1$s() RETURNS boolean LANGUAGE plpgsql AS
      $b$ BEGIN RAISE NOTICE 'TSR_SHADOW %1$s %%', current_user; RETURN true; END $b$$f$, t);
    EXECUTE format('CREATE DOMAIN pg_temp.%1$I AS pg_catalog.%1$I CHECK (pg_temp.sentinel_%1$s())', t);
  END LOOP;
END $setup$;
PREPARE call_rpc(uuid, uuid, jsonb) AS SELECT public.rpc_record_quality_inspection($1,$2,$3) -> 'result';
EXECUTE call_rpc('ed000000-0000-4000-8000-00000000d002', gen_random_uuid(),
  '{"inspection_type":"FINAL","result":"PASS","passed_quantity":10,"failed_quantity":0}');
RESET SESSION AUTHORIZATION;
ROLLBACK;
SQL
}

# A hit is "privileged" if current_user is neither the test's own session role
# (zz_tsr_login) nor plain "authenticated" (the caller-side artifact: the
# PREPARE statement's own parameter-type list, and this script's literal casts,
# are resolved under the ordinary CALLER's search_path, which is a property of
# whoever issues SQL text with unqualified literal casts — not of the migrated
# function bodies this regression is about).
count_privileged_hits() {
  # awk, not grep -c/-v piped to wc -l: grep exits 1 (and, under pipefail,
  # aborts the whole script via set -e) whenever it selects zero lines, which
  # is exactly the GREEN case this function must be able to report as "0".
  awk '/TSR_SHADOW/ && $NF != "zz_tsr_login" && $NF != "authenticated" { c++ } END { print c+0 }' <<<"$1"
}

echo "--- GREEN: fix applied ---"
OUT_HOLD_GREEN="$(probe_hold)"
OUT_WRITE_GREEN="$(probe_write)"
HITS_HOLD_GREEN="$(count_privileged_hits "$OUT_HOLD_GREEN")"
HITS_WRITE_GREEN="$(count_privileged_hits "$OUT_WRITE_GREEN")"
echo "privileged hits: hold=$HITS_HOLD_GREEN write=$HITS_WRITE_GREEN"
if [[ "$HITS_HOLD_GREEN" != 0 || "$HITS_WRITE_GREEN" != 0 ]]; then
  echo "TSR_FAIL: GREEN build still shows a privileged shadow hit" >&2
  echo "$OUT_HOLD_GREEN" >&2; echo "$OUT_WRITE_GREEN" >&2
  exit 1
fi
echo "TSR_GREEN_OK"

echo "--- RED: revert mo_quality_gate_199's search_path to pre-fix (non-vacuity) ---"
psqlc -qc "ALTER FUNCTION wardah_internal.mo_quality_gate_199() SET search_path = ''"
OUT_HOLD_RED="$(probe_hold)"
HITS_HOLD_RED="$(count_privileged_hits "$OUT_HOLD_RED")"
echo "privileged hits with the revert: hold=$HITS_HOLD_RED"
if [[ "$HITS_HOLD_RED" == 0 ]]; then
  echo "TSR_FAIL: reverting the fix did not reproduce a privileged shadow hit (probe is vacuous)" >&2
  exit 1
fi
echo "TSR_RED_OK (reverted fix reproduces current_user=postgres: $(grep 'TSR_SHADOW' <<<"$OUT_HOLD_RED" | awk '{print $NF}' | sort -u | tr '\n' ' '))"
# Restore, so the caller's database is left in its real, fixed state.
psqlc -qc "ALTER FUNCTION wardah_internal.mo_quality_gate_199() SET search_path = pg_catalog, pg_temp"
OUT_HOLD_RESTORED="$(probe_hold)"
if [[ "$(count_privileged_hits "$OUT_HOLD_RESTORED")" != 0 ]]; then
  echo "TSR_FAIL: restoring the fix did not return to zero privileged hits" >&2
  exit 1
fi
echo "TSR_RESTORED_OK"
echo "M202_TYPE_SHADOW_REGRESSION_PASS"
