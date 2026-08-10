#!/usr/bin/env bash
set -Eeuo pipefail

: "${PGDATABASE:?PGDATABASE must be set}"

PSQL=(psql -X -v ON_ERROR_STOP=1 -qAt)
tmp_prefix=/tmp/rbac-175

org_assign='99175175-a111-a111-a111-000000000001'
assign_admin='99175175-1111-1111-1111-000000000001'
assign_target='99175175-1111-1111-1111-000000000002'
assign_role='99175175-1111-1111-1111-000000000020'

org_remove='99175175-a222-a222-a222-000000000002'
remove_admin_a='99175175-2222-2222-2222-000000000001'
remove_admin_b='99175175-2222-2222-2222-000000000002'

org_demote='99175175-a333-a333-a333-000000000003'
demote_admin_a='99175175-3333-3333-3333-000000000001'
demote_admin_b='99175175-3333-3333-3333-000000000002'

org_update='99175175-a444-a444-a444-000000000004'
update_admin='99175175-4444-4444-4444-000000000001'
update_target='99175175-4444-4444-4444-000000000002'
update_role='99175175-4444-4444-4444-000000000020'

rm -f "${tmp_prefix}"-*.ready "${tmp_prefix}"-*.started \
  "${tmp_prefix}"-*.out "${tmp_prefix}"-*.err

"${PSQL[@]}" <<SQL
DELETE FROM public.organizations
WHERE id IN ('$org_assign', '$org_remove', '$org_demote', '$org_update');
DELETE FROM auth.users
WHERE id IN (
  '$assign_admin', '$assign_target',
  '$remove_admin_a', '$remove_admin_b',
  '$demote_admin_a', '$demote_admin_b',
  '$update_admin', '$update_target'
);

INSERT INTO auth.users (id, email) VALUES
  ('$assign_admin', 'p175-race-assign-admin@example.test'),
  ('$assign_target', 'p175-race-assign-target@example.test'),
  ('$remove_admin_a', 'p175-race-remove-a@example.test'),
  ('$remove_admin_b', 'p175-race-remove-b@example.test'),
  ('$demote_admin_a', 'p175-race-demote-a@example.test'),
  ('$demote_admin_b', 'p175-race-demote-b@example.test'),
  ('$update_admin', 'p175-race-update-admin@example.test'),
  ('$update_target', 'p175-race-update-target@example.test');

INSERT INTO public.organizations (id, name, code) VALUES
  ('$org_assign', 'RBAC 175 assignment race', 'P175-RA'),
  ('$org_remove', 'RBAC 175 removal race', 'P175-RR'),
  ('$org_demote', 'RBAC 175 demotion race', 'P175-RD'),
  ('$org_update', 'RBAC 175 update race', 'P175-RU');

INSERT INTO public.user_organizations
  (user_id, org_id, is_active, is_org_admin)
VALUES
  ('$assign_admin', '$org_assign', true, true),
  ('$assign_target', '$org_assign', true, false),
  ('$remove_admin_a', '$org_remove', true, true),
  ('$remove_admin_b', '$org_remove', true, true),
  ('$demote_admin_a', '$org_demote', true, true),
  ('$demote_admin_b', '$org_demote', true, true),
  ('$update_admin', '$org_update', true, true),
  ('$update_target', '$org_update', true, false);

INSERT INTO public.roles (id, org_id, name, name_ar, is_active)
VALUES
  ('$assign_role', '$org_assign', 'P175 Race Role', 'دور سباق 175', true),
  ('$update_role', '$org_update', 'P175 Update Race Role', 'دور سباق تحديث 175', true);

INSERT INTO public.user_roles (user_id, role_id, org_id)
VALUES ('$update_target', '$update_role', '$org_update');
SQL

wait_for_file() {
  local path=$1
  local label=$2
  for _ in $(seq 1 100); do
    [[ -f "$path" ]] && return 0
    sleep 0.05
  done
  echo "RBAC_175_CONCURRENCY_FAIL: timed out waiting for $label" >&2
  return 1
}

wait_for_backend_lock() {
  local application_name=$1
  local label=$2
  local waiting
  for _ in $(seq 1 100); do
    waiting=$("${PSQL[@]}" <<SQL
SELECT count(*)
FROM pg_stat_activity
WHERE application_name = '$application_name'
  AND state = 'active'
  AND wait_event_type = 'Lock';
SQL
)
    [[ "$waiting" == '1' ]] && return 0
    sleep 0.05
  done
  echo "RBAC_175_CONCURRENCY_FAIL: timed out waiting for $label to block on a lock" >&2
  return 1
}

