# خطة Test Coverage الشاملة - Wardah ERP Process Costing

## 📋 ملخص تنفيذي

**الهدف**: الوصول إلى **80%+ Test Coverage** لتحقيق Quality Gate في SonarQube

**الوضع الحالي**: 
- Coverage: **0.0%** (مطلوب: ≥ 80.0%)
- Lines of Code: **94k**
- Test Framework: ✅ Vitest + Playwright (جاهز)
- Existing Tests: 19 ملف test (غير كافية)

**المدة المتوقعة**: 4 أسابيع

**الأولوية**: 🔴 **عالية جداً** - Quality Gate فاشل بسبب Coverage

---

## 🎯 الأهداف

### الأهداف الرئيسية
1. ✅ الوصول إلى **80%+ Coverage** للـ New Code
2. ✅ تغطية جميع Core Functions بالـ tests
3. ✅ ضمان جودة الكود قبل الإصلاحات الكبيرة
4. ✅ منع Regressions عند إصلاح المشاكل

### الأهداف الثانوية
- تحسين Code Quality بشكل عام
- توثيق Business Logic من خلال Tests
- تسهيل Refactoring المستقبلي
- بناء Confidence في الكود

---

## 📊 تحليل الوضع الحالي

### البنية التحتية الموجودة ✅

```typescript
// vitest.config.ts - جاهز
- Vitest configured
- React Testing Library setup
- Coverage provider: v8
- HTML reports enabled

// playwright.config.ts - جاهز
- E2E testing configured
- Multiple browsers support
```

### Tests الموجودة (19 ملف)

```
✅ src/domain/__tests__/
   - process-costing.test.ts
   - inventory.test.ts

✅ src/services/valuation/__tests__/
   - ValuationMethods.test.ts

✅ src/features/manufacturing/__tests__/
   - stage-costing-panel.test.tsx
   - equivalent-units-dashboard.test.tsx

✅ src/__tests__/
   - security-headers.test.ts
   - rate-limiter.test.ts
   - design-system.test.tsx
   - floating-animation.test.tsx

✅ src/integration/__tests__/
   - manufacturing-workflow.test.ts
   - inventory-transactions.test.ts
   - multi-tenant-security.test.ts

✅ e2e/
   - process-costing.spec.ts
```

### المشاكل الحالية

1. **Coverage: 0.0%** - Tests موجودة لكن لا تغطي الكود بشكل كافٍ
2. **Core Functions غير مغطاة**:
   - `src/core/security.ts` - 0% coverage
   - `src/lib/supabase.ts` - 0% coverage
   - `src/services/` - معظمها غير مغطاة
3. **Components غير مغطاة**:
   - Forms (PurchaseOrderForm, SupplierInvoiceForm, etc.)
   - Critical UI components
4. **Business Logic غير مغطاة**:
   - Process Costing calculations
   - Inventory Valuation methods
   - Financial calculations

---

## 🗓️ الجدول الزمني (4 أسابيع)

### Week 1: Core Functions Testing
**الهدف**: +25% Coverage

**المهام**:
1. ✅ Tests لـ `src/core/security.ts` (15 functions)
2. ✅ Tests لـ `src/lib/supabase.ts` (CRUD functions)
3. ✅ Tests لـ `src/lib/` utilities
4. ✅ Setup test mocks و fixtures

**الملفات المستهدفة**:
- `tests/core/security.test.ts` (NEW)
- `tests/lib/supabase.test.ts` (NEW)
- `tests/lib/utils.test.ts` (NEW)

**Coverage المتوقع**: 25%

---

### Week 2: Business Logic Testing
**الهدف**: +35% Coverage (إجمالي: 60%)

**المهام**:
1. ✅ Tests لـ Process Costing calculations
2. ✅ Tests لـ Inventory Valuation (FIFO, LIFO, AVCO)
3. ✅ Tests لـ Manufacturing services
4. ✅ Tests لـ Financial calculations

**الملفات المستهدفة**:
- `tests/domain/process-costing.test.ts` (EXPAND)
- `tests/domain/inventory-valuation.test.ts` (NEW)
- `tests/services/process-costing-service.test.ts` (NEW)
- `tests/services/manufacturing-service.test.ts` (EXPAND)
- `tests/services/purchasing-service.test.ts` (NEW)

**Coverage المتوقع**: 60%

---

