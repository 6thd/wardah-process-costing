# 🚀 Performance Optimization Scripts

## 📋 Overview
This directory contains SQL scripts to optimize database performance for Wardah ERP.

**Expected Overall Improvement:** 60-80% faster queries

---

## 📂 Files

### 1. `01_create_indexes.sql`
**Purpose:** Create database indexes for frequently queried columns

**Tables Affected:**
- `manufacturing_orders`
- `products` / `items`
- `gl_entries`
- `gl_entry_lines`
- `gl_accounts`
- `work_centers`
- `stage_costs`

**Expected Improvement:** 20-30% faster queries

**Execution Time:** ~30 seconds

---

### 2. `02_create_views.sql`
**Purpose:** Create materialized views for complex queries

**Views Created:**
- `v_manufacturing_orders_full` - Manufacturing orders with products and users
- `v_trial_balance` - Pre-calculated trial balance
- `v_manufacturing_orders_summary` - Dashboard statistics
- `v_gl_entries_full` - GL entries with journals
- `v_work_centers_utilization` - Work centers with usage stats

**Expected Improvement:** 50-70% faster queries

**Execution Time:** ~1 minute

---

## 🚀 Deployment Order

**IMPORTANT:** Execute scripts in this exact order:

```bash
# Step 1: Create Indexes (REQUIRED FIRST)
# Run in Supabase SQL Editor
sql/performance/01_create_indexes.sql

# Step 2: Create Views (AFTER INDEXES)
# Run in Supabase SQL Editor
sql/performance/02_create_views.sql
```

---

## ✅ Verification

After running the scripts, verify with these queries:

```sql
-- Check indexes
SELECT 
  tablename,
  indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname LIKE 'idx_%'
ORDER BY tablename;

-- Check views
SELECT 
  table_name,
  table_type
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name LIKE 'v_%'
ORDER BY table_name;

-- Test view performance
SELECT COUNT(*) FROM v_manufacturing_orders_full;
SELECT COUNT(*) FROM v_trial_balance;
```

---

## 📊 Expected Performance Improvements

### Before Optimization:
| Operation | Time | Status |
|---|---|---|
| Manufacturing Orders List | 900-1400ms | 🔴 Slow |
| Trial Balance | 1200ms | 🟡 Acceptable |
| Journal Entries | 750ms | 🟢 Good |

### After Optimization:
| Operation | Time | Status |
|---|---|---|
| Manufacturing Orders List | **300-500ms** | 🟢 **Fast** |
| Trial Balance | **400ms** | 🟢 **Fast** |
| Journal Entries | **300ms** | 🟢 **Very Fast** |

**Overall:** 60-70% improvement in query times

---

## 🔧 Frontend Changes Required

After running these scripts, update frontend code to use views:

### Manufacturing Orders:
```typescript
// Before:
supabase.from('manufacturing_orders').select('*')

// After:
supabase.from('v_manufacturing_orders_full').select('*')
```

### Trial Balance:
```typescript
// Before:
// Complex query with multiple joins

// After:
supabase.from('v_trial_balance')
  .select('*')
  .eq('org_id', orgId)
```

---

## ⚠️ Important Notes

1. **Indexes:** Safe to run multiple times (uses `IF NOT EXISTS`)
2. **Views:** Will be recreated if they already exist (uses `CREATE OR REPLACE`)
3. **Permissions:** Views are automatically granted to `authenticated` role
4. **RLS:** Views inherit RLS policies from base tables
5. **Performance:** First query after creating views might be slow (cache warming)

---

## 🐛 Troubleshooting

### Issue: "relation does not exist"
**Solution:** Ensure base tables exist before creating views

### Issue: "permission denied"
**Solution:** Run scripts as database owner or with sufficient privileges

### Issue: "column does not exist"
**Solution:** Check that all referenced columns exist in base tables

---

## 📈 Monitoring

After deployment, monitor performance with:

```javascript
// In browser console
PerformanceMonitor.getReport()
```

Expected results:
- Manufacturing Orders: < 500ms
- Trial Balance: < 400ms
- Journal Entries: < 300ms

---

## 🔄 Rollback

If needed, rollback with:

```sql
-- Drop views
DROP VIEW IF EXISTS v_manufacturing_orders_full CASCADE;
DROP VIEW IF EXISTS v_trial_balance CASCADE;
DROP VIEW IF EXISTS v_manufacturing_orders_summary CASCADE;
DROP VIEW IF EXISTS v_gl_entries_full CASCADE;
DROP VIEW IF EXISTS v_work_centers_utilization CASCADE;

-- Drop indexes (optional, usually not needed)
DROP INDEX IF EXISTS idx_mo_org_status;
DROP INDEX IF EXISTS idx_mo_dates;
-- ... (add other indexes as needed)
```

---

## 📝 Changelog

### 2025-01-19
- ✅ Created `01_create_indexes.sql`
- ✅ Created `02_create_views.sql`
- ✅ Initial performance optimization deployment

---

## 🎯 Next Steps

After deployment:

1. ✅ Run SQL scripts in Supabase
2. ✅ Update frontend to use views
3. ✅ Test performance with `PerformanceMonitor.getReport()`
4. ✅ Monitor for 24 hours
5. ✅ Fine-tune indexes if needed

---

**Questions?** Check the main project documentation or contact the development team.

