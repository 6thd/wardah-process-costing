# ⚡ Quick Implementation Guide
## دليل التنفيذ السريع - مستوحى من ERPNext

---

## 🎯 **Top 5 Priorities (Next 2 Weeks)**

### 1️⃣ **Stock Ledger Service** (Critical - 3 days)
```typescript
// src/core/services/stock-ledger-service.ts

interface StockLedgerEntry {
  item_code: string;
  warehouse: string;
  posting_date: Date;
  posting_time: string;
  voucher_type: string;  // 'Purchase Receipt', 'Delivery Note', etc.
  voucher_no: string;
  actual_qty: number;  // +ve for receipt, -ve for issue
  qty_after_transaction?: number;
  incoming_rate?: number;
  outgoing_rate?: number;
  valuation_rate?: number;
  stock_value?: number;
  stock_value_difference?: number;
}

export class StockLedgerService {
  async createEntry(entry: StockLedgerEntry) {
    // 1. Insert SLE
    const sle = await this.insertSLE(entry);
    
    // 2. Update Bin
    await this.updateBin(entry);
    
    // 3. Repost valuation
    await this.repostValuation(entry);
    
    return sle;
  }
  
  private async updateBin(entry: StockLedgerEntry) {
    const bin = await this.getOrCreateBin(entry.item_code, entry.warehouse);
    
    bin.actual_qty += entry.actual_qty;
    bin.stock_value += entry.stock_value_difference;
    bin.valuation_rate = bin.stock_value / bin.actual_qty;
    
    await this.saveBin(bin);
  }
}
```

**Action Items:**
- [ ] Create `stock_ledger_entries` table
- [ ] Create `bins` table
- [ ] Implement StockLedgerService
- [ ] Update Purchase Receipt to use SLE
- [ ] Update Delivery Note to use SLE

---

### 2️⃣ **Valuation Method Factory** (Critical - 2 days)
```typescript
// src/core/services/valuation-factory.ts

type ValuationMethod = 'FIFO' | 'LIFO' | 'Moving Average';
type StockBin = [qty: number, rate: number];

interface IValuation {
  addStock(qty: number, rate: number): void;
  removeStock(qty: number): StockBin[];
  getCurrentValue(): number;
  getState(): StockBin[];
}

class FIFOValuation implements IValuation {
  private queue: StockBin[] = [];
  
  addStock(qty: number, rate: number) {
    if (this.queue.length === 0 || this.queue[this.queue.length - 1][1] !== rate) {
      this.queue.push([qty, rate]);
    } else {
      this.queue[this.queue.length - 1][0] += qty;
    }
  }
  
  removeStock(qty: number): StockBin[] {
    const consumed: StockBin[] = [];
    let remaining = qty;
    
    while (remaining > 0 && this.queue.length > 0) {
      const [binQty, binRate] = this.queue[0];
      
      if (binQty <= remaining) {
        consumed.push([binQty, binRate]);
        remaining -= binQty;
        this.queue.shift();
      } else {
        consumed.push([remaining, binRate]);
        this.queue[0][0] -= remaining;
        remaining = 0;
      }
    }
    
    // Handle negative stock
    if (remaining > 0) {
      const lastRate = consumed[consumed.length - 1]?.[1] || 0;
      this.queue.push([-remaining, lastRate]);
      consumed.push([remaining, lastRate]);
    }
    
    return consumed;
  }
  
  getCurrentValue(): number {
    return this.queue.reduce((sum, [qty, rate]) => sum + (qty * rate), 0);
  }
  
  getState(): StockBin[] {
    return [...this.queue];
  }
}

export class ValuationFactory {
  static create(method: ValuationMethod): IValuation {
    switch (method) {
      case 'FIFO':
        return new FIFOValuation();
      case 'LIFO':
        return new LIFOValuation();
      case 'Moving Average':
        return new MovingAverageValuation();
      default:
        throw new Error(`Unknown valuation method: ${method}`);
    }
  }
}
```

**Action Items:**
- [ ] Implement FIFOValuation
- [ ] Implement LIFOValuation
- [ ] Implement MovingAverageValuation (enhance existing)
- [ ] Add item setting for valuation method
- [ ] Integrate with StockLedgerService

---

