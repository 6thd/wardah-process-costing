#!/usr/bin/env python3
"""Two real database sessions, isolated to run_local.sh's disposable database."""
import os
import re
import subprocess
import sys
import uuid
from pathlib import Path

db = sys.argv[1] if len(sys.argv) == 2 else ""
if not re.fullmatch(r"wardah_192_green_[0-9]+", db):
    raise SystemExit("REFUSED: expected disposable runner database")
if os.getenv("DATABASE_URL") or os.getenv("PGSERVICE") or os.getenv("SUPABASE_DB_URL"):
    raise SystemExit("REFUSED: remote connection configuration")
if os.getenv("PGHOST", "") not in ("", "localhost", "127.0.0.1") and not os.getenv("PGHOST", "").startswith("/"):
    raise SystemExit("REFUSED: nonlocal PGHOST")

base = ["psql", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-d", db]
root = Path(__file__).resolve().parents[3]
helpers = root / "docs/db/manufacturing-inventory-red-20260925/_helpers.sql"


def sql(query: str, *, success: bool = True) -> str:
    result = subprocess.run(base + ["-c", query], text=True, capture_output=True, timeout=30)
    if (result.returncode == 0) != success:
        raise AssertionError((query, result.stdout, result.stderr))
    return result.stdout.strip()


def setup(label: str, wo_status: str = "IN_PROGRESS") -> tuple[str, str, str]:
    setup_sql = f"""BEGIN;
\\i {helpers}
SELECT pg_temp.mk_mo('{label}',5,100,'in_progress','{wo_status}');
COMMIT;
"""
    result = subprocess.run(base, input=setup_sql, text=True, capture_output=True, timeout=30)
    if result.returncode:
        raise AssertionError(result.stderr)
    mo = str(uuid.UUID(re.search(
        r"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})",
        result.stdout, re.I
    ).group(1)))
    reservation = sql(f"SELECT id FROM public.material_reservations WHERE mo_id='{mo}'::uuid LIMIT 1")
    wo = sql(f"SELECT id FROM public.work_orders WHERE mo_id='{mo}'::uuid LIMIT 1")
    return mo, str(uuid.UUID(reservation)), str(uuid.UUID(wo))


uom = str(uuid.UUID(sql(
    "SELECT base_uom_id FROM public.products "
    "WHERE id='ed000000-0000-4000-8000-0000000000c1'::uuid"
)))
org = "ed000000-0000-4000-8000-000000000001"
consumer = "ed000000-0000-4000-8000-0000000000a2"
admin = "ed000000-0000-4000-8000-0000000000a1"
stage = "ed000000-0000-4000-8000-0000000000f1"
item = "ed000000-0000-4000-8000-0000000000d1"
warehouse = "ed000000-0000-4000-8000-0000000000e1"


def call(mo: str, reservation: str, wo: str, event: str) -> str:
    return f"""SELECT public.rpc_consume_material_event(
      '{mo}'::uuid,'{stage}'::uuid,'{event}'::uuid,
      jsonb_build_array(jsonb_build_object(
        'item_id','{item}'::uuid,'reservation_id','{reservation}'::uuid,
        'warehouse_id','{warehouse}'::uuid,'work_order_id','{wo}'::uuid,
        'uom_id','{uom}'::uuid,'quantity',10,'consumption_type','MANUAL'
      )));"""


def as_user(query: str, actor: str = consumer) -> str:
    return f"""SELECT set_config('request.jwt.claim.sub','{actor}',true);
SELECT set_config('request.jwt.claims',
  '{{"sub":"{actor}","role":"authenticated"}}',true);
SET LOCAL ROLE authenticated;
{query}
RESET ROLE;
"""


def race(rollback_first: bool, same_mo: bool = False) -> None:
    first = setup("GREEN-192-RACE-A-" + str(uuid.uuid4())[:8])
    second = first if same_mo else setup("GREEN-192-RACE-B-" + str(uuid.uuid4())[:8])
    event = str(uuid.uuid4())
    first_sql = ("BEGIN;\n" + as_user(call(first[0], first[1], first[2], event))
                 + "\\echo FIRST_HELD\nSELECT pg_sleep(3);\n"
                 + ("ROLLBACK;\n" if rollback_first else "COMMIT;\n"))
    proc = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, text=True, bufsize=1)
    assert proc.stdin and proc.stdout
    proc.stdin.write(first_sql)
    proc.stdin.close()
    for line in proc.stdout:
        if "FIRST_HELD" in line:
            break
    else:
        raise AssertionError("first session never held transaction")
    second_sql = ("BEGIN;\n" + as_user(call(second[0], second[1], second[2], event))
                  + "COMMIT;\n")
    waiter = subprocess.run(base, input=second_sql, text=True, capture_output=True,
                            timeout=30)
    proc.wait(timeout=30)
    if rollback_first:
        if waiter.returncode:
            raise AssertionError(("rollback waiter should succeed", waiter.stderr))
        expected = (1, 1) if same_mo else (0, 1)
    elif same_mo:
        stored = sql("SELECT result::text FROM wardah_internal.material_issue_events "
                     f"WHERE org_id='{org}'::uuid AND event_id='{event}'::uuid")
        if waiter.returncode or stored not in waiter.stdout:
            raise AssertionError(("identical waiter should replay", waiter.stdout, waiter.stderr))
        expected = (1, 1)
    else:
        if waiter.returncode == 0 or "MATERIAL_ISSUE_EVENT_CONFLICT" not in waiter.stderr:
            raise AssertionError(("changed MO must conflict", waiter.stdout, waiter.stderr))
        expected = (1, 0)
    counts = tuple(int(sql(f"SELECT count(*) FROM public.material_consumption "
                           f"WHERE mo_id='{mo}'::uuid")) for mo in (first[0], second[0]))
    receipts = int(sql(f"SELECT count(*) FROM wardah_internal.material_issue_events "
                       f"WHERE org_id='{org}'::uuid AND event_id='{event}'::uuid"))
    if counts != expected or receipts != 1:
        raise AssertionError(("unreceipted or duplicate effects", counts, receipts))


