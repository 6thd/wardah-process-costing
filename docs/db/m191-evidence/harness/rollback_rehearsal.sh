#!/usr/bin/env bash
# M191 rollback rehearsal — disposable Fresh DB only.
#
# Required live databases:
#   wardah_pre191 : cutoff-189 baseline + reference data + Migration 190 only
#   wardah_m191   : same prerequisite state + M191_CANDIDATE_ASSEMBLED.sql
#
# The rollback SQL is generated from wardah_pre191's live catalog, not guessed
# from historical migration files. This guarantees that the rehearsal restores
# the exact pre-191 bodies, including Migration 190's consumption body and the
# out-of-band hardening already present on release_expired_reservations.
#
# It then proves:
#   1) all twelve definitions/owner/security/proconfig/ACL match pre-191 exactly;
#   2) the new helper is absent;
#   3) the frozen F2 RED-A/RED-B proof is observable again on the rolled-back DB;
#   4) M191 can be reapplied;
#   5) the aggregate GREEN harness passes again; and
#   6) the thirteen-object post-M191 catalog returns byte-for-byte to the state
#      captured before rollback.
#
# Never run this against Production or Staging merely to prove RED behavior.

set -Eeuo pipefail

PRE_DB=${PRE_DB:-wardah_pre191}
M191_DB=${M191_DB:-wardah_m191}
ROOT=${ROOT:-$(git rev-parse --show-toplevel)}
SCRATCH=${SCRATCH:-$ROOT/docs/db/m191-evidence/harness}
RUN_DIR=${ROLLBACK_RUN_DIR:-/var/tmp/pg17/m191-rollback}
mkdir -p "$RUN_DIR"

PSQL=(psql -X -v ON_ERROR_STOP=1 -qAt)

fail() {
  echo "M191_ROLLBACK_REHEARSAL_FAIL: $1" >&2
  exit 1
}

log() {
  printf '[rollback] %s\n' "$*"
}

signatures=(
  'public.wardah_apply_stock_incoming(uuid,uuid,uuid,numeric,numeric,text,uuid,text,date)'
  'public.wardah_apply_stock_incoming(uuid,uuid,uuid,numeric,numeric,text,uuid,text,date,uuid)'
  'public.wardah_apply_stock_outgoing(uuid,uuid,uuid,numeric,text,uuid,text,date)'
  'public.wardah_apply_stock_outgoing(uuid,uuid,uuid,numeric,text,uuid,text,date,uuid)'
  'public.rpc_cancel_stock_adjustment(uuid,text)'
  'public.rpc_manual_stock_movement_v2(jsonb)'
  'public.rpc_post_goods_receipt(jsonb)'
  'public.rpc_post_delivery_note(jsonb)'
  'public.rpc_submit_stock_adjustment(uuid)'
  'public.rpc_consume_reserved_materials_v2(uuid,uuid,jsonb)'
  'public.release_expired_reservations(uuid)'
  'public.rpc_create_mo_with_reservation(jsonb,jsonb,uuid)'
)
helper_sig='public.wardah_lock_products_for_stock_write(uuid,uuid[])'

check_db() {
  local db=$1
  PGDATABASE="$db" "${PSQL[@]}" -c 'SELECT 1' >/dev/null \
    || fail "database is not reachable: $db"
}

helper_present() {
  local db=$1
  PGDATABASE="$db" "${PSQL[@]}" -c \
    "SELECT (to_regprocedure('$helper_sig') IS NOT NULL)::int"
}

