"""Show that function EXECUTE revocation is not an in-flight drain. Local clone only."""

import os
import re
import sys
import threading
import time
import uuid

import psycopg
from psycopg import sql

SOURCE = sys.argv[1]
if not re.fullmatch(r"wardah_qc_privileged_199_[0-9]+", SOURCE):
    raise SystemExit("REFUSED: unexpected disposable database")
if os.environ.get("PGHOST") != "127.0.0.1" or not re.fullmatch(
    r"[0-9]{5}", os.environ.get("PGPORT", "")
):
    raise SystemExit("REFUSED: connection is not explicit loopback")
if not 55000 <= int(os.environ["PGPORT"]) <= 65535:
    raise SystemExit("REFUSED: disposable port bound")
if any(
    os.environ.get(name)
    for name in (
        "DATABASE_URL",
        "SUPABASE_DB_URL",
        "PGHOSTADDR",
        "PGSERVICE",
        "PGSERVICEFILE",
        "PGOPTIONS",
    )
):
    raise SystemExit("REFUSED: alternate connection configuration")

ORG = "ed000000-0000-4000-8000-000000000001"
ACTOR = "ed000000-0000-4000-8000-0000000000a8"
ROLE = "ed000000-0000-4000-8000-0000000000b8"
ADMIN = "ed000000-0000-4000-8000-0000000000a1"
FG = "ed000000-0000-4000-8000-0000000000c2"
MO = str(uuid.uuid4())
CLONE = f"wardah_qc_privileged_199_pause_{os.getpid()}"
CALL = "SELECT public.rpc_record_quality_inspection(%s::uuid,%s::uuid,%s::jsonb)"
PAYLOAD = '{"inspection_type":"FINAL","result":"PASS","passed_quantity":10,"failed_quantity":0}'
SNAPSHOT = """SELECT jsonb_build_object(
 'inspections',(SELECT COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.id),'[]') FROM public.quality_inspections q),
 'policy',(SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.org_id),'[]') FROM wardah_internal.quality_policies p),
 'rpc_acl',(SELECT proacl::text FROM pg_proc WHERE oid='public.rpc_record_quality_inspection(uuid,uuid,jsonb)'::regprocedure))"""


def connect(db, autocommit=False):
    return psycopg.connect(
        host="127.0.0.1",
        port=int(os.environ["PGPORT"]),
        dbname=db,
        autocommit=autocommit,
        connect_timeout=5,
    )


def as_actor(conn):
    conn.execute("SET LOCAL ROLE authenticated")
    conn.execute("SELECT set_config('request.jwt.claim.sub',%s,true)", (ACTOR,))
    conn.execute(
        "SELECT set_config('request.jwt.claims',%s,true)",
        (f'{{"sub":"{ACTOR}","role":"authenticated"}}',),
    )
    conn.execute("SET LOCAL statement_timeout='15s'")


result = []
errors = []
ready = threading.Event()
worker_pid = []


def writer():
    try:
        with connect(CLONE) as conn:
            worker_pid.append(conn.execute("SELECT pg_backend_pid()").fetchone()[0])
            as_actor(conn)
            ready.set()
            result.append(
                conn.execute(CALL, (MO, str(uuid.uuid4()), PAYLOAD)).fetchone()[0]
            )
    except psycopg.Error as exc:  # surface database worker errors to the main test
        errors.append(exc)
        ready.set()


