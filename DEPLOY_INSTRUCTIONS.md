# 🚀 Wardah ERP - Deployment Instructions
# تعليمات النشر السريع

---

## ⚠️ IMPORTANT: Execute in Order
**يجب التنفيذ بالترتيب المحدد**

---

## Step 1: Deploy Critical Schema Fixes
### الخطوة 1: نشر إصلاحات قاعدة البيانات الحرجة

### A. In Supabase SQL Editor:

1. Navigate to: https://uutfztmqvajmsxnrqeiv.supabase.co/project/_/sql
2. Copy contents of: `sql/00_critical_schema_fixes.sql`
3. Paste and execute
4. Verify completion message appears

**Expected Result:**
```
✅ Critical Schema Fixes Applied Successfully
✅ تم تطبيق الإصلاحات الحرجة بنجاح
```

### B. Verify Changes:

Run this query to verify:

```sql
-- Check if items table exists
SELECT COUNT(*) as items_count FROM items;

-- Check gl_accounts has new columns
SELECT column_name 
FROM information_schema.columns 
WHERE table_name = 'gl_accounts' 
AND column_name IN ('name_ar', 'name_en', 'subtype', 'org_id');

-- Check org_id in critical tables
SELECT table_name 
FROM information_schema.columns 
WHERE column_name = 'org_id' 
GROUP BY table_name 
ORDER BY table_name;
```

**Expected:** 
- items table has data (if products existed)
- gl_accounts has 4 new columns
- 20+ tables have org_id column

---

## Step 2: Restart Frontend Application
### الخطوة 2: إعادة تشغيل التطبيق

```bash
# Stop current dev server (Ctrl+C)
# Then restart
npm run dev
```

---

## Step 3: Test Critical Fixes
### الخطوة 3: اختبار الإصلاحات

### A. Test Payment Vouchers:
1. Navigate to: Sales → Collections → Customer Receipts
2. Click "New Receipt"
3. Check "Payment Account" dropdown
4. **Expected:** Accounts appear without errors

### B. Test Dashboard:
1. Navigate to: Dashboard
2. Check for any console errors
3. **Expected:** No "items 404" errors

### C. Test Chart of Accounts:
1. Navigate to: Accounting → Chart of Accounts
2. Verify accounts load properly
3. **Expected:** All accounts visible with Arabic/English names

---

## Step 4: Test New CRUD Functions
### الخطوة 4: اختبار دوال CRUD الجديدة

### Test in Browser Console:

```javascript
// Import functions
const { createGLAccount, updateGLAccount, deleteGLAccount } = await import('./src/lib/supabase.ts');

// Test create
const result = await createGLAccount({
    code: '5999',
    name: 'Test Expense Account',
    name_ar: 'حساب مصروف تجريبي',
    account_type: 'EXPENSE',
    description: 'Test account - can be deleted'
});
console.log('Create result:', result);

// Test update
if (result.success && result.data) {
    const updateResult = await updateGLAccount({
        id: result.data.id,
        description: 'Updated description'
    });
    console.log('Update result:', updateResult);
    
    // Test delete
    const deleteResult = await deleteGLAccount(result.data.id);
    console.log('Delete result:', deleteResult);
}
```

**Expected:** All operations succeed without errors

---

## Step 5: Monitor for Issues
### الخطوة 5: مراقبة المشاكل

### Open Browser Console and monitor for:

❌ **Should NOT see:**
- `column gl_accounts.name_ar does not exist`
- `table items not found` (404)
- `org_id` / `tenant_id` confusion errors
- RLS policy errors

✅ **Should see:**
- Clean console log
- Data loading successfully
- All modules functional

---

## Common Issues & Solutions
## المشاكل الشائعة والحلول

### Issue 1: "RLS policy violation"
**Solution:**
```sql
-- Temporarily disable RLS for testing (re-enable after)
ALTER TABLE your_table DISABLE ROW LEVEL SECURITY;
```

### Issue 2: "org_id is NULL"
**Solution:**
```sql
-- Update NULL org_ids to default
UPDATE your_table 
SET org_id = '00000000-0000-0000-0000-000000000001'
WHERE org_id IS NULL;
```

### Issue 3: "Items table empty"
**Solution:**
```sql
-- Re-run products migration
INSERT INTO items (id, org_id, code, name, ...)
SELECT id, COALESCE(org_id, '00000000-0000-0000-0000-000000000001'), ...
FROM products;
```

---

## Rollback Plan (If Needed)
## خطة التراجع (عند الحاجة)

If something goes wrong, you can rollback:

```sql
-- 1. Drop items table if needed
DROP TABLE IF EXISTS items CASCADE;

-- 2. Restore old RLS policies (backup first!)
-- (You should have backup before running fixes)

-- 3. Remove new columns from gl_accounts
ALTER TABLE gl_accounts 
DROP COLUMN IF EXISTS name_ar,
DROP COLUMN IF EXISTS name_en,
DROP COLUMN IF EXISTS subtype;
```

**⚠️ WARNING:** Only rollback if absolutely necessary. Data loss may occur.

---

## Next Steps After Successful Deployment
## الخطوات التالية بعد النشر الناجح

1. ✅ Phase 1 Complete - Mark as done
2. 🔄 Start Phase 2.1.1 - Build COA inline forms
3. 📊 Monitor system performance
4. 📝 Document any new issues
5. 🎯 Proceed with Financial Statements

---

## Support & Documentation
## الدعم والتوثيق

- **Progress Tracker:** `IMPLEMENTATION_PROGRESS_TRACKER.md`
- **Technical Details:** `sql/00_critical_schema_fixes.sql` (comments)
- **API Docs:** Check JSDoc comments in `src/lib/supabase.ts`

---

## Verification Checklist
## قائمة التحقق

- [ ] SQL script executed successfully
- [ ] Items table created and populated
- [ ] gl_accounts has new columns
- [ ] org_id added to all tables
- [ ] RLS policies simplified
- [ ] Frontend starts without errors
- [ ] Payment accounts dropdown works
- [ ] Dashboard loads without 404s
- [ ] CRUD functions tested successfully
- [ ] No console errors

**When all checked:** ✅ Phase 1 Complete! Proceed to Phase 2.

---

**Deployment Date:** _____________  
**Deployed By:** _____________  
**Version:** 1.0.0  
**Status:** 🎯 Ready for Deployment

