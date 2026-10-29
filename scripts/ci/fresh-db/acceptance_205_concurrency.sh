#!/bin/bash
# Two-session checks for Migration 205 on a committed database through 205 (plan §6, §9):
#   1. first creation of the settings row while an approval runs: the approval waits for the change and
#      records the value after it (self-approval accepted, recorded as enabled);
#   2. a settings change while an approval runs: the change waits for the approval to finish, and the
#      approval records the value before the change;
#   3. two approvals of one org with the same expected version: one writes, the other waits and gets
#      COST_POLICY_VERSION_CONFLICT;
#   4. an approval and the 204 creation path at once: the 204 call waits and gets the conflict;
#   5. an approval and an MO insert at once: the insert waits and is pinned to the approved version;
#   6. two first creations of the settings row (two different settings) at once: both kept, the second
#      audited against the first.
#   7. the same draft idempotency key sent twice at once: one draft, the second call is its replay.
#   8. the creator edits a draft while an approver approves the revision read before the edit: the
#      approval waits for the edit and refuses (COST_POLICY_DRAFT_REVISION_CONFLICT); nothing is written.
# Waiting is measured inside the second session (clock_timestamp), not inferred.
#
# Usage: DB=<throwaway database through 205> bash acceptance_205_concurrency.sh
set -Eeuo pipefail

DB="${DB:?DB must name a throwaway database through 205}"
PSQL=(psql -X -v ON_ERROR_STOP=1 -q -t -A -d "$DB")
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

C=52050205-0000-0000-0000-00000000c0c1
D=52050205-0000-0000-0000-00000000c0d1
E=52050205-0000-0000-0000-00000000c0e1
SELF=52050205-0000-0000-0000-00000000c001
SETTINGS=52050205-0000-0000-0000-00000000c002
CREATOR=52050205-0000-0000-0000-00000000c003
APPROVER=52050205-0000-0000-0000-00000000c004
Q4ADMIN=52050205-0000-0000-0000-00000000c005

"${PSQL[@]}" >/dev/null <<SQL
INSERT INTO public.organizations (id, name, code) VALUES ('$C', 'CP205 conc C', 'CP205-CC'), ('$D', 'CP205 conc D', 'CP205-CD'), ('$E', 'CP205 conc E', 'CP205-CE');
INSERT INTO auth.users (id, email) VALUES ('$SELF', 'c-self@cp205.test'), ('$SETTINGS', 'c-settings@cp205.test'),
  ('$CREATOR', 'c-creator@cp205.test'), ('$APPROVER', 'c-approver@cp205.test'), ('$Q4ADMIN', 'c-q4@cp205.test');
INSERT INTO public.user_organizations (user_id, org_id, role, is_active, is_org_admin)
SELECT u, o, CASE WHEN u = '$Q4ADMIN'::uuid THEN 'admin' ELSE 'user' END, true, u = '$Q4ADMIN'::uuid
FROM unnest(ARRAY['$SELF','$SETTINGS','$CREATOR','$APPROVER','$Q4ADMIN']::uuid[]) u, unnest(ARRAY['$C','$D','$E']::uuid[]) o;
INSERT INTO public.roles (id, org_id, name, name_ar, is_active)
SELECT gen_random_uuid(), o, k, k, true FROM unnest(ARRAY['$C','$D','$E']::uuid[]) o,
  unnest(ARRAY['self','settings','creator','approver','q4']) k;
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r JOIN (VALUES
  ('self', 'manufacturing.settings.update'), ('self', 'manufacturing.cost_policy.approve'), ('self', 'manufacturing.cost_policy.self_approve'),
  ('settings', 'manufacturing.cost_policy.approval_settings.manage'),
  ('creator', 'manufacturing.settings.update'),
  ('approver', 'manufacturing.cost_policy.approve'),
  ('q4', 'manufacturing.cost_policy.unallocated_policy.manage')) m(k, key) ON m.k = r.name
JOIN public.permissions p ON p.permission_key = m.key
WHERE r.org_id IN ('$C', '$D', '$E');
INSERT INTO public.user_roles (user_id, role_id, org_id)
SELECT u.id, r.id, r.org_id FROM public.roles r JOIN (VALUES ('$SELF'::uuid, 'self'), ('$SETTINGS'::uuid, 'settings'),
  ('$CREATOR'::uuid, 'creator'), ('$APPROVER'::uuid, 'approver'), ('$Q4ADMIN'::uuid, 'q4')) u(id, k) ON u.k = r.name
WHERE r.org_id IN ('$C', '$D', '$E');
INSERT INTO public.gl_accounts (org_id, code, name, category, subtype, normal_balance)
SELECT o, '5101', 'Electricity', 'EXPENSE', 'OVERHEAD', 'DEBIT' FROM unnest(ARRAY['$C','$D','$E']::uuid[]) o;
SQL