### Week 3: Components + Integration Testing
**الهدف**: +20% Coverage (إجمالي: 80%)

**المهام**:
1. ✅ Tests لـ Critical Forms
2. ✅ Tests لـ UI Components
3. ✅ Integration tests للـ workflows
4. ✅ E2E tests للـ critical paths

**الملفات المستهدفة**:
- `tests/components/forms/PurchaseOrderForm.test.tsx` (NEW)
- `tests/components/forms/SupplierInvoiceForm.test.tsx` (NEW)
- `tests/components/forms/GoodsReceiptForm.test.tsx` (NEW)
- `tests/integration/manufacturing-workflow.test.ts` (EXPAND)
- `e2e/critical-paths.spec.ts` (NEW)

**Coverage المتوقع**: 80%

---

### Week 4: Optimization & Polish
**الهدف**: 80%+ Coverage + Quality Improvements

**المهام**:
1. ✅ Fill coverage gaps
2. ✅ Improve test quality
3. ✅ Add edge cases
4. ✅ Performance testing
5. ✅ Documentation

**Coverage المتوقع**: 80%+

---

## 📝 التفاصيل التقنية

### Week 1: Core Functions

#### 1.1 `tests/core/security.test.ts`

**Functions to Test**:
```typescript
// Security Functions (15 functions)
- extractTenantFromJWT()
- parseJWTPayload()
- isValidUUID()
- getCurrentUserWithTenant()
- validateTenantAccess()
- withTenantSecurity()
- createSecureRPC()
- getTenantQuery()
- getSecurityHeaders()
- logSecurityEvent()
- checkRateLimit()
- sanitizeInput()
- validateInput.email()
- validateInput.number()
- validateInput.code()
```

**Test Structure**:
```typescript
describe('Security Utilities', () => {
  describe('sanitizeInput', () => {
    it('should escape single quotes', () => {
      expect(sanitizeInput("test'value")).toBe("test''value")
    })
    
    it('should remove semicolons', () => {
      expect(sanitizeInput("test;value")).toBe("testvalue")
    })
    
    it('should remove SQL comments', () => {
      expect(sanitizeInput("test--comment")).toBe("test")
    })
    
    it('should handle numbers', () => {
      expect(sanitizeInput(123)).toBe("123")
    })
  })
  
  describe('validateInput', () => {
    describe('email', () => {
      it('should validate correct emails', () => {
        expect(validateInput.email('test@example.com')).toBe(true)
      })
      
      it('should reject invalid emails', () => {
        expect(validateInput.email('invalid')).toBe(false)
      })
    })
    
    // ... more tests
  })
  
  // ... more describe blocks
})
```

**Estimated Coverage**: +8%

---

#### 1.2 `tests/lib/supabase.test.ts`

**Functions to Test**:
```typescript
// Supabase CRUD Functions
- createGLAccount()
- updateGLAccount()
- deleteGLAccount()
- getGLAccountById()
- checkAccountCodeExists()
- getAllGLAccounts()
- getEffectiveTenantId()
```

**Test Structure**:
```typescript
describe('Supabase CRUD Functions', () => {
  beforeEach(() => {
    // Mock Supabase client
    vi.mock('@/lib/supabase', () => ({
      getSupabase: () => mockSupabaseClient
    }))
  })
  
  describe('createGLAccount', () => {
    it('should create account with valid data', async () => {
      const account = {
        code: '1000',
        name: 'Cash',
        category: 'ASSET'
      }
      
      const result = await createGLAccount(account)
      
      expect(result).toBeDefined()
      expect(result.code).toBe('1000')
    })
    
    it('should reject duplicate codes', async () => {
      // Test duplicate code handling
    })
  })
  
  // ... more tests
})
```

**Estimated Coverage**: +10%

---

#### 1.3 `tests/lib/utils.test.ts`

**Functions to Test**:
```typescript
// Utility Functions
- formatCurrency()
- formatDate()
- calculatePercentage()
- debounce()
- throttle()
```

**Estimated Coverage**: +7%

---

### Week 2: Business Logic

#### 2.1 `tests/domain/process-costing.test.ts` (EXPAND)

**Current**: Basic tests موجودة

