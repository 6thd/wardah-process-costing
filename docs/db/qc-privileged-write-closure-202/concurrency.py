#!/usr/bin/env python3
"""M202 concurrency: parallel recording, replays, supersession races, marker isolation.

Usage: python3 concurrency.py <database>   (PGHOST/PGPORT/PGUSER from the environment)
The database must already contain M190..M202 and the shared manufacturing fixture.
All data written here is committed; run it on a disposable copy.
"""
import json
import os
import sys
import threading
import uuid

import psycopg

DB = sys.argv[1]
ORG = "ed000000-0000-4000-8000-000000000001"
ADMIN = "ed000000-0000-4000-8000-0000000000a1"
INSPECTOR = "ed000000-0000-4000-8000-0000000000a4"
FG = "ed000000-0000-4000-8000-0000000000c2"
ROLE_ID = "ed000000-0000-4000-8000-0000000000b4"


def connect():
    return psycopg.connect(dbname=DB, host=os.environ.get("PGHOST", "127.0.0.1"),
                           port=os.environ.get("PGPORT", "5432"),
                           user=os.environ.get("PGUSER", "postgres"), autocommit=False)


def fail(msg):
    raise SystemExit(f"M202_CONCURRENCY_FAIL: {msg}")


def check(cond, msg):
    if not cond:
        fail(msg)
    print(f"ok  {msg}")


def as_user(cur, uid):
    cur.execute("SET LOCAL ROLE authenticated")
    cur.execute("SELECT set_config('request.jwt.claim.sub', %s, true)", (uid,))
    cur.execute("SELECT set_config('request.jwt.claims', %s, true)",
                (json.dumps({"sub": uid, "role": "authenticated"}),))


def setup():
    with connect() as c, c.cursor() as cur:
        cur.execute("INSERT INTO auth.users(id,email) VALUES (%s,'qc-conc@example.test') ON CONFLICT DO NOTHING", (INSPECTOR,))
        cur.execute("INSERT INTO public.user_organizations(user_id,org_id,role,is_active,is_org_admin) VALUES (%s,%s,'user',true,false) ON CONFLICT DO NOTHING", (INSPECTOR, ORG))
        cur.execute("INSERT INTO public.roles(id,org_id,name,name_ar,is_active) VALUES (%s,%s,'QC Inspector','x',true) ON CONFLICT DO NOTHING", (ROLE_ID, ORG))
        cur.execute("INSERT INTO public.role_permissions(role_id,permission_id) SELECT %s, id FROM public.permissions WHERE permission_key IN ('manufacturing.quality_inspections.read','manufacturing.quality_inspections.create') ON CONFLICT DO NOTHING", (ROLE_ID,))
        cur.execute("INSERT INTO public.user_roles(user_id,role_id,org_id,expires_at) VALUES (%s,%s,%s,NULL) ON CONFLICT DO NOTHING", (INSPECTOR, ROLE_ID, ORG))
        cur.execute("SELECT version FROM wardah_internal.quality_policies WHERE org_id=%s", (ORG,))
        ver = cur.fetchone()[0]
        as_user(cur, ADMIN)
        cur.execute("SELECT public.rpc_set_quality_policy(%s::uuid, %s::jsonb, %s)", (ORG, json.dumps({
            "release_gate_mode": "all_orders", "inspection_scope": "final_only",
            "allow_conditional_release": False, "segregation_of_duties": True,
            "admins_subject_to_quality_controls": True}), ver))
        c.commit()


def new_mo(name):
    with connect() as c, c.cursor() as cur:
        cur.execute("INSERT INTO public.manufacturing_orders(org_id,order_number,product_id,quantity,status,created_by) VALUES (%s,%s,%s,10,'quality_check',%s) RETURNING id",
                    (ORG, name, FG, ADMIN))
        mo = cur.fetchone()[0]
        c.commit()
        return mo


def record(mo, request_id, result="PASS", uid=INSPECTOR):
    payload = {"inspection_type": "FINAL", "result": result,
               "passed_quantity": 10 if result == "PASS" else 0,
               "failed_quantity": 0 if result == "PASS" else 10}
    if result != "PASS":
        payload.update({"disposition": "scrap", "corrective_action": "reject"})
    with connect() as c, c.cursor() as cur:
        as_user(cur, uid)
        cur.execute("SELECT public.rpc_record_quality_inspection(%s::uuid,%s::uuid,%s::jsonb)",
                    (mo, request_id, json.dumps(payload)))
        out = cur.fetchone()[0]
        c.commit()
        return out


def supersede(mo, expected, reason):
    with connect() as c, c.cursor() as cur:
        as_user(cur, ADMIN)
        cur.execute("SELECT public.rpc_supersede_quality_evidence_202(%s::uuid,'FINAL',NULL,%s,%s)",
                    (mo, expected, reason))
        out = cur.fetchone()[0]
        c.commit()
        return out