as_user() {
  printf "SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '%s', false); SELECT set_config('request.jwt.claims', json_build_object('sub','%s','role','authenticated')::text, false);\n" "$1" "$1"
}
# A one-pool, one-budget draft starting p_days after the org's today (resolved once as owner).
draft() {
  "${PSQL[@]}" -c "SELECT jsonb_build_object('effective_from', (wardah_internal.mfg_cost_policy_org_today_204('$1', true) + $2)::text,
    'labor_cost_source', 'work_center_rate', 'default_labor_rate_per_hour', 30, 'pin_event', 'mo_created',
    'overhead_pools', jsonb_build_array(jsonb_build_object('pool_code', 'MACHINE_OH', 'name', 'M', 'basis', 'machine_hours', 'rate', 40,
      'activity', 'both', 'budgets', jsonb_build_array('ELECTRICITY'))),
    'budgets', jsonb_build_array(jsonb_build_object('budget_code', 'ELECTRICITY', 'setup_related', false,
      'gl_account_id', (SELECT id FROM public.gl_accounts WHERE org_id = '$1' AND code = '5101'))))"
}
create_draft() {   # org, user, days, expected -> draft id
  { as_user "$2"; echo "SELECT public.rpc_create_mfg_cost_policy_draft_205('$1', '$(draft "$1" "$3")'::jsonb, $4, gen_random_uuid())->>'draft_id';"; } \
    | "${PSQL[@]}" | tail -1
}
timed() {          # a statement run in a DO block that reports how long it took
  printf "DO \$t\$ DECLARE t0 timestamptz := clock_timestamp(); BEGIN PERFORM %s; RAISE NOTICE 'WAITED=%%', round(extract(epoch FROM clock_timestamp() - t0)::numeric, 2); END \$t\$;\n" "$1"
}
waited_at_least() { # file, seconds
  awk -v min="$2" -F'WAITED=' '/WAITED=/ { if ($2 + 0 >= min) ok = 1 } END { exit ok ? 0 : 1 }' "$1"
}

# 1. Settings row created (self-approval on) while the creator-approver approves their own draft.
DS=$(create_draft "$C" "$SELF" 0 0)
{ as_user "$SETTINGS"; echo "BEGIN; SELECT public.rpc_set_cost_policy_self_approval_205('$C', true, 'conc')->>'self_approval_enabled'; SELECT pg_sleep(3); COMMIT;"; } \
  | "${PSQL[@]}" >"$work/c1a.out" 2>&1 &
sleep 1
{ as_user "$SELF"; timed "public.rpc_approve_mfg_cost_policy_draft_205('$C', '$DS', 1)"; } | "${PSQL[@]}" >"$work/c1b.out" 2>&1 || true
wait
{ waited_at_least "$work/c1b.out" 1.5 \
  && [ "$("${PSQL[@]}" -c "SELECT self_approved AND self_approval_enabled_at_approval FROM wardah_internal.mfg_cost_policy_approvals_205 WHERE draft_id = '$DS'")" = t ]; } \
  || { echo "CASE1_FAILED"; cat "$work/c1a.out" "$work/c1b.out"; exit 1; }
echo "CP205_CONC_FIRST_SETTINGS_ROW_BEFORE_APPROVAL_OK"

# 2. Approval first; a settings change in the meantime waits; the approval keeps the value it read.
DC=$(create_draft "$C" "$CREATOR" 1 1)
{ as_user "$APPROVER"; echo "BEGIN; SELECT public.rpc_approve_mfg_cost_policy_draft_205('$C', '$DC', 1)->>'status'; SELECT pg_sleep(3); COMMIT;"; } \
  | "${PSQL[@]}" >"$work/c2a.out" 2>&1 &
sleep 1
{ as_user "$SETTINGS"; timed "public.rpc_set_cost_policy_self_approval_205('$C', false, 'conc back')"; } | "${PSQL[@]}" >"$work/c2b.out" 2>&1 || true
wait
{ grep -qx 'approved' "$work/c2a.out" && waited_at_least "$work/c2b.out" 1.5 \
  && [ "$("${PSQL[@]}" -c "SELECT self_approval_enabled_at_approval FROM wardah_internal.mfg_cost_policy_approvals_205 WHERE draft_id = '$DC'")" = t ] \
  && [ "$("${PSQL[@]}" -c "SELECT self_approval_enabled FROM wardah_internal.mfg_cost_policy_approval_settings_205 WHERE org_id = '$C'")" = f ]; } \
  || { echo "CASE2_FAILED"; cat "$work/c2a.out" "$work/c2b.out"; exit 1; }
