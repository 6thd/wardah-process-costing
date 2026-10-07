-- R1: ledger rows, raw (every column as stored EXCEPT created_by, which is never published)
SELECT (to_jsonb(m) - 'created_by') AS ledger_row_raw   -- created_by deliberately omitted
  FROM supabase_migrations.schema_migrations m
 WHERE m.name LIKE 'o1\_probe\_%' ESCAPE '\'
 ORDER BY m.version;
-- R2: ledger duplicates per name (must be 0 or 1 per probe)
SELECT name, count(*) AS rows
  FROM supabase_migrations.schema_migrations
 WHERE name LIKE 'o1\_probe\_%' ESCAPE '\'
 GROUP BY name ORDER BY name;
-- R3: catalog presence per probe object (t/f), owners, and the identity table, raw
SELECT t.obj,
       to_regclass('o1_probe.' || t.obj) IS NOT NULL AS exists_now,
       (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = to_regclass('o1_probe.' || t.obj)) AS owner
  FROM (VALUES ('identity'), ('fail_after_commit_a'), ('fail_before_commit_b'),
               ('plain_fail_c'), ('commit_ok_d')) AS t(obj)
 ORDER BY t.obj;
SELECT probe, value FROM o1_probe.identity ORDER BY probe;   -- only after P1 succeeded
-- Byte comparison (assistant side, after R1): the raw `statements` text from R1 is compared
-- as an exact string and by sha256 with the file in o1_sent_bytes_manifest.txt; both are
-- reported, including any normalisation the endpoint applied (split on ';', trimmed
-- whitespace, BEGIN/COMMIT retained or dropped).
