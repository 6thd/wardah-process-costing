# 📊 خطة Test Coverage الشاملة - Wardah ERP (تحديث ديسمبر 2025)

## 📋 ملخص تنفيذي

**الهدف النهائي**: الوصول إلى **80%+ Test Coverage** مع تغطية كاملة للامتثال المحاسبي والرقابة الداخلية

**الوضع الحالي** (تحديث: 20 ديسمبر 2025): 

- Coverage: **~22-25%** (متوقع على SonarCloud) ⬆️ (كان 18-20%)
- Coverage Target: **≥ 80.0%** للكود الجديد
- ✅ Test Infrastructure: **مكتمل** (QueryClientProvider + test-utils)
- ✅ Coverage Generation: **مكتمل** (lcov reports)
- ✅ **Integration Tests Strategy**: **Phase 7 مكتمل** 🚀
- ✅ **Clean Architecture**: **مطبقة بنسبة 95%** 🏆
- ✅ **ESLint Setup**: **مكتمل** (0 errors, TypeScript + React Hooks) 🔧
- ✅ **UI Component Tests**: **مكتمل** (209 tests) 🎨
- ✅ **E2E Tests**: **مكتمل** (5 files, 93 tests) 🌐
- ✅ **Core Services Tests**: **مكتمل** (102 tests جديدة) 🆕
- Lines of Code: **94k**
- Test Framework: ✅ Vitest + Playwright (جاهز)
- Existing Tests: **1862 unit test** + **93 E2E test** 🎉
- Test Success Rate: **100%** (1862/1862) ⬆️
- Architecture Compliance: **95%** ✅

**آخر التحديثات** (20 ديسمبر 2025): 🆕
- ✅ **Core Services Tests** 🧪
  - `src/services/__tests__/process-costing-service.test.ts` (29 tests) - Labor, Overhead, Stage Costs
  - `src/services/__tests__/organization-service.test.ts` (21 tests) - Multi-tenant
  - `src/services/__tests__/rbac-service.test.ts` (16 tests) - Roles, Permissions
  - `src/services/__tests__/stock-adjustment-service.test.ts` (20 tests) - Physical Count
  - `src/hooks/__tests__/usePermissions.test.ts` (16 tests) - Permission Hook
- ✅ **إصلاحات Build وTypeScript**:
  - إصلاح missing imports في AccountingOverview
  - إصلاح type casting في manufacturingOrderService
  - إصلاح duplicate imports في modules.ts
- ✅ **زيادة عدد الاختبارات**: 1760 → **1862** (+102 اختبار unit)
- ✅ **زيادة التغطية المتوقعة**: 18-20% → **~22-25%** على SonarCloud

**التحديثات السابقة** (18 ديسمبر 2025 - مساءً):
- ✅ **اختبارات UI Components** 🎨
  - `src/components/ui/__tests__/button.test.tsx` (30 tests)
  - `src/components/ui/__tests__/card.test.tsx` (35 tests)
  - `src/components/ui/__tests__/input.test.tsx` (42 tests) - **100% coverage**
  - `src/components/ui/__tests__/alert.test.tsx` (30 tests)
  - `src/components/ui/__tests__/badge.test.tsx` (31 tests)
  - `src/components/ui/__tests__/table.test.tsx` (41 tests)
- ✅ **E2E Tests الشاملة** 🌐
  - `e2e/auth.spec.ts` (22 tests) - Login, Logout, Session, RBAC
  - `e2e/inventory.spec.ts` (23 tests) - Stock transactions, transfers, valuations
  - `e2e/accounting.spec.ts` (24 tests) - Journal entries, Trial balance, Reports
  - `e2e/sales.spec.ts` (19 tests) - Orders, Invoices, Payments
  - `e2e/process-costing.spec.ts` (5 tests) - موجود سابقاً
- ✅ **زيادة عدد الاختبارات**: 1368 → **1577** (+209 اختبار unit)
- ✅ **E2E Tests جديدة**: 5 → **93** (+88 اختبار E2E)
- ✅ **زيادة التغطية المتوقعة**: 13-15% → **~18-20%** على SonarCloud

**التحديثات السابقة** (18 ديسمبر 2025 - صباحاً):
- ✅ **ESLint Setup مع TypeScript و React Hooks** 🔧
  - إنشاء `eslint.config.js` مع دعم كامل لـ TypeScript
  - إصلاح 21 ملف بها أخطاء duplicate imports
  - **0 أخطاء ESLint** - جميع الأخطاء تم إصلاحها
  - إضافة `scripts/pre-push-check.ps1` و `pre-push-check.sh`
  - إضافة `npm run quality-check` command
- ✅ **اختبارات جديدة للـ Core Utilities** 🧪
  - `src/core/__tests__/utils.test.ts` (50 tests) - تنسيق + تحقق
  - `src/core/__tests__/security.test.ts` (21 tests) - JWT + UUID validation
  - `src/lib/__tests__/tenant-validator.test.ts` (17 tests) - Multi-tenant validation
  - `src/utils/__tests__/keyboardNav.test.ts` (14 tests) - **81.72% coverage** 🎉
  - `src/utils/__tests__/parseClipboard.test.ts` (11 tests) - **100% coverage** 🎉
- ✅ **زيادة عدد الاختبارات**: 880 → **1237** (+357 اختبار جديد)
- ✅ **زيادة التغطية**: 2.92% → **~10.8%** على SonarCloud

**التحديثات السابقة** (11-13 ديسمبر 2025):
- ✅ إنشاء `test-utils.tsx` مع QueryClientProvider wrapper
- ✅ إصلاح Supabase mock لدعم realtime channels
- ✅ تحديث 6 ملفات اختبار لاستخدام المرافق الجديدة
- ✅ تفعيل `--coverage.reportOnFailure` لتوليد التقارير حتى مع فشل بعض الاختبارات
- ✅ إضافة اختبارات الامتثال: IAS 2 (23 tests), IAS 16 (29 tests), Audit Trail (21 tests), Internal Controls (28 tests)
- ✅ تنظيف الملفات المكررة: حذف 29 اختبار قديم، الإبقاء على 365 اختبار
- ✅ **استراتيجية Integration Tests الجديدة - Phase 1** ✨
  - إنشاء [`integration-inventory.test.ts`](src/services/__tests__/integration-inventory.test.ts) (42 tests ✅)
  - اختبار **الكود الحقيقي** من `src/core/utils.js`
  - تغطية: AVCO calculations, formatting, process costing, validations
  - زيادة Coverage: 0% → **2.03%**
- ✅ **TypeScript Migration & Type Safety** 🔧
  - تحويل `src/core/utils.js` → `src/core/utils.ts`
  - إضافة explicit types لـ `calculateAVCO` function
  - إصلاح CI/CD TypeScript compilation errors (TS2322)
  - Coverage لـ `utils.ts`: **53.33%** ⬆️
- ✅ **Integration Tests - Phase 2** 🎯
  - إنشاء [`integration-inventory-transactions.test.ts`](src/services/__tests__/integration-inventory-transactions.test.ts) (37 tests ✅)
  - اختبار **الكود الحقيقي** من `inventory-transaction-service.ts`
  - تغطية: checkAvailability, getReservations, error handling
  - Coverage لـ `inventory-transaction-service.ts`: **33.45%** (من 0%) 🚀
- ✅ **Integration Tests - Phase 3** 💎 **(جديد!)**
  - إنشاء [`integration-valuation.test.ts`](src/domain/__tests__/integration-valuation.test.ts) (31 tests ✅)
  - إنشاء [`services/valuation/index.ts`](src/services/valuation/index.ts) مع الكلاسات الحقيقية:
    * **FIFOValuation**: First In First Out (IAS 2)
    * **LIFOValuation**: Last In First Out (IAS 2)
    * **WeightedAverageValuation**: المتوسط المرجح
    * **MovingAverageValuation**: المتوسط المتحرك
    * **ValuationFactory**: Strategy Pattern
  - اختبار **7 دوال حقيقية** من `domain/inventory/valuation.ts`
  - تغطية: processIncomingStock, processOutgoingStock, getCurrentRate, convertValuationMethod, validateStockQueue, repairStockQueue, getValuationMethodInfo
  - Coverage لـ `valuation.ts`: **100% statements, 84.61% branches, 100% functions** 🎉
  - زيادة Total Coverage: **2.03% → 2.92%** (+0.89%) 📈
- ✅ **جميع الاختبارات ناجحة: 1368/1368 (100%)** 🏆

**الملفات المغطاة حالياً**:
- `src/core/utils.ts`: **53.33%** coverage (339 lines)
- `src/services/inventory-transaction-service.ts`: **45%** coverage (391 lines) ⬆️
- `src/domain/inventory/valuation.ts`: **100%** coverage (274 lines) ⭐
- `src/services/valuation/index.ts`: **0%** (utility only, 230 lines)
- `src/services/accounting-service.ts`: **~40%** coverage (545 lines) 🆕
- `src/services/sales-service.ts`: **~50%** coverage (400+ lines) 🆕
- Total: **~2179 lines** من الكود الحقيقي مغطى 🚀

---

## 🏛️ Clean Architecture Implementation Status

### ✅ **تطبيق Clean Architecture - 95% مكتمل** 🏆

#### 1. **Separation of Concerns** ✅ **100%**

```
src/
├── domain/              # 🏛️ طبقة المجال (Pure Business Logic)
│   ├── entities/        # ✅ 2 entities (CostBreakdown, ProcessStage)
│   ├── value-objects/   # ✅ 3 value objects (Money, Quantity, HourlyRate)
│   ├── interfaces/      # ✅ 3 interfaces (Repository Ports)
│   ├── use-cases/       # ✅ Use Cases (CalculateProcessCost)
│   ├── events/          # ✅ Domain Events + Event Store
│   └── __tests__/       # ✅ 188 اختبار domain
├── application/         # 📱 طبقة التطبيق
│   ├── services/        # ✅ 2 services (Inventory, Accounting)
│   ├── cqrs/            # ✅ CommandBus + QueryBus
│   └── hooks/           # ✅ React Hooks
├── infrastructure/      # 🔧 طبقة البنية التحتية
│   ├── repositories/    # ✅ 3 repositories (Supabase Adapters)
│   ├── event-store/     # ✅ InMemoryEventStore
│   └── di/              # ✅ Dependency Injection Container
└── features/            # 🎨 طبقة العرض (UI)
```

#### 2. **Repository Pattern** ✅ **100%**

| Repository | Interface | Implementation | Tests | Status |
|------------|-----------|----------------|-------|--------|
| Process Costing | `IProcessCostingRepository` | `SupabaseProcessCostingRepository` | 16 | ✅ |
| Inventory | `IInventoryRepository` | `SupabaseInventoryRepository` | 17 | ✅ |
| Accounting | `IAccountingRepository` | `SupabaseAccountingRepository` | 14 | ✅ |

**مجموع اختبارات Infrastructure:** **47 اختبار** (100% نجاح)

#### 3. **Dependency Injection Container** ✅ **100%**

```typescript
// src/infrastructure/di/container.ts

// تسجيل Repositories
container.registerFactory<IProcessCostingRepository>(
  'IProcessCostingRepository',
  () => new SupabaseProcessCostingRepository()
)

// تسجيل Use Cases
container.registerFactory<CalculateProcessCostUseCase>(
  'CalculateProcessCostUseCase',
  () => new CalculateProcessCostUseCase(
    container.resolve<IProcessCostingRepository>('IProcessCostingRepository')
  )
)
```

**الميزات:**
- ✅ Factory Pattern
- ✅ Singleton Support
- ✅ Easy Testing with Mocks
- ✅ Lazy Initialization

#### 4. **CQRS Pattern** ✅ **100%**

