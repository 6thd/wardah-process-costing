"""Fixed loopback-only SQL adapter. No hosted identity or arbitrary SQL interface."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import datetime
import decimal
import json
import os
import threading
import uuid
import psycopg
from psycopg.types.json import Jsonb
from psycopg import sql

ORG='ed000000-0000-4000-8000-000000000001'
ACTORS={'material':'ed000000-0000-4000-8000-0000000000a2','qc':'ed000000-0000-4000-8000-0000000000a3'}
PUBLIC_TABLES=('manufacturing_orders','work_orders','material_reservations','stage_wip_log','material_consumption',
 'bins','stock_ledger_entries','products','gl_entries','gl_entry_lines','journal_entries','journal_lines','quality_inspections','audit_logs')
PRIVATE_TABLES=('material_issue_events','material_issue_maintenance_events','mo_quality_cycles','quality_policies')
# Identifiers are constants, never supplied by HTTP.
SNAPSHOTS={t: sql.SQL("SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') FROM {}.{} t").format(sql.Identifier(schema),sql.Identifier(t))
 for schema,tables in (('public',PUBLIC_TABLES),('wardah_internal',PRIVATE_TABLES)) for t in tables}
RPCS={
 'rpc_manage_material_issue_setup':(('p_org_id','p_event_id','p_command','p_actor_id'),'SELECT public.rpc_manage_material_issue_setup(%s,%s,%s,%s)'),
 'rpc_reconcile_material_issue_setup':(('p_org_id','p_event_id','p_command','p_actor_id'),'SELECT public.rpc_reconcile_material_issue_setup(%s,%s,%s,%s)'),
 'rpc_get_material_reservation_setup':(('p_org_id','p_item_id'),'SELECT public.rpc_get_material_reservation_setup(%s,%s)'),
 'rpc_list_material_issue_orders':(('p_org_id',),'SELECT public.rpc_list_material_issue_orders(%s)'),
 'rpc_get_material_issue_context':(('p_mo_id',),'SELECT public.rpc_get_material_issue_context(%s)'),
 'rpc_get_material_issue_wo_statuses':(('p_org_id',),'SELECT public.rpc_get_material_issue_wo_statuses(%s)'),
 'rpc_consume_material_event':(('p_mo_id','p_stage_id','p_event_id','p_consumptions'),'SELECT public.rpc_consume_material_event(%s,%s,%s,%s)'),
 'rpc_get_quality_policy':(('p_org_id',),'SELECT public.rpc_get_quality_policy(%s)'),
 'rpc_get_mo_quality_status':(('p_mo_id',),'SELECT public.rpc_get_mo_quality_status(%s)'),
 'rpc_list_quality_inspections':(('p_org_id','p_mo_id','p_limit'),'SELECT public.rpc_list_quality_inspections(%s,%s,%s)'),
 'rpc_record_quality_inspection':(('p_mo_id','p_request_id','p_payload'),'SELECT public.rpc_record_quality_inspection(%s,%s,%s)'),
 'rpc_set_mo_quality_hold':(('p_mo_id','p_action','p_expected_version','p_reason'),'SELECT public.rpc_set_mo_quality_hold(%s,%s,%s,%s)'),
}
CATALOG={t:sql.SQL('SELECT to_jsonb(t) FROM public.{} t WHERE org_id=%s AND (%s::uuid IS NULL OR id>%s::uuid) ORDER BY id LIMIT %s').format(sql.Identifier(t))
 for t in ('products','items','manufacturing_orders','work_orders','material_reservations','work_centers','manufacturing_stages')}
READS={t:sql.SQL('SELECT to_jsonb(t) FROM public.{} t WHERE id=%s AND org_id=%s').format(sql.Identifier(t)) for t in ('products','manufacturing_orders','work_orders','material_reservations')}
trace=[]
mutex=threading.Lock()

def guard():
 try: port=int(os.environ.get('PGPORT','0'))
 except ValueError: raise SystemExit('REFUSED_NON_DISPOSABLE_DATABASE')
 if (os.environ.get('PGHOST')!='127.0.0.1' or port<55000 or port>65535
     or not os.environ.get('PGDATABASE','').startswith('wardah_issue_parent_198_canonical_qc199_')
     or any(os.environ.get(k) for k in ('DATABASE_URL','SUPABASE_DB_URL','PGSERVICE','PGHOSTADDR'))):
  raise SystemExit('REFUSED_NON_DISPOSABLE_DATABASE')

def connection(actor=None):
 c=psycopg.connect('')
 c.execute("SET statement_timeout='15s'")
 if actor:
  c.execute("SELECT set_config('request.jwt.claim.sub',%s,true)",(ACTORS[actor],))
  c.execute('SET LOCAL ROLE authenticated')
 return c

def snapshot():
 with connection() as c:
  c.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
  state={t:c.execute(q).fetchone()[0] for t,q in SNAPSHOTS.items()}
  state['database']=c.execute('SELECT current_database()').fetchone()[0]
  with mutex: state['trace']=trace.copy()
  return state

def encode(v):
 if isinstance(v,decimal.Decimal): return float(v)
 if isinstance(v,(datetime.datetime,datetime.date,uuid.UUID)): return str(v)
 raise TypeError(type(v).__name__)

def catalog(c,request):
 table=request['table']; filters=request.get('filters',{})
 if request['org']!=ORG: raise ValueError('UNREVIEWED_FIXTURE_READ')
 if filters=={'status':['in_progress','quality_check']} and table=='manufacturing_orders' and request['limit']==100:
  rows=c.execute("SELECT to_jsonb(t) FROM public.manufacturing_orders t WHERE org_id=%s AND status IN ('in_progress','quality_check') ORDER BY order_number LIMIT 100",(ORG,))
 elif filters=={'is_active':True} and table=='manufacturing_stages':
  rows=c.execute('SELECT to_jsonb(t) FROM public.manufacturing_stages t WHERE org_id=%s AND is_active=true ORDER BY order_sequence',(ORG,))
 elif not filters and request['limit']==500:
  rows=c.execute(CATALOG[table],(ORG,request['after'],request['after'],500))
 else: raise ValueError('UNREVIEWED_FIXTURE_READ')
 return [r[0] for r in rows.fetchall()]

def rpc(c,request):
 keys,q=RPCS[request['name']]; args=request['args']
 values=[Jsonb(args[k]) if isinstance(args.get(k),(dict,list)) else args.get(k) for k in keys]
 return c.execute(q,values).fetchone()[0]

def perform(request):
 actor=request['actor']; ACTORS[actor]
 with connection(actor) as c:
  if request['kind']=='rpc': data=rpc(c,request)
  elif request['kind']=='read':
   row=c.execute(READS[request['table']],(request['id'],ORG)).fetchone(); data=row[0] if row else None
  elif request['kind']=='catalog': data=catalog(c,request)
  else: raise ValueError('UNREVIEWED_FIXTURE_KIND')
 if request['kind']=='rpc':
  with mutex: trace.append({'actor':actor,'name':request['name'],'args':request['args'],'error':None,'data':data})
 return {'data':data,'error':None}

def fixture_grants(request):
 key=request['key']; enabled=request['enabled']
 if key not in ('manufacturing.quality_inspections.create','manufacturing.quality_inspections.read') or type(enabled) is not bool:
  raise ValueError('UNREVIEWED_FIXTURE_GRANT')
 with connection() as c:
  if enabled: c.execute("INSERT INTO public.role_permissions(role_id,permission_id) SELECT 'ed000000-0000-4000-8000-0000000000b2',id FROM public.permissions WHERE permission_key=%s ON CONFLICT DO NOTHING",(key,))
  else: c.execute("DELETE FROM public.role_permissions WHERE role_id='ed000000-0000-4000-8000-0000000000b2' AND permission_id IN (SELECT id FROM public.permissions WHERE permission_key=%s)",(key,))
 return {'updated':True}

class Handler(BaseHTTPRequestHandler):
 def log_message(self,*_args): pass
 def reply(self,value):
  body=json.dumps(value,default=encode).encode()
  self.send_response(200); self.send_header('Content-Type','application/json'); self.end_headers(); self.wfile.write(body)
 def do_GET(self):
  if self.path!='/state': self.send_error(404); return
  self.reply(snapshot())
 def do_POST(self):
  request={}
  try:
   request=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
   if self.path=='/fixture-grants': self.reply(fixture_grants(request))
   elif self.path=='/call': self.reply(perform(request))
   else: self.send_error(404)
  except psycopg.Error as e:
   error={'code':e.sqlstate,'message':e.diag.message_primary}
   with mutex: trace.append({'actor':request.get('actor'),'name':request.get('name'),'args':request.get('args'),'error':error})
   self.reply({'data':None,'error':error})
  except (KeyError,ValueError,TypeError): self.send_error(400)

if __name__=='__main__':
 guard()
 ThreadingHTTPServer(('127.0.0.1',4178),Handler).serve_forever()
