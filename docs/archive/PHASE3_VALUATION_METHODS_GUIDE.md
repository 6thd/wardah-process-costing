# Phase 3: Advanced Valuation Methods

## 📋 Overview

Phase 3 adds support for multiple inventory valuation methods:
- ✅ **Weighted Average** (AVCO) - Already implemented in Phase 2
- 🆕 **FIFO** (First In First Out) - Use oldest batches first
- 🆕 **LIFO** (Last In First Out) - Use newest batches first  
- 🆕 **Moving Average** - Continuous weighted average

---

## 🎯 Goals

1. Add `valuation_method` column to products table
2. Create SQL functions for FIFO/LIFO calculations
3. Implement Valuation Strategy Pattern in TypeScript
4. Update UI to allow selection of valuation method
5. Test all three valuation methods with real data

---

## 📊 Valuation Methods Explained

### Weighted Average (Current)
```
Previous: 100 units @ 45 SAR = 4,500 SAR
Incoming: 50 units @ 55 SAR = 2,750 SAR
─────────────────────────────────────────
New Total: 150 units @ 48.33 SAR = 7,250 SAR

Rate = Total Value / Total Quantity
Rate = (4,500 + 2,750) / (100 + 50) = 48.33
```

### FIFO (First In First Out)
```
Queue: [
  {qty: 100, rate: 45},
  {qty: 50, rate: 55}
]

Issue 60 units:
  - Take 60 from first batch (100 @ 45)
  - Cost: 60 × 45 = 2,700 SAR
  
Remaining Queue: [
  {qty: 40, rate: 45},  ← 40 left from first batch
  {qty: 50, rate: 55}
]
```

### LIFO (Last In First Out)
```
Queue: [
  {qty: 100, rate: 45},
  {qty: 50, rate: 55}
]

Issue 60 units:
  - Take 50 from last batch (50 @ 55)
  - Take 10 from second-last batch (10 @ 45)
  - Cost: (50 × 55) + (10 × 45) = 3,200 SAR
  
Remaining Queue: [
  {qty: 90, rate: 45}  ← 10 taken from first batch
]
```

---

## 🗄️ Database Changes

### 1. New ENUM Type
```sql
CREATE TYPE valuation_method_enum AS ENUM (
    'Weighted Average',
    'FIFO',
    'LIFO',
    'Moving Average'
);
```

### 2. Products Table Update
```sql
ALTER TABLE products 
ADD COLUMN valuation_method valuation_method_enum DEFAULT 'Weighted Average';
```

### 3. New SQL Functions

**get_fifo_rate(stock_queue)**
- Returns rate of oldest batch
- Used when issuing stock with FIFO

**get_lifo_rate(stock_queue)**
- Returns rate of newest batch
- Used when issuing stock with LIFO

**get_weighted_average_from_queue(stock_queue)**
- Calculates weighted average from all batches
- Alternative calculation method

**get_stock_balance_with_method(product_id, warehouse_id, method)**
- Enhanced version of get_stock_balance
- Applies specified valuation method

---

## 💻 TypeScript Implementation

### 1. Valuation Strategy Interface

```typescript
// src/services/valuation/ValuationStrategy.ts

export interface ValuationStrategy {
  /**
   * Calculate new valuation rate after receiving goods
   */
  calculateIncomingRate(
    prevQty: number,
    prevRate: number,
    prevValue: number,
    incomingQty: number,
    incomingRate: number
  ): {
    newQty: number;
    newRate: number;
    newValue: number;
    newQueue: StockBatch[];
  };

  /**
   * Calculate rate and update queue when issuing goods
   */
  calculateOutgoingRate(
    currentQueue: StockBatch[],
    outgoingQty: number
  ): {
    rate: number;
    costOfGoodsSold: number;
    newQueue: StockBatch[];
  };
}

export interface StockBatch {
  qty: number;
  rate: number;
}
```

### 2. Weighted Average Strategy

```typescript
// src/services/valuation/WeightedAverageValuation.ts

export class WeightedAverageValuation implements ValuationStrategy {
  calculateIncomingRate(
    prevQty: number,
    prevRate: number,
    prevValue: number,
    incomingQty: number,
    incomingRate: number
  ) {
    const incomingValue = incomingQty * incomingRate;
    const newQty = prevQty + incomingQty;
    const newValue = prevValue + incomingValue;
    const newRate = newQty > 0 ? newValue / newQty : 0;

    // Weighted average doesn't use batches
    const newQueue = [{ qty: newQty, rate: newRate }];

    return { newQty, newRate, newValue, newQueue };
  }

  calculateOutgoingRate(
    currentQueue: StockBatch[],
    outgoingQty: number
  ) {
    // Use current weighted average rate
    const rate = currentQueue[0]?.rate || 0;
    const costOfGoodsSold = outgoingQty * rate;
    
    const remainingQty = currentQueue[0].qty - outgoingQty;
    const newQueue = [{ qty: remainingQty, rate }];

    return { rate, costOfGoodsSold, newQueue };
  }
}
```

