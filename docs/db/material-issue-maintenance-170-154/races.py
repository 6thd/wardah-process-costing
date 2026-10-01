"""Disposable local PG17 only. Assert real blockers, not elapsed-time guesses."""
import concurrent.futures
import os
import time
import uuid

import psycopg
from psycopg.types.json import Jsonb

if (os.environ.get("PGHOST") != "127.0.0.1"
        or int(os.environ.get("PGPORT", "0")) < 55000
        or not os.environ.get("PGDATABASE", "").startswith("wardah_issue_maintenance_")
        or any(os.environ.get(k) for k in ("DATABASE_URL", "PGSERVICE", "SUPABASE_DB_URL"))):
    raise SystemExit("REFUSED_NON_DISPOSABLE_DATABASE")

ORG = "ed000000-0000-4000-8000-000000000001"
ACTOR = "ed000000-0000-4000-8000-0000000000a2"
RAW = "ed000000-0000-4000-8000-0000000000c1"
ITEM = "ed000000-0000-4000-8000-0000000000d1"
STAGE = "ed000000-0000-4000-8000-0000000000f1"
WAREHOUSE = "ed000000-0000-4000-8000-0000000000e1"


def connection(actor=False):
    conn = psycopg.connect("")
    conn.execute("SET statement_timeout='10s'")
    if actor:
        conn.execute("SELECT set_config('request.jwt.claim.sub',%s,false)", (ACTOR,))
        conn.execute("SET ROLE authenticated")
    return conn


def maintenance(conn, command, event=None):
    return conn.execute("SELECT public.rpc_manage_material_issue_setup(%s,%s,%s,%s)",
                        (ORG, event or uuid.uuid4(), Jsonb(command), ACTOR)).fetchone()[0]


with connection() as observer:
    observer.execute("""INSERT INTO public.role_permissions(role_id,permission_id)
      SELECT 'ed000000-0000-4000-8000-0000000000b1',id FROM public.permissions
      WHERE permission_key IN ('manufacturing.material_reservation.reserve',
       'manufacturing.material_reservation.release','manufacturing.material_issue_setup.prepare')
      ON CONFLICT DO NOTHING""")
    mo = str(observer.execute("SELECT v FROM wardah_internal.issue_scope_test_ids WHERE k='mo'").fetchone()[0])
    mo2 = str(observer.execute("SELECT v FROM wardah_internal.issue_scope_test_ids WHERE k='mo2'").fetchone()[0])
    uom = str(observer.execute("SELECT base_uom_id FROM public.products WHERE id=%s", (RAW,)).fetchone()[0])
    res, version = observer.execute("SELECT id,maintenance_version FROM public.material_reservations WHERE mo_id=%s", (mo,)).fetchone()
    wo = str(observer.execute("SELECT id FROM public.work_orders WHERE mo_id=%s", (mo,)).fetchone()[0])


def issue(conn, event):
    line = dict(item_id=ITEM, reservation_id=str(res), warehouse_id=WAREHOUSE,
                work_order_id=wo, uom_id=uom, quantity=10, consumption_type="MANUAL")
    return conn.execute("SELECT public.rpc_consume_material_event(%s,%s,%s,%s)",
                        (mo, STAGE, event, Jsonb([line]))).fetchone()[0]


def blocked(observer, waiting_pid, owner_pid):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if observer.execute("SELECT %s=ANY(pg_blocking_pids(%s))", (owner_pid, waiting_pid)).fetchone()[0]:
            return
        time.sleep(0.02)
    raise AssertionError("EXPECTED_DATABASE_BLOCKER_NOT_OBSERVED")


def race(first, second, commit, expected_error=None):
    with connection() as a, connection(True) as b, connection() as observer:
        a.execute("SELECT id FROM public.manufacturing_orders WHERE id=%s FOR UPDATE", (mo,))
        a.execute("SELECT set_config('request.jwt.claim.sub',%s,false)", (ACTOR,))
        a.execute("SET ROLE authenticated")
        first(a)
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(second, b)
            blocked(observer, b.info.backend_pid, a.info.backend_pid)
            a.commit() if commit else a.rollback()
            try:
                result = future.result(timeout=8)
            except psycopg.Error as error:
                b.rollback()
                assert expected_error == (error.sqlstate, error.diag.message_primary), (error.sqlstate, str(error))
                result = None
            else:
                assert expected_error is None, "EXPECTED_DENIAL_DID_NOT_HAPPEN"
                b.commit()
            return result


