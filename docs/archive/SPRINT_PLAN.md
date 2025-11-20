# 🏃‍♂️ Sprint Planning - Wardah ERP
## خطة العمل السريعة (Sprint-by-Sprint)

---

## 📌 **Current Sprint: Phase 0 - Foundation** 
**Duration**: Week 1-2 (Nov 8 - Nov 21, 2025)  
**Status**: 🔄 In Progress

### 🎯 Sprint Goals
1. إكمال اختبار دورة المشتريات الكاملة
2. إصلاح جميع الأخطاء الحالية
3. توثيق العمليات الأساسية

### 📝 Sprint Backlog

#### Week 1: Testing & Bug Fixes
- [ ] **Day 1-2: Purchase Order Testing**
  - [ ] إنشاء PO جديد مع بيانات كاملة
  - [ ] التحقق من حفظ البيانات في قاعدة البيانات
  - [ ] اختبار حساب الإجماليات (Subtotal, Tax, Discount, Total)
  - [ ] التحقق من ربط المنتجات بالموردين
  - [ ] اختبار حالات الخطأ (Missing vendor, Empty items)
  - [ ] 🐛 FIX: إزالة عناصر الفئات من قائمة المنتجات
  
- [ ] **Day 3-4: Goods Receipt Testing**
  - [ ] إنشاء GR من PO موجود
  - [ ] التحقق من تحديث الكميات المستلمة في PO
  - [ ] التحقق من إنشاء قيود المخزون (Stock entries)
  - [ ] اختبار الاستلام الجزئي (Partial receipt)
  - [ ] التحقق من تحديث أرصدة المخزون (Inventory balances)
  - [ ] 🐛 FIX: التحقق من حساب AVCO بشكل صحيح
  
- [ ] **Day 5: Purchase Invoice Testing**
  - [ ] إنشاء PI من PO أو GR
  - [ ] التحقق من إنشاء القيود المحاسبية (GL Entries)
  - [ ] اختبار حساب الضرائب والخصومات
  - [ ] التحقق من تحديث الحسابات الدائنة (AP)
  - [ ] 🐛 FIX: التحقق من الربط مع Chart of Accounts

#### Week 2: Integration & Documentation
- [ ] **Day 6-7: Trial Balance Verification**
  - [ ] عرض جميع الحسابات والأرصدة
  - [ ] التحقق من توازن المدين والدائن
  - [ ] مراجعة القيود المحاسبية من PI
  - [ ] اختبار مع بيانات متعددة
  - [ ] إنشاء تقرير اختبار شامل
  
- [ ] **Day 8-9: Sales Cycle Testing**
  - [ ] اختبار Sales Invoice
  - [ ] اختبار Delivery Note
  - [ ] التحقق من تحديث المخزون عند البيع
  - [ ] التحقق من القيود المحاسبية للمبيعات
  
- [ ] **Day 10: Code Review & Refactoring**
  - [ ] مراجعة كود purchasing-service.ts
  - [ ] تحسين error handling
  - [ ] إضافة validation rules
  - [ ] توثيق الوظائف الرئيسية

### 📊 Success Criteria
- ✅ دورة مشتريات كاملة تعمل بدون أخطاء
- ✅ Trial Balance متوازن
- ✅ جميع القيود المحاسبية صحيحة
- ✅ توثيق شامل للعمليات

### 🚧 Known Issues
1. Category items appearing in product list
2. Calendar RTL alignment (RESOLVED ✅)
3. Need to verify AVCO calculation accuracy

---

## 🔮 **Next Sprint: Phase 1 - Architecture** 
**Duration**: Week 3-4 (Nov 22 - Dec 5, 2025)  
**Status**: 📅 Planned

### 🎯 Sprint Goals
1. إعادة تنظيم هيكل المشروع بنظام Modules
2. إنشاء Base Controllers
3. فصل Business Logic عن UI

### 📝 Planned Tasks

#### Week 3: Module Structure
- [ ] **Create Module Folders**
  ```
  src/modules/
  ├── purchasing/
  │   ├── controllers/
  │   │   └── PurchaseOrderController.ts
  │   ├── services/
  │   │   └── purchasing-service.ts
  │   ├── types/
  │   │   └── purchase-order.types.ts
  │   └── components/
  │       └── PurchaseOrderForm.tsx
  ├── inventory/
  ├── manufacturing/
  ├── costing/
  └── accounting/
  ```

