"""M198-specific real PG17 probes. Local disposable database only."""
import concurrent.futures
import os
import time
import uuid
import psycopg
from psycopg.types.json import Jsonb

if (os.environ.get('PGHOST') != '127.0.0.1' or int(os.environ.get('PGPORT','0')) < 55000
        or not os.environ.get('PGDATABASE','').startswith('wardah_issue_parent_198_')
        or any(os.environ.get(k) for k in ('PGHOSTADDR','PGSERVICE','DATABASE_URL','SUPABASE_DB_URL'))):
    raise SystemExit('REFUSED_NON_DISPOSABLE_DATABASE')
ORG='ed000000-0000-4000-8000-000000000001'
ACTOR='ed000000-0000-4000-8000-0000000000a2'
SECOND='ed000000-0000-4000-8000-0000000000a3'
ADMIN='ed000000-0000-4000-8000-0000000000a1'
ITEM='ed000000-0000-4000-8000-0000000000d1'
RAW='ed000000-0000-4000-8000-0000000000c1'
FG='ed000000-0000-4000-8000-0000000000c2'
CENTER='ed000000-0000-4000-8000-0000000000f2'
STAGE='ed000000-0000-4000-8000-0000000000f1'
WAREHOUSE='ed000000-0000-4000-8000-0000000000e1'
SNAPSHOTS={
 'orders': "SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.manufacturing_orders t",
 'wo': "SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.work_orders t",
 'reservations': "SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.material_reservations t",
 'events': "SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY event_id),'[]') FROM wardah_internal.material_issue_maintenance_events t",
 'audit': "SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.audit_logs t",
 'bins': "SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.bins t",
 'sle': "SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.stock_ledger_entries t",
 'products': "SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.products t",
 'wip': "SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.stage_wip_log t",
 'consumption': "SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.material_consumption t",
 'gl': "SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.gl_entries t",
 'gl_lines': "SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.gl_entry_lines t",
 'journals': "SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.journal_entries t",
 'journal_lines': "SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.journal_lines t",
}
FINANCIAL=('bins','sle','products','wip','consumption','gl','gl_lines','journals','journal_lines')

def connection(actor=None):
    conn=psycopg.connect('')
    conn.execute("SET statement_timeout='10s'")
    if actor:
        conn.execute("SELECT set_config('request.jwt.claim.sub',%s,true)",(actor,))
        conn.execute('SET LOCAL ROLE authenticated')
    return conn

def snapshot():
    with connection() as c:
        return {key:c.execute(query).fetchone()[0] for key,query in SNAPSHOTS.items()}

def version(mo):
    with connection() as c:
        return c.execute('SELECT maintenance_version FROM public.manufacturing_orders WHERE id=%s',(mo,)).fetchone()[0]

def command(op,mo,v):
    if op=='reserve':
        return dict(operation=op,mo_id=mo,item_id=ITEM,uom_id=UOM,quantity=2,expected_version=v)
    return dict(operation=op,mo_id=mo,work_center_id=CENTER,name='M198 manual',quantity=1,expected_version=v)

def call(c,cmd,event,actor):
    return c.execute('SELECT public.rpc_manage_material_issue_setup(%s,%s,%s,%s)',(ORG,event,Jsonb(cmd),actor)).fetchone()[0]

def post(cmd,event=None,actor=ACTOR):
    with connection(actor) as c:
        return call(c,cmd,event or uuid.uuid4(),actor)

def deny(cmd,message,actor=ACTOR,event=None,code='P0001'):
    before=snapshot()
    try:
        post(cmd,event,actor)
    except psycopg.Error as error:
        assert (error.sqlstate,error.diag.message_primary)==(code,message), (error.sqlstate,error.diag.message_primary)
    else:
        raise AssertionError('M198_EXPECTED_DENIAL')
    assert snapshot()==before, 'M198_DENIAL_CHANGED_STATE'

