-- Owner-only seed, never replace canonical functions or reopen quarantine.
INSERT INTO public.role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM public.roles r CROSS JOIN public.permissions p
WHERE (r.id='ed000000-0000-4000-8000-0000000000b1' AND p.permission_key IN
 ('manufacturing.material_issue_setup.prepare','manufacturing.material_reservation.reserve','manufacturing.material_reservation.release'))
 OR (r.id='ed000000-0000-4000-8000-0000000000b2' AND p.permission_key IN
 ('manufacturing.quality_inspections.read','manufacturing.quality_inspections.create','manufacturing.stages.read'))
ON CONFLICT DO NOTHING;
-- Local operator sets the release policy; keep segregation enforced.
SELECT set_config('request.jwt.claim.sub','ed000000-0000-4000-8000-0000000000a1',false);
SELECT public.rpc_set_quality_policy('ed000000-0000-4000-8000-000000000001',
 '{"release_gate_mode":"all_orders","inspection_scope":"final_only","allow_conditional_release":false,"segregation_of_duties":true,"admins_subject_to_quality_controls":true}',1);