# Deterministic JSONL catalog contract. pg_get_functiondef is carried inside
# jsonb, so embedded newlines are escaped and each signature occupies one line.
# Function OIDs are intentionally excluded: wardah_pre191 and wardah_m191 are
# separate databases and may assign different object OIDs. Role names are used
# instead of role OIDs for the same reason.
snapshot_contract() {
  local db=$1 out=$2 include_helper=$3
  PGDATABASE="$db" "${PSQL[@]}" >"$out" <<SQL
WITH targets(signature, is_helper) AS (
  VALUES
    ('public.wardah_apply_stock_incoming(uuid,uuid,uuid,numeric,numeric,text,uuid,text,date)', false),
    ('public.wardah_apply_stock_incoming(uuid,uuid,uuid,numeric,numeric,text,uuid,text,date,uuid)', false),
    ('public.wardah_apply_stock_outgoing(uuid,uuid,uuid,numeric,text,uuid,text,date)', false),
    ('public.wardah_apply_stock_outgoing(uuid,uuid,uuid,numeric,text,uuid,text,date,uuid)', false),
    ('public.rpc_cancel_stock_adjustment(uuid,text)', false),
    ('public.rpc_manual_stock_movement_v2(jsonb)', false),
    ('public.rpc_post_goods_receipt(jsonb)', false),
    ('public.rpc_post_delivery_note(jsonb)', false),
    ('public.rpc_submit_stock_adjustment(uuid)', false),
    ('public.rpc_consume_reserved_materials_v2(uuid,uuid,jsonb)', false),
    ('public.release_expired_reservations(uuid)', false),
    ('public.rpc_create_mo_with_reservation(jsonb,jsonb,uuid)', false),
    ('$helper_sig', true)
), selected AS (
  SELECT * FROM targets WHERE NOT is_helper OR $include_helper
), resolved AS (
  SELECT s.signature, to_regprocedure(s.signature) AS oid
  FROM selected s
)
SELECT jsonb_build_object(
  'signature', r.signature,
  'present', p.oid IS NOT NULL,
  'definition', CASE WHEN p.oid IS NULL THEN NULL ELSE pg_get_functiondef(p.oid) END,
  'owner', CASE WHEN p.oid IS NULL THEN NULL ELSE pg_get_userbyid(p.proowner) END,
  'security_definer', p.prosecdef,
  'proconfig', to_jsonb(p.proconfig),
  'acl', CASE WHEN p.oid IS NULL THEN NULL ELSE COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'grantee', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
          'grantor', pg_get_userbyid(a.grantor),
          'privilege_type', a.privilege_type,
          'is_grantable', a.is_grantable
        )
        ORDER BY
          CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
          pg_get_userbyid(a.grantor), a.privilege_type, a.is_grantable
      )
      FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS a
    ),
    '[]'::jsonb
  ) END
)::text
FROM resolved r
LEFT JOIN pg_proc p ON p.oid = r.oid
ORDER BY r.signature;
SQL
}

assert_snapshot_present() {
  local file=$1 expected=$2 label=$3
  local rows missing
  rows=$(wc -l <"$file" | tr -d ' ')
  [[ "$rows" == "$expected" ]] \
    || fail "$label: expected $expected catalog rows, got $rows"
  missing=$(grep -c '"present": false' "$file" || true)
  [[ "$missing" == "0" ]] \
    || fail "$label: one or more required signatures are missing"
}

write_generated_rollback() {
  local out=$1
  {
    echo '-- Generated by docs/db/m191-evidence/harness/rollback_rehearsal.sh'
    echo "-- Source oracle: $PRE_DB (cutoff-189 + Migration 190)"
    echo '-- Disposable rehearsal artifact only; do not run on Production/Staging.'
    echo '\set ON_ERROR_STOP on'
    echo 'BEGIN;'
    echo "SET LOCAL lock_timeout = '30s';"
    echo "SET LOCAL statement_timeout = '10min';"
    echo
    local sig
    for sig in "${signatures[@]}"; do
      echo "-- restore $sig"
      PGDATABASE="$PRE_DB" "${PSQL[@]}" -c \
        "SELECT pg_get_functiondef('$sig'::regprocedure) || ';';" \
        || fail "could not extract predecessor definition: $sig"
      echo
    done
    # No IF EXISTS: if the helper is unexpectedly absent, rehearsal must fail.
    echo "DROP FUNCTION $helper_sig;"
    echo 'COMMIT;'
  } >"$out"
}

run_gate() {
  local file=$1 label=$2 out=$3 err=$4
  PGDATABASE="$M191_DB" psql -X -v ON_ERROR_STOP=1 -f "$file" \
    >"$out" 2>"$err" \
    || fail "$label failed; see $out / $err"
}

