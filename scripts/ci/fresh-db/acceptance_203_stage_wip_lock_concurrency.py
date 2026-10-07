"""Concurrency checks for the migration 203 stage-WIP lock.

The fixture is committed, then removed. A held lock on a foreign-org
manufacturing order must not make the unauthorized call wait.
"""
from __future__ import annotations

import os
import sys
import time

import psycopg

ORG_A = "20320320-1000-4000-8000-000000000001"
ORG_B = "20320320-2000-4000-8000-000000000001"
GRANTED = "20320320-0000-4000-8000-000000000003"
CROSS = "20320320-0000-4000-8000-000000000008"
STAGE_A = "20320320-4000-4000-8000-000000000001"
MO_A = "20320320-5000-4000-8000-000000000001"
MO_B = "20320320-5000-4000-8000-000000000002"


def connect(dbname: str | None = None):
    return psycopg.connect(
        host=os.environ["PGHOST"],
        port=os.environ["PGPORT"],
        user=os.environ.get("PGUSER", "postgres"),
        dbname=dbname or os.environ.get("PGDATABASE", "postgres"),
        autocommit=False,
    )


def as_user(cur, uid: str, org: str) -> None:
    cur.execute("SELECT set_config('request.jwt.claim.sub', %s, true)", (uid,))
    cur.execute(
        "SELECT set_config('request.jwt.claims', %s, true)",
        ('{"sub":"%s","role":"authenticated","org_id":"%s"}' % (uid, org),),
    )
    cur.execute("SET LOCAL ROLE authenticated")