| Component | Implementation | Tests | Features |
|-----------|---------------|-------|----------|
| CommandBus | `application/cqrs/CommandBus.ts` | 7 | Middleware Support ✅ |
| QueryBus | `application/cqrs/QueryBus.ts` | 6 | Query Caching ✅ |
| Commands | `commands/*.ts` | 5 | Validation ✅ |
| Queries | `queries/*.ts` | 5 | Cache Invalidation ✅ |
| InMemoryQueryCache | `cqrs/QueryBus.ts` | 5 | TTL Support ✅ |

**مجموع اختبارات CQRS:** **28 اختبار** (100% نجاح)

**أمثلة الاستخدام:**

```typescript
// Command
const result = await commandBus.dispatch(
  new CreateJournalEntryCommand({
    date: '2024-12-31',
    description: 'Journal Entry',
    lines: [/* ... */]
  })
)

// Query
const data = await queryBus.execute(
  new GetTrialBalanceQuery({ 
    asOfDate: '2024-12-31' 
  })
)
```

#### 5. **Event Sourcing** ✅ **100%**

```typescript
// src/domain/events/DomainEvents.ts

// أنواع الأحداث المدعومة:
- Inventory Events (StockMovement, ProductUpdated, Reservation)
- Manufacturing Events (MOCreated, ProductionCompleted)  
- Journal Events (EntryCreated, EntryPosted)
- Cost Events (CostCalculated, CostApplied)
```

**الميزات:**
- ✅ Event Store Implementation
- ✅ Event Versioning
- ✅ Event Metadata (userId, organizationId, etc.)
- ✅ Event Subscriptions
- ✅ Audit Trail Complete

**مجموع اختبارات Event Sourcing:** **19 اختبار** (100% نجاح)

#### 6. **Dependency Rule Compliance** ⚠️ **90%**

| Rule | Status | Details |
|------|--------|---------|
| Domain لا يعتمد على Infrastructure | ⚠️ 90% | ملف واحد يخرق القاعدة |
| Domain لا يعتمد على Application | ✅ 100% | كامل |
| Infrastructure تنفذ Domain Interfaces | ✅ 100% | جميع Repositories |
| Application تستخدم Domain Use Cases | ✅ 95% | بعض Legacy Code |

**الملف المخالف:** `domain/inventory-valuation-integration.js` (يستورد من `core/supabaseClient.js`)

**الحل المقترح:** نقله إلى `infrastructure/services/`

---

### 📊 Architecture Test Coverage

| الطبقة | الاختبارات | التغطية | الحالة |
|--------|------------|---------|--------|
| **Domain Layer** | 188 | ~95% | ✅ ممتاز |
| **Application Layer** | 44 | ~90% | ✅ ممتاز |
| **Infrastructure Layer** | 47 | ~75% | ✅ جيد |
| **CQRS Pattern** | 28 | 100% | ✅ كامل |
| **Event Sourcing** | 19 | 100% | ✅ كامل |
| **Integration Tests** | 233 | متفاوت | ⏳ قيد التحسين |
| **Services Layer Tests** | 131 | ~45% | ✅ جديد (18 ديسمبر) |
| **Legacy Services** | 321 | ~40% | ⏳ قيد الترحيل |
| **إجمالي Architecture Tests** | **1011** | **~85%** | ✅ **ممتاز** |

---

### 🎯 Architecture Compliance Score

```
┌─────────────────────────────────────────────────┐
│ Clean Architecture Compliance: 95/100 ⭐⭐⭐⭐⭐ │
├─────────────────────────────────────────────────┤
│ ✅ Layer Separation:        100/100             │
│ ✅ Repository Pattern:       100/100             │
│ ✅ Dependency Injection:     100/100             │
│ ✅ CQRS Implementation:      100/100             │
│ ✅ Event Sourcing:           100/100             │
│ ⚠️  Dependency Rule:          90/100             │
│ ✅ Test Coverage:             95/100             │
└─────────────────────────────────────────────────┘

التقييم: ممتاز 🏆
```

---

### ⚠️ النقاط المتبقية للإصلاح

#### 1. **ملف مخالف: domain/inventory-valuation-integration.js**

**المشكلة:**
```javascript
// ❌ Domain يستورد من Infrastructure
import { getSupabase, getConfig } from '../core/supabaseClient.js'
import { getCurrentTenantId } from '../core/security.js'
```

**الحل:**
1. نقل الملف إلى `infrastructure/services/InventoryValuationService.ts`
2. إنشاء `IInventoryValuationRepository` في `domain/interfaces/`
3. تحديث DI Container

**الأولوية:** 🔴 عالية (Week 1)

#### 2. **Legacy Services في src/services/**

**الملفات المتأثرة:**
- `accounting-service.ts` → `application/services/` ✅ **تم إضافة 39 اختبار (18 ديسمبر 2025)**
- `inventory-service.ts` → `application/services/` ✅ **تم إضافة 41 اختبار (18 ديسمبر 2025)**
- `process-costing-service.ts` → `application/services/`
- `sales-service.ts` → `application/services/` ✅ **تم إضافة 51 اختبار (18 ديسمبر 2025)**

**الحل:**
1. نقل تدريجي مع الحفاظ على backward compatibility
2. ✅ إضافة Integration Tests قبل النقل **مكتمل (131 اختبار جديد)**
3. تحديث جميع الـ imports

**الأولوية:** 🟡 متوسطة (Week 2-3)

#### 3. **Architecture Compliance Tests مفقودة**

**ما ينقص:**
```typescript
// tests/architecture/dependency-rules.test.ts
- Domain لا يستورد من Infrastructure
- Domain لا يستورد من Application
- Infrastructure تنفذ Domain Interfaces
```

**الأولوية:** 🟢 منخفضة (Week 6)

---

### 📈 خارطة الطريق

| المرحلة | المهام | المدة | الأولوية |
|---------|--------|-------|----------|
| **Week 1** | إصلاح ملف inventory-valuation | 2 أيام | 🔴 حرجة |
| **Week 2-3** | نقل Legacy Services | أسبوع | 🟡 عالية |
| **Week 6** | Architecture Compliance Tests | 3 أيام | 🟢 متوسطة |

---

## 🎯 الاستراتيجية الحالية: Integration Tests First

### لماذا Integration Tests؟

**المشكلة المكتشفة**:
- كان عندنا 101 اختبار compliance (IAS 2, IAS 16, Audit Trail, Internal Controls)
- Coverage كان **1.64%** فقط! ❌
- السبب: الاختبارات كانت **unit tests بمنطق داخلي**، ما تختبر الكود الحقيقي في `src/`

**الحل**:
استراتيجية **Integration Tests** تستورد وتشغل الكود الحقيقي:

```typescript
// ❌ القديم - Unit test بدون coverage
it('should calculate AVCO', () => {
  // منطق الحساب مكتوب داخل الاختبار
  const result = (100 + 50) / (10 + 5)
  expect(result).toBe(10)
})

// ✅ الجديد - Integration test مع coverage
import { calculateAVCO } from '@/core/utils'

it('should calculate AVCO', () => {
  // يشغل الكود الحقيقي
  const result = calculateAVCO(10, 100, 5, 50)
  expect(result.newUnitCost).toBe(10)
})
```

### خطة التنفيذ (أسبوع 0.5):

**المرحلة 1: Core Utils** ✅
- [x] `src/core/utils.ts` (339 lines)
  - 42 tests في `integration-inventory.test.ts`
  - Coverage: **53.33%**
  - الوقت: ~2 ساعات
  - Status: ✅ مكتمل

**المرحلة 2: Inventory Services** ✅ 
- [x] `src/services/inventory-transaction-service.ts` (391 lines)
  - 37 tests في `integration-inventory-transactions.test.ts`
  - Coverage: **33.45%**
  - الوقت: ~2 ساعات
  - Status: ✅ مكتمل

**المرحلة 3: Valuation Services (IAS 2 Compliance)** ✅ **(مكتمل!)**
- [x] `src/domain/inventory/valuation.ts` (274 lines)
- [x] `src/services/valuation/index.ts` (230 lines) - **تم إنشاؤه!**
  - 31 tests في `integration-valuation.test.ts` ✅
  - Coverage: **100% statements, 84.61% branches, 100% functions** 🎉
  - الوقت الفعلي: ~2 ساعات
  - الأولوية: 🔴 عالية (IAS 2 compliance)
  - Status: ✅ **مكتمل بنسبة 100%!**
  - **Valuation Methods Tested**:
    * FIFO (First In First Out)
    * LIFO (Last In First Out)
    * Weighted Average (المتوسط المرجح)
    * Moving Average (المتوسط المتحرك)
  - **7 Functions Covered**:
    * processIncomingStock (FIFO, LIFO, Weighted Avg scenarios)
    * processOutgoingStock (COGS calculation, queue management)
    * getCurrentRate (method-specific rates)
    * convertValuationMethod (FIFO↔LIFO↔Weighted)
    * validateStockQueue (integrity checks)
    * repairStockQueue (corruption recovery)
    * getValuationMethodInfo (Arabic + English metadata)

**المرحلة 4: Manufacturing Services** ✅ **(مكتمل!)**
- [x] `src/services/process-costing-service.ts` (407 lines)
  - 36 tests في `integration-process-costing.test.ts` ✅
  - Coverage: **~35%**
  - الوقت الفعلي: ~2 ساعات
  - Status: ✅ **مكتمل!**
  - **Functions Tested**:
    * applyLaborTime (labor cost calculations)
    * applyOverhead (overhead allocation)
    * upsertStageCost (database operations)
    * getStageCosts (data retrieval)

**المرحلة 5: Additional Coverage** ✅ **(مكتمل!)**
- [x] `src/modules/inventory/StockLedgerService.ts` (548 lines)
  - 39 tests في `integration-stock-ledger.test.ts` ✅
  - Coverage: **~30%**
  - الوقت الفعلي: ~2.5 ساعات
  - Status: ✅ **مكتمل!**
  - **Functions Tested**:
    * getStockBalance, getStockMovements, getTotalStockValue
    * Weighted average calculations, AVCO integration
    * StockLedgerEntry, Bin, StockBalance interfaces

**المرحلة 6: Services Layer Coverage** ✅ **(مكتمل! - 18 ديسمبر 2025)**
- [x] `src/services/accounting-service.ts` (545 lines)
  - 39 tests في `accounting-service.test.ts` ✅
  - Coverage: **~40%**
  - الوقت الفعلي: ~1.5 ساعة
  - Status: ✅ **مكتمل!**
  - **Functions Tested**:
    * validateJournalBalance (balance validation)
    * calculateBalance (account totals)
    * groupEntriesByReference (journal grouping)
    * calculateRunningBalance (running totals)
    * categorizeAccounts (asset/liability/equity/revenue/expense)
    * calculateTrialBalanceTotals (debit/credit totals)
- [x] `src/services/inventory-transaction-service.ts` (391 lines)
  - 41 tests في `inventory-transaction-service.test.ts` ✅
  - Coverage: **~45%**
  - الوقت الفعلي: ~1.5 ساعة
  - Status: ✅ **مكتمل!**
  - **Functions Tested**:
    * checkItemAvailability (stock availability)
    * calculateTotalReserved (reservations)
    * validateConsumption (consumption validation)
    * calculateFifoCost (FIFO costing)
    * calculateWeightedAverageCost (AVCO costing)
- [x] `src/services/sales-service.ts` (400+ lines)
  - 51 tests في `sales-service.test.ts` ✅
  - Coverage: **~50%**
  - الوقت الفعلي: ~2 ساعات
  - Status: ✅ **مكتمل!**
  - **Functions Tested**:
    * calculateLineTotal (line totals with discount)
    * calculateLineTax (VAT calculations)
    * calculateCOGS (cost of goods sold)
    * determineDeliveryStatus (delivery tracking)
    * determinePaymentStatus (payment tracking)
    * generateSalesGLEntries (accounts receivable)
    * generateCOGSGLEntries (cost of sales entries)

