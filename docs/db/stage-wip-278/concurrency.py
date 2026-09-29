"""Two-session WIP overlap and MO→WIP lock races on disposable PG17 only."""
import concurrent.futures
import json
import os
import re
import sys
import time
import uuid

import psycopg

DB = sys.argv[1] if len(sys.argv) == 2 else ""
if not re.fullmatch(r"wardah_192_green_[0-9]+", DB) or os.getenv("DATABASE_URL"):
    raise SystemExit("REFUSED: disposable M194 database required")
if os.getenv("PGHOST", "localhost") not in ("localhost", "127.0.0.1"):
    raise SystemExit("REFUSED: local PostgreSQL required")

ORG = "ed000000-0000-4000-8000-000000000001"
STAGE = "ed000000-0000-4000-8000-0000000000f1"
ADMIN = "ed000000-0000-4000-8000-0000000000a1"
CONSUMER = "ed000000-0000-4000-8000-0000000000a2"
ITEM = "ed000000-0000-4000-8000-0000000000d1"
WAREHOUSE = "ed000000-0000-4000-8000-0000000000e1"


def connect():
    return psycopg.connect(dbname=DB, connect_timeout=5)


def act(conn, user):
    conn.execute("SELECT set_config('request.jwt.claim.sub', %s, true)", (user,))
    conn.execute("SELECT set_config('request.jwt.claims', %s, true)",
                 (json.dumps({"sub": user, "role": "authenticated"}),))
    conn.execute("SET LOCAL ROLE authenticated")


def wait_for_lock(observer, pid):
    for _ in range(200):
        row = observer.execute(
            "SELECT wait_event_type FROM pg_stat_activity WHERE pid=%s", (pid,)
        ).fetchone()
        observer.commit()
        if row and row[0] == "Lock":
            return
        time.sleep(0.05)
    raise AssertionError("GREEN_278_SECOND_SESSION_DID_NOT_WAIT_ON_LOCK")


def future_insert(conn, mo):
    conn.execute(
        """INSERT INTO public.stage_wip_log
           (org_id,mo_id,stage_id,period_start,period_end)
           VALUES (%s,%s,%s,CURRENT_DATE+65,CURRENT_DATE+72)""",
        (ORG, mo, STAGE),
    )


def issue(conn, mo, reservation, work_order, uom):
    line = {"item_id": ITEM, "reservation_id": str(reservation),
            "warehouse_id": WAREHOUSE, "work_order_id": str(work_order),
            "uom_id": str(uom), "quantity": 10, "consumption_type": "MANUAL"}
    result = conn.execute(
        "SELECT public.rpc_consume_material_event(%s,%s,%s,%s::jsonb)",
        (mo, STAGE, str(uuid.uuid4()), json.dumps([line])),
    ).fetchone()[0]
    if result.get("success") is not True:
        raise AssertionError(f"GREEN_278_ISSUE_FAILED: {result}")


