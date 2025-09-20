// src/types/purchasing.ts
// Purchasing module type definitions

export interface Supplier {
  id: string
  org_id: string
  supplier_code: string
  name: string
  contact_person: string
  email: string
  phone: string
  address: string
  city: string
  country: string
  payment_terms: string
  currency: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface PurchaseOrder {
  id: string
  org_id: string
  po_number: string
  supplier_id: string
  order_date: string
  expected_delivery_date: string
  status: 'draft' | 'confirmed' | 'received' | 'partially_received' | 'cancelled'
  total_amount: number
  currency: string
  notes: string
  created_at: string
  updated_at: string
}

export interface PurchaseOrderLine {
  id: string
  org_id: string
  po_id: string
  item_id: string
  quantity: number
  unit_price: number
  total_price: number
  received_quantity: number
  pending_quantity: number
  created_at: string
}