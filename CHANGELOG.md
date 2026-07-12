# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [P13] - 2026-07-12 — إغلاق مراجعة كودكس (أمان الرواتب وRBAC والتقارير)

سجل متابعة الملاحظات (السجل الأمني التفصيلي مع نتائج التحقق الحي:
`docs/security/PAYROLL_SECURITY_LOG.md`):

| الملاحظة | الوصف المختصر | الدفعة/الملف | الحالة |
|---|---|---|---|
| P0-1 | 97 أعادت فتح `wardah_apply_stock_incoming` | Migration 101 §2 | ✅ كود + اختبار |
| P0-2 | اعتماد المسير/التسوية بعضوية فقط | 101 §4-5 (`wardah_is_org_admin` قبل الـreplay) | ✅ |
| P0-3 | الثقة بأرقام العميل | 101 عقد payload_version=2 (totals/buckets من السطور) | ✅ |
| P0-سرية | كل عضو يقرأ رواتب الجميع | 101 §6 (SELECT admin-only على جداول المبالغ) | ✅ |
| P1-4 | لا تحقق موظف↔مؤسسة | 101 §3-4 (EMPLOYEE_ORG_MISMATCH + FK مركب) | ✅ |
| P1-5/6 | RLS متساهلة (HR + org_settings) | 101 §6-7 (كتابة خلف البوابة، إسقاط ديناميكي) | ✅ |
| P1-7 | مفتاح COGS خاطئ (sale_delivery% ≠ COGS_DELIVERY) | دفعة التقارير (`COGS_EVENT_KEYS` + تحقق EXPENSE) | ✅ |
| P1-8 | اللوحة: ربح = فواتير − أوامر شراء | دفعة التقارير (COGS من GL بتاريخ القيد) | ✅ |
| P1-9 | أخطاء GL مهملة | دفعة التقارير (فحص كل نتيجة منفردة، Fail-visible) | ✅ |
| P1-10 | فواتير بلا فلتر حالة/فترة | استبعاد cancelled + معاملات فترة (اشتراط الترحيل بعد إصلاح دورة حالة الفاتورة — Backlog) | ✅ مرحلي |
| P1-11 | تسوية بلا hash + إنهاء فوري | Migration 102 (draft→review→approved + snapshot/hash + حراس) | ✅ |
| P2-12 | تصدير «كامل» جزئي | إعادة تسمية + gl_entry_lines | ✅ |
| P2-13 | percentage_base مُهمل | تفعيل basic/basic_housing + CHECK + واجهة | ✅ |
| E1 | ازدواج تعديل الأوفرتايم في القسيمة | إصلاح المحرك + اختبار عقد | ✅ |
| E7 | الإنهاء لا يحدث من الواجهة (settlement_type يحمل نوع الإنهاء) | 102 (termination_type مستقل + ترحيل) | ✅ |
| E8 | كود HOUSING لا يُصنّف سكناً ⇒ خارج وعاء GOSI | إصلاح المصنّف (HOUS) | ✅ |
| كاش | ['effective-org-id'] يعبر تبديل الحسابات | queryClient.clear() عند تغيّر الهوية | ✅ |

**Backlog موثق** (مرحلة نظام أدوار HR القادمة): إعادة الحساب الخادمي الكامل
للرواتب؛ أدوار hr_manager/payroll_officer وself-service للموظف (يتطلب ربط
employees↔auth.uid)؛ فصل مراجع/معتمد إلزامي (four-eyes)؛ إصلاح دورة حالة
فاتورة المبيعات ثم اعتماد الإيراد من GL؛ عرض حقول GOSI في شاشة إعدادات HR؛
سياسات `employees/hr_*` القديمة؛ توسيع التصدير.

**شرط النشر**: Migration 101 والواجهة معاً (النسخ الأقدم تُرفض بـ
PAYLOAD_VERSION_UNSUPPORTED)، ثم 102. بعد التطبيق: تشغيل
`scripts/security/test_payroll_rbac.sql` وتسجيل النتائج في السجل الأمني —
بند FK لا يُغلق حتى convalidated=true.

## [2.1.0] - 2025-12-20

### Added
- **Test Coverage Expansion**: Added 102 new tests across core services
  - `process-costing-service.test.ts` (29 tests) - Labor time, overhead, stage costs, AVCO
  - `organization-service.test.ts` (21 tests) - Multi-tenant, user organizations
  - `rbac-service.test.ts` (16 tests) - Roles, permissions, modules
  - `stock-adjustment-service.test.ts` (20 tests) - Physical count, accounting integration
  - `usePermissions.test.ts` (16 tests) - Permission checking, cache, role scenarios

### Fixed
- Fixed missing imports in `AccountingOverview` component (`useNavigate`, Card components, Button)
- Fixed TypeScript error in `manufacturingOrderService.ts` (type casting)
- Fixed duplicate `lucide-react` imports in `modules.ts`

### Changed
- Total tests increased from 1760 to 1862
- All 85 test files now passing
- Updated testing documentation

## [2.0.0] - 2025-12-19

### Added
- **Clean Architecture Phase 2**: Legacy services migration
  - Extracted manufacturing service modules (`helpers.ts`, `updateStatus.ts`, `createOrder.ts`, `getById.ts`)
  - Created accounting feature components (`ModuleCard`, `QuickStats`, `modules.ts`)
  - Created manufacturing feature components (`ManufacturingOrderForm`, `ManufacturingQuickStats`)
  - Created inventory helpers (`stockAdjustmentHelpers.ts`)

### Changed
- Reduced cyclomatic complexity in 7 high-complexity functions:
  - `updateStatus`: 39 → ~5
  - `AccountingOverview`: 47 → ~10
  - `ManufacturingOrdersManagement`: 41 → ~15
  - `create`: 32 → ~5
  - `loadOrganizationData`: 28 → ~10
  - `getById`: 25 → ~5
  - `StockAdjustments`: 25 → ~15

### Fixed
- Resolved CodeFactor complexity issues
- Fixed Codacy static analysis issues (SET QUOTED_IDENTIFIER, hardcoded passwords)

## [1.0.0] - 2025-12-15

### Added
- Initial release with core features:
  - Process Costing Module
  - Double-Entry Accounting
  - Inventory Management (AVCO)
  - Manufacturing Orders
  - Multi-Tenant Architecture
  - Bilingual Support (Arabic/English)
  - HR Management Module
  - Purchase & Sales Modules

---

For older changes, see the [commit history](https://github.com/6thd/wardah-process-costing/commits/main).