def parent(status='in_progress'):
    with connection() as c:
        c.execute("SELECT set_config('request.jwt.claim.sub',%s,true)",(ADMIN,))
        result=c.execute('SELECT public.rpc_create_mo_with_reservation(%s,%s,%s)',
                         (Jsonb(dict(order_number='M198-'+str(uuid.uuid4()),product_id=FG,quantity=5)),Jsonb([]),ORG)).fetchone()[0]
        assert result['success'] is True
        mo=result['mo_id']
        transitions={'draft':[], 'confirmed':['confirmed'], 'in_progress':['confirmed','in_progress'],
                     'on_hold':['confirmed','in_progress','on_hold']}[status]
        for target in transitions:
            c.execute('SELECT public.rpc_transition_mo_status(%s,%s,NULL,%s)',(mo,target,ORG))
        return mo

def blocked(observer,waiter,holder):
    deadline=time.monotonic()+5
    while time.monotonic()<deadline:
        if observer.execute('SELECT %s=ANY(pg_blocking_pids(%s))',(holder,waiter)).fetchone()[0]:
            return
        time.sleep(.02)
    raise AssertionError('M198_WAITER_NOT_BLOCKED')

with connection() as c:
    assert 170000<=int(c.execute('SHOW server_version_num').fetchone()[0])<180000
    UOM=str(c.execute('SELECT base_uom_id FROM public.products WHERE id=%s',(RAW,)).fetchone()[0])
    c.execute("""INSERT INTO public.role_permissions(role_id,permission_id)
      SELECT r.id,p.id FROM public.roles r CROSS JOIN public.permissions p
      WHERE r.id IN ('ed000000-0000-4000-8000-0000000000b1','ed000000-0000-4000-8000-0000000000b2')
      AND p.permission_key IN ('manufacturing.material_issue_setup.prepare','manufacturing.material_reservation.reserve')
      ON CONFLICT DO NOTHING""")

for op in ('reserve','create_work_order'):
    mo=parent(); v=version(mo); cmd=command(op,mo,v)
    for invalid in (None,True,'1',0,-1,1.5,9223372036854775808):
        deny({**cmd,'expected_version':invalid},'ISSUE_SETUP_VERSION_REQUIRED')
    missing=dict(cmd); del missing['expected_version']; deny(missing,'ISSUE_SETUP_VERSION_REQUIRED')
    deny(cmd,'ISSUE_MAINTENANCE_PERMISSION_DENIED',ADMIN,code='42501')
    deny({**cmd,'quantity':0},'INVALID_BASE_QUANTITY' if op=='reserve' else 'INVALID_WORK_ORDER_QUANTITY_OR_NAME')
    event=uuid.uuid4(); before=snapshot(); result=post(cmd,event)
    assert version(mo)==v+1
    after=snapshot()
    table='reservations' if op=='reserve' else 'wo'
    assert len(after[table])==len(before[table])+1
    assert all(after[key]==before[key] for key in FINANCIAL)
    assert post(cmd,event)==result and snapshot()==after, 'M198_REPLAY_VERSION_OR_EFFECT_DRIFT'
    deny(cmd,'ISSUE_SETUP_STALE_VERSION',SECOND)
    deny(cmd,'ISSUE_SETUP_EVENT_ACTOR_MISMATCH',SECOND,event)
    deny({**cmd,'quantity':1},'ISSUE_SETUP_EVENT_PAYLOAD_MISMATCH',event=event)
    print('M198_VALIDATION_REPLAY_NO_FINANCIAL_EFFECTS_PASS operation='+op)

    # Two real actors blocked on the same parent, not a sleep-based race.
    mo=parent(); v=version(mo); cmd=command(op,mo,v); before=snapshot()
    with connection(ACTOR) as holder, connection(SECOND) as waiter, connection() as observer:
        holder_pid=holder.info.backend_pid; waiter_pid=waiter.info.backend_pid
        holder.execute('SELECT id FROM public.manufacturing_orders WHERE id=%s FOR UPDATE',(mo,))
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            future=pool.submit(call,waiter,cmd,uuid.uuid4(),SECOND)
            blocked(observer,waiter_pid,holder_pid)
            result=call(holder,cmd,uuid.uuid4(),ACTOR); holder.commit()
            try:
                future.result(timeout=10)
            except psycopg.Error as error:
                assert (error.sqlstate,error.diag.message_primary)==('P0001','ISSUE_SETUP_STALE_VERSION')
                waiter.rollback()
            else:
                raise AssertionError('M198_DISTINCT_EVENTS_BOTH_APPLIED')
    after=snapshot(); assert version(mo)==v+1
    assert len(after[table])==len(before[table])+1
    assert all(after[key]==before[key] for key in FINANCIAL)
    print('M198_TWO_ACTOR_BLOCKED_RACE_PASS operation='+op)

    # Native snapshot conflict must remain engine 40001, not a deliberate RAISE.
    mo=parent(); v=version(mo); cmd=command(op,mo,v)
    with connection() as stale:
        stale.commit(); stale.execute('BEGIN ISOLATION LEVEL REPEATABLE READ')
        stale.execute('SELECT id FROM public.manufacturing_orders WHERE id=%s',(mo,))
        post(cmd)
        stale.execute("SELECT set_config('request.jwt.claim.sub',%s,true)",(ACTOR,)); stale.execute('SET LOCAL ROLE authenticated')
        before=snapshot()
        try:
            call(stale,cmd,uuid.uuid4(),ACTOR)
        except psycopg.Error as error:
            assert error.sqlstate=='40001' and 'ISSUE_SETUP_STALE_VERSION' not in error.diag.message_primary
            stale.rollback()
        else:
            raise AssertionError('M198_ENGINE_SERIALIZATION_NOT_PRESERVED')
        assert snapshot()==before
    print('M198_NATIVE_SERIALIZATION_PASS operation='+op)