**To Add**:
```typescript
describe('Process Costing Calculations', () => {
  describe('calculateStageCost', () => {
    it('should calculate total cost correctly', () => {
      // Total Cost = Transferred In + Direct Materials + Direct Labor + MOH - Waste Credit
    })
    
    it('should calculate unit cost correctly', () => {
      // Unit Cost = Total Cost / Good Quantity
    })
    
    it('should calculate efficiency correctly', () => {
      // Efficiency = Good Quantity / (Good + Scrap + Rework) × 100%
    })
  })
  
  describe('Multi-stage Cost Flow', () => {
    it('should transfer costs between stages', () => {
      // Test cost transfer logic
    })
  })
})
```

**Estimated Coverage**: +12%

---

#### 2.2 `tests/domain/inventory-valuation.test.ts` (NEW)

**Functions to Test**:
```typescript
// Inventory Valuation
- processIncomingStock() (FIFO, LIFO, AVCO)
- processOutgoingStock() (FIFO, LIFO, AVCO)
- getCurrentRate()
- ValuationFactory.getStrategy()
```

**Test Structure**:
```typescript
describe('Inventory Valuation', () => {
  describe('FIFO Method', () => {
    it('should process incoming stock correctly', async () => {
      const product = {
        stock_quantity: 100,
        cost_price: 10,
        valuation_method: 'FIFO',
        stock_queue: [{ qty: 100, rate: 10 }]
      }
      
      const result = await processIncomingStock(product, 50, 12)
      
      expect(result.newQty).toBe(150)
      expect(result.newQueue.length).toBe(2)
    })
    
    it('should process outgoing stock with FIFO', async () => {
      // Test FIFO outgoing logic
    })
  })
  
  describe('LIFO Method', () => {
    // Similar tests for LIFO
  })
  
  describe('AVCO Method', () => {
    // Similar tests for AVCO
  })
})
```

**Estimated Coverage**: +15%

---

#### 2.3 `tests/services/process-costing-service.test.ts` (NEW)

**Functions to Test**:
```typescript
// Process Costing Service
- calculateProcessCost()
- allocateCosts()
- calculateVariances()
```

**Estimated Coverage**: +8%

---

### Week 3: Components + Integration

#### 3.1 `tests/components/forms/PurchaseOrderForm.test.tsx` (NEW)

**Test Structure**:
```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PurchaseOrderForm } from '@/components/forms/PurchaseOrderForm'

describe('PurchaseOrderForm', () => {
  it('should render form correctly', () => {
    render(<PurchaseOrderForm open={true} onOpenChange={() => {}} />)
    expect(screen.getByText('Purchase Order')).toBeInTheDocument()
  })
  
  it('should validate required fields', async () => {
    // Test form validation
  })
  
  it('should submit form with valid data', async () => {
    // Test form submission
  })
  
  it('should filter products correctly', async () => {
    // Test product search/filter
  })
})
```

**Estimated Coverage**: +5%

---

#### 3.2 Integration Tests

**Test Structure**:
```typescript
describe('Manufacturing Workflow Integration', () => {
  it('should complete full manufacturing cycle', async () => {
    // 1. Create Manufacturing Order
    // 2. Record materials
    // 3. Record labor
    // 4. Record overhead
    // 5. Calculate costs
    // 6. Complete order
  })
})
```

**Estimated Coverage**: +10%

---

#### 3.3 E2E Tests

**Test Structure**:
```typescript
test('Complete Purchase Order Workflow', async ({ page }) => {
  // 1. Login
  // 2. Navigate to Purchasing
  // 3. Create Purchase Order
  // 4. Add items
  // 5. Submit
  // 6. Verify in database
})
```

**Estimated Coverage**: +5%

---

## 🎯 Coverage Targets by File Category

### Core Files (Priority 1)
| File | Current | Target | Priority |
|------|---------|--------|----------|
| `src/core/security.ts` | 0% | 90% | 🔴 Critical |
| `src/lib/supabase.ts` | 0% | 85% | 🔴 Critical |
| `src/lib/utils.ts` | 0% | 80% | 🟡 High |

### Business Logic (Priority 2)
| File | Current | Target | Priority |
|------|---------|--------|----------|
| `src/domain/inventory/valuation.ts` | ~30% | 90% | 🔴 Critical |
| `src/services/process-costing-service.ts` | 0% | 85% | 🔴 Critical |
| `src/services/purchasing-service.ts` | 0% | 80% | 🟡 High |
| `src/services/manufacturing/*.ts` | ~20% | 80% | 🟡 High |

