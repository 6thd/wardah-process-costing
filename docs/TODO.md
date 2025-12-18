# 📋 قائمة المهام المتبقية - Wardah ERP Test Coverage

> آخر تحديث: 18 ديسمبر 2025

---

## ✅ المهام المكتملة

### Phase 0: Infrastructure Setup ✅
- [x] إعداد Vitest + Coverage
- [x] إنشاء `test-utils.tsx` مع QueryClientProvider
- [x] تفعيل `--coverage.reportOnFailure`
- [x] إعداد GitHub Actions لـ SonarCloud

### Phase 1-5: Integration Tests ✅
- [x] `src/core/utils.ts` - 92 tests (53.33% coverage)
- [x] `src/services/inventory-transaction-service.ts` - 37 tests (33.45% coverage)
- [x] `src/domain/inventory/valuation.ts` - 31 tests (100% coverage)
- [x] `src/services/process-costing-service.ts` - 36 tests (~35% coverage)
- [x] `src/modules/inventory/StockLedgerService.ts` - 39 tests (~30% coverage)

### ESLint & Quality ✅
- [x] إنشاء `eslint.config.js` مع TypeScript + React Hooks
- [x] إصلاح 21 ملف duplicate imports
- [x] إنشاء `scripts/pre-push-check.ps1`
- [x] إنشاء `scripts/pre-push-check.sh`
- [x] إضافة `npm run quality-check`

### Unit Tests الجديدة ✅
- [x] `src/core/__tests__/utils.test.ts` - 50 tests
- [x] `src/core/__tests__/security.test.ts` - 21 tests (JWT + UUID)
- [x] `src/lib/__tests__/tenant-validator.test.ts` - 17 tests
- [x] `src/utils/__tests__/keyboardNav.test.ts` - 14 tests (81.72% coverage)
- [x] `src/utils/__tests__/parseClipboard.test.ts` - 11 tests (100% coverage)

### Services Integration Tests ✅ (18 ديسمبر 2025)
- [x] `src/services/__tests__/accounting-service.test.ts` - 39 tests
  - [x] Journal entry balance validation
  - [x] Account balance calculations
  - [x] Trial balance and financial statements
  - [x] Running balance and account categorization
  - [x] Edge cases (decimals, large numbers)
  
- [x] `src/services/__tests__/inventory-transaction-service.test.ts` - 41 tests
  - [x] Stock availability calculations
  - [x] Material reservation logic
  - [x] Consumption validation
  - [x] FIFO and weighted average costing
  - [x] Reservation expiry handling
  
- [x] `src/services/__tests__/sales-service.test.ts` - 51 tests
  - [x] Invoice calculations (subtotal, tax, discounts)
  - [x] COGS calculations
  - [x] Delivery and payment status management
  - [x] GL entry generation and validation
  - [x] Gross profit margin calculations

---

## ⏳ المهام المتبقية

### 🔴 أولوية عالية (Week 1-2)

#### Services Tests
- [x] ~~`src/services/accounting-service.ts`~~ ✅ مكتمل
- [x] ~~`src/services/inventory-transaction-service.ts`~~ ✅ مكتمل
- [x] ~~`src/services/sales-service.ts`~~ ✅ مكتمل

- [ ] `src/services/purchasing-service.ts` (~300 lines)
  - [ ] إنشاء `purchasing-service.test.ts`
  - [ ] اختبار createPurchaseOrder
  - [ ] اختبار receiving
  - [ ] Coverage المتوقع: +2-3%

- [ ] `src/services/warehouse-service.ts`
  - [ ] إنشاء `warehouse-service.test.ts`
  - [ ] Coverage المتوقع: +1-2%

### 🟡 أولوية متوسطة (Week 3-4)

#### Component Tests
- [ ] `src/components/auth/LoginForm.tsx`
- [ ] `src/components/auth/RegisterForm.tsx`
- [ ] `src/components/auth/ProtectedRoute.tsx`
- [ ] `src/components/common/DataTable.tsx`
- [ ] `src/components/common/Modal.tsx`
- [ ] Coverage المتوقع: +8-10%

#### Feature Tests
- [ ] `src/features/reports/TrialBalanceReport.tsx`
- [ ] `src/features/reports/IncomeStatement.tsx`
- [ ] `src/features/reports/BalanceSheet.tsx`
- [ ] `src/features/manufacturing/ProductionOrder.tsx`
- [ ] Coverage المتوقع: +5-7%

### 🟢 أولوية منخفضة (Week 5-6)

#### E2E Tests
- [ ] `e2e/login.spec.ts` - تسجيل الدخول
- [ ] `e2e/inventory.spec.ts` - إدارة المخزون
- [ ] `e2e/manufacturing.spec.ts` - أوامر التصنيع
- [ ] `e2e/reports.spec.ts` - التقارير المالية

#### Architecture Compliance
- [ ] `tests/architecture/dependency-rules.test.ts`
  - [ ] Domain لا يستورد من Infrastructure
  - [ ] Domain لا يستورد من Application
  - [ ] Infrastructure تنفذ Domain Interfaces

#### Legacy Migration
- [ ] نقل `domain/inventory-valuation-integration.js` إلى `infrastructure/services/`
- [ ] إنشاء `IInventoryValuationRepository` interface
- [ ] تحديث DI Container

---

## 📊 ملخص التقدم

| المرحلة | الحالة | الاختبارات | التغطية |
|---------|--------|------------|---------|
| Infrastructure | ✅ مكتمل | - | - |
| Integration Tests (Phase 1-5) | ✅ مكتمل | 235 | ~8% |
| ESLint & Quality | ✅ مكتمل | - | - |
| Unit Tests (Core) | ✅ مكتمل | 113 | +3% |
| Services Tests | ✅ مكتمل | 131 | +5% |
| Component Tests | ⏳ متبقي | ~50 | +10% |
| E2E Tests | ⏳ متبقي | ~30 | +5% |
| Architecture | ⏳ متبقي | ~10 | - |

**الإجمالي الحالي**: 1368 اختبار ✅ (+131 جديد)
**التغطية الحالية**: ~13-15% (تقديري)
**الهدف**: 80%+

---

## 🎯 الأولويات للأسبوع القادم

1. ~~**إنشاء اختبارات لـ `accounting-service.ts`**~~ ✅ مكتمل
2. ~~**إنشاء اختبارات لـ `inventory-transaction-service.ts`**~~ ✅ مكتمل
3. ~~**إنشاء اختبارات لـ `sales-service.ts`**~~ ✅ مكتمل
4. **إنشاء اختبارات لـ `purchasing-service.ts`** - القادم
5. **اختبارات Components الأساسية**
6. **دمج PR إلى main branch**

---

## 📝 ملاحظات

- استخدم **Integration Tests** بدلاً من Unit Tests للحصول على coverage حقيقي
- استورد الكود الفعلي من `src/` بدلاً من إعادة كتابة المنطق
- Mock فقط الأطراف الخارجية (Supabase, APIs)
- شغّل `npm run quality-check` قبل كل push

---

## 📈 سجل التحديثات

| التاريخ | التحديث | الاختبارات المضافة |
|---------|---------|-------------------|
| 17 ديسمبر 2025 | Unit Tests للـ Core utilities | 113 |
| 18 ديسمبر 2025 | Services Integration Tests | 131 |

---

*آخر تحديث: 18 ديسمبر 2025*
