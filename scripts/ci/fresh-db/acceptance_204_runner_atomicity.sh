#!/bin/bash
# Migration 204 has no BEGIN/COMMIT: it relies on a runner-owned transaction.
# This proves, through the real run_chain.sh, that a failure after 204 has
# already created objects leaves nothing behind, and that `SET LOCAL
# lock_timeout` is in effect inside that transaction.
#
# A copy of 204 gets one injected statement right after its first table and
# index. The statement raises, and its message reports lock_timeout and
# whether that table exists at that moment (both read inside the transaction).
#   wrapped  — the copy keeps 204's file name, so run_chain.sh applies it with
#              --single-transaction: exit non-zero, lock_timeout=10s,
#              table_exists=true at the failure, and no 204 object afterwards.
#   control  — the same copy under a name outside 195–204, which run_chain.sh
#              applies in autocommit: lock_timeout is the default (SET LOCAL
#              has no effect) and the table is left behind. This shows the
#              check can see the partial state it guards against.
#
# Usage: PRE_DB=<database built through 203> bash acceptance_204_runner_atomicity.sh
set -Eeuo pipefail

PRE_DB="${PRE_DB:?PRE_DB must name a database built through 203}"
MIGRATION="sql/migrations/204_manufacturing_cost_policies.sql"
# Overridable only to prove the check fails against a runner that does not wrap 204.
RUNNER="${RUNNER:-scripts/ci/fresh-db/run_chain.sh}"
PSQL=(psql -X -v ON_ERROR_STOP=1 -q -t -A)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

ANCHOR='CREATE UNIQUE INDEX mfg_cost_policy_versions_live_start
  ON wardah_internal.mfg_cost_policy_versions (org_id, effective_from)
  WHERE withdrawn_at IS NULL;
'
INJECT="DO \$inject\$ BEGIN
  RAISE EXCEPTION 'CP204_INJECTED_FAILURE lock_timeout=% table_exists=%',
    current_setting('lock_timeout'),
    (to_regclass('wardah_internal.mfg_cost_policy_versions') IS NOT NULL)::text;
END \$inject\$;
"
# Literal insertion after exactly one occurrence of the anchor.
ANCHOR="$ANCHOR" INJECT="$INJECT" perl -0777 -ne '
  my ($a, $i) = ($ENV{ANCHOR}, $ENV{INJECT});
  my $n = () = /\Q$a\E/g;
  die "ANCHOR_NOT_UNIQUE: $n\n" unless $n == 1;
  my $at = index($_, $a) + length($a);
  substr($_, $at, 0) = $i;
  print;
' "$MIGRATION" > "$work/injected.sql"

# 204's own objects, by name; none may exist after the wrapped failure.
leftovers() {
  "${PSQL[@]}" -d "$1" -c "
    SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'wardah_internal'
              AND c.relname IN ('mfg_cost_policy_versions','mfg_cost_policy_pools','mfg_cost_policy_wc_rules',
                                'mfg_cost_policy_wc_pool_rules','mo_cost_policy_pins'))
         + (SELECT count(*) FROM pg_proc WHERE proname IN ('mfg_cost_policy_immutable_204','mfg_cost_policy_org_today_204','mfg_cost_policy_version_at_204',
                              'mfg_cost_policy_can_read_204','mfg_cost_policy_version_json_204','mfg_cost_policy_compute_204',
                              'pin_mo_cost_policy_204'))
         + (SELECT count(*) FROM pg_proc WHERE proname IN ('rpc_get_mfg_cost_policy','rpc_create_mfg_cost_policy_version',
                                                          'rpc_withdraw_mfg_cost_policy_version','rpc_preview_mfg_cost_absorption'))
         + (SELECT count(*) FROM pg_trigger WHERE tgname = 'pin_mo_cost_policy_204')"
}

run_case() {
  local name="$1" file="$2" db="cp204_atom_$1"
  mkdir -p "$work/$name"
  cp "$work/injected.sql" "$work/$name/$file"
  printf '%s\n' "$file" > "$work/$name.order"
  dropdb --if-exists "$db"
  createdb -T "$PRE_DB" "$db"
  [ "$(leftovers "$db")" = 0 ] || { echo "CP204_RUNNER_PRE_DB_NOT_CLEAN: $name"; exit 1; }
  local rc=0
  REPORT="$work/$name.report" PGDATABASE="$db" bash "$RUNNER" "$work/$name" "$work/$name.order" > "$work/$name.out" 2>&1 || rc=$?
  echo "== $name: file=$file runner_exit=$rc"
  cat "$work/$name.out"
  sed "s|$work|<tmp>|g" "$work/$name.report"
  echo "leftover_204_objects=$(leftovers "$db")"
  CASE_RC=$rc
  CASE_REPORT=$(cat "$work/$name.report")
  CASE_LEFT=$(leftovers "$db")
  dropdb "$db"
}

run_case wrapped 204_manufacturing_cost_policies.sql
[ "$CASE_RC" -ne 0 ] || { echo "CP204_RUNNER_EXIT_ZERO_ON_FAILURE"; exit 1; }
grep -q 'CP204_INJECTED_FAILURE lock_timeout=10s table_exists=true' <<<"$CASE_REPORT" \
  || { echo "CP204_RUNNER_INJECTION_NOT_REACHED_OR_LOCK_TIMEOUT_NOT_SET"; exit 1; }
[ "$CASE_LEFT" = 0 ] || { echo "CP204_RUNNER_PARTIAL_STATE_LEFT: $CASE_LEFT"; exit 1; }
echo "CP204_RUNNER_ROLLBACK_OK"
echo "CP204_RUNNER_LOCK_TIMEOUT_IN_TX_OK"

run_case control 990_cp204_injected_outside_b2_range.sql
[ "$CASE_RC" -ne 0 ] || { echo "CP204_CONTROL_EXIT_ZERO"; exit 1; }
grep -q 'CP204_INJECTED_FAILURE lock_timeout=0 table_exists=true' <<<"$CASE_REPORT" \
  || { echo "CP204_CONTROL_UNEXPECTED_REPORT"; exit 1; }
[ "$CASE_LEFT" -gt 0 ] || { echo "CP204_CONTROL_LEFT_NOTHING (check cannot see partial state)"; exit 1; }
echo "CP204_RUNNER_AUTOCOMMIT_CONTROL_OK: outside the wrapped range the same failure leaves $CASE_LEFT object(s) and lock_timeout=0"

echo "CP204_RUNNER_ATOMICITY_PASS"
