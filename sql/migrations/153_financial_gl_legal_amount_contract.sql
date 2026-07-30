-- =====================================================================
-- 153_financial_gl_legal_amount_contract
-- =====================================================================
-- Mechanical amount migration only. This migration deliberately does NOT:
--   * map historical account codes to gl_accounts;
--   * make account_id mandatory for historical rows;
--   * add the same-org account foreign key;
--   * quarantine or exclude any historical row.
-- Those decisions belong to Migration 154 after accounting approval.
--
-- Contract:
--   1. lock parent then child before the snapshot/backfill;
--   2. reject ambiguous/mixed line shapes;
--   3. backfill legacy amounts into debit/credit without changing identity;
--   4. restore posted-line immutability before commit;
--   5. make legal amounts constrained and align header precision to numeric(18,2);
--   6. mirror future legal writes to transitional legacy columns only.
-- =====================================================================

BEGIN;

SET LOCAL lock_timeout = '30s';
SET LOCAL statement_timeout = '10min';

-- Match the normal write order used by rpc_create_journal_entry:
-- gl_entries first, then gl_entry_lines. One statement prevents child-first
-- acquisition and the deadlock pattern documented in WRD-FIN-REP-SRS-001 v1.3.
LOCK TABLE public.gl_entries,
           public.gl_entry_lines
IN SHARE ROW EXCLUSIVE MODE;

-- ---------------------------------------------------------------------
-- 1. Fail-closed preflight under stable table locks
-- ---------------------------------------------------------------------
DO $preflight$
DECLARE
  v_count bigint;
  v_header_only bigint;
  v_unresolved_codes bigint;
  v_trigger_enabled "char";
BEGIN
  IF to_regclass('public.gl_entries') IS NULL
     OR to_regclass('public.gl_entry_lines') IS NULL
     OR to_regclass('public.gl_accounts') IS NULL THEN
    RAISE EXCEPTION 'GL_153_SCHEMA_MISSING: gl_entries, gl_entry_lines and gl_accounts are required';
  END IF;

  SELECT t.tgenabled
  INTO v_trigger_enabled
  FROM pg_trigger t
  WHERE t.tgrelid = 'public.gl_entry_lines'::regclass
    AND t.tgname = 'trg_protect_posted_gl_entry_lines'
    AND NOT t.tgisinternal;

  IF v_trigger_enabled IS NULL THEN
    RAISE EXCEPTION 'GL_153_POSTED_TRIGGER_MISSING: trg_protect_posted_gl_entry_lines is required';
  END IF;
  IF v_trigger_enabled <> 'O' THEN
    RAISE EXCEPTION 'GL_153_POSTED_TRIGGER_DISABLED: expected enabled state O, got %', v_trigger_enabled;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.gl_entry_lines l
  WHERE l.debit IS NULL OR l.credit IS NULL
     OR l.debit_amount IS NULL OR l.credit_amount IS NULL;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'GL_153_NULL_AMOUNT: % lines contain NULL amount fields', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.gl_entries e
  WHERE e.total_debit IS NULL OR e.total_credit IS NULL;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'GL_153_NULL_HEADER_TOTAL: % headers contain NULL totals', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.gl_entry_lines l
  WHERE l.debit < 0 OR l.credit < 0
     OR l.debit_amount < 0 OR l.credit_amount < 0;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'GL_153_NEGATIVE_AMOUNT: % lines contain negative amounts', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.gl_entry_lines l
  WHERE (l.debit > 0 AND l.credit > 0)
     OR (l.debit_amount > 0 AND l.credit_amount > 0);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'GL_153_DOUBLE_SIDED_LINE: % lines contain debit and credit together', v_count;
  END IF;

  -- Any row carrying economic value in both contracts is ambiguous. Even equal
  -- values are rejected here: the migration will never guess which side won.
  SELECT count(*) INTO v_count
  FROM public.gl_entry_lines l
  WHERE (l.debit > 0 OR l.credit > 0)
    AND (l.debit_amount > 0 OR l.credit_amount > 0);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'GL_153_MIXED_AMOUNT_SOURCE: % lines carry legal and legacy value together', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.gl_entry_lines l
  WHERE (l.account_id IS NOT NULL AND l.account_code IS NOT NULL)
     OR (l.account_id IS NULL AND l.account_code IS NULL);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'GL_153_AMBIGUOUS_IDENTITY: % lines have mixed or missing account identity', v_count;
  END IF;

  -- The only accepted pre-153 shapes are:
  -- modern-only: account_id + legal one-sided amount + zero legacy amount;
  -- legacy-only: account_code + legacy one-sided amount + zero legal amount.
  SELECT count(*) INTO v_count
  FROM public.gl_entry_lines l
  WHERE NOT (
    (
      l.account_id IS NOT NULL
      AND l.account_code IS NULL
      AND ((l.debit > 0 AND l.credit = 0) OR (l.credit > 0 AND l.debit = 0))
      AND l.debit_amount = 0 AND l.credit_amount = 0
    )
    OR
    (
      l.account_id IS NULL
      AND l.account_code IS NOT NULL
      AND l.debit = 0 AND l.credit = 0
      AND ((l.debit_amount > 0 AND l.credit_amount = 0)
        OR (l.credit_amount > 0 AND l.debit_amount = 0))
    )
  );
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'GL_153_AMBIGUOUS_LINE_SHAPE: % lines do not match modern-only or legacy-only', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.gl_entry_lines l
  JOIN public.gl_entries e ON e.id = l.entry_id
  WHERE e.org_id IS DISTINCT FROM l.org_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'GL_153_CROSS_ORG_ENTRY_LINE: % lines disagree with their header organization', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.gl_entry_lines l
  LEFT JOIN public.gl_accounts a
    ON a.id = l.account_id AND a.org_id = l.org_id
  WHERE l.account_id IS NOT NULL AND a.id IS NULL;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'GL_153_INVALID_MODERN_ACCOUNT: % modern lines reference a missing/cross-org gl_account', v_count;
  END IF;

  -- Headers that have lines must match the effective pre-migration line values.
  -- Header-only posted entries are an existing quality finding and are reported,
  -- not silently reconstructed in this mechanical line migration.
  WITH per_entry AS (
    SELECT e.id, e.total_debit, e.total_credit,
           count(l.id) AS line_count,
           coalesce(sum(CASE WHEN l.debit > 0 OR l.credit > 0
                             THEN l.debit ELSE l.debit_amount END), 0) AS effective_debit,
           coalesce(sum(CASE WHEN l.debit > 0 OR l.credit > 0
                             THEN l.credit ELSE l.credit_amount END), 0) AS effective_credit
    FROM public.gl_entries e
    LEFT JOIN public.gl_entry_lines l ON l.entry_id = e.id
    GROUP BY e.id, e.total_debit, e.total_credit
  )
  SELECT count(*) INTO v_count
  FROM per_entry p
  WHERE p.line_count > 0
    AND (
      round(p.total_debit, 2) IS DISTINCT FROM round(p.effective_debit, 2)
      OR round(p.total_credit, 2) IS DISTINCT FROM round(p.effective_credit, 2)
      OR round(p.effective_debit, 2) IS DISTINCT FROM round(p.effective_credit, 2)
    );
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'GL_153_HEADER_LINE_MISMATCH: % entries with lines are not balanced/matched', v_count;
  END IF;

  SELECT count(*) INTO v_header_only
  FROM public.gl_entries e
  WHERE e.status = 'posted'
    AND NOT EXISTS (SELECT 1 FROM public.gl_entry_lines l WHERE l.entry_id = e.id);

  SELECT count(DISTINCT (l.org_id, l.account_code)) INTO v_unresolved_codes
  FROM public.gl_entry_lines l
  JOIN public.gl_entries e ON e.id = l.entry_id
  WHERE e.status = 'posted'
    AND l.account_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.gl_accounts a
      WHERE a.org_id = l.org_id AND a.code = l.account_code
    );

  RAISE NOTICE 'GL_153_PREFLIGHT: posted_headers_without_lines=% unresolved_posted_codes=%',
    v_header_only, v_unresolved_codes;
