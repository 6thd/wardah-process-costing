"""Deterministic QC/material lock orderings on clones of one canonical M199 DB."""
from concurrent.futures import ThreadPoolExecutor
import copy
import os
import time
import uuid
import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb
from bridge import ACTORS, ORG, SNAPSHOTS, guard

guard()
SOURCE=os.environ['PGDATABASE']
FINANCIAL=('stage_wip_log','material_consumption','bins','stock_ledger_entries','products','gl_entries','gl_entry_lines','journal_entries','journal_lines')

def connect(db,actor=None,autocommit=False):
 c=psycopg.connect(dbname=db,autocommit=autocommit)
 c.execute("SET statement_timeout='10s'")
 if actor: identify(c,actor)
 return c

def identify(c,actor):
 c.execute("SELECT set_config('request.jwt.claim.sub',%s,true)",(ACTORS[actor],))
 c.execute('SET LOCAL ROLE authenticated')

def snapshot(c):
 return {t:c.execute(q).fetchone()[0] for t,q in SNAPSHOTS.items()}

def read(db):
 with connect(db) as c: return snapshot(c)

def qc(c,mo,action,v):
 identify(c,'qc')
 return c.execute('SELECT public.rpc_set_mo_quality_hold(%s,%s,%s,%s)',(mo,action,v,'deterministic return' if action=='return' else None)).fetchone()[0]

def setup(c,mo,op,v,uom):
 identify(c,'material')
 cmd={'operation':op,'mo_id':str(mo),'expected_version':v}
 if op=='reserve': cmd.update(item_id='ed000000-0000-4000-8000-0000000000d1',uom_id=str(uom),quantity=2)
 else: cmd.update(work_center_id='ed000000-0000-4000-8000-0000000000f2',name='Joint race WO',quantity=1)
 return c.execute('SELECT public.rpc_manage_material_issue_setup(%s,%s,%s,%s)',(ORG,uuid.uuid4(),Jsonb(cmd),ACTORS['material'])).fetchone()[0]

def consume(c,mo,event,lines):
 identify(c,'material')
 return c.execute('SELECT public.rpc_consume_material_event(%s,%s,%s,%s)',(mo,'ed000000-0000-4000-8000-0000000000f1',event,Jsonb(lines))).fetchone()[0]

def attempt(c,fn):
 # A refused first call still retains the explicit parent lock for the ordering.
 c.execute('SAVEPOINT call_guard')
 try: result=fn(c)
 except psycopg.Error as e:
  result={'error':[e.sqlstate,e.diag.message_primary]}
  c.execute('ROLLBACK TO SAVEPOINT call_guard')
 c.execute('RELEASE SAVEPOINT call_guard')
 return result

def blocked(observer,waiter,holder,timeout=5):
 end=time.monotonic()+timeout
 while time.monotonic()<end:
  if observer.execute('SELECT %s=ANY(pg_blocking_pids(%s))',(holder,waiter)).fetchone()[0]: return
  time.sleep(.01)
 raise AssertionError('QC_MATERIAL_WAITER_NOT_BLOCKED')

def check_denial(value,message):
 assert value=={'error':['P0001',message]}, ('QC_MATERIAL_WRONG_DENIAL',value,message)

def find_row(rows,key,value):
 return next(r for r in rows if r[key]==str(value))

def stock_effects(before,after,mo,n):
 res0=find_row(before['material_reservations'],'mo_id',mo)
 res1=find_row(after['material_reservations'],'id',res0['id'])
 assert res1['quantity_consumed']-res0['quantity_consumed']==10*n, 'QC_MATERIAL_QUANTITY_DRIFT'
 assert sum(float(r['actual_qty']) for r in before['bins'])-sum(float(r['actual_qty']) for r in after['bins'])==10*n

def cost_effects(before,after,mo,n):
 w0=find_row(before['stage_wip_log'],'mo_id',mo)
 w1=find_row(after['stage_wip_log'],'id',w0['id'])
 assert w1['cost_material']-w0['cost_material']==100*n
 for table in ('gl_entries','gl_entry_lines','journal_entries','journal_lines'): assert after[table]==before[table]

