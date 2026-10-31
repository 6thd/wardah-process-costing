-- The functions Migration 205 relies on, with the md5 of each body (pg_proc.prosrc), one line per function as
-- signature|md5. Read-only. pin_205_preflight.py takes these lines on stdin and writes or checks the preflight pins.
--   psql -X -At -v ON_ERROR_STOP=1 -d <database through 204> -f scripts/ci/fresh-db/acceptance_205_preflight_pins.sql
SELECT e.sig || '|' || COALESCE(md5(p.prosrc), 'MISSING')
FROM (VALUES
  ('public.create_role_from_template(uuid,uuid,character varying,uuid)'),   -- M201 body, edited by 205 section 1b
  ('public.has_permission(uuid,uuid,character varying)'),
  ('public.wardah_is_sensitive_permission(text)'),
  ('public.wardah_is_org_admin(uuid)'),
  ('public.wardah_assert_org_member(uuid)'),
  ('wardah_internal.manufacturing_settings_can_update_201(uuid)'),
  ('wardah_internal.mfg_cost_policy_immutable_204()'),
  ('wardah_internal.mfg_cost_policy_org_today_204(uuid,boolean)'),
  ('wardah_internal.mfg_cost_policy_version_at_204(uuid,date)'),
  ('wardah_internal.mfg_cost_policy_can_read_204(uuid)'),
  ('wardah_internal.mfg_cost_policy_version_json_204(uuid,date)'),
  ('wardah_internal.mfg_cost_policy_compute_204(uuid,uuid,uuid,numeric,numeric,numeric)'),
  ('wardah_internal.pin_mo_cost_policy_204()'),
  ('wardah_internal.pin_mo_cost_policy_on_start_204()')
) AS e(sig)
LEFT JOIN pg_proc p ON p.oid = to_regprocedure(e.sig)
ORDER BY e.sig;
