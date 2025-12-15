# 📋 Legacy Services Migration Plan

**التاريخ:** 13 ديسمبر 2025  
**المرحلة:** Week 2-3  
**الهدف:** نقل Legacy Services من `src/services/` إلى `application/services/`

---

## 📊 تحليل Legacy Services

### **الملفات الحالية في src/services/:**

#### **Core Services (أولوية عالية 🔴):**
1. ✅ `accounting-service.ts` - خدمة المحاسبة الرئيسية
2. ⚠️ `inventory-transaction-service.ts` - حركات المخزون
3. ⚠️ `process-costing-service.ts` - محاسبة تكاليف العمليات
4. ⏳ `stock-ledger-service.ts` - سجل حركة المخزون

#### **Business Services (أولوية متوسطة 🟡):**
5. `sales-service.ts` - خدمة المبيعات
6. `purchasing-service.ts` - خدمة المشتريات
7. `warehouse-service.ts` - إدارة المستودعات
8. `stock-adjustment-service.ts` - تعديلات المخزون
9. `enhanced-sales-service.ts` - خدمة مبيعات محسّنة
10. `payment-vouchers-service.ts` - سندات الدفع

#### **Reporting Services (أولوية منخفضة 🟢):**
11. `financial-dashboard-service.ts` - لوحة معلومات مالية
12. `sales-reports-service.ts` - تقارير المبيعات

#### **Admin Services:**
13. `organization-service.ts` - إدارة المؤسسات
14. `org-admin-service.ts` - إدارة منظمة
15. `super-admin-service.ts` - مدير عام
16. `rbac-service.ts` - التحكم في الصلاحيات

#### **Specialized Services:**
17. `gemini-service.ts` - خدمة Gemini AI
18. `gemini-financial-service.ts` - خدمة مالية بـ AI

#### **HR Services (مجلد hr/):**
- `hr-service.ts`
- `employee-service.ts`
- `payroll-engine.ts`
- `attendance-service.ts`
- `leave-service.ts`
- `payroll-account-service.ts`
- `payroll-lock-service.ts`
- `policies-service.ts`

#### **Manufacturing Services (مجلد manufacturing/):**
- `bomService.ts`
- `bomCostingService.ts`
- `bomRoutingService.ts`
- `bomTreeService.ts`
- `bomAlternativeService.ts`

#### **Accounting Sub-Services (مجلد accounting/):**
- `journal-service.ts`
- `posting-service.ts`
- `notification-service.ts`
- `variance-monitoring-service.ts`

#### **Valuation Services (مجلد valuation/):**
- ✅ `index.ts` - **مكتمل بالفعل** (تم نقله كـ SupabaseInventoryValuationRepository)

#### **Infrastructure:**
- `supabase-service.ts` - يبقى في مكانه (Infrastructure)

---

## 🎯 استراتيجية النقل

### **Phase 1: تحليل وتوثيق (يوم 1) ✅**
- [x] مراجعة جميع Services
- [x] تحديد الأولويات
- [x] إنشاء خطة النقل

### **Phase 2: إعداد Infrastructure (يوم 1-2)**
- [ ] إنشاء Interfaces في Domain
- [ ] تحديد Dependencies بين Services
- [ ] إضافة Integration Tests للـ Core Services

### **Phase 3: نقل Core Services (يوم 2-3)**
- [ ] `accounting-service.ts` → `application/services/AccountingService.ts`
- [ ] `process-costing-service.ts` → `application/services/ProcessCostingService.ts`
- [ ] `inventory-transaction-service.ts` → (تحتاج مراجعة - قد تكون Infrastructure)

### **Phase 4: نقل Business Services (يوم 4-5)**
- [ ] Sales Services
- [ ] Purchasing Service
- [ ] Warehouse Service

### **Phase 5: التنظيف والتوثيق (يوم 6-7)**
- [ ] حذف الملفات القديمة
- [ ] تحديث Imports
- [ ] تحديث Documentation

---

## 🔍 تحليل مفصل للـ Core Services

### 1. **accounting-service.ts** 🔴

**الحجم المتوقع:** كبير (500+ سطر)  
**Dependencies:**
- Supabase client
- GL Accounts
- Journal Entries
- Trial Balance
- Financial Reports

