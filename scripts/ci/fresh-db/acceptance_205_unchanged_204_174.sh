#!/bin/bash
# 205 leaves 204 and 174 as they are, including data that already exists (plan §2, §5, §10):
#   1. on a copy of a database through 204, a version is created through the 204 path and an order is
#      pinned to it (the state a Production org may be in);
#   2. fingerprint (acceptance_205_fingerprint_204_174.sql) before 205, after 205, and after that
#      version is resolved through the 205 draft/approval path: all three identical (functions, ACLs,
#      triggers, table definitions, and the rows of the six 204 tables);
#   3. the version is refused as legacy before the resolution and computes after it; the order stays
#      pinned to it.
#
# Usage: PRE_DB=<database through 204> bash acceptance_205_unchanged_204_174.sh
set -Eeuo pipefail

PRE_DB="${PRE_DB:?PRE_DB must name a database built through 204}"
MIGRATION="sql/migrations/205_manufacturing_cost_policy_approval_and_overhead.sql"
FP="scripts/ci/fresh-db/acceptance_205_fingerprint_204_174.sql"
DB=cp205_unchanged
PSQL=(psql -X -v ON_ERROR_STOP=1 -q -t -A -d "$DB")
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

L=52050205-0000-0000-0000-00000000f0a1
ADMIN=52050205-0000-0000-0000-00000000f0a2
APPROVER=52050205-0000-0000-0000-00000000f0a3
MO=52050205-0000-0000-0000-00000000f0a4
WC=52050205-0000-0000-0000-00000000f0a5

dropdb --if-exists "$DB"
createdb -T "$PRE_DB" "$DB"
"${PSQL[@]}" >/dev/null <<SQL
INSERT INTO public.organizations (id, name, code) VALUES ('$L', 'CP205 legacy', 'CP205-L');
INSERT INTO auth.users (id, email) VALUES ('$ADMIN', 'l-admin@cp205.test'), ('$APPROVER', 'l-approver@cp205.test');
INSERT INTO public.user_organizations (user_id, org_id, role, is_active, is_org_admin)
VALUES ('$ADMIN', '$L', 'admin', true, true), ('$APPROVER', '$L', 'user', true, false);
INSERT INTO public.work_centers (id, org_id, code, name, is_active) VALUES ('$WC', '$L', 'WC-L', 'Line', true);
INSERT INTO public.gl_accounts (org_id, code, name, category, subtype, normal_balance)
VALUES ('$L', '5101', 'Electricity', 'EXPENSE', 'OVERHEAD', 'DEBIT'), ('$L', '5301', 'Supervision', 'EXPENSE', 'OVERHEAD', 'DEBIT');
SQL
as_user() {
  printf "SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '%s', false); SELECT set_config('request.jwt.claims', json_build_object('sub','%s','role','authenticated')::text, false);\n" "$1" "$1"
}
TODAY=$("${PSQL[@]}" -c "SELECT wardah_internal.mfg_cost_policy_org_today_204('$L', true)")
V=$( { as_user "$ADMIN"; echo "SELECT public.rpc_create_mfg_cost_policy_version('$L', jsonb_build_object('effective_from', '$TODAY',
  'labor_cost_source', 'work_center_rate', 'default_labor_rate_per_hour', 30, 'pin_event', 'mo_created',
  'overhead_pools', jsonb_build_array(jsonb_build_object('pool_code','LABOR_OH','name','L','basis','labor_hours','rate',12),
                                      jsonb_build_object('pool_code','MACHINE_OH','name','M','basis','machine_hours','rate',40)),
  'work_center_rules', jsonb_build_array(jsonb_build_object('work_center_id','$WC','labor_rate_per_hour',35,
     'pools', jsonb_build_array(jsonb_build_object('pool_code','MACHINE_OH','applies',true,'rate',55))))), 0, gen_random_uuid())->>'policy_version_id';"; } \
  | "${PSQL[@]}" | tail -1)
"${PSQL[@]}" -c "INSERT INTO public.manufacturing_orders (id, org_id, order_number, quantity) VALUES ('$MO', '$L', 'CP205-L-MO', 1)" >/dev/null
[ "$("${PSQL[@]}" -c "SELECT policy_version_id FROM wardah_internal.mo_cost_policy_pins WHERE mo_id = '$MO'")" = "$V" ] \
  || { echo "SETUP_PIN_MISSING"; exit 1; }

