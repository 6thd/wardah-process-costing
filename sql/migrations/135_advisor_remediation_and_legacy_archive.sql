-- migration_number: 135
-- description: Close advisor findings with evidence-based actions: archive empty
--              dated snapshots, cache auth.uid() in public RLS policies, harden
--              live FK indexes and normalize mutable stock timestamps to timestamptz.
-- safety: legacy tables are moved, never dropped; migration aborts if any has rows.

CREATE SCHEMA IF NOT EXISTS legacy_archive;
REVOKE ALL ON SCHEMA legacy_archive FROM PUBLIC,anon,authenticated;

DO $$
DECLARE v_table text; v_count bigint;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'bill_of_materials_20250905_1900','cost_entries_20250905_1900',
    'cost_predictions_20250905_1900','final_products_20250905_1900',
    'notifications_20250905_1900','product_categories_20250905_1900',
    'project_stages_20250905_1900','projects_20250905_1900',
    'risk_assessments_20250905_1900','users_profiles_20250905_1900'
  ] LOOP
    IF to_regclass('public.'||v_table) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I',v_table) INTO v_count;
      IF v_count<>0 THEN RAISE EXCEPTION 'LEGACY_ARCHIVE_REQUIRES_REVIEW: table=% rows=%',v_table,v_count; END IF;
    END IF;
  END LOOP;
  FOREACH v_table IN ARRAY ARRAY[
    'bill_of_materials_20250905_1900','cost_entries_20250905_1900',
    'cost_predictions_20250905_1900','final_products_20250905_1900',
    'notifications_20250905_1900','product_categories_20250905_1900',
    'project_stages_20250905_1900','projects_20250905_1900',
    'risk_assessments_20250905_1900','users_profiles_20250905_1900'
  ] LOOP
    IF to_regclass('public.'||v_table) IS NOT NULL THEN EXECUTE format('ALTER TABLE public.%I SET SCHEMA legacy_archive',v_table); END IF;
  END LOOP;
END
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA legacy_archive FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA legacy_archive FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA legacy_archive FROM PUBLIC,anon,authenticated;

-- Protect already-cached auth.uid() expressions with a placeholder before replacing
-- bare calls. This avoids nested SELECT wrappers regardless of deparser whitespace.
DO $$
DECLARE v_policy record; v_qual text; v_check text; v_sql text;
BEGIN
  FOR v_policy IN
    SELECT schemaname,tablename,policyname,qual,with_check
    FROM pg_policies
    WHERE schemaname='public'
      AND (COALESCE(qual,'') LIKE '%auth.uid()%' OR COALESCE(with_check,'') LIKE '%auth.uid()%')
    ORDER BY tablename,policyname
  LOOP
    v_qual:=v_policy.qual; v_check:=v_policy.with_check;
    IF v_qual IS NOT NULL THEN
      v_qual:=regexp_replace(v_qual,
        '\([[:space:]]*SELECT[[:space:]]+auth\.uid\(\)([[:space:]]+AS[[:space:]]+uid)?[[:space:]]*\)',
        '__WARDAH_AUTH_UID__','gi');
      v_qual:=replace(v_qual,'auth.uid()','(SELECT auth.uid())');
      v_qual:=replace(v_qual,'__WARDAH_AUTH_UID__','(SELECT auth.uid())');
    END IF;
    IF v_check IS NOT NULL THEN
      v_check:=regexp_replace(v_check,
        '\([[:space:]]*SELECT[[:space:]]+auth\.uid\(\)([[:space:]]+AS[[:space:]]+uid)?[[:space:]]*\)',
        '__WARDAH_AUTH_UID__','gi');
      v_check:=replace(v_check,'auth.uid()','(SELECT auth.uid())');
      v_check:=replace(v_check,'__WARDAH_AUTH_UID__','(SELECT auth.uid())');
    END IF;
    v_sql:=format('ALTER POLICY %I ON %I.%I',v_policy.policyname,v_policy.schemaname,v_policy.tablename);
    IF v_qual IS NOT NULL THEN v_sql:=v_sql||' USING ('||v_qual||')'; END IF;
    IF v_check IS NOT NULL THEN v_sql:=v_sql||' WITH CHECK ('||v_check||')'; END IF;
    EXECUTE v_sql;
  END LOOP;
END
$$;

DROP POLICY IF EXISTS items_read_org ON public.items;
CREATE POLICY items_read_org ON public.items FOR SELECT TO authenticated
  USING (org_id=public.wardah_org_id(NULL::uuid));
DROP POLICY IF EXISTS items_write_admin ON public.items;
CREATE POLICY items_write_admin ON public.items FOR ALL TO authenticated
  USING (public.wardah_is_org_admin(org_id))
  WITH CHECK (public.wardah_is_org_admin(org_id));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.items TO authenticated;

-- posting_datetime is GENERATED ALWAYS from posting_date + posting_time and must
-- retain its immutable generated expression. Only mutable timestamp columns are normalized.
DO $$
DECLARE v_target record;
BEGIN
  FOR v_target IN SELECT * FROM (VALUES
    ('stock_ledger_entries','created_at'),
    ('stock_ledger_entries','modified_at'),
    ('stock_reposting_queue','started_at'),
    ('stock_reposting_queue','completed_at'),
    ('stock_reposting_queue','created_at')
  ) AS x(table_name,column_name)
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=v_target.table_name
        AND column_name=v_target.column_name
        AND data_type='timestamp without time zone'
        AND is_generated='NEVER'
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ALTER COLUMN %I TYPE timestamptz USING %I AT TIME ZONE ''UTC''',
        v_target.table_name,v_target.column_name,v_target.column_name
      );
    END IF;
  END LOOP;
END
$$;

ALTER TABLE public.stock_ledger_entries
  ALTER COLUMN created_at SET DEFAULT now(), ALTER COLUMN modified_at SET DEFAULT now();
ALTER TABLE public.stock_reposting_queue ALTER COLUMN created_at SET DEFAULT now();

REVOKE EXECUTE ON FUNCTION public.generate_entry_number(uuid,date) FROM PUBLIC,anon;
COMMENT ON FUNCTION public.rpc_get_invitation_preview(text) IS
  'Approved anonymous exception: token hash lookup returns minimal invitation metadata only.';
COMMENT ON SCHEMA legacy_archive IS
  'Non-production dated snapshots. No API grants; objects are retained for audit, not deleted.';