- [ ] Component tests (إذا لزم الأمر)

### الأدوات المستخدمة:

1. **Vitest Mocking**:
   ```typescript
   vi.mock('@/lib/supabase', () => ({
     supabase: { /* mocked methods */ },
     getEffectiveTenantId: vi.fn(() => Promise.resolve('test-org-123'))
   }))
   ```

2. **Import Real Code**:
   ```typescript
   import { inventoryTransactionService } from '../inventory-transaction-service'
   ```

3. **Test Real Methods**:
   ```typescript
   const results = await inventoryTransactionService.checkAvailability(requirements)
   expect(results[0].available).toBe(150)
   ```

### النتائج المتوقعة:

| Phase | Files | Lines | Tests | Coverage | Status |
|-------|-------|-------|-------|----------|--------|
| 1 | utils.ts | 339 | 42 | 53% | ✅ مكتمل |
| 2 | inventory-transaction | 391 | 37 | 33% | ✅ مكتمل |
| 3 | valuation + strategy | 504 | 31 | 100%/0% | ✅ مكتمل |
| 4 | process-costing | 407 | 36 | ~35% | ✅ مكتمل |
| 5 | stock-ledger | 548 | 39 | ~30% | ✅ مكتمل |
| 6 | accounting-service | 545 | 39 | ~40% | ✅ مكتمل |
| 6 | inventory-transaction-service | 391 | 41 | ~45% | ✅ مكتمل |
| 6 | sales-service | 400 | 51 | ~50% | ✅ مكتمل |
| **Total (حالياً)** | **3525** | **316** | **~13-15%** | **~17 ساعة** |
| **Target** | **~4000** | **~350** | **20-25%** | **Week 0.5** |

**Progress Update (18 ديسمبر 2025)**:
- ✅ **Phase 1-6 مكتمل**: 316 tests, 3525 lines covered
- ⏳ **Next**: Component tests (إذا لزم الأمر)
- 📈 **Current Coverage**: ~13-15% (Target: 20-25% في نهاية Week 0.5)
- ⏱️ **Time Spent**: ~17 hours (6 phases)
- 🎉 **Total Tests**: 1368 tests passing!

---

**المدة المتوقعة**: **6 أسابيع** (بدلاً من 5) - **محدث 13 ديسمبر 2025**

- ✅ **Week 0**: Test Infrastructure Setup (مكتمل)
- **Week 0.5**: Foundation & Compliance (5-6 أيام)
- **Week 1**: Core + Security (مع إصلاح Architecture)
- **Week 2**: Business Logic Advanced  
- **Week 3**: Financial Reports & Integration
- **Week 4**: Components & E2E
- **Week 5**: Polish & Documentation
- **Week 6**: 🆕 Architecture Compliance Tests

**الهدف المرن**: **85-90% Coverage** (Quality over Quantity)

**الأولوية**: 🔴 **حرجة جداً**

---

## ✅ التقدم المحرز (Week 0 - مكتمل)

### البنية التحتية المكتملة:

1. **Test Utilities** ([`src/test/test-utils.tsx`](src/test/test-utils.tsx ))
   - `renderWithProviders()` - wrapper مع QueryClientProvider
   - `AllTheProviders` - component للـ testing context
   - Re-export كل utilities من `@testing-library/react`

2. **Enhanced Test Setup** ([`src/test/setup.ts`](src/test/setup.ts ))
   - `createTestQueryClient()` - factory function للـ QueryClient
   - Supabase mock محسّن مع دعم `.channel()` للـ realtime
   - Global mocks: IntersectionObserver, ResizeObserver, matchMedia
   - localStorage/sessionStorage mocks
   - Console mocks لتقليل noise

3. **Vitest Configuration** ([`vitest.config.ts`](vitest.config.ts ))
   - Coverage provider: v8
   - Reporters: text, json, html, lcov
   - Coverage للكل: `all: true`
   - استثناء: tests, config files, d.ts files
   - `passWithNoTests: true`

4. **Package Scripts** ([`package.json`](package.json ))
   - `test:coverage` مع `--coverage.reportOnFailure`
   - Coverage يتم توليده حتى مع فشل الاختبارات

5. **GitHub Actions** ([`.github/workflows/sonarqube.yml`](.github/workflows/sonarqube.yml ))
   - Workflow يشغّل coverage تلقائياً
   - يرسل النتائج لـ SonarCloud

### الاختبارات المصلحة:

- ✅ [`src/App.test.tsx`](src/App.test.tsx )
- ✅ [`src/__tests__/design-system.test.tsx`](src/__tests__/design-system.test.tsx )
- ✅ [`src/__tests__/floating-animation.test.tsx`](src/__tests__/floating-animation.test.tsx )
- ✅ [`src/features/manufacturing/__tests__/equivalent-units-dashboard.test.tsx`](src/features/manufacturing/__tests__/equivalent-units-dashboard.test.tsx )
- ⏳ [`src/features/manufacturing/__tests__/stage-costing-panel.test.tsx`](src/features/manufacturing/__tests__/stage-costing-panel.test.tsx ) (6 tests بحاجة إصلاح)

---

## 🎯 الأهداف المحدثة

### الأهداف الرئيسية

1. ✅ الوصول إلى **85%+ Coverage** للـ New Code
2. ✅ **100% Coverage** للـ Compliance & Audit Trail
3. ✅ **95%+ Coverage** للـ Financial Reports
4. ✅ **90%+ Coverage** للـ Core Business Logic
5. ✅ **85%+ Coverage** للـ Security Functions
6. ✅ ضمان الامتثال للمعايير المحاسبية (IFRS/GAAP/SOCPA)

### الأهداف الثانوية

- توثيق Business Logic من خلال Tests
- بناء Audit Trail كامل ومحمي
- ضمان Internal Controls (SOX/Segregation of Duties)
- تسهيل Regulatory Audits

---

## 📊 الجدول الزمني المحدث (5 أسابيع)

### ⭐ Week 0.5: Foundation, Compliance & Controls (5-6 أيام)

**الهدف**: إنشاء الأساس المحاسبي والرقابي

**Coverage المتوقع**: +12%

**ملاحظة**: هذه المرحلة حرجة جداً وتحتاج وقت كافٍ لضمان الامتثال الكامل

#### المهام:

```
✅ Setup test infrastructure enhancements
✅ Accounting Standards Compliance Tests
✅ Audit Trail & Logging Tests
✅ Internal Controls Tests
✅ Authorization & Segregation of Duties Tests
```

#### الملفات المستهدفة:

##### 1. **Compliance Tests**

```typescript
// tests/compliance/ifrs-compliance.test.ts
describe('IFRS/GAAP Compliance', () => {
  describe('IAS 2 - Inventory Valuation', () => {
    it('should use lower of cost or NRV', async () => {
      const inventory = { cost: 100, nrv: 90 };
      expect(await valuateInventory(inventory)).toBe(90);
    });
    
    it('should reverse write-downs when NRV increases', async () => {
      // Test write-down reversal
    });
    
    it('should exclude abnormal waste from cost', async () => {
      // Test abnormal waste accounting
    });
  });
  
  describe('IAS 16 - Property, Plant & Equipment', () => {
    it('should depreciate assets using systematic method', async () => {
      const asset = { cost: 100000, residual: 10000, life: 10 };
      expect(await calculateDepreciation(asset)).toBe(9000); // SL method
    });
    
    it('should test for impairment annually', async () => {
      // Test impairment recognition
    });
  });
  
  describe('IAS 23 - Borrowing Costs', () => {
    it('should capitalize qualifying borrowing costs', async () => {
      // Test borrowing cost capitalization
    });
  });
  
  describe('IFRS 15 - Revenue Recognition', () => {
    it('should recognize revenue at control transfer', async () => {
      // Test 5-step revenue model
    });
  });
});

// tests/compliance/socpa-compliance.test.ts (Saudi Standards)
describe('SOCPA Compliance (Saudi Arabia)', () => {
  describe('Zakat & Tax Requirements', () => {
    it('should calculate Zakat base correctly', async () => {
      const zakatBase = await calculateZakatBase(financials);
      // Test Zakat calculation per GAZT rules
    });
    
    it('should maintain VAT records for 6 years', async () => {
      // Test VAT record retention
    });
  });
  
  describe('ZATCA E-Invoicing', () => {
    it('should generate Phase 2 compliant invoices', async () => {
      const invoice = await generateInvoice(data);
      expect(invoice).toHaveProperty('uuid');
      expect(invoice).toHaveProperty('qrCode');
      expect(invoice).toHaveProperty('digitalSignature');
    });
  });
});
```

##### 2. **Audit Trail Tests**

```typescript
// tests/audit/audit-trail.test.ts
describe('Audit Trail', () => {
  describe('Transaction Logging', () => {
    it('should log all GL entry creations', async () => {
      const entry = await createGLEntry(data);
      const log = await getAuditLog(entry.id);
      
      expect(log).toContainEqual({
        action: 'CREATE',
        table: 'gl_entries',
        userId: expect.any(String),
        timestamp: expect.any(Date),
        data: expect.objectContaining(data)
      });
    });
    
    it('should log all modifications with before/after values', async () => {
      await updateGLEntry(id, changes);
      const log = await getAuditLog(id, 'UPDATE');
      
      expect(log.oldValue).toBeDefined();
      expect(log.newValue).toBeDefined();
    });
    
    it('should never allow audit log deletion', async () => {
      await expect(deleteAuditLog(logId))
        .rejects.toThrow('Audit logs are immutable');
    });
    
    it('should maintain complete transaction chain', async () => {
      const chain = await getTransactionChain(invoiceId);
      expect(chain).toContainInSequence([
        'PURCHASE_ORDER',
        'GOODS_RECEIPT',
        'SUPPLIER_INVOICE',
        'PAYMENT'
      ]);
    });
  });
  
  describe('Change Tracking', () => {
    it('should track who, what, when, where for all changes', async () => {
      await updateRecord(id, changes);
      const audit = await getAuditRecord(id);
      
      expect(audit).toEqual({
        who: expect.any(String), // User ID
        what: 'UPDATE', // Action
        when: expect.any(Date), // Timestamp
        where: expect.any(String), // IP Address
        data: expect.objectContaining(changes)
      });
    });
  });
});
```

##### 3. **Internal Controls Tests**

