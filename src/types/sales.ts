// src/types/sales.ts
// Sales module type definitions

export interface Customer {
  id: string
  org_id: string
  customer_code: string
  name: string
  contact_person: string
  email: string
  phone: string
  address: string
  city: string
  country: string
  payment_terms: string
  credit_limit: number
  currency: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface SalesOrder {
  id: string
  org_id: string
  so_number: string
  customer_id: string
  order_date: string
  expected_delivery_date: string
  status: 'draft' | 'confirmed' | 'shipped' | 'partially_shipped' | 'cancelled'
  total_amount: number
  currency: string
  notes: string
  created_at: string
  updated_at: string
}

export interface SalesOrderLine {
  id: string
  org_id: string
  so_id: string
  item_id: string
  quantity: number
  unit_price: number
  total_price: number
  shipped_quantity: number
  pending_quantity: number
  created_at: string
}