echo "CP205_CONC_SETTINGS_CHANGE_WAITS_FOR_APPROVAL_OK"

# 3. Two approvals with the same expected version.
DX=$(create_draft "$C" "$CREATOR" 2 2)
DY=$(create_draft "$C" "$CREATOR" 3 2)
{ as_user "$APPROVER"; echo "BEGIN; SELECT public.rpc_approve_mfg_cost_policy_draft_205('$C', '$DX', 1)->>'status'; SELECT pg_sleep(3); COMMIT;"; } \
  | "${PSQL[@]}" >"$work/c3a.out" 2>&1 &
sleep 1
{ as_user "$APPROVER"; timed "public.rpc_approve_mfg_cost_policy_draft_205('$C', '$DY', 1)"; } | "${PSQL[@]}" >"$work/c3b.out" 2>&1 || true
wait
{ grep -qx 'approved' "$work/c3a.out" && grep -q 'COST_POLICY_VERSION_CONFLICT: latest=3' "$work/c3b.out" \
  && [ "$("${PSQL[@]}" -c "SELECT count(*) FROM wardah_internal.mfg_cost_policy_versions WHERE org_id = '$C'")" = 3 ] \
  && [ "$("${PSQL[@]}" -c "SELECT status FROM wardah_internal.mfg_cost_policy_drafts_205 WHERE id = '$DY'")" = draft ]; } \
  || { echo "CASE3_FAILED"; cat "$work/c3a.out" "$work/c3b.out"; exit 1; }
echo "CP205_CONC_TWO_APPROVALS_OK"

# 4. An approval and the 204 creation path at once.
DZ=$(create_draft "$C" "$CREATOR" 4 3)
{ as_user "$APPROVER"; echo "BEGIN; SELECT public.rpc_approve_mfg_cost_policy_draft_205('$C', '$DZ', 1)->>'status'; SELECT pg_sleep(3); COMMIT;"; } \
  | "${PSQL[@]}" >"$work/c4a.out" 2>&1 &
sleep 1
P204=$("${PSQL[@]}" -c "SELECT (('$(draft "$C" 5)'::jsonb - 'budgets') || jsonb_build_object('overhead_pools', jsonb_build_array(jsonb_build_object('pool_code','MACHINE_OH','name','M','basis','machine_hours','rate',40))))::text")
{ as_user "$CREATOR"; echo "SELECT public.rpc_create_mfg_cost_policy_version('$C', '$P204'::jsonb, 3, gen_random_uuid());"; } \
  | "${PSQL[@]}" >"$work/c4b.out" 2>&1 || true
wait
{ grep -qx 'approved' "$work/c4a.out" && grep -q 'COST_POLICY_VERSION_CONFLICT: latest=4' "$work/c4b.out"; } \
  || { echo "CASE4_FAILED"; cat "$work/c4a.out" "$work/c4b.out"; exit 1; }
echo "CP205_CONC_APPROVAL_AND_204_PATH_OK"

# 5. An approval (version in force today) and an MO insert at once, in org D with no version yet.
DD=$(create_draft "$D" "$CREATOR" 0 0)
MO=52050205-0000-0000-0000-00000000c0f5
{ as_user "$APPROVER"; echo "BEGIN; SELECT public.rpc_approve_mfg_cost_policy_draft_205('$D', '$DD', 1)->>'policy_version_id'; SELECT pg_sleep(3); COMMIT;"; } \
  | "${PSQL[@]}" >"$work/c5a.out" 2>&1 &
sleep 1
"${PSQL[@]}" -c "INSERT INTO public.manufacturing_orders (id, org_id, order_number, quantity) VALUES ('$MO', '$D', 'CP205-CONC-MO', 1)" >"$work/c5b.out" 2>&1
wait
VD=$(grep -E '^[0-9a-f-]{36}$' "$work/c5a.out" | tail -1)
{ [ -n "$VD" ] && [ "$("${PSQL[@]}" -c "SELECT policy_version_id FROM wardah_internal.mo_cost_policy_pins WHERE mo_id = '$MO'")" = "$VD" ]; } \
  || { echo "CASE5_FAILED"; cat "$work/c5a.out" "$work/c5b.out"; exit 1; }
echo "CP205_CONC_APPROVAL_BEFORE_PIN_OK"

# 6. Two first creations of the settings row of org E, for two different settings.
{ as_user "$SETTINGS"; echo "BEGIN; SELECT public.rpc_set_cost_policy_self_approval_205('$E', true, 'first')->>'self_approval_enabled'; SELECT pg_sleep(3); COMMIT;"; } \
  | "${PSQL[@]}" >"$work/c6a.out" 2>&1 &
