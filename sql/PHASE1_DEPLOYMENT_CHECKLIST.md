# ✅ Phase 1 Deployment Checklist

## 📋 Status: In Progress

---

## ✅ COMPLETED

### 1. Critical Schema Fixes ✅
- [x] `00a_pre_fix_drop_views.sql` - Drop problematic views
- [x] `00_critical_schema_fixes.sql` - Core schema fixes
  - Organizations table ✅
  - GL Accounts (name_ar, name_en, subtype) ✅
  - Products (is_stockable, is_active) ✅
  - Items table created ✅
  - org_id added to all tables ✅
  - RLS policies simplified ✅
  - Performance indexes ✅
  - Helper functions ✅

**Date Completed:** Today
**Verification:**
```sql
SELECT id, code, name, name_ar, name_en, category, subtype 
FROM gl_accounts LIMIT 10;
-- ✅ Confirmed: All columns exist and populated
```

---

## 🔄 NEXT: Phase B - SQL Scripts Deployment

### 2. Sales Module Fixes
- [ ] `06_sales_tables_fix.sql`
  - Fix sales_invoices table structure
  - Add missing foreign keys
  - Fix RLS policies for sales
  
- [ ] `07_sales_schema_fix.sql`
  - Add missing indexes for sales tables
  - Fix column constraints
  
- [ ] `08_sales_performance_and_security.sql`
  - Add performance indexes for sales queries
  - Enhance RLS policies

### 3. Payment Vouchers System
- [ ] `09_payment_vouchers_system.sql`
  - Create payment_vouchers table
  - Create receipt_vouchers table
  - Add GL integration functions
  - Create RLS policies

### 4. Manufacturing Module (Optional)
- [ ] `manufacturing/07_manufacturing_tables_fix.sql`
  - Already has org_id ✅
  - May need to verify structure

### 5. HR Module (Optional)
- [ ] `15_hr_module.sql`
  - Core HR tables
  
- [ ] `hr/16_hr_operational_extensions.sql`
  - HR alerts, settlements
  
- [ ] `hr/17_hr_core_extensions.sql`
  - HR policies, attendance, payroll locks

---

## ⏳ PENDING: Phase C - Frontend Development

### 6. Chart of Accounts CRUD
- [ ] Backend: CRUD functions in `src/lib/supabase.ts` ✅ (Already exist!)
  - `createGLAccount()` ✅
  - `updateGLAccount()` ✅
  - `deleteGLAccount()` ✅
  - `getGLAccountById()` ✅
  - `checkAccountCodeExists()` ✅

- [ ] Frontend: Chart of Accounts Component
  - [ ] Tree view with inline add/edit/delete
  - [ ] Account form dialog
  - [ ] Search and filter
  - [ ] Validation (duplicate codes, delete with children)
  - [ ] Arabic/English support

---

## 🎯 Current Focus

**NOW:** Testing Frontend (Step A)
- Server running on http://localhost:5174
- Checking for console errors
- Verifying data displays correctly

**NEXT:** Deploy SQL Scripts (Step B)
- Run 06, 07, 08, 09 SQL files

**THEN:** Build Chart of Accounts CRUD (Step C)
- Use existing CRUD functions from `src/lib/supabase.ts`
- Build interactive UI component

---

## 📊 Progress

```
Phase 1 (Critical Fixes): ████████████████████ 100% ✅
Phase A (Frontend Test):  ████████████░░░░░░░░  60% 🔄
Phase B (SQL Scripts):    ░░░░░░░░░░░░░░░░░░░░   0% ⏳
Phase C (COA CRUD):       ░░░░░░░░░░░░░░░░░░░░   0% ⏳
```

---

## 🔍 Verification Commands

### After Phase B - Verify Tables
```sql
-- Check sales tables
SELECT COUNT(*) FROM sales_invoices;
SELECT COUNT(*) FROM sales_invoice_lines;

-- Check payment vouchers
SELECT COUNT(*) FROM payment_vouchers;
SELECT COUNT(*) FROM receipt_vouchers;

-- Check RLS policies
SELECT tablename, policyname 
FROM pg_policies 
WHERE schemaname = 'public'
AND tablename IN ('sales_invoices', 'payment_vouchers', 'receipt_vouchers')
ORDER BY tablename;
```

### After Phase C - Verify Frontend
```
1. Open http://localhost:5174/accounting/chart-of-accounts
2. Verify tree view loads
3. Try adding a new account
4. Try editing an account
5. Try deleting an account (should validate)
```

---

## 📝 Notes

- All SQL scripts should be run in order
- Check for errors after each script
- Use `RAISE NOTICE` messages to track progress
- Backend CRUD functions already exist in codebase! ✅
- Focus is on building the UI component

---

**Last Updated:** Now
**Status:** Phase A in progress, waiting for frontend test results

