// src/types/inventory.ts
// Inventory and stock management type definitions

export interface Item {
  id: string
  org_id: string
  item_code: string
  name: string
  description: string
  category_id: string
  unit_of_measure: string
  standard_cost: number
  last_cost: number
  average_cost: number
  current_stock: number
  min_stock_level: number
  max_stock_level: number
  reorder_quantity: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface StockMovement {
  id: string
  org_id: string
  item_id: string
  transaction_type: 'receipt' | 'issue' | 'adjustment' | 'transfer'
  quantity: number
  unit_cost: number
  total_cost: number
  reference: string
  notes: string
  created_at: string
  created_by: string
}

export interface InventoryLedger {
  id: string
  org_id: string
  item_id: string
  transaction_id: string
  transaction_type: string
  quantity_change: number
  unit_cost: number
  running_balance: number
  running_total_cost: number
  created_at: string
}

export interface Location {
  id: string
  org_id: string
  name: string
  code: string
  description: string
  is_active: boolean
  created_at: string
  updated_at: string
}