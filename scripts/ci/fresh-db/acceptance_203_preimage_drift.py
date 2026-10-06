"""Drift mutants for migration 203's M194 pre-image.

Each mutant changes the guard, then runs 203 in that same transaction.
203 must raise before creating the helper. The session is left in an aborted
transaction block, which is rolled back, so the committed catalog is unchanged.

The migration file is sent unchanged, as its original bytes, after a fixed SQL
prefix in one simple-query message (no parameters, no psql meta-commands).
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parents[3]
M203 = ROOT / "sql" / "migrations" / "203_stage_wip_mo_lock_under_m195_containment.sql"
PIN = "2068a97aea07127affa5dc6aef4d3394"
M203_BYTES = M203.read_bytes()

BODY = """
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
"""

OWNER = """
BEGIN;
CREATE ROLE stage_wip_203_drift_owner NOLOGIN;
GRANT stage_wip_203_drift_owner TO postgres WITH SET TRUE, INHERIT FALSE;
GRANT CREATE ON SCHEMA public TO stage_wip_203_drift_owner;
GRANT CREATE ON SCHEMA wardah_internal TO stage_wip_203_drift_owner;
ALTER FUNCTION wardah_internal.guard_stage_wip_write_194() OWNER TO stage_wip_203_drift_owner;
"""

TRIGGER = """
BEGIN;
DROP TRIGGER zz_guard_stage_wip_write_194 ON public.stage_wip_log;
"""


def connect():
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


def run_mutant(conn, prefix: str, label: str, expect: str) -> None:
    payload = b"".join([prefix.encode("utf-8"), b"\n", M203_BYTES])
    try:
        with conn.cursor() as cur:
            cur.execute(payload)
    except psycopg.Error as exc:
        refusal = str(exc)
        status = conn.info.transaction_status
    else:
        raise SystemExit(f"{label}: migration 203 was accepted on a drifted pre-image")
    # The refusal must happen inside the open BEGIN block, before any COMMIT.
    if status != psycopg.pq.TransactionStatus.INERROR:
        raise SystemExit(f"{label}: expected an aborted transaction block, got {status}\n{refusal}")
    conn.rollback()
    if expect not in refusal:
        raise SystemExit(f"{label}: expected refusal {expect}, got\n{refusal}")
    print(f"REFUSED|{label}|{expect}")


def main() -> None:
    with connect() as conn:
        before = snapshot(conn)
        if before[0] != PIN or before[4]:
            raise SystemExit(f"drift requires the unapplied M194 guard, got {before}")
        run_mutant(conn, BODY, "body", "STAGE_WIP_LOCK_203_PREIMAGE_REFUSED")
        if snapshot(conn) != before:
            raise SystemExit(f"body drift mutated the catalog\n{before}\n{snapshot(conn)}")
        run_mutant(conn, OWNER, "owner", "STAGE_WIP_LOCK_203_PREIMAGE_REFUSED")
        if snapshot(conn) != before:
            raise SystemExit(f"owner drift mutated the catalog\n{before}\n{snapshot(conn)}")
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM pg_roles WHERE rolname = 'stage_wip_203_drift_owner'")
            if cur.fetchone():
                raise SystemExit("owner drift left its role behind")
        run_mutant(conn, TRIGGER, "trigger", "STAGE_WIP_LOCK_203_TRIGGER_BINDING_REFUSED")
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