END
$preflight$;

-- ---------------------------------------------------------------------
-- 2. Immutable in-transaction snapshots and target IDs
-- ---------------------------------------------------------------------
CREATE TEMP TABLE wardah_153_line_snapshot ON COMMIT DROP AS
SELECT l.id, l.org_id, l.entry_id, e.status,
       l.account_id, l.account_code, l.account_name, l.account_name_ar,
       l.debit, l.credit, l.debit_amount, l.credit_amount,
       CASE WHEN l.debit > 0 OR l.credit > 0 THEN l.debit ELSE l.debit_amount END AS economic_debit,
       CASE WHEN l.debit > 0 OR l.credit > 0 THEN l.credit ELSE l.credit_amount END AS economic_credit,
       (l.account_id IS NULL AND l.account_code IS NOT NULL
        AND l.debit = 0 AND l.credit = 0
        AND (l.debit_amount > 0 OR l.credit_amount > 0)) AS is_backfill_target
FROM public.gl_entry_lines l
JOIN public.gl_entries e ON e.id = l.entry_id;

CREATE UNIQUE INDEX wardah_153_line_snapshot_pk ON wardah_153_line_snapshot(id);

CREATE TEMP TABLE wardah_153_status_snapshot ON COMMIT DROP AS
SELECT status,
       count(*) AS line_count,
       sum(economic_debit) AS economic_debit,
       sum(economic_credit) AS economic_credit
FROM wardah_153_line_snapshot
GROUP BY status;

CREATE TEMP TABLE wardah_153_targets ON COMMIT DROP AS
SELECT id, debit_amount AS target_debit, credit_amount AS target_credit
FROM wardah_153_line_snapshot
WHERE is_backfill_target;

CREATE UNIQUE INDEX wardah_153_targets_pk ON wardah_153_targets(id);

-- ---------------------------------------------------------------------
-- 3. Align the legal header range with debit/credit numeric(18,2)
-- ---------------------------------------------------------------------
ALTER TABLE public.gl_entries
  ALTER COLUMN total_debit TYPE numeric(18,2) USING total_debit::numeric(18,2),
  ALTER COLUMN total_credit TYPE numeric(18,2) USING total_credit::numeric(18,2),
  ALTER COLUMN total_debit SET DEFAULT 0,
  ALTER COLUMN total_credit SET DEFAULT 0,
  ALTER COLUMN total_debit SET NOT NULL,
  ALTER COLUMN total_credit SET NOT NULL;

