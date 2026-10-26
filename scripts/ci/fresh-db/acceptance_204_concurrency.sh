#!/bin/bash
# Two-session checks for Migration 204 on a committed database through 204:
#   1. two editors create with the same expected version: one wins, the other
#      waits on the per-org lock and gets COST_POLICY_VERSION_CONFLICT;
#   2. the same idempotency key sent twice concurrently: one version, the
#      second call returns it as a replay;
#   3. withdraw first, MO insert second: the insert waits and pins nothing;
#   4. MO insert first, withdraw second: the withdraw waits and is refused
#      with COST_POLICY_VERSION_PINNED;
#   5. a version published while an order (timing production_started) starts:
#      publish first -> the start waits and pins the new version (read after
#      the lock); start first -> the publish waits, the order keeps the older
#      version;
#   6. two sessions start the same order: one pin.
#
# Usage: DB=<database through 204> bash acceptance_204_concurrency.sh
# The fixtures are committed in DB; use a throwaway copy.
set -Eeuo pipefail

DB="${DB:?DB must name a throwaway database through 204}"
PSQL=(psql -X -v ON_ERROR_STOP=1 -q -t -A -d "$DB")
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

A=52040204-0000-0000-0000-0000000001a1
ADMIN=52040204-0000-0000-0000-0000000001a2
W=52040204-0000-0000-0000-0000000001a3
ADMIN_W=52040204-0000-0000-0000-0000000001a4

"${PSQL[@]}" <<SQL
INSERT INTO public.organizations (id, name, code) VALUES ('$A', 'CP204 conc A', 'CP204-CA'), ('$W', 'CP204 conc W', 'CP204-CW');
INSERT INTO auth.users (id, email) VALUES ('$ADMIN', 'cp204-conc-a@example.test'), ('$ADMIN_W', 'cp204-conc-w@example.test');
INSERT INTO public.user_organizations (user_id, org_id, role, is_active, is_org_admin)
VALUES ('$ADMIN', '$A', 'admin', true, false), ('$ADMIN_W', '$W', 'admin', true, false);
SQL

as_admin() {
  printf "SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '%s', false); SELECT set_config('request.jwt.claims', json_build_object('sub','%s','role','authenticated')::text, false);\n" "$1" "$1"
}
# "Today" in the org timezone, resolved once as owner (the helper is internal).
today() {
  "${PSQL[@]}" -c "SELECT wardah_internal.mfg_cost_policy_org_today_204('$1', true)"
}
policy() {
  printf "jsonb_build_object('effective_from', ('%s'::date + %s)::text, 'labor_cost_source','work_center_rate', 'default_labor_rate_per_hour', 30, 'pin_event', '%s', 'overhead_pools', jsonb_build_array(jsonb_build_object('pool_code','MACHINE_OH','name','M','basis','machine_hours','rate',40)))" "$(today "$1")" "$2" "${3:-mo_created}"
}

# 1. Same expected version from two sessions.
{ as_admin "$ADMIN"; echo "BEGIN; SELECT public.rpc_create_mfg_cost_policy_version('$A', $(policy "$A" 1), 0, gen_random_uuid())->>'policy_version_id'; SELECT pg_sleep(3); COMMIT;"; } \
  | "${PSQL[@]}" >"$work/c1a.out" 2>&1 &
sleep 1
{ as_admin "$ADMIN"; echo "SELECT public.rpc_create_mfg_cost_policy_version('$A', $(policy "$A" 2), 0, gen_random_uuid());"; } \
  | "${PSQL[@]}" >"$work/c1b.out" 2>&1 || true
wait
grep -q 'COST_POLICY_VERSION_CONFLICT: latest=1' "$work/c1b.out" || { echo "CASE1_FAILED"; cat "$work/c1a.out" "$work/c1b.out"; exit 1; }
[ "$("${PSQL[@]}" -c "SELECT count(*) FROM wardah_internal.mfg_cost_policy_versions WHERE org_id = '$A'")" = 1 ] || { echo CASE1_COUNT; exit 1; }
echo "CP204_CONC_EXPECTED_VERSION_OK"

# 2. Same idempotency key twice, concurrently.
KEY=52040204-0000-0000-0000-0000000001f2
{ as_admin "$ADMIN"; echo "BEGIN; SELECT public.rpc_create_mfg_cost_policy_version('$A', $(policy "$A" 5), 1, '$KEY')->>'replayed'; SELECT pg_sleep(3); COMMIT;"; } \
  | "${PSQL[@]}" >"$work/c2a.out" 2>&1 &
sleep 1
{ as_admin "$ADMIN"; echo "SELECT public.rpc_create_mfg_cost_policy_version('$A', $(policy "$A" 5), 1, '$KEY')->>'replayed';"; } \
  | "${PSQL[@]}" >"$work/c2b.out" 2>&1