### 3️⃣ **Base Controllers** (High - 2 days)
```typescript
// src/core/controllers/BaseController.ts

export abstract class BaseController<T> {
  protected supabase = createClient();
  protected abstract tableName: string;
  
  async create(data: Partial<T>) {
    this.validate(data);
    
    const { data: created, error } = await this.supabase
      .from(this.tableName)
      .insert(data)
      .select()
      .single();
    
    if (error) throw error;
    
    await this.afterCreate(created);
    return created;
  }
  
  async update(id: string, data: Partial<T>) {
    this.validate(data);
    
    const { data: updated, error } = await this.supabase
      .from(this.tableName)
      .update(data)
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    
    await this.afterUpdate(updated);
    return updated;
  }
  
  async delete(id: string) {
    await this.beforeDelete(id);
    
    const { error } = await this.supabase
      .from(this.tableName)
      .delete()
      .eq('id', id);
    
    if (error) throw error;
  }
  
  // Lifecycle hooks
  protected abstract validate(data: Partial<T>): void;
  protected async afterCreate(doc: T) {}
  protected async afterUpdate(doc: T) {}
  protected async beforeDelete(id: string) {}
}

// src/core/controllers/StockController.ts

export abstract class StockController<T> extends BaseController<T> {
  protected stockLedgerService = new StockLedgerService();
  
  async submit(doc: T) {
    // Create stock ledger entries
    const sles = this.getStockLedgerEntries(doc);
    
    for (const sle of sles) {
      await this.stockLedgerService.createEntry(sle);
    }
    
    // Update document status
    await this.updateStatus(doc, 'Submitted');
  }
  
  async cancel(doc: T) {
    // Create reverse SLEs
    const sles = this.getStockLedgerEntries(doc);
    
    for (const sle of sles) {
      await this.stockLedgerService.createEntry({
        ...sle,
        actual_qty: -sle.actual_qty,
        is_cancelled: true
      });
    }
    
    await this.updateStatus(doc, 'Cancelled');
  }
  
  protected abstract getStockLedgerEntries(doc: T): StockLedgerEntry[];
}
```

**Action Items:**
- [ ] Create BaseController
- [ ] Create StockController
- [ ] Create BuyingController
- [ ] Create AccountsController
- [ ] Migrate existing controllers

---

### 4️⃣ **BOM Structure** (High - 3 days)
```typescript
// src/modules/manufacturing/types/bom.types.ts

export interface BOM {
  id: string;
  item: string;
  item_name: string;
  quantity: number;
  uom: string;
  is_default: boolean;
  is_active: boolean;
  
  // Items (Raw Materials)
  items: BOMItem[];
  
  // Operations
  with_operations: boolean;
  operations: BOMOperation[];
  
  // Costing
  raw_material_cost: number;
  operating_cost: number;
  scrap_material_cost: number;
  total_cost: number;
  base_total_cost: number;
}

export interface BOMItem {
  item_code: string;
  item_name: string;
  qty: number;
  rate: number;
  amount: number;
  stock_uom: string;
  bom_no?: string;  // For sub-assemblies
  source_warehouse?: string;
}

export interface BOMOperation {
  operation: string;
  workstation: string;
  time_in_mins: number;
  hour_rate: number;
  operating_cost: number;
  cost_center?: string;
}

// src/modules/manufacturing/services/bom-service.ts

export class BOMService {
  async calculateCost(bomId: string) {
    const bom = await this.getBOM(bomId);
    
    // 1. Calculate raw material cost
    let rmCost = 0;
    for (const item of bom.items) {
      if (item.bom_no) {
        // Sub-assembly: get cost from child BOM
        const childBom = await this.getBOM(item.bom_no);
        rmCost += childBom.total_cost * item.qty;
      } else {
        // Raw material
        rmCost += item.rate * item.qty;
      }
    }
    
    // 2. Calculate operating cost
    let opCost = 0;
    if (bom.with_operations) {
      for (const op of bom.operations) {
        opCost += (op.time_in_mins / 60) * op.hour_rate;
      }
    }
    
    // 3. Calculate scrap value (if any)
    const scrapCost = 0;  // TODO
    
    // 4. Total cost
    const totalCost = rmCost + opCost - scrapCost;
    
    // Update BOM
    await this.update(bomId, {
      raw_material_cost: rmCost,
      operating_cost: opCost,
      scrap_material_cost: scrapCost,
      total_cost: totalCost
    });
    
    return totalCost;
  }
  
  async explodeBOM(bomId: string, qty: number = 1) {
    const bom = await this.getBOM(bomId);
    const requirements: MaterialRequirement[] = [];
    
    for (const item of bom.items) {
      if (item.bom_no) {
        // Sub-assembly: recursively explode
        const childReqs = await this.explodeBOM(item.bom_no, item.qty * qty);
        requirements.push(...childReqs);
      } else {
        // Raw material
        requirements.push({
          item_code: item.item_code,
          qty: item.qty * qty,
          rate: item.rate,
          warehouse: item.source_warehouse
        });
      }
    }
    
    return this.consolidateRequirements(requirements);
  }
}
```

**Action Items:**
- [ ] Create BOM table schema
- [ ] Create BOM Item table
- [ ] Create BOM Operation table
- [ ] Implement BOMService
- [ ] Create BOM Form UI
- [ ] Add BOM explosion logic

---