-- Transitional legacy columns remain numeric(12,2) because live legacy views
-- depend on their exact output types. The legal contract and header totals are
-- numeric(18,2); the compatibility trigger below fails visibly if a value is
-- outside the temporary legacy representable range.
ALTER TABLE public.gl_entry_lines
  ALTER COLUMN debit SET DEFAULT 0,
  ALTER COLUMN credit SET DEFAULT 0,
  ALTER COLUMN debit_amount SET DEFAULT 0,
  ALTER COLUMN credit_amount SET DEFAULT 0,
  ALTER COLUMN debit SET NOT NULL,
  ALTER COLUMN credit SET NOT NULL,
  ALTER COLUMN debit_amount SET NOT NULL,
  ALTER COLUMN credit_amount SET NOT NULL;

-- ---------------------------------------------------------------------
-- 4. Narrow maintenance window for posted legacy rows
-- ---------------------------------------------------------------------
ALTER TABLE public.gl_entry_lines
  DISABLE TRIGGER trg_protect_posted_gl_entry_lines;

CREATE TEMP TABLE wardah_153_updated_ids ON COMMIT DROP AS
WITH updated AS (
  UPDATE public.gl_entry_lines l
  SET debit = t.target_debit,
      credit = t.target_credit
  FROM wardah_153_targets t
  WHERE l.id = t.id
  RETURNING l.id, l.debit, l.credit
)
SELECT * FROM updated;

ALTER TABLE public.gl_entry_lines
  ENABLE TRIGGER trg_protect_posted_gl_entry_lines;

-- ---------------------------------------------------------------------
-- 5. Exact UPDATE ... RETURNING and preservation checks
-- ---------------------------------------------------------------------
DO $verify$
DECLARE
  v_expected bigint;
  v_updated bigint;
  v_count bigint;
  v_trigger_enabled "char";
BEGIN
  SELECT count(*) INTO v_expected FROM wardah_153_targets;
  SELECT count(*) INTO v_updated FROM wardah_153_updated_ids;
  IF v_updated <> v_expected THEN
    RAISE EXCEPTION 'GL_153_UPDATE_COUNT_MISMATCH: expected %, updated %', v_expected, v_updated;
  END IF;

  IF EXISTS (
    SELECT id FROM wardah_153_targets
    EXCEPT
    SELECT id FROM wardah_153_updated_ids
  ) OR EXISTS (
    SELECT id FROM wardah_153_updated_ids
    EXCEPT
    SELECT id FROM wardah_153_targets
  ) THEN
    RAISE EXCEPTION 'GL_153_UPDATE_ID_MISMATCH: UPDATE RETURNING IDs differ from the locked target snapshot';
  END IF;

  SELECT count(*) INTO v_count
  FROM wardah_153_updated_ids u
  JOIN wardah_153_targets t USING (id)
  WHERE u.debit IS DISTINCT FROM t.target_debit
     OR u.credit IS DISTINCT FROM t.target_credit;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'GL_153_UPDATE_VALUE_MISMATCH: % updated rows differ from target values', v_count;
  END IF;

  -- Every non-target row must remain byte-for-byte equal for identity and amounts.
  SELECT count(*) INTO v_count
  FROM wardah_153_line_snapshot s
  JOIN public.gl_entry_lines l ON l.id = s.id
  WHERE NOT s.is_backfill_target
    AND (
      l.account_id IS DISTINCT FROM s.account_id
      OR l.account_code IS DISTINCT FROM s.account_code
      OR l.account_name IS DISTINCT FROM s.account_name
      OR l.account_name_ar IS DISTINCT FROM s.account_name_ar
      OR l.debit IS DISTINCT FROM s.debit
      OR l.credit IS DISTINCT FROM s.credit
      OR l.debit_amount IS DISTINCT FROM s.debit_amount
      OR l.credit_amount IS DISTINCT FROM s.credit_amount
    );
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'GL_153_NON_TARGET_CHANGED: % non-target rows changed', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM wardah_153_targets t
  JOIN public.gl_entry_lines l ON l.id = t.id
  WHERE l.debit IS DISTINCT FROM t.target_debit
     OR l.credit IS DISTINCT FROM t.target_credit
     OR (l.debit = 0 AND l.credit = 0);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'GL_153_BACKFILL_INCOMPLETE: % target rows remain incorrect', v_count;
  END IF;

  -- After the backfill, legal sums must equal the preflight economic sums for
  -- every status; this catches loss, duplication and accidental draft changes.
  WITH after_sums AS (
    SELECT e.status, count(*) AS line_count,
           sum(l.debit) AS legal_debit,
           sum(l.credit) AS legal_credit
    FROM public.gl_entry_lines l
    JOIN public.gl_entries e ON e.id = l.entry_id
    GROUP BY e.status
  )
  SELECT count(*) INTO v_count
  FROM wardah_153_status_snapshot s
  FULL JOIN after_sums a USING (status)
  WHERE a.status IS NULL OR s.status IS NULL
     OR a.line_count IS DISTINCT FROM s.line_count
     OR a.legal_debit IS DISTINCT FROM s.economic_debit
     OR a.legal_credit IS DISTINCT FROM s.economic_credit;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'GL_153_ECONOMIC_TOTAL_DRIFT: % status groups differ after backfill', v_count;
  END IF;

  WITH per_entry AS (
    SELECT e.id, e.total_debit, e.total_credit, count(l.id) AS line_count,
           coalesce(sum(l.debit),0) AS line_debit,
           coalesce(sum(l.credit),0) AS line_credit
    FROM public.gl_entries e
    LEFT JOIN public.gl_entry_lines l ON l.entry_id = e.id
    GROUP BY e.id, e.total_debit, e.total_credit
  )
  SELECT count(*) INTO v_count
  FROM per_entry p
  WHERE p.line_count > 0
    AND (
      round(p.total_debit,2) IS DISTINCT FROM round(p.line_debit,2)
      OR round(p.total_credit,2) IS DISTINCT FROM round(p.line_credit,2)
      OR round(p.line_debit,2) IS DISTINCT FROM round(p.line_credit,2)
    );
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'GL_153_POST_BACKFILL_BALANCE_FAIL: % entries with lines do not reconcile', v_count;
  END IF;

  SELECT t.tgenabled INTO v_trigger_enabled
  FROM pg_trigger t
  WHERE t.tgrelid = 'public.gl_entry_lines'::regclass
    AND t.tgname = 'trg_protect_posted_gl_entry_lines'
    AND NOT t.tgisinternal;
  IF v_trigger_enabled <> 'O' THEN
    RAISE EXCEPTION 'GL_153_POSTED_TRIGGER_NOT_RESTORED: state=%', v_trigger_enabled;
  END IF;