# A grant revoked during the MO lock wait rolls back the newly introduced touch.
mo=parent(); cmd=command('reserve',mo,version(mo)); before=snapshot()
with connection() as holder, connection(SECOND) as waiter, connection() as observer:
    holder.execute('SELECT id FROM public.manufacturing_orders WHERE id=%s FOR UPDATE',(mo,))
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        future=pool.submit(call,waiter,cmd,uuid.uuid4(),SECOND)
        blocked(observer,waiter.info.backend_pid,holder.info.backend_pid)
        with connection() as revoker:
            revoker.execute("DELETE FROM public.role_permissions WHERE role_id='ed000000-0000-4000-8000-0000000000b2' AND permission_id IN (SELECT id FROM public.permissions WHERE permission_key='manufacturing.material_reservation.reserve')")
        holder.rollback()
        try:
            future.result(timeout=10)
        except psycopg.Error as error:
            assert (error.sqlstate,error.diag.message_primary)==('42501','ISSUE_MAINTENANCE_PERMISSION_DENIED')
            waiter.rollback()
        else:
            raise AssertionError('M198_REVOKED_WAITING_ACTOR_APPLIED')
assert snapshot()==before
print('M198_REVOKED_DURING_PARENT_WAIT_NO_EFFECTS_PASS')

# Real M197 applied record without expected_version remains replayable under198.
# This is a disposable fixture transition; restore198 before committing.
from derivation import function, BASE, replacement
for op in ('reserve','create_work_order'):
    mo=parent(); legacy=command(op,mo,version(mo)); del legacy['expected_version']; event=uuid.uuid4()
    with connection() as c:
        c.execute(function(BASE.read_text()))
        c.execute("SELECT set_config('request.jwt.claim.sub',%s,true)",(ACTOR,)); c.execute('SET LOCAL ROLE authenticated')
        saved=call(c,legacy,event,ACTOR)
        c.execute('RESET ROLE'); c.execute(replacement())
    before=snapshot(); assert post(legacy,event)==saved and snapshot()==before
    deny(legacy,'ISSUE_SETUP_VERSION_REQUIRED')
    # Unknown pre198 intents can be durably fenced using the unchanged protocol.
    missing_event=uuid.uuid4()
    with connection(ACTOR) as c:
        closed=c.execute('SELECT public.rpc_reconcile_material_issue_setup(%s,%s,%s,%s)',(ORG,missing_event,Jsonb(legacy),ACTOR)).fetchone()[0]
        assert closed['state']=='closed'
    deny(legacy,'ISSUE_SETUP_EVENT_CLOSED',event=missing_event)
    print('M198_LEGACY_APPLIED_REPLAY_AND_UNKNOWN_FENCE_PASS operation='+op)