def policy_race(admin_first: bool) -> None:
    mo, reservation, wo = setup("GREEN-192-POLICY-" + str(uuid.uuid4())[:8], "READY")
    event = str(uuid.uuid4())
    allow = ("SELECT public.rpc_set_material_issue_wo_statuses("
             f"'{org}'::uuid,ARRAY['IN_PROGRESS','READY']::text[]);")
    tighten = ("SELECT public.rpc_set_material_issue_wo_statuses("
               f"'{org}'::uuid,ARRAY['IN_PROGRESS']::text[]);")
    result = subprocess.run(base, input="BEGIN;\n" + as_user(allow, admin) + "COMMIT;\n",
                            text=True, capture_output=True, timeout=30)
    if result.returncode:
        raise AssertionError(("policy setup failed", result.stderr))
    issue = call(mo, reservation, wo, event)
    first_sql = ("BEGIN;\n" + as_user(tighten, admin) if admin_first else
                 "BEGIN;\n" + as_user(issue))
    first_sql += "\\echo POLICY_FIRST_HELD\nSELECT pg_sleep(3);\nCOMMIT;\n"
    proc = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, text=True, bufsize=1)
    assert proc.stdin and proc.stdout
    proc.stdin.write(first_sql)
    proc.stdin.close()
    for line in proc.stdout:
        if "POLICY_FIRST_HELD" in line:
            break
    else:
        raise AssertionError("policy first session did not reach barrier")
    second_sql = ("BEGIN;\n" + as_user(issue) if admin_first else
                  "BEGIN;\n" + as_user(tighten, admin)) + "COMMIT;\n"
    waiter = subprocess.run(base, input=second_sql, text=True, capture_output=True,
                            timeout=30)
    proc.wait(timeout=30)
    if proc.returncode:
        raise AssertionError(("policy first transaction failed", proc.stderr.read()))
    receipt = int(sql("SELECT count(*) FROM wardah_internal.material_issue_events "
                      f"WHERE org_id='{org}'::uuid AND event_id='{event}'::uuid"))
    if admin_first:
        if waiter.returncode == 0 or "WORK_ORDER_NOT_ELIGIBLE" not in waiter.stderr or receipt:
            raise AssertionError(("waiting issue ignored tightened policy", waiter.stderr, receipt))
    elif waiter.returncode or receipt != 1:
        raise AssertionError(("waiting policy change lost issued event", waiter.stderr, receipt))
    statuses = sql("SELECT array_to_string(allowed_statuses,',') FROM "
                   f"wardah_internal.material_issue_wo_policies WHERE org_id='{org}'::uuid")
    if statuses != "IN_PROGRESS":
        raise AssertionError(("policy change not committed", statuses))


race(False)
race(True)
race(False, same_mo=True)
race(True, same_mo=True)
policy_race(admin_first=True)
policy_race(admin_first=False)
print("GREEN_192_TWO_SESSION_ACCEPTANCE")