TPL="'public.create_role_from_template(uuid,uuid,character varying,uuid)'::regprocedure"
psql -X -q -d "$DB" -f "$FP" >"$work/before.txt"
"${PSQL[@]}" -c "SELECT prosrc FROM pg_proc WHERE oid = $TPL" >"$work/tpl_before.txt"
psql -X -v ON_ERROR_STOP=1 -q --single-transaction -d "$DB" -f "$MIGRATION"
psql -X -q -d "$DB" -f "$FP" >"$work/after_apply.txt"
diff -u "$work/before.txt" "$work/after_apply.txt" || { echo "CP205_CHANGED_204_OR_174_ON_APPLY"; exit 1; }
echo "CP205_APPLY_LEAVES_204_174_UNCHANGED objects=$(wc -l < "$work/before.txt")"
# create_role_from_template (M201 body): 205 section 1b makes exactly two edits; undoing them gives the
# M201 body back byte for byte, and the body did change.
"${PSQL[@]}" -c "SELECT prosrc FROM pg_proc WHERE oid = $TPL" >"$work/tpl_after.txt"
"${PSQL[@]}" -c "SELECT replace(replace(prosrc,
  E'''manufacturing.settings.update'',\n                 ''manufacturing.cost_policy.self_approve'',\n                 ''manufacturing.cost_policy.approval_settings.manage'',\n                 ''manufacturing.cost_policy.unallocated_policy.manage'')',
  E'''manufacturing.settings.update'')'),
  E'-- Preserve the M175 audit record; M196, M199, M201 and M205 only narrow\n    -- template expansion above.',
  E'-- Preserve the M175 audit record; M196, M199 and M201 only narrow template\n    -- expansion above.') FROM pg_proc WHERE oid = $TPL" >"$work/tpl_undone.txt"
{ cmp -s "$work/tpl_before.txt" "$work/tpl_undone.txt" && ! cmp -s "$work/tpl_before.txt" "$work/tpl_after.txt"; } \
  || { echo "CP205_TEMPLATE_EDIT_NOT_EXACT"; diff "$work/tpl_before.txt" "$work/tpl_after.txt"; exit 1; }
echo "CP205_TEMPLATE_BODY_TWO_EDITS_ONLY"

# The approver role is created after 205 (the key exists only then).
"${PSQL[@]}" >/dev/null <<SQL
INSERT INTO public.roles (id, org_id, name, name_ar, is_active) VALUES ('52050205-0000-0000-0000-00000000f0a6', '$L', 'approver', 'معتمد', true);
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT '52050205-0000-0000-0000-00000000f0a6', id FROM public.permissions WHERE permission_key = 'manufacturing.cost_policy.approve';
INSERT INTO public.user_roles (user_id, role_id, org_id) VALUES ('$APPROVER', '52050205-0000-0000-0000-00000000f0a6', '$L');
SQL
H='{"labor": {"run": 18, "setup": 2}, "machine": {"run": 15, "setup": 1.5}}'
{ as_user "$APPROVER"; echo "SELECT public.rpc_preview_mfg_cost_absorption_205('$L', '$V', '$WC', '$H'::jsonb, NULL);"; } \
  | "${PSQL[@]}" >"$work/unresolved.out" 2>&1 || true
grep -q 'COST_POLICY_LEGACY_UNRESOLVED' "$work/unresolved.out" || { echo "LEGACY_NOT_REFUSED"; cat "$work/unresolved.out"; exit 1; }

RES=$("${PSQL[@]}" -c "SELECT jsonb_build_object(
  'pools', jsonb_build_array(jsonb_build_object('pool_code','LABOR_OH','activity','both','budgets',jsonb_build_array('SUPERVISION')),
                             jsonb_build_object('pool_code','MACHINE_OH','activity','run','budgets',jsonb_build_array('ELECTRICITY'))),
  'budgets', jsonb_build_array(
     jsonb_build_object('budget_code','ELECTRICITY','setup_related',false,'gl_account_id',(SELECT id FROM public.gl_accounts WHERE org_id = '$L' AND code = '5101')),
     jsonb_build_object('budget_code','SUPERVISION','setup_related',false,'gl_account_id',(SELECT id FROM public.gl_accounts WHERE org_id = '$L' AND code = '5301'))))")
D=$( { as_user "$ADMIN"; echo "SELECT public.rpc_create_legacy_resolution_draft_205('$L', '$V', '$RES'::jsonb, 'version created before 205', gen_random_uuid())->>'draft_id';"; } \
  | "${PSQL[@]}" | tail -1)
{ as_user "$APPROVER"; echo "SELECT public.rpc_approve_mfg_cost_policy_draft_205('$L', '$D', 1)->>'status';"; } | "${PSQL[@]}" | tail -1 | grep -qx approved \
  || { echo "RESOLUTION_NOT_APPROVED"; exit 1; }
psql -X -q -d "$DB" -f "$FP" >"$work/after_resolution.txt"
diff -u "$work/before.txt" "$work/after_resolution.txt" || { echo "CP205_RESOLUTION_CHANGED_204"; exit 1; }
{ as_user "$APPROVER"; echo "SELECT public.rpc_preview_mfg_cost_absorption_205('$L', '$V', '$WC', '$H'::jsonb, NULL)->>'total';"; } \
  | "${PSQL[@]}" | tail -1 | grep -qE '^[0-9]+\.[0-9]{2}$' || { echo "RESOLVED_NOT_COMPUTED"; exit 1; }
[ "$("${PSQL[@]}" -c "SELECT policy_version_id FROM wardah_internal.mo_cost_policy_pins WHERE mo_id = '$MO'")" = "$V" ] \
  || { echo "PIN_MOVED"; exit 1; }
cp "$work/before.txt" "${FINGERPRINT_OUT:-/dev/null}" 2>/dev/null || true
dropdb "$DB"
echo "CP205_RESOLUTION_LEAVES_204_UNCHANGED"
echo "CP205_UNCHANGED_204_174_PASS"
