# Phase 1 Execution Guide - خطوة بخطوة 🚀

## 📋 Pre-Execution Checklist

### ✅ **قبل البدء - تأكد من:**

- [ ] **Backup قاعدة البيانات** (مهم جداً!)
- [ ] **Review البيانات الموجودة** في `stage_costs`
- [ ] **Test على staging/copy** (إن أمكن)
- [ ] **Plan maintenance window** (إذا كان migration كبير)
- [ ] **Inform team/users** عن التغييرات

---

## 🔍 Step 1: Pre-Migration Checks

### **Run Safety Checks:**

```sql
-- في Supabase SQL Editor:
-- Run: sql/migrations/14_backup_checklist.sql

-- هذا سيعطيك:
-- ✅ Data integrity report
-- ✅ Foreign key checks
-- ✅ Migration estimate
-- ✅ Backup recommendations
```

**Expected Output:**
```
✅ All data integrity checks passed!
✅ All stage_costs have valid manufacturing_orders
✅ Found X organization(s)
Migration Estimate:
  - Manufacturing stages to create: X
  - WIP log entries to create: X
```

---

## 💾 Step 2: Backup Database

### **Option 1: Supabase Dashboard**
1. Go to **Settings** → **Database** → **Backups**
2. Click **Create Backup**
3. Name it: `backup_before_phase1_YYYYMMDD`

### **Option 2: Command Line**
```bash
# Using Supabase CLI
supabase db dump -f backup_before_phase1_$(date +%Y%m%d).sql

# Or using pg_dump
pg_dump -h your-host -U postgres -d wardah > backup_before_phase1.sql
```

### **Option 3: SQL Export**
```sql
-- Export critical tables
COPY (SELECT * FROM stage_costs) TO '/path/to/backup/stage_costs.csv' CSV HEADER;
COPY (SELECT * FROM manufacturing_orders) TO '/path/to/backup/manufacturing_orders.csv' CSV HEADER;
```

---

## 🏗️ Step 3: Create New Tables

### **Execute Schema Migration:**

```sql
-- في Supabase SQL Editor:
-- Copy & paste محتوى: sql/migrations/15_process_costing_enhancement.sql
-- ثم Run
```

### **Verify Tables Created:**

```sql
-- Check tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('manufacturing_stages', 'stage_wip_log', 'standard_costs');

-- Expected: 3 rows
```

### **Verify Triggers Created:**

```sql
-- Check trigger exists
SELECT trigger_name, event_object_table
FROM information_schema.triggers
WHERE trigger_name = 'trigger_calculate_wip_eu';

-- Expected: 1 row
```

### **Verify RLS Enabled:**

```sql
-- Check RLS policies
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN ('manufacturing_stages', 'stage_wip_log', 'standard_costs');

-- Expected: rowsecurity = true for all 3
```

---

## 🔄 Step 4: Migrate Data

### **Execute Data Migration:**

```sql
-- في Supabase SQL Editor:
-- Copy & paste محتوى: sql/migrations/16_migrate_stage_costs_to_wip_log.sql
-- ثم Run
```

### **Watch for Verification Messages:**

```
✅ Created manufacturing stage: STG-001 for org ...
✅ Created manufacturing stage: STG-002 for org ...
...
Migrated 100 records...
Migration complete! Total records migrated: X

========================================
MIGRATION VERIFICATION
========================================
Total stage_costs records: X
Migrated records: X
stage_wip_log records: X
manufacturing_stages created: X
========================================
✅ All records migrated successfully!
```

---

## ✅ Step 5: Verify Migration

### **5.1 Check Manufacturing Stages:**

```sql
-- Verify stages created
SELECT 
    code,
    name,
    order_sequence,
    work_center_id,
    wip_gl_account_id,
    is_active
FROM manufacturing_stages
ORDER BY order_sequence;

-- Expected: One row per distinct stage_no from stage_costs
```

### **5.2 Check WIP Log:**

```sql
-- Verify WIP logs created
SELECT 
    COUNT(*) as total_records,
    COUNT(DISTINCT mo_id) as unique_mos,
    COUNT(DISTINCT stage_id) as unique_stages,
    MIN(period_start) as earliest_period,
    MAX(period_end) as latest_period
FROM stage_wip_log;

-- Expected: Should match migrated count
```

