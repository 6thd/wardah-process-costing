"""Two-session WIP overlap and MO→WIP lock races on disposable PG17 only."""
import concurrent.futures
import json
import os
import re
import sys
import time
import uuid

import psycopg
from psycopg import sql

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


def holds_row_lock(observer, table, row_id):
    """True when another backend holds a conflicting row lock (NOWAIT probe)."""
    try:
        query = sql.SQL("SELECT 1 FROM {} WHERE id=%s FOR UPDATE NOWAIT").format(
            sql.Identifier("public", table)
        )
        observer.execute(query, (row_id,))
        return False
    except psycopg.errors.LockNotAvailable:
        return True
    finally:
        observer.rollback()


def scenario_rows(observer, order_number):
    row = observer.execute(
        """SELECT m.id,r.id,w.id,p.base_uom_id,s.id
           FROM public.manufacturing_orders m
           JOIN public.material_reservations r ON r.mo_id=m.id
           JOIN public.work_orders w ON w.mo_id=m.id
           JOIN public.products p ON p.id='ed000000-0000-4000-8000-0000000000c1'::uuid
           JOIN public.stage_wip_log s ON s.mo_id=m.id
           WHERE m.order_number=%s LIMIT 1""",
        (order_number,),
    ).fetchone()
    observer.commit()
    return row


def insert_commit(conn, mo):
    conn.execute(
        """INSERT INTO public.stage_wip_log(org_id,mo_id,stage_id,period_start,period_end)
           VALUES (%s,%s,%s,CURRENT_DATE+90,CURRENT_DATE+95)""",
        (ORG, mo, STAGE),
    )
    conn.commit()


def close_wip(conn, wip):
    conn.execute("SELECT public.rpc_close_stage_wip_194(%s)", (wip,)).fetchone()