**التحديات:**
- قد يحتوي على business logic مختلط مع data access
- يحتاج فصل إلى Repository + Application Service

**الخطة:**
1. إنشاء `IAccountingService` interface في Domain
2. نقل Business Logic إلى `AccountingAppService`
3. استخدام `IAccountingRepository` الموجود
4. تحديث DI Container

**الأولوية:** 🔴 عالية جداً

---

### 2. **process-costing-service.ts** 🔴

**الحجم المتوقع:** متوسط-كبير (400+ سطر)  
**Dependencies:**
- Manufacturing Orders
- Material Costs
- Labor Costs
- Overhead Costs
- Process Stages

**التحديات:**
- منطق معقد لحساب التكاليف
- يحتاج Use Cases في Domain

**الخطة:**
1. إنشاء `ProcessCostingAppService` في Application
2. استخدام `CalculateProcessCostUseCase` الموجود
3. استخدام `IProcessCostingRepository` الموجود
4. تحديث DI Container

**الأولوية:** 🔴 عالية جداً

---

### 3. **inventory-transaction-service.ts** ⚠️

**الحجم المتوقع:** متوسط (300+ سطر)  
**Dependencies:**
- Stock movements
- Availability checks
- Reservations

**التحديات:**
- **قد يكون Infrastructure وليس Application!**
- يحتاج مراجعة دقيقة

**الخطة:**
1. مراجعة الكود أولاً
2. تحديد: Application Service أم Infrastructure Repository؟
3. إذا كان Application: نقل إلى `application/services/`
4. إذا كان Infrastructure: نقل إلى `infrastructure/repositories/`

**الأولوية:** 🟡 متوسطة (بعد المراجعة)

---

## 📝 Checklist قبل النقل

### **لكل Service:**
- [ ] قراءة الكود بالكامل
- [ ] تحديد Dependencies
- [ ] فحص الاختبارات الحالية
- [ ] إنشاء Interface (إذا لزم)
- [ ] كتابة Integration Tests
- [ ] نقل الكود مع التحديثات
- [ ] تحديث Imports
- [ ] تحديث DI Container
- [ ] اختبار الكود الجديد
- [ ] حذف الملف القديم
- [ ] توثيق التغييرات

---

## 🎯 الأولويات للبداية

### **Day 1 (اليوم):**
1. ✅ تحليل Legacy Services (مكتمل)
2. ⏳ قراءة `accounting-service.ts`
3. ⏳ قراءة `process-costing-service.ts`
4. ⏳ إنشاء Interfaces المطلوبة

### **Day 2:**
5. إضافة Integration Tests
6. نقل `process-costing-service.ts` (الأسهل)
7. اختبار الكود المنقول

### **Day 3:**
8. نقل `accounting-service.ts`
9. اختبار الكود المنقول
10. توثيق التغييرات

---

## 📊 Progress Tracking

| Service | Status | Tests | Migrated | Tested | Docs |
|---------|--------|-------|----------|--------|------|
| valuation/ | ✅ | ✅ | ✅ | ⏳ | ✅ |
| accounting-service | ⏳ | ❌ | ❌ | ❌ | ❌ |
| process-costing-service | ⏳ | ❌ | ❌ | ❌ | ❌ |
| inventory-transaction | ⏳ | ❌ | ❌ | ❌ | ❌ |

---

## ⚠️ ملاحظات مهمة

### **Backward Compatibility:**
- نحتاج الحفاظ على backward compatibility
- استخدام Facade Pattern للواجهة القديمة
- تدرج في التحديث

### **Testing Strategy:**
- Integration Tests قبل النقل
- Unit Tests للكود الجديد
- Regression Tests بعد النقل

### **Documentation:**
- Migration Guide لكل Service
- Update imports guide
- Breaking changes log

---

## 🎉 Expected Results

بنهاية Week 2-3:
- ✅ 3-5 Core Services منقولة
- ✅ Clean Architecture Score: 100%
- ✅ Test Coverage: +5-10%
- ✅ TypeScript Coverage: 98%+
- ✅ Documentation: كامل

---

**Status:** ⏳ في التنفيذ  
**Next:** قراءة وتحليل Core Services

**آخر تحديث:** 13 ديسمبر 2025


