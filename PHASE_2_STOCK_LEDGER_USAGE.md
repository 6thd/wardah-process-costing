# Phase 2: Stock Ledger System - Usage Examples

## ✅ Completed Implementation

We've implemented ERPNext's Stock Ledger Entry (SLE) pattern - the foundation of professional inventory management.

---

## Architecture Overview

```
Stock Movement Flow:
┌─────────────────┐
│ Goods Receipt   │
│ (Controller)    │
└────────┬────────┘
         │ on_submit()
         ▼
┌─────────────────┐
│ StockController │ ← Creates stock movements
└────────┬────────┘
         │
         ▼
┌─────────────────────┐
│ StockLedgerService  │ ← Core inventory logic
└──────────┬──────────┘
           │
           ├─► Stock Ledger Entry (SLE)  ← Individual transactions
           │
           └─► Bin                        ← Aggregated balance
```

---

## 1. Stock Ledger Entry (SLE) Pattern

Every inventory transaction creates an SLE with:
- **actual_qty**: Change in quantity (+10 for IN, -5 for OUT)
- **qty_after_transaction**: Running balance (like bank statement)
- **valuation_rate**: Weighted average cost
- **stock_value**: Total value of stock

### Example: Create Goods Receipt

```typescript
import { createGoodsReceipt } from '@/modules/purchasing'

// Create GR
const gr = await createGoodsReceipt()

gr.setData({
  vendor_id: 'vendor-uuid',
  warehouse_id: 'warehouse-uuid',
  receipt_date: '2025-11-08'
})

gr.setLines([
  {
    product_id: 'product-1',
    quantity: 100,
    unit_price: 50
  },
  {
    product_id: 'product-2',
    quantity: 50,
    unit_price: 80
  }
])

// Save as draft
await gr.save()
console.log('GR Number:', gr.getValue('receipt_number')) // GR-00001

// Submit - This creates Stock Ledger Entries automatically!
await gr.submit()
```

**What happens on submit:**
1. ✅ Validates warehouse and products exist
2. ✅ Creates Stock Ledger Entry for each line
3. ✅ Updates Bin (aggregated balance)
4. ✅ Updates PO received quantities (if from PO)
5. ✅ Updates product stock_quantity (backward compatibility)

---

## 2. Stock Ledger Entries Created

After submitting the GR above, 2 SLEs are created:

```sql
SELECT * FROM stock_ledger_entries 
WHERE voucher_id = 'gr-uuid'
ORDER BY posting_date, posting_time;
```

**Result:**

| Product | Warehouse | Actual Qty | Qty After | Incoming Rate | Valuation Rate | Stock Value |
|---------|-----------|------------|-----------|---------------|----------------|-------------|
| Product-1 | WH-01 | +100 | 100 | 50 | 50 | 5,000 |
| Product-2 | WH-01 | +50 | 50 | 80 | 80 | 4,000 |

---

## 3. Bins (Aggregated Balances)

Bins store the current balance per product-warehouse:

```sql
SELECT * FROM bins WHERE warehouse_id = 'warehouse-uuid';
```

**Result:**

| Product | Warehouse | Actual Qty | Reserved | Ordered | Projected | Valuation Rate | Stock Value |
|---------|-----------|------------|----------|---------|-----------|----------------|-------------|
| Product-1 | WH-01 | 100 | 0 | 0 | 100 | 50 | 5,000 |
| Product-2 | WH-01 | 50 | 0 | 0 | 50 | 80 | 4,000 |

---

## 4. StockLedgerService - Direct API

You can also use StockLedgerService directly for custom stock movements:

### Create Stock Entry (Manual)

```typescript
import { StockLedgerService } from '@/modules/inventory'

// Receive stock manually
await StockLedgerService.createEntry({
  voucher_type: 'Stock Entry',
  voucher_id: 'custom-id',
  product_id: 'product-1',
  warehouse_id: 'warehouse-1',
  posting_date: '2025-11-08',
  actual_qty: 25,           // +25 units
  incoming_rate: 55         // At 55 SAR per unit
})

// Result:
// - New SLE created
// - Bin updated
// - Valuation rate recalculated (weighted average)
```

### Get Stock Balance

```typescript
const balance = await StockLedgerService.getStockBalance(
  'product-id',
  'warehouse-id'
)

console.log('Quantity:', balance.quantity)
console.log('Valuation Rate:', balance.valuation_rate)
console.log('Stock Value:', balance.stock_value)
```

### Get Balance at Specific Date

```typescript
const balanceAtDate = await StockLedgerService.getStockBalanceAtDate(
  'product-id',
  'warehouse-id',
  '2025-10-01'  // Balance on Oct 1
)

console.log('Quantity on Oct 1:', balanceAtDate.quantity)
```

