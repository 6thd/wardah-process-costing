-- تشخيص الخطوط لقيد محدد
-- عدّل entry_id بحسب الكود الذي تواجهه

WITH entry AS (
  SELECT id, entry_number, total_debit, total_credit
  FROM gl_entries
  WHERE id = 'e6300076-203c-4efc-a315-558e45268d8a'
)
SELECT
  'gl_entry_lines' AS source,
  gel.*
FROM gl_entry_lines gel
JOIN entry e ON e.id = gel.entry_id
UNION ALL
SELECT
  'journal_lines' AS source,
  jl.*
FROM journal_lines jl
JOIN entry e ON e.id = jl.entry_id;