- [ ] **Create Base Controllers**
  - [ ] BaseController.ts - Generic CRUD operations
  - [ ] StockController.ts - Stock movement logic
  - [ ] AccountsController.ts - GL entry logic
  - [ ] BuyingController.ts - Purchase cycle logic
  - [ ] SellingController.ts - Sales cycle logic

- [ ] **Migrate Existing Code**
  - [ ] Move PurchaseOrderForm to modules/purchasing
  - [ ] Move GoodsReceiptForm to modules/inventory
  - [ ] Move services to appropriate modules
  - [ ] Update import paths

#### Week 4: Service Layer
- [ ] **Core Services**
  - [ ] DocumentService.ts - Generic document operations
  - [ ] ValidationService.ts - Centralized validation
  - [ ] WorkflowService.ts - Document workflows
  - [ ] PermissionService.ts - Access control (basic)

- [ ] **Testing**
  - [ ] Unit tests for base controllers
  - [ ] Integration tests for services
  - [ ] Update E2E tests

### 📊 Success Criteria
- ✅ Clean modular structure
- ✅ All existing features working after refactoring
- ✅ Improved code organization
- ✅ Better separation of concerns

---

## 🚀 **Sprint 3: Stock Ledger Foundation**
**Duration**: Week 5-6 (Dec 6 - Dec 19, 2025)  
**Status**: 📅 Planned

### 🎯 Sprint Goals
1. إنشاء جدول Stock Ledger Entries
2. إنشاء Bins table
3. تطبيق Stock Ledger Service

### 📝 Key Tasks
- [ ] Create database schema for SLE
- [ ] Create Bins table
- [ ] Implement StockLedgerService
- [ ] Create RLS policies
- [ ] Migrate existing stock logic
- [ ] Add comprehensive tests

---

## 📅 **Sprint Schedule Overview**

| Sprint | Weeks | Phase | Focus |
|--------|-------|-------|-------|
| 0 | 1-2 | Foundation | Testing & Bug Fixes |
| 1 | 3-4 | Architecture | Module Structure |
| 2 | 5-6 | Stock Ledger | SLE System |
| 3 | 7-8 | Valuation | FIFO/LIFO/AVCO |
| 4 | 9-11 | Manufacturing | BOM System |
| 5 | 12-13 | Purchasing | Enhanced Cycle |
| 6 | 14 | Quality | QA System |
| 7 | 15-16 | Costing | Advanced Costing |

---

## 🎯 **Daily Standup Template**

### Yesterday
- ✅ What did I accomplish?
- 🐛 What issues did I find?

### Today
- 🎯 What will I work on?
- 📚 What do I need to learn?

### Blockers
- 🚧 What's blocking me?
- 🤝 Who can help?

---

## 📈 **Progress Tracking**

### Current Sprint Progress
```
Testing Progress:     [████░░░░░░] 40%
Bug Fixes:           [██████░░░░] 60%
Documentation:       [██░░░░░░░░] 20%
Overall:             [████░░░░░░] 40%
```

### Velocity Tracking
- **Target**: 20 story points per sprint
- **Completed**: TBD
- **In Progress**: Phase 0

---

## 🏆 **Definition of Done**

A task is considered DONE when:
- ✅ Code is written and reviewed
- ✅ Unit tests pass (>80% coverage)
- ✅ Integration tests pass
- ✅ Documentation is updated
- ✅ No critical bugs
- ✅ Code is merged to main branch
- ✅ Feature is deployed to staging

---

## 🔄 **Sprint Retrospective Template**

### What went well? 🎉
- 

### What didn't go well? 😓
- 

### What can we improve? 💡
- 

### Action Items 📋
- [ ] 
- [ ] 

---

## 📞 **Team Communication**

### Daily Sync
- **Time**: 10:00 AM (local time)
- **Duration**: 15 minutes
- **Platform**: Discord/Teams/Slack

### Weekly Review
- **Time**: Friday 3:00 PM
- **Duration**: 1 hour
- **Agenda**: Demo + Retrospective + Planning

---

**Last Updated**: November 8, 2025  
**Sprint Master**: Development Team  
**Product Owner**: Wardah Business Team

---

> "Sprint by sprint, we build excellence!" 🚀