END
$verify$;

-- ---------------------------------------------------------------------
-- 6. Legal amount constraints
-- ---------------------------------------------------------------------
ALTER TABLE public.gl_entry_lines
  ADD CONSTRAINT gl_entry_lines_legal_debit_nonnegative CHECK (debit >= 0),
  ADD CONSTRAINT gl_entry_lines_legal_credit_nonnegative CHECK (credit >= 0),
  ADD CONSTRAINT gl_entry_lines_legal_one_sided CHECK (
    (debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)
  );

COMMENT ON CONSTRAINT gl_entry_lines_legal_one_sided ON public.gl_entry_lines IS
  'Migration 153 legal amount contract: exactly one of debit/credit is positive.';

-- ---------------------------------------------------------------------
-- 7. Legal -> legacy compatibility for future writes only
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wardah_sync_gl_line_legal_to_legacy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_code text;
  v_name text;
  v_name_en text;
  v_name_ar text;
  v_legacy_max constant numeric := 9999999999.99;
BEGIN
  IF NEW.org_id IS NULL OR NEW.entry_id IS NULL THEN
    RAISE EXCEPTION 'GL_LEGAL_SCOPE_REQUIRED: org_id and entry_id are required';
  END IF;

  IF NEW.tenant_id IS NOT NULL AND NEW.tenant_id <> NEW.org_id THEN
    RAISE EXCEPTION 'GL_CROSS_ORG_TENANT_ALIAS: tenant_id must equal org_id';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.gl_entries e
    WHERE e.id = NEW.entry_id AND e.org_id = NEW.org_id
  ) THEN
    RAISE EXCEPTION 'GL_CROSS_ORG_ENTRY: entry_id does not belong to org_id';
  END IF;

  NEW.debit := coalesce(NEW.debit, 0);
  NEW.credit := coalesce(NEW.credit, 0);

  IF NEW.debit < 0 OR NEW.credit < 0 THEN
    RAISE EXCEPTION 'GL_NEGATIVE_LEGAL_AMOUNT: debit/credit cannot be negative';
  END IF;
  IF NEW.debit > 0 AND NEW.credit > 0 THEN
    RAISE EXCEPTION 'GL_DOUBLE_SIDED_LEGAL_AMOUNT: debit and credit cannot both be positive';
  END IF;
  IF NEW.debit = 0 AND NEW.credit = 0 THEN
    RAISE EXCEPTION 'GL_ZERO_LEGAL_LINE: a legal GL line must carry value';
  END IF;

  IF NEW.account_id IS NULL THEN
    RAISE EXCEPTION 'GL_LEGAL_ACCOUNT_REQUIRED: new writes require account_id';
  END IF;

  SELECT a.code, a.name, a.name_en, a.name_ar
  INTO v_code, v_name, v_name_en, v_name_ar
  FROM public.gl_accounts a
  WHERE a.id = NEW.account_id AND a.org_id = NEW.org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'GL_ACCOUNT_NOT_FOUND_OR_CROSS_ORG: account_id is not a gl_account in org_id';
  END IF;

  IF NEW.account_code IS NOT NULL AND NEW.account_code <> v_code THEN
    RAISE EXCEPTION 'GL_ACCOUNT_CODE_CONFLICT: supplied account_code does not match account_id';
  END IF;

  -- If a caller supplied legacy amounts, they may only duplicate the legal
  -- values exactly. Legacy-only or conflicting writes are rejected visibly.
  IF coalesce(NEW.debit_amount,0) <> 0 OR coalesce(NEW.credit_amount,0) <> 0 THEN
    IF round(coalesce(NEW.debit_amount,0),2) IS DISTINCT FROM round(NEW.debit,2)
       OR round(coalesce(NEW.credit_amount,0),2) IS DISTINCT FROM round(NEW.credit,2) THEN
      RAISE EXCEPTION 'GL_LEGACY_AMOUNT_WRITE_REJECTED: debit/credit are the only legal input amounts';
    END IF;
  END IF;

  IF NEW.debit > v_legacy_max OR NEW.credit > v_legacy_max THEN
    RAISE EXCEPTION
      'GL_LEGACY_COMPAT_RANGE_EXCEEDED: temporary numeric(12,2) legacy mirror cannot represent legal amount';
  END IF;

  NEW.account_code := v_code;
  NEW.account_name := coalesce(v_name_en, v_name);
  NEW.account_name_ar := coalesce(v_name_ar, v_name);
  NEW.debit_amount := NEW.debit;
  NEW.credit_amount := NEW.credit;
  NEW.tenant_id := coalesce(NEW.tenant_id, NEW.org_id);

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.wardah_sync_gl_line_legal_to_legacy() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wardah_sync_gl_line_legal_to_legacy() FROM anon;
REVOKE ALL ON FUNCTION public.wardah_sync_gl_line_legal_to_legacy() FROM authenticated;
REVOKE ALL ON FUNCTION public.wardah_sync_gl_line_legal_to_legacy() FROM service_role;

