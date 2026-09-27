#!/usr/bin/env python3
"""Real, concurrent PostgreSQL sessions against the disposable M192 database."""

import json
import os
import re
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event

import psycopg
from psycopg.types.json import Jsonb


db = sys.argv[1] if len(sys.argv) == 2 else ""
if not re.fullmatch(r"wardah_192_green_[0-9]+", db):
    raise SystemExit("REFUSED: expected disposable runner database")
if os.getenv("DATABASE_URL") or os.getenv("PGSERVICE") or os.getenv("SUPABASE_DB_URL"):
    raise SystemExit("REFUSED: remote connection configuration")
host = os.getenv("PGHOST", "")
if host not in ("", "localhost", "127.0.0.1") and not host.startswith("/"):
    raise SystemExit("REFUSED: nonlocal PGHOST")

helpers = (Path(__file__).resolve().parents[3]
           / "docs/db/manufacturing-inventory-red-20260925/_helpers.sql").read_text()
org = uuid.UUID("ed000000-0000-4000-8000-000000000001")
consumer = uuid.UUID("ed000000-0000-4000-8000-0000000000a2")
admin = uuid.UUID("ed000000-0000-4000-8000-0000000000a1")
stage = uuid.UUID("ed000000-0000-4000-8000-0000000000f1")
item = uuid.UUID("ed000000-0000-4000-8000-0000000000d1")
warehouse = uuid.UUID("ed000000-0000-4000-8000-0000000000e1")
raw = uuid.UUID("ed000000-0000-4000-8000-0000000000c1")


def connect():
    return psycopg.connect(dbname=db, connect_timeout=10)


def one(statement, params=()):
    with connect() as conn:
        return conn.execute(statement, params).fetchone()[0]


uom = one("SELECT base_uom_id FROM public.products WHERE id=%s", (raw,))


def setup(label, wo_status="IN_PROGRESS"):
    with connect() as conn:
        conn.execute(helpers)
        mo = conn.execute(
            "SELECT pg_temp.mk_mo(%s,5,100,'in_progress',%s)",
            (label, wo_status),
        ).fetchone()[0]
    reservation = one(
        "SELECT id FROM public.material_reservations WHERE mo_id=%s LIMIT 1", (mo,)
    )
    wo = one("SELECT id FROM public.work_orders WHERE mo_id=%s LIMIT 1", (mo,))
    return mo, reservation, wo


def authenticate(conn, actor):
    conn.execute("SELECT set_config('request.jwt.claim.sub',%s,true)", (str(actor),))
    conn.execute(
        "SELECT set_config('request.jwt.claims',%s,true)",
        (json.dumps({"sub": str(actor), "role": "authenticated"}),),
    )
    conn.execute("SET LOCAL ROLE authenticated")


def issue(conn, mo, reservation, wo, event):
    payload = [{
        "item_id": str(item), "reservation_id": str(reservation),
        "warehouse_id": str(warehouse), "work_order_id": str(wo),
        "uom_id": str(uom), "quantity": 10, "consumption_type": "MANUAL",
    }]
    return conn.execute(
        "SELECT public.rpc_consume_material_event(%s,%s,%s,%s)",
        (mo, stage, event, Jsonb(payload)),
    ).fetchone()[0]


def set_policy(conn, statuses):
    return conn.execute(
        "SELECT public.rpc_set_material_issue_wo_statuses(%s,%s::text[])",
        (org, statuses),
    ).fetchone()[0]


