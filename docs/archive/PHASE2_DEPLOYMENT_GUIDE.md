# Phase 2: Stock Ledger System - Deployment Guide

## 🚀 Quick Deployment Steps

### Step 1: Open Supabase SQL Editor

1. Go to: **https://supabase.com/dashboard/project/uutfztmqvajmsxnrqeiv**
2. Click on **"SQL Editor"** in the left sidebar
3. Click **"New query"** button

### Step 2: Copy & Paste SQL

1. Open file: `sql/phase2_stock_ledger_system.sql`
2. Copy **ALL contents** (Ctrl+A, Ctrl+C)
3. Paste into Supabase SQL Editor

### Step 3: Execute

1. Click **"Run"** button (or press F5)
2. Wait for completion message
3. Check for any errors in the output panel

### Step 4: Verify Deployment

Run verification script:

```bash
node deploy-phase2-stock-ledger.cjs --verify
```

Expected output:
```
✅ Table 'stock_ledger_entries': EXISTS
✅ Table 'bins': EXISTS
✅ Table 'warehouses': EXISTS
✅ Table 'stock_reposting_queue': EXISTS
✅ SQL Function get_stock_balance(): EXISTS
```

---

## 📋 What Gets Deployed

### Tables Created (4)

1. **`stock_ledger_entries`** - Complete audit trail of all stock movements
   - Every movement creates an entry with running balance
   - Stores: actual_qty, qty_after_transaction, valuation_rate, stock_value
   - Used for: Historical balance reconstruction, valuation

2. **`bins`** - Aggregated warehouse-level balances
   - One record per product per warehouse
   - Stores: actual_qty, reserved_qty, ordered_qty, projected_qty
   - Auto-updated by Stock Ledger Service

3. **`warehouses`** - Warehouse master data
   - Supports hierarchical warehouses (parent_warehouse)
   - Types: Store, Transit, Scrap, Manufacturing
   - Sample warehouses pre-loaded

4. **`stock_reposting_queue`** - Async reposting queue
   - For recalculating valuations retroactively
   - Processes in background without blocking UI

### Indexes Created (7)

Performance optimizations for fast queries:
- `idx_sle_balance_query` - Critical for balance queries (composite: product_id, warehouse_id, posting_date DESC)
- `idx_sle_product` - Product-level queries
- `idx_sle_warehouse` - Warehouse-level queries
- `idx_sle_voucher` - Document lookups
- `idx_bins_product_warehouse` - Balance lookups (UNIQUE)
- `idx_warehouse_code` - Warehouse code lookups (UNIQUE)
- `idx_repost_status` - Queue processing

### SQL Functions Created (3)

1. **`get_stock_balance(p_product_id, p_warehouse_id)`**
   - Returns current stock balance from bins table
   - Returns: quantity, valuation_rate, stock_value

2. **`get_stock_balance_at_date(p_product_id, p_warehouse_id, p_date)`**
   - Returns historical balance at specific date
   - Reconstructs balance from SLE history

3. **`get_stock_aging(p_warehouse_id, p_days_threshold)`**
   - Returns aging analysis of stock
   - Groups by product with age calculations

---

## 🧪 Testing After Deployment

### Test 1: Check Tables Exist

```sql
-- Run in Supabase SQL Editor
SELECT tablename FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN ('stock_ledger_entries', 'bins', 'warehouses', 'stock_reposting_queue');
```

### Test 2: Check Sample Warehouses

```sql
SELECT code, name, warehouse_type FROM warehouses;
```

Expected: WH-001, WH-002, WH-TRANSIT, WH-SCRAP

### Test 3: Test SQL Function

```sql
SELECT * FROM get_stock_balance(
  '00000000-0000-0000-0000-000000000000'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid
);
```

Should return: (0, 0, 0) for non-existent product

---

## 📖 Next Steps After Deployment

1. **Read Documentation**: `PHASE_2_STOCK_LEDGER_USAGE.md`
2. **Test Stock Ledger Entry Creation**: Create a Goods Receipt and verify SLEs
3. **Verify Bin Updates**: Check bins table after GR submission
4. **Query Stock Balances**: Use SQL functions to query balances
5. **Proceed to Phase 3**: Advanced Valuation Methods (FIFO/LIFO)

---

## ⚠️ Troubleshooting

### Issue: Table already exists error

**Solution**: Tables have `CREATE TABLE IF NOT EXISTS` - safe to re-run

### Issue: Function already exists error

**Solution**: Functions use `CREATE OR REPLACE FUNCTION` - safe to re-run

### Issue: Permission denied error

**Solution**: 
1. Make sure you're logged in to Supabase
2. Use Service Role key if anon key lacks permissions
3. Check RLS policies if enabled

### Issue: Foreign key constraint error

**Solution**: 
1. Ensure `products` table exists
2. Ensure `organizations` table exists
3. Run prerequisite migrations first

---

## 📊 Database Schema Diagram

```
┌─────────────────────────┐
│   stock_ledger_entries  │
│─────────────────────────│
│ + id (uuid, PK)         │
│ + tenant_id             │
│ + product_id (FK)       │
│ + warehouse_id (FK)     │
│ + actual_qty            │
│ + qty_after_transaction │
│ + valuation_rate        │
│ + stock_value           │
│ + posting_date          │
│ + voucher_type          │
│ + voucher_id            │
│ + stock_queue (JSONB)   │
└─────────────────────────┘
          │
          │ updates
          ▼
┌─────────────────────────┐
│         bins            │
│─────────────────────────│
│ + id (uuid, PK)         │
│ + product_id (FK)       │
│ + warehouse_id (FK)     │
│ + actual_qty            │
│ + reserved_qty          │
│ + ordered_qty           │
│ + projected_qty (calc)  │
│ + valuation_rate        │
│ + stock_value           │
└─────────────────────────┘
          │
          │ references
          ▼
┌─────────────────────────┐
│      warehouses         │
│─────────────────────────│
│ + id (uuid, PK)         │
│ + code (UNIQUE)         │
│ + name                  │
│ + warehouse_type        │
│ + parent_warehouse (FK) │
│ + is_group              │
└─────────────────────────┘
```

---

## ✅ Verification Checklist

- [ ] SQL executed without errors
- [ ] 4 tables created
- [ ] 7 indexes created
- [ ] 3 SQL functions created
- [ ] Sample warehouses loaded
- [ ] Verification script passes
- [ ] Documentation reviewed

---

**Ready to deploy? Follow Step 1 above! 🚀**
