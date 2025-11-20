# 📋 Weekly Performance Checklist
**قائمة المراجعة الأسبوعية للأداء**

> Run this every **Monday morning** to ensure optimal performance
> نفذ هذا كل **صباح اثنين** لضمان الأداء الأمثل

---

## ✅ Week of: _____________

### 1. Browser Console Check (5 minutes)

**Steps:**
```bash
1. Open application
2. Open DevTools Console (F12)
3. Navigate to each critical page:
   - Manufacturing Orders
   - Journal Entries
   - Trial Balance
4. Run: PerformanceMonitor.getReport()
```

**Expected Results:**
```javascript
{
  "Manufacturing Orders List": { avg: "< 500ms" },
  "Journal Entries List": { avg: "< 600ms" },
  "Trial Balance Service Get": { avg: "< 600ms" }
}
```

**Action if Slow:**
- [ ] Check database status
- [ ] Check network latency
- [ ] Review recent code changes
- [ ] Run index maintenance script

---

### 2. Database Index Health (10 minutes)

**Run SQL Script:**
```sql
-- In Supabase SQL Editor:
-- sql/performance/03_index_maintenance.sql
```

**Check for:**
- [ ] Unused indexes (idx_scan = 0)
- [ ] Bloated indexes (> 100MB)
- [ ] Cache hit ratio (should be > 95%)

**Action Items:**
```sql
-- If unused indexes found:
-- 1. Document why they're unused
-- 2. If unused for 3+ months, consider dropping
-- 3. Update documentation

-- If cache hit ratio < 95%:
-- 1. Check database memory settings
-- 2. Consider increasing shared_buffers
-- 3. Contact Supabase support if needed
```

---

### 3. View Accessibility (5 minutes)

**Test Views:**
```sql
-- In Supabase SQL Editor:

-- Test 1: Trial Balance View
SELECT COUNT(*) FROM v_trial_balance;
-- Expected: > 0 rows

-- Test 2: Manufacturing Orders View
SELECT COUNT(*) FROM v_manufacturing_orders_full;
-- Expected: > 0 rows

-- Test 3: GL Entries View
SELECT COUNT(*) FROM v_gl_entries_full;
-- Expected: > 0 rows
```

**Action if Failed:**
- [ ] Check view definition
- [ ] Check RLS policies
- [ ] Recreate view if needed

---

### 4. Cache Performance (5 minutes)

**In Browser Console:**
```javascript
// 1. First load (cold cache)
performance.mark('start');
// Navigate to Manufacturing Orders
performance.mark('end');
performance.measure('cold-load', 'start', 'end');

// 2. Second load (warm cache)
// Refresh page
performance.mark('start2');
// Page should load
performance.mark('end2');
performance.measure('warm-load', 'start2', 'end2');

// 3. Compare
performance.getEntriesByType('measure');
```

**Expected:**
- Cold load: < 1000ms
- Warm load: < 200ms (90% faster!)

**Action if Slow:**
- [ ] Check React Query cache settings
- [ ] Check browser cache
- [ ] Check service worker

---

### 5. User Feedback Review (5 minutes)

**Check for:**
- [ ] User complaints about speed
- [ ] Error logs in Sentry/LogRocket
- [ ] Slow query logs in Supabase

**Questions to Ask:**
1. Are users reporting slow pages?
2. Which pages are slowest?
3. What time of day is slowest?
4. Are there any error spikes?

---

### 6. Regression Tests (Optional, 10 minutes)

**Run Performance Tests:**
```bash
npm test -- baseline.test.ts
```

**Expected:**
- All tests pass ✅
- No warnings ⚠️

**Action if Failed:**
- [ ] Investigate which test failed
- [ ] Check recent code changes
- [ ] Review database changes
- [ ] Run index maintenance

---

## 📊 Weekly Report Template

```markdown
### Performance Report - Week of [DATE]

#### Summary:
- [ ] All pages loading < 600ms ✅
- [ ] No unused indexes found ✅
- [ ] Cache hit ratio > 95% ✅
- [ ] No user complaints ✅

#### Metrics:
| Page | This Week | Last Week | Change |
|------|-----------|-----------|--------|
| Manufacturing Orders | XXXms | XXXms | ±X% |
| Journal Entries | XXXms | XXXms | ±X% |
| Trial Balance | XXXms | XXXms | ±X% |

#### Action Items:
1. [Action 1]
2. [Action 2]
3. [Action 3]

#### Notes:
- [Any observations]
- [Any concerns]
- [Any improvements]
```

---

## 🚨 Alert Thresholds

**Trigger Investigation if:**

| Metric | Threshold | Action |
|--------|-----------|--------|
| Page Load | > 1000ms | 🔴 Urgent - Investigate immediately |
| Cache Hit Ratio | < 90% | 🟡 Warning - Check database settings |
| Unused Indexes | > 10 | 🟡 Warning - Review and clean up |
| Error Rate | > 1% | 🔴 Urgent - Check logs |

---

## 📞 Escalation Path

**If Performance Degrades:**

1. **First 30 minutes:**
   - Check Supabase status page
   - Check recent deployments
   - Check database logs

2. **After 30 minutes:**
   - Run index maintenance script
   - Clear all caches
   - Restart application

3. **After 1 hour:**
   - Contact Supabase support
   - Review database plan (need upgrade?)
   - Consider temporary optimizations

4. **After 2 hours:**
   - Escalate to senior engineer
   - Consider rollback to previous version
   - Communicate with users

---

## 📈 Long-Term Trends

**Track Monthly:**

```markdown
### Monthly Performance Trends

| Month | Avg Load Time | Users | Data Size | Notes |
|-------|---------------|-------|-----------|-------|
| Jan 2025 | 450ms | 50 | 10GB | Baseline |
| Feb 2025 | XXXms | XX | XXGB | [Notes] |
| Mar 2025 | XXXms | XX | XXGB | [Notes] |
```

**Questions to Answer:**
1. Is performance degrading over time?
2. Is data growth affecting performance?
3. Are more users affecting performance?
4. Do we need to scale up?

---

## ✅ Checklist Complete!

**Sign-off:**
- Date: _______________
- Checked by: _______________
- Status: ✅ All Good / ⚠️ Issues Found / 🔴 Urgent Action Needed
- Next check: _______________

**Notes:**
_____________________________________
_____________________________________
_____________________________________

---

## 🎯 Success Criteria

**Green Status (All Good):**
- ✅ All pages < 600ms
- ✅ Cache hit ratio > 95%
- ✅ No unused indexes
- ✅ No user complaints
- ✅ All tests passing

**Yellow Status (Monitor):**
- ⚠️ Some pages 600-1000ms
- ⚠️ Cache hit ratio 90-95%
- ⚠️ 1-5 unused indexes
- ⚠️ Minor user feedback

**Red Status (Action Required):**
- 🔴 Any page > 1000ms
- 🔴 Cache hit ratio < 90%
- 🔴 > 5 unused indexes
- 🔴 Multiple user complaints
- 🔴 Tests failing

---

**Remember:** Consistent monitoring prevents performance regression! 🚀