def compete(first_job, second_job, *, rollback_first=False):
    """Hold the first transaction until the second backend waits on a lock."""
    held, release, started = Event(), Event(), Event()
    second_pid = []

    def first():
        with connect() as conn:
            outcome = first_job(conn)
            held.set()
            if not release.wait(20):
                raise AssertionError("first transaction release timed out")
            if rollback_first:
                conn.rollback()
            else:
                conn.commit()
            return outcome

    def second():
        with connect() as conn:
            second_pid.append(conn.execute("SELECT pg_backend_pid()").fetchone()[0])
            started.set()
            try:
                outcome = second_job(conn)
                conn.commit()
                return outcome, None
            except psycopg.Error as exc:
                conn.rollback()
                return None, exc.diag.message_primary

    with ThreadPoolExecutor(max_workers=2) as pool:
        first_result = pool.submit(first)
        if not held.wait(20):
            first_result.result()
            raise AssertionError("first session did not hold its transaction")
        second_result = pool.submit(second)
        if not started.wait(20):
            release.set()
            raise AssertionError("second session did not start")
        try:
            deadline = time.monotonic() + 15
            with psycopg.connect(dbname=db, connect_timeout=10, autocommit=True) as monitor:
                while time.monotonic() < deadline:
                    wait_type = monitor.execute(
                        "SELECT wait_event_type FROM pg_stat_activity WHERE pid=%s",
                        (second_pid[0],),
                    ).fetchone()
                    if wait_type and wait_type[0] == "Lock":
                        break
                    if second_result.done():
                        raise AssertionError("second session finished before the lock barrier")
                    time.sleep(0.05)
                else:
                    raise AssertionError("second session never waited on a lock")
        finally:
            release.set()
        return first_result.result(timeout=20), second_result.result(timeout=20)


def race(rollback_first, same_mo=False):
    first = setup("GREEN-192-RACE-A-" + uuid.uuid4().hex[:8])
    second = first if same_mo else setup("GREEN-192-RACE-B-" + uuid.uuid4().hex[:8])
    event = uuid.uuid4()

    def first_job(conn):
        authenticate(conn, consumer)
        return issue(conn, *first, event)

    def second_job(conn):
        authenticate(conn, consumer)
        return issue(conn, *second, event)

    original, (retry, error) = compete(
        first_job, second_job, rollback_first=rollback_first
    )
    stored = one(
        "SELECT result FROM wardah_internal.material_issue_events "
        "WHERE org_id=%s AND event_id=%s", (org, event)
    )
    if rollback_first:
        if error is not None or retry != stored:
            raise AssertionError(("waiter after rollback failed", retry, error))
        expected = (1, 1) if same_mo else (0, 1)
    elif same_mo:
        if error is not None or retry != original or retry != stored:
            raise AssertionError(("identical request did not replay", retry, error))
        expected = (1, 1)
    else:
        if error != "MATERIAL_ISSUE_EVENT_CONFLICT" or original != stored:
            raise AssertionError(("different MO did not conflict", retry, error))
        expected = (1, 0)
    counts = tuple(one(
        "SELECT count(*) FROM public.material_consumption WHERE mo_id=%s", (mo,)
    ) for mo in (first[0], second[0]))
    receipts = one(
        "SELECT count(*) FROM wardah_internal.material_issue_events "
        "WHERE org_id=%s AND event_id=%s", (org, event)
    )
    if counts != expected or receipts != 1:
        raise AssertionError(("unreceipted or duplicate effects", counts, receipts))


def policy_race(admin_first):
    mo, reservation, wo = setup(
        "GREEN-192-POLICY-" + uuid.uuid4().hex[:8], "READY"
    )
    event = uuid.uuid4()
    with connect() as conn:
        authenticate(conn, admin)
        set_policy(conn, ["IN_PROGRESS", "READY"])

    def tighten(conn):
        authenticate(conn, admin)
        return set_policy(conn, ["IN_PROGRESS"])

    def consume(conn):
        authenticate(conn, consumer)
        return issue(conn, mo, reservation, wo, event)

    _, (outcome, error) = compete(
        tighten if admin_first else consume,
        consume if admin_first else tighten,
    )
    receipts = one(
        "SELECT count(*) FROM wardah_internal.material_issue_events "
        "WHERE org_id=%s AND event_id=%s", (org, event)
    )
    if admin_first:
        if error != "WORK_ORDER_NOT_ELIGIBLE_FOR_MATERIAL_ISSUE" or receipts != 0:
            raise AssertionError(("issue ignored tightened policy", outcome, error, receipts))
    elif error is not None or receipts != 1:
        raise AssertionError(("policy update lost issued event", outcome, error, receipts))
    statuses = one(
        "SELECT allowed_statuses FROM wardah_internal.material_issue_wo_policies "
        "WHERE org_id=%s", (org,)
    )
    if statuses != ["IN_PROGRESS"]:
        raise AssertionError(("policy update not committed", statuses))


race(False)
race(True)
race(False, same_mo=True)
race(True, same_mo=True)
policy_race(admin_first=True)
policy_race(admin_first=False)
print("GREEN_192_TWO_SESSION_ACCEPTANCE")