---

## 5. Weighted Average Valuation

ERPNext uses weighted average for incoming stock:

**Example:**

```
Initial Stock: 0 units @ 0 SAR

Receipt 1: +100 units @ 50 SAR
  → Total: 100 units
  → Value: 5,000 SAR
  → Avg Rate: 50 SAR

Receipt 2: +50 units @ 60 SAR
  → Total: 150 units
  → Value: 8,000 SAR (5000 + 3000)
  → Avg Rate: 53.33 SAR (8000 / 150)

Issue (Outgoing): -30 units @ 53.33 SAR
  → Total: 120 units
  → Value: 6,400 SAR (120 * 53.33)
  → Avg Rate: 53.33 SAR (remains same for outgoing)
```

This is automatically calculated by StockLedgerService!

---

## 6. Stock Movements History

Get all movements for a product:

```typescript
const movements = await StockLedgerService.getStockMovements(
  'product-id',
  'warehouse-id',    // optional
  '2025-01-01',      // from date (optional)
  '2025-12-31',      // to date (optional)
  100                // limit (optional)
)

movements.forEach(sle => {
  console.log(`${sle.posting_date}: ${sle.actual_qty} units @ ${sle.valuation_rate}`)
  console.log(`  Balance after: ${sle.qty_after_transaction}`)
  console.log(`  Stock value: ${sle.stock_value}`)
})
```

---

## 7. Cancellation (Reversal)

When you cancel a GR, it automatically reverses stock:

```typescript
const gr = await createGoodsReceipt('gr-id')

// Cancel GR
await gr.cancel()
```

**What happens:**
1. ✅ Creates reversal SLEs (negative of original quantities)
2. ✅ Updates Bins (reduces stock)
3. ✅ Reverses PO received quantities
4. ✅ Updates product stock_quantity
5. ✅ Marks original SLEs as cancelled

---

## 8. Reposting Valuation

If you correct a rate retroactively, you need to repost:

```typescript
// Example: You received 100 units @ 50 SAR
// But invoice shows 55 SAR
// You need to correct and repost all subsequent transactions

await StockLedgerService.repostValuation(
  'product-id',
  'warehouse-id',
  '2025-11-01'  // Repost from this date
)
```

**What it does:**
1. ✅ Fetches all SLEs from date onwards
2. ✅ Recalculates valuation rates
3. ✅ Updates all affected SLEs
4. ✅ Updates Bin to latest values

---

## 9. Total Stock Value

Get total inventory value:

```typescript
// All warehouses
const totalValue = await StockLedgerService.getTotalStockValue()
console.log('Total Inventory Value:', totalValue)

// Specific warehouse
const warehouseValue = await StockLedgerService.getTotalStockValue('warehouse-id')
console.log('Warehouse Value:', warehouseValue)
```

---

## 10. Complete Purchase Cycle with Stock

```typescript
import { 
  createPurchaseOrder, 
  createGoodsReceipt 
} from '@/modules/purchasing'

// 1. Create Purchase Order
const po = await createPurchaseOrder()
po.setData({
  vendor_id: 'vendor-1',
  order_date: '2025-11-08'
})
po.setLines([
  { product_id: 'p1', quantity: 100, unit_price: 50, tax_percentage: 15 }
])
await po.save()
await po.submit()

console.log('PO Status:', po.getValue('status')) // 'Submitted'

// 2. Create Goods Receipt from PO
const grId = await po.createGoodsReceipt()
const gr = await createGoodsReceipt(grId)

// Submit GR - Creates Stock Ledger Entries
await gr.submit()

console.log('PO Status:', (await po.load(po.getValue('id')!)).getValue('status'))
// 'Fully Received' (if all quantities received)

// 3. Check stock balance
const balance = await StockLedgerService.getStockBalance('p1', 'warehouse-1')
console.log('Stock:', balance.quantity)         // 100
console.log('Rate:', balance.valuation_rate)    // 50
console.log('Value:', balance.stock_value)      // 5000

// 4. Create Purchase Invoice (Phase 3)
const piId = await gr.createPurchaseInvoice()
console.log('Purchase Invoice created:', piId)
```

---

## 11. Stock Queries (SQL Functions)

We created SQL functions for common queries:

### Get Stock Balance

```sql
SELECT * FROM get_stock_balance(
  'product-uuid',
  'warehouse-uuid'
);
```

### Get Balance at Date

```sql
SELECT * FROM get_stock_balance_at_date(
  'product-uuid',
  'warehouse-uuid',
  '2025-10-01'
);
```

### Stock Aging Report

```sql
SELECT * FROM get_stock_aging(
  'warehouse-uuid',  -- optional
  'category-uuid'    -- optional
)
WHERE days_in_stock > 90
ORDER BY stock_value DESC;
```

