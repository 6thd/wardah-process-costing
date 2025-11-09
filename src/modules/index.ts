/**
 * Wardah ERP - Modules Index
 * 
 * Centralized export for all ERP modules
 * Inspired by ERPNext's modular architecture
 */

// Core Controllers
export * from './core'

// Purchasing Module
export * from './purchasing'

// Inventory Module - export specific items to avoid conflicts
export { StockLedgerService, type Bin, type StockBalance } from './inventory'

// Manufacturing Module (to be implemented in Phase 4)
// export * from './manufacturing'

// Costing Module (to be implemented in Phase 7)
// export * from './costing'

// Accounting Module (to be implemented later)
// export * from './accounting'