DROP TRIGGER IF EXISTS trg_wardah_gl_line_legal_compat ON public.gl_entry_lines;
CREATE TRIGGER trg_wardah_gl_line_legal_compat
BEFORE INSERT OR UPDATE ON public.gl_entry_lines
FOR EACH ROW
EXECUTE FUNCTION public.wardah_sync_gl_line_legal_to_legacy();

COMMENT ON FUNCTION public.wardah_sync_gl_line_legal_to_legacy() IS
  'Migration 153 transitional one-way compatibility: validates account/org and mirrors legal account_id+debit/credit into legacy read columns. No client EXECUTE grant.';


-- ---------------------------------------------------------------------
-- 8. Atomic payment-voucher posting (GL + invoice + voucher in one tx)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wardah_create_posted_voucher_gl(
  p_org uuid,
  p_reference_type text,
  p_reference_id uuid,
  p_reference_number text,
  p_entry_date date,
  p_description text,
  p_debit_account_id uuid,
  p_credit_account_id uuid,
  p_amount numeric,
  p_actor uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_entry_id uuid;
  v_entry_number text;
  v_journal_id uuid;
  v_idempotency_key text := p_reference_type || ':' || p_reference_id::text;
BEGIN
  IF p_org IS NULL OR p_reference_id IS NULL OR p_actor IS NULL THEN
    RAISE EXCEPTION 'VOUCHER_GL_SCOPE_REQUIRED: org, reference and actor are required';
  END IF;
  IF p_amount IS NULL OR round(p_amount, 2) <= 0 THEN
    RAISE EXCEPTION 'VOUCHER_AMOUNT_INVALID: amount must be positive';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.gl_accounts a
    WHERE a.id = p_debit_account_id AND a.org_id = p_org
      AND coalesce(a.is_active, true) AND coalesce(a.allow_posting, true)
  ) OR NOT EXISTS (
    SELECT 1 FROM public.gl_accounts a
    WHERE a.id = p_credit_account_id AND a.org_id = p_org
      AND coalesce(a.is_active, true) AND coalesce(a.allow_posting, true)
  ) THEN
    RAISE EXCEPTION 'VOUCHER_GL_ACCOUNT_INVALID: legal posting accounts must belong to the voucher organization';
  END IF;

  SELECT e.id INTO v_entry_id
  FROM public.gl_entries e
  WHERE e.org_id = p_org AND e.idempotency_key = v_idempotency_key
  FOR UPDATE;
  IF v_entry_id IS NOT NULL THEN
    RETURN v_entry_id;
  END IF;

  SELECT j.id INTO v_journal_id
  FROM public.journals j
  WHERE j.org_id = p_org AND coalesce(j.is_active, true)
  ORDER BY CASE WHEN j.journal_type IN ('cash','bank') THEN 0 ELSE 1 END,
 j.created_at NULLS LAST, j.id
  LIMIT 1;
  IF v_journal_id IS NULL THEN
    RAISE EXCEPTION 'VOUCHER_JOURNAL_REQUIRED: an active journal is required';
  END IF;

  v_entry_number := 'PV-' || to_char(coalesce(p_entry_date, current_date), 'YYYYMMDD') || '-' ||
          substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);

  INSERT INTO public.gl_entries (
    org_id, journal_id, entry_number, entry_date, entry_type,
    reference_type, reference_id, reference_number,
    description, description_ar, status, total_debit, total_credit,
    idempotency_key, created_by
  ) VALUES (
    p_org, v_journal_id, v_entry_number, coalesce(p_entry_date, current_date), 'manual',
    p_reference_type, p_reference_id, p_reference_number,
    p_description, p_description, 'draft', round(p_amount,2), round(p_amount,2),
    v_idempotency_key, p_actor
  ) RETURNING id INTO v_entry_id;

  INSERT INTO public.gl_entry_lines (
    org_id, tenant_id, entry_id, line_number, account_id,
    debit, credit, currency_code, description, description_ar
  ) VALUES
    (p_org, p_org, v_entry_id, 1, p_debit_account_id,
     round(p_amount,2), 0, 'SAR', p_description, p_description),
    (p_org, p_org, v_entry_id, 2, p_credit_account_id,
     0, round(p_amount,2), 'SAR', p_description, p_description);

  UPDATE public.gl_entries
  SET status = 'posted', posted_at = now(), posted_by = p_actor
  WHERE id = v_entry_id AND status = 'draft';

  RETURN v_entry_id;