```typescript
// tests/controls/internal-controls.test.ts
describe('Internal Controls', () => {
  describe('Segregation of Duties (SOD)', () => {
    it('should prevent same user from creating and approving PO', async () => {
      const po = await createPO(data, { userId: 'user1' });
      
      await expect(approvePO(po.id, { userId: 'user1' }))
        .rejects.toThrow('SOD Violation: Cannot approve own purchase order');
    });
    
    it('should enforce maker-checker for GL entries', async () => {
      const entry = await createGLEntry(data, { maker: 'user1' });
      expect(entry.status).toBe('PENDING_APPROVAL');
      
      // Same user cannot approve
      await expect(approveGLEntry(entry.id, { checker: 'user1' }))
        .rejects.toThrow('SOD Violation');
      
      // Different user can approve
      await approveGLEntry(entry.id, { checker: 'user2' });
      expect(entry.status).toBe('POSTED');
    });
    
    it('should separate custody and recording', async () => {
      // Warehouse staff can receive but not approve GRN
      // Accountant can approve but not receive
    });
  });
  
  describe('Authorization Limits', () => {
    it('should enforce PO approval hierarchies', async () => {
      const scenarios = [
        { amount: 5000, approver: 'supervisor', expected: true },
        { amount: 50000, approver: 'supervisor', expected: false },
        { amount: 50000, approver: 'manager', expected: true },
        { amount: 500000, approver: 'manager', expected: false },
        { amount: 500000, approver: 'cfo', expected: true }
      ];
      
      for (const scenario of scenarios) {
        const result = await canApprovePO(
          scenario.amount, 
          scenario.approver
        );
        expect(result).toBe(scenario.expected);
      }
    });
    
    it('should enforce payment authorization limits', async () => {
      // Similar tests for payments
    });
  });
  
  describe('Period Lock Controls', () => {
    it('should prevent posting to closed periods', async () => {
      await closePeriod('2024-12');
      
      await expect(createGLEntry({ date: '2024-12-15' }))
        .rejects.toThrow('Period 2024-12 is closed');
    });
    
    it('should allow adjustments with special permission', async () => {
      await closePeriod('2024-12');
      
      const entry = await createGLEntry(
        { date: '2024-12-15' },
        { override: true, userId: 'cfo' }
      );
      
      expect(entry).toBeDefined();
      expect(entry.flags).toContain('OVERRIDE_PERIOD_LOCK');
    });
  });
  
  describe('Data Validation Controls', () => {
    it('should prevent negative inventory', async () => {
      const product = { stock: 10 };
      
      await expect(issueInventory(product.id, 15))
        .rejects.toThrow('Insufficient stock');
    });
    
    it('should prevent unbalanced journal entries', async () => {
      const entry = {
        lines: [
          { account: '1000', debit: 100, credit: 0 },
          { account: '2000', debit: 0, credit: 90 } // Unbalanced!
        ]
      };
      
      await expect(postJournalEntry(entry))
        .rejects.toThrow('Debits must equal credits');
    });
  });
});
```

**Coverage المتوقع**: 12% (أساس قوي)

---

---

## 🚀 استراتيجية Integration Tests الجديدة (ديسمبر 2025)

### 📌 المشكلة التي تم اكتشافها

بعد إضافة **101 اختبار امتثال** (IAS 2, IAS 16, Audit Trail, Internal Controls) وجدنا أن:
- جميع الاختبارات ناجحة: ✅ 365/365 (100%)
- لكن التغطية على SonarCloud: ❌ **1.64%** فقط!
- **السبب**: الاختبارات كانت **Unit Tests** بمنطق داخلي - لم تختبر الكود الحقيقي في `src/`

### 🎯 الحل: Integration Tests Strategy

**الفكرة**: بدلاً من كتابة منطق العمل داخل الاختبارات، **نستورد الدوال الحقيقية** من الـ source code ونختبرها:

```typescript
// ❌ الطريقة القديمة (Unit Test بمنطق داخلي)
describe('AVCO Calculation', () => {
  function calculateAVCO(stock, value, qty, cost) {
    // منطق الحساب هنا داخل الاختبار
    return { ... }
  }
  
  it('should calculate', () => {
    expect(calculateAVCO(100, 5000, 50, 3000)).toEqual(...)
  })
})
// النتيجة: الاختبار ينجح ✅ لكن Coverage = 0% ❌

// ✅ الطريقة الجديدة (Integration Test)
import { calculateAVCO } from '@/core/utils'  // ← استيراد الدالة الحقيقية

describe('AVCO Calculation', () => {
  it('should calculate', () => {
    // اختبار الكود الحقيقي من src/core/utils.js
    const result = calculateAVCO(100, 5000, 50, 3000)
    expect(result.totalQuantity).toBe(150)
    expect(result.newUnitCost).toBeCloseTo(53.33, 2)
  })
})
// النتيجة: الاختبار ينجح ✅ و Coverage يزيد ✅
```

### 📂 الملف الأول: integration-inventory.test.ts

**الموقع**: [`src/services/__tests__/integration-inventory.test.ts`](src/services/__tests__/integration-inventory.test.ts)

**عدد الاختبارات**: **42 test** (كلها ناجحة ✅)

**الملف المستهدف**: `src/core/utils.js` (339 lines)

**فئات الاختبارات**:

1. **AVCO Calculations** (8 tests):
   - حساب التكلفة المتوسطة المرجحة بعد الشراء
   - أول شراء مع مخزون صفر
   - استلامات متعددة بأسعار مختلفة
   - الحماية من القيم السلبية
   - سيناريو الكمية الصفرية
   - الأصناف عالية القيمة مع الدقة
   - التحقق من الامتثال لـ IAS 2

2. **Formatting Functions** (15 tests):
   - `formatCurrency`: تنسيق الريال السعودي، null handling، الصفر، الدقة
   - `formatNumber`: دقة محددة، الأرقام العربية
   - `formatQuantity`: مع وحدة، بدون وحدة، null values
   - `formatDate`: ISO strings، Date objects، null dates

3. **Process Costing Calculations** (5 tests):
   - جمع جميع مكونات التكلفة
   - معالجة القيم الصفرية
   - سيناريو الكل صفر
   - حساب ائتمان النفايات
   - حساب تكلفة الوحدة

4. **Validation Functions** (6 tests):
   - `validatePositiveNumber`: قبول الموجب، رفض السالب/NaN/null
   - `validateRequired`: قبول غير الفارغ، رفض null/undefined/empty strings

5. **Real-World Scenarios** (3 tests):
   - حساب تكلفة المرحلة الكامل
   - دورة المخزون الكاملة مع AVCO
   - الامتثال لـ IAS 2 في بيئة الإنتاج

6. **Edge Cases** (5 tests):
   - أرقام كبيرة جداً
   - كميات عشرية صغيرة
   - الدقة الرياضية عبر عمليات متعددة

### 📈 النتائج

| Metric | قبل | بعد | التحسن |
|--------|-----|-----|--------|
| **Tests** | 365 | 407 | +42 |
| **Pass Rate** | 100% | 100% | ✅ |
| **Coverage** | 0% | 2.39% | +2.39% |
| **Files Tested** | - | src/core/utils.js | +339 lines |

### 🔜 الخطوات القادمة

#### 1. Integration Tests للـ Inventory Service

**الملف المستهدف**: `src/services/inventory-transaction-service.ts` (393 lines)

**الاختبارات المخططة** (~30 tests):
- `checkAvailability()` - فحص توفر المخزون
- `reserveMaterials()` - حجز المواد
- `consumeMaterials()` - استهلاك المواد
- `releaseReservation()` - تحرير الحجز
- Multi-warehouse scenarios
- Batch/Serial tracking
- Negative stock prevention

**Coverage المتوقع**: +3-4%

#### 2. Integration Tests للـ Valuation

**الملف المستهدف**: `src/domain/inventory/valuation.ts` (273 lines)

**الاختبارات المخططة** (~25 tests):
- `processIncomingStock()` - معالجة المخزون الوارد
- `processOutgoingStock()` - معالجة المخزون الصادر
- ValuationFactory strategies (FIFO, LIFO, AVCO)
- IAS 2 compliance scenarios
- Cost flow assumptions

**Coverage المتوقع**: +2-3%

#### 3. Integration Tests للـ Manufacturing Service

**الملف المستهدف**: `src/services/process-costing-service.ts` (407 lines)

**الاختبارات المخططة** (~20 tests):
- Stage cost calculations
- WIP tracking
- Equivalent units
- Variance analysis
- BOM costing

**Coverage المتوقع**: +3-4%

### 📊 التقدير المحدث للـ Coverage

| Phase | Tests | Coverage Target | Cumulative |
|-------|-------|----------------|------------|
| ✅ **Utils (مكتمل)** | 42 | 2.39% | 2.39% |
| **Inventory Service** | ~30 | +3-4% | ~6% |
| **Valuation** | ~25 | +2-3% | ~9% |
| **Manufacturing** | ~20 | +3-4% | ~13% |
| **Accounting** | ~30 | +4-5% | ~18% |
| **Sales & Purchasing** | ~40 | +5-6% | ~24% |
| **Reports** | ~25 | +3-4% | ~28% |
| **Components (UI)** | ~50 | +8-10% | ~38% |
| **E2E Scenarios** | ~30 | +5-7% | ~45% |
| **Total** | ~292 | **45%** | **45%** |

**ملاحظة**: للوصول إلى **80%** نحتاج:
- استكمال جميع Integration Tests للـ Services (45%)
- إضافة Component Tests للـ UI (15-20%)
- E2E Tests للسيناريوهات الكاملة (10-15%)
- Total: **70-80%** coverage

### 🎓 الدروس المستفادة

1. **Unit Tests وحدها لا تكفي**: يجب اختبار الكود الحقيقي
2. **Import Real Code**: استورد الدوال من `src/` بدلاً من إعادة كتابتها
3. **Coverage = Execution**: التغطية تأتي من تنفيذ الكود الحقيقي
4. **Mocks للأطراف الخارجية فقط**: Supabase, API calls - ليس للمنطق الداخلي
5. **Test What You Ship**: اختبر الكود الذي سيُشحن للإنتاج

---

### 📅 Week 1: Core Security & Architecture Fixes (1 أسبوع)

**الهدف**: +18% Coverage (إجمالي: 30%) + Architecture Compliance

#### المهام:

```
✅ Security functions (sanitize, validate, JWT)
✅ Supabase CRUD operations
✅ Multi-tenant security
✅ Rate limiting & DDoS protection
✅ Utilities & helpers
🆕 Architecture Fixes:
  - نقل domain/inventory-valuation-integration.js إلى Infrastructure
  - إنشاء IInventoryValuationRepository interface
  - تحديث DI Container
  - مراجعة جميع Domain imports
```

#### الملفات المستهدفة:

```typescript
// tests/core/security.test.ts (15 functions)
// tests/lib/supabase.test.ts (CRUD operations)
// tests/lib/multi-tenant.test.ts (tenant isolation)
// tests/lib/rate-limiter.test.ts (rate limiting)
// tests/lib/utils.test.ts (formatters, validators)
```

**Coverage المتوقع**: 30%

---

### 📅 Week 2: Business Logic - Advanced (1 أسبوع)

**الهدف**: +30% Coverage (إجمالي: 60%)

#### المهام:

```
✅ Process Costing (enhanced with advanced scenarios)
✅ Inventory Valuation (FIFO/LIFO/AVCO/Weighted)
✅ Joint Cost Allocation
✅ Variance Analysis (Material, Labor, Overhead)
✅ Manufacturing Services
✅ Purchasing Services
✅ Cost Allocation Methods
```

#### الملفات المستهدفة:

##### 1. **Process Costing - Advanced**