def close_commit(conn, wip):
    close_wip(conn, wip)
    conn.commit()


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

    # M192 frozen BETWEEN its MO lock and its WIP lock. The observer holds the
    # work-order row that M192 locks right after the MO, so the issue is
    # genuinely paused there (checked from the lock table, not from a sleep).
    # Everything an authorized user may do meanwhile must behave: a labor edit
    # takes no MO lock and must not wait; an INSERT and the audited close
    # queue behind the MO lock; nothing may deadlock; no cost may be lost.
    mo, reservation, work_order, uom, wip = scenario_rows(observer, "GREEN-278-RACE-PAUSE")
    with connect() as freezer, connect() as issuer, connect() as editor, \
            connect() as inserter, connect() as closer:
        freezer.execute("SELECT id FROM public.work_orders WHERE id=%s FOR UPDATE", (work_order,))
        act(issuer, CONSUMER)
        act(editor, ADMIN)
        # A labor edit that wrongly queues behind the MO lock must fail fast
        # instead of hanging the harness.
        editor.execute("SET LOCAL lock_timeout='5s'")
        act(inserter, ADMIN)
        act(closer, ADMIN)
        pids = {
            name: conn.execute("SELECT pg_backend_pid()").fetchone()[0]
            for name, conn in (("issuer", issuer), ("inserter", inserter), ("closer", closer))
        }
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            issued = pool.submit(issue, issuer, mo, reservation, work_order, uom)
            try:
                wait_for_lock(observer, pids["issuer"])
                if not holds_row_lock(observer, "manufacturing_orders", mo):
                    raise AssertionError("GREEN_278_PAUSE_ISSUE_DOES_NOT_HOLD_MO_LOCK")
                if holds_row_lock(observer, "stage_wip_log", wip):
                    raise AssertionError("GREEN_278_PAUSE_ISSUE_ALREADY_HOLDS_WIP_LOCK")
                started = time.monotonic()
                editor.execute("UPDATE public.stage_wip_log SET cost_labor=cost_labor+1 WHERE id=%s", (wip,))
                editor.commit()
                if time.monotonic() - started > 2:
                    raise AssertionError("GREEN_278_PAUSE_LABOR_EDIT_WAITED_ON_MO_LOCK")
                inserted = pool.submit(insert_commit, inserter, mo)
                closed = pool.submit(close_commit, closer, wip)
                wait_for_lock(observer, pids["inserter"])
                wait_for_lock(observer, pids["closer"])
            except BaseException:
                # The pool joins its threads on exit: release the frozen issue and
                # its MO lock first, or a failed assertion would hang the run.
                freezer.commit()
                try:
                    issued.result(timeout=20)
                finally:
                    issuer.rollback()
                raise
            freezer.commit()
            issued.result(timeout=20)
            issuer.commit()
            inserted.result(timeout=20)
            closed.result(timeout=20)
    row = observer.execute(
        """SELECT (SELECT count(*) FROM public.material_consumption WHERE mo_id=%s),
                  (SELECT cost_material FROM public.stage_wip_log WHERE id=%s),
                  (SELECT cost_labor FROM public.stage_wip_log WHERE id=%s),
                  (SELECT is_closed FROM public.stage_wip_log WHERE id=%s),
                  (SELECT count(*) FROM public.stage_wip_log WHERE mo_id=%s)""",
        (mo, wip, wip, wip, mo),
    ).fetchone()
    if row != (1, 100, 1, True, 2):
        raise AssertionError(f"GREEN_278_PAUSED_ISSUE_STATE: {row}")
    observer.commit()
    print("GREEN_278_ISSUE_PAUSED_BETWEEN_MO_AND_WIP")

    # Close first: the issue queues behind the close's MO lock and then finds
    # no open row. It must fail by name, with no stock, receipt or cost effect.
    mo, reservation, work_order, uom, wip = scenario_rows(observer, "GREEN-278-RACE-CLOSE-A")
    with connect() as closer, connect() as issuer:
        act(closer, ADMIN)
        close_wip(closer, wip)
        act(issuer, CONSUMER)
        pid = issuer.execute("SELECT pg_backend_pid()").fetchone()[0]
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(issue, issuer, mo, reservation, work_order, uom)
            try:
                wait_for_lock(observer, pid)
            finally:
                closer.commit()
            try:
                pending.result(timeout=20)
            except psycopg.Error as exc:
                if exc.sqlstate != "P0001" or "OPEN_STAGE_WIP_LOG_NOT_FOUND" not in str(exc):
                    raise
                issuer.rollback()
            else:
                raise AssertionError("GREEN_278_ISSUE_AFTER_CLOSE_ACCEPTED")
    row = observer.execute(
        """SELECT (SELECT count(*) FROM public.material_consumption WHERE mo_id=%s),
                  (SELECT count(*) FROM wardah_internal.material_issue_events WHERE mo_id=%s),
                  (SELECT cost_material FROM public.stage_wip_log WHERE id=%s),
                  (SELECT is_closed FROM public.stage_wip_log WHERE id=%s)""",
        (mo, mo, wip, wip),
    ).fetchone()
    if row != (0, 0, 0, True):
        raise AssertionError(f"GREEN_278_CLOSE_FIRST_STATE: {row}")
    observer.commit()
    print("GREEN_278_CLOSE_FIRST_ISSUE_REFUSED")

    # Issue first: the close queues behind the issue's MO lock and then closes
    # the row with the posted cost intact.
    mo, reservation, work_order, uom, wip = scenario_rows(observer, "GREEN-278-RACE-CLOSE-B")
    with connect() as issuer, connect() as closer:
        act(issuer, CONSUMER)
        issue(issuer, mo, reservation, work_order, uom)
        act(closer, ADMIN)
        pid = closer.execute("SELECT pg_backend_pid()").fetchone()[0]
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(close_commit, closer, wip)
            try:
                wait_for_lock(observer, pid)
            finally:
                issuer.commit()
            pending.result(timeout=20)
    row = observer.execute(
        """SELECT (SELECT count(*) FROM public.material_consumption WHERE mo_id=%s),
                  (SELECT cost_material FROM public.stage_wip_log WHERE id=%s),
                  (SELECT is_closed FROM public.stage_wip_log WHERE id=%s)""",
        (mo, wip, wip),
    ).fetchone()
    if row != (1, 100, True):
        raise AssertionError(f"GREEN_278_ISSUE_FIRST_CLOSE_STATE: {row}")
    observer.commit()
    print("GREEN_278_ISSUE_FIRST_CLOSE_KEEPS_COST")
