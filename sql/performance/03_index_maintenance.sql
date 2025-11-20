-- =============================================
-- Index Maintenance & Monitoring
-- صيانة ومراقبة الفهارس
-- =============================================
-- Run this quarterly (every 3 months)
-- =============================================

-- 1. Find Unused Indexes
-- =============================================

SELECT 
  schemaname,
  tablename,
  indexname,
  idx_scan as scans,
  pg_size_pretty(pg_relation_size(indexrelid)) as size,
  CASE 
    WHEN idx_scan = 0 THEN '🔴 UNUSED - Consider dropping'
    WHEN idx_scan < 10 THEN '🟡 RARELY USED - Monitor'
    ELSE '🟢 ACTIVE'
  END as status
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
  AND indexname LIKE 'idx_%'
ORDER BY idx_scan ASC, pg_relation_size(indexrelid) DESC
LIMIT 50;

-- 2. Index Size Report
-- =============================================

SELECT 
  schemaname,
  tablename,
  COUNT(*) as index_count,
  pg_size_pretty(SUM(pg_relation_size(indexrelid))) as total_size
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
  AND indexname LIKE 'idx_%'
GROUP BY schemaname, tablename
ORDER BY SUM(pg_relation_size(indexrelid)) DESC;

-- 3. Most Scanned Indexes (Top Performers)
-- =============================================

SELECT 
  schemaname,
  tablename,
  indexname,
  idx_scan as scans,
  idx_tup_read as tuples_read,
  idx_tup_fetch as tuples_fetched,
  pg_size_pretty(pg_relation_size(indexrelid)) as size
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
  AND indexname LIKE 'idx_%'
  AND idx_scan > 0
ORDER BY idx_scan DESC
LIMIT 20;

-- 4. Bloated Indexes (Need Reindex)
-- =============================================

SELECT 
  schemaname,
  tablename,
  indexname,
  pg_size_pretty(pg_relation_size(indexrelid)) as current_size,
  CASE 
    WHEN pg_relation_size(indexrelid) > 100000000 THEN '🔴 Consider REINDEX'
    WHEN pg_relation_size(indexrelid) > 50000000 THEN '🟡 Monitor'
    ELSE '🟢 OK'
  END as status
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
  AND indexname LIKE 'idx_%'
ORDER BY pg_relation_size(indexrelid) DESC
LIMIT 20;

-- 5. Duplicate Indexes Detection
-- =============================================

SELECT 
  a.tablename,
  a.indexname as index1,
  b.indexname as index2,
  a.indexdef
FROM pg_indexes a
JOIN pg_indexes b 
  ON a.tablename = b.tablename 
  AND a.indexname < b.indexname
  AND a.indexdef = b.indexdef
WHERE a.schemaname = 'public'
  AND a.indexname LIKE 'idx_%';

-- 6. Cache Hit Ratio (Should be > 95%)
-- =============================================

SELECT 
  'Index Cache Hit Rate' as metric,
  ROUND(
    (sum(idx_blks_hit) / NULLIF(sum(idx_blks_hit + idx_blks_read), 0) * 100)::numeric, 
    2
  ) as percentage,
  CASE 
    WHEN sum(idx_blks_hit) / NULLIF(sum(idx_blks_hit + idx_blks_read), 0) > 0.95 THEN '🟢 Excellent'
    WHEN sum(idx_blks_hit) / NULLIF(sum(idx_blks_hit + idx_blks_read), 0) > 0.90 THEN '🟡 Good'
    ELSE '🔴 Needs Improvement'
  END as status
FROM pg_statio_user_indexes;

-- 7. Recommended Actions
-- =============================================

DO $$ 
DECLARE
  unused_count INT;
  large_count INT;
BEGIN
  -- Count unused indexes
  SELECT COUNT(*) INTO unused_count
  FROM pg_stat_user_indexes
  WHERE schemaname = 'public'
    AND indexname LIKE 'idx_%'
    AND idx_scan = 0;
  
  -- Count large indexes
  SELECT COUNT(*) INTO large_count
  FROM pg_stat_user_indexes
  WHERE schemaname = 'public'
    AND indexname LIKE 'idx_%'
    AND pg_relation_size(indexrelid) > 100000000;
  
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'INDEX MAINTENANCE SUMMARY';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Unused Indexes: %', unused_count;
  RAISE NOTICE 'Large Indexes (>100MB): %', large_count;
  RAISE NOTICE '';
  
  IF unused_count > 0 THEN
    RAISE NOTICE '⚠️  Action: Review unused indexes above';
  END IF;
  
  IF large_count > 0 THEN
    RAISE NOTICE '⚠️  Action: Consider REINDEX for large indexes';
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE '✅ Run this script quarterly for best performance';
  RAISE NOTICE '';
END $$;

-- =============================================
-- How to Drop Unused Index (CAREFULLY!)
-- =============================================

-- STEP 1: Verify it's truly unused
-- SELECT * FROM pg_stat_user_indexes WHERE indexname = 'idx_name_here';

-- STEP 2: Drop it (ONLY if idx_scan = 0 for 3+ months)
-- DROP INDEX IF EXISTS idx_name_here;

-- STEP 3: Monitor for 1 week to ensure no issues

-- =============================================
-- How to Reindex (for bloated indexes)
-- =============================================

-- REINDEX INDEX CONCURRENTLY idx_name_here;
-- (CONCURRENTLY = no downtime)

