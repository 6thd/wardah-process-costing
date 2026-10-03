"""Real server rejection probes in a rolled-back disposable transaction."""
import uuid
from psycopg.types.json import Jsonb
import psycopg
from bridge import ACTORS, SNAPSHOTS, connection, guard

def state(c):
 return {table:c.execute(query).fetchone()[0] for table,query in SNAPSHOTS.items()}

def refusal(c,query,args,message):
 before=state(c)
 c.execute('SAVEPOINT server_probe')
 try:
  c.execute(query,args)
 except psycopg.Error as error:
  assert (error.sqlstate,error.diag.message_primary)==('P0001',message)
  c.execute('ROLLBACK TO SAVEPOINT server_probe')
 else:
  raise AssertionError('QC_MATERIAL_SERVER_FALSE_GREEN: '+message)
 c.execute('RELEASE SAVEPOINT server_probe')
 assert state(c)==before, 'QC_MATERIAL_SERVER_DENIAL_EFFECTS'

def main():
 guard()
 with connection() as c:
  initial=state(c)
  mo=next(r for r in initial['manufacturing_orders'] if r['order_number']=='ISSUE-SCOPE-1')
  c.execute("SELECT set_config('request.jwt.claim.sub',%s,true)",(ACTORS['qc'],))
  hold='SELECT public.rpc_set_mo_quality_hold(%s,%s,%s,%s)'
  c.execute(hold,(mo['id'],'hold',mo['maintenance_version'],None))
  for reason in (None,'','   '):
   refusal(c,hold,(mo['id'],'return',mo['maintenance_version']+1,reason),'QUALITY_RETURN_REASON_REQUIRED')
  c.execute('SELECT public.rpc_record_quality_inspection(%s,%s,%s)',
            (mo['id'],uuid.uuid4(),Jsonb({'inspection_type':'FINAL','result':'PASS','passed_quantity':5,'failed_quantity':0})))
  ready=c.execute('SELECT public.rpc_get_mo_quality_status(%s)',(mo['id'],)).fetchone()[0]
  assert ready['release']['ready'] is True
  c.execute(hold,(mo['id'],'return',mo['maintenance_version']+1,'server probe'))
  c.execute(hold,(mo['id'],'hold',mo['maintenance_version']+2,None))
  status=c.execute('SELECT public.rpc_get_mo_quality_status(%s)',(mo['id'],)).fetchone()[0]
  assert status['release']['ready'] is False and status['release']['reason']=='QUALITY_RELEASE_REQUIRED'
  # Quarantined completion RPC is deliberately unavailable. The owner UPDATE
  # tests the canonical release trigger itself, without reopening any grant.
  refusal(c,"UPDATE public.manufacturing_orders SET status='done',completed_quantity=5 WHERE id=%s",
          (mo['id'],),'QUALITY_RELEASE_REQUIRED')
  c.rollback()
  assert state(c)==initial, 'QC_MATERIAL_SERVER_PROBE_ROLLBACK_DRIFT'
 print('QC_MATERIAL_SERVER_PROBES_PASS return_reasons=3 old_cycle_completion=1')

if __name__=='__main__':
 main()
