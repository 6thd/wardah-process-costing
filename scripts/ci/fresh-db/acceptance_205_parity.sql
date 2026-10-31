-- Parity of the 205 SQL functions with the reference calculator r4c, on a fresh database through 205.
--
-- The cases are every call the calculator controls X1-X19 make to validate_205_version, compute_205 and
-- approve_205_check, with the calculator's own outcome (gen_205_parity_cases.py; nothing typed by hand).
-- Each case runs through the SQL counterpart and must give the same result (jsonb equality, cents) or the
-- same refusal. A refusal matches when the messages are equal, or when the calculator's message is the SQL
-- message followed by ": <the value's Python repr>" for the codes number_205 raises with the value
-- attached (the SQL message carries no repr).
--   psql -f acceptance_205_parity.sql < <cases.jsonl>   (the cases are read from psql's standard input)
\set ON_ERROR_STOP on

BEGIN;
CREATE TEMP TABLE parity_cases (j jsonb NOT NULL);
\copy parity_cases (j) FROM pstdin WITH (FORMAT csv, QUOTE E'\x01', DELIMITER E'\x02')

DO $parity$
DECLARE
  c record;
  a jsonb;
  v_got jsonb;
  v_err text;
  v_exp jsonb;
  v_ok boolean;
  n int := 0;
  n_ok int := 0;
  n_err int := 0;
  v_bad text[] := '{}';
BEGIN
  FOR c IN SELECT j FROM parity_cases ORDER BY (j->>'id')::int LOOP
    n := n + 1;
    a := c.j->'args';
    v_got := NULL;
    v_err := NULL;
    BEGIN
      CASE c.j->>'fn'
        WHEN 'validate_205_version' THEN
          PERFORM wardah_internal.mfg_cost_policy_validate_205(a->'v');
          v_got := 'null'::jsonb;
        WHEN 'approve_205_check' THEN
          v_got := wardah_internal.mfg_cost_policy_approve_check_205(a->'v', a->>'policy');
        WHEN 'compute_205' THEN
          v_got := wardah_internal.mfg_cost_policy_compute_205_v(a->'v', a->>'wc', a->'hours', a->'recorded', a->'legacy');
        ELSE
          RAISE EXCEPTION 'PARITY_205_UNKNOWN_FN: %', c.j->>'fn';
      END CASE;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE 'PARITY_205_UNKNOWN_FN%' THEN RAISE; END IF;
      v_err := SQLERRM;
    END;
    v_exp := c.j->'expect';
    IF v_exp ? 'error' THEN
      n_err := n_err + 1;
      v_ok := v_err IS NOT NULL AND (v_err = v_exp->>'error'
        OR (starts_with(v_exp->>'error', v_err || ': ')
            AND v_err ~ '^COST_POLICY_(RATE_INVALID|RECORDED_COST_INVALID|UNALLOCATED_POLICY_INVALID|HOURS_INVALID: (labor|machine)\.(run|setup)|UNALLOCATED_EXCEPTION_INVALID: amount [A-Z0-9_]+)$'));
    ELSE
      n_ok := n_ok + 1;
      v_ok := v_err IS NULL AND v_got = v_exp->'ok';
    END IF;
    IF NOT v_ok THEN
      v_bad := v_bad || format('#%s %s expected %s got %s', c.j->>'id', c.j->>'fn', v_exp, COALESCE(v_err, v_got::text));
    END IF;
  END LOOP;
  IF n = 0 THEN
    RAISE EXCEPTION 'PARITY_205_NO_CASES';
  END IF;
  IF cardinality(v_bad) > 0 THEN
    RAISE EXCEPTION 'PARITY_205_MISMATCH % of %: %', cardinality(v_bad), n, array_to_string(v_bad[1:10], ' | ');
  END IF;
  RAISE NOTICE 'PARITY_205_PASS cases=% results=% refusals=%', n, n_ok, n_err;
END
$parity$;
ROLLBACK;
