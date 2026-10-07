SELECT t.obj, to_regclass('o1_probe.' || t.obj) IS NOT NULL AS exists_now
  FROM (VALUES ('e1_after_own_commit'), ('e2_plain')) AS t(obj) ORDER BY t.obj;