### Components (Priority 3)
| File | Current | Target | Priority |
|------|---------|--------|----------|
| `src/components/forms/PurchaseOrderForm.tsx` | 0% | 70% | 🟡 High |
| `src/components/forms/SupplierInvoiceForm.tsx` | 0% | 70% | 🟡 High |
| `src/components/forms/GoodsReceiptForm.tsx` | 0% | 70% | 🟡 High |

---

## 🛠️ Setup & Configuration

### Test Setup File

**File**: `src/test/setup.ts` (يجب تحديثه)

```typescript
import { vi } from 'vitest'
import '@testing-library/jest-dom'

// Mock Supabase
vi.mock('@/lib/supabase', () => ({
  getSupabase: () => mockSupabaseClient,
  getEffectiveTenantId: () => Promise.resolve('test-tenant-id')
}))

// Mock React Router
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/' })
}))

// Mock i18n
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'ar' }
  })
}))
```

### Test Utilities

**File**: `src/test/utils.ts` (NEW)

```typescript
// Test helpers
export const createMockGLAccount = (overrides = {}) => ({
  id: 'test-id',
  code: '1000',
  name: 'Test Account',
  category: 'ASSET',
  ...overrides
})

export const createMockProduct = (overrides = {}) => ({
  id: 'test-product-id',
  code: 'PROD001',
  name: 'Test Product',
  stock_quantity: 100,
  cost_price: 10,
  valuation_method: 'AVCO',
  ...overrides
})

// ... more mock factories
```

---

## 📈 Coverage Metrics & Tracking

### Weekly Progress Tracking

```markdown
| Week | Target | Actual | Status |
|------|--------|--------|--------|
| Week 1 | 25% | ___% | ⏳ |
| Week 2 | 60% | ___% | ⏳ |
| Week 3 | 80% | ___% | ⏳ |
| Week 4 | 80%+ | ___% | ⏳ |
```

### Coverage Reports

**Commands**:
```bash
# Generate coverage report
npm run test:coverage

# View HTML report
open coverage/index.html

# Check coverage in CI
npm run test:coverage -- --reporter=json
```

### Coverage Thresholds

**File**: `vitest.config.ts` (يجب إضافتها)

```typescript
coverage: {
  thresholds: {
    lines: 80,
    functions: 80,
    branches: 75,
    statements: 80
  }
}
```

---

## ⚠️ المخاطر والتحديات

### المخاطر المحتملة

1. **Time Constraints**
   - **Risk**: قد يستغرق أكثر من 4 أسابيع
   - **Mitigation**: التركيز على Critical paths أولاً

2. **Complex Dependencies**
   - **Risk**: بعض Functions تعتمد على Supabase/Database
   - **Mitigation**: استخدام Mocks و Test Database

3. **Legacy Code**
   - **Risk**: بعض الكود صعب اختباره
   - **Mitigation**: Refactor تدريجي مع Tests

4. **Coverage vs Quality**
   - **Risk**: التركيز على Coverage فقط
   - **Mitigation**: ضمان Test Quality مع Coverage

### التحديات التقنية

1. **Multi-tenant Testing**
   - Challenge: اختبار Tenant isolation
   - Solution: Mock tenant context في كل test

2. **Async Operations**
   - Challenge: Testing async functions
   - Solution: استخدام `waitFor` و `async/await` بشكل صحيح

3. **Database Operations**
   - Challenge: Testing database calls
   - Solution: Mock Supabase client أو استخدام Test Database

---

## ✅ Checklist التنفيذ

### Week 1 Checklist

- [ ] إنشاء `tests/core/security.test.ts`
- [ ] إنشاء `tests/lib/supabase.test.ts`
- [ ] إنشاء `tests/lib/utils.test.ts`
- [ ] تحديث `src/test/setup.ts`
- [ ] إنشاء `src/test/utils.ts` (mock factories)
- [ ] Run tests: `npm run test:coverage`
- [ ] Verify: Coverage ≥ 25%

### Week 2 Checklist

- [ ] Expand `tests/domain/process-costing.test.ts`
- [ ] إنشاء `tests/domain/inventory-valuation.test.ts`
- [ ] إنشاء `tests/services/process-costing-service.test.ts`
- [ ] إنشاء `tests/services/purchasing-service.test.ts`
- [ ] Expand `tests/services/manufacturing-service.test.ts`
- [ ] Run tests: `npm run test:coverage`
- [ ] Verify: Coverage ≥ 60%

