# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
