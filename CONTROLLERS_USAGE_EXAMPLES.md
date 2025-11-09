# Wardah ERP - Controllers Usage Examples

## Phase 1: Architecture Refactoring - COMPLETED ✅

We've implemented ERPNext-inspired modular architecture with Base Controllers pattern.

---

## Architecture Overview

```
src/modules/
├── core/                   # Base controllers (shared logic)
│   ├── BaseController.ts   # Base CRUD + lifecycle hooks
│   ├── StockController.ts  # Stock movements + SLE
│   ├── BuyingController.ts # Purchase documents
│   └── index.ts
├── purchasing/             # Purchase Order, GR, PI
│   ├── PurchaseOrderController.ts
│   └── index.ts
├── inventory/              # Stock Entry, Reposting (Phase 2)
├── manufacturing/          # BOM, Work Orders (Phase 4)
├── costing/                # Cost Centers, Allocation (Phase 7)
└── accounting/             # GL Entries, Journals
```

---

## 1. BaseController Usage

### Create a New Document

```typescript
import { createPurchaseOrder } from '@/modules/purchasing'

// Create new PO
const po = await createPurchaseOrder()

// Set data
po.setData({
  vendor_id: 'vendor-uuid',
  order_date: new Date().toISOString(),
  expected_delivery_date: '2025-12-01'
})

// Set lines
po.setLines([
  {
    product_id: 'product-1',
    quantity: 10,
    unit_price: 50,
    tax_percentage: 15
  },
  {
    product_id: 'product-2',
    quantity: 5,
    unit_price: 100,
    tax_percentage: 15
  }
])

// Save as draft
await po.save()

console.log('PO created:', po.getData())
```

### Load Existing Document

```typescript
// Load PO by ID
const po = await createPurchaseOrder('po-uuid')

console.log('PO Number:', po.getValue('order_number'))
console.log('Grand Total:', po.getValue('grand_total'))
```

### Submit Document

```typescript
const po = await createPurchaseOrder('po-uuid')

// Submit (change docstatus from 0 to 1)
await po.submit()

console.log('PO Status:', po.getValue('status')) // 'Submitted'
```

### Cancel Document

```typescript
const po = await createPurchaseOrder('po-uuid')

// Cancel (change docstatus from 1 to 2)
await po.cancel()

console.log('PO Status:', po.getValue('status')) // 'Cancelled'
```

---

## 2. Document Lifecycle Hooks

Hooks are automatically called at specific points:

```typescript
class MyController extends BaseController {
  
  protected async validate() {
    // Called before save - throw error to prevent save
    if (!this.doc.vendor_id) {
      throw new Error('Vendor is required')
    }
  }

  protected async before_save() {
    // Called before save - set default values
    if (!this.doc.order_number) {
      this.doc.order_number = await this.getNextNumber()
    }
  }

  protected async after_save() {
    // Called after save - save child tables
    await this.saveLines()
  }

  protected async on_submit() {
    // Called when document is submitted
    await this.updateVendorBalance()
    await this.createStockEntries()
  }

  protected async on_cancel() {
    // Called when document is cancelled
    await this.reverseStockEntries()
  }
}
```

---

## 3. BuyingController Features

### Automatic Calculations

```typescript
const po = await createPurchaseOrder()

po.setLines([
  {
    product_id: 'product-1',
    quantity: 10,
    unit_price: 100,      // Unit price
    discount_percentage: 10, // 10% discount
    tax_percentage: 15    // 15% VAT
  }
])

// Save - calculations happen automatically in validate()
await po.save()

// Results:
// Subtotal: 1000
// Discount: 100
// Tax: 135 (15% of 900)
// Grand Total: 1035
```

### Document Numbering

```typescript
// Automatic numbering on save
const po = await createPurchaseOrder()
await po.save()

console.log(po.getValue('order_number')) // 'PO-00001'
```

### Vendor Validation

```typescript
const po = await createPurchaseOrder()
po.setData({ vendor_id: 'invalid-id' })

await po.save() // Throws error: 'Invalid vendor'
```

---

## 4. StockController Features

### Create Goods Receipt with Stock Movements

```typescript
// Will be implemented in Phase 2
// Example of how it will work:

class GoodsReceiptController extends StockController {
  
  protected async getStockMoves() {
    // Return array of stock movements
    return this.lines.map(line => ({
      product_id: line.product_id,
      warehouse_id: this.doc.warehouse_id,
      quantity: line.quantity,  // Positive for incoming
      rate: line.unit_price,
      posting_date: new Date(this.doc.receipt_date),
      voucher_type: 'Goods Receipt',
      voucher_id: this.doc.id
    }))
  }
}

// On submit:
await gr.submit()
// ↓
// Automatically creates:
// - Stock Ledger Entries (SLE)
// - Bin updates
// - GL Entries (Dr Inventory, Cr Stock Received But Not Billed)
```

---

## 5. Advanced Features

### Check Document Status

