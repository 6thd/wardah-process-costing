# 🔧 Quick Fix: Add warehouse_id to goods_receipts

## ❌ Problem
```
Error: Could not find the 'warehouse_id' column of 'goods_receipts' in the schema cache
```

## ✅ Solution
The `goods_receipts` table needs a `warehouse_id` column to work with the Stock Ledger System.

---

## 📋 Steps to Fix (2 minutes)

### Option 1: Supabase SQL Editor (Recommended)

1. **Open Supabase Dashboard**
   - Go to: https://app.supabase.com/project/uutfztmqvajmsxnrqeiv/sql

2. **Copy this SQL:**
   ```sql
   -- Add warehouse_id column to goods_receipts table
   ALTER TABLE goods_receipts 
   ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES warehouses(id);

   -- Create index for performance
   CREATE INDEX IF NOT EXISTS idx_goods_receipts_warehouse 
       ON goods_receipts(warehouse_id);

   -- Add comment
   COMMENT ON COLUMN goods_receipts.warehouse_id IS 'Target warehouse for goods receipt (required for Stock Ledger System)';

   -- Update existing records to use default warehouse (WH-001)
   UPDATE goods_receipts
   SET warehouse_id = (SELECT id FROM warehouses WHERE code = 'WH-001' LIMIT 1)
   WHERE warehouse_id IS NULL;
   ```

3. **Run the SQL**
   - Paste in SQL Editor
   - Click "Run" button
   - Wait for success message

4. **Verify**
   - Run this query:
   ```sql
   SELECT column_name, data_type 
   FROM information_schema.columns 
   WHERE table_name = 'goods_receipts' 
   AND column_name = 'warehouse_id';
   ```
   - Should return 1 row showing the new column

---

### Option 2: Command Line (Alternative)

```powershell
cd "c:\Users\dell\Desktop\مجاهد\العملاء\New folder\wardah-process-costing"
node deploy-migration-warehouse-gr.cjs --verify
```

**Note:** This will likely show instructions to use SQL Editor instead.

---

## 🧪 After Migration - Test the Flow

1. Refresh your application (Ctrl + F5)
2. Open Goods Receipt form
3. Select a Purchase Order
4. **New:** Select a Warehouse (المخزن الرئيسي)
5. Select products
6. Submit form
7. ✅ Should work without errors!

---

## 🔍 What This Migration Does

### Before:
```sql
goods_receipts
├── id
├── gr_number
├── purchase_order_id
├── receipt_date
└── notes
```

### After:
```sql
goods_receipts
├── id
├── gr_number
├── purchase_order_id
├── receipt_date
├── warehouse_id  ← NEW! Links to warehouses table
└── notes
```

### Benefits:
- ✅ Links Goods Receipts to specific warehouses
- ✅ Enables Stock Ledger Entry creation per warehouse
- ✅ Tracks which warehouse received the goods
- ✅ Supports multi-warehouse inventory management

---

## 📊 Database Changes Summary

**Table Modified:** `goods_receipts`
- **Column Added:** `warehouse_id UUID` (references `warehouses.id`)
- **Index Created:** `idx_goods_receipts_warehouse` (for fast lookups)
- **Existing Data:** Updated to use WH-001 (Main Stores) as default

**Impact:**
- ✅ No data loss
- ✅ Backward compatible (existing records updated)
- ✅ New records require warehouse_id

---

## ⚠️ Troubleshooting

**If you see the same error after migration:**
1. Clear browser cache (Ctrl + F5)
2. Check Supabase logs for migration success
3. Verify column exists:
   ```sql
   \d goods_receipts
   ```

**If migration fails:**
1. Check if `warehouses` table exists:
   ```sql
   SELECT * FROM warehouses LIMIT 5;
   ```
2. If not, run Phase 2 deployment first:
   ```powershell
   node deploy-phase2-stock-ledger.cjs
   ```
3. Then run this migration

---

## ✅ Success Indicators

After running the migration, you should see:
- ✅ `warehouse_id` column in `goods_receipts` table
- ✅ Index `idx_goods_receipts_warehouse` created
- ✅ Existing records have `warehouse_id` set to WH-001
- ✅ Goods Receipt form works with warehouse selection
- ✅ No "Could not find warehouse_id" errors

---

**Next:** Test creating a Goods Receipt with warehouse selection! 🚀