### **5.3 Check Data Integrity:**

```sql
-- Compare counts
SELECT 
    'stage_costs' as source,
    COUNT(*) as count,
    COUNT(*) FILTER (WHERE migrated_to_wip_log = true) as migrated
FROM stage_costs
UNION ALL
SELECT 
    'stage_wip_log',
    COUNT(*),
    COUNT(*)
FROM stage_wip_log;

-- Expected: migrated count should match stage_wip_log count
```

### **5.4 Test Backward Compatibility View:**

```sql
-- Test legacy view
SELECT 
    id,
    mo_id,
    stage_no,
    total_cost,
    period_start,
    period_end,
    migrated_to_wip_log
FROM stage_costs_legacy
LIMIT 10;

-- Expected: Should return data with new fields
```

---

## 🧪 Step 6: Test Services

### **6.1 Test in Browser Console:**

```typescript
// Open browser console (F12)
// Import services
import { 
  manufacturingStagesService, 
  stageWipLogService, 
  standardCostsService 
} from '@/services/supabase-service'

// Test 1: Get all stages
const stages = await manufacturingStagesService.getAll()
console.log('Stages:', stages)
// Expected: Array of manufacturing stages

// Test 2: Get WIP logs
const wipLogs = await stageWipLogService.getAll()
console.log('WIP Logs:', wipLogs)
// Expected: Array of WIP log entries

// Test 3: Get standard costs
const stdCosts = await standardCostsService.getAll()
console.log('Standard Costs:', stdCosts)
// Expected: Array (might be empty initially)
```

### **6.2 Test with Filters:**

```typescript
// Test WIP log with filters
const moWipLogs = await stageWipLogService.getAll({ 
  moId: 'your-mo-id-here',
  isClosed: false 
})
console.log('MO WIP Logs:', moWipLogs)

// Test standard costs for product
const productStdCosts = await standardCostsService.getAll({
  productId: 'your-product-id',
  isActive: true
})
console.log('Product Standard Costs:', productStdCosts)
```

---

## 🐛 Troubleshooting

### **Issue 1: Foreign Key Constraint Error**

**Error:**
```
ERROR: insert or update on table "manufacturing_stages" violates foreign key constraint
```

**Solution:**
```sql
-- Check if organizations exist
SELECT COUNT(*) FROM organizations;

-- If 0, create default organization first:
INSERT INTO organizations (id, name, code)
VALUES ('00000000-0000-0000-0000-000000000001', 'Default Org', 'DEFAULT')
ON CONFLICT DO NOTHING;
```

---

### **Issue 2: NULL Values in Migration**

**Error:**
```
WARNING: Found X records with NULL mo_id
```

**Solution:**
```sql
-- Fix NULL values before migration
UPDATE stage_costs 
SET stage_no = 1 
WHERE stage_no IS NULL;

-- Or exclude from migration:
DELETE FROM stage_costs WHERE mo_id IS NULL OR stage_no IS NULL;
```

---

### **Issue 3: Service Import Errors**

**Error:**
```
Module not found: '@/services/supabase-service'
```

**Solution:**
```typescript
// Check import path
// Should be: import { ... } from '@/services/supabase-service'
// Or: import { ... } from '../services/supabase-service'

// Verify file exists:
// src/services/supabase-service.ts
```

---

### **Issue 4: TypeScript Type Errors**

**Error:**
```
Property 'manufacturingStagesService' does not exist
```

**Solution:**
```typescript
// Add types to src/types/index.ts or create new file:

export interface ManufacturingStage {
  id: string
  org_id: string
  code: string
  name: string
  order_sequence: number
  work_center_id?: string
  wip_gl_account_id?: string
  // ... rest of fields
}

export interface StageWipLog {
  id: string
  org_id: string
  mo_id: string
  stage_id: string
  period_start: string
  period_end: string
  // ... rest of fields
}
```

---

## 🔙 Rollback (If Needed)

### **If Something Goes Wrong:**

