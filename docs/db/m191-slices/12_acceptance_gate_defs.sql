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
-- WHY A MASKER AND NOT MORE REGEX
-- -------------------------------
-- Stripping comments alone was not enough. pg_get_functiondef returns the body
-- verbatim, and a check that reads text with string literals intact can be
-- satisfied by a literal that merely quotes the shape being asserted:
--
--   RAISE NOTICE 'begin perform public.wardah_lock_products_for_stock_write(';
--   RAISE NOTICE 'order by p.id for no key update';
--   RAISE NOTICE 'returning product_id into v_persisted_product_id; if ...';
--
-- Each of those defeated a previous revision of the gate while the real call,
-- the real ordering clause and the real drift guard were absent. Adding more
-- boundary anchors only moves the goalposts; the literal can always quote one
-- more token. So structural checks run on a masked view of the body instead.
--
-- m191_exec_mask blanks comment characters and single-quoted string CONTENT
-- with spaces, character for character, leaving every other character and
-- every offset exactly where it was. Structural assertions then match against
-- executable text only, and positions taken from the masked view remain
-- comparable with each other.
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

-- ---------------------------------------------------------------------------
-- Length-preserving executable mask
-- ---------------------------------------------------------------------------
--
-- Blanks, with spaces and without changing length:
--   * -- line comments, to end of line;
--   * /* */ block comments, honouring PostgreSQL's nesting;
--   * the CONTENT of single-quoted literals, keeping the delimiting quotes so
--     the statement shape around them stays readable. A doubled '' inside a
--     literal is content and is blanked with it.
--
-- It deliberately does NOT descend into dollar quoting, because the function
-- body handed to it is itself dollar-quoted by pg_get_functiondef and the whole
-- point is to look inside that. m191_assert_maskable below fails closed if a
-- body carries a nested dollar-quoted literal the mask therefore cannot see.
CREATE OR REPLACE FUNCTION pg_temp.m191_exec_mask(p_src text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO pg_catalog, pg_temp
AS $$
DECLARE
  v_out text := p_src;
  v_len integer := length(p_src);
  v_i integer := 1;
  v_start integer;
  v_depth integer;
BEGIN
  WHILE v_i <= v_len LOOP
    IF substr(p_src, v_i, 2) = '--' THEN
      v_start := v_i;
      WHILE v_i <= v_len AND substr(p_src, v_i, 1) <> E'\n' LOOP
        v_i := v_i + 1;
      END LOOP;
      v_out := overlay(v_out placing repeat(' ', v_i - v_start)
                       from v_start for v_i - v_start);

    ELSIF substr(p_src, v_i, 2) = '/*' THEN
      v_start := v_i;
      v_depth := 1;
      v_i := v_i + 2;
      WHILE v_i <= v_len AND v_depth > 0 LOOP
        IF substr(p_src, v_i, 2) = '/*' THEN
          v_depth := v_depth + 1;
          v_i := v_i + 2;
        ELSIF substr(p_src, v_i, 2) = '*/' THEN
          v_depth := v_depth - 1;
          v_i := v_i + 2;
        ELSE
          v_i := v_i + 1;
        END IF;
      END LOOP;
      v_out := overlay(v_out placing repeat(' ', v_i - v_start)
                       from v_start for v_i - v_start);

    ELSIF substr(p_src, v_i, 1) = '''' THEN
      v_start := v_i + 1;                       -- keep the opening quote
      v_i := v_i + 1;
      LOOP
        EXIT WHEN v_i > v_len;
        IF substr(p_src, v_i, 1) = '''' THEN
          IF substr(p_src, v_i + 1, 1) = '''' THEN
            v_i := v_i + 2;                     -- doubled quote is content
          ELSE
            EXIT;                               -- closing quote
          END IF;
        ELSE
          v_i := v_i + 1;
        END IF;
      END LOOP;
      IF v_i > v_start THEN
        v_out := overlay(v_out placing repeat(' ', v_i - v_start)
                         from v_start for v_i - v_start);
      END IF;
      v_i := v_i + 1;                           -- step past the closing quote

    ELSE
      v_i := v_i + 1;
    END IF;
  END LOOP;

  RETURN v_out;
END
$$;

-- Fail closed on the three constructs that would make the mask unsound.
CREATE OR REPLACE FUNCTION pg_temp.m191_assert_maskable(
  p_label text,
  p_src text
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO pg_catalog, pg_temp
AS $$
DECLARE
  v_tags integer;
BEGIN
  -- A functiondef carries exactly one outer dollar-quote pair; a synthetic body
  -- carries none. Anything else means a nested dollar-quoted literal, whose
  -- contents the mask cannot blank.
  SELECT count(*) INTO v_tags
  FROM regexp_matches(p_src, E'\\$[A-Za-z_0-9]*\\$', 'g');

  IF v_tags NOT IN (0, 2) THEN
    RAISE EXCEPTION
      'M191_ACCEPTANCE_NESTED_DOLLAR_QUOTE_UNSUPPORTED: % tags=%', p_label, v_tags;
  END IF;

  -- E'' literals use backslash escapes, so \' would end a literal early and
  -- desynchronize the mask. No M191 body uses one.
  IF p_src ~* E'(^|[^A-Za-z_0-9])E''' THEN
    RAISE EXCEPTION
      'M191_ACCEPTANCE_ESCAPE_STRING_UNSUPPORTED: %', p_label;
  END IF;

  -- Dynamic SQL would let a real statement hide inside a masked literal, which
  -- is exactly what the mask blanks. No M191 body uses it, and a lock-ordering
  -- proof over a body that builds SQL at run time would not be a proof anyway.
  IF pg_temp.m191_exec_mask(p_src) ~* E'(^|[^A-Za-z_0-9])EXECUTE([^A-Za-z_0-9]|$)' THEN
    RAISE EXCEPTION
      'M191_ACCEPTANCE_DYNAMIC_SQL_UNSUPPORTED: %', p_label;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Normalizations
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION pg_temp.m191_strip_comments(p_src text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO pg_catalog, pg_temp
AS $$
  SELECT regexp_replace(
           regexp_replace(p_src, E'/\\*.*?\\*/', ' ', 'g'),
           E'--[^\\n]*', ' ', 'g'
         );
$$;

-- Whitespace-collapsed, lowercased.
CREATE OR REPLACE FUNCTION pg_temp.m191_norm(p_src text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO pg_catalog, pg_temp
AS $$
  SELECT lower(regexp_replace(p_src, E'[\\n\\r\\t ]+', ' ', 'g'));
$$;

-- Comments removed, string literals intact. Used only where a required token
-- genuinely lives inside a literal.
CREATE OR REPLACE FUNCTION pg_temp.m191_code_norm(p_src text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO pg_catalog, pg_temp
AS $$
  SELECT pg_temp.m191_norm(pg_temp.m191_strip_comments(p_src));
$$;

-- Executable text only: comments and literal contents masked, then normalized.
-- This is what every structural assertion matches against.
CREATE OR REPLACE FUNCTION pg_temp.m191_exec_norm(p_label text, p_src text)
RETURNS text
LANGUAGE plpgsql
SET search_path TO pg_catalog, pg_temp
AS $$
BEGIN
  PERFORM pg_temp.m191_assert_maskable(p_label, p_src);
  RETURN pg_temp.m191_norm(pg_temp.m191_exec_mask(p_src));
END
$$;

-- Same, uppercased. The S1 header checks normalize case on both sides rather
-- than relying on ~*, so that the FOR NO KEY UPDATE mutant is constructed
-- deterministically: replace() is case sensitive, and a correct body written in
-- lower case previously produced MUTANT_FALSE_PASS, which accuses the pattern
-- of being weak when the body is in fact correct.
CREATE OR REPLACE FUNCTION pg_temp.m191_exec_upper_norm(p_label text, p_src text)
RETURNS text
LANGUAGE plpgsql
SET search_path TO pg_catalog, pg_temp
AS $$
BEGIN
  PERFORM pg_temp.m191_assert_maskable(p_label, p_src);
  RETURN upper(regexp_replace(pg_temp.m191_exec_mask(p_src),
                              E'[\\n\\r\\t ]+', ' ', 'g'));
END
$$;

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------

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
-- Requiring PERFORM alone would fail the four assignment-form bodies.
--
-- On (2): matching only FROM was demonstrably bypassable. A body that took a
-- bin row through UPDATE before the prefix and read it through FROM afterwards
-- passed an earlier revision, and rpc_cancel_stock_adjustment's own first bins
-- touch is an UPDATE.
--
-- Both patterns run over the same masked text, so their offsets are directly
-- comparable and neither can be satisfied from inside a string literal.
-- Masking cannot hide a real bins touch here because m191_assert_maskable
-- already rejects dynamic SQL.
CREATE OR REPLACE FUNCTION pg_temp.m191_assert_prefix_before_bins(
  p_label text,
  p_src text
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO pg_catalog, pg_temp
AS $$
DECLARE
  v_exec text;
  v_prefix integer;
  v_bins integer;
BEGIN
  v_exec := pg_temp.m191_exec_norm(p_label, p_src);

  v_prefix := regexp_instr(
    v_exec,
    E'(^|; |begin |loop |then |else )(perform|[a-z0-9_]+ *:=) *'
    || E'public\\.wardah_lock_products_for_stock_write *\\('
  );
  IF v_prefix = 0 THEN
    RAISE EXCEPTION 'M191_ACCEPTANCE_PREFIX_CALL_MISSING: %', p_label;
  END IF;

  v_bins := regexp_instr(
    v_exec,
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
-- The ordering clause is the single most important property in the helper — it
-- is what makes the global lock order global — so it is asserted against
-- executable text. A body that drops the real ORDER BY p.id must fail whether
-- the clause survives as a comment or as a quoted string.
CREATE OR REPLACE FUNCTION pg_temp.m191_assert_helper_contract(
  p_label text,
  p_src text
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO pg_catalog, pg_temp
AS $$
DECLARE
  v_exec text;
BEGIN
  v_exec := pg_temp.m191_exec_norm(p_label, p_src);

  IF position('order by p.id for no key update' IN v_exec) = 0 THEN
    RAISE EXCEPTION 'M191_ACCEPTANCE_HELPER_ORDER_OR_MODE_MISSING: %', p_label;
  END IF;

  IF v_exec ~ E'(^|[^a-z])for +update([^a-z]|$)' THEN
    RAISE EXCEPTION 'M191_ACCEPTANCE_HELPER_FOR_UPDATE_REINTRODUCED: %', p_label;
  END IF;

  IF position('from public.products p' IN v_exec) = 0 THEN
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
-- So assert the whole guard as one contiguous executable shape: the RETURNING,
-- then immediately the exact comparison of the persisted value against the
-- captured value, then immediately a RAISE EXCEPTION. Requiring adjacency is
-- deliberate — any statement wedged between persisting the row and checking it
-- is a change to the contract and should be re-reviewed, not silently accepted.
--
-- The error NAME is checked separately, and only for presence, because on
-- masked text the literal is blank by construction. Static analysis proves the
-- guard exists and has the right shape; that this particular guard raises this
-- particular error is proven at run time by Drift B and Drift C (§10.4, §10.5),
-- which assert ITEM_PRODUCT_MAPPING_DRIFT and whole-RPC rollback. Do not try to
-- make a literal carry the structural proof — that is precisely what a quoted
-- string was able to fake.
CREATE OR REPLACE FUNCTION pg_temp.m191_assert_fix_g_capture_contract(
  p_label text,
  p_src text
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO pg_catalog, pg_temp
AS $$
DECLARE
  v_exec text;
  v_code text;
  v_resolver_calls integer;
BEGIN
  v_exec := pg_temp.m191_exec_norm(p_label, p_src);
  v_code := pg_temp.m191_code_norm(p_src);

  SELECT count(*) INTO v_resolver_calls
  FROM regexp_matches(v_exec, E'wardah_resolve_product_id *\\(', 'g');

  IF v_resolver_calls <> 1 THEN
    RAISE EXCEPTION 'M191_ACCEPTANCE_FIX_G_RESOLVER_CALL_COUNT: % (%)',
      v_resolver_calls, p_label;
  END IF;

  IF v_exec !~ (
    E'returning +product_id +into +v_persisted_product_id; *'
    || E'if +v_persisted_product_id +is +distinct +from +v_product_id +then *'
    || E'raise +exception([^a-z0-9_]|$)'
  ) THEN
    RAISE EXCEPTION 'M191_ACCEPTANCE_FIX_G_EXACT_DRIFT_GUARD_MISSING: %', p_label;
  END IF;

  IF position('item_product_mapping_drift' IN v_code) = 0 THEN
    RAISE EXCEPTION 'M191_ACCEPTANCE_FIX_G_DRIFT_ERROR_NAME_MISSING: %', p_label;
  END IF;

  IF position('pg_advisory_' IN v_exec) > 0 THEN
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
  v_def := pg_temp.m191_exec_upper_norm(p_label, p_src);

  IF v_def !~ p_pattern THEN
    RAISE EXCEPTION 'M191_ACCEPTANCE_S1_POSITIVE_REGEX_FAIL: %', p_label;
  END IF;

  v_mutant := replace(v_def, 'FOR UPDATE', 'FOR NO KEY UPDATE');
  IF v_mutant ~ p_pattern THEN
    RAISE EXCEPTION 'M191_ACCEPTANCE_S1_PATTERN_ACCEPTS_MUTANT: %', p_label;
  END IF;
END
$$;

-- Fix F ordered reservation-lock contract.
--
-- FINAL-REVIEW REMEDIATION (PR #241, Finding 2). At the reviewed head
-- fa1de77f07077af97623c34c0a743b5d00000785 nothing in the acceptance layer
-- looked at release_expired_reservations' own locking query. Flipping the real
-- body's `ORDER BY mr.id` to `ORDER BY mr.id DESC` left the catalog contract,
-- this static gate and §9 of the runtime harness all GREEN — reproduced on a
-- Fresh PostgreSQL 17 before this assertion was written.
--
-- Fix F's entire value is that release acquires material_reservations rows in
-- the SAME ascending id order consumption uses. That is one clause, and a
-- single character (`DESC`) reverses it, so it gets an assertion of its own
-- rather than being inferred from the function's continued existence.
--
-- Asserted on masked executable text, so a matching shape that survives only in
-- a comment or a quoted string cannot satisfy it. Structure proven here; the
-- ACTUAL acquisition sequence R1 -> R2 is proven at run time against the
-- deployed function by §9.4/§9.5 of s9_fixf.sh, which also runs the same probe
-- against a DESC mutant derived from the deployed body.
CREATE OR REPLACE FUNCTION pg_temp.m191_assert_fix_f_release_lock_contract(
  p_label text,
  p_src text
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO pg_catalog, pg_temp
AS $$
DECLARE
  v_exec text;
  v_lock integer;
  v_update integer;
BEGIN
  v_exec := pg_temp.m191_exec_norm(p_label, p_src);

  -- 1) The acquisition must read material_reservations under the mr alias the
  --    ordering clause below names. Without this anchor, `order by mr.id` could
  --    be asserted against a query over some other relation entirely.
  v_lock := regexp_instr(
    v_exec,
    E'from +public\\.material_reservations +mr([^a-z0-9_]|$)'
  );
  IF v_lock = 0 THEN
    RAISE EXCEPTION 'M191_ACCEPTANCE_FIX_F_LOCK_SOURCE_MISSING: %', p_label;
  END IF;

  -- 2) A descending sweep is the exact reversal Fix F exists to prevent, so it
  --    gets its own verdict rather than being folded into "clause missing".
  IF v_exec ~ E'order +by +mr\\.id +desc([^a-z0-9_]|$)' THEN
    RAISE EXCEPTION 'M191_ACCEPTANCE_FIX_F_DESCENDING_LOCK_ORDER: %', p_label;
  END IF;

  -- 3) FOR UPDATE takes the key lock too and conflicts with the FK checks the
  --    consumption path performs, which is why Fix F specifies the weaker mode.
  IF v_exec ~ E'(^|[^a-z])for +update([^a-z]|$)' THEN
    RAISE EXCEPTION 'M191_ACCEPTANCE_FIX_F_FOR_UPDATE_REINTRODUCED: %', p_label;
  END IF;

  -- 4) SKIP LOCKED would turn the exact sweep into a best-effort cron pass and
  --    silently drop precisely the rows that are contended.
  IF v_exec ~ E'skip +locked([^a-z0-9_]|$)' THEN
    RAISE EXCEPTION 'M191_ACCEPTANCE_FIX_F_SKIP_LOCKED_PRESENT: %', p_label;
  END IF;

  -- 5) The ordering and the lock mode must be one contiguous clause. Asserting
  --    them separately would accept an ORDER BY on one query and a
  --    FOR NO KEY UPDATE on another.
  IF position('order by mr.id for no key update' IN v_exec) = 0 THEN
    RAISE EXCEPTION 'M191_ACCEPTANCE_FIX_F_ORDERED_LOCK_MISSING: %', p_label;
  END IF;

  -- 6) An UPDATE that reaches material_reservations before the ordered lock is
  --    the predecessor's defect restored: the UPDATE would then acquire rows in
  --    whatever order the plan produces, and the ordering clause below it would
  --    be decoration.
  v_update := regexp_instr(
    v_exec,
    E'update +public\\.material_reservations([^a-z0-9_]|$)'
  );
  IF v_update > 0 AND v_update < v_lock THEN
    RAISE EXCEPTION
      'M191_ACCEPTANCE_FIX_F_UPDATE_BEFORE_ORDERED_LOCK: % update=% lock=%',
      p_label, v_update, v_lock;
  END IF;
END
$$;

-- Fix E UUID parser-parity contract, scoped to ONE named prepass.
--
-- FINAL-REVIEW REMEDIATION (PR #241, Finding 3). The two Fix E prepasses gate
-- their candidate cast with pg_input_is_valid(..., 'uuid') — PostgreSQL's own
-- parser — so every spelling the later raw ::uuid cast accepts also enters the
-- prelock set. A hand-written canonical 8-4-4-4-12 regex would silently reject
-- the brace-wrapped and 32-hex-hyphenless spellings, leaving the line to fail
-- later with PRODUCT_NOT_PRELOCKED, and nothing in the acceptance layer noticed.
--
-- SCOPE IS DELIBERATE. This assertion takes ONE function body and ONE candidate
-- key. It never sweeps the repository or the design document, whose historical
-- text intentionally carries superseded regex examples that must remain
-- untouched.
CREATE OR REPLACE FUNCTION pg_temp.m191_assert_uuid_parser_parity(
  p_label text,
  p_src text,
  p_candidate_key text
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO pg_catalog, pg_temp
AS $$
DECLARE
  v_exec text;
  v_code text;
  v_valid integer;
  v_cast integer;
BEGIN
  v_exec := pg_temp.m191_exec_norm(p_label, p_src);
  -- The candidate key lives inside a quoted literal, so the ordering check
  -- below runs on comment-stripped code rather than masked text. Presence of
  -- the key is not the contract; the parser call is.
  v_code := pg_temp.m191_code_norm(p_src);

  IF position(p_candidate_key IN v_code) = 0 THEN
    RAISE EXCEPTION 'M191_ACCEPTANCE_FIX_E_CANDIDATE_KEY_MISSING: % key=%',
      p_label, p_candidate_key;
  END IF;

  -- 2) No hand-written canonical UUID regex may gate the candidate. These are
  --    the shapes a "tightening" refactor reaches for; each of them accepts
  --    strictly fewer spellings than the ::uuid cast the later loop performs,
  --    which is what turns a valid line into PRODUCT_NOT_PRELOCKED.
  --    v_code is lowercased, so [0-9a-fA-F] arrives as [0-9a-fa-f] and the one
  --    hex-class pattern covers both spellings.
  IF v_code ~ E'\\[0-9a-f'
     OR v_code ~ E'\\{8\\}-'
     OR v_code ~ E'\\{4\\}-'
     OR v_code ~ E'\\{12\\}' THEN
    RAISE EXCEPTION
      'M191_ACCEPTANCE_FIX_E_CANONICAL_UUID_REGEX_PRESENT: %', p_label;
  END IF;

  -- 3) The candidate gate must be PostgreSQL's own uuid validator, in
  --    executable position. A comment describing it does not gate a cast.
  v_valid := regexp_instr(
    v_exec,
    E'when +pg_input_is_valid *\\([^()]*, *''[ ]*''\\) +then'
  );
  IF v_valid = 0 THEN
    RAISE EXCEPTION 'M191_ACCEPTANCE_FIX_E_PG_INPUT_IS_VALID_MISSING: %', p_label;
  END IF;

  -- 4) …and it must gate a cast, not stand next to one. The masked view blanks
  --    the 'uuid' type-name literal inside pg_input_is_valid, so the cast that
  --    follows is what proves the branch is the candidate extraction site.
  v_cast := regexp_instr(v_exec, E'\\) *:: *uuid([^a-z0-9_]|$)', v_valid);
  IF v_cast = 0 THEN
    RAISE EXCEPTION 'M191_ACCEPTANCE_FIX_E_VALIDATED_CAST_MISSING: %', p_label;
  END IF;
END
$$;