wait
{ grep -qx 'false' "$work/c2a.out" && grep -qx 'true' "$work/c2b.out"; } || { echo "CASE2_FAILED"; cat "$work/c2a.out" "$work/c2b.out"; exit 1; }
[ "$("${PSQL[@]}" -c "SELECT count(*) FROM wardah_internal.mfg_cost_policy_versions WHERE org_id = '$A'")" = 2 ] || { echo CASE2_COUNT; exit 1; }
echo "CP204_CONC_IDEMPOTENT_REPLAY_OK"

# 3 and 4 use org W with one version in force today and no pins.
VW=$( { as_admin "$ADMIN_W"; echo "SELECT public.rpc_create_mfg_cost_policy_version('$W', $(policy "$W" 0), 0, gen_random_uuid())->>'policy_version_id';"; } | "${PSQL[@]}" | tail -1)

# 4 first (the version must stay withdrawable for case 3): MO insert holds the
# shared lock, withdraw waits, then sees the pin.
{ echo "BEGIN; INSERT INTO public.manufacturing_orders (org_id, order_number, quantity) VALUES ('$W', 'CP204-CONC-1', 1); SELECT pg_sleep(3); COMMIT;"; } \
  | "${PSQL[@]}" >"$work/c4a.out" 2>&1 &
sleep 1
{ as_admin "$ADMIN_W"; echo "SELECT public.rpc_withdraw_mfg_cost_policy_version('$W', '$VW', 'race');"; } \
  | "${PSQL[@]}" >"$work/c4b.out" 2>&1 || true
wait
grep -q 'COST_POLICY_VERSION_PINNED' "$work/c4b.out" || { echo "CASE4_FAILED"; cat "$work/c4a.out" "$work/c4b.out"; exit 1; }
echo "CP204_CONC_PIN_BEFORE_WITHDRAW_OK"

# 3. Withdraw first, MO insert second, on a fresh org whose only version is in
# force today and unpinned: the insert waits for the withdrawal and pins nothing.
W2=52040204-0000-0000-0000-0000000001b1
"${PSQL[@]}" -c "INSERT INTO public.organizations (id, name, code) VALUES ('$W2', 'CP204 conc W2', 'CP204-CW2'); INSERT INTO public.user_organizations (user_id, org_id, role, is_active, is_org_admin) VALUES ('$ADMIN_W', '$W2', 'admin', true, false);" >/dev/null
VW2=$( { as_admin "$ADMIN_W"; echo "SELECT public.rpc_create_mfg_cost_policy_version('$W2', $(policy "$W2" 0), 0, gen_random_uuid())->>'policy_version_id';"; } | "${PSQL[@]}" | tail -1)
{ as_admin "$ADMIN_W"; echo "BEGIN; SELECT public.rpc_withdraw_mfg_cost_policy_version('$W2', '$VW2', 'race')->>'org_id'; SELECT pg_sleep(3); COMMIT;"; } \
  | "${PSQL[@]}" >"$work/c3a.out" 2>&1 &
sleep 1
"${PSQL[@]}" -c "INSERT INTO public.manufacturing_orders (id, org_id, order_number, quantity) VALUES ('52040204-0000-0000-0000-0000000001f3', '$W2', 'CP204-CONC-2', 1)" >"$work/c3b.out" 2>&1
wait
[ "$("${PSQL[@]}" -c "SELECT count(*) FROM wardah_internal.mo_cost_policy_pins WHERE mo_id = '52040204-0000-0000-0000-0000000001f3'")" = 0 ] \
  && [ "$("${PSQL[@]}" -c "SELECT withdrawn_at IS NOT NULL FROM wardah_internal.mfg_cost_policy_versions WHERE id = '$VW2'")" = t ] \
  || { echo "CASE3_FAILED"; cat "$work/c3a.out" "$work/c3b.out"; exit 1; }
echo "CP204_CONC_WITHDRAW_BEFORE_PIN_OK"

# 5 and 6: orgs P and Q, each with an owner-inserted version 1 (production_started)
# from ten days ago, so a version 2 may start today.
P=52040204-0000-0000-0000-0000000001c1
Q=52040204-0000-0000-0000-0000000001d1
MO_P=52040204-0000-0000-0000-0000000001cf
MO_Q=52040204-0000-0000-0000-0000000001df
MO_Q2=52040204-0000-0000-0000-0000000001de
"${PSQL[@]}" >/dev/null <<SQL
INSERT INTO public.organizations (id, name, code) VALUES ('$P', 'CP204 conc P', 'CP204-CP'), ('$Q', 'CP204 conc Q', 'CP204-CQ');
INSERT INTO public.user_organizations (user_id, org_id, role, is_active, is_org_admin)
VALUES ('$ADMIN_W', '$P', 'admin', true, false), ('$ADMIN_W', '$Q', 'admin', true, false);
INSERT INTO wardah_internal.mfg_cost_policy_versions
  (org_id, version_no, effective_from, labor_cost_source, default_labor_rate_per_hour, pin_event, idempotency_key, payload_hash)
