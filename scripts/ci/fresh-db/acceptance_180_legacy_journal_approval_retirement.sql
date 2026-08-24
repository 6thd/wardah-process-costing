\set ON_ERROR_STOP on

DO $do$
BEGIN
  IF to_regclass('public.journal_entry_approvals') IS NULL THEN
    RAISE EXCEPTION 'J180 legacy approval table was removed';
  END IF;
  IF to_regprocedure('public.check_entry_approval_required(uuid)') IS NULL THEN
    RAISE EXCEPTION 'J180 legacy approval check function was removed';
  END IF;
  IF to_regprocedure('public.approve_journal_entry(uuid,integer,text)') IS NULL THEN
    RAISE EXCEPTION 'J180 legacy approval mutation function was removed';
  END IF;

  IF has_table_privilege('anon','public.journal_entry_approvals','SELECT')
     OR has_table_privilege('anon','public.journal_entry_approvals','INSERT')
     OR has_table_privilege('anon','public.journal_entry_approvals','UPDATE')
     OR has_table_privilege('anon','public.journal_entry_approvals','DELETE') THEN
    RAISE EXCEPTION 'J180 anon still has legacy approval table access';
  END IF;

  IF has_table_privilege('authenticated','public.journal_entry_approvals','SELECT')
     OR has_table_privilege('authenticated','public.journal_entry_approvals','INSERT')
     OR has_table_privilege('authenticated','public.journal_entry_approvals','UPDATE')
     OR has_table_privilege('authenticated','public.journal_entry_approvals','DELETE') THEN
    RAISE EXCEPTION 'J180 authenticated still has legacy approval table access';
  END IF;

  IF has_table_privilege('service_role','public.journal_entry_approvals','SELECT')
     OR has_table_privilege('service_role','public.journal_entry_approvals','INSERT')
     OR has_table_privilege('service_role','public.journal_entry_approvals','UPDATE')
     OR has_table_privilege('service_role','public.journal_entry_approvals','DELETE') THEN
    RAISE EXCEPTION 'J180 service_role still has legacy approval table access';
  END IF;

  IF has_function_privilege('anon','public.check_entry_approval_required(uuid)','EXECUTE')
     OR has_function_privilege('authenticated','public.check_entry_approval_required(uuid)','EXECUTE')
     OR has_function_privilege('service_role','public.check_entry_approval_required(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'J180 legacy approval check is still executable';
  END IF;

  IF has_function_privilege('anon','public.approve_journal_entry(uuid,integer,text)','EXECUTE')
     OR has_function_privilege('authenticated','public.approve_journal_entry(uuid,integer,text)','EXECUTE')
     OR has_function_privilege('service_role','public.approve_journal_entry(uuid,integer,text)','EXECUTE') THEN
    RAISE EXCEPTION 'J180 legacy approval mutation is still executable';
  END IF;

  -- Canonical lifecycle remains the client-facing journal boundary.
  IF NOT has_function_privilege('authenticated','public.rpc_create_manual_journal_entry(jsonb)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.rpc_post_manual_journal_entry(uuid)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.rpc_reverse_manual_journal_entry(uuid,text,date)','EXECUTE') THEN
    RAISE EXCEPTION 'J180 changed canonical manual journal EXECUTE surface';
  END IF;

  -- The trusted generic primitive hardened in 178/179 must remain closed.
  IF has_function_privilege('authenticated','public.rpc_create_journal_entry(jsonb)','EXECUTE')
     OR has_function_privilege('anon','public.rpc_create_journal_entry(jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'J180 reopened generic journal primitive';
  END IF;
END;
$do$;

SELECT 'LEGACY_JOURNAL_APPROVAL_180_ACCEPTANCE_PASS';