start_org_blocker() {
  local org_id=$1
  local ready=$2
  local output=$3
  "${PSQL[@]}" >"$output" 2>&1 <<SQL &
BEGIN;
SELECT id FROM public.organizations WHERE id = '$org_id' FOR UPDATE;
\! touch $ready
SELECT pg_sleep(4);
COMMIT;
SQL
  BLOCKER_PID=$!
}

start_membership_blocker() {
  local user_id=$1
  local org_id=$2
  local ready=$3
  local output=$4
  "${PSQL[@]}" >"$output" 2>&1 <<SQL &
BEGIN;
SELECT user_id
FROM public.user_organizations
WHERE user_id = '$user_id' AND org_id = '$org_id'
FOR UPDATE;
\! touch $ready
SELECT pg_sleep(4);
COMMIT;
SQL
  BLOCKER_PID=$!
}

run_remove() {
  local caller=$1
  local target=$2
  local org_id=$3
  local started=$4
  local output=$5
  local error=$6
  local application_name=${7:-rbac-175-remover}
  PGAPPNAME="$application_name" "${PSQL[@]}" >"$output" 2>"$error" <<SQL
BEGIN;
SELECT set_config('request.jwt.claim.sub', '$caller', true);
SET LOCAL ROLE authenticated;
\! touch $started
SELECT public.rpc_remove_org_member(jsonb_build_object(
  'org_id', '$org_id', 'user_id', '$target'));
COMMIT;
SQL
}

run_demote() {
  local caller=$1
  local target=$2
  local org_id=$3
  local started=$4
  local output=$5
  local error=$6
  "${PSQL[@]}" >"$output" 2>"$error" <<SQL
BEGIN;
SELECT set_config('request.jwt.claim.sub', '$caller', true);
SET LOCAL ROLE authenticated;
\! touch $started
SELECT COALESCE((public.rpc_set_org_admin(
  '$target', '$org_id', false)->>'ok')::boolean, false);
COMMIT;
SQL
}

# ---------------------------------------------------------------------------
# Race 1: a still-permitted direct user_roles INSERT against member removal.
# ---------------------------------------------------------------------------
assign_ready="${tmp_prefix}-assign.ready"
assign_insert_started="${tmp_prefix}-assign-insert.started"
assign_remove_started="${tmp_prefix}-assign-remove.started"
start_membership_blocker "$assign_target" "$org_assign" "$assign_ready" \
  "${tmp_prefix}-assign-blocker.out"
assign_blocker_pid=$BLOCKER_PID
wait_for_file "$assign_ready" 'assignment blocker'

( "${PSQL[@]}" >"${tmp_prefix}-assign-insert.out" 2>"${tmp_prefix}-assign-insert.err" <<SQL
\! touch $assign_insert_started
INSERT INTO public.user_roles (user_id, role_id, org_id)
VALUES ('$assign_target', '$assign_role', '$org_assign');
SQL
) &
assign_insert_pid=$!
run_remove "$assign_admin" "$assign_target" "$org_assign" \
  "$assign_remove_started" "${tmp_prefix}-assign-remove.out" \
  "${tmp_prefix}-assign-remove.err" &
assign_remove_pid=$!

wait_for_file "$assign_insert_started" 'assignment writer'
wait_for_file "$assign_remove_started" 'member remover'

assign_insert_status=0
assign_remove_status=0
wait "$assign_insert_pid" || assign_insert_status=$?
wait "$assign_remove_pid" || assign_remove_status=$?
wait "$assign_blocker_pid"

if [[ $assign_remove_status -ne 0 ]]; then
  echo 'RBAC_175_CONCURRENCY_FAIL: member removal lost the assignment race' >&2
  cat "${tmp_prefix}-assign-remove.err" >&2
  exit 1
fi

assign_final=$("${PSQL[@]}" <<SQL
SELECT
  (SELECT count(*) FROM public.user_organizations
    WHERE user_id = '$assign_target' AND org_id = '$org_assign')::text
  || '|' ||
  (SELECT count(*) FROM public.user_roles
    WHERE user_id = '$assign_target' AND org_id = '$org_assign')::text;
SQL
)
if [[ "$assign_final" != '0|0' ]]; then
  echo "RBAC_175_CONCURRENCY_FAIL: assignment/removal final membership|roles=$assign_final" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Race 2: two admins remove each other. Exactly one call may commit.