### Week 3 Checklist

- [ ] إنشاء `tests/components/forms/PurchaseOrderForm.test.tsx`
- [ ] إنشاء `tests/components/forms/SupplierInvoiceForm.test.tsx`
- [ ] إنشاء `tests/components/forms/GoodsReceiptForm.test.tsx`
- [ ] Expand integration tests
- [ ] إنشاء `e2e/critical-paths.spec.ts`
- [ ] Run tests: `npm run test:coverage`
- [ ] Verify: Coverage ≥ 80%

### Week 4 Checklist

- [ ] Fill coverage gaps
- [ ] Improve test quality
- [ ] Add edge cases
- [ ] Performance testing
- [ ] Update documentation
- [ ] Final verification: Coverage ≥ 80%

---

## 📚 أمثلة على الكود

### Example 1: Security Tests

```typescript
// tests/core/security.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  sanitizeInput,
  validateInput,
  isValidUUID,
  parseJWTPayload
} from '@/core/security'

describe('sanitizeInput', () => {
  it('should escape single quotes', () => {
    expect(sanitizeInput("test'value")).toBe("test''value")
  })
  
  it('should remove semicolons', () => {
    expect(sanitizeInput("test;value")).toBe("testvalue")
  })
  
  it('should remove SQL comments', () => {
    expect(sanitizeInput("test--comment")).toBe("test")
    expect(sanitizeInput("test/*comment*/")).toBe("test")
  })
  
  it('should handle numbers', () => {
    expect(sanitizeInput(123)).toBe("123")
    expect(sanitizeInput(0)).toBe("0")
  })
  
  it('should handle booleans', () => {
    expect(sanitizeInput(true)).toBe("true")
    expect(sanitizeInput(false)).toBe("false")
  })
})

describe('validateInput', () => {
  describe('email', () => {
    it('should validate correct emails', () => {
      expect(validateInput.email('test@example.com')).toBe(true)
      expect(validateInput.email('user.name@domain.co.uk')).toBe(true)
    })
    
    it('should reject invalid emails', () => {
      expect(validateInput.email('invalid')).toBe(false)
      expect(validateInput.email('@example.com')).toBe(false)
      expect(validateInput.email('test@')).toBe(false)
    })
    
    it('should reject emails longer than 254 chars', () => {
      const longEmail = 'a'.repeat(250) + '@example.com'
      expect(validateInput.email(longEmail)).toBe(false)
    })
  })
  
  describe('uuid', () => {
    it('should validate correct UUIDs', () => {
      const validUUID = '123e4567-e89b-12d3-a456-426614174000'
      expect(validateInput.uuid(validUUID)).toBe(true)
    })
    
    it('should reject invalid UUIDs', () => {
      expect(validateInput.uuid('invalid')).toBe(false)
      expect(validateInput.uuid('123')).toBe(false)
    })
  })
  
  describe('code', () => {
    it('should validate correct codes', () => {
      expect(validateInput.code('ABC123')).toBe(true)
      expect(validateInput.code('PROD-001')).toBe(true)
      expect(validateInput.code('item_123')).toBe(true)
    })
    
    it('should reject invalid codes', () => {
      expect(validateInput.code('A')).toBe(false) // Too short
      expect(validateInput.code('A'.repeat(21))).toBe(false) // Too long
      expect(validateInput.code('ABC@123')).toBe(false) // Invalid char
    })
  })
})

describe('isValidUUID', () => {
  it('should validate correct UUIDs', () => {
    expect(isValidUUID('123e4567-e89b-12d3-a456-426614174000')).toBe(true)
    expect(isValidUUID('00000000-0000-0000-0000-000000000000')).toBe(true)
  })
  
  it('should reject invalid UUIDs', () => {
    expect(isValidUUID('invalid')).toBe(false)
    expect(isValidUUID('123')).toBe(false)
    expect(isValidUUID('123e4567-e89b-12d3-a456')).toBe(false) // Incomplete
  })
  
  it('should handle null/undefined', () => {
    expect(isValidUUID(null as any)).toBe(false)
    expect(isValidUUID(undefined as any)).toBe(false)
  })
})
```

### Example 2: Supabase CRUD Tests

