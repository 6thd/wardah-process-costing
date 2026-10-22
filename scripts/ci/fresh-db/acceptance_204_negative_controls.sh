#!/bin/bash
# Negative controls for the Migration 204 acceptance: each control applies a
# deliberately broken copy of 204 to a fresh copy of the pre-204 database and
# requires the acceptance to FAIL at the named check. A control whose mutation
# does not apply (the source text moved) aborts the run instead of passing.
#
# Usage: PRE_DB=<database through 203> bash acceptance_204_negative_controls.sh
set -Eeuo pipefail

PRE_DB="${PRE_DB:?PRE_DB must name a database built through 203}"
MIGRATION="sql/migrations/204_manufacturing_cost_policies.sql"
ACCEPTANCE="scripts/ci/fresh-db/acceptance_204_manufacturing_cost_policies.sql"
PSQL=(psql -X -v ON_ERROR_STOP=1 -q)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

run_control() {
  local name="$1" expect="$2" from="$3" to="$4"
  local db="cp204_nc_${name}"
  # Literal (not regex) replacement of exactly one occurrence.
  OLD="$from" NEW="$to" perl -0777 -ne '
    my ($old, $new) = ($ENV{OLD}, $ENV{NEW});
    my $count = () = /\Q$old\E/g;
    die "CONTROL_MUTATION_NOT_APPLIED: found $count occurrences\n" unless $count == 1;
    my $at = index($_, $old);
    substr($_, $at, length($old)) = $new;
    print;
  ' "$MIGRATION" >"$work/$name.sql"
  dropdb --if-exists "$db"
  createdb -T "$PRE_DB" "$db"
  "${PSQL[@]}" --single-transaction -d "$db" -f "$work/$name.sql"
  if "${PSQL[@]}" -d "$db" -f "$ACCEPTANCE" >"$work/$name.out" 2>&1; then
    echo "CONTROL_NOT_CAUGHT: $name"
    exit 1
  fi
  if ! grep -q -- "$expect" "$work/$name.out"; then
    echo "CONTROL_FAILED_ELSEWHERE: $name (wanted $expect)"
    grep -E 'ERROR' "$work/$name.out" | head -3
    exit 1
  fi
  dropdb "$db"
  echo "CONTROL_CAUGHT: $name -> $expect"
}

# Exclusion ignored: a pool excluded at a work center is absorbed anyway.
run_control exclusion_ignored 'CP204_COMPUTE_WC_B' \
  'IF v_pool.applies IS FALSE THEN' 'IF false THEN'
# Missing driver treated as zero instead of refused.
run_control missing_driver_zero 'machine hours missing' \
  "v_driver := CASE v_pool.basis WHEN 'labor_hours' THEN p_labor_hours ELSE p_machine_hours END;" \
  "v_driver := COALESCE(CASE v_pool.basis WHEN 'labor_hours' THEN p_labor_hours ELSE p_machine_hours END, 0);"
# Work-center override ignored.
run_control override_ignored 'CP204_COMPUTE_WC_A' \
  'v_rate := COALESCE(v_pool.rule_rate, v_pool.pool_rate);' 'v_rate := v_pool.pool_rate;'
# Retroactive versions allowed.
run_control retroactive_allowed 'past date' \
  'IF v_effective < v_today THEN' 'IF false THEN'
# Replay with a changed payload accepted as if it were the same request.
run_control replay_payload_unchecked 'same key other payload' \
  'IF v_existing.payload_hash <> v_hash THEN' 'IF false THEN'
# Reader may write: the M201 update guard replaced by the read check.
run_control reader_writes 'reader create' \
  "  PERFORM public.wardah_assert_org_member(p_org_id);
  IF NOT wardah_internal.manufacturing_settings_can_update_201(p_org_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MANUFACTURING_SETTINGS_UPDATE_DENIED';
  END IF;
  IF p_idempotency_key IS NULL THEN" \
  "  PERFORM public.wardah_assert_org_member(p_org_id);
  IF NOT wardah_internal.mfg_cost_policy_can_read_204(p_org_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'MANUFACTURING_SETTINGS_UPDATE_DENIED';
  END IF;
  IF p_idempotency_key IS NULL THEN"
# Pinned version may be withdrawn.
run_control pinned_withdrawable 'withdraw pinned' \
  'IF EXISTS (SELECT 1 FROM wardah_internal.mo_cost_policy_pins' 'IF false AND EXISTS (SELECT 1 FROM wardah_internal.mo_cost_policy_pins'
# Rows editable after creation.
run_control mutable_rows 'update pool' \
  "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'COST_POLICY_IMMUTABLE';
  END IF;
  IF TG_TABLE_NAME" \
  "    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'COST_POLICY_IMMUTABLE';
  END IF;
  RETURN NEW;
  IF TG_TABLE_NAME"

echo "CP204_NEGATIVE_CONTROLS_PASS"
