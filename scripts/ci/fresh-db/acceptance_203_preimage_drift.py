"""Drift mutants for migration 203's M194 pre-image.

Each mutant changes the guard, then runs 203 in that same transaction.
203 must raise before creating the helper. psql stops on the error and the
transaction rolls back, so the committed catalog is unchanged.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
M203 = ROOT / "sql" / "migrations" / "203_stage_wip_mo_lock_under_m195_containment.sql"
PIN = "2068a97aea07127affa5dc6aef4d3394"

BODY = r"""
\set ON_ERROR_STOP on
BEGIN;
DO $drift$
DECLARE s text;
BEGIN
  SELECT prosrc INTO s FROM pg_proc
  WHERE oid = 'wardah_internal.guard_stage_wip_write_194()'::regprocedure;
  s := replace(s, 'WIP_OPEN_PERIOD_OVERLAP', 'WIP_OPEN_PERIOD_OVERLAPX');
  EXECUTE 'CREATE OR REPLACE FUNCTION wardah_internal.guard_stage_wip_write_194() '
       || 'RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER '
       || 'SET search_path = public, pg_temp AS $fn$' || s || '$fn$';
END
$drift$;
\ir :m203
"""

OWNER = r"""
\set ON_ERROR_STOP on
BEGIN;
CREATE ROLE stage_wip_203_drift_owner NOLOGIN;
GRANT stage_wip_203_drift_owner TO postgres WITH SET TRUE, INHERIT FALSE;
GRANT CREATE ON SCHEMA public TO stage_wip_203_drift_owner;
GRANT CREATE ON SCHEMA wardah_internal TO stage_wip_203_drift_owner;
ALTER FUNCTION wardah_internal.guard_stage_wip_write_194() OWNER TO stage_wip_203_drift_owner;
\ir :m203
"""

TRIGGER = r"""
\set ON_ERROR_STOP on
BEGIN;
DROP TRIGGER zz_guard_stage_wip_write_194 ON public.stage_wip_log;
\ir :m203
"""


def connect():
    import psycopg
    return psycopg.connect(
        host=os.environ["PGHOST"],
        port=os.environ["PGPORT"],
        user=os.environ.get("PGUSER", "postgres"),
        dbname=os.environ.get("PGDATABASE", "postgres"),
        autocommit=True,
    )


def snapshot(conn) -> tuple:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT md5(p.prosrc), p.xmin::text, pg_get_userbyid(p.proowner),
                   (SELECT count(*) FROM pg_trigger t
                    WHERE NOT t.tgisinternal AND t.tgname = 'zz_guard_stage_wip_write_194'),
                   to_regprocedure('public.wardah_lock_mo_for_stage_wip_203(uuid,uuid)') IS NOT NULL
            FROM pg_proc p
            WHERE p.oid = 'wardah_internal.guard_stage_wip_write_194()'::regprocedure
            """
        )
        row = cur.fetchone()
        if row is None:
            raise SystemExit("M194 guard is missing")
        return row


def run_mutant(sql: str, label: str, expect: str) -> None:
    path = Path(os.environ.get("WARDAH_DRIFT_DIR", "/tmp")) / f"acceptance_203_drift_{label}.sql"
    path.write_text(sql, encoding="utf-8", newline="\n")
    result = subprocess.run(
        ["psql", "-X", "-v", "ON_ERROR_STOP=1", "-v", f"m203={M203}", "-f", str(path)],
        env=os.environ.copy(),
        text=True,
        capture_output=True,
        check=False,
    )
    output = (result.stdout or "") + (result.stderr or "")
    if result.returncode == 0 or expect not in output:
        raise SystemExit(f"{label}: expected refusal {expect}, got {result.returncode}\n{output}")
    if "COMMIT" in output and "STAGE_WIP_LOCK_203" not in output:
        raise SystemExit(f"{label}: migration may have committed\n{output}")
    print(f"REFUSED|{label}|{expect}")


def main() -> None:
    with connect() as conn:
        before = snapshot(conn)
        if before[0] != PIN or before[4]:
            raise SystemExit(f"drift requires the unapplied M194 guard, got {before}")
        run_mutant(BODY, "body", "STAGE_WIP_LOCK_203_PREIMAGE_REFUSED")
        if snapshot(conn) != before:
            raise SystemExit(f"body drift mutated the catalog\n{before}\n{snapshot(conn)}")
        run_mutant(OWNER, "owner", "STAGE_WIP_LOCK_203_PREIMAGE_REFUSED")
        if snapshot(conn) != before:
            raise SystemExit(f"owner drift mutated the catalog\n{before}\n{snapshot(conn)}")
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM pg_roles WHERE rolname = 'stage_wip_203_drift_owner'")
            if cur.fetchone():
                raise SystemExit("owner drift left its role behind")
        run_mutant(TRIGGER, "trigger", "STAGE_WIP_LOCK_203_TRIGGER_BINDING_REFUSED")
        if snapshot(conn) != before:
            raise SystemExit(f"trigger drift mutated the catalog\n{before}\n{snapshot(conn)}")
        print("STAGE_WIP_203_PREIMAGE_DRIFT_PASS")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as exc:
        print(f"STAGE_WIP_203_PREIMAGE_DRIFT_FAILED {exc}", file=sys.stderr)
        raise