```typescript
// tests/lib/supabase.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createGLAccount,
  updateGLAccount,
  deleteGLAccount,
  getGLAccountById,
  checkAccountCodeExists
} from '@/lib/supabase'
import { getSupabase } from '@/lib/supabase'

// Mock Supabase
vi.mock('@/lib/supabase', async () => {
  const actual = await vi.importActual('@/lib/supabase')
  return {
    ...actual,
    getSupabase: () => mockSupabaseClient
  }
})

const mockSupabaseClient = {
  from: vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn(() => Promise.resolve({ data: mockAccount, error: null }))
      }))
    })),
    insert: vi.fn(() => Promise.resolve({ data: [mockAccount], error: null })),
    update: vi.fn(() => ({
      eq: vi.fn(() => Promise.resolve({ data: [mockAccount], error: null }))
    })),
    delete: vi.fn(() => ({
      eq: vi.fn(() => Promise.resolve({ data: [], error: null }))
    }))
  }))
}

const mockAccount = {
  id: 'test-id',
  code: '1000',
  name: 'Cash',
  category: 'ASSET',
  org_id: 'test-org-id'
}

describe('GL Account CRUD', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  
  describe('createGLAccount', () => {
    it('should create account with valid data', async () => {
      const accountData = {
        code: '1000',
        name: 'Cash',
        category: 'ASSET' as const
      }
      
      const result = await createGLAccount(accountData)
      
      expect(result).toBeDefined()
      expect(result.code).toBe('1000')
      expect(mockSupabaseClient.from).toHaveBeenCalledWith('gl_accounts')
    })
    
    it('should reject duplicate codes', async () => {
      // Mock duplicate error
      mockSupabaseClient.from().insert.mockResolvedValueOnce({
        data: null,
        error: { code: '23505', message: 'Duplicate key' }
      })
      
      await expect(createGLAccount({ code: '1000', name: 'Test' }))
        .rejects.toThrow()
    })
  })
  
  describe('updateGLAccount', () => {
    it('should update account successfully', async () => {
      const updates = { name: 'Updated Name' }
      const result = await updateGLAccount('test-id', updates)
      
      expect(result).toBeDefined()
      expect(mockSupabaseClient.from).toHaveBeenCalledWith('gl_accounts')
    })
  })
  
  describe('deleteGLAccount', () => {
    it('should soft delete account', async () => {
      const result = await deleteGLAccount('test-id')
      
      expect(result).toBeDefined()
      // Verify soft delete (is_active = false)
    })
    
    it('should prevent deletion if account has transactions', async () => {
      // Mock account with transactions
      await expect(deleteGLAccount('test-id'))
        .rejects.toThrow('Cannot delete account with transactions')
    })
  })
})
```

### Example 3: Inventory Valuation Tests

```typescript
// tests/domain/inventory-valuation.test.ts
import { describe, it, expect } from 'vitest'
import {
  processIncomingStock,
  processOutgoingStock,
  getCurrentRate
} from '@/domain/inventory/valuation'

describe('Inventory Valuation - FIFO', () => {
  const fifoProduct = {
    id: 'prod-1',
    code: 'PROD001',
    stock_quantity: 100,
    cost_price: 10,
    stock_value: 1000,
    valuation_method: 'FIFO',
    stock_queue: [
      { qty: 50, rate: 10 },
      { qty: 50, rate: 12 }
    ]
  }
  
  it('should process incoming stock with FIFO', async () => {
    const result = await processIncomingStock(fifoProduct, 30, 15)
    
    expect(result.newQty).toBe(130)
    expect(result.newQueue.length).toBe(3)
    expect(result.newQueue[2]).toEqual({ qty: 30, rate: 15 })
  })
  
  it('should process outgoing stock with FIFO (oldest first)', async () => {
    const result = await processOutgoingStock(fifoProduct, 30)
    
    expect(result.newQty).toBe(70)
    expect(result.costOfGoodsSold).toBe(300) // 30 * 10 (oldest batch)
    expect(result.newQueue[0].qty).toBe(20) // 50 - 30
  })
})

describe('Inventory Valuation - AVCO', () => {
  const avcoProduct = {
    id: 'prod-2',
    code: 'PROD002',
    stock_quantity: 100,
    cost_price: 10,
    stock_value: 1000,
    valuation_method: 'Weighted Average',
    stock_queue: []
  }
  
  it('should calculate weighted average for incoming stock', async () => {
    const result = await processIncomingStock(avcoProduct, 50, 12)
    
    // New average = (100*10 + 50*12) / (100+50) = 10.67
    expect(result.newRate).toBeCloseTo(10.67, 2)
    expect(result.newQty).toBe(150)
  })
})
```