run_green_suite() {
  local scripts=(
    s4_core.sh
    s5_valuation.sh
    s6_prefix.sh
    s7_fixcd.sh
    s8_fixe.sh
    s8b_fixe.sh
    s82_superset.sh
    s82b.sh
    s82c1.sh
    s9_fixf.sh
    s10_fixg.sh
    s10_2probe.sh
    s10_drift.sh
  )
  local s
  for s in "${scripts[@]}"; do
    log "forward GREEN: $s"
    PGDATABASE="$M191_DB" SCRATCH="$SCRATCH" \
      bash "$SCRATCH/$s" \
      >"$RUN_DIR/forward-${s%.sh}.out" \
      2>"$RUN_DIR/forward-${s%.sh}.err" \
      || fail "forward GREEN failed: $s"
  done
}

log "preflight: databases"
check_db "$PRE_DB"
check_db "$M191_DB"

[[ "$(helper_present "$PRE_DB")" == "0" ]] \
  || fail "$PRE_DB unexpectedly contains the M191 helper"
[[ "$(helper_present "$M191_DB")" == "1" ]] \
  || fail "$M191_DB does not contain the M191 helper before rollback"

log "capture pre-191 oracle and post-M191 starting contracts"
snapshot_contract "$PRE_DB" "$RUN_DIR/pre191.contract.jsonl" false
snapshot_contract "$M191_DB" "$RUN_DIR/m191.before.contract.jsonl" true
assert_snapshot_present "$RUN_DIR/pre191.contract.jsonl" 12 'pre191 oracle'
assert_snapshot_present "$RUN_DIR/m191.before.contract.jsonl" 13 'm191 before rollback'

rollback_sql="$RUN_DIR/M191_ROLLBACK_GENERATED.sql"
write_generated_rollback "$rollback_sql"
sha256sum "$rollback_sql" >"$RUN_DIR/M191_ROLLBACK_GENERATED.sha256"

log "apply generated rollback to $M191_DB"
PGDATABASE="$M191_DB" psql -X -v ON_ERROR_STOP=1 -f "$rollback_sql" \
  >"$RUN_DIR/rollback.apply.out" 2>"$RUN_DIR/rollback.apply.err" \
  || fail "rollback SQL failed"

[[ "$(helper_present "$M191_DB")" == "0" ]] \
  || fail "new helper still exists after rollback"

snapshot_contract "$M191_DB" "$RUN_DIR/m191.after_rollback.contract.jsonl" false
assert_snapshot_present "$RUN_DIR/m191.after_rollback.contract.jsonl" 12 'rolled-back candidate'

if ! cmp -s "$RUN_DIR/pre191.contract.jsonl" "$RUN_DIR/m191.after_rollback.contract.jsonl"; then
  diff -u "$RUN_DIR/pre191.contract.jsonl" "$RUN_DIR/m191.after_rollback.contract.jsonl" \
    >"$RUN_DIR/rollback.catalog.diff" || true
  fail "rolled-back definitions/owner/security/proconfig/ACL do not match pre-191 oracle"
fi

log "rollback catalog matches pre-191 oracle exactly"

# acceptance_f2_stock_bin_race_red.sh is a CI script written for a *fresh*
# database: it inserts the fixed organization STKF2-RACE and fails on a
# duplicate code if that org is already there. The rehearsal runs it against a
# long-lived database, so its fixture org is purged first, otherwise the
# rehearsal is only ever runnable once. The org carries no gl_entries (the raw
# stock helpers post no GL), so nothing here deletes ledger history.
purge_frozen_red_fixture() {
  PGDATABASE="$M191_DB" "${PSQL[@]}" <<'SQL'
DELETE FROM public.stock_ledger_entries WHERE org_id='00002280-f2f2-0000-0000-000000000001';
DELETE FROM public.bins             WHERE org_id='00002280-f2f2-0000-0000-000000000001';
DELETE FROM public.products         WHERE org_id='00002280-f2f2-0000-0000-000000000001';
DELETE FROM public.warehouses       WHERE org_id='00002280-f2f2-0000-0000-000000000001';
DELETE FROM public.user_organizations WHERE org_id='00002280-f2f2-0000-0000-000000000001';
DELETE FROM public.audit_logs       WHERE org_id='00002280-f2f2-0000-0000-000000000001';
DELETE FROM public.organizations    WHERE id='00002280-f2f2-0000-0000-000000000001';
DELETE FROM auth.users              WHERE id='00002280-f2f2-0000-0000-000000000002';
SQL
  local left
  left=$(PGDATABASE="$M191_DB" "${PSQL[@]}" -c \
    "SELECT count(*) FROM public.gl_entries WHERE org_id='00002280-f2f2-0000-0000-000000000001'")
  [[ "$left" == "0" ]] || fail "frozen RED fixture org unexpectedly carries $left gl_entries"
}

