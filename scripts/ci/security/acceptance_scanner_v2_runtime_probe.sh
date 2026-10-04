#!/usr/bin/env bash
set -Eeuo pipefail

TARGET='public.review_probe()'
PROBE='scripts/ci/security/scanner_v2_runtime_probe.py'
OUT_DIR="${TMPDIR:-/tmp}/scanner-v2-runtime"
mkdir -p "$OUT_DIR"

psql -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END;
$$;

DROP PROCEDURE IF EXISTS public.reopen_probe_acl_proc();
DROP FUNCTION IF EXISTS public.reopen_probe_acl_dynamic();
DROP FUNCTION IF EXISTS public.reopen_probe_acl();
DROP FUNCTION IF EXISTS public.review_probe();

CREATE FUNCTION public.review_probe()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $body$
BEGIN
  RETURN 'unguarded';
END;
$body$;
SQL

expect_open() {
  local label="$1"
  set +e
  python3 "$PROBE" --target "$TARGET" --require-client-closed \
    >"$OUT_DIR/$label.json" 2>"$OUT_DIR/$label.err"
  local rc=$?
  set -e
  if [[ "$rc" -ne 2 ]]; then
    echo "Expected open client surface for $label, got rc=$rc" >&2
    cat "$OUT_DIR/$label.json" >&2 || true
    cat "$OUT_DIR/$label.err" >&2 || true
    exit 1
  fi
  grep -q 'SCANNER_V2_CLIENT_EXECUTE_OPEN' "$OUT_DIR/$label.err"
  grep -q '"client_callable": true' "$OUT_DIR/$label.json"
}

expect_closed() {
  local label="$1"
  python3 "$PROBE" --target "$TARGET" --require-client-closed \
    >"$OUT_DIR/$label.json" 2>"$OUT_DIR/$label.err"
  grep -q '"client_callable": false' "$OUT_DIR/$label.json"
  if grep -q 'SCANNER_V2_CLIENT_EXECUTE_OPEN' "$OUT_DIR/$label.err"; then
    echo "Unexpected open client surface for $label" >&2
    exit 1
  fi
}

# Default PostgreSQL function EXECUTE is open to PUBLIC.
expect_open default_public

# Explicit closure must be visible from PostgreSQL final state.
psql -v ON_ERROR_STOP=1 <<'SQL'
REVOKE EXECUTE ON FUNCTION public.review_probe()
FROM PUBLIC, anon, authenticated;
SQL
expect_closed top_level_revoke

# Exact #243 schema-wide reopening fixture. The runtime oracle must observe
# PostgreSQL's final effective EXECUTE state rather than only exact-function
# GRANT/REVOKE text.
psql -v ON_ERROR_STOP=1 <<'SQL'
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
SQL
expect_open schema_wide_regrant

# Re-close the same schema-wide surface and prove the target is closed again.
psql -v ON_ERROR_STOP=1 <<'SQL'
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.review_probe()
FROM PUBLIC, anon, authenticated;
SQL
expect_closed schema_wide_regrant_reclosed

# I1: indirect static GRANT through top-level SELECT.
psql -v ON_ERROR_STOP=1 <<'SQL'
CREATE OR REPLACE FUNCTION public.reopen_probe_acl()
RETURNS void
LANGUAGE plpgsql
AS $helper$
BEGIN
  GRANT EXECUTE ON FUNCTION public.review_probe() TO authenticated;
END;
$helper$;
SELECT public.reopen_probe_acl();
SQL
expect_open select_static_helper

# Re-close, then I2: dynamic GRANT hidden inside helper body.
psql -v ON_ERROR_STOP=1 <<'SQL'
REVOKE EXECUTE ON FUNCTION public.review_probe()
FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.reopen_probe_acl_dynamic()
RETURNS void
LANGUAGE plpgsql
AS $helper$
BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.review_probe() TO authenticated';
END;
$helper$;
SELECT public.reopen_probe_acl_dynamic();
SQL
expect_open select_dynamic_helper

