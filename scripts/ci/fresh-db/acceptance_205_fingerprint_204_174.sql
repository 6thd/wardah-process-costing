-- Fingerprint of everything Migration 205 must leave unchanged: the 174 permission functions, every 204
-- function, trigger, table definition and ACL, the M201 functions 205 relies on, and the rows of the six
-- 204 tables. create_role_from_template is the one function 205 edits (section 1b): here only its ACL,
-- owner, SECURITY DEFINER and settings; acceptance_205_unchanged_204_174.sh checks its body edits. One line per object; acceptance_205_unchanged_204_174.sh compares the output before and
-- after 205 (and after a legacy resolution). Read-only.
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

SELECT 'fn|' || p.oid::regprocedure::text || '|' || md5(pg_get_functiondef(p.oid)) || '|' || COALESCE(p.proacl::text, 'default')
       || '|' || p.prosecdef || '|' || COALESCE(array_to_string(p.proconfig, ','), '')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE (n.nspname = 'public' AND p.proname IN (
         'has_permission', 'wardah_is_sensitive_permission', 'wardah_has_exact_permission', 'rpc_upsert_org_role',
         'rpc_replace_user_roles', 'rpc_delete_org_role', 'rpc_permission_snapshot', 'wardah_is_org_admin',
         'wardah_assert_org_member', 'is_super_admin',
         'rpc_get_mfg_cost_policy', 'rpc_create_mfg_cost_policy_version', 'rpc_withdraw_mfg_cost_policy_version',
         'rpc_preview_mfg_cost_absorption'))
   OR (n.nspname = 'wardah_internal' AND (p.proname LIKE '%\_204' ESCAPE '\' OR p.proname = 'manufacturing_settings_can_update_201'))
ORDER BY 1;

SELECT 'fnacl|' || p.oid::regprocedure::text || '|' || COALESCE(p.proacl::text, 'default') || '|' || p.proowner::regrole::text
       || '|' || p.prosecdef || '|' || COALESCE(array_to_string(p.proconfig, ','), '')
FROM pg_proc p WHERE p.oid = 'public.create_role_from_template(uuid,uuid,character varying,uuid)'::regprocedure;

SELECT 'trg|' || c.relname || '|' || t.tgname || '|' || md5(pg_get_triggerdef(t.oid)) || '|' || t.tgenabled::text
FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE NOT t.tgisinternal AND (
  (n.nspname = 'public' AND c.relname = 'manufacturing_orders')
  OR (n.nspname = 'wardah_internal' AND c.relname IN ('mfg_cost_policy_versions', 'mfg_cost_policy_pools', 'mfg_cost_policy_wc_rules',
        'mfg_cost_policy_wc_pool_rules', 'mo_cost_policy_pin_timing', 'mo_cost_policy_pins')))
ORDER BY 1;

SELECT 'col|' || c.relname || '|' || a.attnum || '|' || a.attname || '|' || format_type(a.atttypid, a.atttypmod) || '|' || a.attnotnull
       || '|' || COALESCE(pg_get_expr(d.adbin, d.adrelid), '')
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
WHERE n.nspname = 'wardah_internal' AND c.relname IN ('mfg_cost_policy_versions', 'mfg_cost_policy_pools', 'mfg_cost_policy_wc_rules',
        'mfg_cost_policy_wc_pool_rules', 'mo_cost_policy_pin_timing', 'mo_cost_policy_pins')
ORDER BY 1;

SELECT 'con|' || c.relname || '|' || k.conname || '|' || pg_get_constraintdef(k.oid)
FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'wardah_internal' AND c.relname IN ('mfg_cost_policy_versions', 'mfg_cost_policy_pools', 'mfg_cost_policy_wc_rules',
        'mfg_cost_policy_wc_pool_rules', 'mo_cost_policy_pin_timing', 'mo_cost_policy_pins')
ORDER BY 1;

SELECT 'idx|' || i.tablename || '|' || i.indexname || '|' || i.indexdef
FROM pg_indexes i
WHERE i.schemaname = 'wardah_internal' AND i.tablename IN ('mfg_cost_policy_versions', 'mfg_cost_policy_pools', 'mfg_cost_policy_wc_rules',
        'mfg_cost_policy_wc_pool_rules', 'mo_cost_policy_pin_timing', 'mo_cost_policy_pins')
ORDER BY 1;

SELECT 'acl|' || c.relname || '|' || COALESCE(c.relacl::text, 'default')
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'wardah_internal' AND c.relname IN ('mfg_cost_policy_versions', 'mfg_cost_policy_pools', 'mfg_cost_policy_wc_rules',
        'mfg_cost_policy_wc_pool_rules', 'mo_cost_policy_pin_timing', 'mo_cost_policy_pins')
ORDER BY 1;

SELECT 'rows|' || t.name || '|' || t.n || '|' || COALESCE(t.h, 'empty') FROM (
  SELECT 'mfg_cost_policy_versions' AS name, count(*) AS n, md5(string_agg(to_jsonb(x)::text, '|' ORDER BY to_jsonb(x)::text)) AS h FROM wardah_internal.mfg_cost_policy_versions x
  UNION ALL SELECT 'mfg_cost_policy_pools', count(*), md5(string_agg(to_jsonb(x)::text, '|' ORDER BY to_jsonb(x)::text)) FROM wardah_internal.mfg_cost_policy_pools x
  UNION ALL SELECT 'mfg_cost_policy_wc_rules', count(*), md5(string_agg(to_jsonb(x)::text, '|' ORDER BY to_jsonb(x)::text)) FROM wardah_internal.mfg_cost_policy_wc_rules x
  UNION ALL SELECT 'mfg_cost_policy_wc_pool_rules', count(*), md5(string_agg(to_jsonb(x)::text, '|' ORDER BY to_jsonb(x)::text)) FROM wardah_internal.mfg_cost_policy_wc_pool_rules x
  UNION ALL SELECT 'mo_cost_policy_pin_timing', count(*), md5(string_agg(to_jsonb(x)::text, '|' ORDER BY to_jsonb(x)::text)) FROM wardah_internal.mo_cost_policy_pin_timing x
  UNION ALL SELECT 'mo_cost_policy_pins', count(*), md5(string_agg(to_jsonb(x)::text, '|' ORDER BY to_jsonb(x)::text)) FROM wardah_internal.mo_cost_policy_pins x) t
ORDER BY 1;