def effects(before,after,mo,v,status,consumptions,reserves,wos):
 parent=find_row(after['manufacturing_orders'],'id',mo)
 assert (parent['maintenance_version'],parent['status'])==(v,status), 'QC_MATERIAL_PARENT_DRIFT'
 for table,n in (('material_consumption',consumptions),('material_reservations',reserves),('work_orders',wos),('stock_ledger_entries',consumptions),('material_issue_events',consumptions)):
  assert len(after[table])-len(before[table])==n, 'QC_MATERIAL_COUNT_DRIFT: '+table
 if not consumptions:
  assert {t:after[t] for t in FINANCIAL}=={t:before[t] for t in FINANCIAL}, 'QC_MATERIAL_FINANCIAL_DRIFT'
 else:
  stock_effects(before,after,mo,consumptions)
  cost_effects(before,after,mo,consumptions)

count=0
last=None
with connect('postgres',autocommit=True) as admin:
 for transition in ('hold','return'):
  for op in ('consume','reserve','create_work_order'):
   for qc_first in (True,False):
    name=f'{transition}_{op}_'+('qc_first' if qc_first else 'material_first')
    db=f'wardah_issue_parent_198_canonical_qc199_race_{os.getpid()}_{count}'
    admin.execute(sql.SQL('CREATE DATABASE {} TEMPLATE {}').format(sql.Identifier(db),sql.Identifier(SOURCE)))
    try:
     with connect(db) as c:
      mo=c.execute("SELECT v FROM wardah_internal.issue_scope_test_ids WHERE k='mo'").fetchone()[0]
      v=c.execute('SELECT maintenance_version FROM public.manufacturing_orders WHERE id=%s',(mo,)).fetchone()[0]
      res=c.execute('SELECT id,uom_id FROM public.material_reservations WHERE mo_id=%s ORDER BY id',(mo,)).fetchone()
      wo=c.execute('SELECT id FROM public.work_orders WHERE mo_id=%s ORDER BY id',(mo,)).fetchone()[0]
      uom=res[1]
     lines=[dict(item_id='ed000000-0000-4000-8000-0000000000d1',reservation_id=str(res[0]),uom_id=str(uom),warehouse_id='ed000000-0000-4000-8000-0000000000e1',work_order_id=str(wo),quantity=10,consumption_type='MANUAL')]
     if transition=='return':
      with connect(db) as c: qc(c,mo,'hold',v)
      v+=1
     before=read(db); event=uuid.uuid4()
     qfn=lambda c:qc(c,mo,transition,v)
     mfn=(lambda c:consume(c,mo,event,lines)) if op=='consume' else (lambda c:setup(c,mo,op,v,uom))
     first,second=(qfn,mfn) if qc_first else (mfn,qfn)
     with connect(db) as holder,connect(db) as waiter,connect(db,autocommit=True) as observer:
      holder.execute('SELECT id FROM public.manufacturing_orders WHERE id=%s FOR UPDATE',(mo,))
      first_result=attempt(holder,first)
      holder.execute('RESET ROLE'); after_first=snapshot(holder)
      with ThreadPoolExecutor(max_workers=1) as pool:
       future=pool.submit(attempt,waiter,second)
       blocked(observer,waiter.info.backend_pid,holder.info.backend_pid)
       holder.commit()
       second_result=future.result(timeout=12); waiter.commit()
     after=read(db)
     if qc_first:
      assert 'error' not in first_result
      if transition=='hold':
       check_denial(second_result,'MANUFACTURING_ORDER_NOT_IN_PROGRESS' if op=='consume' else 'ISSUE_SETUP_MO_NOT_ELIGIBLE')
       assert after==after_first, 'QC_MATERIAL_DENIAL_EFFECTS'
       effects(before,after,mo,v+1,'quality_check',0,0,0)
      elif op=='consume':
       assert 'error' not in second_result
       effects(before,after,mo,v+1,'in_progress',1,0,0)
      else:
       check_denial(second_result,'ISSUE_SETUP_STALE_VERSION'); assert after==after_first
       effects(before,after,mo,v+1,'in_progress',0,0,0)
     elif transition=='return':
      check_denial(first_result,'MANUFACTURING_ORDER_NOT_IN_PROGRESS' if op=='consume' else 'ISSUE_SETUP_MO_NOT_ELIGIBLE')
      assert after_first==before and 'error' not in second_result
      effects(before,after,mo,v+1,'in_progress',0,0,0)
     elif op=='consume':
      assert 'error' not in first_result and 'error' not in second_result
      effects(before,after,mo,v+1,'quality_check',1,0,0)
     else:
      assert 'error' not in first_result
      check_denial(second_result,f'QUALITY_MO_VERSION_CONFLICT: current={v+1}')
      assert after==after_first
      effects(before,after,mo,v+1,'in_progress',0,int(op=='reserve'),int(op=='create_work_order'))
     last=(before,after,mo,v+1,'quality_check' if transition=='hold' and (qc_first or op=='consume') else 'in_progress',int(op=='consume' and (transition=='hold' and not qc_first or transition=='return' and qc_first)),int(transition=='hold' and not qc_first and op=='reserve'),int(transition=='hold' and not qc_first and op=='create_work_order'))
     count+=1; print(f'QC_MATERIAL_RACE_PASS case={name} blocked=true',flush=True)
    finally: admin.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(db)))
 # A lost-response retry is blocked behind the first event's actual advisory lock;
 # that first session commits both consumption and QC hold before retry proceeds.
 for transition in ('hold','return'):
  for retry_first in (False,True):
   db=f'wardah_issue_parent_198_canonical_qc199_race_{os.getpid()}_{count}'
   admin.execute(sql.SQL('CREATE DATABASE {} TEMPLATE {}').format(sql.Identifier(db),sql.Identifier(SOURCE)))
   try:
    with connect(db) as c:
     mo=c.execute("SELECT v FROM wardah_internal.issue_scope_test_ids WHERE k='mo'").fetchone()[0]
     v=c.execute('SELECT maintenance_version FROM public.manufacturing_orders WHERE id=%s',(mo,)).fetchone()[0]
     res=c.execute('SELECT id,uom_id FROM public.material_reservations WHERE mo_id=%s ORDER BY id',(mo,)).fetchone()
     wo=c.execute('SELECT id FROM public.work_orders WHERE mo_id=%s ORDER BY id',(mo,)).fetchone()[0]
    lines=[dict(item_id='ed000000-0000-4000-8000-0000000000d1',reservation_id=str(res[0]),uom_id=str(res[1]),warehouse_id='ed000000-0000-4000-8000-0000000000e1',work_order_id=str(wo),quantity=10,consumption_type='MANUAL')]
    event=uuid.uuid4()
    with connect(db) as c: receipt=consume(c,mo,event,lines)
    if transition=='return':
     with connect(db) as c: qc(c,mo,'hold',v)
     v+=1
    before=read(db)
    with connect(db) as holder,connect(db) as waiter,connect(db,autocommit=True) as observer:
     holder.execute('SELECT id FROM public.manufacturing_orders WHERE id=%s FOR UPDATE',(mo,))
     if retry_first:
      assert consume(holder,mo,event,lines)==receipt
      pending=lambda c:qc(c,mo,transition,v)
     else:
      qc(holder,mo,transition,v)
      pending=lambda c:consume(c,mo,event,lines)
     holder.execute('RESET ROLE'); after_first=snapshot(holder)
     with ThreadPoolExecutor(max_workers=1) as pool:
      future=pool.submit(pending,waiter)
      blocked(observer,waiter.info.backend_pid,holder.info.backend_pid)
      holder.commit(); result=future.result(timeout=12); waiter.commit()
    after=read(db)
    if not retry_first: assert result==receipt and after==after_first
    effects(before,after,mo,v+1,'quality_check' if transition=='hold' else 'in_progress',0,0,0)
    count+=1; print(f'QC_MATERIAL_RACE_PASS case={transition}_receipt_replay_'+('retry_first' if retry_first else 'qc_first')+' blocked=true',flush=True)
   finally: admin.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(db)))