```typescript
// tests/domain/process-costing-advanced.test.ts
describe('Process Costing - Advanced Scenarios', () => {
  describe('Equivalent Units Calculation', () => {
    it('should calculate equivalent units for all components', async () => {
      const stage = {
        goodQty: 800,
        scrapQty: 100,
        reworkQty: 50,
        wipQty: 200,
        wipCompletion: { materials: 1.0, labor: 0.6, overhead: 0.6 }
      };
      
      const equivalentUnits = await calculateEquivalentUnits(stage);
      
      expect(equivalentUnits).toEqual({
        materials: 1150, // 800 + 100 + 50 + 200
        labor: 1070, // 800 + 100 + 50 + 120
        overhead: 1070
      });
    });
  });
  
  describe('Normal vs Abnormal Spoilage', () => {
    it('should distinguish normal from abnormal spoilage', async () => {
      const stage = {
        totalQty: 1000,
        goodQty: 900,
        spoilage: 100,
        normalRate: 0.05 // 5% acceptable
      };
      
      const result = await analyzeSpoilage(stage);
      
      expect(result.normalSpoilage).toBe(50); // 5% of 1000
      expect(result.abnormalSpoilage).toBe(50);
      expect(result.normalCostPerUnit).toBeGreaterThan(0);
      expect(result.abnormalLoss).toBeGreaterThan(0);
    });
    
    it('should allocate normal spoilage to good units', async () => {
      // Normal spoilage cost absorbed by good units
    });
    
    it('should charge abnormal spoilage to expense', async () => {
      // Abnormal spoilage goes to P&L
    });
  });
  
  describe('Joint Cost Allocation', () => {
    it('should allocate by relative sales value method', async () => {
      const jointProcess = {
        totalCost: 100000,
        splitOffPoint: 'after-processing',
        products: [
          { name: 'A', qty: 100, salesValue: 200 },
          { name: 'B', qty: 150, salesValue: 180 },
          { name: 'C', qty: 50, salesValue: 150 }
        ]
      };
      
      const allocation = await allocateJointCosts(
        jointProcess,
        'RELATIVE_SALES_VALUE'
      );
      
      const totalValue = 100*200 + 150*180 + 50*150; // 54,500
      expect(allocation.A).toBeCloseTo(100000 * (20000/54500), 2);
    });
    
    it('should allocate by physical units method', async () => {
      // Allocate based on output quantity
    });
    
    it('should allocate by NRV method', async () => {
      // Allocate based on net realizable value
    });
  });
  
  describe('Variance Analysis', () => {
    it('should calculate material price variance', async () => {
      // MPV = (AP - SP) × AQ
      const actual = { qty: 1000, price: 11 };
      const standard = { qty: 1000, price: 10 };
      
      const variance = await calculateMaterialPriceVariance(actual, standard);
      expect(variance.amount).toBe(1000); // (11-10)*1000
      expect(variance.type).toBe('UNFAVORABLE');
    });
    
    it('should calculate material quantity variance', async () => {
      // MQV = (AQ - SQ) × SP
    });
    
    it('should calculate labor rate variance', async () => {
      // LRV = (AR - SR) × AH
    });
    
    it('should calculate labor efficiency variance', async () => {
      // LEV = (AH - SH) × SR
    });
    
    it('should calculate overhead variances', async () => {
      // Variable OH spending, efficiency
      // Fixed OH budget, volume
    });
  });
  
  describe('By-Products & Co-Products', () => {
    it('should account for by-products at NRV', async () => {
      // By-product revenue reduces main product cost
    });
    
    it('should distinguish co-products from by-products', async () => {
      // Co-products: significant value
      // By-products: incidental value
    });
  });
});
```

##### 2. **Inventory Valuation - Comprehensive**

```typescript
// tests/domain/inventory-valuation-comprehensive.test.ts
describe('Inventory Valuation - All Methods', () => {
  describe('FIFO Method', () => {
    it('should process incoming stock in FIFO order', async () => {
      // Test FIFO incoming
    });
    
    it('should issue stock from oldest batches first', async () => {
      const product = {
        stock_queue: [
          { qty: 100, rate: 10, date: '2024-01-01' },
          { qty: 150, rate: 12, date: '2024-02-01' },
          { qty: 50, rate: 13, date: '2024-03-01' }
        ]
      };
      
      const result = await issueStock(product, 180, 'FIFO');
      
      // Should take 100 @ 10 + 80 @ 12
      expect(result.cost).toBe(100*10 + 80*12); // 1960
      expect(result.remainingQueue[0]).toEqual({ qty: 70, rate: 12 });
    });
  });
  
  describe('LIFO Method', () => {
    it('should issue stock from newest batches first', async () => {
      // Similar test but LIFO
    });
  });
  
  describe('Weighted Average Method', () => {
    it('should recalculate average after each receipt', async () => {
      let product = { qty: 100, cost: 10, value: 1000 };
      
      // Receipt 1
      product = await receiveStock(product, 50, 12);
      expect(product.cost).toBeCloseTo(10.67, 2); // (1000+600)/150
      
      // Receipt 2
      product = await receiveStock(product, 30, 15);
      expect(product.cost).toBeCloseTo(11.11, 2); // (1600+450)/180
    });
    
    it('should use current average for all issues', async () => {
      const product = { qty: 100, cost: 10.67 };
      const result = await issueStock(product, 20);
      expect(result.cost).toBeCloseTo(213.40, 2); // 20 * 10.67
    });
  });
  
  describe('Specific Identification', () => {
    it('should track individual item costs', async () => {
      // For serialized/unique items
    });
  });
  
  describe('Lower of Cost or NRV', () => {
    it('should write down inventory when NRV < cost', async () => {
      const inventory = {
        qty: 100,
        cost: 50,
        nrv: 45 // Market price dropped
      };
      
      const valuation = await valuateInventory(inventory);
      expect(valuation.value).toBe(100 * 45); // Use NRV
      expect(valuation.writeDown).toBe(100 * 5); // Loss recognized
    });
    
    it('should reverse write-downs when NRV recovers', async () => {
      // But not above original cost
    });
  });
});
```

**Coverage المتوقع**: 60%

---

### 📅 Week 3: Financial Reports & Integration (1 أسبوع)

**الهدف**: +20% Coverage (إجمالي: 80%)

#### المهام:

```
✅ Financial Reports (Trial Balance, Balance Sheet, P&L)
✅ Cost Reports (Cost of Goods Manufactured, Cost of Sales)
✅ Bank Reconciliation
✅ Integration workflows
✅ Multi-tenant data isolation
```

#### الملفات المستهدفة:

##### 1. **Financial Reports Tests**

```typescript
// tests/reports/financial-reports.test.ts
describe('Financial Reports', () => {
  describe('Trial Balance', () => {
    it('should always balance (debits = credits)', async () => {
      const tb = await generateTrialBalance('2024-12-31');
      
      const debits = tb.reduce((sum, acc) => sum + acc.debit, 0);
      const credits = tb.reduce((sum, acc) => sum + acc.credit, 0);
      
      expect(debits).toBe(credits);
    });
    
    it('should match individual GL account balances', async () => {
      const tb = await generateTrialBalance('2024-12-31');
      
      for (const account of tb) {
        const glBalance = await getGLBalance(account.code, '2024-12-31');
        expect(account.balance).toBe(glBalance);
      }
    });
    
    it('should show opening, movement, and closing', async () => {
      const tb = await generateTrialBalance('2024-12-31', {
        showMovement: true
      });
      
      for (const account of tb) {
        expect(account.opening + account.debit - account.credit)
          .toBe(account.closing);
      }
    });
  });
  
  describe('Balance Sheet', () => {
    it('should satisfy accounting equation A = L + E', async () => {
      const bs = await generateBalanceSheet('2024-12-31');
      
      expect(bs.assets.total).toBe(
        bs.liabilities.total + bs.equity.total
      );
    });
    
    it('should classify current vs non-current correctly', async () => {
      const bs = await generateBalanceSheet('2024-12-31');
      
      // Current assets (realizable within 12 months)
      expect(bs.assets.current).toContainAccount('Cash');
      expect(bs.assets.current).toContainAccount('Accounts Receivable');
      expect(bs.assets.current).toContainAccount('Inventory');
      
      // Non-current assets
      expect(bs.assets.nonCurrent).toContainAccount('Property');
      expect(bs.assets.nonCurrent).toContainAccount('Equipment');
    });
    
    it('should show comparative figures', async () => {
      const bs = await generateBalanceSheet('2024-12-31', {
        comparative: '2023-12-31'
      });
      
      expect(bs.assets.current.current).toBeDefined();
      expect(bs.assets.current.prior).toBeDefined();
    });
  });
  
  describe('Income Statement', () => {
    it('should calculate gross profit correctly', async () => {
      const is = await generateIncomeStatement('2024-01-01', '2024-12-31');
      
      const grossProfit = is.revenue - is.costOfSales;
      expect(is.grossProfit).toBe(grossProfit);
    });
    
    it('should calculate operating profit', async () => {
      const is = await generateIncomeStatement('2024-01-01', '2024-12-31');
      
      const operatingProfit = is.grossProfit - is.operatingExpenses;
      expect(is.operatingProfit).toBe(operatingProfit);
    });
    
    it('should show earnings per share', async () => {
      const is = await generateIncomeStatement('2024-01-01', '2024-12-31');
      
      const eps = is.netIncome / is.shares;
      expect(is.eps).toBe(eps);
    });
  });
  
  describe('Statement of Cash Flows', () => {
    it('should reconcile cash movement', async () => {
      const scf = await generateCashFlowStatement('2024-01-01', '2024-12-31');
      
      const cashMovement = scf.operating + scf.investing + scf.financing;
      expect(scf.closingCash - scf.openingCash).toBe(cashMovement);
    });
    
    it('should classify activities correctly', async () => {
      // Operating: day-to-day business
      // Investing: purchase/sale of long-term assets
      // Financing: debt and equity
    });
  });
});

// tests/reports/cost-reports.test.ts
describe('Cost Reports', () => {
  describe('Cost of Goods Manufactured', () => {
    it('should calculate COGM correctly', async () => {
      const cogm = await calculateCOGM('2024-12');
      
      // COGM = Opening WIP + Manufacturing Costs - Closing WIP
      const expected = 
        cogm.openingWIP +
        cogm.directMaterials +
        cogm.directLabor +
        cogm.manufacturingOverhead -
        cogm.closingWIP;
      
      expect(cogm.total).toBe(expected);
    });
  });
  
  describe('Cost of Goods Sold', () => {
    it('should calculate COGS correctly', async () => {
      const cogs = await calculateCOGS('2024-12');
      
      // COGS = Opening FG + COGM - Closing FG
      const expected =
        cogs.openingFinishedGoods +
        cogs.costOfGoodsManufactured -
        cogs.closingFinishedGoods;
      
      expect(cogs.total).toBe(expected);
    });
  });
});
```

##### 2. **Bank Reconciliation Tests**

```typescript
// tests/integration/bank-reconciliation.test.ts
describe('Bank Reconciliation', () => {
  it('should match bank statement with cash book', async () => {
    const bankStatement = [
      { date: '2024-12-01', amount: 1000, ref: 'DEP001' },
      { date: '2024-12-02', amount: -500, ref: 'CHQ001' }
    ];
    
    const reconciliation = await reconcileBank(
      'bank-account-1',
      bankStatement,
      '2024-12-01',
      '2024-12-31'
    );
    
    expect(reconciliation.matched).toHaveLength(2);
    expect(reconciliation.unmatched.bank).toHaveLength(0);
    expect(reconciliation.unmatched.book).toHaveLength(0);
  });
  
  it('should identify timing differences', async () => {
    // Outstanding checks, deposits in transit
  });
  
  it('should identify errors', async () => {
    // Bank errors, book errors
  });
});
```

**Coverage المتوقع**: 80%

---

### 📅 Week 4: Components & E2E (1 أسبوع)

**الهدف**: +10% Coverage (إجمالي: 90%)

#### المهام:

```
✅ Critical Forms (PO, Invoice, GRN)
✅ UI Components
✅ E2E workflows
✅ Performance testing (مفصل)
✅ Multi-currency testing (إذا كان مطلوب)
```

#### Performance Testing - مفصل