log "purge frozen F2 RED fixture org so the proof is repeatable"
purge_frozen_red_fixture

log "rerun frozen F2 RED proof on the rolled-back candidate database"
PGDATABASE="$M191_DB" \
  bash "$ROOT/scripts/ci/fresh-db/acceptance_f2_stock_bin_race_red.sh" \
  >"$RUN_DIR/rollback.red.out" 2>"$RUN_DIR/rollback.red.err" \
  || fail "frozen F2 RED proof did not reproduce after rollback"

grep -q 'STOCK_F2_RED_PROOF_PASS' "$RUN_DIR/rollback.red.out" \
  || fail "frozen RED script exited zero but did not emit STOCK_F2_RED_PROOF_PASS"

log "forward recovery: reapply assembled M191 candidate"
PGDATABASE="$M191_DB" psql -X -v ON_ERROR_STOP=1 \
  -f "$ROOT/docs/db/M191_CANDIDATE_ASSEMBLED.sql" \
  >"$RUN_DIR/forward.apply.out" 2>"$RUN_DIR/forward.apply.err" \
  || fail "forward reapply of M191 candidate failed"

[[ "$(helper_present "$M191_DB")" == "1" ]] \
  || fail "M191 helper missing after forward recovery"

log "forward recovery: selftest + aggregate static gate"
run_gate "$ROOT/docs/db/m191-slices/12_acceptance_gate_selftest.sql" \
  'forward selftest' "$RUN_DIR/forward.selftest.out" "$RUN_DIR/forward.selftest.err"
run_gate "$ROOT/docs/db/m191-slices/12_acceptance_static_gates.sql" \
  'forward static gate' "$RUN_DIR/forward.static.out" "$RUN_DIR/forward.static.err"

log "forward recovery: aggregate GREEN runtime battery"
run_green_suite

log "forward recovery: rerun gates after the runtime battery"
run_gate "$ROOT/docs/db/m191-slices/12_acceptance_gate_selftest.sql" \
  'post-GREEN selftest' "$RUN_DIR/forward.postgreen.selftest.out" "$RUN_DIR/forward.postgreen.selftest.err"
run_gate "$ROOT/docs/db/m191-slices/12_acceptance_static_gates.sql" \
  'post-GREEN static gate' "$RUN_DIR/forward.postgreen.static.out" "$RUN_DIR/forward.postgreen.static.err"

snapshot_contract "$M191_DB" "$RUN_DIR/m191.after_forward.contract.jsonl" true
assert_snapshot_present "$RUN_DIR/m191.after_forward.contract.jsonl" 13 'm191 after forward recovery'

if ! cmp -s "$RUN_DIR/m191.before.contract.jsonl" "$RUN_DIR/m191.after_forward.contract.jsonl"; then
  diff -u "$RUN_DIR/m191.before.contract.jsonl" "$RUN_DIR/m191.after_forward.contract.jsonl" \
    >"$RUN_DIR/forward.catalog.diff" || true
  fail "forward recovery catalog does not match the original post-M191 catalog"
fi

{
  echo 'M191_ROLLBACK_REHEARSAL_PASS'
  echo "pre_db=$PRE_DB"
  echo "m191_db=$M191_DB"
  echo "rollback_sha256=$(cut -d' ' -f1 "$RUN_DIR/M191_ROLLBACK_GENERATED.sha256")"
  echo 'rollback_contract=12/12 exact definitions+owner+security+proconfig+normalized_acl'
  echo 'helper_after_rollback=absent'
  echo 'frozen_red_after_rollback=PASS'
  echo 'forward_reapply=PASS'
  echo 'forward_green_suite=PASS'
  echo 'forward_catalog=13/13 exact match to pre-rollback M191 snapshot'
} | tee "$RUN_DIR/ROLLBACK_REHEARSAL_SUMMARY.txt"
