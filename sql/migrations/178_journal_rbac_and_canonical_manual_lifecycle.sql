-- Migration 178 — canonical manual-journal RBAC boundary (Issue #150)
--
-- Goals:
--   * keep gl_entries/gl_entry_lines as the canonical ledger;
--   * separate manual Journal UI authorization from trusted domain posting;
--   * add first-class post/reverse permissions;
--   * make reverse sensitive (explicit grant required for org admins);
--   * close legacy/internal journal primitives to authenticated clients;
--   * scope entry lookup before authorization so foreign UUIDs do not become
--     a cross-tenant existence oracle;
--   * provide permission-guarded create/update/delete/post/reverse RPCs for
--     manually maintained journals only.
--
-- Production deployment is intentionally NOT part of this migration file's
-- preparation. Validate on Fresh DB first.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Permission catalog: posting and reversal are not CRUD aliases.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_module uuid;
BEGIN
  SELECT id INTO v_module
  FROM public.modules
  WHERE name = 'accounting' AND COALESCE(is_active, true)
  ORDER BY created_at NULLS LAST
  LIMIT 1;

  IF v_module IS NULL THEN
    RAISE EXCEPTION 'JOURNAL_178_ACCOUNTING_MODULE_MISSING';
  END IF;

  INSERT INTO public.permissions (
    module_id, resource, resource_ar, action, action_ar, permission_key,
    description, description_ar
  )
  SELECT v_module, x.resource, x.resource_ar, x.action, x.action_ar,
         x.permission_key, x.description, x.description_ar
  FROM (VALUES
    ('journals'::varchar, 'القيود'::varchar, 'post'::varchar, 'ترحيل'::varchar,
     'accounting.journals.post'::varchar,
     'Post manual journal entries to the general ledger'::text,
     'ترحيل القيود اليومية اليدوية إلى الأستاذ العام'::text),
    ('journals'::varchar, 'القيود'::varchar, 'reverse'::varchar, 'عكس'::varchar,
     'accounting.journals.reverse'::varchar,
     'Reverse posted manual journal entries'::text,
     'عكس القيود اليومية اليدوية المرحلة'::text)
  ) AS x(resource, resource_ar, action, action_ar, permission_key, description, description_ar)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.permissions p WHERE p.permission_key = x.permission_key
  );

  IF (SELECT count(*) FROM public.permissions
      WHERE permission_key IN ('accounting.journals.post','accounting.journals.reverse')) <> 2 THEN
    RAISE EXCEPTION 'JOURNAL_178_PERMISSION_CATALOG_INCOMPLETE';
  END IF;
END;
$$;