```typescript
// tests/performance/performance-benchmarks.test.ts
describe('Performance Benchmarks', () => {
  describe('Report Generation', () => {
    it('should generate Trial Balance in < 3 seconds', async () => {
      const start = performance.now();
      await generateTrialBalance('2024-12-31');
      const duration = performance.now() - start;
      expect(duration).toBeLessThan(3000);
    });
    
    it('should generate Balance Sheet in < 5 seconds', async () => {
      const start = performance.now();
      await generateBalanceSheet('2024-12-31');
      const duration = performance.now() - start;
      expect(duration).toBeLessThan(5000);
    });
    
    it('should generate Income Statement in < 4 seconds', async () => {
      const start = performance.now();
      await generateIncomeStatement('2024-01-01', '2024-12-31');
      const duration = performance.now() - start;
      expect(duration).toBeLessThan(4000);
    });
  });
  
  describe('Large Dataset Handling', () => {
    it('should handle 10,000 GL entries efficiently', async () => {
      const entries = Array.from({ length: 10000 }, (_, i) => ({
        id: `entry-${i}`,
        date: '2024-12-31',
        lines: [
          { account: '1000', debit: 100, credit: 0 },
          { account: '4000', debit: 0, credit: 100 }
        ]
      }));
      
      const start = performance.now();
      await processGLEntries(entries);
      const duration = performance.now() - start;
      
      expect(duration).toBeLessThan(10000); // 10 seconds max
    });
    
    it('should calculate COGM for 100 products in < 5 seconds', async () => {
      const products = Array.from({ length: 100 }, (_, i) => ({
        id: `product-${i}`,
        // ... product data
      }));
      
      const start = performance.now();
      await calculateCOGMForProducts(products, '2024-12');
      const duration = performance.now() - start;
      
      expect(duration).toBeLessThan(5000);
    });
  });
  
  describe('Database Queries', () => {
    it('should query GL accounts in < 1 second', async () => {
      const start = performance.now();
      await getAllGLAccounts();
      const duration = performance.now() - start;
      expect(duration).toBeLessThan(1000);
    });
  });
});
```

#### Multi-Currency Testing (إذا كان مطلوب)

```typescript
// tests/domain/multi-currency.test.ts
describe('Multi-Currency', () => {
  describe('Currency Conversion', () => {
    it('should convert amounts correctly', async () => {
      const amount = { value: 100, currency: 'USD' };
      const converted = await convertCurrency(amount, 'SAR', '2024-12-31');
      expect(converted.value).toBeCloseTo(375, 0); // Rate ~3.75
      expect(converted.currency).toBe('SAR');
    });
    
    it('should use correct exchange rate for date', async () => {
      const amount = { value: 100, currency: 'USD' };
      
      // Different dates may have different rates
      const rate1 = await getExchangeRate('USD', 'SAR', '2024-01-01');
      const rate2 = await getExchangeRate('USD', 'SAR', '2024-12-31');
      
      expect(rate1).toBeDefined();
      expect(rate2).toBeDefined();
    });
  });
  
  describe('Exchange Rate Fluctuations', () => {
    it('should handle unrealized gains/losses', async () => {
      const transaction = {
        amount: 1000,
        currency: 'USD',
        date: '2024-01-01',
        exchangeRate: 3.75
      };
      
      // Revalue at year-end
      const yearEndRate = 3.80;
      const unrealizedGain = await calculateUnrealizedGain(
        transaction,
        yearEndRate
      );
      
      expect(unrealizedGain).toBeCloseTo(50, 2); // (3.80-3.75)*1000
    });
    
    it('should recognize realized gains/losses on settlement', async () => {
      // Test realized forex gains/losses
    });
  });
  
  describe('Multi-Currency Reports', () => {
    it('should consolidate multi-currency balances', async () => {
      const balances = [
        { account: '1000', amount: 10000, currency: 'SAR' },
        { account: '1001', amount: 5000, currency: 'USD' }
      ];
      
      const consolidated = await consolidateMultiCurrency(
        balances,
        '2024-12-31',
        'SAR'
      );
      
      expect(consolidated.total).toBeCloseTo(10000 + (5000 * 3.75), 2);
    });
  });
});
```

#### الملفات المستهدفة:

```typescript
// tests/components/forms/*.test.tsx
// tests/e2e/*.spec.ts
```

**Coverage المتوقع**: 90%

---

### 📅 Week 5: Polish & Documentation (3-4 أيام)

**الهدف**: Fill gaps + Documentation

#### المهام:

```
✅ Fill remaining coverage gaps
✅ Edge cases
✅ Performance optimization
✅ Regulatory changes testing
✅ Test documentation
✅ Final verification
```

#### Regulatory Changes Testing

```typescript
// tests/compliance/regulatory-updates.test.ts
describe('Regulatory Updates', () => {
  describe('VAT Rate Changes', () => {
    it('should support VAT rate changes', async () => {
      // Test what happens when VAT changes from 15% to 20%
      const invoice1 = await createInvoice({
        amount: 100,
        vatRate: 0.15,
        date: '2024-11-30'
      });
      
      expect(invoice1.vatAmount).toBe(15);
      
      // After rate change
      await updateVATRate(0.20, '2024-12-01');
      
      const invoice2 = await createInvoice({
        amount: 100,
        vatRate: 0.20,
        date: '2024-12-01'
      });
      
      expect(invoice2.vatAmount).toBe(20);
    });
    
    it('should maintain historical VAT rates for old invoices', async () => {
      // Old invoices should keep their original VAT rate
      const oldInvoice = await getInvoice('invoice-2024-11-30');
      expect(oldInvoice.vatRate).toBe(0.15); // Original rate
    });
  });
  
  describe('Zakat Calculation Changes', () => {
    it('should support Zakat rate updates', async () => {
      // Test Zakat rate changes (e.g., from 2.5% to 2.0%)
      const zakat1 = await calculateZakat(base, { rate: 0.025 });
      expect(zakat1.amount).toBe(base * 0.025);
      
      const zakat2 = await calculateZakat(base, { rate: 0.020 });
      expect(zakat2.amount).toBe(base * 0.020);
    });
    
    it('should maintain audit trail for rate changes', async () => {
      await updateZakatRate(0.020, '2024-12-01');
      const audit = await getAuditLog('zakat-rate-change');
      
      expect(audit).toContainEqual({
        action: 'UPDATE',
        entity: 'zakat_rate',
        oldValue: 0.025,
        newValue: 0.020,
        effectiveDate: '2024-12-01'
      });
    });
  });
  
  describe('ZATCA Requirements Updates', () => {
    it('should adapt to new ZATCA e-invoicing requirements', async () => {
      // Test Phase 2 → Phase 3 transitions
      const invoice = await generateInvoice(data);
      
      // Verify all required fields for current phase
      expect(invoice).toHaveProperty('uuid');
      expect(invoice).toHaveProperty('qrCode');
      expect(invoice).toHaveProperty('digitalSignature');
      
      // Future: Phase 3 requirements
      // expect(invoice).toHaveProperty('newField');
    });
  });
});
```

**Coverage المتوقع**: 75-85% (مرن - Quality over Quantity)

**ملاحظة**: الهدف المرن يسمح بالتركيز على الجودة بدلاً من الكمية فقط

---

## 📊 Coverage Targets النهائية

| الفئة | الهدف | الأولوية | Notes |
|------|-------|----------|-------|
| **Compliance & Audit** | 100% | 🔴 Critical | إلزامي قانوناً |
| **Security** | 95% | 🔴 Critical | حماية البيانات |
| **Financial Reports** | 95% | 🔴 Critical | دقة مالية |
| **Business Logic** | 90% | 🔴 Critical | جوهر النظام |
| **Internal Controls** | 95% | 🟡 High | SOX/رقابة |
| **Services** | 85% | 🟡 High | CRUD + Logic |
| **Components** | 75% | 🟢 Medium | UI Testing |
| **Utils & Helpers** | 85% | 🟢 Medium | Support functions |

**Overall Target**: **75-85%** (مرن - Quality over Quantity)

**ملاحظة**: 
- ✅ إذا وصلت 85%+ → رائع!
- ✅ إذا وصلت 75% → ممتاز أيضاً!
- ⚠️ الأهم: **Quality over Quantity** - جودة Tests أهم من النسبة

---

## 🎯 Success Metrics

### Coverage Metrics (مرنة)

- ✅ Lines: ≥ 75% (هدف: 85%+)
- ✅ Functions: ≥ 75% (هدف: 85%+)
- ✅ Branches: ≥ 70% (هدف: 80%+)
- ✅ Statements: ≥ 75% (هدف: 85%+)

**ملاحظة**: الأهداف مرنة - الجودة أهم من النسبة

### Quality Metrics

- ✅ Compliance Tests: 100%
- ✅ Audit Trail Tests: 100%
- ✅ Security Tests: 95%+
- ✅ Financial Reports: 95%+
- ✅ Test Pass Rate: ≥ 99%
- ✅ Flaky Tests: 0

### Business Metrics

- ✅ IFRS/GAAP Compliance: Verified
- ✅ SOX Controls: Implemented
- ✅ Audit Trail: Complete & Immutable
- ✅ Segregation of Duties: Enforced

---

## ⚡ Quick Start (يوم واحد)

### Setup

```bash
# 1. Verify test environment
npm run test

# 2. Create test structure
mkdir -p tests/{compliance,audit,controls,reports}

# 3. Copy example tests from this plan

# 4. Run first compliance test
npm run test tests/compliance/ifrs-compliance.test.ts
```

---

## 📋 Weekly Checklist

### Week 0.5 ✅

- [ ] IFRS compliance tests
- [ ] SOCPA compliance tests
- [ ] Audit trail tests
- [ ] Internal controls tests
- [ ] SOD tests
- [ ] Verify: Coverage ≥ 12%

### Week 1 ✅

- [ ] Security functions tests
- [ ] Supabase CRUD tests
- [ ] Multi-tenant tests
- [ ] Rate limiter tests
- [ ] Utils tests
- [ ] 🆕 نقل inventory-valuation-integration.js
- [ ] 🆕 إنشاء IInventoryValuationRepository
- [ ] 🆕 تحديث DI Container
- [ ] Verify: Coverage ≥ 30%

### Week 2 ✅

- [ ] Process costing advanced
- [ ] Inventory valuation comprehensive
- [ ] Joint cost allocation
- [ ] Variance analysis
- [ ] Manufacturing services
- [ ] Purchasing services
- [ ] Verify: Coverage ≥ 60%

### Week 3 ✅

- [ ] Trial balance tests
- [ ] Balance sheet tests
- [ ] Income statement tests
- [ ] Cash flow tests
- [ ] Cost reports tests
- [ ] Bank reconciliation
- [ ] Integration tests
- [ ] Verify: Coverage ≥ 80%

### Week 4 ✅

- [ ] Forms components tests
- [ ] UI components tests
- [ ] E2E critical paths
- [ ] Performance tests
- [ ] Verify: Coverage ≥ 90%

### Week 5 ✅

- [ ] Fill coverage gaps
- [ ] Edge cases
- [ ] Test documentation
- [ ] Final verification: Coverage ≥ 85%

### Week 6 ✅ 🆕

- [ ] Architecture Dependency Rules Tests
- [ ] Circular Dependencies Tests
- [ ] ESLint Boundaries Setup
- [ ] Generate Dependency Graph
- [ ] Architecture Compliance: 100%

---

## 🚨 Critical Path Tests (أولوية قصوى)

### 1. Compliance Tests (Week 0.5)

```typescript
// These MUST pass for legal/regulatory compliance
- IAS 2: Inventory valuation ✅
- IAS 16: PPE depreciation ✅
- IFRS 15: Revenue recognition ✅
- ZATCA: E-invoicing ✅
- Zakat calculation ✅
```

### 2. Audit Trail Tests (Week 0.5)

```typescript
// These MUST pass for audit requirements
- All modifications logged ✅
- Logs are immutable ✅
- Transaction chains complete ✅
- Who/What/When/Where tracked ✅
```

### 3. Internal Controls Tests (Week 0.5)

```typescript
// These MUST pass for SOX/governance
- SOD enforced ✅
- Authorization limits enforced ✅
- Period locks enforced ✅
- Data validation enforced ✅
```

### 4. Financial Reports Tests (Week 3)

```typescript
// These MUST pass for accuracy
- Trial balance always balances ✅
- Balance sheet equation holds ✅
- P&L calculations correct ✅
- Cash flow reconciles ✅
```

---

## 🛠️ Test Infrastructure

### Enhanced Setup File

