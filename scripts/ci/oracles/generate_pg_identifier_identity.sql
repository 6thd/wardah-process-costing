-- Derive the PostgreSQL identifier-identity oracle from a live server.
--
-- Every security decision in scripts/ci/check_definer_guards.py eventually
-- compares two identifiers: is this EXIT's target the label on the block the
-- guard sits in, does this REVOKE name the function just defined, is this the
-- same overload, is this grantee `authenticated`. Four consecutive independent
-- review rounds each found a case where the scanner's answer differed from
-- PostgreSQL's. A table of expected values written by hand would encode the
-- same assumptions that were wrong, so the expectations are asked of the
-- server instead.
--
--   parse_ident(x)[1]   applies downcase_identifier() - ASCII A-Z only in a
--                       multibyte encoding - and unwraps a quoted identifier,
--                       but does NOT truncate.
--   ::name              applies truncate_identifier(): NAMEDATALEN-1 = 63
--                       bytes, on a character boundary.
--
-- Together, in that order, they are exactly what the parser does to a bare
-- identifier - and the order matters, because folding can change the byte
-- length and therefore where the clip falls.
--
-- Regenerate against PostgreSQL 17 (a throwaway cluster is fine):
--
--   psql -Atq -f scripts/ci/oracles/generate_pg_identifier_identity.sql \
--     > scripts/ci/oracles/pg_identifier_identity.json
--
-- The committed JSON is consumed by scripts/ci/test_check_definer_guards.py,
-- which fails if the scanner's canonicalizer disagrees with any row.

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF current_setting('server_encoding') <> 'UTF8' THEN
    RAISE EXCEPTION 'oracle must be generated on a UTF8 database, got %',
      current_setting('server_encoding');
  END IF;
END
$$;

WITH corpus(text) AS (
  VALUES
    -- plain ASCII, and folding
    ('rpc_probe'), ('RPC_PROBE'), ('Rpc_Probe'), ('_leading'),
    ('with$dollar'), ('a1b2'),
    -- BMP non-ASCII: PostgreSQL does NOT downcase these in a UTF-8 database
    (chr(1581)||chr(1575)||chr(1585)||chr(1587)),        -- حارس
    ('rpc_b'||chr(196)||'d'), ('rpc_b'||chr(228)||'d'),  -- Ä / ä
    ('RPC_B'||chr(196)||'D'),
    ('Type'||chr(196)), ('Type'||chr(228)),
    -- length-changing Python lowercase - str.lower() shortens these, PostgreSQL
    -- does not touch them at all
    (chr(8490)),                                          -- U+212A KELVIN SIGN
    (chr(8490)||repeat('a',60)||'X'),
    (chr(8490)||repeat('a',60)||'Y'),
    (chr(8491)), (chr(8486)), (chr(7838)), (chr(304)),    -- Å Ω ẞ İ
    -- astral plane: identifier characters above U+FFFF
    ('auth'||chr(119808)), (chr(119808)||'auth'),
    ('auth'||chr(128512)), ('rpc_'||chr(119808)),
    -- exactly at, and across, the byte limit
    (repeat('a',62)), (repeat('a',63)), (repeat('a',64)), (repeat('a',200)),
    ('rpc_'||repeat('a',60)||'X'), ('rpc_'||repeat('a',60)||'Y'),
    -- crossing the limit by a 2-, 3- and 4-byte code point
    (repeat('a',62)||chr(1605)), (repeat('a',61)||chr(1605)),
    (repeat('a',60)||chr(1605)),
    (repeat('a',62)||chr(3585)), (repeat('a',61)||chr(3585)),
    (repeat('a',60)||chr(3585)),
    (repeat('a',62)||chr(119808)), (repeat('a',61)||chr(119808)),
    (repeat('a',60)||chr(119808)),
    (repeat(chr(1605),32)), (repeat(chr(1605),31)), (repeat(chr(119808),16)),
    -- mixed scripts
    ('rpc_'||chr(1605)||'ix'||chr(196)),
    (repeat('A',30)||repeat(chr(1605),20))
)
SELECT jsonb_pretty(jsonb_build_object(
  'server_version', version(),
  'server_encoding', current_setting('server_encoding'),
  'namedatalen_limit', 63,
  'note', 'Generated from a live PostgreSQL server by '
       || 'scripts/ci/oracles/generate_pg_identifier_identity.sql. '
       || '"unquoted" is the identifier as the parser resolves it '
       || '(downcase_identifier then truncate_identifier); "quoted" is the '
       || 'same with folding suppressed. Do not edit by hand - regenerate.',
  'rows', jsonb_agg(jsonb_build_object(
            'text', text,
            -- fold (ASCII only) then clip
            'unquoted', ((parse_ident(text))[1])::name,
            -- no folding; the clip still applies
            'quoted', text::name
          ) ORDER BY ordinality)
))
FROM corpus, LATERAL (SELECT row_number() OVER () AS ordinality) o;