```sql
-- Run rollback script (uncomment steps in file first):
-- sql/migrations/17_rollback_phase1.sql

-- Or manually:
DROP VIEW IF EXISTS public.stage_costs_legacy;
ALTER TABLE public.stage_costs DROP COLUMN IF EXISTS migrated_to_wip_log;
DROP TABLE IF EXISTS public.stage_wip_log CASCADE;
DROP TABLE IF EXISTS public.standard_costs CASCADE;
DROP TABLE IF EXISTS public.manufacturing_stages CASCADE;
```

### **Restore from Backup:**

```bash
# Using Supabase CLI
supabase db restore backup_before_phase1_YYYYMMDD.sql

# Or using psql
psql -h your-host -U postgres -d wardah < backup_before_phase1.sql
```

---

## ✅ Success Criteria

### **Phase 1 is Complete When:**

- [x] All 3 tables created successfully
- [x] Data migrated without errors
- [x] Verification queries pass
- [x] Services work correctly
- [x] Backward compatibility view works
- [x] No data loss
- [x] All tests pass

---

## 🎯 Next Steps After Phase 1

Once Phase 1 is verified:

1. **Update UI Components** to use new services
2. **Test User Workflows** with new structure
3. **Plan Phase 2** (Core Logic Implementation)
4. **Document Any Issues** found during testing

---

## ❓ Common Questions

### **Q: How long will migration take?**
**A:** Depends on data size:
- **< 1,000 records:** ~1-2 minutes
- **1,000 - 10,000 records:** ~5-10 minutes
- **10,000 - 100,000 records:** ~30-60 minutes
- **> 100,000 records:** 1-2 hours (schedule maintenance window)

### **Q: Can I run this during business hours?**
**A:** 
- **< 10,000 records:** Yes, minimal impact
- **10,000 - 50,000 records:** Low traffic hours recommended
- **> 50,000 records:** Schedule maintenance window

### **Q: What if migration fails halfway?**
**A:** PostgreSQL transactions ensure atomicity:
- Migration either **completes fully** or **rolls back completely**
- No partial data states
- Original `stage_costs` data remains intact

### **Q: Can I pause and resume migration?**
**A:** No, migration is atomic. Options:
- Let it complete (recommended)
- Cancel and rollback (if critical issue)
- Fix issue and re-run

### **Q: Will users be affected during migration?**
**A:** 
- **Schema creation (15):** Brief lock (~5-10 seconds)
- **Data migration (16):** Read operations continue, writes may be slower
- **Recommendation:** Run during low-traffic period

### **Q: How do I verify migration succeeded?**
**A:** Check:
1. Verification messages in migration output
2. Run verification queries in Step 5
3. Test services in Step 6
4. Check `migrated_to_wip_log` flag in `stage_costs`

### **Q: What if I need to rollback?**
**A:** 
1. Review `17_rollback_phase1.sql`
2. Uncomment rollback steps
3. Execute carefully
4. Verify original data restored

### **Q: Can I run migration multiple times?**
**A:** 
- **First run:** Safe, creates new tables
- **Subsequent runs:** May cause conflicts
- **Recommendation:** Drop new tables first if re-running

---

## 📞 Support

If you encounter issues:

1. Check **Troubleshooting** section above
2. Review **verification queries** output
3. Check **Supabase logs** for detailed errors
4. Review **migration script** comments
5. Check **Common Questions** section above

---

## 📊 Performance Expectations

### **Migration Performance:**

| Records | Expected Time | Lock Duration | User Impact |
|---------|---------------|---------------|-------------|
| < 1K | 1-2 min | < 5 sec | Minimal |
| 1K-10K | 5-10 min | < 10 sec | Low |
| 10K-50K | 15-30 min | < 15 sec | Medium |
| 50K-100K | 30-60 min | < 20 sec | High |
| > 100K | 1-2 hours | < 30 sec | Very High |

### **Post-Migration Performance:**

- **Query Performance:** Similar or better (new indexes)
- **Storage:** ~30% increase (new tables)
- **Service Calls:** No significant change

---

**تاريخ الإنشاء:** 2025-01-20  
**آخر تحديث:** 2025-01-20  
**الحالة:** ✅ Ready for Execution

