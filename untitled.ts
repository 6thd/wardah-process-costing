/// <reference types="vite/client" />
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false
  }
})

// Types for your ERP system
export interface User {
  id: string
  email: string
  full_name?: string
  role: 'admin' | 'manager' | 'employee'
  created_at: string
  updated_at: string
}

export interface Item {
  id: string
  code: string
  name: string
  name_ar: string
  description?: string
  unit: string
  category: string
  cost_price: number
  selling_price: number
  stock_quantity: number
  minimum_stock: number
  created_at: string
  updated_at: string
}

export interface ManufacturingOrder {
  id: string
  order_number: string
  item_id: string
  quantity: number
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  start_date: string
  end_date?: string
  total_cost: number
  created_by: string
  created_at: string
  updated_at: string
}

export interface ProcessCost {
  id: string
  manufacturing_order_id: string
  process_name: string
  process_name_ar: string
  material_cost: number
  labor_cost: number
  overhead_cost: number
  total_cost: number
  created_at: string
}