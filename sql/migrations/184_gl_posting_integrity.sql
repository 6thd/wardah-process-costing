-- Migration 184 — Round 2 GL posting integrity.
--
-- A balanced gl_entries header was previously sufficient for status='posted':
-- direct INSERT was not covered by check_balance_before_post, and no database
-- invariant tied header totals to the legal debit/credit sums of its lines.
-- This migration adds both safeguards without scanning or rewriting historical
-- rows. Existing historical header-only postings remain evidence for separate
-- remediation; any future mutation touching a posted entry is fail-closed.

BEGIN;

CREATE OR REPLACE FUNCTION public.check_balance_before_post()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_becomes_posted boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_becomes_posted := NEW.status = 'posted';
  ELSIF TG_OP = 'UPDATE' THEN
    v_becomes_posted := NEW.status = 'posted'
      AND OLD.status IS DISTINCT FROM 'posted';
  END IF;

  IF v_becomes_posted THEN
    IF ABS(NEW.total_debit - NEW.total_credit) >= 0.01 THEN
      RAISE EXCEPTION
        'GL_POSTING_HEADER_UNBALANCED: debit=%, credit=%',
        NEW.total_debit, NEW.total_credit;
    END IF;
    NEW.posted_at := NOW();
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS check_balance_before_post_trigger
  ON public.gl_entries;
CREATE TRIGGER check_balance_before_post_trigger
BEFORE INSERT OR UPDATE ON public.gl_entries
FOR EACH ROW
EXECUTE FUNCTION public.check_balance_before_post();

CREATE OR REPLACE FUNCTION public.wardah_184_assert_posted_entry_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_entry_id uuid;
  v_entry_ids uuid[];
  v_status text;
  v_entry_number text;
  v_header_debit numeric;
  v_header_credit numeric;
  v_line_count bigint;
  v_line_debit numeric;
  v_line_credit numeric;
BEGIN
  IF TG_TABLE_NAME = 'gl_entries' THEN
    v_entry_ids := ARRAY[COALESCE(NEW.id, OLD.id)];
  ELSE
    v_entry_ids := ARRAY_REMOVE(
      ARRAY[CASE WHEN TG_OP <> 'DELETE' THEN NEW.entry_id END,
            CASE WHEN TG_OP <> 'INSERT' THEN OLD.entry_id END],
      NULL
    );
  END IF;

  FOREACH v_entry_id IN ARRAY v_entry_ids LOOP
    SELECT e.status, e.entry_number, e.total_debit, e.total_credit
    INTO v_status, v_entry_number, v_header_debit, v_header_credit
    FROM public.gl_entries e
    WHERE e.id = v_entry_id;

    IF NOT FOUND OR v_status IS DISTINCT FROM 'posted' THEN
      CONTINUE;
    END IF;

    SELECT COUNT(*),
           COALESCE(SUM(l.debit), 0),
           COALESCE(SUM(l.credit), 0)
    INTO v_line_count, v_line_debit, v_line_credit
    FROM public.gl_entry_lines l
    WHERE l.entry_id = v_entry_id;

    IF v_line_count < 2 THEN
      RAISE EXCEPTION
        'POSTED_ENTRY_LINES_MISSING: entry=% line_count=%',
        v_entry_number, v_line_count;
    END IF;

    IF ABS(v_line_debit - v_line_credit) >= 0.01 THEN
      RAISE EXCEPTION
        'POSTED_ENTRY_LINES_UNBALANCED: entry=% debit=% credit=%',
        v_entry_number, v_line_debit, v_line_credit;
    END IF;

    IF ABS(v_header_debit - v_line_debit) >= 0.01
       OR ABS(v_header_credit - v_line_credit) >= 0.01 THEN
      RAISE EXCEPTION
        'POSTED_ENTRY_HEADER_LINES_MISMATCH: entry=% header=(%,%) lines=(%,%)',
        v_entry_number, v_header_debit, v_header_credit,
        v_line_debit, v_line_credit;
    END IF;
  END LOOP;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS trg_wardah_184_posted_entry_integrity_header
  ON public.gl_entries;
CREATE CONSTRAINT TRIGGER trg_wardah_184_posted_entry_integrity_header
AFTER INSERT OR UPDATE ON public.gl_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.wardah_184_assert_posted_entry_integrity();

DROP TRIGGER IF EXISTS trg_wardah_184_posted_entry_integrity_lines
  ON public.gl_entry_lines;
CREATE CONSTRAINT TRIGGER trg_wardah_184_posted_entry_integrity_lines
AFTER INSERT OR UPDATE OR DELETE ON public.gl_entry_lines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.wardah_184_assert_posted_entry_integrity();

REVOKE ALL ON FUNCTION public.check_balance_before_post()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.wardah_184_assert_posted_entry_integrity()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.wardah_184_assert_posted_entry_integrity() IS
  'Deferred constraint trigger: every touched posted GL entry has at least two '
  'legal lines whose debit/credit sums balance and equal the header totals.';

DO $postflight$
DECLARE
  v_header_type integer;
  v_constraint_count integer;
BEGIN
  SELECT t.tgtype INTO v_header_type
  FROM pg_trigger t
  WHERE t.tgrelid = 'public.gl_entries'::regclass
    AND t.tgname = 'check_balance_before_post_trigger'
    AND NOT t.tgisinternal;

  IF v_header_type IS NULL
     OR (v_header_type & 2) = 0
     OR (v_header_type & 4) = 0
     OR (v_header_type & 16) = 0 THEN
    RAISE EXCEPTION 'GL_184_HEADER_TRIGGER_EVENTS_INVALID: %', v_header_type;
  END IF;

  SELECT COUNT(*) INTO v_constraint_count
  FROM pg_trigger t
  WHERE t.tgname IN (
      'trg_wardah_184_posted_entry_integrity_header',
      'trg_wardah_184_posted_entry_integrity_lines')
    AND t.tgdeferrable
    AND t.tginitdeferred
    AND NOT t.tgisinternal;

  IF v_constraint_count <> 2 THEN
    RAISE EXCEPTION
      'GL_184_DEFERRED_CONSTRAINT_TRIGGERS_INVALID: %', v_constraint_count;
  END IF;
END;
$postflight$;

COMMIT;
