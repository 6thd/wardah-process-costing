#!/usr/bin/env python3
# Writes the preflight pins of Migration 205 (md5 of pg_proc.prosrc of every function 205 relies on) from a database
# built through 204, so no hash is typed by hand. Reads the bodies with psql; rewrites only the lines between the two
# markers in the migration. Run again on a fresh database through 204: the file must not change (--check).
#   psql connection from the environment (PGHOST/PGUSER/PGDATABASE ...), or --psql to prefix the command.
#   python3 scripts/ci/fresh-db/pin_205_preflight.py [--check] [--psql "docker exec -i <container> psql -U postgres -d <db>"]
import argparse
import shlex
import subprocess  # nosec B404 - fixed argv, read-only query
import sys
from pathlib import Path

MIGRATION = Path(__file__).resolve().parents[3] / "sql/migrations/205_manufacturing_cost_policy_approval_and_overhead.sql"
BEGIN, END = "    -- M205_PREFLIGHT_PINS_BEGIN\n", "    -- M205_PREFLIGHT_PINS_END\n"
SIGNATURES = [
    "public.create_role_from_template(uuid,uuid,character varying,uuid)",   # M201 body, edited by 205 section 1b
    "public.has_permission(uuid,uuid,character varying)",
    "public.wardah_is_sensitive_permission(text)",
    "public.wardah_is_org_admin(uuid)",
    "public.wardah_assert_org_member(uuid)",
    "wardah_internal.manufacturing_settings_can_update_201(uuid)",
    "wardah_internal.mfg_cost_policy_immutable_204()",
    "wardah_internal.mfg_cost_policy_org_today_204(uuid,boolean)",
    "wardah_internal.mfg_cost_policy_version_at_204(uuid,date)",
    "wardah_internal.mfg_cost_policy_can_read_204(uuid)",
    "wardah_internal.mfg_cost_policy_version_json_204(uuid,date)",
    "wardah_internal.mfg_cost_policy_compute_204(uuid,uuid,uuid,numeric,numeric,numeric)",
    "wardah_internal.pin_mo_cost_policy_204()",
    "wardah_internal.pin_mo_cost_policy_on_start_204()",
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--psql", default="psql")
    a = ap.parse_args()
    values = ",".join("('" + s + "')" for s in SIGNATURES)
    sql = ("SELECT e.sig || '|' || COALESCE(md5(p.prosrc), 'MISSING') FROM (VALUES " + values + ") AS e(sig) "
           "LEFT JOIN pg_proc p ON p.oid = to_regprocedure(e.sig) ORDER BY e.sig;")
    out = subprocess.run(shlex.split(a.psql) + ["-X", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql],  # nosec B603
                         check=True, capture_output=True, text=True).stdout
    rows = [ln.strip().split("|") for ln in out.splitlines() if ln.strip()]
    if len(rows) != len(SIGNATURES) or any(len(r) != 2 or r[1] == "MISSING" or len(r[1]) != 32 for r in rows):
        sys.exit(f"PIN_205_QUERY_UNEXPECTED: {rows}")
    lines = [f"    ('{sig}', '{md5}')" for sig, md5 in rows]
    block = BEGIN + ",\n".join(lines) + "\n" + END
    src = MIGRATION.read_text(encoding="utf-8")
    start, stop = src.index(BEGIN), src.index(END) + len(END)
    new = src[:start] + block + src[stop:]
    if a.check:
        if new != src:
            sys.exit("PIN_205_DRIFT: the pinned bodies differ from this database")
        print(f"PIN_205_CHECK_OK {len(rows)} bodies")
        return
    MIGRATION.write_bytes(new.encode("utf-8"))
    print(f"PIN_205_WRITTEN {len(rows)} bodies")


if __name__ == "__main__":
    main()
