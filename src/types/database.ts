// src/types/database.ts
// Database schema types for Supabase integration

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string;
          name: string;
          code: string;
          address: string | null;
          phone: string | null;
          email: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          code: string;
          address?: string | null;
          phone?: string | null;
          email?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          code?: string;
          address?: string | null;
          phone?: string | null;
          email?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      gl_accounts: {
        Row: {
          id: string;
          org_id: string;
          code: string;
          name: string;
          name_ar: string | null;
          category: string;
          subtype: string;
          parent_code: string | null;
          path: string | null;
          normal_balance: string;
          allow_posting: boolean;
          is_active: boolean;
          currency: string;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          code: string;
          name: string;
          name_ar?: string | null;
          category: string;
          subtype: string;
          parent_code?: string | null;
          path?: string | null;
          normal_balance: string;
          allow_posting: boolean;
          is_active: boolean;
          currency: string;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          code?: string;
          name?: string;
          name_ar?: string | null;
          category?: string;
          subtype?: string;
          parent_code?: string | null;
          path?: string | null;
          normal_balance?: string;
          allow_posting?: boolean;
          is_active?: boolean;
          currency?: string;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      gl_mappings: {
        Row: {
          id: string;
          org_id: string;
          event_type: string;
          account_code: string;
          description: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          event_type: string;
          account_code: string;
          description?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          event_type?: string;
          account_code?: string;
          description?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      products: {
        Row: {
          id: string;
          org_id: string;
          code: string;
          name: string;
          name_ar: string;
          description: string | null;
          uom_id: string;
          standard_cost: number;
          last_cost: number;
          average_cost: number;
          category_id: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          code: string;
          name: string;
          name_ar: string;
          description?: string | null;
          uom_id: string;
          standard_cost?: number;
          last_cost?: number;
          average_cost?: number;
          category_id?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          code?: string;
          name?: string;
          name_ar?: string;
          description?: string | null;
          uom_id?: string;
          standard_cost?: number;
          last_cost?: number;
          average_cost?: number;
          category_id?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      uoms: {
        Row: {
          id: string;
          org_id: string;
          code: string;
          name: string;
          name_ar: string;
          description: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          code: string;
          name: string;
          name_ar: string;
          description?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          code?: string;
          name?: string;
          name_ar?: string;
          description?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      warehouses: {
        Row: {
          id: string;
          org_id: string;
          code: string;
          name: string;
          name_ar: string;
          location: string | null;
          manager_id: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          code: string;
          name: string;
          name_ar: string;
          location?: string | null;
          manager_id?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          code?: string;
          name?: string;
          name_ar?: string;
          location?: string | null;
          manager_id?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      locations: {
        Row: {
          id: string;
          org_id: string;
          warehouse_id: string;
          code: string;
          name: string;
          name_ar: string;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          warehouse_id: string;
          code: string;
          name: string;
          name_ar: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          warehouse_id?: string;
          code?: string;
          name?: string;
          name_ar?: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      bom_headers: {
        Row: {
          id: string;
          org_id: string;
          product_id: string;
          version: string;
          effective_date: string;
          expiry_date: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          product_id: string;
          version: string;
          effective_date: string;
          expiry_date?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          product_id?: string;
          version?: string;
          effective_date?: string;
          expiry_date?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      bom_lines: {
        Row: {
          id: string;
          org_id: string;
          bom_header_id: string;
          component_id: string;
          quantity: number;
          uom_id: string;
          sequence: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          bom_header_id: string;
          component_id: string;
          quantity: number;
          uom_id: string;
          sequence?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          bom_header_id?: string;
          component_id?: string;
          quantity?: number;
          uom_id?: string;
          sequence?: number;
          created_at?: string;
          updated_at?: string;
        };
      };
      manufacturing_orders: {
        Row: {
          id: string;
          org_id: string;
          order_number: string;
          product_id: string;
          quantity: number;
          status: string;
          start_date: string;
          due_date: string | null;
          completed_date: string | null;
          total_cost: number;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          order_number: string;
          product_id: string;
          quantity: number;
          status?: string;
          start_date: string;
          due_date?: string | null;
          completed_date?: string | null;
          total_cost?: number;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          order_number?: string;
          product_id?: string;
          quantity?: number;
          status?: string;
          start_date?: string;
          due_date?: string | null;
          completed_date?: string | null;
          total_cost?: number;
          created_by?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      work_centers: {
        Row: {
          id: string;
          org_id: string;
          code: string;
          name: string;
          name_ar: string;
          description: string | null;
          hourly_rate: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          code: string;
          name: string;
          name_ar: string;
          description?: string | null;
          hourly_rate?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          code?: string;
          name?: string;
          name_ar?: string;
          description?: string | null;
          hourly_rate?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      labor_entries: {
        Row: {
          id: string;
          org_id: string;
          mo_id: string;
          work_center_id: string;
          employee_id: string | null;
          start_time: string;
          end_time: string | null;
          hours_worked: number | null;
          hourly_rate: number;
          total_cost: number;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          mo_id: string;
          work_center_id: string;
          employee_id?: string | null;
          start_time: string;
          end_time?: string | null;
          hours_worked?: number | null;
          hourly_rate?: number;
          total_cost?: number;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          mo_id?: string;
          work_center_id?: string;
          employee_id?: string | null;
          start_time?: string;
          end_time?: string | null;
          hours_worked?: number | null;
          hourly_rate?: number;
          total_cost?: number;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      overhead_rates: {
        Row: {
          id: string;
          org_id: string;
          work_center_id: string;
          rate_type: string;
          rate_value: number;
          effective_date: string;
          expiry_date: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          work_center_id: string;
          rate_type: string;
          rate_value: number;
          effective_date: string;
          expiry_date?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          work_center_id?: string;
          rate_type?: string;
          rate_value?: number;
          effective_date?: string;
          expiry_date?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      overhead_allocations: {
        Row: {
          id: string;
          org_id: string;
          mo_id: string;
          work_center_id: string;
          allocation_base: string;
          base_amount: number;
          overhead_rate: number;
          allocated_amount: number;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          mo_id: string;
          work_center_id: string;
          allocation_base: string;
          base_amount: number;
          overhead_rate: number;
          allocated_amount?: number;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          mo_id?: string;
          work_center_id?: string;
          allocation_base?: string;
          base_amount?: number;
          overhead_rate?: number;
          allocated_amount?: number;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      stock_moves: {
        Row: {
          id: string;
          org_id: string;
          product_id: string;
          move_type: string;
          quantity: number;
          uom_id: string;
          source_location_id: string | null;
          destination_location_id: string | null;
          reference_type: string | null;
          reference_id: string | null;
          notes: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          product_id: string;
          move_type: string;
          quantity: number;
          uom_id: string;
          source_location_id?: string | null;
          destination_location_id?: string | null;
          reference_type?: string | null;
          reference_id?: string | null;
          notes?: string | null;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          product_id?: string;
          move_type?: string;
          quantity?: number;
          uom_id?: string;
          source_location_id?: string | null;
          destination_location_id?: string | null;
          reference_type?: string | null;
          reference_id?: string | null;
          notes?: string | null;
          created_by?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      stock_quants: {
        Row: {
          id: string;
          org_id: string;
          product_id: string;
          location_id: string;
          quantity: number;
          reserved_quantity: number;
          average_cost: number;
          lot_number: string | null;
          expiry_date: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          product_id: string;
          location_id: string;
          quantity?: number;
          reserved_quantity?: number;
          average_cost?: number;
          lot_number?: string | null;
          expiry_date?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          product_id?: string;
          location_id?: string;
          quantity?: number;
          reserved_quantity?: number;
          average_cost?: number;
          lot_number?: string | null;
          expiry_date?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      purchase_orders: {
        Row: {
          id: string;
          org_id: string;
          order_number: string;
          supplier_id: string;
          order_date: string;
          expected_delivery_date: string | null;
          status: string;
          total_amount: number;
          currency: string;
          notes: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          order_number: string;
          supplier_id: string;
          order_date: string;
          expected_delivery_date?: string | null;
          status?: string;
          total_amount?: number;
          currency?: string;
          notes?: string | null;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          order_number?: string;
          supplier_id?: string;
          order_date?: string;
          expected_delivery_date?: string | null;
          status?: string;
          total_amount?: number;
          currency?: string;
          notes?: string | null;
          created_by?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      purchase_lines: {
        Row: {
          id: string;
          org_id: string;
          purchase_order_id: string;
          product_id: string;
          quantity: number;
          unit_price: number;
          total_price: number;
          received_quantity: number;
          pending_quantity: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          purchase_order_id: string;
          product_id: string;
          quantity: number;
          unit_price: number;
          total_price?: number;
          received_quantity?: number;
          pending_quantity?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          purchase_order_id?: string;
          product_id?: string;
          quantity?: number;
          unit_price?: number;
          total_price?: number;
          received_quantity?: number;
          pending_quantity?: number;
          created_at?: string;
          updated_at?: string;
        };
      };
      sales_orders: {
        Row: {
          id: string;
          org_id: string;
          order_number: string;
          customer_id: string;
          order_date: string;
          expected_delivery_date: string | null;
          status: string;
          total_amount: number;
          currency: string;
          notes: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          order_number: string;
          customer_id: string;
          order_date: string;
          expected_delivery_date?: string | null;
          status?: string;
          total_amount?: number;
          currency?: string;
          notes?: string | null;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          order_number?: string;
          customer_id?: string;
          order_date?: string;
          expected_delivery_date?: string | null;
          status?: string;
          total_amount?: number;
          currency?: string;
          notes?: string | null;
          created_by?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      sales_lines: {
        Row: {
          id: string;
          org_id: string;
          sales_order_id: string;
          product_id: string;
          quantity: number;
          unit_price: number;
          total_price: number;
          shipped_quantity: number;
          pending_quantity: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          sales_order_id: string;
          product_id: string;
          quantity: number;
          unit_price: number;
          total_price?: number;
          shipped_quantity?: number;
          pending_quantity?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          sales_order_id?: string;
          product_id?: string;
          quantity?: number;
          unit_price?: number;
          total_price?: number;
          shipped_quantity?: number;
          pending_quantity?: number;
          created_at?: string;
          updated_at?: string;
        };
      };
      invoices: {
        Row: {
          id: string;
          org_id: string;
          invoice_number: string;
          invoice_type: string;
          customer_id: string | null;
          supplier_id: string | null;
          invoice_date: string;
          due_date: string;
          status: string;
          total_amount: number;
          currency: string;
          notes: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          invoice_number: string;
          invoice_type: string;
          customer_id?: string | null;
          supplier_id?: string | null;
          invoice_date: string;
          due_date: string;
          status?: string;
          total_amount?: number;
          currency?: string;
          notes?: string | null;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          invoice_number?: string;
          invoice_type?: string;
          customer_id?: string | null;
          supplier_id?: string | null;
          invoice_date?: string;
          due_date?: string;
          status?: string;
          total_amount?: number;
          currency?: string;
          notes?: string | null;
          created_by?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
  };
}