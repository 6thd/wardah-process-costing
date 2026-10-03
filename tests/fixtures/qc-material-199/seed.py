"""Owner-only fixture grants/policy; never replace canonical functions."""
from psycopg.types.json import Jsonb
from bridge import ORG, connection, guard

guard()
with connection() as c:
    c.execute("""INSERT INTO public.role_permissions(role_id,permission_id)
        SELECT r.id,p.id FROM public.roles r CROSS JOIN public.permissions p
        WHERE (r.id=%s AND p.permission_key=ANY(%s))
           OR (r.id=%s AND p.permission_key=ANY(%s)) ON CONFLICT DO NOTHING""",
        ('ed000000-0000-4000-8000-0000000000b1',
         ['manufacturing.material_issue_setup.prepare','manufacturing.material_reservation.reserve','manufacturing.material_reservation.release'],
         'ed000000-0000-4000-8000-0000000000b2',
         ['manufacturing.quality_inspections.read','manufacturing.quality_inspections.create','manufacturing.stages.read']))
    c.execute("SELECT set_config('request.jwt.claim.sub',%s,true)",
              ('ed000000-0000-4000-8000-0000000000a1',))
    c.execute('SELECT public.rpc_set_quality_policy(%s,%s,%s)',
              (ORG,Jsonb({'release_gate_mode':'all_orders','inspection_scope':'final_only',
                'allow_conditional_release':False,'segregation_of_duties':True,
                'admins_subject_to_quality_controls':True}),1))
