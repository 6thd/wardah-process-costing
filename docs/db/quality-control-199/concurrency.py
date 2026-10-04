#!/usr/bin/env python3
"""M199 two-session races on a disposable PG17 database (fixture committed).

1. Two inspectors record FINAL inspections for two different orders at the
   same instant: both succeed with distinct consecutive numbers.
2. The same request id is submitted from two sessions at the same instant:
   exactly one row is written and the other call replays it.
3. A completion and a failing FINAL inspection race on one order: the outcome
   is one of the two serial orders, never a release by a stale PASS.
"""
import sys
import threading
import uuid

import psycopg

DB = sys.argv[1]
ORG = "ed000000-0000-4000-8000-000000000001"
ADMIN = "ed000000-0000-4000-8000-0000000000a1"
INSPECTOR = "ed000000-0000-4000-8000-0000000000c9"
FG = "ed000000-0000-4000-8000-0000000000c2"


def connect():
    return psycopg.connect(dbname=DB, autocommit=False)


def as_user(cur, uid):
    cur.execute("SELECT set_config('request.jwt.claim.sub', %s, true)", (uid,))
    cur.execute(
        "SELECT set_config('request.jwt.claims', json_build_object('sub', %s::text, 'role', 'authenticated')::text, true)",
        (uid,),
    )
    cur.execute("SET LOCAL ROLE authenticated")


def setup():
    with connect() as conn, conn.cursor() as cur:
        cur.execute("INSERT INTO auth.users(id, email) VALUES (%s, 'qc-race@example.test') ON CONFLICT DO NOTHING", (INSPECTOR,))
        cur.execute(
            "INSERT INTO public.user_organizations(user_id, org_id, role, is_active, is_org_admin) "
            "VALUES (%s, %s, 'user', true, false) ON CONFLICT DO NOTHING", (INSPECTOR, ORG))
        role = str(uuid.uuid4())
        cur.execute("INSERT INTO public.roles(id, org_id, name, name_ar, is_active) VALUES (%s, %s, %s, 'سباق', true)",
                    (role, ORG, "QC race " + role[:8]))
        cur.execute("INSERT INTO public.role_permissions(role_id, permission_id) SELECT %s, id FROM public.permissions "
                    "WHERE permission_key LIKE 'manufacturing.quality_inspections.%%'", (role,))
        cur.execute("INSERT INTO public.user_roles(user_id, role_id, org_id) VALUES (%s, %s, %s)", (INSPECTOR, role, ORG))
        cur.execute("UPDATE wardah_internal.quality_policies SET release_gate_mode = 'all_orders' WHERE org_id = %s", (ORG,))
        mos = []
        for n in range(3):
            cur.execute(
                "INSERT INTO public.manufacturing_orders(org_id, order_number, product_id, quantity, status, created_by) "
                "VALUES (%s, %s, %s, 10, 'in_progress', %s) RETURNING id",
                (ORG, f"QC-RACE-{uuid.uuid4().hex[:8]}", FG, ADMIN))
            mo = cur.fetchone()[0]
            cur.execute("UPDATE public.manufacturing_orders SET status = 'quality_check' WHERE id = %s", (mo,))
            mos.append(str(mo))
        conn.commit()
        return mos


def final_payload(result="PASS", passed=10, failed=0, disposition=None, corrective=None):
    import json
    body = {"inspection_type": "FINAL", "result": result, "passed_quantity": passed, "failed_quantity": failed}
    if disposition:
        body["disposition"] = disposition
    if corrective:
        body["corrective_action"] = corrective
    return json.dumps(body)


def race(calls):
    """Open every transaction, hold it at a barrier, then fire all calls."""
    barrier = threading.Barrier(len(calls))
    results = [None] * len(calls)

    def run(i, fn):
        conn = connect()
        try:
            with conn.cursor() as cur:
                barrier.wait()
                results[i] = ("ok", fn(cur))
            conn.commit()
        except Exception as exc:  # noqa: BLE001 - recorded and asserted below
            conn.rollback()
            results[i] = ("error", str(exc).splitlines()[0])
        finally:
            conn.close()

    threads = [threading.Thread(target=run, args=(i, fn)) for i, fn in enumerate(calls)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return results


def record(mo, request_id, payload):
    def fn(cur):
        as_user(cur, INSPECTOR)
        cur.execute("SELECT public.rpc_record_quality_inspection(%s, %s, %s::jsonb)", (mo, request_id, payload))
        return cur.fetchone()[0]
    return fn


def complete(mo):
    def fn(cur):
        cur.execute("SELECT set_config('request.jwt.claim.sub', %s, true)", (ADMIN,))
        cur.execute(
            "SELECT public.rpc_complete_manufacturing_order(jsonb_build_object('mo_id', %s::text, "
            "'tenant_id', %s::text, 'completed_quantity', 10, 'allow_zero_cost', 'true'))", (mo, ORG))
        return cur.fetchone()[0]
    return fn


def check(cond, label):
    if not cond:
        raise SystemExit(f"M199_CONCURRENCY_FAIL: {label}")
    print(f"ok  {label}")


def main():
    mo_a, mo_b, mo_c = setup()

    out = race([record(mo_a, str(uuid.uuid4()), final_payload()),
                record(mo_b, str(uuid.uuid4()), final_payload())])
    check(all(r[0] == "ok" for r in out), f"parallel inspections both succeed: {out}")
    numbers = sorted(r[1]["inspection_number"] for r in out)
    check(numbers[0] != numbers[1], f"distinct inspection numbers {numbers}")

    req = str(uuid.uuid4())
    out = race([record(mo_c, req, final_payload()), record(mo_c, req, final_payload())])
    check(all(r[0] == "ok" for r in out), f"same request twice: both calls answer {out}")
    check(sorted(r[1]["replayed"] for r in out) == [False, True], "exactly one write, one replay")
    with connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM public.quality_inspections WHERE request_id = %s", (req,))
        check(cur.fetchone()[0] == 1, "one row for the request id")

    # mo_a holds a PASS. Race a FAIL against completion: either the completion
    # wins (released by the PASS) or the FAIL wins and completion is blocked.
    out = race([record(mo_a, str(uuid.uuid4()),
                       final_payload("FAIL", 0, 10, "scrap", "contamination found")),
                complete(mo_a)])
    with connect() as conn, conn.cursor() as cur:
        cur.execute("SELECT status FROM public.manufacturing_orders WHERE id = %s", (mo_a,))
        status = cur.fetchone()[0]
    fail_ok, done_ok = out[0][0] == "ok", out[1][0] == "ok"
    serial_complete_first = done_ok and status == "done" and not fail_ok
    serial_fail_first = fail_ok and not done_ok and status == "quality_check" \
        and "QUALITY_RELEASE_REJECTED" in out[1][1]
    check(serial_complete_first or serial_fail_first, f"FAIL vs completion is serial: {out} status={status}")
    print("M199_CONCURRENCY_PASS")


if __name__ == "__main__":
    main()