with connect("postgres", True) as admin:
    with connect(SOURCE, True) as source:
        before = source.execute(SNAPSHOT).fetchone()[0]
    admin.execute(
        sql.Composed(
            [
                sql.SQL("CREATE DATABASE "),
                sql.Identifier(CLONE),
                sql.SQL(" TEMPLATE "),
                sql.Identifier(SOURCE),
            ]
        )
    )
    try:
        with connect(CLONE) as seed:
            seed.execute(
                "INSERT INTO auth.users(id,email) VALUES(%s,%s)",
                (ACTOR, "pause-test@example.test"),
            )
            seed.execute(
                "INSERT INTO public.user_organizations(user_id,org_id,role,is_active,is_org_admin) VALUES(%s,%s,'user',true,false)",
                (ACTOR, ORG),
            )
            seed.execute(
                "INSERT INTO public.roles(id,org_id,name,name_ar,is_active) VALUES(%s,%s,'Pause QC inspector','Pause QC inspector',true)",
                (ROLE, ORG),
            )
            seed.execute(
                "INSERT INTO public.role_permissions(role_id,permission_id) SELECT %s,id FROM public.permissions WHERE permission_key='manufacturing.quality_inspections.create'",
                (ROLE,),
            )
            seed.execute(
                "INSERT INTO public.user_roles(user_id,role_id,org_id) VALUES(%s,%s,%s)",
                (ACTOR, ROLE, ORG),
            )
            seed.execute(
                "INSERT INTO public.manufacturing_orders(id,org_id,order_number,product_id,quantity,status,created_by) VALUES(%s,%s,'PAUSE-INFLIGHT',%s,10,'quality_check',%s)",
                (MO, ORG, FG, ADMIN),
            )
            seed.execute(
                "INSERT INTO wardah_internal.quality_inspection_counters(org_id,last_number) VALUES(%s,1)",
                (ORG,),
            )
        with connect(CLONE) as holder, connect(CLONE, True) as observer:
            holder_pid = holder.execute("SELECT pg_backend_pid()").fetchone()[0]
            holder.execute(
                "SELECT 1 FROM wardah_internal.quality_inspection_counters WHERE org_id=%s FOR UPDATE",
                (ORG,),
            )
            thread = threading.Thread(target=writer, daemon=True)
            thread.start()
            try:
                if not (ready.wait(5)):
                    raise AssertionError("PAUSE_WRITER_NOT_STARTED")
                deadline = time.monotonic() + 10
                while time.monotonic() < deadline:
                    if errors:
                        raise errors[0]
                    blocked = observer.execute(
                        "SELECT pg_blocking_pids(%s)", (worker_pid[0],)
                    ).fetchone()[0]
                    if holder_pid in blocked:
                        break
                    time.sleep(0.02)
                else:
                    raise AssertionError("PAUSE_WAIT_NOT_OBSERVED")
                observer.execute(
                    "REVOKE EXECUTE ON FUNCTION public.rpc_record_quality_inspection(uuid,uuid,jsonb) FROM authenticated"
                )
                with connect(CLONE) as newcomer:
                    as_actor(newcomer)
                    try:
                        newcomer.execute(CALL, (MO, str(uuid.uuid4()), PAYLOAD))
                    except psycopg.errors.InsufficientPrivilege as exc:
                        if not (exc.sqlstate == "42501"):
                            raise AssertionError(
                                "PAUSE_ORACLE_FAILED: exc.sqlstate == '42501'"
                            )
                        if not (
                            exc.diag.message_primary
                            == "permission denied for function rpc_record_quality_inspection"
                        ):
                            raise AssertionError(
                                "PAUSE_ORACLE_FAILED: exc.diag.message_primary == 'permission denied for function rpc_record_quality_inspection'"
                            )
                    else:
                        raise AssertionError("PAUSE_NEW_CALL_NOT_DENIED")
                if (
                    holder_pid
                    not in observer.execute(
                        "SELECT pg_blocking_pids(%s)", (worker_pid[0],)
                    ).fetchone()[0]
                ):
                    raise AssertionError(
                        "PAUSE_ORACLE_FAILED: holder_pid in observer.execute('SELECT pg_blocking_pids(%s)', (worker_pid[0],)).fetchone()[0]"
                    )
                if not (
                    observer.execute(
                        "SELECT count(*) FROM public.quality_inspections WHERE mo_id=%s",
                        (MO,),
                    ).fetchone()[0]
                    == 0
                ):
                    raise AssertionError(
                        "PAUSE_ORACLE_FAILED: observer.execute('SELECT count(*) FROM public.quality_inspections WHERE mo_id=%s', (MO,)).fetchone()[0] == 0"
                    )
                holder.commit()
                thread.join(10)
                if not (not thread.is_alive()):
                    raise AssertionError("PAUSE_WRITER_DID_NOT_FINISH")
                if errors:
                    raise errors[0]
                if not (len(result) == 1 and result[0]["replayed"] is False):
                    raise AssertionError(
                        "PAUSE_ORACLE_FAILED: len(result) == 1 and result[0]['replayed'] is False"
                    )
                if not (
                    observer.execute(
                        "SELECT count(*) FROM public.quality_inspections WHERE mo_id=%s",
                        (MO,),
                    ).fetchone()[0]
                    == 1
                ):
                    raise AssertionError("PAUSE_COMMITTED_COUNT")
                row = observer.execute(
                    "SELECT inspector_id::text,result FROM public.quality_inspections WHERE mo_id=%s",
                    (MO,),
                ).fetchone()
                if not (row == (ACTOR, "PASS")):
                    raise AssertionError("PAUSE_COMMITTED_EFFECT_MISSING")
                print(
                    "QC_EXECUTE_REVOKE_DRAIN_RED blocked=true new_call=42501 inflight_committed=true"
                )
            finally:
                holder.rollback()
                thread.join(16)
        with connect(SOURCE, True) as source:
            if not (source.execute(SNAPSHOT).fetchone()[0] == before):
                raise AssertionError("PAUSE_SOURCE_CHANGED")
        print("QC_PAUSE_SOURCE_UNCHANGED source_state=true")
    finally:
        admin.execute(
            sql.Composed(
                [
                    sql.SQL("DROP DATABASE "),
                    sql.Identifier(CLONE),
                    sql.SQL(" WITH (FORCE)"),
                ]
            )
        )
