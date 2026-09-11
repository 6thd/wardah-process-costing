#!/usr/bin/env bash
# Prove the catalog-backed DEFINER guard contract can actually fail.
#
# A gate that cannot fail is worth nothing, so each assertion in
# acceptance_definer_guard_contract.sql is driven against a deliberately broken
# catalog and must reject it with its OWN error token - not merely "some error".
# The mutation is applied to the live acceptance database, the REAL contract file
# is re-run against it (no duplicated predicate that could drift from the gate it
# claims to test), and the mutation is then reverted and the contract proved
# green again, so the database this script leaves behind is the one it found.
#
# The four mutants are the catalog-side shapes of the scanner findings:
#   1. a shadow overload of a recognized guard      (overload impersonation)
#   2. a quoted mixed-case function name            (identity impersonation)
#   3. ALTER FUNCTION ... SECURITY DEFINER          (security-mode drift)
#   4. an EXECUTE grant to a client role            (privilege re-opening)
#
# Usage: PGDATABASE=... bash scripts/ci/fresh-db/selftest_definer_guard_contract.sh

set -Eeuo pipefail

CONTRACT="${CONTRACT:-scripts/ci/fresh-db/acceptance_definer_guard_contract.sql}"
PASS_TOKEN='DEFINER_GUARD_CONTRACT_PASS'
OUT="${OUT:-/tmp/definer-contract-selftest}"
mkdir -p "$OUT"

INCOMING9='public.wardah_apply_stock_incoming(uuid,uuid,uuid,numeric,numeric,text,uuid,text,date)'
HELPER='public.wardah_lock_products_for_stock_write(uuid, uuid[])'

run_contract() {   # run_contract <logfile> ; returns psql's exit code
  psql -v ON_ERROR_STOP=1 -f "$CONTRACT" >"$1" 2>&1
}

expect_pass() {    # expect_pass <label>
  local log="$OUT/$1.pass.log"
  if ! run_contract "$log"; then
    echo "❌ $1: the contract failed on an unmutated catalog"
    tail -20 "$log"
    exit 1
  fi
  grep -q "$PASS_TOKEN" "$log" || {
    echo "❌ $1: the contract exited 0 without $PASS_TOKEN"
    tail -20 "$log"
    exit 1
  }
  echo "   ✅ $1: contract green"
}

expect_fail() {    # expect_fail <label> <expected error token>
  local log="$OUT/$1.fail.log"
  if run_contract "$log"; then
    echo "❌ $1: the contract PASSED against a catalog it must reject"
    exit 1
  fi
  if ! grep -q "$2" "$log"; then
    echo "❌ $1: rejected, but not by '$2' - the mutant may be failing for an"
    echo "   unrelated reason, which would not prove this assertion at all"
    tail -20 "$log"
    exit 1
  fi
  if grep -q "$PASS_TOKEN" "$log"; then
    echo "❌ $1: the contract printed its PASS notice while failing"
    exit 1
  fi
  echo "   ✅ $1: rejected by $2"
}

mutate() { psql -v ON_ERROR_STOP=1 -q -c "$1"; }

echo "🔍 DEFINER guard contract selftest — proving each assertion can fail"

echo "0. baseline"
expect_pass baseline

echo "1. shadow overload of a recognized guard"
mutate "CREATE FUNCTION public.wardah_assert_org_member(p_org text) RETURNS void
        LANGUAGE plpgsql AS \$shadow\$ BEGIN NULL; END \$shadow\$;"
expect_fail guard_identity DEFINER_CONTRACT_GUARD_IDENTITY_BROKEN
mutate "DROP FUNCTION public.wardah_assert_org_member(text);"
expect_pass guard_identity_reverted

echo "2. quoted mixed-case function name"
mutate "CREATE FUNCTION public.\"HAS_PERMISSION\"() RETURNS void
        LANGUAGE sql AS \$twin\$ SELECT \$twin\$;"
expect_fail case_twin DEFINER_CONTRACT_MIXED_CASE_FUNCTION_NAME
mutate "DROP FUNCTION public.\"HAS_PERMISSION\"();"
expect_pass case_twin_reverted

echo "3. ALTER FUNCTION ... SECURITY DEFINER on an invoker helper"
mutate "ALTER FUNCTION $HELPER SECURITY DEFINER;"
expect_fail security_mode DEFINER_CONTRACT_SECURITY_MODE_DRIFT
mutate "ALTER FUNCTION $HELPER SECURITY INVOKER;"
expect_pass security_mode_reverted

echo "4. EXECUTE granted back to a client role"
mutate "GRANT EXECUTE ON FUNCTION $INCOMING9 TO authenticated;"
expect_fail privilege_ledger DEFINER_CONTRACT_CLIENT_SURFACE_OPEN
mutate "REVOKE EXECUTE ON FUNCTION $INCOMING9 FROM authenticated;"
expect_pass privilege_ledger_reverted

echo "✅ DEFINER_GUARD_CONTRACT_SELFTEST_PASS: 4 mutants rejected by their own assertion, catalog restored"
