"""Loopback-only test adapter to disposable PG17; NOT Supabase/Auth acceptance."""
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import psycopg
from psycopg.types.json import Jsonb

if (os.environ.get('PGHOST') != '127.0.0.1'
        or int(os.environ.get('PGPORT', '0')) < 55000
        or not os.environ.get('PGDATABASE', '').startswith((
            'wardah_issue_combined_', 'wardah_issue_parent_198_canonical_browser_',
            'wardah_issue_parent_198_canonical_auth_browser_'))
        or any(os.environ.get(k) for k in ('DATABASE_URL', 'PGSERVICE', 'SUPABASE_DB_URL', 'PGHOSTADDR'))):
    raise SystemExit('REFUSED_NON_DISPOSABLE_DATABASE')
ORG = 'ed000000-0000-4000-8000-000000000001'
ACTOR = 'ed000000-0000-4000-8000-0000000000a2'
RPCS = {
    'rpc_manage_material_issue_setup': (['p_org_id', 'p_event_id', 'p_command', 'p_actor_id'], "SELECT public.rpc_manage_material_issue_setup(%s,%s,%s,%s)"),
    'rpc_reconcile_material_issue_setup': (['p_org_id', 'p_event_id', 'p_command', 'p_actor_id'], "SELECT public.rpc_reconcile_material_issue_setup(%s,%s,%s,%s)"),
    'rpc_get_material_reservation_setup': (['p_org_id', 'p_item_id'], "SELECT public.rpc_get_material_reservation_setup(%s,%s)"),
    'rpc_list_material_issue_orders': (['p_org_id'], "SELECT public.rpc_list_material_issue_orders(%s)"),
    'rpc_get_material_issue_context': (['p_mo_id'], "SELECT public.rpc_get_material_issue_context(%s)"),
    'rpc_get_material_issue_wo_statuses': (['p_org_id'], "SELECT public.rpc_get_material_issue_wo_statuses(%s)"),
    'rpc_consume_material_event': (['p_mo_id', 'p_stage_id', 'p_event_id', 'p_consumptions'], "SELECT public.rpc_consume_material_event(%s,%s,%s,%s)"),
}
READS = {
    'products': "SELECT to_jsonb(t) FROM public.products t WHERE id=%s AND org_id=%s",
    'manufacturing_orders': "SELECT to_jsonb(t) FROM public.manufacturing_orders t WHERE id=%s AND org_id=%s",
    'work_orders': "SELECT to_jsonb(t) FROM public.work_orders t WHERE id=%s AND org_id=%s",
    'material_reservations': "SELECT to_jsonb(t) FROM public.material_reservations t WHERE id=%s AND org_id=%s",
}
CATALOG = {
    'products': "SELECT to_jsonb(t) FROM public.products t WHERE org_id=%s AND (%s::uuid IS NULL OR id>%s::uuid) ORDER BY id LIMIT %s",
    'items': "SELECT to_jsonb(t) FROM public.items t WHERE org_id=%s AND (%s::uuid IS NULL OR id>%s::uuid) ORDER BY id LIMIT %s",
    'manufacturing_orders': "SELECT to_jsonb(t) FROM public.manufacturing_orders t WHERE org_id=%s AND (%s::uuid IS NULL OR id>%s::uuid) ORDER BY id LIMIT %s",
    'work_orders': "SELECT to_jsonb(t) FROM public.work_orders t WHERE org_id=%s AND (%s::uuid IS NULL OR id>%s::uuid) ORDER BY id LIMIT %s",
    'material_reservations': "SELECT to_jsonb(t) FROM public.material_reservations t WHERE org_id=%s AND (%s::uuid IS NULL OR id>%s::uuid) ORDER BY id LIMIT %s",
    'work_centers': "SELECT to_jsonb(t) FROM public.work_centers t WHERE org_id=%s AND (%s::uuid IS NULL OR id>%s::uuid) ORDER BY id LIMIT %s",
    'manufacturing_stages': "SELECT to_jsonb(t) FROM public.manufacturing_stages t WHERE org_id=%s AND (%s::uuid IS NULL OR id>%s::uuid) ORDER BY id LIMIT %s",
}
SNAPSHOTS = {
    'manufacturing_orders': "SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) FROM public.manufacturing_orders t",
    'work_orders': "SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) FROM public.work_orders t",
    'material_reservations': "SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) FROM public.material_reservations t",
    'stage_wip_log': "SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) FROM public.stage_wip_log t",
    'material_consumption': "SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) FROM public.material_consumption t",
    'bins': "SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) FROM public.bins t",
    'stock_ledger_entries': "SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) FROM public.stock_ledger_entries t",
    'products': "SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) FROM public.products t",
    'gl_entries': "SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) FROM public.gl_entries t",
    'gl_entry_lines': "SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) FROM public.gl_entry_lines t",
    'journal_lines': "SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) FROM public.journal_lines t",
    'journal_entries': "SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) FROM public.journal_entries t",
}
trace = []


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def reply(self, value):
        body = json.dumps(value, default=lambda v: float(v)).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path != '/state':
            self.send_error(404)
            return
        with psycopg.connect('') as conn:
            state = {}
            for table, query in SNAPSHOTS.items():
                state[table] = conn.execute(query).fetchone()[0]
            state['events'] = conn.execute('SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY event_id),\'[]\'::jsonb) FROM wardah_internal.material_issue_events t').fetchone()[0]
            state['setup_events'] = conn.execute("SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY event_id),'[]'::jsonb) FROM wardah_internal.material_issue_maintenance_events t").fetchone()[0]
            state['trace'] = trace.copy()
        self.reply(state)

    def do_POST(self):
        if self.path == '/fixture-grants':
            request = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            keys = request.get('keys')
            allowed = {'manufacturing.material_issue_setup.prepare', 'manufacturing.material_reservation.reserve',
                       'manufacturing.material_reservation.release', 'manufacturing.material_consumption.consume'}
            if not isinstance(keys, list) or any(key not in allowed for key in keys) or not isinstance(request.get('enabled'), bool):
                self.send_error(400)
                return
            with psycopg.connect('') as conn:
                for key in keys:
                    if request['enabled']:
                        conn.execute("INSERT INTO public.role_permissions(role_id,permission_id) SELECT 'ed000000-0000-4000-8000-0000000000b1',id FROM public.permissions WHERE permission_key=%s ON CONFLICT DO NOTHING", (key,))
                    else:
                        conn.execute("DELETE FROM public.role_permissions WHERE role_id='ed000000-0000-4000-8000-0000000000b1' AND permission_id IN (SELECT id FROM public.permissions WHERE permission_key=%s)", (key,))
            self.reply({'fixture_grants_updated': True})
            return
        if self.path != '/call':
            self.send_error(404)
            return
        request = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        try:
            with psycopg.connect('') as conn:
                conn.execute("SET statement_timeout='15s'")
                conn.execute("SELECT set_config('request.jwt.claim.sub',%s,true)", (ACTOR,))
                conn.execute('SET LOCAL ROLE authenticated')
                if request['kind'] == 'rpc':
                    name, args = request['name'], request['args']
                    keys, query = RPCS[name]
                    values = [Jsonb(args[k]) if isinstance(args[k], (dict, list)) else args[k] for k in keys]
                    data = conn.execute(query, values).fetchone()[0]
                    trace.append({'name': name, 'args': args})
                elif request['kind'] == 'catalog':
                    if request['table'] not in CATALOG or request['org'] != ORG or request['limit'] != 500 or (request['after'] is not None and not isinstance(request['after'], str)):
                        raise ValueError('UNREVIEWED_FIXTURE_READ')
                    data = [row[0] for row in conn.execute(CATALOG[request['table']], (ORG, request['after'], request['after'], request['limit'])).fetchall()]
                else:
                    table = request['table']
                    if table not in READS:
                        raise ValueError('UNREVIEWED_FIXTURE_READ')
                    data = conn.execute(READS[table], (request['id'], ORG)).fetchone()
                    data = data[0] if data else None
            self.reply({'data': data, 'error': None})
        except psycopg.Error as error:
            self.reply({'data': None, 'error': {'code': error.sqlstate, 'message': error.diag.message_primary}})


ThreadingHTTPServer(('127.0.0.1', 4178), Handler).serve_forever()