### 5️⃣ **Material Request** (Medium - 2 days)
```typescript
// src/modules/purchasing/types/material-request.types.ts

export interface MaterialRequest {
  id: string;
  transaction_date: Date;
  material_request_type: 'Purchase' | 'Material Transfer' | 'Manufacture';
  status: 'Draft' | 'Submitted' | 'Ordered' | 'Completed';
  required_by: Date;
  
  items: MaterialRequestItem[];
  
  // Tracking
  per_ordered: number;
}

export interface MaterialRequestItem {
  item_code: string;
  qty: number;
  stock_uom: string;
  warehouse: string;
  required_by: Date;
  
  // Tracking
  ordered_qty: number;
  received_qty: number;
}

// Auto-create Purchase Order from MR
export async function makePurchaseOrder(mrId: string) {
  const mr = await getMaterialRequest(mrId);
  
  // Group items by supplier
  const supplierItems = await groupItemsBySupplier(mr.items);
  
  const purchaseOrders = [];
  
  for (const [supplier, items] of Object.entries(supplierItems)) {
    const po = await createPurchaseOrder({
      supplier,
      items: items.map(item => ({
        item_code: item.item_code,
        qty: item.qty - item.ordered_qty,
        rate: item.last_purchase_rate,
        material_request: mr.id,
        material_request_item: item.id
      }))
    });
    
    purchaseOrders.push(po);
  }
  
  return purchaseOrders;
}
```

**Action Items:**
- [ ] Create Material Request table
- [ ] Create MR Item table
- [ ] Implement MR Service
- [ ] Create MR Form UI
- [ ] Add "Make PO" button
- [ ] Link MR to PO

---

## 🔥 **Quick Wins (Can be done in 1 day each)**

### ✅ Add Item Code to Products
```sql
ALTER TABLE products ADD COLUMN item_code VARCHAR(50) UNIQUE;
UPDATE products SET item_code = 'ITEM-' || LPAD(id::text, 5, '0');
```

### ✅ Add Valuation Method to Items
```sql
ALTER TABLE products ADD COLUMN valuation_method VARCHAR(20) DEFAULT 'Moving Average';
-- Options: 'FIFO', 'LIFO', 'Moving Average'
```

### ✅ Add Status to Documents
```sql
ALTER TABLE purchase_orders ADD COLUMN status VARCHAR(20) DEFAULT 'Draft';
-- Options: 'Draft', 'Submitted', 'Partially Received', 'Completed', 'Cancelled'
```

### ✅ Add Docstatus for Workflow
```sql
ALTER TABLE purchase_orders ADD COLUMN docstatus INTEGER DEFAULT 0;
-- 0: Draft, 1: Submitted, 2: Cancelled
```

### ✅ Create Simple Bin Table
```sql
CREATE TABLE bins (
  id SERIAL PRIMARY KEY,
  item_code VARCHAR(50) NOT NULL,
  warehouse VARCHAR(100) NOT NULL,
  actual_qty DECIMAL(18, 6) DEFAULT 0,
  reserved_qty DECIMAL(18, 6) DEFAULT 0,
  ordered_qty DECIMAL(18, 6) DEFAULT 0,
  valuation_rate DECIMAL(18, 6),
  stock_value DECIMAL(18, 2),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(item_code, warehouse)
);

CREATE INDEX idx_bins_item ON bins(item_code);
CREATE INDEX idx_bins_warehouse ON bins(warehouse);
```

---

## 📚 **Learning Resources**

### ERPNext Code to Study
1. **Stock Ledger**: `erpnext/stock/stock_ledger.py`
2. **Valuation**: `erpnext/stock/valuation.py`
3. **BOM**: `erpnext/manufacturing/doctype/bom/bom.py`
4. **Purchase Order**: `erpnext/buying/doctype/purchase_order/purchase_order.py`

### Key Concepts
- **SLE (Stock Ledger Entry)**: القيد المخزني لكل حركة
- **Bin**: الرصيد الحالي لصنف في مستودع
- **Reposting**: إعادة حساب التكلفة
- **FIFO Queue**: طابور الوارد أولاً صادر أولاً
- **Valuation Rate**: متوسط سعر التكلفة

---

## 🎯 **Decision Matrix**

| Feature | Priority | Complexity | Impact | Status |
|---------|----------|------------|--------|--------|
| Stock Ledger | 🔴 Critical | High | High | Planned |
| FIFO/LIFO | 🔴 Critical | Medium | High | Planned |
| BOM Multi-level | 🔴 Critical | High | High | Planned |
| Material Request | 🟡 High | Low | Medium | Planned |
| Quality Inspection | 🟡 High | Medium | Medium | Future |
| Batch Tracking | 🟢 Medium | Medium | Low | Future |
| Serial Numbers | 🟢 Medium | High | Low | Future |
| Subcontracting | ⚪ Low | High | Low | Future |

---

## 💡 **Pro Tips**

1. **Start with Stock Ledger** - إنه الأساس لكل شيء
2. **Test with Real Data** - استخدم بيانات واقعية للاختبار
3. **Document as You Go** - وثق أثناء التطوير
4. **Keep It Simple** - ابدأ بسيط ثم زد التعقيد
5. **Follow ERPNext Patterns** - اتبع نفس الأنماط

---

**Last Updated**: November 8, 2025  
**Next Review**: November 15, 2025

> "Code like ERPNext, adapt for Wardah!" 💪
