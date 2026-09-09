-- Wardah ERP / F2 / M191 Slice 12
-- Reusable normalization + assertions shared by the aggregate static gate and
-- its self-acceptance. REVIEW/TEST ARTIFACT ONLY. Do not run on Production.
--
-- Everything here is created in pg_temp and disappears with the session. It is
-- factored out of 12_acceptance_static_gates.sql for one reason: assertions
-- that take body text as a parameter can be fed synthetic bodies, which is what
-- lets 12_acceptance_gate_selftest.sql prove the gate actually fails on known
-- bad shapes without mutating any catalog object in the assembled candidate.
--
-- REGEX CONVENTION
-- ----------------
-- Every regular expression in Slice 12 is written as an E'' string with
-- doubled backslashes. Mixing E'' and plain literals is what produced both
-- prior escaping defects: Slice 11's over-escaped pattern that rejected a
-- correct body, and this slice's own earlier
-- 'wardah_resolve_product_id[ ]*\\(' which, as a plain literal under
-- standard_conforming_strings=on, reached the regex engine as an unbalanced
-- group and made the whole gate un-runnable on PostgreSQL 16.13.

\set ON_ERROR_STOP on

-- Textual comment stripper. It does not parse string literals, so it is used
-- only where removing text can make a gate stricter (ordering, executable
-- shape, forbidden-token checks), never where it could hide a required token.
CREATE OR REPLACE FUNCTION pg_temp.m191_strip_comments(p_src text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO pg_catalog, pg_temp
AS $$
  -- Block comments first, then line comments, while newlines still exist.
  SELECT regexp_replace(
           regexp_replace(p_src, E'/\\*.*?\\*/', ' ', 'g'),
           E'--[^\\n]*', ' ', 'g'
         );
$$;

-- Whitespace-collapsed, lowercased, comments retained. For "this token must be
-- present" checks, where stripping could only weaken the gate.
CREATE OR REPLACE FUNCTION pg_temp.m191_norm(p_src text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO pg_catalog, pg_temp
AS $$
  SELECT lower(regexp_replace(p_src, E'[\\n\\r\\t ]+', ' ', 'g'));
$$;

-- Whitespace-collapsed, lowercased, comments removed. For ordering and
-- executable-shape checks, where stripping makes the gate stricter.
CREATE OR REPLACE FUNCTION pg_temp.m191_code_norm(p_src text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO pg_catalog, pg_temp
AS $$
  SELECT pg_temp.m191_norm(pg_temp.m191_strip_comments(p_src));
$$;

-- Whitespace-collapsed and UPPERCASED. The S1 header checks normalize case on
-- both sides rather than relying on ~*, so that the FOR NO KEY UPDATE mutant is
-- constructed deterministically: replace() is case sensitive, and a correct
-- body written in lower case previously produced MUTANT_FALSE_PASS, which
-- accuses the pattern of being weak when the body is in fact correct.
CREATE OR REPLACE FUNCTION pg_temp.m191_upper_norm(p_src text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO pg_catalog, pg_temp
AS $$
  SELECT upper(regexp_replace(p_src, E'[\\n\\r\\t ]+', ' ', 'g'));
$$;

-- Generalized product-prefix lock-order assertion.
--
-- Two properties, both required:
--   1) the body takes the shared product prefix through an executable call;
--   2) if the body touches public.bins at all, the prefix precedes the FIRST
--      touch under any DML/read shape, not only FROM.
--
-- On (1): the call must appear in statement position, in one of the two forms
-- the assembled candidate actually uses —
--   PERFORM public.wardah_lock_products_for_stock_write(...)
--     in incoming/outgoing/cancel/manual-movement/create-MO, and
--   v_locked_products := public.wardah_lock_products_for_stock_write(...)
--     in goods receipt/delivery note/adjustment submit/consumption.
-- Requiring PERFORM alone would fail the four assignment-form bodies, but
-- accepting a bare `public.<helper>(` is not enough either: comment stripping
-- does not lex string literals, so a body could satisfy it with
-- `RAISE NOTICE 'public.wardah_lock_products_for_stock_write(';` and no call at
-- all. The pattern therefore requires a statement boundary followed by PERFORM
-- or an assignment target, which no string-literal mention can supply.
--
-- On (2): matching only FROM was demonstrably bypassable. A body that took a
-- bin row through UPDATE before the prefix and read it through FROM afterwards
-- passed the first revision of this gate, and rpc_cancel_stock_adjustment's own
-- first bins touch is an UPDATE.
CREATE OR REPLACE FUNCTION pg_temp.m191_assert_prefix_before_bins(
  p_label text,
  p_src text
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO pg_catalog, pg_temp
AS $$
DECLARE
  v_code text;
  v_prefix integer;
  v_bins integer;
BEGIN
  v_code := pg_temp.m191_code_norm(p_src);

  v_prefix := regexp_instr(
    v_code,
    E'(^|; |begin |loop |then |else )(perform|[a-z0-9_]+ *:=) *'
    || E'public\\.wardah_lock_products_for_stock_write *\\('
  );
  IF v_prefix = 0 THEN
    RAISE EXCEPTION 'M191_ACCEPTANCE_PREFIX_CALL_MISSING: %', p_label;
  END IF;

  -- Deliberately matched on comment-stripped code with string literals intact,
  -- so a bins touch smuggled through dynamic SQL is still seen. Positions from
  -- both patterns therefore share one coordinate system.
  v_bins := regexp_instr(
    v_code,
    E'(from|join|update|delete +from|insert +into) +public\\.bins([^a-z0-9_]|$)'
  );

  IF v_bins > 0 AND v_prefix >= v_bins THEN
    RAISE EXCEPTION
      'M191_ACCEPTANCE_PREFIX_NOT_BEFORE_BINS: % prefix=% first_bins_touch=%',
      p_label, v_prefix, v_bins;
  END IF;
END
$$;

-- Shared helper static order/mode contract.
--
-- Every check here runs on comment-stripped code. The ordering clause is the
-- single most important property in the helper — it is what makes the global
-- lock order global — and matching it on text that still contains comments let
-- a body drop the real `ORDER BY p.id` and satisfy the gate with a leftover
-- `-- ORDER BY p.id FOR NO KEY UPDATE` note.
CREATE OR REPLACE FUNCTION pg_temp.m191_assert_helper_contract(
  p_label text,
  p_src text
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO pg_catalog, pg_temp
AS $$
DECLARE
  v_code text;
BEGIN
  v_code := pg_temp.m191_code_norm(p_src);

  IF position('order by p.id for no key update' IN v_code) = 0 THEN
    RAISE EXCEPTION 'M191_ACCEPTANCE_HELPER_ORDER_OR_MODE_MISSING: %', p_label;
  END IF;

  IF v_code ~ E'(^|[^a-z])for +update([^a-z]|$)' THEN
    RAISE EXCEPTION 'M191_ACCEPTANCE_HELPER_FOR_UPDATE_REINTRODUCED: %', p_label;
  END IF;

  IF position('from public.products p' IN v_code) = 0 THEN
    RAISE EXCEPTION
      'M191_ACCEPTANCE_HELPER_PRODUCTS_NOT_SCHEMA_QUALIFIED: %', p_label;
  END IF;
END
$$;

-- Fix G captured-identity contract.
--
-- Presence of `RETURNING ... INTO v_persisted_product_id` and presence of the
-- string ITEM_PRODUCT_MAPPING_DRIFT do not together prove the comparison. A
-- body can persist, drop `IF v_persisted_product_id IS DISTINCT FROM
-- v_product_id`, and keep the RAISE under some other or dead condition, and
-- two independent presence checks will both still pass.
--
-- So assert the whole guard as one contiguous shape: the RETURNING, then
-- immediately the exact comparison of the persisted value against the captured
-- value, then immediately the drift RAISE. Requiring adjacency is deliberate —
-- any statement wedged between persisting the row and checking it is a change
-- to the contract and should be re-reviewed, not silently accepted.
--
-- Matched on comment-stripped code with string literals intact, because the
-- error name being asserted lives inside the RAISE literal.
CREATE OR REPLACE FUNCTION pg_temp.m191_assert_fix_g_capture_contract(
  p_label text,
  p_src text
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO pg_catalog, pg_temp
AS $$
DECLARE
  v_code text;
  v_resolver_calls integer;
BEGIN
  v_code := pg_temp.m191_code_norm(p_src);

  SELECT count(*) INTO v_resolver_calls
  FROM regexp_matches(v_code, E'wardah_resolve_product_id *\\(', 'g');

  IF v_resolver_calls <> 1 THEN
    RAISE EXCEPTION 'M191_ACCEPTANCE_FIX_G_RESOLVER_CALL_COUNT: % (%)',
      v_resolver_calls, p_label;
  END IF;

  IF v_code !~ (
    E'returning +product_id +into +v_persisted_product_id; *'
    || E'if +v_persisted_product_id +is +distinct +from +v_product_id +then *'
    || E'raise +exception *''item_product_mapping_drift'
  ) THEN
    RAISE EXCEPTION 'M191_ACCEPTANCE_FIX_G_EXACT_DRIFT_GUARD_MISSING: %', p_label;
  END IF;

  IF position('pg_advisory_' IN v_code) > 0 THEN
    RAISE EXCEPTION
      'M191_ACCEPTANCE_FIX_G_TEST_GATE_IN_PRODUCTION_BODY: %', p_label;
  END IF;
END
$$;

-- S1 header-lock assertion: a positive match on the real body, plus a
-- regression test that the pattern still rejects a FOR NO KEY UPDATE mutant.
--
-- The mutant half is NOT independent evidence about the deployed body. The
-- mutant is derived from the same text that just satisfied the positive match,
-- so it can only fire when p_pattern itself has been weakened (for example to
-- FOR.*UPDATE) into something that would also accept a downgraded lock. It is a
-- regression test on pattern strength; the deployed body's correctness is
-- established by the positive match alone.
CREATE OR REPLACE FUNCTION pg_temp.m191_assert_s1_header(
  p_label text,
  p_src text,
  p_pattern text
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO pg_catalog, pg_temp
AS $$
DECLARE
  v_def text;
  v_mutant text;
BEGIN
  v_def := pg_temp.m191_upper_norm(p_src);

  IF v_def !~ p_pattern THEN
    RAISE EXCEPTION 'M191_ACCEPTANCE_S1_POSITIVE_REGEX_FAIL: %', p_label;
  END IF;

  v_mutant := replace(v_def, 'FOR UPDATE', 'FOR NO KEY UPDATE');
  IF v_mutant ~ p_pattern THEN
    RAISE EXCEPTION 'M191_ACCEPTANCE_S1_PATTERN_ACCEPTS_MUTANT: %', p_label;
  END IF;
END
$$;