def run_threads(fns):
    results, errors = [None] * len(fns), [None] * len(fns)

    def wrap(i, fn):
        try:
            results[i] = fn()
        except Exception as exc:  # noqa: BLE001 - reported by the caller
            errors[i] = str(exc)
    ts = [threading.Thread(target=wrap, args=(i, fn)) for i, fn in enumerate(fns)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    return results, errors


def q(sql, *args):
    with connect() as c, c.cursor() as cur:
        cur.execute(sql, args)
        return cur.fetchall()


setup()

# A. Parallel genuine recordings: unique contiguous numbers, linked, no marker left.
mo = new_mo("CONC-A")
res, err = run_threads([lambda: record(mo, str(uuid.uuid4())) for _ in range(16)])
check(all(e is None for e in err), f"16 parallel recordings all succeed {[e for e in err if e][:1]}")
rows = q("SELECT count(*), count(DISTINCT inspection_number), count(DISTINCT inspection_seq) FROM public.quality_inspections WHERE mo_id=%s", mo)[0]
check(rows == (16, 16, 16), f"numbers and sequences are unique under contention {rows}")
check(q("SELECT count(*) FROM wardah_internal.quality_inspection_authority_202 a JOIN public.quality_inspections i ON i.id=a.inspection_id WHERE i.mo_id=%s AND a.authority_revision=0", mo)[0][0] == 16,
      "every row carries its authority link at revision 0")
check(q("SELECT count(*) FROM wardah_internal.qc_entry_markers_202")[0][0] == 0, "no marker survives the parallel run")

# B. The same request raced by many callers: exactly one row, the rest replay.
mo_b = new_mo("CONC-B")
rid = str(uuid.uuid4())
res, err = run_threads([lambda: record(mo_b, rid) for _ in range(10)])
check(all(e is None for e in err), f"10 racing callers of one request id all return {[e for e in err if e][:1]}")
check(sum(1 for r in res if r and not r["replayed"]) == 1 and sum(1 for r in res if r and r["replayed"]) == 9,
      "exactly one writes, nine replay")
check(q("SELECT count(*) FROM public.quality_inspections WHERE mo_id=%s", mo_b)[0][0] == 1, "one row")

# C. Supersession racing recording: serialized by the MO lock; revisions stay coherent.
mo_c = new_mo("CONC-C")
record(mo_c, str(uuid.uuid4()))
revision = 0
for i in range(12):
    fns = [lambda r=revision, i=i: supersede(mo_c, r, f"race {i}")] + [lambda: record(mo_c, str(uuid.uuid4())) for _ in range(3)]
    res, err = run_threads(fns)
    check(err[0] is None, f"round {i}: supersession with the current expected revision succeeds {err[0]}")
    check(all(e is None for e in err[1:]), f"round {i}: racing recordings succeed {[e for e in err[1:] if e][:1]}")
    revision += 1
bad = q("""
  SELECT count(*) FROM public.quality_inspections i
  JOIN wardah_internal.quality_inspection_authority_202 a ON a.inspection_id = i.id
  WHERE i.mo_id = %s
    AND a.authority_revision <> (SELECT count(*) FROM wardah_internal.quality_supersessions_202 s
                                 WHERE s.mo_id = i.mo_id AND s.created_at < a.created_at)""", mo_c)[0][0]
check(bad == 0, "every recording joined exactly the revision that was current when it ran")
check(q("SELECT max(revision) FROM wardah_internal.quality_supersessions_202 WHERE mo_id=%s", mo_c)[0][0] == 12, "twelve contiguous revisions")
rel = q("SELECT wardah_internal.evaluate_quality_release_199(org_id,id,routing_id,status,NULL) FROM public.manufacturing_orders WHERE id=%s", mo_c)[0][0]
check(rel["reason"] != "QUALITY_AUTHORITY_CORRUPT" and rel["authority_revision"] == 12, "authority metadata coherent after the races")

# D. Two supersessions with the same expected revision: one wins, one conflicts.
mo_d = new_mo("CONC-D")
record(mo_d, str(uuid.uuid4()))
res, err = run_threads([lambda: supersede(mo_d, 0, "a"), lambda: supersede(mo_d, 0, "b")])
check(sum(1 for e in err if e is None) == 1 and sum(1 for e in err if e and "QUALITY_SUPERSESSION_REVISION_CONFLICT" in e) == 1,
      "of two same-revision supersessions exactly one wins")

# E. A marker written by one open transaction authorises nothing in another.
mo_e = new_mo("CONC-E")
holder = connect()
hc = holder.cursor()
hc.execute("SET LOCAL ROLE wardah_qc_entry_202")
mid, req = str(uuid.uuid4()), str(uuid.uuid4())
hc.execute("""INSERT INTO wardah_internal.qc_entry_markers_202(xid, backend_pid, org_id, mo_id, request_id, inspection_id)
              VALUES (pg_current_xact_id(), pg_backend_pid(), %s, %s, %s, %s)""", (ORG, mo_e, req, mid))
other = connect()
oc = other.cursor()
oc.execute("SET LOCAL ROLE wardah_qc_entry_202")
try:
    oc.execute("""INSERT INTO public.quality_inspections(id, org_id, mo_id, inspection_number, inspection_type,
                    passed_quantity, failed_quantity, result, qc_cycle, inspection_seq, request_id, request_hash)
                  VALUES (%s,%s,%s,'CONC-E-1','FINAL',10,0,'PASS',1,999,%s,'x')""", (mid, ORG, mo_e, req))
    fail("an INSERT in a second transaction was accepted on another transaction's marker")
except psycopg.errors.Error as exc:
    check("QC_WRITE_MARKER_REQUIRED_202" in str(exc), "a second transaction cannot reuse an open marker")
other.rollback()
holder.rollback()
check(q("SELECT count(*) FROM wardah_internal.qc_entry_markers_202")[0][0] == 0, "rolled-back markers leave nothing")
print("M202_CONCURRENCY_PASS")