```typescript
const po = await createPurchaseOrder('po-uuid')

if (po.isDraft()) {
  console.log('PO is still draft')
}

if (po.isSubmitted()) {
  console.log('PO is submitted')
}

if (po.isCancelled()) {
  console.log('PO is cancelled')
}
```

### Track Field Changes

```typescript
const po = await createPurchaseOrder('po-uuid')

// Make changes
po.setValue('grand_total', 5000)

// Check if changed
if (po.hasValueChanged('grand_total')) {
  console.log('Grand total was updated')
}

// Get old value
console.log('Old value:', po.getOldData()?.grand_total)
```

### Get Receipt Status

```typescript
const po = await createPurchaseOrder('po-uuid')

const status = await po.getReceiptStatus()

console.log(`Received: ${status.receivedQty} / ${status.totalQty}`)
console.log(`Percentage: ${status.percentageReceived}%`)
console.log(`Status: ${status.status}`) // 'Partially Received'
```

### Create Goods Receipt from PO

```typescript
const po = await createPurchaseOrder('po-uuid')

// Create GR for all lines
const grId = await po.createGoodsReceipt()

// Or for specific lines only
const grId = await po.createGoodsReceipt(['line-id-1', 'line-id-2'])

console.log('GR created:', grId)
```

---

## 6. Error Handling

All controllers throw descriptive errors:

```typescript
try {
  const po = await createPurchaseOrder()
  po.setData({ vendor_id: 'invalid' })
  await po.save()
} catch (error) {
  console.error(error.message) // 'Invalid vendor'
}

try {
  await po.submit() // Try to submit cancelled document
} catch (error) {
  console.error(error.message) // 'Cannot submit document with docstatus 2'
}
```

---

## 7. Extending Controllers

### Create Custom Controller

```typescript
import { BuyingController, BuyingDocument } from '@/modules/core'

export interface MaterialRequest extends BuyingDocument {
  request_type: 'Purchase' | 'Material Transfer' | 'Manufacture'
  required_date: string
  department: string
}

export class MaterialRequestController extends BuyingController<MaterialRequest> {
  
  constructor(doc: Partial<MaterialRequest> = {}) {
    super('material_requests', doc)
  }

  // Override validation
  protected async validate() {
    await super.validate()
    
    if (!this.doc.required_date) {
      throw new Error('Required date is mandatory')
    }
  }

  // Add custom method
  async createPurchaseOrder(): Promise<string> {
    // Create PO from approved Material Request
    // Implementation here
  }
}
```

---

## 8. Integration with UI Components

### React Component Example

```typescript
import { createPurchaseOrder } from '@/modules/purchasing'
import { toast } from 'sonner'

function PurchaseOrderForm() {
  const handleSubmit = async (formData) => {
    try {
      const po = await createPurchaseOrder()
      
      po.setData({
        vendor_id: formData.vendorId,
        order_date: formData.orderDate
      })
      
      po.setLines(formData.lines)
      
      // Save as draft
      await po.save()
      
      toast.success(`PO ${po.getValue('order_number')} created`)
      
      // Submit if requested
      if (formData.submitNow) {
        await po.submit()
        toast.success('PO submitted successfully')
      }
      
    } catch (error) {
      toast.error(error.message)
    }
  }
  
  return <form onSubmit={handleSubmit}>...</form>
}
```

---

## Benefits of This Architecture

### 1. **DRY Principle**
- Common logic in base controllers
- No code duplication across documents

### 2. **Consistent Behavior**
- All documents follow same lifecycle
- Predictable status flow (Draft → Submitted → Cancelled)

### 3. **Easy Testing**
- Controllers are independent classes
- Can be tested without UI

### 4. **Type Safety**
- Full TypeScript support
- Compile-time error checking

### 5. **Extensibility**
- Easy to add new documents
- Override only what you need

### 6. **ERPNext Compatibility**
- Same patterns and concepts
- Easy for ERPNext developers to understand

---

## Next Steps

- ✅ Phase 1: Architecture Refactoring - **COMPLETED**
- ⏭️ Phase 2: Stock Ledger System
  - Implement Stock Ledger Entries table
  - Implement Bins table
  - Complete StockController integration
  - Add AVCO calculation to Stock movements

- ⏭️ Phase 3: Advanced Valuation (FIFO/LIFO)
- ⏭️ Phase 4: Manufacturing & Multi-level BOM
- ⏭️ Phase 5-15: Continue with roadmap

---

## Files Created

```
✅ src/modules/core/BaseController.ts (300 lines)
✅ src/modules/core/StockController.ts (250 lines)
✅ src/modules/core/BuyingController.ts (280 lines)
✅ src/modules/purchasing/PurchaseOrderController.ts (350 lines)
✅ src/modules/core/index.ts
✅ src/modules/purchasing/index.ts
✅ src/modules/index.ts
```

**Total**: ~1200 lines of production-ready, type-safe, ERPNext-inspired code!
