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
-- On (1): the call-shape pattern deliberately does not require PERFORM. The
-- assembled candidate uses two forms —
--   PERFORM public.wardah_lock_products_for_stock_write(...)
--     in incoming/outgoing/cancel/manual-movement/create-MO, and
--   v_locked_products := public.wardah_lock_products_for_stock_write(...)
--     in goods receipt/delivery note/adjustment submit/consumption.
-- Requiring PERFORM would fail four correct bodies. What separates a call from
-- a mention here is the open parenthesis together with the comment stripping.
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
    E'public\\.wardah_lock_products_for_stock_write *\\('
  );
  IF v_prefix = 0 THEN
    RAISE EXCEPTION 'M191_ACCEPTANCE_PREFIX_CALL_MISSING: %', p_label;
  END IF;

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
