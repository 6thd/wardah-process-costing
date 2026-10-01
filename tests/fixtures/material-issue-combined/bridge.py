"""Loopback-only test adapter to disposable PG17; NOT Supabase/Auth acceptance."""
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import psycopg
from psycopg import sql
from psycopg.types.json import Jsonb

if (os.environ.get('PGHOST') != '127.0.0.1'
        or int(os.environ.get('PGPORT', '0')) < 55000
        or not os.environ.get('PGDATABASE', '').startswith('wardah_issue_combined_')
        or any(os.environ.get(k) for k in ('DATABASE_URL', 'PGSERVICE', 'SUPABASE_DB_URL'))):
    raise SystemExit('REFUSED_NON_DISPOSABLE_DATABASE')
ORG = 'ed000000-0000-4000-8000-000000000001'
ACTOR = 'ed000000-0000-4000-8000-0000000000a2'
RPCS = {
    'rpc_manage_material_issue_setup': ['p_org_id', 'p_event_id', 'p_command', 'p_actor_id'],
    'rpc_reconcile_material_issue_setup': ['p_org_id', 'p_event_id', 'p_command', 'p_actor_id'],
    'rpc_get_material_reservation_setup': ['p_org_id', 'p_item_id'],
    'rpc_list_material_issue_orders': ['p_org_id'],
    'rpc_get_material_issue_context': ['p_mo_id'],
    'rpc_get_material_issue_wo_statuses': ['p_org_id'],
    'rpc_consume_material_event': ['p_mo_id', 'p_stage_id', 'p_event_id', 'p_consumptions'],
}
READS = {'products', 'manufacturing_orders', 'work_orders', 'material_reservations'}
trace = []


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def reply(self, value):
        body = json.dumps(value, default=lambda v: float(v)).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', 'http://127.0.0.1:4177')
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', 'http://127.0.0.1:4177')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.end_headers()

    def do_GET(self):
        if self.path != '/state':
            self.send_error(404)
            return
        with psycopg.connect('') as conn:
            state = {}
            for table in ('manufacturing_orders', 'work_orders', 'material_reservations',
                          'stage_wip_log', 'material_consumption', 'bins', 'stock_ledger_entries',
                          'products', 'gl_entries', 'gl_entry_lines', 'journal_entries'):
                state[table] = conn.execute(sql.SQL('SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY id),\'[]\'::jsonb) FROM public.{} t').format(sql.Identifier(table))).fetchone()[0]
            state['events'] = conn.execute('SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY event_id),\'[]\'::jsonb) FROM wardah_internal.material_issue_events t').fetchone()[0]
            state['trace'] = trace.copy()
        self.reply(state)

    def do_POST(self):
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
                    keys = RPCS[name]
                    values = [Jsonb(args[k]) if isinstance(args[k], (dict, list)) else args[k] for k in keys]
                    query = sql.SQL('SELECT public.{}({})').format(sql.Identifier(name), sql.SQL(',').join([sql.Placeholder()] * len(keys)))
                    data = conn.execute(query, values).fetchone()[0]
                    trace.append({'name': name, 'args': args})
                else:
                    table = request['table']
                    if table not in READS:
                        raise ValueError('UNREVIEWED_FIXTURE_READ')
                    data = conn.execute(sql.SQL('SELECT to_jsonb(t) FROM public.{} t WHERE id=%s AND org_id=%s').format(sql.Identifier(table)), (request['id'], ORG)).fetchone()
                    data = data[0] if data else None
            self.reply({'data': data, 'error': None})
        except psycopg.Error as error:
            self.reply({'data': None, 'error': {'code': error.sqlstate, 'message': error.diag.message_primary}})


ThreadingHTTPServer(('127.0.0.1', 4178), Handler).serve_forever()