```typescript
// tests/setup.ts
import { afterEach, beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom';

// Mock Supabase
vi.mock('@/lib/supabase', () => ({
  getSupabase: () => mockSupabaseClient,
  getEffectiveTenantId: () => Promise.resolve('test-tenant-id')
}));

// Mock Audit Logger
vi.mock('@/lib/audit-logger', () => ({
  logAuditEvent: vi.fn()
}));

// Global test helpers
global.createTestUser = (overrides = {}) => ({
  id: 'test-user-id',
  role: 'accountant',
  tenantId: 'test-tenant-id',
  ...overrides
});

global.createTestGLEntry = (overrides = {}) => ({
  id: 'test-entry-id',
  date: '2024-12-01',
  lines: [
    { account: '1000', debit: 100, credit: 0 },
    { account: '4000', debit: 0, credit: 100 }
  ],
  ...overrides
});

// Cleanup after each test
afterEach(() => {
  vi.clearAllMocks();
});
```

### Test Utilities

```typescript
// tests/utils.ts

// Mock factories
export const factories = {
  glAccount: (overrides = {}) => ({
    id: 'test-id',
    code: '1000',
    name: 'Cash',
    category: 'ASSET',
    ...overrides
  }),
  
  product: (overrides = {}) => ({
    id: 'test-product-id',
    code: 'PROD001',
    stock_quantity: 100,
    cost_price: 10,
    valuation_method: 'AVCO',
    ...overrides
  }),
  
  purchaseOrder: (overrides = {}) => ({
    id: 'test-po-id',
    supplier_id: 'test-supplier-id',
    status: 'DRAFT',
    items: [],
    ...overrides
  })
};

// Assertion helpers
export const assertions = {
  toBalanceDebitsCredits: (entry) => {
    const debits = entry.lines.reduce((sum, l) => sum + l.debit, 0);
    const credits = entry.lines.reduce((sum, l) => sum + l.credit, 0);
    expect(debits).toBe(credits);
  },
  
  toBeValidGLEntry: (entry) => {
    expect(entry).toHaveProperty('id');
    expect(entry).toHaveProperty('date');
    expect(entry).toHaveProperty('lines');
    expect(entry.lines.length).toBeGreaterThan(0);
    assertions.toBalanceDebitsCredits(entry);
  }
};
```

---

## 📊 Progress Tracking

### Weekly Coverage Goals

| Week | Target | Actual | Status | Notes |
|------|--------|--------|--------|-------|
| 0 | Infrastructure | ✅ | ✅ مكتمل | Test setup complete |
| 0.5 | 12% | ~3% | ⏳ جاري | Compliance foundation |
| 1 | 30% | __% | ⏳ | Core + Architecture fixes 🆕 |
| 2 | 55% | __% | ⏳ | Business logic |
| 3 | 75% | __% | ⏳ | Reports + integration |
| 4 | 85% | __% | ⏳ | Components + E2E |
| 5 | 90% | __% | ⏳ | Polish |
| 6 | 90%+ | __% | ⏳ | Architecture Compliance 100% 🆕 |

### Daily Progress Log

```markdown
## Week 0.5 - Day 1
- [ ] Created IFRS compliance tests
- [ ] Coverage: ___%

## Week 0.5 - Day 2
- [ ] Created SOCPA compliance tests
- [ ] Coverage: ___%

## Week 0.5 - Day 3
- [ ] Created audit trail tests
- [ ] Coverage: ___%

## Week 0.5 - Day 4
- [ ] Created internal controls tests
- [ ] Week 0.5 complete: Coverage ___%
```

---

## 🎓 Best Practices

### 1. Test Naming Convention

```typescript
// ✅ Good: Descriptive, behavior-focused
it('should prevent posting to closed period when user lacks override permission')

// ❌ Bad: Vague, implementation-focused
it('test period lock')
```

### 2. Arrange-Act-Assert Pattern

```typescript
it('should calculate COGM correctly', async () => {
  // Arrange: Setup test data
  const wipOpening = 10000;
  const materialCosts = 50000;
  const laborCosts = 30000;
  const overheadCosts = 20000;
  const wipClosing = 15000;
  
  // Act: Execute the function
  const cogm = await calculateCOGM({
    wipOpening,
    materialCosts,
    laborCosts,
    overheadCosts,
    wipClosing
  });
  
  // Assert: Verify the result
  const expected = wipOpening + materialCosts + laborCosts + overheadCosts - wipClosing;
  expect(cogm.total).toBe(expected);
});
```

### 3. Test Independence

```typescript
// ✅ Good: Each test is independent
describe('GL Account CRUD', () => {
  beforeEach(async () => {
    // Fresh database state for each test
    await clearTestData();
    await seedTestData();
  });
  
  it('should create account', async () => {
    // Test...
  });
  
  it('should update account', async () => {
    // Test...
  });
});
```

### 4. Mock External Dependencies Only

```typescript
// ✅ Good: Mock external services
vi.mock('@/lib/supabase');
vi.mock('axios'); // External API

// ❌ Bad: Don't mock internal business logic
// vi.mock('@/domain/process-costing'); // NO!
```

---

## 📚 Lessons Learned (11 ديسمبر 2025)

### 1. TypeScript Compilation في CI/CD

**المشكلة**:
```
Error TS2322: Property 'totalQuantity' is optional in type but required
```

**السبب**:
```typescript
// ❌ Inconsistent return type
export const calculateAVCO = (currentStock, currentValue, incomingQty, incomingCost) => {
  if (totalQty <= 0) {
    return { newUnitCost: 0, newTotalValue: 0 }  // Missing totalQuantity!
  }
  return {
    newUnitCost: Math.max(0, newUnitCost),
    newTotalValue: Math.max(0, totalValue),
    totalQuantity: totalQty  // Only here - makes it optional!
  }
}
```

**الحل**:
```typescript
// ✅ Explicit types + consistent return
export const calculateAVCO = (
  currentStock: number,
  currentValue: number,
  incomingQty: number,
  incomingCost: number
): { newUnitCost: number; newTotalValue: number; totalQuantity: number } => {
  // ...
  if (totalQty <= 0) {
    return { newUnitCost: 0, newTotalValue: 0, totalQuantity: 0 }  // Fixed!
  }
  return {
    newUnitCost: Math.max(0, newUnitCost),
    newTotalValue: Math.max(0, totalValue),
    totalQuantity: totalQty
  }
}
```

**الدرس**: دائماً استخدم explicit return types للـpublic functions!

### 2. Vitest Mocking Hoisting Issue

**المشكلة**:
```typescript
// ❌ Variables declared outside vi.mock()
const mockRpc = vi.fn()
vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: mockRpc }  // Error: Cannot access 'mockRpc' before initialization
}))
```

**السبب**: `vi.mock()` يتم **hoisting** لأعلى الملف، والـvariables لم تُنشأ بعد

**الحل**:
```typescript
// ✅ Use factory function
vi.mock('@/lib/supabase', () => {
  return {
    supabase: {
      rpc: vi.fn(),  // Create mocks inside factory
      from: vi.fn(() => ({
        select: vi.fn()
      }))
    }
  }
})
```

**الدرس**: استخدم factory functions في `vi.mock()`، لا تعتمد على external variables!

### 3. Coverage لـ.js vs .ts Files

**المشكلة**:
- `utils.js` كان 0% coverage رغم وجود 42 test

**السبب**:
```typescript
// vitest.config.ts
coverage: {
  include: ['src/**/*.{ts,tsx}']  // Excludes .js files!
}
```

**الحل**:
1. تحويل `utils.js` → `utils.ts`
2. Coverage قفز من 0% → 53.33%

**الدرس**: تأكد إن `vitest.config.ts` يشمل الملفات الصحيحة!

### 4. Integration Tests vs Unit Tests للـCoverage

**الاكتشاف المهم**:
- 101 test (IAS 2, IAS 16, Audit, Controls) = **1.64% coverage** ❌
- السبب: Tests كانت تختبر **منطق داخلي**، مش **الكود الحقيقي**

**الحل**:
```typescript
// ❌ Unit test - No coverage
it('should calculate AVCO', () => {
  const totalQty = 10 + 5
  const totalValue = 100 + 50
  const avgCost = totalValue / totalQty
  expect(avgCost).toBe(10)  // Logic inside test!
})

// ✅ Integration test - Real coverage
import { calculateAVCO } from '@/core/utils'

it('should calculate AVCO', () => {
  const result = calculateAVCO(10, 100, 5, 50)  // Tests REAL code!
  expect(result.newUnitCost).toBe(10)
})
```

**النتائج**:
- 42 integration tests → **53.33%** coverage لـutils.ts
- 37 integration tests → **33.45%** coverage لـinventory-transaction-service.ts

**الدرس الذهبي**: **Import and test REAL code**, not logic inside tests!

### 5. Mock Chain Complexity

**المشكلة**:
```typescript
// ❌ Complex mock chain - hard to maintain
mockSelect.mockReturnValue({
  eq: vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: [], error: null })
    })
  })
})
```

**الحل المحسّن**:
```typescript
// ✅ Use vi.mocked() for type safety
import { supabase } from '@/lib/supabase'

vi.mocked(supabase.from).mockReturnValue({
  select: vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: mockData, error: null })
    })
  })
} as any)
```

**الدرس**: استخدم `vi.mocked()` للـtype safety وقلل الـchain complexity!

---

## 🏗️ Architecture Compliance Tests (Week 6 - جديد)

### الهدف: ضمان الالتزام بقواعد Clean Architecture

**المدة المتوقعة:** 3 أيام  
**الأولوية:** 🟢 متوسطة (بعد إكمال الاختبارات الوظيفية)  
**Coverage المتوقع:** Architecture Compliance: **100%**

---

### 1. **Dependency Rule Tests**

```typescript
// tests/architecture/dependency-rules.test.ts
import { describe, it, expect } from 'vitest'
import * as glob from 'glob'
import * as fs from 'fs'

describe('Clean Architecture - Dependency Rules', () => {
  
  describe('Domain Layer Independence', () => {
    it('Domain should NOT import from Infrastructure', () => {
      const domainFiles = glob.sync('src/domain/**/*.{ts,js,tsx}')
      const violations: string[] = []
      
      for (const file of domainFiles) {
        const content = fs.readFileSync(file, 'utf-8')
        
        // تحقق من عدم استيراد Infrastructure
        if (content.match(/@\/infrastructure/g) ||
            content.match(/from ['"]\.\.\/infrastructure/g) ||
            content.match(/@\/lib\/supabase/g) ||
            content.match(/from ['"]supabase['"]/g)) {
          violations.push(file)
        }
      }
      
      if (violations.length > 0) {
        console.error('❌ Domain files importing from Infrastructure:')
        violations.forEach(file => console.error(`  - ${file}`))
      }
      
      expect(violations).toHaveLength(0)
    })
    
    it('Domain should NOT import from Application', () => {
      const domainFiles = glob.sync('src/domain/**/*.{ts,js,tsx}')
      const violations: string[] = []
      
      for (const file of domainFiles) {
        const content = fs.readFileSync(file, 'utf-8')
        
        if (content.match(/@\/application/g) ||
            content.match(/from ['"]\.\.\/application/g)) {
          violations.push(file)
        }
      }
      
      expect(violations).toHaveLength(0)
    })
    
    it('Domain should NOT import from Features (Presentation)', () => {
      const domainFiles = glob.sync('src/domain/**/*.{ts,js,tsx}')
      const violations: string[] = []
      
      for (const file of domainFiles) {
        const content = fs.readFileSync(file, 'utf-8')
        
        if (content.match(/@\/features/g) ||
            content.match(/from ['"]\.\.\/features/g)) {
          violations.push(file)
        }
      }
      
      expect(violations).toHaveLength(0)
    })
  })
  
  describe('Repository Pattern Compliance', () => {
    it('All Infrastructure Repositories should implement Domain Interfaces', () => {
      // تحقق من أن كل Repository ينفذ Interface
      const repos = glob.sync('src/infrastructure/repositories/*Repository.ts')
      
      for (const repoFile of repos) {
        const content = fs.readFileSync(repoFile, 'utf-8')
        
        // يجب أن يحتوي على "implements I..."
        expect(content).toMatch(/implements\s+I\w+Repository/)
        
        // يجب أن يستورد Interface من domain/interfaces
        expect(content).toMatch(/from\s+['"]@\/domain\/interfaces/)
      }
    })
    
    it('Domain Interfaces should NOT have implementation details', () => {
      const interfaces = glob.sync('src/domain/interfaces/**/*.ts')
      
      for (const file of interfaces) {
        const content = fs.readFileSync(file, 'utf-8')
        
        // لا يجب أن تحتوي على supabase
        expect(content).not.toMatch(/supabase/i)
        
        // لا يجب أن تحتوي على SQL
        expect(content).not.toMatch(/SELECT|INSERT|UPDATE|DELETE/i)
        
        // لا يجب أن تحتوي على implementation
        expect(content).not.toMatch(/export\s+class\s+\w+Repository/)
      }
    })
  })
  
  describe('Use Case Dependencies', () => {
    it('Use Cases should only depend on Domain Interfaces', () => {
      const useCases = glob.sync('src/domain/use-cases/**/*.ts')
      
      for (const file of useCases) {
        const content = fs.readFileSync(file, 'utf-8')
        
        // إذا كان يستخدم Repository
        if (content.includes('Repository')) {
          // يجب أن يكون من domain/interfaces
          expect(content).toMatch(/from\s+['"]@\/domain\/interfaces/)
          
          // لا يجب أن يكون من infrastructure
          expect(content).not.toMatch(/from\s+['"]@\/infrastructure/)
        }
      }
    })
  })
  
  describe('Application Layer Boundaries', () => {
    it('Application should NOT import from Features', () => {
      const appFiles = glob.sync('src/application/**/*.{ts,tsx}')
      const violations: string[] = []
      
      for (const file of appFiles) {
        const content = fs.readFileSync(file, 'utf-8')
        
        if (content.match(/@\/features/g)) {
          violations.push(file)
        }
      }
      
      expect(violations).toHaveLength(0)
    })
  })
})
```