# Committed consumption changes the reservation version; stale release cannot win.
event = uuid.uuid4()
release = dict(operation="release_reservation", mo_id=mo, reservation_id=str(res),
               quantity=10, expected_version=version)
race(lambda c: issue(c, event), lambda c: maintenance(c, release), True,
     ("40001", "ISSUE_SETUP_STALE_VERSION"))
with connection() as c:
    consumed, released, version = c.execute("SELECT quantity_consumed,quantity_released,maintenance_version FROM public.material_reservations WHERE id=%s", (res,)).fetchone()
    assert (consumed, released) == (10, 0)
    assert c.execute("SELECT count(*) FROM wardah_internal.material_issue_events WHERE mo_id=%s", (mo,)).fetchone()[0] == 1
print("COMMITTED_M192_STALE_RELEASE_PASS")

# Rolled-back consumption leaves the old version valid for release.
release["expected_version"] = version
race(lambda c: issue(c, uuid.uuid4()), lambda c: maintenance(c, release), False)
with connection() as c:
    assert c.execute("SELECT quantity_consumed,quantity_released FROM public.material_reservations WHERE id=%s", (res,)).fetchone() == (10, 10)
print("ROLLED_BACK_M192_RELEASE_PASS")

# Maintenance and M192 share the parent prefix in both directions.
reserve = dict(operation="reserve", mo_id=mo, item_id=ITEM, uom_id=uom, quantity=5)
race(lambda c: maintenance(c, reserve), lambda c: issue(c, uuid.uuid4()), True)
race(lambda c: issue(c, uuid.uuid4()), lambda c: maintenance(c, reserve), False)
print("RESERVE_M192_BOTH_DIRECTIONS_PASS")

# A committed eligibility change blocks a new issue; rollback preserves eligibility.
with connection() as c:
    wo_version = c.execute("SELECT maintenance_version FROM public.work_orders WHERE id=%s", (wo,)).fetchone()[0]
hold = dict(operation="set_work_order_status", mo_id=mo, work_order_id=wo,
            status="ON_HOLD", expected_version=wo_version)
race(lambda c: maintenance(c, hold), lambda c: issue(c, uuid.uuid4()), False)
race(lambda c: maintenance(c, hold), lambda c: issue(c, uuid.uuid4()), True,
     ("P0001", "WORK_ORDER_NOT_ELIGIBLE_FOR_MATERIAL_ISSUE"))
print("WO_ELIGIBILITY_M192_COMMIT_ROLLBACK_PASS")

# Two posts for the same setup event must return one receipt and one reservation.
setup_event = uuid.uuid4()
with connection(True) as a, connection(True) as b, connection() as observer:
    one = maintenance(a, reserve, setup_event)
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(maintenance, b, reserve, setup_event)
        blocked(observer, b.info.backend_pid, a.info.backend_pid)
        a.commit()
        two = future.result(timeout=8)
        b.commit()
    assert one == two
    assert observer.execute("SELECT count(*) FROM public.material_reservations WHERE id=%s", (one["entity"]["id"],)).fetchone()[0] == 1
print("CONCURRENT_SETUP_EVENT_REPLAY_PASS")

# Across different MOs, the shared product prefix prevents oversubscription.
with connection(True) as a, connection(True) as b, connection() as observer:
    available = observer.execute("""SELECT
      (SELECT sum(actual_qty-COALESCE(reserved_qty,0)) FROM public.bins WHERE org_id=%s AND product_id=%s)
      -(SELECT COALESCE(sum(quantity_reserved-COALESCE(quantity_consumed,0)-COALESCE(quantity_released,0)),0)
        FROM public.material_reservations WHERE org_id=%s AND product_id=%s AND status='reserved')""", (ORG, RAW, ORG, RAW)).fetchone()[0]
    command = reserve | {"quantity": float(available)}
    maintenance(a, command)
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(maintenance, b, reserve | {"mo_id": mo2, "quantity": 1})
        blocked(observer, b.info.backend_pid, a.info.backend_pid)
        a.commit()
        try:
            future.result(timeout=8)
            raise AssertionError("OVERSUBSCRIPTION_WAS_ALLOWED")
        except psycopg.Error as error:
            assert (error.sqlstate, error.diag.message_primary) == ("P0001", "INSUFFICIENT_STOCK")
            b.rollback()
print("CROSS_MO_STOCK_RESERVATION_PASS")