# Concurrent same-event retry of an UNCOMMITTED first consumption. The holder
# moves the MO to QC before commit; the waiter must return the original receipt.
with connect('postgres',autocommit=True) as admin:
 db=f'wardah_issue_parent_198_canonical_qc199_race_{os.getpid()}_{count}'
 admin.execute(sql.SQL('CREATE DATABASE {} TEMPLATE {}').format(sql.Identifier(db),sql.Identifier(SOURCE)))
 try:
  with connect(db) as c:
   mo=c.execute("SELECT v FROM wardah_internal.issue_scope_test_ids WHERE k='mo'").fetchone()[0]
   v=c.execute('SELECT maintenance_version FROM public.manufacturing_orders WHERE id=%s',(mo,)).fetchone()[0]
   res=c.execute('SELECT id,uom_id FROM public.material_reservations WHERE mo_id=%s ORDER BY id',(mo,)).fetchone()
   wo=c.execute('SELECT id FROM public.work_orders WHERE mo_id=%s ORDER BY id',(mo,)).fetchone()[0]
  lines=[dict(item_id='ed000000-0000-4000-8000-0000000000d1',reservation_id=str(res[0]),uom_id=str(res[1]),warehouse_id='ed000000-0000-4000-8000-0000000000e1',work_order_id=str(wo),quantity=10,consumption_type='MANUAL')]
  event=uuid.uuid4(); before=read(db)
  with connect(db) as holder,connect(db) as waiter,connect(db,autocommit=True) as observer:
   receipt=consume(holder,mo,event,lines)
   with ThreadPoolExecutor(max_workers=1) as pool:
    future=pool.submit(consume,waiter,mo,event,lines)
    blocked(observer,waiter.info.backend_pid,holder.info.backend_pid)
    qc(holder,mo,'hold',v)
    holder.execute('RESET ROLE'); committed=snapshot(holder)
    holder.commit(); result=future.result(timeout=12); waiter.commit()
   try: blocked(observer,waiter.info.backend_pid,2147483647,timeout=.1)
   except AssertionError: print('QC_MATERIAL_RACE_ORACLE_REFUSED case=unobserved_lock')
   else: raise AssertionError('QC_MATERIAL_BARRIER_FALSE_GREEN')
  after=read(db)
  assert result==receipt and after==committed
  effects(before,after,mo,v+1,'quality_check',1,0,0)
  count+=1; print('QC_MATERIAL_RACE_PASS case=uncommitted_consume_retry_then_hold blocked=true',flush=True)
 finally: admin.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(db)))

# Mutate real observed output to prove each assertion category can refuse drift.
before,after,mo,v,status,n,reserves,wos=last
for label in ('version','status','consumption','reservation','work_order','financial'):
 mutant=copy.deepcopy(after)
 row=next(r for r in mutant['manufacturing_orders'] if r['id']==str(mo))
 if label=='version': row['maintenance_version']+=1
 elif label=='status': row['status']='draft'
 elif label=='financial': mutant['products'][0]['stock_quantity']=123456
 else:
  table={'consumption':'material_consumption','reservation':'material_reservations','work_order':'work_orders'}[label]
  mutant[table].append(copy.deepcopy(mutant[table][0]) if mutant[table] else {'id':'mutant'})
 try: effects(before,mutant,mo,v,status,n,reserves,wos)
 except AssertionError: print('QC_MATERIAL_RACE_ORACLE_REFUSED case='+label)
 else: raise AssertionError('QC_MATERIAL_RACE_FALSE_GREEN: '+label)
print(f'QC_MATERIAL_JOINT_RACES_PASS cases={count} blocked={count} oracle_mutants=7',flush=True)