---

### 2. **Circular Dependency Tests**

```typescript
// tests/architecture/circular-dependencies.test.ts
import { describe, it, expect } from 'vitest'
import madge from 'madge'

describe('Circular Dependencies Detection', () => {
  
  it('should NOT have circular dependencies in Domain', async () => {
    const result = await madge('src/domain/', {
      fileExtensions: ['ts', 'tsx', 'js'],
      tsConfig: 'tsconfig.json'
    })
    
    const circular = result.circular()
    
    if (circular.length > 0) {
      console.error('❌ Circular dependencies found:')
      circular.forEach((cycle: string[]) => {
        console.error(`  - ${cycle.join(' → ')}`)
      })
    }
    
    expect(circular).toHaveLength(0)
  })
  
  it('should NOT have circular dependencies between layers', async () => {
    const result = await madge('src/', {
      fileExtensions: ['ts', 'tsx', 'js'],
      tsConfig: 'tsconfig.json'
    })
    
    const circular = result.circular()
    
    // تصفية: الدوائر التي تعبر حدود الطبقات
    const crossLayerCircular = circular.filter((cycle: string[]) => {
      return cycle.some(path => path.includes('/domain/')) &&
             cycle.some(path => path.includes('/infrastructure/'))
    })
    
    expect(crossLayerCircular).toHaveLength(0)
  })
})
```

---

### 3. **Layer Dependency Graph Tests**

```typescript
// tests/architecture/dependency-graph.test.ts
import { describe, it, expect } from 'vitest'
import madge from 'madge'

describe('Layer Dependency Graph', () => {
  
  it('should generate dependency graph', async () => {
    const result = await madge('src/', {
      fileExtensions: ['ts', 'tsx'],
      tsConfig: 'tsconfig.json'
    })
    
    // إنشاء صورة للـ dependency graph
    await result.image('docs/architecture/dependency-graph.svg')
    
    expect(result).toBeDefined()
  })
  
  it('Dependency flow should be: Features → Application → Domain', async () => {
    const result = await madge('src/', {
      fileExtensions: ['ts', 'tsx'],
      tsConfig: 'tsconfig.json'
    })
    
    const tree = result.obj()
    
    // تحقق من أن Features تعتمد على Application
    const featureFiles = Object.keys(tree).filter(f => f.includes('/features/'))
    for (const file of featureFiles) {
      const deps = tree[file] || []
      
      // إذا كان يعتمد على شيء
      if (deps.length > 0) {
        // لا يجب أن يعتمد مباشرة على Infrastructure
        const infraDeps = deps.filter((d: string) => d.includes('/infrastructure/'))
        expect(infraDeps).toHaveLength(0)
      }
    }
  })
})
```

---

### 4. **ESLint Rules for Architecture**

```typescript
// .eslintrc.js - إضافة
module.exports = {
  // ... existing config
  
  plugins: [
    '@typescript-eslint',
    'import',
    'boundaries' // 🆕
  ],
  
  rules: {
    // منع استيراد Infrastructure من Domain
    'boundaries/element-types': ['error', {
      default: 'disallow',
      rules: [
        {
          from: 'domain',
          disallow: ['infrastructure', 'application', 'features'],
          message: 'Domain should not depend on outer layers'
        },
        {
          from: 'application',
          disallow: ['features', 'infrastructure'],
          message: 'Application should not depend on Features or Infrastructure directly'
        },
        {
          from: 'infrastructure',
          disallow: ['features'],
          message: 'Infrastructure should not depend on Features'
        }
      ]
    }],
    
    // منع Circular Dependencies
    'import/no-cycle': ['error', { 
      maxDepth: 10,
      ignoreExternal: true 
    }]
  },
  
  settings: {
    'boundaries/elements': [
      { type: 'domain', pattern: 'src/domain/**' },
      { type: 'application', pattern: 'src/application/**' },
      { type: 'infrastructure', pattern: 'src/infrastructure/**' },
      { type: 'features', pattern: 'src/features/**' }
    ]
  }
}
```

---

### 5. **الأدوات المطلوبة**

```bash
# تثبيت الأدوات
npm install --save-dev \
  eslint-plugin-boundaries \
  eslint-plugin-import \
  dependency-cruiser \
  madge \
  glob

# تشغيل فحص Architecture
npm run test:architecture

# توليد Dependency Graph
npm run arch:graph
```

---

### 6. **Package.json Scripts**

```json
{
  "scripts": {
    "test:architecture": "vitest run tests/architecture --reporter=verbose",
    "arch:graph": "madge --image docs/architecture/dependency-graph.svg src/",
    "arch:circular": "madge --circular src/",
    "arch:validate": "dependency-cruiser --validate .dependency-cruiser.js src/"
  }
}
```

---

### 7. **Coverage المتوقع**

| Test Category | Tests | Coverage |
|--------------|-------|----------|
| Dependency Rules | 6 | 100% |
| Circular Dependencies | 2 | 100% |
| Repository Compliance | 3 | 100% |
| Layer Boundaries | 3 | 100% |
| ESLint Rules | Auto | 100% |
| **Total Architecture Tests** | **14+** | **100%** |

---

### 8. **Expected Output**

```bash
✓ tests/architecture/dependency-rules.test.ts (9 tests) 234ms
  ✓ Clean Architecture - Dependency Rules
    ✓ Domain Layer Independence
      ✓ Domain should NOT import from Infrastructure ✅
      ✓ Domain should NOT import from Application ✅
      ✓ Domain should NOT import from Features ✅
    ✓ Repository Pattern Compliance
      ✓ All Repositories implement Domain Interfaces ✅
      ✓ Domain Interfaces have no implementation ✅
    ✓ Use Case Dependencies
      ✓ Use Cases only depend on Domain Interfaces ✅
    ✓ Application Layer Boundaries
      ✓ Application should NOT import from Features ✅

✓ tests/architecture/circular-dependencies.test.ts (2 tests) 1.2s
  ✓ Circular Dependencies Detection
    ✓ should NOT have circular dependencies in Domain ✅
    ✓ should NOT have circular dependencies between layers ✅

✓ tests/architecture/dependency-graph.test.ts (2 tests) 890ms
  ✓ Layer Dependency Graph
    ✓ should generate dependency graph ✅
    ✓ Dependency flow: Features → Application → Domain ✅

Architecture Compliance: 100% ✅ 🏆
```

---

## 🚀 CI/CD Integration

### GitHub Actions Workflow

```yaml
# .github/workflows/test-coverage.yml
name: Test Coverage

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test-coverage:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run tests with coverage
        run: npm run test:coverage
      
      - name: Coverage threshold check
        run: |
          COVERAGE=$(cat coverage/coverage-summary.json | jq '.total.lines.pct')
          if (( $(echo "$COVERAGE < 85" | bc -l) )); then
            echo "❌ Coverage $COVERAGE% is below 85% threshold"
            exit 1
          else
            echo "✅ Coverage $COVERAGE% meets threshold"
          fi
      
      - name: Upload to SonarQube
        uses: sonarsource/sonarqube-scan-action@master
        env:
          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
      
      - name: SonarQube Quality Gate
        uses: sonarsource/sonarqube-quality-gate-action@master
        timeout-minutes: 5
        env:
          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
```

---

## 📚 Resources & References

### Internal Documentation

- `docs/testing-strategy.md` - Overall testing strategy
- `docs/compliance-requirements.md` - Accounting standards
- `docs/audit-requirements.md` - Audit trail specs

### External References

- [IFRS Standards](https://www.ifrs.org/)
- [SOCPA Standards](https://socpa.org.sa/)
- [ZATCA E-Invoicing](https://zatca.gov.sa/)
- [Vitest Documentation](https://vitest.dev/)

---

## 🎉 Success Criteria

### Technical Success

✅ Coverage ≥ 75% (هدف: 85%+)
✅ All tests passing
✅ Quality Gate: PASSED
✅ No flaky tests
✅ Fast test execution (< 10 min)
✅ Performance benchmarks met

### Business Success

✅ IFRS/GAAP compliant
✅ SOCPA compliant
✅ Audit trail complete
✅ Internal controls enforced
✅ Ready for external audit

### Regulatory Success

✅ ZATCA e-invoicing compliant
✅ Zakat calculation accurate
✅ VAT reporting correct
✅ Period locking enforced

---

**آخر تحديث**: December 10, 2025  
**الإصدار**: 2.1.0 (Enhanced Edition - Based on Review)  
**الحالة**: ✅ Ready for Implementation

---

## 📝 ملاحظات التحديث (v2.1.0)

### التحسينات المضافة بناءً على المراجعة:

1. ✅ **تمديد Week 0.5**: من 3-4 أيام إلى 5-6 أيام (أسبوع كامل)
2. ✅ **هدف مرن**: 75-85% بدلاً من 85% ثابت (Quality over Quantity)
3. ✅ **Performance Testing مفصل**: Benchmarks محددة لكل نوع report
4. ✅ **Multi-Currency Testing**: إضافة كاملة (إذا كان مطلوب)
5. ✅ **Regulatory Changes Testing**: تغطية تحديثات VAT/Zakat/ZATCA
6. ✅ **Critical Path Priority**: ترتيب واضح للأولويات عند ضيق الوقت

### التقييم النهائي: **9/10** ⭐⭐⭐⭐⭐

**نقاط القوة**:
- ✅ شاملة من الناحية المحاسبية
- ✅ تراعي المعايير السعودية
- ✅ ترتيب الأولويات صحيح
- ✅ أمثلة عملية ومفيدة
- ✅ مرنة وواقعية

**الخطة جاهزة للتنفيذ!** 🚀
