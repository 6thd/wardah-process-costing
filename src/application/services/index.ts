/**
 * @fileoverview Application Services Index
 * @description تصدير جميع خدمات طبقة التطبيق
 */

// Inventory Service
export { InventoryAppService } from './InventoryAppService'
export type { 
  ProductListFilters, 
  ProductListResult,
  StockMovementFilters,
  StockMovementResult,
  StockAdjustmentInput,
  StockTransferInput
} from './InventoryAppService'

// Accounting Service - export class and singleton from the service file
export { 
  AccountingAppService, 
  getAccountingAppService, 
  resetAccountingAppService 
} from './AccountingAppService'
export type { 
  AccountListFilters,
  AccountListResult,
  JournalEntryFilters,
  CreateJournalEntryInput
} from './AccountingAppService'

// Inventory Valuation Service
export { InventoryValuationAppService } from './InventoryValuationAppService'

// Process Costing Service
export { ProcessCostingAppService } from './ProcessCostingAppService'

// ===== Singleton Getters =====

// Inventory singleton
let inventoryServiceInstance: InstanceType<typeof import('./InventoryAppService').InventoryAppService> | null = null
export function getInventoryAppService() {
  if (!inventoryServiceInstance) {
    const { InventoryAppService } = require('./InventoryAppService')
    inventoryServiceInstance = new InventoryAppService()
  }
  return inventoryServiceInstance
}
export function resetInventoryAppService() {
  inventoryServiceInstance = null
}

// ===== Type aliases for backward compatibility =====
// JournalEntryInput is an alias for CreateJournalEntryInput
export type JournalEntryInput = {
  entryDate: string
  referenceType: string
  referenceId: string
  description: string
  lines: Array<{
    accountCode: string
    accountName: string
    debit: number
    credit: number
    description?: string
  }>
}

export interface JournalEntryLineInput {
  accountCode: string
  accountName: string
  debit: number
  credit: number
  description?: string
}

export interface AccountStatementFilters {
  accountCode: string
  fromDate?: string
  toDate?: string
  page?: number
  pageSize?: number
}

export interface AccountStatementResult {
  entries: Array<{
    date: string
    description: string
    debit: number
    credit: number
    balance: number
  }>
  openingBalance: number
  closingBalance: number
  totalDebit: number
  totalCredit: number
}

export interface FinancialReportOptions {
  fromDate: string
  toDate: string
  includeZeroBalances?: boolean
  format?: 'detailed' | 'summary'
}

export interface DashboardMetrics {
  totalAccounts: number
  activeAccounts: number
  totalAssets: number
  totalLiabilities: number
  totalRevenue: number
  totalExpenses: number
}