---

## 🔄 CI/CD Integration

### GitHub Actions Workflow

**File**: `.github/workflows/test-coverage.yml` (NEW)

```yaml
name: Test Coverage

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run tests with coverage
        run: npm run test:coverage
      
      - name: Upload coverage to SonarQube
        uses: sonarsource/sonarqube-quality-gate-action@master
        env:
          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
      
      - name: Coverage threshold check
        run: |
          COVERAGE=$(npm run test:coverage -- --reporter=json | jq '.coverageMap.total.lines.pct')
          if (( $(echo "$COVERAGE < 80" | bc -l) )); then
            echo "Coverage $COVERAGE% is below 80% threshold"
            exit 1
          fi
```

---

## 📊 Success Metrics

### Coverage Metrics
- ✅ **Lines**: ≥ 80%
- ✅ **Functions**: ≥ 80%
- ✅ **Branches**: ≥ 75%
- ✅ **Statements**: ≥ 80%

### Quality Metrics
- ✅ **Test Pass Rate**: ≥ 99%
- ✅ **Test Execution Time**: < 5 minutes
- ✅ **Flaky Tests**: 0

### Business Metrics
- ✅ **Critical Paths Covered**: 100%
- ✅ **Business Logic Covered**: 90%+
- ✅ **Security Functions Covered**: 100%

---

## 🚀 Quick Start Guide

### Day 1: Setup

```bash
# 1. Verify test setup
npm run test

# 2. Check current coverage
npm run test:coverage

# 3. Create first test file
touch tests/core/security.test.ts

# 4. Copy example from this document
# 5. Run tests
npm run test tests/core/security.test.ts
```

### Day 2-5: Core Functions

```bash
# 1. Create security tests
# 2. Create supabase tests
# 3. Create utils tests
# 4. Run coverage check
npm run test:coverage

# 5. Verify: Coverage ≥ 25%
```

---

## 📝 Notes & Considerations

### Best Practices

1. **Test Naming**: Use descriptive names
   ```typescript
   // ✅ Good
   it('should calculate unit cost correctly when good quantity is zero')
   
   // ❌ Bad
   it('test1')
   ```

2. **Test Organization**: Group related tests
   ```typescript
   describe('sanitizeInput', () => {
     describe('SQL injection prevention', () => {
       // Related tests here
     })
   })
   ```

3. **Mock Strategy**: Mock external dependencies
   ```typescript
   // Mock Supabase, APIs, etc.
   vi.mock('@/lib/supabase')
   ```

4. **Edge Cases**: Always test edge cases
   ```typescript
   it('should handle null input')
   it('should handle empty string')
   it('should handle very large numbers')
   ```

### Common Pitfalls

1. **Testing Implementation Details**: Focus on behavior, not implementation
2. **Over-mocking**: Don't mock everything, only external dependencies
3. **Flaky Tests**: Ensure tests are deterministic
4. **Slow Tests**: Optimize test execution time

---

## 🎯 Final Checklist

### Before Starting

- [ ] Review this plan
- [ ] Verify test framework setup
- [ ] Create test directory structure
- [ ] Setup CI/CD for coverage tracking

### During Execution

- [ ] Track coverage weekly
- [ ] Review test quality
- [ ] Fix failing tests immediately
- [ ] Document any issues

### After Completion

- [ ] Verify 80%+ coverage
- [ ] Review all tests
- [ ] Update documentation
- [ ] Celebrate! 🎉

---

## 📞 Support & Resources

### Documentation
- [Vitest Documentation](https://vitest.dev/)
- [React Testing Library](https://testing-library.com/react)
- [Playwright Documentation](https://playwright.dev/)

### Internal Resources
- `docs/testing-strategy.md` - General testing strategy
- `vitest.config.ts` - Test configuration
- Existing test files - Examples and patterns

---

**تاريخ الإنشاء**: December 10, 2025  
**آخر تحديث**: December 10, 2025  
**الإصدار**: 1.0.0  
**الحالة**: 📋 Ready for Review