### 3. FIFO Strategy

```typescript
// src/services/valuation/FIFOValuation.ts

export class FIFOValuation implements ValuationStrategy {
  calculateIncomingRate(
    prevQty: number,
    prevRate: number,
    prevValue: number,
    incomingQty: number,
    incomingRate: number
  ) {
    // Add new batch to end of queue
    const newQueue = [
      ...existingQueue,
      { qty: incomingQty, rate: incomingRate }
    ];

    const newQty = prevQty + incomingQty;
    const incomingValue = incomingQty * incomingRate;
    const newValue = prevValue + incomingValue;
    const newRate = newQty > 0 ? newValue / newQty : 0;

    return { newQty, newRate, newValue, newQueue };
  }

  calculateOutgoingRate(
    currentQueue: StockBatch[],
    outgoingQty: number
  ) {
    let remaining = outgoingQty;
    let totalCost = 0;
    const newQueue = [...currentQueue];

    // Take from oldest batches first (queue.shift)
    while (remaining > 0 && newQueue.length > 0) {
      const batch = newQueue[0];
      
      if (batch.qty <= remaining) {
        // Use entire batch
        totalCost += batch.qty * batch.rate;
        remaining -= batch.qty;
        newQueue.shift(); // Remove first batch
      } else {
        // Use part of batch
        totalCost += remaining * batch.rate;
        batch.qty -= remaining;
        remaining = 0;
      }
    }

    const rate = outgoingQty > 0 ? totalCost / outgoingQty : 0;

    return { rate, costOfGoodsSold: totalCost, newQueue };
  }
}
```

### 4. LIFO Strategy

```typescript
// src/services/valuation/LIFOValuation.ts

export class LIFOValuation implements ValuationStrategy {
  calculateIncomingRate(
    prevQty: number,
    prevRate: number,
    prevValue: number,
    incomingQty: number,
    incomingRate: number
  ) {
    // Same as FIFO for receiving
    const newQueue = [
      ...existingQueue,
      { qty: incomingQty, rate: incomingRate }
    ];

    const newQty = prevQty + incomingQty;
    const incomingValue = incomingQty * incomingRate;
    const newValue = prevValue + incomingValue;
    const newRate = newQty > 0 ? newValue / newQty : 0;

    return { newQty, newRate, newValue, newQueue };
  }

  calculateOutgoingRate(
    currentQueue: StockBatch[],
    outgoingQty: number
  ) {
    let remaining = outgoingQty;
    let totalCost = 0;
    const newQueue = [...currentQueue];

    // Take from newest batches first (queue.pop)
    while (remaining > 0 && newQueue.length > 0) {
      const batch = newQueue[newQueue.length - 1];
      
      if (batch.qty <= remaining) {
        // Use entire batch
        totalCost += batch.qty * batch.rate;
        remaining -= batch.qty;
        newQueue.pop(); // Remove last batch
      } else {
        // Use part of batch
        totalCost += remaining * batch.rate;
        batch.qty -= remaining;
        remaining = 0;
      }
    }

    const rate = outgoingQty > 0 ? totalCost / outgoingQty : 0;

    return { rate, costOfGoodsSold: totalCost, newQueue };
  }
}
```

### 5. Valuation Factory

```typescript
// src/services/valuation/ValuationFactory.ts

export class ValuationFactory {
  static getStrategy(method: string): ValuationStrategy {
    switch (method) {
      case 'FIFO':
        return new FIFOValuation();
      
      case 'LIFO':
        return new LIFOValuation();
      
      case 'Weighted Average':
      case 'Moving Average':
      default:
        return new WeightedAverageValuation();
    }
  }
}
```

---

## 🔄 Update receiveGoods Function