---

## 12. Database Schema

### Stock Ledger Entries Table

```sql
CREATE TABLE stock_ledger_entries (
    id UUID PRIMARY KEY,
    voucher_type VARCHAR(50),      -- Document type
    voucher_id UUID,               -- Document ID
    product_id UUID,
    warehouse_id UUID,
    posting_date DATE,
    posting_time TIME,
    actual_qty DECIMAL(15,4),              -- Change
    qty_after_transaction DECIMAL(15,4),   -- Running balance
    incoming_rate DECIMAL(15,4),           -- For incoming
    outgoing_rate DECIMAL(15,4),           -- For outgoing
    valuation_rate DECIMAL(15,4),          -- Weighted avg
    stock_value DECIMAL(20,4),             -- Total value
    stock_value_difference DECIMAL(20,4),
    stock_queue JSONB,                     -- FIFO/LIFO queue
    is_cancelled BOOLEAN
);
```

### Bins Table

```sql
CREATE TABLE bins (
    id UUID PRIMARY KEY,
    product_id UUID,
    warehouse_id UUID,
    actual_qty DECIMAL(15,4),     -- Available
    reserved_qty DECIMAL(15,4),   -- Reserved for SO
    ordered_qty DECIMAL(15,4),    -- On order from PO
    planned_qty DECIMAL(15,4),    -- Planned production
    projected_qty DECIMAL(15,4),  -- Calculated
    valuation_rate DECIMAL(15,4),
    stock_value DECIMAL(20,4),
    stock_queue JSONB
);
```

---

## 13. Performance Considerations

### Indexes Created

```sql
-- Critical for balance queries
CREATE INDEX idx_sle_balance_query 
ON stock_ledger_entries(product_id, warehouse_id, posting_date DESC, posting_time DESC);

-- For voucher lookups
CREATE INDEX idx_sle_voucher 
ON stock_ledger_entries(voucher_type, voucher_id);

-- Unique bin per product-warehouse
CREATE UNIQUE INDEX idx_bins_product_warehouse 
ON bins(product_id, warehouse_id);
```

---

## Benefits of This System

### 1. **Audit Trail**
- Every stock movement is recorded
- Complete history of quantities and rates
- Can recreate balance at any point in time

### 2. **Accurate Valuation**
- Weighted average calculation
- Prevents negative stock (with warnings)
- Automatic valuation on each transaction

### 3. **Scalability**
- ERPNext pattern used by 10,000+ companies
- Handles millions of transactions
- Optimized indexes for performance

### 4. **Flexibility**
- Supports FIFO/LIFO (Phase 3)
- Batch and serial number tracking
- Multi-warehouse management

### 5. **Integration**
- GL Entries (to be added)
- Cost accounting
- Financial reports

---

## Files Created

```
✅ sql/phase2_stock_ledger_system.sql (350 lines)
   - stock_ledger_entries table
   - bins table
   - warehouses table
   - SQL functions
   - Indexes

✅ src/modules/inventory/StockLedgerService.ts (450 lines)
   - createEntry()
   - updateBin()
   - getStockBalance()
   - getStockBalanceAtDate()
   - repostValuation()
   - cancelEntry()
   - getTotalStockValue()

✅ src/modules/purchasing/GoodsReceiptController.ts (400 lines)
   - Extends StockController
   - Auto-creates SLEs on submit
   - Updates PO received quantities
   - Creates Purchase Invoice

✅ src/modules/inventory/index.ts
✅ Updated src/modules/index.ts
```

**Total**: ~1,200 lines of production code for Phase 2!

---

## Next Steps

- ✅ Phase 1: Architecture Refactoring - **COMPLETED**
- ✅ Phase 2: Stock Ledger System - **COMPLETED**
- ⏭️ Phase 3: Advanced Valuation (FIFO/LIFO/Moving Average)
- ⏭️ Phase 4: Manufacturing & Multi-level BOM
- ⏭️ Phase 5-15: Continue with roadmap

---

## Testing the Implementation

1. **Run SQL Migration:**
```bash
# Execute the SQL file in Supabase SQL Editor
# Or run via CLI
```

2. **Test Goods Receipt:**
```bash
npm run dev
# Open browser, create GR from PO
# Check stock_ledger_entries and bins tables
```

3. **Verify Stock Balance:**
```sql
-- Check SLEs
SELECT * FROM stock_ledger_entries 
WHERE product_id = 'your-product-id'
ORDER BY posting_date DESC, posting_time DESC;

-- Check Bins
SELECT * FROM bins WHERE product_id = 'your-product-id';
```

**Ready for Phase 3: Advanced Valuation (FIFO/LIFO)!**