with connect() as observer:
    mo = observer.execute(
        """INSERT INTO public.manufacturing_orders(org_id,order_number,quantity,status)
           VALUES (%s,'GREEN-278-RACE-INSERT',1,'draft') RETURNING id""",
        (ORG,),
    ).fetchone()[0]
    observer.commit()
    with connect() as first, connect() as second:
        act(first, ADMIN)
        act(second, ADMIN)
        future_insert(first, mo)
        pid = second.execute("SELECT pg_backend_pid()").fetchone()[0]
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(future_insert, second, mo)
            try:
                wait_for_lock(observer, pid)
            finally:
                first.commit()
            try:
                pending.result(timeout=15)
            except psycopg.Error as exc:
                if exc.sqlstate != "P0001" or "WIP_OPEN_PERIOD_OVERLAP" not in str(exc):
                    raise
                second.rollback()
            else:
                raise AssertionError("GREEN_278_CONCURRENT_OVERLAP_ACCEPTED")
    count = observer.execute(
        "SELECT count(*) FROM public.stage_wip_log WHERE mo_id=%s", (mo,)
    ).fetchone()[0]
    if count != 1:
        raise AssertionError(f"GREEN_278_OVERLAP_ROW_COUNT: {count}")
    observer.commit()
    print("GREEN_278_TWO_INSERTS_ONE_INTERVAL")

    for suffix, issue_first in (("A", True), ("B", False)):
        mo, reservation, work_order, uom = observer.execute(
            """SELECT m.id,r.id,w.id,p.base_uom_id
               FROM public.manufacturing_orders m
               JOIN public.material_reservations r ON r.mo_id=m.id
               JOIN public.work_orders w ON w.mo_id=m.id
               JOIN public.products p ON p.id='ed000000-0000-4000-8000-0000000000c1'::uuid
               WHERE m.order_number=%s LIMIT 1""",
            ("GREEN-278-RACE-ISSUE-" + suffix,),
        ).fetchone()
        observer.commit()
        with connect() as first, connect() as second:
            pid = second.execute("SELECT pg_backend_pid()").fetchone()[0]
            second.commit()
            if issue_first:
                first.execute("SELECT id FROM public.manufacturing_orders WHERE id=%s FOR UPDATE", (mo,))
                act(first, CONSUMER)
                act(second, ADMIN)
                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                    pending = pool.submit(future_insert, second, mo)
                    try:
                        wait_for_lock(observer, pid)
                        issue(first, mo, reservation, work_order, uom)
                    finally:
                        first.commit()
                    pending.result(timeout=15)
                    second.commit()
            else:
                act(first, ADMIN)
                act(second, CONSUMER)
                future_insert(first, mo)
                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                    pending = pool.submit(issue, second, mo, reservation, work_order, uom)
                    try:
                        wait_for_lock(observer, pid)
                    finally:
                        first.commit()
                    pending.result(timeout=15)
                    second.commit()
        row = observer.execute(
            """SELECT (SELECT count(*) FROM public.material_consumption WHERE mo_id=%s),
                      (SELECT count(*) FROM public.stage_wip_log WHERE mo_id=%s),
                      (SELECT sum(cost_material) FROM public.stage_wip_log WHERE mo_id=%s)""",
            (mo, mo, mo),
        ).fetchone()
        if row != (1, 2, 100):
            raise AssertionError(f"GREEN_278_ISSUE_INSERT_RACE_STATE: {row}")
        observer.commit()
        print("GREEN_278_ISSUE_INSERT_" + ("ISSUE_FIRST" if issue_first else "INSERT_FIRST"))

    # The direct labor edit holds WIP only. M192 holds MO then WIP. Either
    # ordering must complete without 40P01 and preserve both contributions.
    for suffix, issue_first in (("C", False), ("D", True)):
        mo, reservation, work_order, uom, wip = observer.execute(
            """SELECT m.id,r.id,w.id,p.base_uom_id,s.id
               FROM public.manufacturing_orders m
               JOIN public.material_reservations r ON r.mo_id=m.id
               JOIN public.work_orders w ON w.mo_id=m.id
               JOIN public.products p ON p.id='ed000000-0000-4000-8000-0000000000c1'::uuid
               JOIN public.stage_wip_log s ON s.mo_id=m.id
               WHERE m.order_number=%s LIMIT 1""",
            ("GREEN-278-RACE-WIP-" + suffix,),
        ).fetchone()
        observer.commit()

        def labor(conn):
            conn.execute(
                "UPDATE public.stage_wip_log SET cost_labor=cost_labor+1 WHERE id=%s",
                (wip,),
            )

        with connect() as first, connect() as second:
            pid = second.execute("SELECT pg_backend_pid()").fetchone()[0]
            second.commit()
            if issue_first:
                act(first, CONSUMER)
                issue(first, mo, reservation, work_order, uom)
                act(second, ADMIN)
                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                    pending = pool.submit(labor, second)
                    try:
                        wait_for_lock(observer, pid)
                    finally:
                        first.commit()
                    pending.result(timeout=15)
                    second.commit()
            else:
                act(first, ADMIN)
                labor(first)
                act(second, CONSUMER)
                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                    pending = pool.submit(issue, second, mo, reservation, work_order, uom)
                    try:
                        wait_for_lock(observer, pid)
                    finally:
                        first.commit()
                    pending.result(timeout=15)
                    second.commit()
        row = observer.execute(
            """SELECT (SELECT count(*) FROM public.material_consumption WHERE mo_id=%s),
                      (SELECT cost_material FROM public.stage_wip_log WHERE id=%s),
                      (SELECT cost_labor FROM public.stage_wip_log WHERE id=%s)""",
            (mo, wip, wip),
        ).fetchone()
        if row != (1, 100, 1):
            raise AssertionError(f"GREEN_278_ISSUE_LABOR_RACE_STATE: {row}")
        observer.commit()
        print("GREEN_278_ISSUE_LABOR_" + ("ISSUE_FIRST" if issue_first else "LABOR_FIRST"))