def setup(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO public.organizations (id, name, code) VALUES
              (%s, 'WIP Lock Org A', 'W203-A'),
              (%s, 'WIP Lock Org B', 'W203-B')
            """,
            (ORG_A, ORG_B),
        )
        cur.execute(
            """
            INSERT INTO auth.users (id, email) VALUES
              (%s, 'w203-granted@example.test'),
              (%s, 'w203-cross@example.test')
            """,
            (GRANTED, CROSS),
        )
        cur.execute(
            """
            INSERT INTO public.user_organizations (user_id, org_id, role, is_active, is_org_admin) VALUES
              (%s, %s, 'user', true, false),
              (%s, %s, 'user', true, false)
            """,
            (GRANTED, ORG_A, CROSS, ORG_B),
        )
        cur.execute(
            """
            INSERT INTO public.roles (id, org_id, name, name_ar, is_active) VALUES
              ('20320320-3000-4000-8000-000000000001', %s, 'W203 Granted', 'W203', true),
              ('20320320-3000-4000-8000-000000000002', %s, 'W203 Cross', 'W203', true)
            """,
            (ORG_A, ORG_B),
        )
        cur.execute(
            """
            INSERT INTO public.role_permissions (role_id, permission_id)
            SELECT r.id, p.id
            FROM public.roles r
            CROSS JOIN public.permissions p
            WHERE r.id IN (
              '20320320-3000-4000-8000-000000000001'::uuid,
              '20320320-3000-4000-8000-000000000002'::uuid)
              AND p.permission_key = 'manufacturing.stage_costs.create'
            """
        )
        cur.execute(
            """
            INSERT INTO public.user_roles (user_id, role_id, org_id) VALUES
              (%s, '20320320-3000-4000-8000-000000000001', %s),
              (%s, '20320320-3000-4000-8000-000000000002', %s)
            """,
            (GRANTED, ORG_A, CROSS, ORG_B),
        )
        cur.execute(
            """
            INSERT INTO public.manufacturing_stages (id, org_id, code, name, order_sequence) VALUES
              (%s, %s, 'W203-A', 'Stage A', 1),
              ('20320320-4000-4000-8000-000000000002', %s, 'W203-B', 'Stage B', 1)
            """,
            (STAGE_A, ORG_A, ORG_B),
        )
        cur.execute(
            """
            INSERT INTO public.manufacturing_orders (id, org_id, order_number, quantity, status) VALUES
              (%s, %s, 'W203-MO-A', 1, 'draft'),
              (%s, %s, 'W203-MO-B', 1, 'draft')
            """,
            (MO_A, ORG_A, MO_B, ORG_B),
        )
    conn.commit()


def cleanup(conn) -> None:
    with conn.cursor() as cur:
        cur.execute("DELETE FROM public.stage_wip_log WHERE id::text LIKE '20320320-%'")
        cur.execute("DELETE FROM public.manufacturing_orders WHERE id::text LIKE '20320320-%'")
        cur.execute("DELETE FROM public.manufacturing_stages WHERE id::text LIKE '20320320-%'")
        cur.execute("DELETE FROM public.user_roles WHERE user_id::text LIKE '20320320-%'")
        cur.execute("DELETE FROM public.role_permissions WHERE role_id::text LIKE '20320320-%'")
        cur.execute("DELETE FROM public.roles WHERE id::text LIKE '20320320-%'")
        cur.execute("DELETE FROM public.user_organizations WHERE user_id::text LIKE '20320320-%'")
        cur.execute("DELETE FROM auth.users WHERE id::text LIKE '20320320-%'")
        cur.execute("DELETE FROM public.organizations WHERE id::text LIKE '20320320-%'")
    conn.commit()


def main() -> None:
    admin = connect()
    try:
        setup(admin)
        foreign_no_wait(admin)
        same_org_serialization()
        lock_order()
        print("STAGE_WIP_203_CONCURRENCY_PASS")
    finally:
        admin.rollback()
        cleanup(admin)
        admin.close()


def foreign_no_wait(admin) -> None:
    hold = connect()
    caller = connect()
    try:
        with hold.cursor() as cur:
            cur.execute("SELECT id FROM public.manufacturing_orders WHERE id = %s FOR UPDATE", (MO_B,))
        started = time.monotonic()
        with caller.cursor() as cur:
            cur.execute("SET statement_timeout = '2s'")
            as_user(cur, CROSS, ORG_B)
            try:
                cur.execute(
                    "SELECT public.wardah_lock_mo_for_stage_wip_203(%s::uuid, %s::uuid)",
                    (MO_A, ORG_B),
                )
            except psycopg.Error as exc:
                elapsed = time.monotonic() - started
                if "WIP_MO_NOT_IN_AUTHORIZED_ORG" not in str(exc):
                    raise SystemExit(f"foreign call failed differently: {exc}") from exc
                if elapsed > 1.5:
                    raise SystemExit(f"foreign call waited {elapsed:.2f}s on the other org")
            else:
                raise SystemExit("foreign call was not denied")
        print("STAGE_WIP_203_FOREIGN_LOCK_NO_WAIT_OK")
    finally:
        hold.rollback()
        caller.rollback()
        hold.close()
        caller.close()


def same_org_serialization() -> None:
    first = connect()
    second = connect()
    try:
        with first.cursor() as cur:
            as_user(cur, GRANTED, ORG_A)
            cur.execute(
                """
                INSERT INTO public.stage_wip_log (id, org_id, mo_id, stage_id, period_start, period_end)
                VALUES ('20320320-6000-4000-8000-0000000000a1', %s, %s, %s, DATE '2026-01-01', DATE '2026-01-31')
                """,
                (ORG_A, MO_A, STAGE_A),
            )
        with second.cursor() as cur:
            cur.execute("SET lock_timeout = '400ms'")
            as_user(cur, GRANTED, ORG_A)
            try:
                cur.execute(
                    """
                    INSERT INTO public.stage_wip_log (id, org_id, mo_id, stage_id, period_start, period_end)
                    VALUES ('20320320-6000-4000-8000-0000000000a2', %s, %s, %s, DATE '2026-02-01', DATE '2026-02-28')
                    """,
                    (ORG_A, MO_A, STAGE_A),
                )
            except psycopg.Error as exc:
                if exc.sqlstate != "55P03":
                    raise SystemExit(f"same-org writer was not serialized: {exc.sqlstate} {exc}") from exc
            else:
                raise SystemExit("same-org writer did not wait")
        print("STAGE_WIP_203_SAME_ORG_SERIALIZATION_OK")
    finally:
        first.rollback()
        second.rollback()
        first.close()
        second.close()


def lock_order() -> None:
    hold = connect()
    inserter = connect()
    probe = connect()
    try:
        with hold.cursor() as cur:
            cur.execute("SELECT id FROM public.manufacturing_stages WHERE id = %s FOR UPDATE", (STAGE_A,))
        with inserter.cursor() as cur:
            cur.execute("SET statement_timeout = '8s'")
            as_user(cur, GRANTED, ORG_A)
        box: dict[str, object] = {}

        def do_insert() -> None:
            try:
                with inserter.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO public.stage_wip_log (id, org_id, mo_id, stage_id, period_start, period_end)
                        VALUES ('20320320-6000-4000-8000-0000000000a3', %s, %s, %s, DATE '2026-03-01', DATE '2026-03-31')
                        """,
                        (ORG_A, MO_A, STAGE_A),
                    )
                box["ok"] = True
            except psycopg.Error as exc:
                box["error"] = exc

        import threading
        thread = threading.Thread(target=do_insert)
        thread.start()
        time.sleep(0.6)
        with probe.cursor() as cur:
            cur.execute("SET lock_timeout = '300ms'")
            try:
                cur.execute("SELECT id FROM public.manufacturing_orders WHERE id = %s FOR UPDATE", (MO_A,))
            except psycopg.Error as exc:
                if exc.sqlstate != "55P03":
                    raise SystemExit(f"MO probe failed for another reason: {exc.sqlstate} {exc}") from exc
            else:
                raise SystemExit("inserter did not hold the MO lock before the stage lock")
        hold.rollback()
        thread.join(timeout=5)
        if thread.is_alive():
            raise SystemExit("inserter did not finish after the stage lock was released")
        if "error" in box:
            raise SystemExit(f"inserter failed after the stage lock: {box['error']}")
        print("STAGE_WIP_203_LOCK_ORDER_OK")
    finally:
        hold.rollback()
        inserter.rollback()
        probe.rollback()
        hold.close()
        inserter.close()
        probe.close()


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as exc:
        print(f"STAGE_WIP_203_CONCURRENCY_FAILED {exc}", file=sys.stderr)
        raise
