/**
 * @fileoverview Application Services Index
 * @description تصدير جميع خدمات طبقة التطبيق
 */

// Inventory
export { 
  InventoryAppService, 
  getInventoryAppService,
  resetInventoryAppService 
} from './InventoryAppService'
export type { 
  ProductListFilters, 
  ProductListResult,
  StockMovementFilters,
  StockMovementResult,
  StockAdjustmentInput,
  StockTransferInput
} from './InventoryAppService'

// Accounting
export { 
  AccountingAppService, 
  getAccountingAppService,
  resetAccountingAppService 
} from './AccountingAppService'
export type { 
  AccountListFilters,
  JournalEntryInput,
  JournalEntryLineInput,
  AccountStatementFilters,
  AccountStatementResult,
  FinancialReportOptions,
  DashboardMetrics
} from './AccountingAppService'