-- Reverse is deliberately sensitive: unlike ordinary post/create/update,
-- an org-admin override alone must not authorize financial reversal.
CREATE OR REPLACE FUNCTION public.wardah_is_sensitive_permission(p_permission_key text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p_permission_key IN (
    'accounting.vouchers.unpost',
    'accounting.vouchers.cancel',
    'accounting.journals.reverse'
  );
$function$;

REVOKE ALL ON FUNCTION public.wardah_is_sensitive_permission(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wardah_is_sensitive_permission(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Canonical-ledger provenance and status contract.
--    The old entry_type='manual' value cannot distinguish manual UI entries
--    from system entries because the historical generic posting primitive used
--    it for both. journal_origin becomes the authoritative discriminator.
-- ---------------------------------------------------------------------------
ALTER TABLE public.gl_entries
  ADD COLUMN IF NOT EXISTS journal_origin text;

UPDATE public.gl_entries
SET journal_origin = CASE
  WHEN reference_type IS NULL AND status = 'draft' THEN 'manual_legacy'
  ELSE 'system'
END
WHERE journal_origin IS NULL;

ALTER TABLE public.gl_entries
  ALTER COLUMN journal_origin SET DEFAULT 'system',
  ALTER COLUMN journal_origin SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.gl_entries'::regclass
      AND conname = 'gl_entries_journal_origin_check'
  ) THEN
    ALTER TABLE public.gl_entries
      ADD CONSTRAINT gl_entries_journal_origin_check
      CHECK (journal_origin IN ('system','manual','manual_legacy','manual_reversal'));
  END IF;
END;
$$;

-- The protection trigger already understands "reversed", but the historical
-- CHECK constraint did not. Align the declarative constraint with the trigger.
ALTER TABLE public.gl_entries DROP CONSTRAINT IF EXISTS gl_entries_status_check;
ALTER TABLE public.gl_entries
  ADD CONSTRAINT gl_entries_status_check
  CHECK (status IN ('draft','posted','cancelled','reversed'));

CREATE INDEX IF NOT EXISTS idx_gl_entries_manual_lifecycle
  ON public.gl_entries(org_id, journal_origin, status);

-- ---------------------------------------------------------------------------
-- 3. Internal helpers. They are never client-callable.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wardah_178_assert_permission(
  p_org uuid,
  p_permission_key text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;
  IF p_org IS NULL THEN
    RAISE EXCEPTION 'ORG_UNRESOLVED';
  END IF;
  IF NOT public.wardah_has_exact_permission(v_uid, p_org, p_permission_key) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: %', p_permission_key;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.wardah_178_validate_manual_lines(
  p_org uuid,
  p_lines jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count integer;
  v_bad integer;
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'JOURNAL_LINES_REQUIRED';
  END IF;

  SELECT count(*) INTO v_count FROM jsonb_array_elements(p_lines);
  IF v_count < 2 THEN
    RAISE EXCEPTION 'EMPTY_ENTRY: at least two lines are required';
  END IF;

  SELECT count(*) INTO v_bad
  FROM jsonb_array_elements(p_lines) l
  WHERE NULLIF(l->>'account_id','') IS NULL
     OR COALESCE((l->>'debit')::numeric, 0) < 0
     OR COALESCE((l->>'credit')::numeric, 0) < 0
     OR (COALESCE((l->>'debit')::numeric, 0) > 0
         AND COALESCE((l->>'credit')::numeric, 0) > 0)
     OR (COALESCE((l->>'debit')::numeric, 0) = 0
         AND COALESCE((l->>'credit')::numeric, 0) = 0);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'JOURNAL_INVALID_LINE_SHAPE';
  END IF;

  SELECT count(*) INTO v_bad
  FROM jsonb_array_elements(p_lines) l
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.gl_accounts a
    WHERE a.id = (l->>'account_id')::uuid
      AND a.org_id = p_org
      AND COALESCE(a.is_active, true)
      AND COALESCE(a.allow_posting, true)
  );
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'JOURNAL_ACCOUNT_NOT_POSTABLE_IN_ORG';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.wardah_178_assert_permission(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wardah_178_validate_manual_lines(uuid,jsonb) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Public canonical manual-journal lifecycle.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_create_manual_journal_entry(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_org uuid;
  v_payload jsonb;
  v_result jsonb;
  v_entry uuid;
  v_client_idem text;
  v_internal_idem text;
  v_existing_origin text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  v_org := public.wardah_org_id(NULLIF(p_payload->>'org_id','')::uuid);
  PERFORM public.wardah_178_assert_permission(v_org, 'accounting.journals.create');

  IF COALESCE((p_payload->>'auto_post')::boolean, false) THEN
    RAISE EXCEPTION 'JOURNAL_AUTO_POST_FORBIDDEN: use rpc_post_manual_journal_entry';
  END IF;

  PERFORM public.wardah_178_validate_manual_lines(v_org, p_payload->'lines');

  v_client_idem := NULLIF(p_payload->>'idempotency_key','');
  IF v_client_idem IS NOT NULL THEN
    v_internal_idem := 'manual:' || v_org::text || ':' || v_client_idem;
    SELECT journal_origin INTO v_existing_origin
    FROM public.gl_entries
    WHERE org_id = v_org AND idempotency_key = v_internal_idem
    LIMIT 1;
    IF v_existing_origin IS NOT NULL
       AND v_existing_origin NOT IN ('manual','manual_legacy') THEN
      RAISE EXCEPTION 'JOURNAL_IDEMPOTENCY_NAMESPACE_COLLISION';
    END IF;
  END IF;

  v_payload := p_payload || jsonb_build_object(
    'org_id', v_org::text,
    'auto_post', false
  );
  IF v_internal_idem IS NOT NULL THEN
    v_payload := v_payload || jsonb_build_object('idempotency_key', v_internal_idem);
  ELSE
    v_payload := v_payload - 'idempotency_key';
  END IF;

  v_result := public.rpc_create_journal_entry(v_payload);
  v_entry := NULLIF(v_result->>'entry_id','')::uuid;
  IF v_entry IS NULL THEN RAISE EXCEPTION 'JOURNAL_CREATE_RETURNED_NO_ENTRY'; END IF;

  UPDATE public.gl_entries
  SET journal_origin = 'manual',
      created_by = COALESCE(created_by, v_uid),
      updated_at = now()
  WHERE id = v_entry AND org_id = v_org
    AND journal_origin IN ('system','manual','manual_legacy');

  IF NOT FOUND THEN RAISE EXCEPTION 'JOURNAL_CREATE_ORIGIN_MISMATCH'; END IF;

  INSERT INTO public.audit_logs(org_id,user_id,action,entity_type,entity_id,metadata)
  VALUES (v_org,v_uid,'journal.manual.create','gl_entry',v_entry::text,
          jsonb_build_object('migration',178));

  RETURN v_result || jsonb_build_object('journal_origin','manual');
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_update_manual_journal_entry(
  p_entry_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_old public.gl_entries%rowtype;
  v_entry_date date;
  v_journal uuid;
  v_total_debit numeric;
  v_total_credit numeric;
  v_line_count integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT ge.* INTO v_old
  FROM public.gl_entries ge
  WHERE ge.id = p_entry_id
    AND (
      EXISTS (
        SELECT 1 FROM public.super_admins sa
        WHERE sa.user_id = v_uid AND sa.is_active = true
      )
      OR EXISTS (
        SELECT 1 FROM public.user_organizations uo
        WHERE uo.user_id = v_uid
          AND uo.org_id = ge.org_id
          AND COALESCE(uo.is_active, true)
      )
    )
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'JOURNAL_ENTRY_NOT_FOUND'; END IF;

  PERFORM public.wardah_178_assert_permission(v_old.org_id, 'accounting.journals.update');
  IF v_old.journal_origin NOT IN ('manual','manual_legacy') THEN
    RAISE EXCEPTION 'JOURNAL_SYSTEM_ENTRY_NOT_MANUAL_EDITABLE';
  END IF;
  IF v_old.status <> 'draft' THEN
    RAISE EXCEPTION 'JOURNAL_ONLY_DRAFT_EDITABLE';
  END IF;

  PERFORM public.wardah_178_validate_manual_lines(v_old.org_id, p_payload->'lines');

  SELECT COALESCE(sum(COALESCE((l->>'debit')::numeric,0)),0),
         COALESCE(sum(COALESCE((l->>'credit')::numeric,0)),0), count(*)
  INTO v_total_debit,v_total_credit,v_line_count
  FROM jsonb_array_elements(p_payload->'lines') l;
  IF round(v_total_debit,2) <> round(v_total_credit,2) OR round(v_total_debit,2)=0 THEN
    RAISE EXCEPTION 'UNBALANCED_ENTRY';
  END IF;

  v_entry_date := COALESCE(NULLIF(p_payload->>'entry_date','')::date, v_old.entry_date);
  PERFORM public.assert_period_open(v_old.org_id, v_entry_date);

  v_journal := COALESCE(NULLIF(p_payload->>'journal_id','')::uuid, v_old.journal_id);
  IF v_journal IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.journals j
    WHERE j.id=v_journal AND j.org_id=v_old.org_id AND COALESCE(j.is_active,true)
  ) THEN
    RAISE EXCEPTION 'JOURNAL_NOT_ACTIVE_IN_ORG';
  END IF;

  UPDATE public.gl_entries
  SET journal_id=v_journal,
      entry_date=v_entry_date,
      description=NULLIF(p_payload->>'description',''),
      description_ar=NULLIF(p_payload->>'description_ar',''),
      reference_type=NULLIF(p_payload->>'reference_type',''),
      reference_number=NULLIF(p_payload->>'reference_number',''),
      total_debit=v_total_debit,
      total_credit=v_total_credit,
      updated_at=now()
  WHERE id=p_entry_id;

  DELETE FROM public.gl_entry_lines WHERE entry_id=p_entry_id;
  INSERT INTO public.gl_entry_lines(
    org_id,tenant_id,entry_id,line_number,account_id,debit,credit,
    currency_code,description,description_ar
  )
  SELECT v_old.org_id,v_old.org_id,p_entry_id,
         COALESCE((l.value->>'line_number')::int,l.ord::int),
         (l.value->>'account_id')::uuid,
         COALESCE((l.value->>'debit')::numeric,0),
         COALESCE((l.value->>'credit')::numeric,0),
         COALESCE(NULLIF(l.value->>'currency_code',''),'SAR'),
         NULLIF(l.value->>'description',''),NULLIF(l.value->>'description_ar','')
  FROM jsonb_array_elements(p_payload->'lines') WITH ORDINALITY AS l(value,ord);

  INSERT INTO public.audit_logs(org_id,user_id,action,entity_type,entity_id,metadata)
  VALUES (v_old.org_id,v_uid,'journal.manual.update','gl_entry',p_entry_id::text,
          jsonb_build_object('migration',178));

  RETURN jsonb_build_object('success',true,'entry_id',p_entry_id,'status','draft');
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_delete_manual_journal_entry(p_entry_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_entry public.gl_entries%rowtype;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT ge.* INTO v_entry
  FROM public.gl_entries ge
  WHERE ge.id = p_entry_id
    AND (
      EXISTS (
        SELECT 1 FROM public.super_admins sa
        WHERE sa.user_id = v_uid AND sa.is_active = true
      )
      OR EXISTS (
        SELECT 1 FROM public.user_organizations uo
        WHERE uo.user_id = v_uid
          AND uo.org_id = ge.org_id
          AND COALESCE(uo.is_active, true)
      )
    )
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'JOURNAL_ENTRY_NOT_FOUND'; END IF;

  PERFORM public.wardah_178_assert_permission(v_entry.org_id,'accounting.journals.delete');
  IF v_entry.journal_origin NOT IN ('manual','manual_legacy') THEN
    RAISE EXCEPTION 'JOURNAL_SYSTEM_ENTRY_NOT_MANUAL_DELETABLE';
  END IF;
  IF v_entry.status <> 'draft' THEN RAISE EXCEPTION 'JOURNAL_ONLY_DRAFT_DELETABLE'; END IF;

  DELETE FROM public.gl_entry_lines WHERE entry_id=p_entry_id;
  DELETE FROM public.gl_entries WHERE id=p_entry_id;

  INSERT INTO public.audit_logs(org_id,user_id,action,entity_type,entity_id,metadata)
  VALUES (v_entry.org_id,v_uid,'journal.manual.delete','gl_entry',p_entry_id::text,
          jsonb_build_object('migration',178,'entry_number',v_entry.entry_number));

  RETURN jsonb_build_object('success',true,'entry_id',p_entry_id,'deleted',true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_post_manual_journal_entry(p_entry_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_entry public.gl_entries%rowtype;
  v_debit numeric;
  v_credit numeric;
  v_lines integer;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT ge.* INTO v_entry
  FROM public.gl_entries ge
  WHERE ge.id = p_entry_id
    AND (
      EXISTS (
        SELECT 1 FROM public.super_admins sa
        WHERE sa.user_id = v_uid AND sa.is_active = true
      )
      OR EXISTS (
        SELECT 1 FROM public.user_organizations uo
        WHERE uo.user_id = v_uid
          AND uo.org_id = ge.org_id
          AND COALESCE(uo.is_active, true)
      )
    )
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'JOURNAL_ENTRY_NOT_FOUND'; END IF;

  PERFORM public.wardah_178_assert_permission(v_entry.org_id,'accounting.journals.post');
  IF v_entry.journal_origin NOT IN ('manual','manual_legacy') THEN
    RAISE EXCEPTION 'JOURNAL_SYSTEM_ENTRY_NOT_MANUAL_POSTABLE';
  END IF;
  IF v_entry.status='posted' THEN
    RETURN jsonb_build_object('success',true,'entry_id',p_entry_id,'status','posted','duplicate',true);
  END IF;
  IF v_entry.status <> 'draft' THEN RAISE EXCEPTION 'JOURNAL_ONLY_DRAFT_POSTABLE'; END IF;

  SELECT COALESCE(sum(debit),0),COALESCE(sum(credit),0),count(*)
  INTO v_debit,v_credit,v_lines
  FROM public.gl_entry_lines WHERE entry_id=p_entry_id AND org_id=v_entry.org_id;
  IF v_lines < 2 OR round(v_debit,2) <> round(v_credit,2) OR round(v_debit,2)=0 THEN
    RAISE EXCEPTION 'JOURNAL_ENTRY_NOT_BALANCED';
  END IF;
  IF round(v_debit,2) <> round(v_entry.total_debit,2)
     OR round(v_credit,2) <> round(v_entry.total_credit,2) THEN
    RAISE EXCEPTION 'JOURNAL_HEADER_LINE_TOTAL_MISMATCH';
  END IF;

  PERFORM public.assert_period_open(v_entry.org_id,v_entry.entry_date);

  UPDATE public.gl_entries
  SET status='posted',posted_at=now(),posted_by=v_uid,updated_at=now()
  WHERE id=p_entry_id;

  INSERT INTO public.audit_logs(org_id,user_id,action,entity_type,entity_id,metadata)
  VALUES (v_entry.org_id,v_uid,'journal.manual.post','gl_entry',p_entry_id::text,
          jsonb_build_object('migration',178,'entry_number',v_entry.entry_number));

  RETURN jsonb_build_object('success',true,'entry_id',p_entry_id,'status','posted');
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_batch_post_manual_journal_entries(p_entry_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id uuid;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_success integer := 0;
  v_failed integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  FOREACH v_id IN ARRAY COALESCE(p_entry_ids,ARRAY[]::uuid[]) LOOP
    BEGIN
      v_result := public.rpc_post_manual_journal_entry(v_id);
      v_success := v_success + 1;
      v_results := v_results || jsonb_build_array(v_result);
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'entry_id',v_id,'success',false,'error',SQLERRM));
    END;
  END LOOP;
  RETURN jsonb_build_object(
    'success',v_failed=0,'total',COALESCE(array_length(p_entry_ids,1),0),
    'success_count',v_success,'fail_count',v_failed,'results',v_results);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_reverse_manual_journal_entry(
  p_entry_id uuid,
  p_reversal_reason text DEFAULT NULL,
  p_reversal_date date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_original public.gl_entries%rowtype;
  v_existing uuid;
  v_lines jsonb;
  v_result jsonb;
  v_reversal uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT ge.* INTO v_original
  FROM public.gl_entries ge
  WHERE ge.id = p_entry_id
    AND (
      EXISTS (
        SELECT 1 FROM public.super_admins sa
        WHERE sa.user_id = v_uid AND sa.is_active = true
      )
      OR EXISTS (
        SELECT 1 FROM public.user_organizations uo
        WHERE uo.user_id = v_uid
          AND uo.org_id = ge.org_id
          AND COALESCE(uo.is_active, true)
      )
    )
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'JOURNAL_ENTRY_NOT_FOUND'; END IF;

  PERFORM public.wardah_178_assert_permission(v_original.org_id,'accounting.journals.reverse');
  IF v_original.journal_origin NOT IN ('manual','manual_legacy') THEN
    RAISE EXCEPTION 'JOURNAL_SYSTEM_ENTRY_REQUIRES_SOURCE_DOCUMENT_REVERSAL';
  END IF;

  SELECT id INTO v_existing
  FROM public.gl_entries
  WHERE org_id=v_original.org_id
    AND reference_type='JOURNAL_REVERSAL'
    AND reference_id=p_entry_id
    AND status='posted'
  LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('success',true,'original_entry_id',p_entry_id,
      'reversal_entry_id',v_existing,'duplicate',true);
  END IF;

  IF v_original.status <> 'posted' THEN
    RAISE EXCEPTION 'JOURNAL_ONLY_POSTED_REVERSIBLE';
  END IF;
  PERFORM public.assert_period_open(v_original.org_id,p_reversal_date);

  SELECT jsonb_agg(jsonb_build_object(
    'line_number',line_number,'account_id',account_id,
    'debit',credit,'credit',debit,'currency_code',COALESCE(currency_code,'SAR'),
    'description',COALESCE(description,'Reversal')
  ) ORDER BY line_number)
  INTO v_lines
  FROM public.gl_entry_lines
  WHERE entry_id=p_entry_id AND org_id=v_original.org_id;

  IF v_lines IS NULL OR jsonb_array_length(v_lines)<2 THEN
    RAISE EXCEPTION 'JOURNAL_REVERSAL_LINES_MISSING';
  END IF;

  v_result := public.rpc_create_journal_entry(jsonb_build_object(
    'org_id',v_original.org_id::text,
    'journal_id',v_original.journal_id,
    'entry_date',p_reversal_date,
    'description','Reversal: ' || COALESCE(v_original.description,v_original.entry_number),
    'description_ar','عكس: ' || COALESCE(v_original.description_ar,v_original.entry_number),
    'reference_type','JOURNAL_REVERSAL',
    'reference_number','REV-' || v_original.entry_number,
    'idempotency_key','manual-reversal:' || p_entry_id::text,
    'auto_post',true,
    'lines',v_lines
  ));
  v_reversal := NULLIF(v_result->>'entry_id','')::uuid;
  IF v_reversal IS NULL THEN RAISE EXCEPTION 'JOURNAL_REVERSAL_CREATE_FAILED'; END IF;

  UPDATE public.gl_entries
  SET journal_origin='manual_reversal',reference_id=p_entry_id,
      created_by=COALESCE(created_by,v_uid),posted_by=v_uid,updated_at=now()
  WHERE id=v_reversal AND org_id=v_original.org_id;

  UPDATE public.gl_entries
  SET status='reversed',updated_at=now()
  WHERE id=p_entry_id;

  INSERT INTO public.audit_logs(org_id,user_id,action,entity_type,entity_id,metadata)
  VALUES (v_original.org_id,v_uid,'journal.manual.reverse','gl_entry',p_entry_id::text,
          jsonb_build_object('migration',178,'reversal_entry_id',v_reversal,
                             'reason',p_reversal_reason));

  RETURN jsonb_build_object('success',true,'original_entry_id',p_entry_id,
    'reversal_entry_id',v_reversal,'reversal_number',v_result->>'entry_number');
END;
$function$;

-- Guarded public adapters for UI-driven event posting. Domain SECURITY DEFINER
-- functions continue calling the underlying internal primitives as owner.
CREATE OR REPLACE FUNCTION public.rpc_post_manual_event_journal(
  p_event text,
  p_amount numeric,
  p_memo text,
  p_ref_type text DEFAULT NULL,
  p_ref_id uuid DEFAULT NULL,
  p_tenant uuid DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_jv_date date DEFAULT CURRENT_DATE
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_org uuid;
BEGIN
  v_org := public.wardah_org_id(p_tenant);
  PERFORM public.wardah_178_assert_permission(v_org,'accounting.journals.create');
  PERFORM public.wardah_178_assert_permission(v_org,'accounting.journals.post');
  RETURN public.rpc_post_event_journal(
    p_event,p_amount,p_memo,p_ref_type,p_ref_id,v_org,p_idempotency_key,p_jv_date);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_post_manual_work_center_oh(
  p_work_center text,
  p_amount numeric,
  p_memo text,
  p_ref_type text DEFAULT NULL,
  p_ref_id uuid DEFAULT NULL,
  p_tenant uuid DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_jv_date date DEFAULT CURRENT_DATE
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_org uuid;
BEGIN
  v_org := public.wardah_org_id(p_tenant);
  PERFORM public.wardah_178_assert_permission(v_org,'accounting.journals.create');
  PERFORM public.wardah_178_assert_permission(v_org,'accounting.journals.post');
  RETURN public.rpc_post_work_center_oh(
    p_work_center,p_amount,p_memo,p_ref_type,p_ref_id,v_org,p_idempotency_key,p_jv_date);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Grants: trusted primitives/legacy model are not public client APIs.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.rpc_create_journal_entry(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rpc_post_event_journal(text,numeric,text,text,uuid,uuid,text,date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rpc_post_work_center_oh(text,numeric,text,text,uuid,uuid,text,date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.generate_entry_number(uuid) FROM PUBLIC, anon, authenticated;

-- Preserve trusted server automation without exposing the primitives to users.
GRANT EXECUTE ON FUNCTION public.rpc_create_journal_entry(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.rpc_post_event_journal(text,numeric,text,text,uuid,uuid,text,date) TO service_role;
GRANT EXECUTE ON FUNCTION public.rpc_post_work_center_oh(text,numeric,text,text,uuid,uuid,text,date) TO service_role;
GRANT EXECUTE ON FUNCTION public.generate_entry_number(uuid) TO service_role;

-- Legacy journal_entries model: permanently fail closed for browser clients.
REVOKE ALL ON FUNCTION public.batch_post_journal_entries(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.approve_journal_entry(uuid,integer,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reverse_journal_entry_enhanced(uuid,text,date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.post_journal_entry(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.rpc_create_manual_journal_entry(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_update_manual_journal_entry(uuid,jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_delete_manual_journal_entry(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_post_manual_journal_entry(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_batch_post_manual_journal_entries(uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_reverse_manual_journal_entry(uuid,text,date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_post_manual_event_journal(text,numeric,text,text,uuid,uuid,text,date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_post_manual_work_center_oh(text,numeric,text,text,uuid,uuid,text,date) TO authenticated, service_role;

-- Ensure PUBLIC/anon never inherit the new API accidentally.
REVOKE ALL ON FUNCTION public.rpc_create_manual_journal_entry(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_update_manual_journal_entry(uuid,jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_delete_manual_journal_entry(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_post_manual_journal_entry(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_batch_post_manual_journal_entries(uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_reverse_manual_journal_entry(uuid,text,date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_post_manual_event_journal(text,numeric,text,text,uuid,uuid,text,date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_post_manual_work_center_oh(text,numeric,text,text,uuid,uuid,text,date) FROM PUBLIC, anon;

COMMIT;
