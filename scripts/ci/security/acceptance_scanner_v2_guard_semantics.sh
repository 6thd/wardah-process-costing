#!/usr/bin/env bash
set -Eeuo pipefail

OUT_DIR="${TMPDIR:-/tmp}/scanner-v2-guard-semantics"
SOURCE="$OUT_DIR/custom_denial_probe.sql"
RUNTIME="$OUT_DIR/runtime.json"
BINDINGS="$OUT_DIR/bindings.json"
CONTRACT="$OUT_DIR/guard-contract.json"
GUARD="$OUT_DIR/guard.json"
mkdir -p "$OUT_DIR"

cat >"$SOURCE" <<'SQL'
CREATE OR REPLACE FUNCTION public.custom_denial_probe(p_org uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $fn$
BEGIN
  IF NOT public.wardah_is_org_member(p_org) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'denied';
  END IF;
EXCEPTION
  WHEN unique_violation THEN
    UPDATE public.scanner_v2_custom_denial_effects SET n = n + 1;
END;
$fn$;
SQL

# Build an isolated PostgreSQL 17 oracle fixture. These helpers mirror only the
# exact identities and exception semantics trusted by Slice 4; they are not
# project/Production objects.
psql -v ON_ERROR_STOP=1 <<'SQL'
DROP FUNCTION IF EXISTS public.custom_denial_probe(uuid);
DROP FUNCTION IF EXISTS public.wardah_assert_org_member(uuid);
DROP FUNCTION IF EXISTS public.wardah_assert_org_admin(uuid);
DROP FUNCTION IF EXISTS public.wardah_178_assert_permission(uuid,text);
DROP FUNCTION IF EXISTS public.wardah_is_org_member(uuid);
DROP TABLE IF EXISTS public.scanner_v2_custom_denial_effects;

CREATE TABLE public.scanner_v2_custom_denial_effects (n integer NOT NULL);
INSERT INTO public.scanner_v2_custom_denial_effects(n) VALUES (0);

CREATE FUNCTION public.wardah_assert_org_member(uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'denied';
END;
$$;

CREATE FUNCTION public.wardah_assert_org_admin(uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'denied';
END;
$$;

CREATE FUNCTION public.wardah_178_assert_permission(uuid, text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'denied';
END;
$$;

CREATE FUNCTION public.wardah_is_org_member(uuid)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT false
$$;

DO $$
DECLARE
  v_default_code text;
  v_class_caught boolean := false;
  v_unique_caught boolean := false;
BEGIN
  IF to_regprocedure('public.wardah_assert_org_member(uuid)') IS NULL
     OR to_regprocedure('public.wardah_assert_org_admin(uuid)') IS NULL
     OR to_regprocedure('public.wardah_178_assert_permission(uuid,text)') IS NULL
     OR to_regprocedure('public.wardah_is_org_member(uuid)') IS NULL THEN
    RAISE EXCEPTION 'guard helper identity oracle is incomplete';
  END IF;

  BEGIN
    RAISE EXCEPTION 'default raise_exception oracle';
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_default_code = RETURNED_SQLSTATE;
  END;
  IF v_default_code <> 'P0001' THEN
    RAISE EXCEPTION 'expected default RAISE EXCEPTION SQLSTATE P0001, got %',
      v_default_code;
  END IF;

  BEGIN
    RAISE EXCEPTION 'class oracle';
  EXCEPTION
    WHEN SQLSTATE 'P0000' THEN
      v_class_caught := true;
  END;
  IF NOT v_class_caught THEN
    RAISE EXCEPTION 'SQLSTATE P0000 did not catch default RAISE EXCEPTION';
  END IF;

  BEGIN
    BEGIN
      RAISE EXCEPTION 'unique oracle';
    EXCEPTION
      WHEN unique_violation THEN
        v_unique_caught := true;
    END;
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
  END;
  IF v_unique_caught THEN
    RAISE EXCEPTION 'unique_violation unexpectedly caught default RAISE EXCEPTION';
  END IF;
END;
$$;
SQL

# Install the exact source bytes that will be classified.
psql -v ON_ERROR_STOP=1 -f "$SOURCE"

# Runtime proof for #243: the custom 23505 denial is caught by
# unique_violation, so execution reaches the handler side effect.
psql -v ON_ERROR_STOP=1 <<'SQL'
SELECT public.custom_denial_probe(
  '00000000-0000-0000-0000-000000000001'::uuid
);
DO $$
BEGIN
  IF (SELECT n FROM public.scanner_v2_custom_denial_effects) <> 1 THEN
    RAISE EXCEPTION 'custom denial was not swallowed by unique_violation';
  END IF;
END;
$$;
SQL

python3 scripts/ci/security/scanner_v2_runtime_probe.py \
  --target 'public.custom_denial_probe(uuid)' >"$RUNTIME"

python3 scripts/ci/security/scanner_v2_discovery_binding.py \
  --source "$SOURCE" \
  --oracle-evidence "$RUNTIME" >"$BINDINGS"

python3 - "$BINDINGS" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    payload = json.load(handle)

assert payload["status"] == "RESOLVED", payload
assert payload["binding_count"] == 1, payload
binding = payload["bindings"][0]
assert binding["catalog_identity"] == "public.custom_denial_probe(uuid)", binding
assert binding["runtime_verdict"] == "OPEN", binding
PY

cat >"$CONTRACT" <<'JSON'
{
  "scanner": "wardah-scanner-v2-guard-contract-oracle-v1",
  "status": "PROVEN",
  "helper_count": 4,
  "helpers": [
    {
      "identity": "public.wardah_assert_org_member(uuid)",
      "guard_kind": "RAISING_ASSERTION"
    },
    {
      "identity": "public.wardah_assert_org_admin(uuid)",
      "guard_kind": "RAISING_ASSERTION"
    },
    {
      "identity": "public.wardah_178_assert_permission(uuid,text)",
      "guard_kind": "RAISING_ASSERTION"
    },
    {
      "identity": "public.wardah_is_org_member(uuid)",
      "guard_kind": "BOOLEAN_DENY"
    }
  ],
  "exception_semantics": {
    "raise_exception_sqlstate": "P0001",
    "raise_exception_class_sqlstate": "P0000",
    "unique_violation_catches_raise_exception": false
  }
}
JSON

python3 scripts/ci/security/scanner_v2_guard_evidence.py \
  --source "$SOURCE" \
  --bindings "$BINDINGS" \
  --guard-contract-evidence "$CONTRACT" >"$GUARD"

python3 - "$GUARD" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    payload = json.load(handle)

assert payload["scanner"] == "wardah-scanner-v2-guard-evidence-v1", payload
assert len(payload["guard_records"]) == 1, payload
record = payload["guard_records"][0]
assert record["catalog_identity"] == "public.custom_denial_probe(uuid)", record
assert record["guard_status"] == "UNKNOWN", record
assert record["guard_mechanism"] is None, record
assert record["proof_class"] is None, record
assert record["evidence_location"] is None, record
PY

echo 'SCANNER_V2_GUARD_SEMANTICS_ACCEPTANCE_PASS'