# Re-close, then I3/I5 class: CALL procedure side effect.
psql -v ON_ERROR_STOP=1 <<'SQL'
REVOKE EXECUTE ON FUNCTION public.review_probe()
FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE PROCEDURE public.reopen_probe_acl_proc()
LANGUAGE plpgsql
AS $helper$
BEGIN
  GRANT EXECUTE ON FUNCTION public.review_probe() TO authenticated;
END;
$helper$;
CALL public.reopen_probe_acl_proc();
SQL
expect_open call_procedure

# Re-close, then DO -> PERFORM helper. The probe must see the resulting ACL,
# independent of how the side effect was reached.
psql -v ON_ERROR_STOP=1 <<'SQL'
REVOKE EXECUTE ON FUNCTION public.review_probe()
FROM PUBLIC, anon, authenticated;
DO $do$
BEGIN
  PERFORM public.reopen_probe_acl();
END;
$do$;
SQL
expect_open do_perform_helper

# Recovery control: a later exact top-level closure must be reflected in final
# catalog state even after arbitrary procedural mutation.
psql -v ON_ERROR_STOP=1 <<'SQL'
REVOKE EXECUTE ON FUNCTION public.review_probe()
FROM PUBLIC, anon, authenticated;
SQL
expect_closed recovered_by_final_revoke

# Regression for the prior TSV boundary false-green. proconfig may contain
# legal tabs/newlines; those bytes must remain data inside PostgreSQL JSON and
# must not manufacture rows/columns or alter the privilege booleans.
psql -v ON_ERROR_STOP=1 <<'SQL'
GRANT EXECUTE ON FUNCTION public.review_probe() TO authenticated;
ALTER FUNCTION public.review_probe()
SET review.note TO
E'ok\tf\tt\tf\tt\tf\n999999\tpublic\tpadding\t\tpublic.padding()\tpostgres\tf\tt\t\tpadding';

DO $$
BEGIN
  IF NOT has_function_privilege('authenticated', 'public.review_probe()', 'EXECUTE') THEN
    RAISE EXCEPTION 'delimiter regression fixture did not leave authenticated EXECUTE open';
  END IF;
END;
$$;
SQL
expect_open proconfig_delimiter_regression
grep -Fq 'review.note=ok\tf\tt\tf\tt\tf\n999999\tpublic\tpadding\t\tpublic.padding()\tpostgres\tf\tt\t\tpadding' \
  "$OUT_DIR/proconfig_delimiter_regression.json"

# Control after removing the hostile setting: privilege state stays open and the
# probe must still report it open, proving the result is not fixture-specific.
psql -v ON_ERROR_STOP=1 <<'SQL'
ALTER FUNCTION public.review_probe() RESET review.note;
SQL
expect_open proconfig_reset_control

# Re-close after the transport regression so the acceptance fixture exits with
# a proven closed state rather than leaving the test database client-callable.
psql -v ON_ERROR_STOP=1 <<'SQL'
REVOKE EXECUTE ON FUNCTION public.review_probe()
FROM PUBLIC, anon, authenticated;
SQL
expect_closed final_closed_control

# Fail-hard target proof: a missing requested identity is an oracle error, not a
# clean empty result.
set +e
python3 "$PROBE" --target 'public.missing_probe()' \
  >"$OUT_DIR/missing.json" 2>"$OUT_DIR/missing.err"
missing_rc=$?
set -e
if [[ "$missing_rc" -ne 3 ]]; then
  echo "Expected fail-hard missing target rc=3, got $missing_rc" >&2
  exit 1
fi
grep -q 'SCANNER_V2_ORACLE_ERROR' "$OUT_DIR/missing.err"

echo 'SCANNER_V2_RUNTIME_PROBE_ACCEPTANCE_PASS'