```typescript
// In purchasing-service.ts

export async function receiveGoods(
  receipt: GoodsReceipt,
  lines: GoodsReceiptLine[]
) {
  // ... existing code ...

  for (const line of lines) {
    // Get product to check valuation method
    const { data: product } = await supabase
      .from('products')
      .select('valuation_method')
      .eq('id', line.product_id)
      .single();

    const valuationMethod = product?.valuation_method || 'Weighted Average';
    
    // Get current bin
    const binResult = await getBin(line.product_id, receipt.warehouse_id);
    const currentBin = binResult.data || { actual_qty: 0, valuation_rate: 0, stock_value: 0, stock_queue: [] };

    // Use valuation strategy
    const strategy = ValuationFactory.getStrategy(valuationMethod);
    
    const valuation = strategy.calculateIncomingRate(
      currentBin.actual_qty,
      currentBin.valuation_rate,
      currentBin.stock_value,
      line.received_quantity,
      line.unit_cost
    );

    // Create Stock Ledger Entry with new queue
    await createStockLedgerEntry({
      // ... fields ...
      valuation_rate: valuation.newRate,
      stock_value: valuation.newValue,
      stock_queue: valuation.newQueue  // ⭐ Store queue for FIFO/LIFO
    });

    // Update bin with new queue
    await supabase.from('bins').upsert({
      // ... fields ...
      stock_queue: valuation.newQueue  // ⭐ Important for FIFO/LIFO
    });
  }
}
```

---

## 🎨 UI Updates

### 1. Product Form - Add Valuation Method Selector

```tsx
<div className="space-y-2">
  <Label htmlFor="valuationMethod">طريقة التقييم</Label>
  <Select value={valuationMethod} onValueChange={setValuationMethod}>
    <SelectTrigger id="valuationMethod">
      <SelectValue placeholder="اختر طريقة التقييم" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="Weighted Average">المتوسط المرجح (AVCO)</SelectItem>
      <SelectItem value="FIFO">الوارد أولاً صادر أولاً (FIFO)</SelectItem>
      <SelectItem value="LIFO">الوارد أخيراً صادر أولاً (LIFO)</SelectItem>
      <SelectItem value="Moving Average">المتوسط المتحرك</SelectItem>
    </SelectContent>
  </Select>
</div>
```

### 2. Product List - Show Valuation Method

Add column to products table showing valuation method with badge colors

---

## 🧪 Testing Scenarios

### Test 1: Weighted Average (Already Working)
```
1. Product with Weighted Average method
2. Receive 100 units @ 50 SAR
3. Receive 50 units @ 60 SAR
4. Expected: 150 units @ 53.33 SAR
```

### Test 2: FIFO
```
1. Create product with FIFO method
2. Receive 100 units @ 50 SAR (Batch 1)
3. Receive 50 units @ 60 SAR (Batch 2)
4. Issue 120 units
   Expected COGS: (100 × 50) + (20 × 60) = 6,200 SAR
   Expected Rate: 6,200 / 120 = 51.67 SAR
5. Remaining: 30 units @ 60 SAR (from Batch 2)
```

### Test 3: LIFO
```
1. Create product with LIFO method
2. Receive 100 units @ 50 SAR (Batch 1)
3. Receive 50 units @ 60 SAR (Batch 2)
4. Issue 120 units
   Expected COGS: (50 × 60) + (70 × 50) = 6,500 SAR
   Expected Rate: 6,500 / 120 = 54.17 SAR
5. Remaining: 30 units @ 50 SAR (from Batch 1)
```

---

## 📦 Deployment Steps

### Step 1: Deploy Database Schema
```bash
# Run the migration in Supabase SQL Editor
# File: sql/phase3_valuation_methods.sql
```

### Step 2: Verify Deployment
```bash
node deploy-phase3-valuation.cjs --verify
```

### Step 3: Create TypeScript Files
- src/services/valuation/ValuationStrategy.ts
- src/services/valuation/WeightedAverageValuation.ts
- src/services/valuation/FIFOValuation.ts
- src/services/valuation/LIFOValuation.ts
- src/services/valuation/ValuationFactory.ts

### Step 4: Update Services
- Update purchasing-service.ts receiveGoods()
- Update stock-ledger-service.ts
- Add support for stock_queue in createStockLedgerEntry()

### Step 5: Update UI
- Add valuation method selector to Product form
- Show valuation method in product lists
- Add valuation method filter to reports

### Step 6: Test
- Test each valuation method separately
- Verify calculations match expected results
- Check stock_queue is properly maintained

---

## ✅ Success Criteria

- [ ] valuation_method column added to products
- [ ] 4 SQL functions created and working
- [ ] Valuation Strategy Pattern implemented
- [ ] receiveGoods() uses ValuationFactory
- [ ] Product form has valuation method selector
- [ ] FIFO calculation correct (uses oldest batches)
- [ ] LIFO calculation correct (uses newest batches)
- [ ] Weighted Average still works (backward compatible)
- [ ] stock_queue properly maintained in bins and SLEs

---

**Next:** Run the SQL migration in Supabase SQL Editor, then proceed with TypeScript implementation!
