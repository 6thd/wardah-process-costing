# 📋 قائمة المهام المتبقية - Wardah ERP Test Coverage

> آخر تحديث: 17 ديسمبر 2025

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

---

## ⏳ المهام المتبقية

### 🔴 أولوية عالية (Week 1-2)

#### Services Tests
- [ ] `src/services/accounting-service.ts` (~544 lines)
  - [ ] إنشاء `integration-accounting-service.test.ts`
  - [ ] اختبار createJournalEntry
  - [ ] اختبار getTrialBalance
  - [ ] اختبار postEntry
  - [ ] اختبار reverseEntry
  - [ ] Coverage المتوقع: +4-5%

- [ ] `src/services/inventory-service.ts` (~350 lines)
  - [ ] إنشاء `integration-inventory-service.test.ts`
  - [ ] اختبار getStockLevels
  - [ ] اختبار updateStock
  - [ ] اختبار transferStock
  - [ ] Coverage المتوقع: +3-4%

- [ ] `src/services/sales-service.ts` (~300 lines)
  - [ ] إنشاء `integration-sales-service.test.ts`
  - [ ] اختبار createSalesOrder
  - [ ] اختبار invoicing
  - [ ] Coverage المتوقع: +2-3%

- [ ] `src/services/purchasing-service.ts` (~300 lines)
  - [ ] إنشاء `integration-purchasing-service.test.ts`
  - [ ] اختبار createPurchaseOrder
  - [ ] اختبار receiving
  - [ ] Coverage المتوقع: +2-3%

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
| Services Tests | ⏳ متبقي | ~120 | +12% |
| Component Tests | ⏳ متبقي | ~50 | +10% |
| E2E Tests | ⏳ متبقي | ~30 | +5% |
| Architecture | ⏳ متبقي | ~10 | - |

**الإجمالي الحالي**: 1237 اختبار ✅
**التغطية الحالية**: ~10.8%
**الهدف**: 80%+

---

## 🎯 الأولويات للأسبوع القادم

1. **إنشاء اختبارات لـ `accounting-service.ts`** - أعلى قيمة coverage
2. **إنشاء اختبارات لـ `inventory-service.ts`**
3. **مراجعة وإصلاح أي failing tests**
4. **دمج PR إلى main branch**

---

## 📝 ملاحظات

- استخدم **Integration Tests** بدلاً من Unit Tests للحصول على coverage حقيقي
- استورد الكود الفعلي من `src/` بدلاً من إعادة كتابة المنطق
- Mock فقط الأطراف الخارجية (Supabase, APIs)
- شغّل `npm run quality-check` قبل كل push

---

*آخر تحديث: 17 ديسمبر 2025*