END
$function$;

REVOKE ALL ON FUNCTION public.wardah_create_posted_voucher_gl(uuid,text,uuid,text,date,text,uuid,uuid,numeric,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wardah_create_posted_voucher_gl(uuid,text,uuid,text,date,text,uuid,uuid,numeric,uuid) FROM anon;
REVOKE ALL ON FUNCTION public.wardah_create_posted_voucher_gl(uuid,text,uuid,text,date,text,uuid,uuid,numeric,uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.wardah_create_posted_voucher_gl(uuid,text,uuid,text,date,text,uuid,uuid,numeric,uuid) FROM service_role;

CREATE OR REPLACE FUNCTION public.rpc_post_customer_receipt(p_receipt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_org uuid;
  v_receipt public.customer_collections%ROWTYPE;
  v_payment_account uuid;
  v_ar_account uuid;
  v_entry_id uuid;
  v_line record;
  v_allocation_total numeric := 0;
  v_open numeric;
  v_new_paid numeric;
  v_line_count integer := 0;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  v_org := public.get_current_tenant_id();
  IF v_org IS NULL OR NOT public.wardah_is_org_member(v_org) THEN
    RAISE EXCEPTION 'TENANT_MEMBERSHIP_REQUIRED';
  END IF;

  SELECT * INTO v_receipt
  FROM public.customer_collections
  WHERE id = p_receipt_id AND org_id = v_org
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_RECEIPT_NOT_FOUND_OR_CROSS_ORG'; END IF;

  IF v_receipt.status = 'posted' AND v_receipt.gl_entry_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.gl_entries e
      WHERE e.id = v_receipt.gl_entry_id AND e.org_id = v_org AND e.status = 'posted'
    ) THEN
      RAISE EXCEPTION 'CUSTOMER_RECEIPT_POSTED_GL_INVALID';
    END IF;
    RETURN jsonb_build_object('success', true, 'duplicate', true,
      'receipt_id', v_receipt.id, 'entry_id', v_receipt.gl_entry_id, 'status', 'posted');
  END IF;
  IF v_receipt.status <> 'draft' THEN
    RAISE EXCEPTION 'CUSTOMER_RECEIPT_NOT_DRAFT: status=%', v_receipt.status;
  END IF;

  v_payment_account := v_receipt.payment_account_id;
  IF v_payment_account IS NULL THEN
    SELECT a.id INTO v_payment_account FROM public.gl_accounts a
    WHERE a.org_id = v_org AND a.subtype = CASE WHEN v_receipt.payment_method='cash' THEN 'CASH' ELSE 'BANK' END
      AND coalesce(a.is_active,true) AND coalesce(a.allow_posting,true)
    ORDER BY a.code, a.id LIMIT 1;
  END IF;
  SELECT a.id INTO v_ar_account FROM public.gl_accounts a
  WHERE a.org_id = v_org AND a.subtype = 'ACCOUNTS_RECEIVABLE'
    AND coalesce(a.is_active,true) AND coalesce(a.allow_posting,true)
  ORDER BY a.code, a.id LIMIT 1;
  IF v_payment_account IS NULL OR v_ar_account IS NULL THEN
    RAISE EXCEPTION 'CUSTOMER_RECEIPT_GL_ACCOUNTS_MISSING';
  END IF;

  FOR v_line IN
    SELECT l.id, l.invoice_id, l.allocated_amount, coalesce(l.discount_amount,0) AS discount_amount,
 i.org_id, i.customer_id, i.total_amount, coalesce(i.paid_amount,0) AS paid_amount
    FROM public.customer_collection_lines l
    JOIN public.sales_invoices i ON i.id = l.invoice_id
    WHERE l.collection_id = v_receipt.id
    ORDER BY i.id
    FOR UPDATE OF i
  LOOP
    v_line_count := v_line_count + 1;
    IF v_line.org_id <> v_org OR v_line.customer_id <> v_receipt.customer_id THEN
      RAISE EXCEPTION 'CUSTOMER_RECEIPT_ALLOCATION_CROSS_SCOPE';
    END IF;
    IF v_line.discount_amount <> 0 THEN
      RAISE EXCEPTION 'VOUCHER_DISCOUNT_UNSUPPORTED: discount accounting mapping is required';
    END IF;
    v_open := round(v_line.total_amount - v_line.paid_amount, 2);
    IF round(v_line.allocated_amount,2) > v_open THEN
      RAISE EXCEPTION 'CUSTOMER_RECEIPT_OVER_ALLOCATION: invoice=% open=% allocated=%',
        v_line.invoice_id, v_open, v_line.allocated_amount;
    END IF;
    v_allocation_total := v_allocation_total + round(v_line.allocated_amount,2);
  END LOOP;

  IF v_line_count > 0 AND round(v_allocation_total,2) <> round(v_receipt.amount,2) THEN
    RAISE EXCEPTION 'CUSTOMER_RECEIPT_ALLOCATION_TOTAL_MISMATCH: allocations=% receipt=%',
      v_allocation_total, v_receipt.amount;
  END IF;

  v_entry_id := public.wardah_create_posted_voucher_gl(
    v_org, 'CUSTOMER_RECEIPT', v_receipt.id, v_receipt.collection_number,
    v_receipt.collection_date, 'سند قبض ' || v_receipt.collection_number,
    v_payment_account, v_ar_account, v_receipt.amount, v_actor
  );

  FOR v_line IN
    SELECT l.invoice_id, l.allocated_amount, i.total_amount, coalesce(i.paid_amount,0) AS paid_amount
    FROM public.customer_collection_lines l
    JOIN public.sales_invoices i ON i.id = l.invoice_id
    WHERE l.collection_id = v_receipt.id
    ORDER BY i.id
    FOR UPDATE OF i
  LOOP
    v_new_paid := round(v_line.paid_amount + v_line.allocated_amount,2);
    UPDATE public.sales_invoices
    SET paid_amount = v_new_paid,
        payment_status = CASE WHEN v_new_paid >= round(v_line.total_amount,2) THEN 'paid' ELSE 'partially_paid' END,
        updated_at = now()
    WHERE id = v_line.invoice_id AND org_id = v_org;
  END LOOP;

  UPDATE public.customer_collections
  SET status='posted', gl_entry_id=v_entry_id, posted_at=now(), posted_by=v_actor, updated_at=now()
  WHERE id=v_receipt.id AND org_id=v_org AND status='draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_RECEIPT_STATE_CHANGED'; END IF;

  RETURN jsonb_build_object('success', true, 'duplicate', false,
    'receipt_id', v_receipt.id, 'entry_id', v_entry_id, 'status', 'posted');
END
$function$;

CREATE OR REPLACE FUNCTION public.rpc_post_supplier_payment(p_payment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_org uuid;
  v_payment public.supplier_payments%ROWTYPE;
  v_payment_account uuid;
  v_ap_account uuid;
  v_entry_id uuid;
  v_line record;
  v_allocation_total numeric := 0;
  v_open numeric;
  v_new_paid numeric;
  v_line_count integer := 0;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  v_org := public.get_current_tenant_id();
  IF v_org IS NULL OR NOT public.wardah_is_org_member(v_org) THEN
    RAISE EXCEPTION 'TENANT_MEMBERSHIP_REQUIRED';
  END IF;

  SELECT * INTO v_payment
  FROM public.supplier_payments
  WHERE id = p_payment_id AND org_id = v_org
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SUPPLIER_PAYMENT_NOT_FOUND_OR_CROSS_ORG'; END IF;

  IF v_payment.status = 'posted' AND v_payment.gl_entry_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.gl_entries e
      WHERE e.id = v_payment.gl_entry_id AND e.org_id = v_org AND e.status = 'posted'
    ) THEN
      RAISE EXCEPTION 'SUPPLIER_PAYMENT_POSTED_GL_INVALID';
    END IF;
    RETURN jsonb_build_object('success', true, 'duplicate', true,
      'payment_id', v_payment.id, 'entry_id', v_payment.gl_entry_id, 'status', 'posted');
  END IF;
  IF v_payment.status <> 'draft' THEN
    RAISE EXCEPTION 'SUPPLIER_PAYMENT_NOT_DRAFT: status=%', v_payment.status;
  END IF;

  v_payment_account := v_payment.payment_account_id;
  IF v_payment_account IS NULL THEN
    SELECT a.id INTO v_payment_account FROM public.gl_accounts a
    WHERE a.org_id = v_org AND a.subtype = CASE WHEN v_payment.payment_method='cash' THEN 'CASH' ELSE 'BANK' END
      AND coalesce(a.is_active,true) AND coalesce(a.allow_posting,true)
    ORDER BY a.code, a.id LIMIT 1;
  END IF;
  SELECT a.id INTO v_ap_account FROM public.gl_accounts a
  WHERE a.org_id = v_org AND a.subtype = 'ACCOUNTS_PAYABLE'
    AND coalesce(a.is_active,true) AND coalesce(a.allow_posting,true)
  ORDER BY a.code, a.id LIMIT 1;
  IF v_payment_account IS NULL OR v_ap_account IS NULL THEN
    RAISE EXCEPTION 'SUPPLIER_PAYMENT_GL_ACCOUNTS_MISSING';
  END IF;

  FOR v_line IN
    SELECT l.id, l.invoice_id, l.allocated_amount, coalesce(l.discount_amount,0) AS discount_amount,
 i.org_id, i.vendor_id, i.total_amount, coalesce(i.paid_amount,0) AS paid_amount, i.status
    FROM public.supplier_payment_lines l
    JOIN public.supplier_invoices i ON i.id = l.invoice_id
    WHERE l.payment_id = v_payment.id
    ORDER BY i.id
    FOR UPDATE OF i
  LOOP
    v_line_count := v_line_count + 1;
    IF v_line.org_id <> v_org OR v_line.vendor_id <> v_payment.vendor_id THEN
      RAISE EXCEPTION 'SUPPLIER_PAYMENT_ALLOCATION_CROSS_SCOPE';
    END IF;
    IF v_line.status NOT IN ('approved','partially_paid','overdue') THEN
      RAISE EXCEPTION 'SUPPLIER_INVOICE_NOT_PAYABLE: invoice=% status=%', v_line.invoice_id, v_line.status;
    END IF;
    IF v_line.discount_amount <> 0 THEN
      RAISE EXCEPTION 'VOUCHER_DISCOUNT_UNSUPPORTED: discount accounting mapping is required';
    END IF;
    v_open := round(v_line.total_amount - v_line.paid_amount, 2);
    IF round(v_line.allocated_amount,2) > v_open THEN
      RAISE EXCEPTION 'SUPPLIER_PAYMENT_OVER_ALLOCATION: invoice=% open=% allocated=%',
        v_line.invoice_id, v_open, v_line.allocated_amount;
    END IF;
    v_allocation_total := v_allocation_total + round(v_line.allocated_amount,2);
  END LOOP;

  IF v_line_count > 0 AND round(v_allocation_total,2) <> round(v_payment.amount,2) THEN
    RAISE EXCEPTION 'SUPPLIER_PAYMENT_ALLOCATION_TOTAL_MISMATCH: allocations=% payment=%',
      v_allocation_total, v_payment.amount;
  END IF;

  v_entry_id := public.wardah_create_posted_voucher_gl(
    v_org, 'SUPPLIER_PAYMENT', v_payment.id, v_payment.payment_number,
    v_payment.payment_date, 'سند صرف ' || v_payment.payment_number,
    v_ap_account, v_payment_account, v_payment.amount, v_actor
  );

  FOR v_line IN
    SELECT l.invoice_id, l.allocated_amount, i.total_amount, coalesce(i.paid_amount,0) AS paid_amount
    FROM public.supplier_payment_lines l
    JOIN public.supplier_invoices i ON i.id = l.invoice_id
    WHERE l.payment_id = v_payment.id
    ORDER BY i.id
    FOR UPDATE OF i
  LOOP
    v_new_paid := round(v_line.paid_amount + v_line.allocated_amount,2);
    UPDATE public.supplier_invoices
    SET paid_amount = v_new_paid,
        status = CASE WHEN v_new_paid >= round(v_line.total_amount,2) THEN 'paid' ELSE 'partially_paid' END,
        updated_at = now()
    WHERE id = v_line.invoice_id AND org_id = v_org;
  END LOOP;

  UPDATE public.supplier_payments
  SET status='posted', gl_entry_id=v_entry_id, posted_at=now(), posted_by=v_actor, updated_at=now()
  WHERE id=v_payment.id AND org_id=v_org AND status='draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'SUPPLIER_PAYMENT_STATE_CHANGED'; END IF;

  RETURN jsonb_build_object('success', true, 'duplicate', false,
    'payment_id', v_payment.id, 'entry_id', v_entry_id, 'status', 'posted');
END
$function$;

REVOKE ALL ON FUNCTION public.rpc_post_customer_receipt(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_post_customer_receipt(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.rpc_post_customer_receipt(uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.rpc_post_customer_receipt(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.rpc_post_supplier_payment(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_post_supplier_payment(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.rpc_post_supplier_payment(uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.rpc_post_supplier_payment(uuid) TO authenticated;

COMMENT ON FUNCTION public.rpc_post_customer_receipt(uuid) IS
  'Migration 153 atomic customer receipt posting: legal GL, invoice allocations and voucher state commit or roll back together.';
COMMENT ON FUNCTION public.rpc_post_supplier_payment(uuid) IS
  'Migration 153 atomic supplier payment posting: legal GL, invoice allocations and voucher state commit or roll back together.';

-- ---------------------------------------------------------------------
-- 8. Prove posted immutability is active again before commit
-- ---------------------------------------------------------------------
DO $guard_check$
DECLARE
  v_line_id uuid;
  v_guarded boolean := false;
  v_trigger_enabled "char";
BEGIN
  SELECT t.tgenabled INTO v_trigger_enabled
  FROM pg_trigger t
  WHERE t.tgrelid = 'public.gl_entry_lines'::regclass
    AND t.tgname = 'trg_protect_posted_gl_entry_lines'
    AND NOT t.tgisinternal;

  IF v_trigger_enabled <> 'O' THEN
    RAISE EXCEPTION 'GL_153_POSTED_TRIGGER_FINAL_STATE_INVALID: state=%', v_trigger_enabled;
  END IF;

  SELECT s.id INTO v_line_id
  FROM wardah_153_line_snapshot s
  WHERE s.status = 'posted'
  ORDER BY s.id
  LIMIT 1;

  IF v_line_id IS NOT NULL THEN
    BEGIN
      UPDATE public.gl_entry_lines
      SET description = description
      WHERE id = v_line_id;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE '%POSTED_ENTRY_IMMUTABLE%' THEN
        v_guarded := true;
      ELSE
        RAISE;
      END IF;
    END;

    IF NOT v_guarded THEN
      RAISE EXCEPTION 'GL_153_POSTED_GUARD_INEFFECTIVE: posted line update unexpectedly succeeded';
    END IF;
  END IF;
END
$guard_check$;

DO $done$
DECLARE
  v_targets bigint;
BEGIN
  SELECT count(*) INTO v_targets FROM wardah_153_targets;
  RAISE NOTICE 'GL_153_APPLIED: backfilled_lines=%; legal totals/constraints/compatibility installed', v_targets;
END
$done$;

COMMIT;