# ---------------------------------------------------------------------------
remove_ready="${tmp_prefix}-remove.ready"
remove_a_started="${tmp_prefix}-remove-a.started"
remove_b_started="${tmp_prefix}-remove-b.started"
start_org_blocker "$org_remove" "$remove_ready" "${tmp_prefix}-remove-blocker.out"
remove_blocker_pid=$BLOCKER_PID
wait_for_file "$remove_ready" 'mutual-removal blocker'

run_remove "$remove_admin_a" "$remove_admin_b" "$org_remove" \
  "$remove_a_started" "${tmp_prefix}-remove-a.out" "${tmp_prefix}-remove-a.err" &
remove_a_pid=$!
run_remove "$remove_admin_b" "$remove_admin_a" "$org_remove" \
  "$remove_b_started" "${tmp_prefix}-remove-b.out" "${tmp_prefix}-remove-b.err" &
remove_b_pid=$!
wait_for_file "$remove_a_started" 'admin A removal'
wait_for_file "$remove_b_started" 'admin B removal'

remove_a_status=0
remove_b_status=0
wait "$remove_a_pid" || remove_a_status=$?
wait "$remove_b_pid" || remove_b_status=$?
wait "$remove_blocker_pid"

remove_successes=0
[[ $remove_a_status -eq 0 ]] && remove_successes=$((remove_successes + 1))
[[ $remove_b_status -eq 0 ]] && remove_successes=$((remove_successes + 1))
if [[ $remove_successes -ne 1 ]]; then
  echo "RBAC_175_CONCURRENCY_FAIL: mutual removal successes=$remove_successes" >&2
  cat "${tmp_prefix}-remove-a.err" "${tmp_prefix}-remove-b.err" >&2
  exit 1
fi

remove_final=$("${PSQL[@]}" <<SQL
SELECT count(*)::text || '|' || count(*) FILTER (WHERE is_org_admin AND is_active)::text
FROM public.user_organizations
WHERE org_id = '$org_remove';
SQL
)
if [[ "$remove_final" != '1|1' ]]; then
  echo "RBAC_175_CONCURRENCY_FAIL: mutual removal final members|admins=$remove_final" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Race 3: A demotes B while B removes A. The post-lock authorization check
# rejects the second action regardless of which waiter acquires the lock first.
# ---------------------------------------------------------------------------
demote_ready="${tmp_prefix}-demote.ready"
demote_a_started="${tmp_prefix}-demote-a.started"
demote_b_started="${tmp_prefix}-demote-b.started"
start_org_blocker "$org_demote" "$demote_ready" "${tmp_prefix}-demote-blocker.out"
demote_blocker_pid=$BLOCKER_PID
wait_for_file "$demote_ready" 'demotion/removal blocker'

run_demote "$demote_admin_a" "$demote_admin_b" "$org_demote" \
  "$demote_a_started" "${tmp_prefix}-demote-a.out" "${tmp_prefix}-demote-a.err" &
demote_a_pid=$!
run_remove "$demote_admin_b" "$demote_admin_a" "$org_demote" \
  "$demote_b_started" "${tmp_prefix}-demote-b.out" "${tmp_prefix}-demote-b.err" &
demote_b_pid=$!
wait_for_file "$demote_a_started" 'admin demotion'
wait_for_file "$demote_b_started" 'admin removal during demotion'

demote_a_status=0
demote_b_status=0
wait "$demote_a_pid" || demote_a_status=$?
wait "$demote_b_pid" || demote_b_status=$?
wait "$demote_blocker_pid"

demote_result=$(tr -d '\r' <"${tmp_prefix}-demote-a.out" | sed '/^[[:space:]]*$/d' | tail -1)
if [[ $demote_a_status -ne 0 ]] || ! {
  [[ "$demote_result" == 't' && $demote_b_status -ne 0 ]] \
    || [[ "$demote_result" == 'f' && $demote_b_status -eq 0 ]]
}; then
  echo "RBAC_175_CONCURRENCY_FAIL: demote_status=$demote_a_status demote_result=$demote_result remove_status=$demote_b_status" >&2
  cat "${tmp_prefix}-demote-a.err" "${tmp_prefix}-demote-b.err" >&2
  exit 1
fi