# All eligible states tolerate the parent touch without extra children/status drift.
for status in ('draft','confirmed','in_progress','on_hold'):
    mo=parent(status)
    for op in ('reserve','create_work_order'):
        before=snapshot(); v=version(mo); post(command(op,mo,v)); after=snapshot()
        old=next(r for r in before['orders'] if r['id']==mo); new=next(r for r in after['orders'] if r['id']==mo)
        assert new['status']==status and new['maintenance_version']==v+1
        assert {k:x for k,x in old.items() if k not in ('maintenance_version','updated_at')}=={k:x for k,x in new.items() if k not in ('maintenance_version','updated_at')}
        assert all(after[key]==before[key] for key in FINANCIAL)
    print('M198_ELIGIBLE_STATUS_PARENT_TOUCH_PASS status='+status)

# Consumption still does not invalidate the MO preparation version.
with connection() as c:
    mo=str(c.execute("SELECT v FROM wardah_internal.issue_scope_test_ids WHERE k='mo'").fetchone()[0])
    reservation=str(c.execute('SELECT id FROM public.material_reservations WHERE mo_id=%s ORDER BY id LIMIT 1',(mo,)).fetchone()[0])
    wo=str(c.execute('SELECT id FROM public.work_orders WHERE mo_id=%s ORDER BY id LIMIT 1',(mo,)).fetchone()[0])
v=version(mo)
with connection(ACTOR) as c:
    receipt=c.execute('SELECT public.rpc_consume_material_event(%s,%s,%s,%s)',(mo,STAGE,uuid.uuid4(),Jsonb([
        dict(item_id=ITEM,reservation_id=reservation,warehouse_id=WAREHOUSE,work_order_id=wo,uom_id=UOM,quantity=1,consumption_type='MANUAL')]))).fetchone()[0]
    assert receipt['success'] is True
assert version(mo)==v
print('M198_CONSUMPTION_PARENT_VERSION_UNCHANGED_PASS')
# Prove install guards reject real DDL/body mutations and roll back.
from derivation import CANDIDATE
for label in ('disabled_trigger','changed_body','wrong_post_fingerprint'):
    with connection() as c:
        c.execute(function(BASE.read_text()))
        text=CANDIDATE.read_text()
        if label=='disabled_trigger':
            c.execute('ALTER TABLE public.manufacturing_orders DISABLE TRIGGER zz_issue_maintenance_version')
            expected='M198_PARENT_VERSION_TRIGGER_DRIFT'
        elif label=='changed_body':
            text=text.replace('parent_version IS DISTINCT FROM mo.maintenance_version+1','parent_version IS DISTINCT FROM mo.maintenance_version+2')
            expected='M198_REPLACEMENT_FINGERPRINT_MISMATCH'
        else:
            from verify_candidate import verify
            text=text.replace("IS DISTINCT FROM '%s' THEN"%verify()['after_prosrc_md5'],"IS DISTINCT FROM '00000000000000000000000000000000' THEN")
            expected='M198_REPLACEMENT_FINGERPRINT_MISMATCH'
        try:
            c.execute(text)
        except psycopg.Error as error:
            assert error.diag.message_primary==expected, error.diag.message_primary
            c.rollback()
        else:
            raise AssertionError('M198_GUARD_MUTATION_ACCEPTED')
    print('M198_INSTALL_GUARD_MUTATION_REJECTED label='+label)
print('M198_LOCAL_PG17_ACCEPTANCE_PASS')