VALUES ('$P', 1, wardah_internal.mfg_cost_policy_org_today_204('$P', true) - 10, 'work_center_rate', 30, 'production_started', gen_random_uuid(), 'fixture'),
       ('$Q', 1, wardah_internal.mfg_cost_policy_org_today_204('$Q', true) - 10, 'work_center_rate', 30, 'production_started', gen_random_uuid(), 'fixture');
INSERT INTO public.manufacturing_orders (id, org_id, order_number, quantity, status)
VALUES ('$MO_P', '$P', 'CP204-CONC-P', 1, 'confirmed'), ('$MO_Q', '$Q', 'CP204-CONC-Q', 1, 'confirmed');
SQL
pin_of() {
  "${PSQL[@]}" -c "SELECT COALESCE((SELECT policy_version_id::text || '/' || pin_source FROM wardah_internal.mo_cost_policy_pins WHERE mo_id = '$1'), 'none')"
}

# 5a. Publish first (holds the exclusive per-org lock), start second: the start
# waits, then reads the versions and pins the one just published.
{ as_admin "$ADMIN_W"; echo "BEGIN; SELECT public.rpc_create_mfg_cost_policy_version('$P', $(policy "$P" 0 production_started), 1, gen_random_uuid())->>'policy_version_id'; SELECT pg_sleep(3); COMMIT;"; } \
  | "${PSQL[@]}" >"$work/c5a.out" 2>&1 &
sleep 1
"${PSQL[@]}" -c "UPDATE public.manufacturing_orders SET status = 'in_progress' WHERE id = '$MO_P'" >"$work/c5b.out" 2>&1
wait
VP2=$(grep -E '^[0-9a-f-]{36}$' "$work/c5a.out" | tail -1)
[ -n "$VP2" ] && [ "$(pin_of "$MO_P")" = "$VP2/production_started" ] \
  || { echo "CASE5A_FAILED"; cat "$work/c5a.out" "$work/c5b.out"; pin_of "$MO_P"; exit 1; }
echo "CP204_CONC_PUBLISH_BEFORE_START_OK"

# 5b. Start first (holds the shared lock), publish second: the publish waits;
# the order keeps version 1, and version 2 is published afterwards.
VQ1=$("${PSQL[@]}" -c "SELECT id FROM wardah_internal.mfg_cost_policy_versions WHERE org_id = '$Q' AND version_no = 1")
{ echo "BEGIN; UPDATE public.manufacturing_orders SET status = 'in_progress' WHERE id = '$MO_Q'; SELECT pg_sleep(3); COMMIT;"; } \
  | "${PSQL[@]}" >"$work/c5c.out" 2>&1 &
sleep 1
{ as_admin "$ADMIN_W"; echo "SELECT public.rpc_create_mfg_cost_policy_version('$Q', $(policy "$Q" 0 production_started), 1, gen_random_uuid())->>'policy_version_id';"; } \
  | "${PSQL[@]}" >"$work/c5d.out" 2>&1
wait
VQ2=$(grep -E '^[0-9a-f-]{36}$' "$work/c5d.out" | tail -1)
[ -n "$VQ2" ] && [ "$(pin_of "$MO_Q")" = "$VQ1/production_started" ] \
  || { echo "CASE5B_FAILED"; cat "$work/c5c.out" "$work/c5d.out"; pin_of "$MO_Q"; exit 1; }
echo "CP204_CONC_START_BEFORE_PUBLISH_OK"

# 6. Two sessions start the same order (timing production_started, from
# version 2 of Q): the second waits on the row and finds it started; one pin.
"${PSQL[@]}" -c "INSERT INTO public.manufacturing_orders (id, org_id, order_number, quantity, status) VALUES ('$MO_Q2', '$Q', 'CP204-CONC-Q2', 1, 'confirmed')" >/dev/null
{ echo "BEGIN; UPDATE public.manufacturing_orders SET status = 'in_progress' WHERE id = '$MO_Q2'; SELECT pg_sleep(3); COMMIT;"; } \
  | "${PSQL[@]}" >"$work/c6a.out" 2>&1 &
sleep 1
"${PSQL[@]}" -c "UPDATE public.manufacturing_orders SET status = 'in_progress' WHERE id = '$MO_Q2'" >"$work/c6b.out" 2>&1
wait
[ "$("${PSQL[@]}" -c "SELECT count(*) FROM wardah_internal.mo_cost_policy_pins WHERE mo_id = '$MO_Q2'")" = 1 ] \
  && [ "$(pin_of "$MO_Q2")" = "$VQ2/production_started" ] \
  || { echo "CASE6_FAILED"; cat "$work/c6a.out" "$work/c6b.out"; pin_of "$MO_Q2"; exit 1; }
echo "CP204_CONC_DOUBLE_START_OK"

echo "CP204_CONCURRENCY_PASS"