demote_final=$("${PSQL[@]}" <<SQL
SELECT count(*) FILTER (WHERE is_org_admin AND is_active)::text
FROM public.user_organizations
WHERE org_id = '$org_demote';
SQL
)
if [[ "$demote_final" != '1' ]]; then
  echo "RBAC_175_CONCURRENCY_FAIL: demotion/removal left $demote_final active admins" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Race 4: direct UPDATE versus member removal. The UPDATE must fail at its
# BEFORE STATEMENT guard, before locking the assignment tuple. Removal is
# deliberately queued first behind the organization row; the old BEFORE ROW
# design deadlocks here by holding tuple -> waiting org while removal holds
# org -> waiting tuple.
# ---------------------------------------------------------------------------
update_ready="${tmp_prefix}-update.ready"
update_writer_started="${tmp_prefix}-update-writer.started"
update_remove_started="${tmp_prefix}-update-remove.started"
start_org_blocker "$org_update" "$update_ready" "${tmp_prefix}-update-blocker.out"
update_blocker_pid=$BLOCKER_PID
wait_for_file "$update_ready" 'direct-update blocker'

run_remove "$update_admin" "$update_target" "$org_update" \
  "$update_remove_started" "${tmp_prefix}-update-remove.out" \
  "${tmp_prefix}-update-remove.err" 'rbac-175-update-remover' &
update_remove_pid=$!
wait_for_file "$update_remove_started" 'member remover during direct update'
wait_for_backend_lock 'rbac-175-update-remover' \
  'member remover during direct update'

( "${PSQL[@]}" >"${tmp_prefix}-update-writer.out" 2>"${tmp_prefix}-update-writer.err" <<SQL
\! touch $update_writer_started
UPDATE public.user_roles
SET expires_at = now() + interval '1 day'
WHERE user_id = '$update_target'
  AND role_id = '$update_role'
  AND org_id = '$org_update';
SQL
) &
update_writer_pid=$!
wait_for_file "$update_writer_started" 'direct user_roles updater'

update_writer_status=0
update_remove_status=0
wait "$update_writer_pid" || update_writer_status=$?
wait "$update_blocker_pid"
wait "$update_remove_pid" || update_remove_status=$?

if [[ $update_writer_status -eq 0 ]] \
   || ! grep -q 'RBAC_175_DIRECT_USER_ROLES_UPDATE_FORBIDDEN_USE_RPC_REPLACE_USER_ROLES' \
        "${tmp_prefix}-update-writer.err"; then
  echo "RBAC_175_CONCURRENCY_FAIL: direct UPDATE status=$update_writer_status did not hit the statement guard" >&2
  cat "${tmp_prefix}-update-writer.err" >&2
  exit 1
fi
if [[ $update_remove_status -ne 0 ]]; then
  echo "RBAC_175_CONCURRENCY_FAIL: removal lost the direct-UPDATE race status=$update_remove_status" >&2
  cat "${tmp_prefix}-update-remove.err" >&2
  exit 1
fi

update_final=$("${PSQL[@]}" <<SQL
SELECT
  (SELECT count(*) FROM public.user_organizations
    WHERE user_id = '$update_target' AND org_id = '$org_update')::text
  || '|' ||
  (SELECT count(*) FROM public.user_roles
    WHERE user_id = '$update_target' AND org_id = '$org_update')::text;
SQL
)
if [[ "$update_final" != '0|0' ]]; then
  echo "RBAC_175_CONCURRENCY_FAIL: update/removal final membership|roles=$update_final" >&2
  exit 1
fi

# Global invariant proof across every fixture left by all four races.
orphan_count=$("${PSQL[@]}" <<SQL
SELECT count(*)
FROM public.user_roles ur
LEFT JOIN public.user_organizations uo
  ON uo.user_id = ur.user_id
 AND uo.org_id = ur.org_id
 AND uo.is_active IS TRUE
WHERE ur.org_id IN ('$org_assign', '$org_remove', '$org_demote', '$org_update')
  AND uo.user_id IS NULL;
SQL
)
if [[ "$orphan_count" != '0' ]]; then
  echo "RBAC_175_CONCURRENCY_FAIL: orphan/inactive assignments=$orphan_count" >&2
  exit 1
fi

printf 'RBAC_CONSUMER_175_CONCURRENCY_PASS assign_insert_status=%s mutual_remove=%s,%s demote=%s remove=%s direct_update=%s update_remove=%s\n' \
  "$assign_insert_status" "$remove_a_status" "$remove_b_status" \
  "$demote_result" "$demote_b_status" "$update_writer_status" \
  "$update_remove_status"