sleep 1
{ as_user "$Q4ADMIN"; timed "public.rpc_set_cost_policy_unallocated_policy_205('$E', 'controlled_exception', 'second')"; } | "${PSQL[@]}" >"$work/c6b.out" 2>&1 || true
wait
{ waited_at_least "$work/c6b.out" 1.5 \
  && [ "$("${PSQL[@]}" -c "SELECT self_approval_enabled::text || '/' || unallocated_budget_policy FROM wardah_internal.mfg_cost_policy_approval_settings_205 WHERE org_id = '$E'")" = "true/controlled_exception" ] \
  && [ "$("${PSQL[@]}" -c "SELECT count(*) FROM wardah_internal.mfg_cost_policy_approval_settings_audit_205 WHERE org_id = '$E'")" = 2 ]; } \
  || { echo "CASE6_FAILED"; cat "$work/c6a.out" "$work/c6b.out"; exit 1; }
echo "CP205_CONC_TWO_FIRST_SETTINGS_ROWS_OK"

# 7. The same idempotency key twice at once (org E, no lock on draft creation: the unique key decides).
KEY=52050205-0000-0000-0000-00000000c0f7
PD=$(draft "$E" 0)
{ as_user "$CREATOR"; echo "BEGIN; SELECT public.rpc_create_mfg_cost_policy_draft_205('$E', '$PD'::jsonb, 0, '$KEY')->>'replayed'; SELECT pg_sleep(3); COMMIT;"; }   | "${PSQL[@]}" >"$work/c7a.out" 2>&1 &
sleep 1
{ as_user "$CREATOR"; echo "SELECT public.rpc_create_mfg_cost_policy_draft_205('$E', '$PD'::jsonb, 0, '$KEY')->>'replayed';"; }   | "${PSQL[@]}" >"$work/c7b.out" 2>&1 || true
wait
{ grep -qx 'false' "$work/c7a.out" && grep -qx 'true' "$work/c7b.out"   && [ "$("${PSQL[@]}" -c "SELECT count(*) FROM wardah_internal.mfg_cost_policy_drafts_205 WHERE org_id = '$E' AND idempotency_key = '$KEY'")" = 1 ]; }   || { echo "CASE7_FAILED"; cat "$work/c7a.out" "$work/c7b.out"; exit 1; }
echo "CP205_CONC_IDEMPOTENT_DRAFT_REPLAY_OK"

# 8. An edit and an approval of the revision read before it, at once (the case-7 draft of org E, revision 1).
DE=$("${PSQL[@]}" -c "SELECT id FROM wardah_internal.mfg_cost_policy_drafts_205 WHERE org_id = '$E' AND idempotency_key = '$KEY'")
PD2=$("${PSQL[@]}" -c "SELECT jsonb_set('$PD'::jsonb, '{overhead_pools,0,rate}', '41'::jsonb)::text")
{ as_user "$CREATOR"; echo "BEGIN; SELECT public.rpc_update_mfg_cost_policy_draft_205('$E', '$DE', '$PD2'::jsonb, 0)->>'revision'; SELECT pg_sleep(3); COMMIT;"; } \
  | "${PSQL[@]}" >"$work/c8a.out" 2>&1 &
sleep 1
# The refusal is caught inside the timed block, so the wait is reported as well.
{ as_user "$APPROVER"; printf "DO \$t\$ DECLARE t0 timestamptz := clock_timestamp(); BEGIN BEGIN PERFORM public.rpc_approve_mfg_cost_policy_draft_205('%s', '%s', 1); EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'REFUSED=%%', SQLERRM; END; RAISE NOTICE 'WAITED=%%', round(extract(epoch FROM clock_timestamp() - t0)::numeric, 2); END \$t\$;\n" "$E" "$DE"; } \
  | "${PSQL[@]}" >"$work/c8b.out" 2>&1 || true
wait
{ grep -qx '2' "$work/c8a.out" && grep -q 'REFUSED=COST_POLICY_DRAFT_REVISION_CONFLICT: current=2' "$work/c8b.out" \
  && waited_at_least "$work/c8b.out" 1.5 \
  && [ "$("${PSQL[@]}" -c "SELECT status || '/' || revision FROM wardah_internal.mfg_cost_policy_drafts_205 WHERE id = '$DE'")" = "draft/2" ] \
  && [ "$("${PSQL[@]}" -c "SELECT count(*) FROM wardah_internal.mfg_cost_policy_versions WHERE org_id = '$E'")" = 0 ]; } \
  || { echo "CASE8_FAILED"; cat "$work/c8a.out" "$work/c8b.out"; exit 1; }
echo "CP205_CONC_EDIT_BEFORE_APPROVAL_REFUSES_OLD_REVISION_OK"

echo "CP205_CONCURRENCY_PASS"
