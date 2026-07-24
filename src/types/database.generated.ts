export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      account_reconciliations: {
        Row: {
          account_id: string
          closing_balance: number
          created_at: string | null
          id: string
          notes: string | null
          opening_balance: number
          reconciled_amount: number
          reconciled_by: string | null
          reconciliation_date: string
          status: string
          tenant_id: string
          unreconciled_amount: number | null
          updated_at: string | null
        }
        Insert: {
          account_id: string
          closing_balance: number
          created_at?: string | null
          id?: string
          notes?: string | null
          opening_balance: number
          reconciled_amount: number
          reconciled_by?: string | null
          reconciliation_date: string
          status?: string
          tenant_id: string
          unreconciled_amount?: number | null
          updated_at?: string | null
        }
        Update: {
          account_id?: string
          closing_balance?: number
          created_at?: string | null
          id?: string
          notes?: string | null
          opening_balance?: number
          reconciled_amount?: number
          reconciled_by?: string | null
          reconciliation_date?: string
          status?: string
          tenant_id?: string
          unreconciled_amount?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "account_reconciliations_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      account_segments: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          parent_id: string | null
          segment_code: string
          segment_name: string
          segment_name_ar: string | null
          segment_type: string
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          parent_id?: string | null
          segment_code: string
          segment_name: string
          segment_name_ar?: string | null
          segment_type: string
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          parent_id?: string | null
          segment_code?: string
          segment_name?: string
          segment_name_ar?: string | null
          segment_type?: string
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "account_segments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "account_segments"
            referencedColumns: ["id"]
          },
        ]
      }
      accounting_periods: {
        Row: {
          created_at: string | null
          end_date: string
          fiscal_year: number
          id: string
          org_id: string
          period_code: string
          period_name: string
          period_type: string
          start_date: string
          status: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          end_date: string
          fiscal_year: number
          id?: string
          org_id: string
          period_code: string
          period_name: string
          period_type?: string
          start_date: string
          status?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          end_date?: string
          fiscal_year?: number
          id?: string
          org_id?: string
          period_code?: string
          period_name?: string
          period_type?: string
          start_date?: string
          status?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      accounts: {
        Row: {
          account_subtype: string | null
          account_type: string
          code: string
          created_at: string | null
          currency_code: string | null
          id: string
          is_active: boolean | null
          is_leaf: boolean | null
          name: string
          name_ar: string | null
          org_id: string
          parent_id: string | null
          updated_at: string | null
        }
        Insert: {
          account_subtype?: string | null
          account_type: string
          code: string
          created_at?: string | null
          currency_code?: string | null
          id?: string
          is_active?: boolean | null
          is_leaf?: boolean | null
          name: string
          name_ar?: string | null
          org_id: string
          parent_id?: string | null
          updated_at?: string | null
        }
        Update: {
          account_subtype?: string | null
          account_type?: string
          code?: string
          created_at?: string | null
          currency_code?: string | null
          id?: string
          is_active?: boolean | null
          is_leaf?: boolean | null
          name?: string
          name_ar?: string | null
          org_id?: string
          parent_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounts_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_records: {
        Row: {
          check_in_time: string | null
          check_out_time: string | null
          created_at: string | null
          employee_id: string
          hours_worked: number | null
          id: string
          leave_type: string | null
          notes: string | null
          org_id: string
          record_date: string
          status: string | null
          updated_at: string | null
        }
        Insert: {
          check_in_time?: string | null
          check_out_time?: string | null
          created_at?: string | null
          employee_id: string
          hours_worked?: number | null
          id?: string
          leave_type?: string | null
          notes?: string | null
          org_id: string
          record_date: string
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          check_in_time?: string | null
          check_out_time?: string | null
          created_at?: string | null
          employee_id?: string
          hours_worked?: number | null
          id?: string
          leave_type?: string | null
          notes?: string | null
          org_id?: string
          record_date?: string
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_records_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          changes: Json | null
          created_at: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: unknown
          metadata: Json | null
          new_data: Json | null
          old_data: Json | null
          org_id: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          changes?: Json | null
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          new_data?: Json | null
          old_data?: Json | null
          org_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          changes?: Json | null
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          new_data?: Json | null
          old_data?: Json | null
          org_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      bins: {
        Row: {
          actual_qty: number | null
          created_at: string | null
          id: string
          ordered_qty: number | null
          org_id: string | null
          planned_qty: number | null
          product_id: string
          projected_qty: number | null
          reserved_qty: number | null
          stock_queue: Json | null
          stock_value: number | null
          updated_at: string | null
          valuation_rate: number | null
          warehouse_id: string
        }
        Insert: {
          actual_qty?: number | null
          created_at?: string | null
          id?: string
          ordered_qty?: number | null
          org_id?: string | null
          planned_qty?: number | null
          product_id: string
          projected_qty?: number | null
          reserved_qty?: number | null
          stock_queue?: Json | null
          stock_value?: number | null
          updated_at?: string | null
          valuation_rate?: number | null
          warehouse_id: string
        }
        Update: {
          actual_qty?: number | null
          created_at?: string | null
          id?: string
          ordered_qty?: number | null
          org_id?: string | null
          planned_qty?: number | null
          product_id?: string
          projected_qty?: number | null
          reserved_qty?: number | null
          stock_queue?: Json | null
          stock_value?: number | null
          updated_at?: string | null
          valuation_rate?: number | null
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bins_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bins_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bins_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      bom_alternatives: {
        Row: {
          alternative_bom_id: string
          cost_difference: number | null
          cost_difference_pct: number | null
          created_at: string | null
          created_by: string | null
          effective_from: string | null
          effective_to: string | null
          id: string
          is_active: boolean | null
          is_default: boolean | null
          max_quantity: number | null
          min_quantity: number | null
          org_id: string
          primary_bom_id: string
          priority: number
          reason_code: string | null
          reason_description: string | null
          updated_at: string | null
        }
        Insert: {
          alternative_bom_id: string
          cost_difference?: number | null
          cost_difference_pct?: number | null
          created_at?: string | null
          created_by?: string | null
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          max_quantity?: number | null
          min_quantity?: number | null
          org_id: string
          primary_bom_id: string
          priority?: number
          reason_code?: string | null
          reason_description?: string | null
          updated_at?: string | null
        }
        Update: {
          alternative_bom_id?: string
          cost_difference?: number | null
          cost_difference_pct?: number | null
          created_at?: string | null
          created_by?: string | null
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          max_quantity?: number | null
          min_quantity?: number | null
          org_id?: string
          primary_bom_id?: string
          priority?: number
          reason_code?: string | null
          reason_description?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bom_alternatives_alternative_bom_id_fkey"
            columns: ["alternative_bom_id"]
            isOneToOne: false
            referencedRelation: "bom_headers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bom_alternatives_primary_bom_id_fkey"
            columns: ["primary_bom_id"]
            isOneToOne: false
            referencedRelation: "bom_headers"
            referencedColumns: ["id"]
          },
        ]
      }
      bom_cost_analysis: {
        Row: {
          actual_labor_cost: number | null
          actual_material_cost: number | null
          actual_overhead_cost: number | null
          actual_total_cost: number | null
          actual_unit_cost: number | null
          analysis_date: string
          bom_id: string
          created_at: string | null
          created_by: string | null
          id: string
          labor_variance: number | null
          labor_variance_pct: number | null
          material_variance: number | null
          material_variance_pct: number | null
          notes: string | null
          org_id: string
          overhead_variance: number | null
          quantity: number
          standard_labor_cost: number | null
          standard_material_cost: number | null
          standard_overhead_cost: number | null
          standard_total_cost: number | null
          standard_unit_cost: number | null
          status: string | null
          total_variance: number | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          actual_labor_cost?: number | null
          actual_material_cost?: number | null
          actual_overhead_cost?: number | null
          actual_total_cost?: number | null
          actual_unit_cost?: number | null
          analysis_date?: string
          bom_id: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          labor_variance?: number | null
          labor_variance_pct?: number | null
          material_variance?: number | null
          material_variance_pct?: number | null
          notes?: string | null
          org_id: string
          overhead_variance?: number | null
          quantity?: number
          standard_labor_cost?: number | null
          standard_material_cost?: number | null
          standard_overhead_cost?: number | null
          standard_total_cost?: number | null
          standard_unit_cost?: number | null
          status?: string | null
          total_variance?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          actual_labor_cost?: number | null
          actual_material_cost?: number | null
          actual_overhead_cost?: number | null
          actual_total_cost?: number | null
          actual_unit_cost?: number | null
          analysis_date?: string
          bom_id?: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          labor_variance?: number | null
          labor_variance_pct?: number | null
          material_variance?: number | null
          material_variance_pct?: number | null
          notes?: string | null
          org_id?: string
          overhead_variance?: number | null
          quantity?: number
          standard_labor_cost?: number | null
          standard_material_cost?: number | null
          standard_overhead_cost?: number | null
          standard_total_cost?: number | null
          standard_unit_cost?: number | null
          status?: string | null
          total_variance?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bom_cost_analysis_bom_id_fkey"
            columns: ["bom_id"]
            isOneToOne: false
            referencedRelation: "bom_headers"
            referencedColumns: ["id"]
          },
        ]
      }
      bom_cost_details: {
        Row: {
          actual_total_cost: number | null
          actual_unit_cost: number | null
          cost_analysis_id: string
          created_at: string | null
          id: string
          item_id: string
          level_number: number
          org_id: string
          quantity_required: number
          standard_total_cost: number | null
          standard_unit_cost: number | null
          variance: number | null
          variance_pct: number | null
        }
        Insert: {
          actual_total_cost?: number | null
          actual_unit_cost?: number | null
          cost_analysis_id: string
          created_at?: string | null
          id?: string
          item_id: string
          level_number: number
          org_id: string
          quantity_required: number
          standard_total_cost?: number | null
          standard_unit_cost?: number | null
          variance?: number | null
          variance_pct?: number | null
        }
        Update: {
          actual_total_cost?: number | null
          actual_unit_cost?: number | null
          cost_analysis_id?: string
          created_at?: string | null
          id?: string
          item_id?: string
          level_number?: number
          org_id?: string
          quantity_required?: number
          standard_total_cost?: number | null
          standard_unit_cost?: number | null
          variance?: number | null
          variance_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bom_cost_details_cost_analysis_id_fkey"
            columns: ["cost_analysis_id"]
            isOneToOne: false
            referencedRelation: "bom_cost_analysis"
            referencedColumns: ["id"]
          },
        ]
      }
      bom_explosion_cache: {
        Row: {
          bom_id: string
          calculated_at: string | null
          id: string
          item_id: string
          level_number: number
          org_id: string
          parent_item_id: string | null
          quantity_required: number
          total_cost: number | null
          total_quantity: number
          unit_cost: number | null
        }
        Insert: {
          bom_id: string
          calculated_at?: string | null
          id?: string
          item_id: string
          level_number?: number
          org_id: string
          parent_item_id?: string | null
          quantity_required: number
          total_cost?: number | null
          total_quantity: number
          unit_cost?: number | null
        }
        Update: {
          bom_id?: string
          calculated_at?: string | null
          id?: string
          item_id?: string
          level_number?: number
          org_id?: string
          parent_item_id?: string | null
          quantity_required?: number
          total_cost?: number | null
          total_quantity?: number
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bom_explosion_cache_bom_id_fkey"
            columns: ["bom_id"]
            isOneToOne: false
            referencedRelation: "bom_headers"
            referencedColumns: ["id"]
          },
        ]
      }
      bom_headers: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          bom_number: string
          bom_version: number | null
          created_at: string | null
          effective_date: string | null
          id: string
          is_active: boolean | null
          item_id: string
          notes: string | null
          org_id: string
          quantity: number | null
          routing_id: string | null
          status: string | null
          unit_cost: number | null
          uom: string | null
          updated_at: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          bom_number: string
          bom_version?: number | null
          created_at?: string | null
          effective_date?: string | null
          id?: string
          is_active?: boolean | null
          item_id: string
          notes?: string | null
          org_id: string
          quantity?: number | null
          routing_id?: string | null
          status?: string | null
          unit_cost?: number | null
          uom?: string | null
          updated_at?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          bom_number?: string
          bom_version?: number | null
          created_at?: string | null
          effective_date?: string | null
          id?: string
          is_active?: boolean | null
          item_id?: string
          notes?: string | null
          org_id?: string
          quantity?: number | null
          routing_id?: string | null
          status?: string | null
          unit_cost?: number | null
          uom?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bom_headers_routing_id_fkey"
            columns: ["routing_id"]
            isOneToOne: false
            referencedRelation: "routings"
            referencedColumns: ["id"]
          },
        ]
      }
      bom_lines: {
        Row: {
          bom_id: string
          conversion_factor_snapshot: number | null
          created_at: string | null
          effective_from: string | null
          effective_to: string | null
          id: string
          is_critical: boolean | null
          item_id: string
          line_type: string | null
          notes: string | null
          operation_sequence: number | null
          org_id: string
          product_id: string | null
          qty_entered: number | null
          quantity: number
          quantity_base: number | null
          scrap_factor: number | null
          sequence: number | null
          uom: string | null
          uom_id: string | null
          yield_percentage: number | null
        }
        Insert: {
          bom_id: string
          conversion_factor_snapshot?: number | null
          created_at?: string | null
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          is_critical?: boolean | null
          item_id: string
          line_type?: string | null
          notes?: string | null
          operation_sequence?: number | null
          org_id: string
          product_id?: string | null
          qty_entered?: number | null
          quantity: number
          quantity_base?: number | null
          scrap_factor?: number | null
          sequence?: number | null
          uom?: string | null
          uom_id?: string | null
          yield_percentage?: number | null
        }
        Update: {
          bom_id?: string
          conversion_factor_snapshot?: number | null
          created_at?: string | null
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          is_critical?: boolean | null
          item_id?: string
          line_type?: string | null
          notes?: string | null
          operation_sequence?: number | null
          org_id?: string
          product_id?: string | null
          qty_entered?: number | null
          quantity?: number
          quantity_base?: number | null
          scrap_factor?: number | null
          sequence?: number | null
          uom?: string | null
          uom_id?: string | null
          yield_percentage?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bom_lines_bom_id_fkey"
            columns: ["bom_id"]
            isOneToOne: false
            referencedRelation: "bom_headers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bom_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bom_lines_uom_id_fkey"
            columns: ["uom_id"]
            isOneToOne: false
            referencedRelation: "uoms"
            referencedColumns: ["id"]
          },
        ]
      }
      bom_operation_materials: {
        Row: {
          created_at: string | null
          id: string
          issue_type: string | null
          item_id: string
          operation_id: string
          org_id: string
          quantity_required: number
          uom: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          issue_type?: string | null
          item_id: string
          operation_id: string
          org_id: string
          quantity_required: number
          uom?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          issue_type?: string | null
          item_id?: string
          operation_id?: string
          org_id?: string
          quantity_required?: number
          uom?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bom_operation_materials_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "bom_operations"
            referencedColumns: ["id"]
          },
        ]
      }
      bom_operations: {
        Row: {
          bom_id: string
          created_at: string | null
          id: string
          is_active: boolean | null
          is_critical: boolean | null
          labor_rate: number | null
          machine_rate: number | null
          move_time_minutes: number | null
          operation_code: string
          operation_description: string | null
          operation_name: string
          operation_sequence: number
          org_id: string
          overhead_rate: number | null
          queue_time_minutes: number | null
          run_cost_per_unit: number | null
          run_time_minutes: number | null
          setup_cost: number | null
          setup_time_minutes: number | null
          skill_level_required: string | null
          tooling_required: string | null
          total_cost_per_unit: number | null
          updated_at: string | null
          work_center_id: string | null
        }
        Insert: {
          bom_id: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_critical?: boolean | null
          labor_rate?: number | null
          machine_rate?: number | null
          move_time_minutes?: number | null
          operation_code: string
          operation_description?: string | null
          operation_name: string
          operation_sequence: number
          org_id: string
          overhead_rate?: number | null
          queue_time_minutes?: number | null
          run_cost_per_unit?: number | null
          run_time_minutes?: number | null
          setup_cost?: number | null
          setup_time_minutes?: number | null
          skill_level_required?: string | null
          tooling_required?: string | null
          total_cost_per_unit?: number | null
          updated_at?: string | null
          work_center_id?: string | null
        }
        Update: {
          bom_id?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_critical?: boolean | null
          labor_rate?: number | null
          machine_rate?: number | null
          move_time_minutes?: number | null
          operation_code?: string
          operation_description?: string | null
          operation_name?: string
          operation_sequence?: number
          org_id?: string
          overhead_rate?: number | null
          queue_time_minutes?: number | null
          run_cost_per_unit?: number | null
          run_time_minutes?: number | null
          setup_cost?: number | null
          setup_time_minutes?: number | null
          skill_level_required?: string | null
          tooling_required?: string | null
          total_cost_per_unit?: number | null
          updated_at?: string | null
          work_center_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bom_operations_bom_id_fkey"
            columns: ["bom_id"]
            isOneToOne: false
            referencedRelation: "bom_headers"
            referencedColumns: ["id"]
          },
        ]
      }
      bom_selection_rules: {
        Row: {
          condition_json: Json
          created_at: string | null
          created_by: string | null
          id: string
          is_active: boolean | null
          org_id: string
          priority: number
          rule_name: string
          rule_type: string
          updated_at: string | null
        }
        Insert: {
          condition_json: Json
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          org_id: string
          priority?: number
          rule_name: string
          rule_type: string
          updated_at?: string | null
        }
        Update: {
          condition_json?: Json
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          org_id?: string
          priority?: number
          rule_name?: string
          rule_type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      bom_settings: {
        Row: {
          description: string | null
          id: string
          org_id: string
          setting_key: string
          setting_type: string | null
          setting_value: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          description?: string | null
          id?: string
          org_id: string
          setting_key: string
          setting_type?: string | null
          setting_value?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          description?: string | null
          id?: string
          org_id?: string
          setting_key?: string
          setting_type?: string | null
          setting_value?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      bom_tree_cache: {
        Row: {
          bom_id: string
          calculated_at: string | null
          cumulative_quantity: number
          expires_at: string | null
          id: string
          is_critical: boolean | null
          item_id: string
          level_number: number
          line_type: string | null
          org_id: string
          parent_id: string | null
          path: string | null
          quantity_required: number
          scrap_factor: number | null
          total_cost: number | null
          unit_cost: number | null
        }
        Insert: {
          bom_id: string
          calculated_at?: string | null
          cumulative_quantity: number
          expires_at?: string | null
          id?: string
          is_critical?: boolean | null
          item_id: string
          level_number: number
          line_type?: string | null
          org_id: string
          parent_id?: string | null
          path?: string | null
          quantity_required: number
          scrap_factor?: number | null
          total_cost?: number | null
          unit_cost?: number | null
        }
        Update: {
          bom_id?: string
          calculated_at?: string | null
          cumulative_quantity?: number
          expires_at?: string | null
          id?: string
          is_critical?: boolean | null
          item_id?: string
          level_number?: number
          line_type?: string | null
          org_id?: string
          parent_id?: string | null
          path?: string | null
          quantity_required?: number
          scrap_factor?: number | null
          total_cost?: number | null
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bom_tree_cache_bom_id_fkey"
            columns: ["bom_id"]
            isOneToOne: false
            referencedRelation: "bom_headers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bom_tree_cache_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "bom_tree_cache"
            referencedColumns: ["id"]
          },
        ]
      }
      bom_versions: {
        Row: {
          bom_id: string
          change_description: string | null
          changed_at: string | null
          changed_by: string | null
          id: string
          org_id: string
          version_number: number
        }
        Insert: {
          bom_id: string
          change_description?: string | null
          changed_at?: string | null
          changed_by?: string | null
          id?: string
          org_id: string
          version_number: number
        }
        Update: {
          bom_id?: string
          change_description?: string | null
          changed_at?: string | null
          changed_by?: string | null
          id?: string
          org_id?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "bom_versions_bom_id_fkey"
            columns: ["bom_id"]
            isOneToOne: false
            referencedRelation: "bom_headers"
            referencedColumns: ["id"]
          },
        ]
      }
      bom_where_used: {
        Row: {
          component_id: string
          created_at: string | null
          id: string
          org_id: string
          parent_bom_id: string
          parent_item_id: string
          quantity_per: number
          updated_at: string | null
        }
        Insert: {
          component_id: string
          created_at?: string | null
          id?: string
          org_id: string
          parent_bom_id: string
          parent_item_id: string
          quantity_per: number
          updated_at?: string | null
        }
        Update: {
          component_id?: string
          created_at?: string | null
          id?: string
          org_id?: string
          parent_bom_id?: string
          parent_item_id?: string
          quantity_per?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bom_where_used_parent_bom_id_fkey"
            columns: ["parent_bom_id"]
            isOneToOne: false
            referencedRelation: "bom_headers"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string | null
          id: string
          name: string
          name_ar: string | null
          org_id: string | null
          tenant_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          name_ar?: string | null
          org_id?: string | null
          tenant_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          name_ar?: string | null
          org_id?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "categories_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_centers: {
        Row: {
          code: string
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          name_ar: string | null
          parent_id: string | null
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          code: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          name_ar?: string | null
          parent_id?: string | null
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          code?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          name_ar?: string | null
          parent_id?: string | null
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cost_centers_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
        ]
      }
      currency_exchange_rates: {
        Row: {
          created_at: string | null
          exchange_rate: number
          from_currency: string
          id: string
          is_active: boolean | null
          rate_date: string
          tenant_id: string
          to_currency: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          exchange_rate: number
          from_currency: string
          id?: string
          is_active?: boolean | null
          rate_date: string
          tenant_id: string
          to_currency: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          exchange_rate?: number
          from_currency?: string
          id?: string
          is_active?: boolean | null
          rate_date?: string
          tenant_id?: string
          to_currency?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      currency_translations: {
        Row: {
          created_at: string | null
          entry_id: string | null
          exchange_rate: number
          id: string
          line_id: string | null
          original_amount: number
          original_currency: string
          rate_date: string
          tenant_id: string
          translated_amount: number
          translated_currency: string
        }
        Insert: {
          created_at?: string | null
          entry_id?: string | null
          exchange_rate: number
          id?: string
          line_id?: string | null
          original_amount: number
          original_currency: string
          rate_date: string
          tenant_id: string
          translated_amount: number
          translated_currency: string
        }
        Update: {
          created_at?: string | null
          entry_id?: string | null
          exchange_rate?: number
          id?: string
          line_id?: string | null
          original_amount?: number
          original_currency?: string
          rate_date?: string
          tenant_id?: string
          translated_amount?: number
          translated_currency?: string
        }
        Relationships: [
          {
            foreignKeyName: "currency_translations_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "currency_translations_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "journal_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_collection_lines: {
        Row: {
          allocated_amount: number
          collection_id: string
          created_at: string | null
          discount_amount: number | null
          id: string
          invoice_id: string | null
          notes: string | null
        }
        Insert: {
          allocated_amount: number
          collection_id: string
          created_at?: string | null
          discount_amount?: number | null
          id?: string
          invoice_id?: string | null
          notes?: string | null
        }
        Update: {
          allocated_amount?: number
          collection_id?: string
          created_at?: string | null
          discount_amount?: number | null
          id?: string
          invoice_id?: string | null
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_collection_lines_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "customer_collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_collection_lines_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "sales_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_collections: {
        Row: {
          amount: number
          bank_account_id: string | null
          check_date: string | null
          check_number: string | null
          collection_date: string
          collection_number: string
          created_at: string | null
          created_by: string | null
          customer_id: string
          gl_entry_id: string | null
          id: string
          invoice_id: string | null
          notes: string | null
          org_id: string
          payment_account_id: string | null
          payment_method: string | null
          posted_at: string | null
          posted_by: string | null
          reference_number: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          amount: number
          bank_account_id?: string | null
          check_date?: string | null
          check_number?: string | null
          collection_date?: string
          collection_number: string
          created_at?: string | null
          created_by?: string | null
          customer_id: string
          gl_entry_id?: string | null
          id?: string
          invoice_id?: string | null
          notes?: string | null
          org_id: string
          payment_account_id?: string | null
          payment_method?: string | null
          posted_at?: string | null
          posted_by?: string | null
          reference_number?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          amount?: number
          bank_account_id?: string | null
          check_date?: string | null
          check_number?: string | null
          collection_date?: string
          collection_number?: string
          created_at?: string | null
          created_by?: string | null
          customer_id?: string
          gl_entry_id?: string | null
          id?: string
          invoice_id?: string | null
          notes?: string | null
          org_id?: string
          payment_account_id?: string | null
          payment_method?: string | null
          posted_at?: string | null
          posted_by?: string | null
          reference_number?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_collections_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_collections_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_customer_collections_invoice_id"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "sales_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_customer_collections_payment_account"
            columns: ["payment_account_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          code: string
          contact_person: string | null
          created_at: string | null
          credit_limit: number | null
          email: string | null
          id: string
          is_active: boolean | null
          name: string
          name_ar: string | null
          org_id: string
          phone: string | null
          tax_number: string | null
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          code: string
          contact_person?: string | null
          created_at?: string | null
          credit_limit?: number | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          name_ar?: string | null
          org_id: string
          phone?: string | null
          tax_number?: string | null
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          code?: string
          contact_person?: string | null
          created_at?: string | null
          credit_limit?: number | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          name_ar?: string | null
          org_id?: string
          phone?: string | null
          tax_number?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_note_lines: {
        Row: {
          conversion_factor_snapshot: number | null
          created_at: string | null
          delivered_quantity: number
          delivery_note_id: string
          id: string
          invoiced_quantity: number
          notes: string | null
          org_id: string
          product_id: string
          qty_entered: number | null
          quantity_delivered: number | null
          sales_invoice_line_id: string | null
          unit_cost_at_delivery: number | null
          unit_price: number
          unit_price_entered: number | null
          uom_id: string | null
          updated_at: string | null
          warehouse_id: string | null
        }
        Insert: {
          conversion_factor_snapshot?: number | null
          created_at?: string | null
          delivered_quantity: number
          delivery_note_id: string
          id?: string
          invoiced_quantity: number
          notes?: string | null
          org_id: string
          product_id: string
          qty_entered?: number | null
          quantity_delivered?: number | null
          sales_invoice_line_id?: string | null
          unit_cost_at_delivery?: number | null
          unit_price: number
          unit_price_entered?: number | null
          uom_id?: string | null
          updated_at?: string | null
          warehouse_id?: string | null
        }
        Update: {
          conversion_factor_snapshot?: number | null
          created_at?: string | null
          delivered_quantity?: number
          delivery_note_id?: string
          id?: string
          invoiced_quantity?: number
          notes?: string | null
          org_id?: string
          product_id?: string
          qty_entered?: number | null
          quantity_delivered?: number | null
          sales_invoice_line_id?: string | null
          unit_cost_at_delivery?: number | null
          unit_price?: number
          unit_price_entered?: number | null
          uom_id?: string | null
          updated_at?: string | null
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_note_lines_delivery_note_id_fkey"
            columns: ["delivery_note_id"]
            isOneToOne: false
            referencedRelation: "delivery_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_note_lines_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_note_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_note_lines_sales_invoice_line_id_fkey"
            columns: ["sales_invoice_line_id"]
            isOneToOne: false
            referencedRelation: "sales_invoice_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_note_lines_uom_id_fkey"
            columns: ["uom_id"]
            isOneToOne: false
            referencedRelation: "uoms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_note_lines_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_notes: {
        Row: {
          created_at: string | null
          created_by: string | null
          customer_id: string
          delivery_date: string
          delivery_number: string | null
          driver_name: string | null
          id: string
          idempotency_key: string | null
          notes: string | null
          org_id: string
          request_hash: string | null
          sales_invoice_id: string
          status: string | null
          updated_at: string | null
          vehicle_number: string | null
          warehouse_id: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          customer_id: string
          delivery_date?: string
          delivery_number?: string | null
          driver_name?: string | null
          id?: string
          idempotency_key?: string | null
          notes?: string | null
          org_id: string
          request_hash?: string | null
          sales_invoice_id: string
          status?: string | null
          updated_at?: string | null
          vehicle_number?: string | null
          warehouse_id?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          customer_id?: string
          delivery_date?: string
          delivery_number?: string | null
          driver_name?: string | null
          id?: string
          idempotency_key?: string | null
          notes?: string | null
          org_id?: string
          request_hash?: string | null
          sales_invoice_id?: string
          status?: string | null
          updated_at?: string | null
          vehicle_number?: string | null
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_notes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_notes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_notes_sales_invoice_id_fkey"
            columns: ["sales_invoice_id"]
            isOneToOne: false
            referencedRelation: "sales_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delivery_notes_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          code: string
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          manager_id: string | null
          name: string
          name_ar: string
          org_id: string
          updated_at: string | null
        }
        Insert: {
          code: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          manager_id?: string | null
          name: string
          name_ar: string
          org_id: string
          updated_at?: string | null
        }
        Update: {
          code?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          manager_id?: string | null
          name?: string
          name_ar?: string
          org_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "departments_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "departments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_leaves: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          employee_id: string
          end_date: string
          id: string
          leave_type_id: string
          notes: string | null
          org_id: string
          reason: string | null
          start_date: string
          status: string | null
          total_days: number
          updated_at: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          employee_id: string
          end_date: string
          id?: string
          leave_type_id: string
          notes?: string | null
          org_id: string
          reason?: string | null
          start_date: string
          status?: string | null
          total_days: number
          updated_at?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          employee_id?: string
          end_date?: string
          id?: string
          leave_type_id?: string
          notes?: string | null
          org_id?: string
          reason?: string | null
          start_date?: string
          status?: string | null
          total_days?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_leaves_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_leaves_leave_type_id_fkey"
            columns: ["leave_type_id"]
            isOneToOne: false
            referencedRelation: "leave_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_leaves_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_salary_structures: {
        Row: {
          component_id: string
          created_at: string | null
          effective_from: string
          effective_to: string | null
          employee_id: string
          id: string
          is_active: boolean | null
          notes: string | null
          org_id: string
          updated_at: string | null
          value: number | null
        }
        Insert: {
          component_id: string
          created_at?: string | null
          effective_from: string
          effective_to?: string | null
          employee_id: string
          id?: string
          is_active?: boolean | null
          notes?: string | null
          org_id: string
          updated_at?: string | null
          value?: number | null
        }
        Update: {
          component_id?: string
          created_at?: string | null
          effective_from?: string
          effective_to?: string | null
          employee_id?: string
          id?: string
          is_active?: boolean | null
          notes?: string | null
          org_id?: string
          updated_at?: string | null
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_salary_structures_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "salary_components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_salary_structures_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_salary_structures_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          bank_account: string | null
          bank_name: string | null
          contract_end_date: string | null
          created_at: string | null
          currency: string | null
          date_of_birth: string | null
          department: string | null
          email: string | null
          employee_id: string
          first_name: string
          full_name: string | null
          gender: string | null
          grade_level: string | null
          hire_date: string
          iban: string | null
          id: string
          id_number: string | null
          is_saudi: boolean | null
          last_name: string
          manager_id: string | null
          nationality: string | null
          notes: string | null
          org_id: string
          passport_number: string | null
          phone: string | null
          position: string | null
          salary: number | null
          status: string | null
          termination_date: string | null
          updated_at: string | null
        }
        Insert: {
          bank_account?: string | null
          bank_name?: string | null
          contract_end_date?: string | null
          created_at?: string | null
          currency?: string | null
          date_of_birth?: string | null
          department?: string | null
          email?: string | null
          employee_id: string
          first_name: string
          full_name?: string | null
          gender?: string | null
          grade_level?: string | null
          hire_date: string
          iban?: string | null
          id?: string
          id_number?: string | null
          is_saudi?: boolean | null
          last_name: string
          manager_id?: string | null
          nationality?: string | null
          notes?: string | null
          org_id: string
          passport_number?: string | null
          phone?: string | null
          position?: string | null
          salary?: number | null
          status?: string | null
          termination_date?: string | null
          updated_at?: string | null
        }
        Update: {
          bank_account?: string | null
          bank_name?: string | null
          contract_end_date?: string | null
          created_at?: string | null
          currency?: string | null
          date_of_birth?: string | null
          department?: string | null
          email?: string | null
          employee_id?: string
          first_name?: string
          full_name?: string | null
          gender?: string | null
          grade_level?: string | null
          hire_date?: string
          iban?: string | null
          id?: string
          id_number?: string | null
          is_saudi?: boolean | null
          last_name?: string
          manager_id?: string | null
          nationality?: string | null
          notes?: string | null
          org_id?: string
          passport_number?: string | null
          phone?: string | null
          position?: string | null
          salary?: number | null
          status?: string | null
          termination_date?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      gl_accounts: {
        Row: {
          allow_posting: boolean | null
          category: string
          code: string
          created_at: string | null
          currency: string | null
          id: string
          is_active: boolean | null
          name: string
          name_ar: string | null
          name_en: string | null
          normal_balance: string
          notes: string | null
          org_id: string
          parent_code: string | null
          subtype: string
          updated_at: string | null
        }
        Insert: {
          allow_posting?: boolean | null
          category: string
          code: string
          created_at?: string | null
          currency?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          name_ar?: string | null
          name_en?: string | null
          normal_balance: string
          notes?: string | null
          org_id: string
          parent_code?: string | null
          subtype: string
          updated_at?: string | null
        }
        Update: {
          allow_posting?: boolean | null
          category?: string
          code?: string
          created_at?: string | null
          currency?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          name_ar?: string | null
          name_en?: string | null
          normal_balance?: string
          notes?: string | null
          org_id?: string
          parent_code?: string | null
          subtype?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gl_accounts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      gl_entries: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          description_ar: string | null
          entry_date: string
          entry_number: string
          entry_type: string
          id: string
          idempotency_key: string | null
          journal_id: string | null
          org_id: string
          posted_at: string | null
          posted_by: string | null
          reference_id: string | null
          reference_number: string | null
          reference_type: string | null
          status: string | null
          total_credit: number | null
          total_debit: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          description_ar?: string | null
          entry_date?: string
          entry_number: string
          entry_type: string
          id?: string
          idempotency_key?: string | null
          journal_id?: string | null
          org_id: string
          posted_at?: string | null
          posted_by?: string | null
          reference_id?: string | null
          reference_number?: string | null
          reference_type?: string | null
          status?: string | null
          total_credit?: number | null
          total_debit?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          description_ar?: string | null
          entry_date?: string
          entry_number?: string
          entry_type?: string
          id?: string
          idempotency_key?: string | null
          journal_id?: string | null
          org_id?: string
          posted_at?: string | null
          posted_by?: string | null
          reference_id?: string | null
          reference_number?: string | null
          reference_type?: string | null
          status?: string | null
          total_credit?: number | null
          total_debit?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_gl_entries_journal"
            columns: ["journal_id"]
            isOneToOne: false
            referencedRelation: "journals"
            referencedColumns: ["id"]
          },
        ]
      }
      gl_entry_lines: {
        Row: {
          account_code: string | null
          account_id: string | null
          account_name: string | null
          account_name_ar: string | null
          created_at: string | null
          credit: number | null
          credit_amount: number | null
          currency_code: string | null
          debit: number | null
          debit_amount: number | null
          description: string | null
          description_ar: string | null
          entry_id: string
          id: string
          line_number: number | null
          org_id: string
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          account_code?: string | null
          account_id?: string | null
          account_name?: string | null
          account_name_ar?: string | null
          created_at?: string | null
          credit?: number | null
          credit_amount?: number | null
          currency_code?: string | null
          debit?: number | null
          debit_amount?: number | null
          description?: string | null
          description_ar?: string | null
          entry_id: string
          id?: string
          line_number?: number | null
          org_id: string
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          account_code?: string | null
          account_id?: string | null
          account_name?: string | null
          account_name_ar?: string | null
          created_at?: string | null
          credit?: number | null
          credit_amount?: number | null
          currency_code?: string | null
          debit?: number | null
          debit_amount?: number | null
          description?: string | null
          description_ar?: string | null
          entry_id?: string
          id?: string
          line_number?: number | null
          org_id?: string
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gl_entry_lines_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "gl_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gl_entry_lines_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "v_gl_entries_full"
            referencedColumns: ["id"]
          },
        ]
      }
      gl_event_mappings: {
        Row: {
          created_at: string
          credit_account_code: string
          debit_account_code: string
          description: string | null
          event_code: string
          id: string
          is_active: boolean
          org_id: string
          updated_at: string
          work_center_code: string | null
        }
        Insert: {
          created_at?: string
          credit_account_code: string
          debit_account_code: string
          description?: string | null
          event_code: string
          id?: string
          is_active?: boolean
          org_id: string
          updated_at?: string
          work_center_code?: string | null
        }
        Update: {
          created_at?: string
          credit_account_code?: string
          debit_account_code?: string
          description?: string | null
          event_code?: string
          id?: string
          is_active?: boolean
          org_id?: string
          updated_at?: string
          work_center_code?: string | null
        }
        Relationships: []
      }
      gl_mappings: {
        Row: {
          created_at: string | null
          credit_account_code: string
          debit_account_code: string
          description: string | null
          id: string
          is_active: boolean | null
          key_type: string
          key_value: string
          org_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          credit_account_code: string
          debit_account_code: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          key_type: string
          key_value: string
          org_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          credit_account_code?: string
          debit_account_code?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          key_type?: string
          key_value?: string
          org_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gl_mappings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      goods_receipt_lines: {
        Row: {
          conversion_factor_snapshot: number | null
          created_at: string | null
          goods_receipt_id: string
          id: string
          notes: string | null
          ordered_quantity: number
          org_id: string
          product_id: string
          purchase_order_line_id: string | null
          qty_entered: number | null
          quality_status: string | null
          received_quantity: number
          unit_cost: number
          unit_cost_entered: number | null
          uom_id: string | null
          updated_at: string | null
        }
        Insert: {
          conversion_factor_snapshot?: number | null
          created_at?: string | null
          goods_receipt_id: string
          id?: string
          notes?: string | null
          ordered_quantity: number
          org_id: string
          product_id: string
          purchase_order_line_id?: string | null
          qty_entered?: number | null
          quality_status?: string | null
          received_quantity: number
          unit_cost: number
          unit_cost_entered?: number | null
          uom_id?: string | null
          updated_at?: string | null
        }
        Update: {
          conversion_factor_snapshot?: number | null
          created_at?: string | null
          goods_receipt_id?: string
          id?: string
          notes?: string | null
          ordered_quantity?: number
          org_id?: string
          product_id?: string
          purchase_order_line_id?: string | null
          qty_entered?: number | null
          quality_status?: string | null
          received_quantity?: number
          unit_cost?: number
          unit_cost_entered?: number | null
          uom_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "goods_receipt_lines_goods_receipt_id_fkey"
            columns: ["goods_receipt_id"]
            isOneToOne: false
            referencedRelation: "goods_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_lines_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_lines_purchase_order_line_id_fkey"
            columns: ["purchase_order_line_id"]
            isOneToOne: false
            referencedRelation: "purchase_order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipt_lines_uom_id_fkey"
            columns: ["uom_id"]
            isOneToOne: false
            referencedRelation: "uoms"
            referencedColumns: ["id"]
          },
        ]
      }
      goods_receipts: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          idempotency_key: string | null
          notes: string | null
          org_id: string
          purchase_order_id: string | null
          receipt_date: string
          receipt_number: string | null
          receiver_name: string | null
          request_hash: string | null
          status: string | null
          updated_at: string | null
          vendor_id: string
          warehouse_id: string | null
          warehouse_location: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          idempotency_key?: string | null
          notes?: string | null
          org_id: string
          purchase_order_id?: string | null
          receipt_date?: string
          receipt_number?: string | null
          receiver_name?: string | null
          request_hash?: string | null
          status?: string | null
          updated_at?: string | null
          vendor_id: string
          warehouse_id?: string | null
          warehouse_location?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          idempotency_key?: string | null
          notes?: string | null
          org_id?: string
          purchase_order_id?: string | null
          receipt_date?: string
          receipt_number?: string | null
          receiver_name?: string | null
          request_hash?: string | null
          status?: string | null
          updated_at?: string | null
          vendor_id?: string
          warehouse_id?: string | null
          warehouse_location?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "goods_receipts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipts_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipts_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_receipts_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_alerts: {
        Row: {
          category: string
          created_at: string | null
          description: string | null
          due_date: string | null
          employee_id: string | null
          id: string
          is_resolved: boolean | null
          org_id: string
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          source: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          category?: string
          created_at?: string | null
          description?: string | null
          due_date?: string | null
          employee_id?: string | null
          id?: string
          is_resolved?: boolean | null
          org_id: string
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          source?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          category?: string
          created_at?: string | null
          description?: string | null
          due_date?: string | null
          employee_id?: string | null
          id?: string
          is_resolved?: boolean | null
          org_id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          source?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hr_alerts_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_alerts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_attendance_monthly: {
        Row: {
          created_at: string
          days: Json
          employee_id: string
          id: string
          metadata: Json | null
          month: number
          org_id: string
          updated_at: string
          updated_by: string | null
          year: number
        }
        Insert: {
          created_at?: string
          days?: Json
          employee_id: string
          id?: string
          metadata?: Json | null
          month: number
          org_id: string
          updated_at?: string
          updated_by?: string | null
          year: number
        }
        Update: {
          created_at?: string
          days?: Json
          employee_id?: string
          id?: string
          metadata?: Json | null
          month?: number
          org_id?: string
          updated_at?: string
          updated_by?: string | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "hr_attendance_monthly_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_attendance_monthly_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_payroll_account_mappings: {
        Row: {
          account_type: string
          created_at: string
          description: string | null
          gl_account_id: string
          id: string
          org_id: string
          updated_at: string
        }
        Insert: {
          account_type: string
          created_at?: string
          description?: string | null
          gl_account_id: string
          id?: string
          org_id: string
          updated_at?: string
        }
        Update: {
          account_type?: string
          created_at?: string
          description?: string | null
          gl_account_id?: string
          id?: string
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hr_payroll_account_mappings_gl_account_id_fkey"
            columns: ["gl_account_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_payroll_account_mappings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_payroll_adjustments: {
        Row: {
          adjustment_type: string
          amount: number
          created_at: string | null
          created_by: string | null
          description: string | null
          effective_month: string | null
          employee_id: string | null
          id: string
          is_recurring: boolean | null
          org_id: string
          payroll_run_id: string | null
          updated_at: string | null
        }
        Insert: {
          adjustment_type: string
          amount: number
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          effective_month?: string | null
          employee_id?: string | null
          id?: string
          is_recurring?: boolean | null
          org_id: string
          payroll_run_id?: string | null
          updated_at?: string | null
        }
        Update: {
          adjustment_type?: string
          amount?: number
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          effective_month?: string | null
          employee_id?: string | null
          id?: string
          is_recurring?: boolean | null
          org_id?: string
          payroll_run_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hr_payroll_adjustments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_payroll_adjustments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_payroll_adjustments_payroll_run_id_fkey"
            columns: ["payroll_run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_payroll_locks: {
        Row: {
          created_at: string
          id: string
          journal_entry_id: string | null
          locked_at: string | null
          locked_by: string | null
          month: number
          notes: string | null
          org_id: string
          status: string
          updated_at: string
          year: number
        }
        Insert: {
          created_at?: string
          id?: string
          journal_entry_id?: string | null
          locked_at?: string | null
          locked_by?: string | null
          month: number
          notes?: string | null
          org_id: string
          status?: string
          updated_at?: string
          year: number
        }
        Update: {
          created_at?: string
          id?: string
          journal_entry_id?: string | null
          locked_at?: string | null
          locked_by?: string | null
          month?: number
          notes?: string | null
          org_id?: string
          status?: string
          updated_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "hr_payroll_locks_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "gl_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_payroll_locks_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "v_gl_entries_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_payroll_locks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_policies: {
        Row: {
          annual_leave_days_after_5y: number
          annual_leave_days_before_5y: number
          created_at: string
          daily_rate_basis: string
          employee_daily_hours: number
          exclude_unpaid_from_accrual: boolean
          gosi_applies_to: string
          gosi_base_cap: number
          gosi_employee_pct: number
          gosi_employer_pct: number
          id: string
          include_weekends_in_accrual: boolean
          org_id: string
          overtime_base: string
          overtime_grace_minutes: number
          overtime_multiplier: number
          updated_at: string
          weekend_days: string[]
          worker_daily_hours: number
          worker_shifts: number
        }
        Insert: {
          annual_leave_days_after_5y?: number
          annual_leave_days_before_5y?: number
          created_at?: string
          daily_rate_basis?: string
          employee_daily_hours?: number
          exclude_unpaid_from_accrual?: boolean
          gosi_applies_to?: string
          gosi_base_cap?: number
          gosi_employee_pct?: number
          gosi_employer_pct?: number
          id?: string
          include_weekends_in_accrual?: boolean
          org_id: string
          overtime_base?: string
          overtime_grace_minutes?: number
          overtime_multiplier?: number
          updated_at?: string
          weekend_days?: string[]
          worker_daily_hours?: number
          worker_shifts?: number
        }
        Update: {
          annual_leave_days_after_5y?: number
          annual_leave_days_before_5y?: number
          created_at?: string
          daily_rate_basis?: string
          employee_daily_hours?: number
          exclude_unpaid_from_accrual?: boolean
          gosi_applies_to?: string
          gosi_base_cap?: number
          gosi_employee_pct?: number
          gosi_employer_pct?: number
          id?: string
          include_weekends_in_accrual?: boolean
          org_id?: string
          overtime_base?: string
          overtime_grace_minutes?: number
          overtime_multiplier?: number
          updated_at?: string
          weekend_days?: string[]
          worker_daily_hours?: number
          worker_shifts?: number
        }
        Relationships: [
          {
            foreignKeyName: "hr_policies_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_settlement_lines: {
        Row: {
          amount: number
          calculation_basis: string | null
          component_code: string
          component_label: string
          created_at: string | null
          id: string
          is_deduction: boolean | null
          org_id: string
          settlement_id: string
        }
        Insert: {
          amount?: number
          calculation_basis?: string | null
          component_code: string
          component_label: string
          created_at?: string | null
          id?: string
          is_deduction?: boolean | null
          org_id: string
          settlement_id: string
        }
        Update: {
          amount?: number
          calculation_basis?: string | null
          component_code?: string
          component_label?: string
          created_at?: string | null
          id?: string
          is_deduction?: boolean | null
          org_id?: string
          settlement_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hr_settlement_lines_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_settlement_lines_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "hr_settlements"
            referencedColumns: ["id"]
          },
        ]
      }
      hr_settlements: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          calculated_amount: number | null
          created_at: string | null
          created_by: string | null
          currency: string | null
          employee_id: string
          id: string
          idempotency_key: string | null
          journal_entry_id: string | null
          notes: string | null
          org_id: string
          payable_amount: number | null
          posted_snapshot: Json | null
          request_hash: string | null
          review_hash: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          service_days: number | null
          service_end: string | null
          service_start: string | null
          settlement_type: string
          status: string
          termination_type: string | null
          updated_at: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          calculated_amount?: number | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          employee_id: string
          id?: string
          idempotency_key?: string | null
          journal_entry_id?: string | null
          notes?: string | null
          org_id: string
          payable_amount?: number | null
          posted_snapshot?: Json | null
          request_hash?: string | null
          review_hash?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          service_days?: number | null
          service_end?: string | null
          service_start?: string | null
          settlement_type?: string
          status?: string
          termination_type?: string | null
          updated_at?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          calculated_amount?: number | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          employee_id?: string
          id?: string
          idempotency_key?: string | null
          journal_entry_id?: string | null
          notes?: string | null
          org_id?: string
          payable_amount?: number | null
          posted_snapshot?: Json | null
          request_hash?: string | null
          review_hash?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          service_days?: number | null
          service_end?: string | null
          service_start?: string | null
          settlement_type?: string
          status?: string
          termination_type?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hr_settlements_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_settlements_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "gl_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_settlements_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "v_gl_entries_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hr_settlements_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          email: string
          expires_at: string | null
          id: string
          invitation_message: string | null
          invited_at: string | null
          invited_by: string | null
          org_id: string
          role_ids: string[]
          status: string | null
          token: string
          token_hash: string | null
        }
        Insert: {
          accepted_at?: string | null
          email: string
          expires_at?: string | null
          id?: string
          invitation_message?: string | null
          invited_at?: string | null
          invited_by?: string | null
          org_id: string
          role_ids: string[]
          status?: string | null
          token: string
          token_hash?: string | null
        }
        Update: {
          accepted_at?: string | null
          email?: string
          expires_at?: string | null
          id?: string
          invitation_message?: string | null
          invited_at?: string | null
          invited_by?: string | null
          org_id?: string
          role_ids?: string[]
          status?: string | null
          token?: string
          token_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invitations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      item_product_map: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          item_id: string
          mapping_source: string
          org_id: string
          product_id: string
          updated_at: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          item_id: string
          mapping_source?: string
          org_id: string
          product_id: string
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          item_id?: string
          mapping_source?: string
          org_id?: string
          product_id?: string
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "item_product_map_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_product_map_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_product_map_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      items: {
        Row: {
          barcode: string | null
          base_uom_id: string | null
          category_id: string | null
          code: string
          cost_price: number | null
          created_at: string | null
          description: string | null
          id: string
          image_url: string | null
          is_active: boolean | null
          is_purchasable: boolean | null
          is_saleable: boolean | null
          is_stockable: boolean | null
          last_purchase_price: number | null
          last_sale_price: number | null
          maximum_stock: number | null
          minimum_stock: number | null
          name: string
          name_ar: string | null
          notes: string | null
          org_id: string
          reorder_level: number | null
          selling_price: number | null
          sku: string | null
          standard_cost: number | null
          stock_quantity: number | null
          unit: string
          uom_migration_status: string
          updated_at: string | null
          valuation_method: string | null
        }
        Insert: {
          barcode?: string | null
          base_uom_id?: string | null
          category_id?: string | null
          code: string
          cost_price?: number | null
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          is_purchasable?: boolean | null
          is_saleable?: boolean | null
          is_stockable?: boolean | null
          last_purchase_price?: number | null
          last_sale_price?: number | null
          maximum_stock?: number | null
          minimum_stock?: number | null
          name: string
          name_ar?: string | null
          notes?: string | null
          org_id?: string
          reorder_level?: number | null
          selling_price?: number | null
          sku?: string | null
          standard_cost?: number | null
          stock_quantity?: number | null
          unit?: string
          uom_migration_status?: string
          updated_at?: string | null
          valuation_method?: string | null
        }
        Update: {
          barcode?: string | null
          base_uom_id?: string | null
          category_id?: string | null
          code?: string
          cost_price?: number | null
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          is_purchasable?: boolean | null
          is_saleable?: boolean | null
          is_stockable?: boolean | null
          last_purchase_price?: number | null
          last_sale_price?: number | null
          maximum_stock?: number | null
          minimum_stock?: number | null
          name?: string
          name_ar?: string | null
          notes?: string | null
          org_id?: string
          reorder_level?: number | null
          selling_price?: number | null
          sku?: string | null
          standard_cost?: number | null
          stock_quantity?: number | null
          unit?: string
          uom_migration_status?: string
          updated_at?: string | null
          valuation_method?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "items_base_uom_id_fkey"
            columns: ["base_uom_id"]
            isOneToOne: false
            referencedRelation: "uoms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_approval_rules: {
        Row: {
          approval_levels: number
          created_at: string | null
          id: string
          is_active: boolean | null
          journal_id: string | null
          max_amount: number | null
          min_amount: number | null
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          approval_levels?: number
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          journal_id?: string | null
          max_amount?: number | null
          min_amount?: number | null
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          approval_levels?: number
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          journal_id?: string | null
          max_amount?: number | null
          min_amount?: number | null
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "journal_approval_rules_journal_id_fkey"
            columns: ["journal_id"]
            isOneToOne: false
            referencedRelation: "journals"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_entries: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          description_ar: string | null
          entry_date: string
          entry_number: string
          id: string
          journal_id: string
          org_id: string
          period_id: string | null
          posted_at: string | null
          posted_by: string | null
          posting_date: string | null
          reference_id: string | null
          reference_number: string | null
          reference_type: string | null
          reversal_reason: string | null
          reversed_by_entry_id: string | null
          status: string
          total_credit: number
          total_debit: number
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          description_ar?: string | null
          entry_date: string
          entry_number: string
          id?: string
          journal_id: string
          org_id: string
          period_id?: string | null
          posted_at?: string | null
          posted_by?: string | null
          posting_date?: string | null
          reference_id?: string | null
          reference_number?: string | null
          reference_type?: string | null
          reversal_reason?: string | null
          reversed_by_entry_id?: string | null
          status?: string
          total_credit?: number
          total_debit?: number
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          description_ar?: string | null
          entry_date?: string
          entry_number?: string
          id?: string
          journal_id?: string
          org_id?: string
          period_id?: string | null
          posted_at?: string | null
          posted_by?: string | null
          posting_date?: string | null
          reference_id?: string | null
          reference_number?: string | null
          reference_type?: string | null
          reversal_reason?: string | null
          reversed_by_entry_id?: string | null
          status?: string
          total_credit?: number
          total_debit?: number
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "journal_entries_journal_id_fkey"
            columns: ["journal_id"]
            isOneToOne: false
            referencedRelation: "journals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_reversed_by_entry_id_fkey"
            columns: ["reversed_by_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_entry_approvals: {
        Row: {
          approval_level: number
          approved_at: string | null
          approver_id: string
          comments: string | null
          created_at: string | null
          entry_id: string
          id: string
          rejected_at: string | null
          status: string
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          approval_level: number
          approved_at?: string | null
          approver_id: string
          comments?: string | null
          created_at?: string | null
          entry_id: string
          id?: string
          rejected_at?: string | null
          status?: string
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          approval_level?: number
          approved_at?: string | null
          approver_id?: string
          comments?: string | null
          created_at?: string | null
          entry_id?: string
          id?: string
          rejected_at?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "journal_entry_approvals_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_entry_attachments: {
        Row: {
          created_at: string | null
          entry_id: string
          file_name: string
          file_path: string
          file_size: number | null
          file_type: string | null
          id: string
          org_id: string
          tenant_id: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string | null
          entry_id: string
          file_name: string
          file_path: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          org_id?: string
          tenant_id: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string | null
          entry_id?: string
          file_name?: string
          file_path?: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          org_id?: string
          tenant_id?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "journal_entry_attachments_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "gl_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entry_attachments_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "v_gl_entries_full"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_entry_comments: {
        Row: {
          comment_text: string
          comment_type: string | null
          created_at: string | null
          created_by: string | null
          entry_id: string
          id: string
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          comment_text: string
          comment_type?: string | null
          created_at?: string | null
          created_by?: string | null
          entry_id: string
          id?: string
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          comment_text?: string
          comment_type?: string | null
          created_at?: string | null
          created_by?: string | null
          entry_id?: string
          id?: string
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "journal_entry_comments_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "gl_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entry_comments_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "v_gl_entries_full"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_lines: {
        Row: {
          account_id: string
          cost_center_id: string | null
          created_at: string | null
          credit: number | null
          currency_code: string | null
          debit: number | null
          description: string | null
          description_ar: string | null
          entry_id: string
          id: string
          line_number: number
          org_id: string
          partner_id: string | null
          product_id: string | null
          profit_center_id: string | null
          project_id: string | null
          reconciled: boolean | null
          reconciled_at: string | null
          reconciled_by: string | null
          segment_id: string | null
        }
        Insert: {
          account_id: string
          cost_center_id?: string | null
          created_at?: string | null
          credit?: number | null
          currency_code?: string | null
          debit?: number | null
          description?: string | null
          description_ar?: string | null
          entry_id: string
          id?: string
          line_number: number
          org_id: string
          partner_id?: string | null
          product_id?: string | null
          profit_center_id?: string | null
          project_id?: string | null
          reconciled?: boolean | null
          reconciled_at?: string | null
          reconciled_by?: string | null
          segment_id?: string | null
        }
        Update: {
          account_id?: string
          cost_center_id?: string | null
          created_at?: string | null
          credit?: number | null
          currency_code?: string | null
          debit?: number | null
          description?: string | null
          description_ar?: string | null
          entry_id?: string
          id?: string
          line_number?: number
          org_id?: string
          partner_id?: string | null
          product_id?: string | null
          profit_center_id?: string | null
          project_id?: string | null
          reconciled?: boolean | null
          reconciled_at?: string | null
          reconciled_by?: string | null
          segment_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "journal_lines_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_lines_profit_center_id_fkey"
            columns: ["profit_center_id"]
            isOneToOne: false
            referencedRelation: "profit_centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_lines_segment_id_fkey"
            columns: ["segment_id"]
            isOneToOne: false
            referencedRelation: "account_segments"
            referencedColumns: ["id"]
          },
        ]
      }
      journals: {
        Row: {
          code: string
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          journal_type: string
          name: string
          name_ar: string | null
          org_id: string
          sequence_prefix: string | null
          updated_at: string | null
        }
        Insert: {
          code: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          journal_type: string
          name: string
          name_ar?: string | null
          org_id: string
          sequence_prefix?: string | null
          updated_at?: string | null
        }
        Update: {
          code?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          journal_type?: string
          name?: string
          name_ar?: string | null
          org_id?: string
          sequence_prefix?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      labor_time_tracking: {
        Row: {
          billable_minutes: number | null
          break_minutes: number | null
          clock_in: string
          clock_out: string | null
          created_at: string | null
          employee_id: string | null
          employee_name: string | null
          hourly_rate: number | null
          id: string
          labor_type: string | null
          notes: string | null
          org_id: string
          status: string | null
          total_cost: number | null
          total_minutes: number | null
          updated_at: string | null
          work_order_id: string
        }
        Insert: {
          billable_minutes?: number | null
          break_minutes?: number | null
          clock_in: string
          clock_out?: string | null
          created_at?: string | null
          employee_id?: string | null
          employee_name?: string | null
          hourly_rate?: number | null
          id?: string
          labor_type?: string | null
          notes?: string | null
          org_id: string
          status?: string | null
          total_cost?: number | null
          total_minutes?: number | null
          updated_at?: string | null
          work_order_id: string
        }
        Update: {
          billable_minutes?: number | null
          break_minutes?: number | null
          clock_in?: string
          clock_out?: string | null
          created_at?: string | null
          employee_id?: string | null
          employee_name?: string | null
          hourly_rate?: number | null
          id?: string
          labor_type?: string | null
          notes?: string | null
          org_id?: string
          status?: string | null
          total_cost?: number | null
          total_minutes?: number | null
          updated_at?: string | null
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "labor_time_tracking_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "v_work_order_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "labor_time_tracking_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_types: {
        Row: {
          code: string
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          is_paid: boolean | null
          max_days_per_year: number | null
          name: string
          name_ar: string
          org_id: string
          updated_at: string | null
        }
        Insert: {
          code: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_paid?: boolean | null
          max_days_per_year?: number | null
          name: string
          name_ar: string
          org_id: string
          updated_at?: string | null
        }
        Update: {
          code?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_paid?: boolean | null
          max_days_per_year?: number | null
          name?: string
          name_ar?: string
          org_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leave_types_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      machine_downtime: {
        Row: {
          action_taken: string | null
          cost_impact: number | null
          created_at: string | null
          downtime_category: string | null
          downtime_reason: string
          duration_minutes: number | null
          end_time: string | null
          id: string
          notes: string | null
          org_id: string
          reported_by: string | null
          resolved_by: string | null
          start_time: string
          units_lost: number | null
          work_center_id: string
          work_order_id: string | null
        }
        Insert: {
          action_taken?: string | null
          cost_impact?: number | null
          created_at?: string | null
          downtime_category?: string | null
          downtime_reason: string
          duration_minutes?: number | null
          end_time?: string | null
          id?: string
          notes?: string | null
          org_id: string
          reported_by?: string | null
          resolved_by?: string | null
          start_time: string
          units_lost?: number | null
          work_center_id: string
          work_order_id?: string | null
        }
        Update: {
          action_taken?: string | null
          cost_impact?: number | null
          created_at?: string | null
          downtime_category?: string | null
          downtime_reason?: string
          duration_minutes?: number | null
          end_time?: string | null
          id?: string
          notes?: string | null
          org_id?: string
          reported_by?: string | null
          resolved_by?: string | null
          start_time?: string
          units_lost?: number | null
          work_center_id?: string
          work_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "machine_downtime_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "v_capacity_summary"
            referencedColumns: ["work_center_id"]
          },
          {
            foreignKeyName: "machine_downtime_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "v_work_center_productivity"
            referencedColumns: ["work_center_id"]
          },
          {
            foreignKeyName: "machine_downtime_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "v_work_centers_utilization"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "machine_downtime_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "work_centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "machine_downtime_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "v_work_order_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "machine_downtime_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      manufacturing_orders: {
        Row: {
          auto_backflush: boolean | null
          backflush_timing: string | null
          completed_date: string | null
          completed_quantity: number | null
          costing_method: string | null
          created_at: string | null
          created_by: string | null
          due_date: string | null
          id: string
          item_id: string | null
          notes: string | null
          order_number: string
          org_id: string
          product_id: string | null
          quantity: number
          routing_id: string | null
          scrap_quantity: number | null
          start_date: string | null
          status: string | null
          total_cost: number | null
          unit_cost: number | null
          updated_at: string | null
          work_orders_generated: boolean | null
        }
        Insert: {
          auto_backflush?: boolean | null
          backflush_timing?: string | null
          completed_date?: string | null
          completed_quantity?: number | null
          costing_method?: string | null
          created_at?: string | null
          created_by?: string | null
          due_date?: string | null
          id?: string
          item_id?: string | null
          notes?: string | null
          order_number: string
          org_id: string
          product_id?: string | null
          quantity?: number
          routing_id?: string | null
          scrap_quantity?: number | null
          start_date?: string | null
          status?: string | null
          total_cost?: number | null
          unit_cost?: number | null
          updated_at?: string | null
          work_orders_generated?: boolean | null
        }
        Update: {
          auto_backflush?: boolean | null
          backflush_timing?: string | null
          completed_date?: string | null
          completed_quantity?: number | null
          costing_method?: string | null
          created_at?: string | null
          created_by?: string | null
          due_date?: string | null
          id?: string
          item_id?: string | null
          notes?: string | null
          order_number?: string
          org_id?: string
          product_id?: string | null
          quantity?: number
          routing_id?: string | null
          scrap_quantity?: number | null
          start_date?: string | null
          status?: string | null
          total_cost?: number | null
          unit_cost?: number | null
          updated_at?: string | null
          work_orders_generated?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "manufacturing_orders_routing_id_fkey"
            columns: ["routing_id"]
            isOneToOne: false
            referencedRelation: "routings"
            referencedColumns: ["id"]
          },
        ]
      }
      manufacturing_stages: {
        Row: {
          code: string
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          name_ar: string | null
          order_sequence: number
          org_id: string
          updated_at: string | null
          updated_by: string | null
          wip_gl_account_id: string | null
          work_center_id: string | null
        }
        Insert: {
          code: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          name_ar?: string | null
          order_sequence: number
          org_id: string
          updated_at?: string | null
          updated_by?: string | null
          wip_gl_account_id?: string | null
          work_center_id?: string | null
        }
        Update: {
          code?: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          name_ar?: string | null
          order_sequence?: number
          org_id?: string
          updated_at?: string | null
          updated_by?: string | null
          wip_gl_account_id?: string | null
          work_center_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "manufacturing_stages_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturing_stages_wip_gl_account_id_fkey"
            columns: ["wip_gl_account_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturing_stages_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "v_capacity_summary"
            referencedColumns: ["work_center_id"]
          },
          {
            foreignKeyName: "manufacturing_stages_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "v_work_center_productivity"
            referencedColumns: ["work_center_id"]
          },
          {
            foreignKeyName: "manufacturing_stages_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "v_work_centers_utilization"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturing_stages_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "work_centers"
            referencedColumns: ["id"]
          },
        ]
      }
      material_consumption: {
        Row: {
          consumed_quantity: number
          consumption_date: string | null
          consumption_type: string | null
          conversion_factor_snapshot: number | null
          created_at: string | null
          created_by: string | null
          id: string
          item_id: string
          location_id: string | null
          lot_number: string | null
          mo_id: string
          notes: string | null
          org_id: string
          planned_quantity: number | null
          product_id: string | null
          qty_entered: number | null
          reservation_id: string | null
          stage_id: string | null
          status: string | null
          stock_valuation_result: Json | null
          total_cost: number | null
          unit_cost: number | null
          uom_id: string | null
          warehouse_id: string | null
          work_order_id: string
        }
        Insert: {
          consumed_quantity: number
          consumption_date?: string | null
          consumption_type?: string | null
          conversion_factor_snapshot?: number | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          item_id: string
          location_id?: string | null
          lot_number?: string | null
          mo_id: string
          notes?: string | null
          org_id: string
          planned_quantity?: number | null
          product_id?: string | null
          qty_entered?: number | null
          reservation_id?: string | null
          stage_id?: string | null
          status?: string | null
          stock_valuation_result?: Json | null
          total_cost?: number | null
          unit_cost?: number | null
          uom_id?: string | null
          warehouse_id?: string | null
          work_order_id: string
        }
        Update: {
          consumed_quantity?: number
          consumption_date?: string | null
          consumption_type?: string | null
          conversion_factor_snapshot?: number | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          item_id?: string
          location_id?: string | null
          lot_number?: string | null
          mo_id?: string
          notes?: string | null
          org_id?: string
          planned_quantity?: number | null
          product_id?: string | null
          qty_entered?: number | null
          reservation_id?: string | null
          stage_id?: string | null
          status?: string | null
          stock_valuation_result?: Json | null
          total_cost?: number | null
          unit_cost?: number | null
          uom_id?: string | null
          warehouse_id?: string | null
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "material_consumption_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_consumption_mo_id_fkey"
            columns: ["mo_id"]
            isOneToOne: false
            referencedRelation: "manufacturing_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_consumption_mo_id_fkey"
            columns: ["mo_id"]
            isOneToOne: false
            referencedRelation: "v_manufacturing_orders_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_consumption_mo_id_fkey"
            columns: ["mo_id"]
            isOneToOne: false
            referencedRelation: "wip_by_stage"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_consumption_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_consumption_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "material_reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_consumption_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "manufacturing_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_consumption_uom_id_fkey"
            columns: ["uom_id"]
            isOneToOne: false
            referencedRelation: "uoms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_consumption_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "v_work_order_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_consumption_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      material_reservations: {
        Row: {
          consumed_at: string | null
          conversion_factor_snapshot: number | null
          created_at: string | null
          expires_at: string | null
          id: string
          item_id: string
          mo_id: string
          notes: string | null
          org_id: string
          product_id: string | null
          qty_entered: number | null
          quantity_consumed: number | null
          quantity_released: number | null
          quantity_reserved: number
          released_at: string | null
          reserved_at: string | null
          status: string
          uom_id: string | null
          updated_at: string | null
        }
        Insert: {
          consumed_at?: string | null
          conversion_factor_snapshot?: number | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          item_id: string
          mo_id: string
          notes?: string | null
          org_id: string
          product_id?: string | null
          qty_entered?: number | null
          quantity_consumed?: number | null
          quantity_released?: number | null
          quantity_reserved: number
          released_at?: string | null
          reserved_at?: string | null
          status?: string
          uom_id?: string | null
          updated_at?: string | null
        }
        Update: {
          consumed_at?: string | null
          conversion_factor_snapshot?: number | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          item_id?: string
          mo_id?: string
          notes?: string | null
          org_id?: string
          product_id?: string | null
          qty_entered?: number | null
          quantity_consumed?: number | null
          quantity_released?: number | null
          quantity_reserved?: number
          released_at?: string | null
          reserved_at?: string | null
          status?: string
          uom_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "material_reservations_mo_id_fkey"
            columns: ["mo_id"]
            isOneToOne: false
            referencedRelation: "manufacturing_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_reservations_mo_id_fkey"
            columns: ["mo_id"]
            isOneToOne: false
            referencedRelation: "v_manufacturing_orders_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_reservations_mo_id_fkey"
            columns: ["mo_id"]
            isOneToOne: false
            referencedRelation: "wip_by_stage"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_reservations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_reservations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_reservations_uom_id_fkey"
            columns: ["uom_id"]
            isOneToOne: false
            referencedRelation: "uoms"
            referencedColumns: ["id"]
          },
        ]
      }
      modules: {
        Row: {
          created_at: string | null
          description: string | null
          description_ar: string | null
          display_order: number | null
          icon: string | null
          id: string
          is_active: boolean | null
          name: string
          name_ar: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          description_ar?: string | null
          display_order?: number | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          name_ar: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          description_ar?: string | null
          display_order?: number | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          name_ar?: string
        }
        Relationships: []
      }
      operation_execution_logs: {
        Row: {
          created_at: string | null
          duration_minutes: number | null
          event_timestamp: string | null
          event_type: string
          id: string
          notes: string | null
          operator_id: string | null
          org_id: string
          quantity_produced: number | null
          quantity_scrapped: number | null
          reason_code: string | null
          reason_description: string | null
          work_order_id: string
        }
        Insert: {
          created_at?: string | null
          duration_minutes?: number | null
          event_timestamp?: string | null
          event_type: string
          id?: string
          notes?: string | null
          operator_id?: string | null
          org_id: string
          quantity_produced?: number | null
          quantity_scrapped?: number | null
          reason_code?: string | null
          reason_description?: string | null
          work_order_id: string
        }
        Update: {
          created_at?: string | null
          duration_minutes?: number | null
          event_timestamp?: string | null
          event_type?: string
          id?: string
          notes?: string | null
          operator_id?: string | null
          org_id?: string
          quantity_produced?: number | null
          quantity_scrapped?: number | null
          reason_code?: string | null
          reason_description?: string | null
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "operation_execution_logs_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "v_work_order_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operation_execution_logs_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      operation_resources: {
        Row: {
          cost_rate: number | null
          created_at: string | null
          id: string
          notes: string | null
          operation_id: string
          org_id: string
          quantity_required: number | null
          resource_code: string | null
          resource_name: string | null
          resource_type: string
          unit_of_measure: string | null
          updated_at: string | null
        }
        Insert: {
          cost_rate?: number | null
          created_at?: string | null
          id?: string
          notes?: string | null
          operation_id: string
          org_id: string
          quantity_required?: number | null
          resource_code?: string | null
          resource_name?: string | null
          resource_type: string
          unit_of_measure?: string | null
          updated_at?: string | null
        }
        Update: {
          cost_rate?: number | null
          created_at?: string | null
          id?: string
          notes?: string | null
          operation_id?: string
          org_id?: string
          quantity_required?: number | null
          resource_code?: string | null
          resource_name?: string | null
          resource_type?: string
          unit_of_measure?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "operation_resources_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "routing_operations"
            referencedColumns: ["id"]
          },
        ]
      }
      operator_sessions: {
        Row: {
          created_at: string | null
          current_work_order_id: string | null
          device_info: Json | null
          id: string
          operator_id: string
          org_id: string
          session_end: string | null
          session_start: string | null
          status: string | null
          work_center_id: string
        }
        Insert: {
          created_at?: string | null
          current_work_order_id?: string | null
          device_info?: Json | null
          id?: string
          operator_id: string
          org_id: string
          session_end?: string | null
          session_start?: string | null
          status?: string | null
          work_center_id: string
        }
        Update: {
          created_at?: string | null
          current_work_order_id?: string | null
          device_info?: Json | null
          id?: string
          operator_id?: string
          org_id?: string
          session_end?: string | null
          session_start?: string | null
          status?: string | null
          work_center_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "operator_sessions_current_work_order_id_fkey"
            columns: ["current_work_order_id"]
            isOneToOne: false
            referencedRelation: "v_work_order_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operator_sessions_current_work_order_id_fkey"
            columns: ["current_work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operator_sessions_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "v_capacity_summary"
            referencedColumns: ["work_center_id"]
          },
          {
            foreignKeyName: "operator_sessions_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "v_work_center_productivity"
            referencedColumns: ["work_center_id"]
          },
          {
            foreignKeyName: "operator_sessions_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "v_work_centers_utilization"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operator_sessions_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "work_centers"
            referencedColumns: ["id"]
          },
        ]
      }
      org_settings: {
        Row: {
          created_at: string
          id: string
          key: string
          org_id: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          org_id: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          org_id?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "org_settings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          address: string | null
          city: string | null
          code: string
          commercial_registration: string | null
          country: string | null
          created_at: string | null
          created_by: string | null
          currency: string | null
          current_users_count: number | null
          date_format: string | null
          email: string | null
          favicon_url: string | null
          fax: string | null
          feature_flags: Json | null
          fiscal_year_start: number | null
          id: string
          industry: string | null
          is_active: boolean | null
          license_number: string | null
          logo_url: string | null
          max_users: number | null
          mobile: string | null
          name: string
          name_ar: string | null
          name_en: string | null
          phone: string | null
          plan_type: string | null
          postal_code: string | null
          primary_color: string | null
          secondary_color: string | null
          settings: Json | null
          slug: string | null
          state: string | null
          subscription_end: string | null
          subscription_start: string | null
          tax_id: string | null
          tax_number: string | null
          timezone: string | null
          updated_at: string | null
          website: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          code: string
          commercial_registration?: string | null
          country?: string | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          current_users_count?: number | null
          date_format?: string | null
          email?: string | null
          favicon_url?: string | null
          fax?: string | null
          feature_flags?: Json | null
          fiscal_year_start?: number | null
          id?: string
          industry?: string | null
          is_active?: boolean | null
          license_number?: string | null
          logo_url?: string | null
          max_users?: number | null
          mobile?: string | null
          name: string
          name_ar?: string | null
          name_en?: string | null
          phone?: string | null
          plan_type?: string | null
          postal_code?: string | null
          primary_color?: string | null
          secondary_color?: string | null
          settings?: Json | null
          slug?: string | null
          state?: string | null
          subscription_end?: string | null
          subscription_start?: string | null
          tax_id?: string | null
          tax_number?: string | null
          timezone?: string | null
          updated_at?: string | null
          website?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          code?: string
          commercial_registration?: string | null
          country?: string | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          current_users_count?: number | null
          date_format?: string | null
          email?: string | null
          favicon_url?: string | null
          fax?: string | null
          feature_flags?: Json | null
          fiscal_year_start?: number | null
          id?: string
          industry?: string | null
          is_active?: boolean | null
          license_number?: string | null
          logo_url?: string | null
          max_users?: number | null
          mobile?: string | null
          name?: string
          name_ar?: string | null
          name_en?: string | null
          phone?: string | null
          plan_type?: string | null
          postal_code?: string | null
          primary_color?: string | null
          secondary_color?: string | null
          settings?: Json | null
          slug?: string | null
          state?: string | null
          subscription_end?: string | null
          subscription_start?: string | null
          tax_id?: string | null
          tax_number?: string | null
          timezone?: string | null
          updated_at?: string | null
          website?: string | null
        }
        Relationships: []
      }
      payment_vouchers: {
        Row: {
          amount: number
          created_at: string | null
          created_by: string | null
          gl_entry_id: string | null
          id: string
          notes: string | null
          org_id: string
          payment_account_id: string
          payment_method: string
          reference: string | null
          status: string | null
          supplier_id: string | null
          updated_at: string | null
          vendor_id: string | null
          voucher_date: string
          voucher_number: string
        }
        Insert: {
          amount?: number
          created_at?: string | null
          created_by?: string | null
          gl_entry_id?: string | null
          id?: string
          notes?: string | null
          org_id: string
          payment_account_id: string
          payment_method: string
          reference?: string | null
          status?: string | null
          supplier_id?: string | null
          updated_at?: string | null
          vendor_id?: string | null
          voucher_date?: string
          voucher_number: string
        }
        Update: {
          amount?: number
          created_at?: string | null
          created_by?: string | null
          gl_entry_id?: string | null
          id?: string
          notes?: string | null
          org_id?: string
          payment_account_id?: string
          payment_method?: string
          reference?: string | null
          status?: string | null
          supplier_id?: string | null
          updated_at?: string | null
          vendor_id?: string | null
          voucher_date?: string
          voucher_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_payment_vouchers_account"
            columns: ["payment_account_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_payment_vouchers_entry"
            columns: ["gl_entry_id"]
            isOneToOne: false
            referencedRelation: "gl_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_payment_vouchers_entry"
            columns: ["gl_entry_id"]
            isOneToOne: false
            referencedRelation: "v_gl_entries_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_payment_vouchers_org"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_payment_vouchers_vendor"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_details: {
        Row: {
          amount: number
          bucket: string | null
          component_code: string | null
          component_id: string | null
          component_label: string | null
          created_at: string | null
          employee_id: string
          id: string
          is_deduction: boolean
          is_processed: boolean | null
          notes: string | null
          org_id: string
          payroll_run_id: string
          processed_at: string | null
          updated_at: string | null
        }
        Insert: {
          amount: number
          bucket?: string | null
          component_code?: string | null
          component_id?: string | null
          component_label?: string | null
          created_at?: string | null
          employee_id: string
          id?: string
          is_deduction?: boolean
          is_processed?: boolean | null
          notes?: string | null
          org_id: string
          payroll_run_id: string
          processed_at?: string | null
          updated_at?: string | null
        }
        Update: {
          amount?: number
          bucket?: string | null
          component_code?: string | null
          component_id?: string | null
          component_label?: string | null
          created_at?: string | null
          employee_id?: string
          id?: string
          is_deduction?: boolean
          is_processed?: boolean | null
          notes?: string | null
          org_id?: string
          payroll_run_id?: string
          processed_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_details_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "salary_components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_details_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_details_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_details_payroll_run_id_fkey"
            columns: ["payroll_run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_periods: {
        Row: {
          created_at: string | null
          end_date: string
          id: string
          notes: string | null
          org_id: string
          period_code: string
          period_name: string
          period_type: string
          processed_at: string | null
          processed_by: string | null
          start_date: string
          status: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          end_date: string
          id?: string
          notes?: string | null
          org_id: string
          period_code: string
          period_name: string
          period_type: string
          processed_at?: string | null
          processed_by?: string | null
          start_date: string
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          end_date?: string
          id?: string
          notes?: string | null
          org_id?: string
          period_code?: string
          period_name?: string
          period_type?: string
          processed_at?: string | null
          processed_by?: string | null
          start_date?: string
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_periods_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_runs: {
        Row: {
          created_at: string | null
          id: string
          idempotency_key: string | null
          journal_entry_id: string | null
          notes: string | null
          org_id: string
          period_id: string
          request_hash: string | null
          run_date: string
          status: string | null
          total_deductions: number | null
          total_gross: number | null
          total_net: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          idempotency_key?: string | null
          journal_entry_id?: string | null
          notes?: string | null
          org_id: string
          period_id: string
          request_hash?: string | null
          run_date: string
          status?: string | null
          total_deductions?: number | null
          total_gross?: number | null
          total_net?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          idempotency_key?: string | null
          journal_entry_id?: string | null
          notes?: string | null
          org_id?: string
          period_id?: string
          request_hash?: string | null
          run_date?: string
          status?: string | null
          total_deductions?: number | null
          total_gross?: number | null
          total_net?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_runs_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "gl_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_runs_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "v_gl_entries_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_runs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_runs_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "payroll_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          action: string
          action_ar: string
          created_at: string | null
          description: string | null
          description_ar: string | null
          id: string
          module_id: string
          permission_key: string
          resource: string
          resource_ar: string
        }
        Insert: {
          action: string
          action_ar: string
          created_at?: string | null
          description?: string | null
          description_ar?: string | null
          id?: string
          module_id: string
          permission_key: string
          resource: string
          resource_ar: string
        }
        Update: {
          action?: string
          action_ar?: string
          created_at?: string | null
          description?: string | null
          description_ar?: string | null
          id?: string
          module_id?: string
          permission_key?: string
          resource?: string
          resource_ar?: string
        }
        Relationships: [
          {
            foreignKeyName: "permissions_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
            referencedColumns: ["id"]
          },
        ]
      }
      physical_count_items: {
        Row: {
          count_status: string | null
          counted_at: string | null
          counted_by: string | null
          counted_qty: number | null
          created_at: string
          difference_qty: number | null
          first_count: number | null
          id: string
          notes: string | null
          organization_id: string
          product_id: string
          second_count: number | null
          session_id: string
          system_qty: number
          third_count: number | null
          updated_at: string | null
          verified_at: string | null
          verified_by: string | null
          warehouse_id: string | null
        }
        Insert: {
          count_status?: string | null
          counted_at?: string | null
          counted_by?: string | null
          counted_qty?: number | null
          created_at?: string
          difference_qty?: number | null
          first_count?: number | null
          id?: string
          notes?: string | null
          organization_id: string
          product_id: string
          second_count?: number | null
          session_id: string
          system_qty: number
          third_count?: number | null
          updated_at?: string | null
          verified_at?: string | null
          verified_by?: string | null
          warehouse_id?: string | null
        }
        Update: {
          count_status?: string | null
          counted_at?: string | null
          counted_by?: string | null
          counted_qty?: number | null
          created_at?: string
          difference_qty?: number | null
          first_count?: number | null
          id?: string
          notes?: string | null
          organization_id?: string
          product_id?: string
          second_count?: number | null
          session_id?: string
          system_qty?: number
          third_count?: number | null
          updated_at?: string | null
          verified_at?: string | null
          verified_by?: string | null
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "physical_count_items_org_check"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "physical_count_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "physical_count_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "physical_count_items_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "physical_count_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "physical_count_items_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      physical_count_sessions: {
        Row: {
          adjustment_created: boolean | null
          adjustment_id: string | null
          completed_at: string | null
          count_date: string
          count_type: string
          counter_user_ids: string[]
          created_at: string
          created_by: string
          discrepancies_found: number | null
          id: string
          notes: string | null
          organization_id: string
          session_number: string
          status: string
          supervisor_id: string | null
          total_items_counted: number | null
          warehouse_id: string | null
        }
        Insert: {
          adjustment_created?: boolean | null
          adjustment_id?: string | null
          completed_at?: string | null
          count_date: string
          count_type: string
          counter_user_ids: string[]
          created_at?: string
          created_by: string
          discrepancies_found?: number | null
          id?: string
          notes?: string | null
          organization_id: string
          session_number: string
          status?: string
          supervisor_id?: string | null
          total_items_counted?: number | null
          warehouse_id?: string | null
        }
        Update: {
          adjustment_created?: boolean | null
          adjustment_id?: string | null
          completed_at?: string | null
          count_date?: string
          count_type?: string
          counter_user_ids?: string[]
          created_at?: string
          created_by?: string
          discrepancies_found?: number | null
          id?: string
          notes?: string | null
          organization_id?: string
          session_number?: string
          status?: string
          supervisor_id?: string | null
          total_items_counted?: number | null
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "physical_count_sessions_adjustment_id_fkey"
            columns: ["adjustment_id"]
            isOneToOne: false
            referencedRelation: "stock_adjustments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "physical_count_sessions_org_check"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "physical_count_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "physical_count_sessions_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      positions: {
        Row: {
          code: string
          created_at: string | null
          department_id: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          name_ar: string
          org_id: string
          updated_at: string | null
        }
        Insert: {
          code: string
          created_at?: string | null
          department_id?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          name_ar: string
          org_id: string
          updated_at?: string | null
        }
        Update: {
          code?: string
          created_at?: string | null
          department_id?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          name_ar?: string
          org_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "positions_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "positions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      product_uom_conversions: {
        Row: {
          allow_cross_dimension: boolean
          barcode: string | null
          created_at: string
          created_by: string | null
          factor_to_base: number
          id: string
          is_active: boolean
          notes: string | null
          org_id: string
          product_id: string
          uom_id: string
          updated_at: string
          use_for_purchase: boolean
          use_for_sale: boolean
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          allow_cross_dimension?: boolean
          barcode?: string | null
          created_at?: string
          created_by?: string | null
          factor_to_base: number
          id?: string
          is_active?: boolean
          notes?: string | null
          org_id: string
          product_id: string
          uom_id: string
          updated_at?: string
          use_for_purchase?: boolean
          use_for_sale?: boolean
          valid_from?: string
          valid_to?: string | null
        }
        Update: {
          allow_cross_dimension?: boolean
          barcode?: string | null
          created_at?: string
          created_by?: string | null
          factor_to_base?: number
          id?: string
          is_active?: boolean
          notes?: string | null
          org_id?: string
          product_id?: string
          uom_id?: string
          updated_at?: string
          use_for_purchase?: boolean
          use_for_sale?: boolean
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_uom_conversions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_uom_conversions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_uom_conversions_uom_id_fkey"
            columns: ["uom_id"]
            isOneToOne: false
            referencedRelation: "uoms"
            referencedColumns: ["id"]
          },
        ]
      }
      production_schedules: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          created_by: string | null
          id: string
          notes: string | null
          org_id: string
          period_end: string
          period_start: string
          schedule_name: string | null
          schedule_number: string
          status: string | null
          total_planned_hours: number | null
          total_work_orders: number | null
          updated_at: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          notes?: string | null
          org_id: string
          period_end: string
          period_start: string
          schedule_name?: string | null
          schedule_number: string
          status?: string | null
          total_planned_hours?: number | null
          total_work_orders?: number | null
          updated_at?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          notes?: string | null
          org_id?: string
          period_end?: string
          period_start?: string
          schedule_name?: string | null
          schedule_number?: string
          status?: string | null
          total_planned_hours?: number | null
          total_work_orders?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      products: {
        Row: {
          base_uom_id: string | null
          category_id: string | null
          code: string
          cost_price: number | null
          created_at: string | null
          description: string | null
          gross_weight: number | null
          id: string
          is_active: boolean | null
          is_stockable: boolean | null
          minimum_stock: number | null
          name: string
          name_ar: string | null
          net_weight: number | null
          org_id: string | null
          price: number | null
          selling_price: number | null
          stock_quantity: number | null
          stock_queue: Json | null
          stock_value: number | null
          unit: string | null
          uom_migration_status: string
          updated_at: string | null
          valuation_method:
            | Database["public"]["Enums"]["valuation_method_enum"]
            | null
          weight_uom_id: string | null
        }
        Insert: {
          base_uom_id?: string | null
          category_id?: string | null
          code: string
          cost_price?: number | null
          created_at?: string | null
          description?: string | null
          gross_weight?: number | null
          id?: string
          is_active?: boolean | null
          is_stockable?: boolean | null
          minimum_stock?: number | null
          name: string
          name_ar?: string | null
          net_weight?: number | null
          org_id?: string | null
          price?: number | null
          selling_price?: number | null
          stock_quantity?: number | null
          stock_queue?: Json | null
          stock_value?: number | null
          unit?: string | null
          uom_migration_status?: string
          updated_at?: string | null
          valuation_method?:
            | Database["public"]["Enums"]["valuation_method_enum"]
            | null
          weight_uom_id?: string | null
        }
        Update: {
          base_uom_id?: string | null
          category_id?: string | null
          code?: string
          cost_price?: number | null
          created_at?: string | null
          description?: string | null
          gross_weight?: number | null
          id?: string
          is_active?: boolean | null
          is_stockable?: boolean | null
          minimum_stock?: number | null
          name?: string
          name_ar?: string | null
          net_weight?: number | null
          org_id?: string | null
          price?: number | null
          selling_price?: number | null
          stock_quantity?: number | null
          stock_queue?: Json | null
          stock_value?: number | null
          unit?: string | null
          uom_migration_status?: string
          updated_at?: string | null
          valuation_method?:
            | Database["public"]["Enums"]["valuation_method_enum"]
            | null
          weight_uom_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_base_uom_id_fkey"
            columns: ["base_uom_id"]
            isOneToOne: false
            referencedRelation: "uoms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_weight_uom_id_fkey"
            columns: ["weight_uom_id"]
            isOneToOne: false
            referencedRelation: "uoms"
            referencedColumns: ["id"]
          },
        ]
      }
      profit_centers: {
        Row: {
          code: string
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          name_ar: string | null
          parent_id: string | null
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          code: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          name_ar?: string | null
          parent_id?: string | null
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          code?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          name_ar?: string | null
          parent_id?: string | null
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profit_centers_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "profit_centers"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_order_lines: {
        Row: {
          accepted_quantity: number | null
          conversion_factor_snapshot: number | null
          created_at: string | null
          description: string | null
          discount_percentage: number | null
          id: string
          line_number: number
          line_total: number | null
          notes: string | null
          org_id: string
          product_id: string
          purchase_order_id: string
          qty_entered: number | null
          quantity: number
          received_quantity: number | null
          rejected_quantity: number | null
          tax_percentage: number | null
          unit_price: number
          unit_price_entered: number | null
          uom_id: string | null
          updated_at: string | null
        }
        Insert: {
          accepted_quantity?: number | null
          conversion_factor_snapshot?: number | null
          created_at?: string | null
          description?: string | null
          discount_percentage?: number | null
          id?: string
          line_number?: number
          line_total?: number | null
          notes?: string | null
          org_id: string
          product_id: string
          purchase_order_id: string
          qty_entered?: number | null
          quantity: number
          received_quantity?: number | null
          rejected_quantity?: number | null
          tax_percentage?: number | null
          unit_price: number
          unit_price_entered?: number | null
          uom_id?: string | null
          updated_at?: string | null
        }
        Update: {
          accepted_quantity?: number | null
          conversion_factor_snapshot?: number | null
          created_at?: string | null
          description?: string | null
          discount_percentage?: number | null
          id?: string
          line_number?: number
          line_total?: number | null
          notes?: string | null
          org_id?: string
          product_id?: string
          purchase_order_id?: string
          qty_entered?: number | null
          quantity?: number
          received_quantity?: number | null
          rejected_quantity?: number | null
          tax_percentage?: number | null
          unit_price?: number
          unit_price_entered?: number | null
          uom_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_lines_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_lines_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_lines_uom_id_fkey"
            columns: ["uom_id"]
            isOneToOne: false
            referencedRelation: "uoms"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          created_at: string | null
          created_by: string | null
          discount_amount: number | null
          expected_delivery_date: string | null
          id: string
          notes: string | null
          order_date: string
          order_number: string
          org_id: string
          status: string | null
          subtotal: number | null
          tax_amount: number | null
          total_amount: number | null
          updated_at: string | null
          vendor_id: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          discount_amount?: number | null
          expected_delivery_date?: string | null
          id?: string
          notes?: string | null
          order_date?: string
          order_number: string
          org_id: string
          status?: string | null
          subtotal?: number | null
          tax_amount?: number | null
          total_amount?: number | null
          updated_at?: string | null
          vendor_id: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          discount_amount?: number | null
          expected_delivery_date?: string | null
          id?: string
          notes?: string | null
          order_date?: string
          order_number?: string
          org_id?: string
          status?: string | null
          subtotal?: number | null
          tax_amount?: number | null
          total_amount?: number | null
          updated_at?: string | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      quality_inspections: {
        Row: {
          attachments: Json | null
          corrective_action: string | null
          created_at: string | null
          failed_quantity: number | null
          findings: string | null
          id: string
          inspection_date: string | null
          inspection_number: string
          inspection_type: string | null
          inspector_id: string | null
          org_id: string
          passed_quantity: number | null
          result: string | null
          sample_size: number | null
          specifications: string | null
          updated_at: string | null
          work_order_id: string
        }
        Insert: {
          attachments?: Json | null
          corrective_action?: string | null
          created_at?: string | null
          failed_quantity?: number | null
          findings?: string | null
          id?: string
          inspection_date?: string | null
          inspection_number: string
          inspection_type?: string | null
          inspector_id?: string | null
          org_id: string
          passed_quantity?: number | null
          result?: string | null
          sample_size?: number | null
          specifications?: string | null
          updated_at?: string | null
          work_order_id: string
        }
        Update: {
          attachments?: Json | null
          corrective_action?: string | null
          created_at?: string | null
          failed_quantity?: number | null
          findings?: string | null
          id?: string
          inspection_date?: string | null
          inspection_number?: string
          inspection_type?: string | null
          inspector_id?: string | null
          org_id?: string
          passed_quantity?: number | null
          result?: string | null
          sample_size?: number | null
          specifications?: string | null
          updated_at?: string | null
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quality_inspections_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "v_work_order_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quality_inspections_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      receipt_vouchers: {
        Row: {
          amount: number
          created_at: string | null
          created_by: string | null
          customer_id: string
          gl_entry_id: string | null
          id: string
          notes: string | null
          org_id: string
          payment_account_id: string
          payment_method: string
          reference: string | null
          status: string | null
          updated_at: string | null
          voucher_date: string
          voucher_number: string
        }
        Insert: {
          amount?: number
          created_at?: string | null
          created_by?: string | null
          customer_id: string
          gl_entry_id?: string | null
          id?: string
          notes?: string | null
          org_id: string
          payment_account_id: string
          payment_method: string
          reference?: string | null
          status?: string | null
          updated_at?: string | null
          voucher_date?: string
          voucher_number: string
        }
        Update: {
          amount?: number
          created_at?: string | null
          created_by?: string | null
          customer_id?: string
          gl_entry_id?: string | null
          id?: string
          notes?: string | null
          org_id?: string
          payment_account_id?: string
          payment_method?: string
          reference?: string | null
          status?: string | null
          updated_at?: string | null
          voucher_date?: string
          voucher_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_receipt_vouchers_account"
            columns: ["payment_account_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_receipt_vouchers_customer"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_receipt_vouchers_entry"
            columns: ["gl_entry_id"]
            isOneToOne: false
            referencedRelation: "gl_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_receipt_vouchers_entry"
            columns: ["gl_entry_id"]
            isOneToOne: false
            referencedRelation: "v_gl_entries_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_receipt_vouchers_org"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliation_items: {
        Row: {
          created_at: string | null
          id: string
          journal_line_id: string | null
          matched: boolean | null
          matched_at: string | null
          matched_by: string | null
          reconciliation_id: string
          statement_amount: number | null
          statement_date: string | null
          statement_reference: string | null
          tenant_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          journal_line_id?: string | null
          matched?: boolean | null
          matched_at?: string | null
          matched_by?: string | null
          reconciliation_id: string
          statement_amount?: number | null
          statement_date?: string | null
          statement_reference?: string | null
          tenant_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          journal_line_id?: string | null
          matched?: boolean | null
          matched_at?: string | null
          matched_by?: string | null
          reconciliation_id?: string
          statement_amount?: number | null
          statement_date?: string | null
          statement_reference?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_items_journal_line_id_fkey"
            columns: ["journal_line_id"]
            isOneToOne: false
            referencedRelation: "journal_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_items_reconciliation_id_fkey"
            columns: ["reconciliation_id"]
            isOneToOne: false
            referencedRelation: "account_reconciliations"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          permission_id: string
          role_id: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          permission_id: string
          role_id: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          permission_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      role_templates: {
        Row: {
          available_for_plans: string[] | null
          category: string | null
          created_at: string | null
          description: string | null
          description_ar: string | null
          id: string
          is_active: boolean | null
          name: string
          name_ar: string
          permission_keys: string[]
        }
        Insert: {
          available_for_plans?: string[] | null
          category?: string | null
          created_at?: string | null
          description?: string | null
          description_ar?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          name_ar: string
          permission_keys: string[]
        }
        Update: {
          available_for_plans?: string[] | null
          category?: string | null
          created_at?: string | null
          description?: string | null
          description_ar?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          name_ar?: string
          permission_keys?: string[]
        }
        Relationships: []
      }
      roles: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          description_ar: string | null
          id: string
          is_active: boolean | null
          is_system_role: boolean | null
          name: string
          name_ar: string
          org_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          description_ar?: string | null
          id?: string
          is_active?: boolean | null
          is_system_role?: boolean | null
          name: string
          name_ar: string
          org_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          description_ar?: string | null
          id?: string
          is_active?: boolean | null
          is_system_role?: boolean | null
          name?: string
          name_ar?: string
          org_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "roles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      routing_operations: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          inspection_instructions: string | null
          is_active: boolean | null
          is_outsourced: boolean | null
          labor_rate_per_hour: number | null
          operation_code: string
          operation_name: string
          operation_name_ar: string | null
          operation_sequence: number
          operation_type: string | null
          org_id: string
          outsource_cost: number | null
          outsource_vendor_id: string | null
          overhead_rate_per_hour: number | null
          requires_inspection: boolean | null
          routing_id: string
          standard_move_time: number | null
          standard_queue_time: number | null
          standard_run_time_per_unit: number | null
          standard_setup_time: number | null
          time_unit: string | null
          updated_at: string | null
          work_center_id: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          inspection_instructions?: string | null
          is_active?: boolean | null
          is_outsourced?: boolean | null
          labor_rate_per_hour?: number | null
          operation_code: string
          operation_name: string
          operation_name_ar?: string | null
          operation_sequence: number
          operation_type?: string | null
          org_id: string
          outsource_cost?: number | null
          outsource_vendor_id?: string | null
          overhead_rate_per_hour?: number | null
          requires_inspection?: boolean | null
          routing_id: string
          standard_move_time?: number | null
          standard_queue_time?: number | null
          standard_run_time_per_unit?: number | null
          standard_setup_time?: number | null
          time_unit?: string | null
          updated_at?: string | null
          work_center_id?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          inspection_instructions?: string | null
          is_active?: boolean | null
          is_outsourced?: boolean | null
          labor_rate_per_hour?: number | null
          operation_code?: string
          operation_name?: string
          operation_name_ar?: string | null
          operation_sequence?: number
          operation_type?: string | null
          org_id?: string
          outsource_cost?: number | null
          outsource_vendor_id?: string | null
          overhead_rate_per_hour?: number | null
          requires_inspection?: boolean | null
          routing_id?: string
          standard_move_time?: number | null
          standard_queue_time?: number | null
          standard_run_time_per_unit?: number | null
          standard_setup_time?: number | null
          time_unit?: string | null
          updated_at?: string | null
          work_center_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "routing_operations_routing_id_fkey"
            columns: ["routing_id"]
            isOneToOne: false
            referencedRelation: "routings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routing_operations_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "v_capacity_summary"
            referencedColumns: ["work_center_id"]
          },
          {
            foreignKeyName: "routing_operations_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "v_work_center_productivity"
            referencedColumns: ["work_center_id"]
          },
          {
            foreignKeyName: "routing_operations_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "v_work_centers_utilization"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routing_operations_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "work_centers"
            referencedColumns: ["id"]
          },
        ]
      }
      routings: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          description_ar: string | null
          effective_date: string | null
          expiry_date: string | null
          id: string
          is_active: boolean | null
          item_id: string | null
          org_id: string
          routing_code: string
          routing_name: string
          routing_name_ar: string | null
          status: string | null
          updated_at: string | null
          updated_by: string | null
          version: number | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          description_ar?: string | null
          effective_date?: string | null
          expiry_date?: string | null
          id?: string
          is_active?: boolean | null
          item_id?: string | null
          org_id: string
          routing_code: string
          routing_name: string
          routing_name_ar?: string | null
          status?: string | null
          updated_at?: string | null
          updated_by?: string | null
          version?: number | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          description_ar?: string | null
          effective_date?: string | null
          expiry_date?: string | null
          id?: string
          is_active?: boolean | null
          item_id?: string | null
          org_id?: string
          routing_code?: string
          routing_name?: string
          routing_name_ar?: string | null
          status?: string | null
          updated_at?: string | null
          updated_by?: string | null
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "routings_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      salary_components: {
        Row: {
          calculation_type: string | null
          code: string
          component_type: string
          created_at: string | null
          id: string
          is_active: boolean | null
          is_insurable: boolean | null
          is_taxable: boolean | null
          name: string
          name_ar: string
          notes: string | null
          org_id: string
          percentage_base: string | null
          updated_at: string | null
          value: number | null
        }
        Insert: {
          calculation_type?: string | null
          code: string
          component_type: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_insurable?: boolean | null
          is_taxable?: boolean | null
          name: string
          name_ar: string
          notes?: string | null
          org_id: string
          percentage_base?: string | null
          updated_at?: string | null
          value?: number | null
        }
        Update: {
          calculation_type?: string | null
          code?: string
          component_type?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_insurable?: boolean | null
          is_taxable?: boolean | null
          name?: string
          name_ar?: string
          notes?: string | null
          org_id?: string
          percentage_base?: string | null
          updated_at?: string | null
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "salary_components_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_invoice_lines: {
        Row: {
          cogs: number | null
          conversion_factor_snapshot: number | null
          created_at: string | null
          delivered_quantity: number | null
          description: string | null
          discount_percentage: number | null
          id: string
          invoice_id: string
          item_id: string | null
          line_number: number
          line_total: number | null
          notes: string | null
          org_id: string
          product_id: string
          qty_entered: number | null
          quantity: number
          tax_percentage: number | null
          unit_cost_at_sale: number | null
          unit_price: number
          unit_price_entered: number | null
          uom_id: string | null
          updated_at: string | null
        }
        Insert: {
          cogs?: number | null
          conversion_factor_snapshot?: number | null
          created_at?: string | null
          delivered_quantity?: number | null
          description?: string | null
          discount_percentage?: number | null
          id?: string
          invoice_id: string
          item_id?: string | null
          line_number?: number
          line_total?: number | null
          notes?: string | null
          org_id: string
          product_id: string
          qty_entered?: number | null
          quantity: number
          tax_percentage?: number | null
          unit_cost_at_sale?: number | null
          unit_price: number
          unit_price_entered?: number | null
          uom_id?: string | null
          updated_at?: string | null
        }
        Update: {
          cogs?: number | null
          conversion_factor_snapshot?: number | null
          created_at?: string | null
          delivered_quantity?: number | null
          description?: string | null
          discount_percentage?: number | null
          id?: string
          invoice_id?: string
          item_id?: string | null
          line_number?: number
          line_total?: number | null
          notes?: string | null
          org_id?: string
          product_id?: string
          qty_entered?: number | null
          quantity?: number
          tax_percentage?: number | null
          unit_cost_at_sale?: number | null
          unit_price?: number
          unit_price_entered?: number | null
          uom_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_invoice_lines_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_invoice_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_invoice_lines_sales_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "sales_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_invoice_lines_uom_id_fkey"
            columns: ["uom_id"]
            isOneToOne: false
            referencedRelation: "uoms"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_invoices: {
        Row: {
          balance: number | null
          created_at: string | null
          created_by: string | null
          customer_id: string
          delivery_status: string | null
          discount_amount: number | null
          due_date: string | null
          id: string
          invoice_date: string
          invoice_number: string
          notes: string | null
          org_id: string
          paid_amount: number | null
          payment_status: string | null
          payment_terms: string | null
          status: string | null
          subtotal: number
          tax_amount: number | null
          total_amount: number
          updated_at: string | null
        }
        Insert: {
          balance?: number | null
          created_at?: string | null
          created_by?: string | null
          customer_id: string
          delivery_status?: string | null
          discount_amount?: number | null
          due_date?: string | null
          id?: string
          invoice_date?: string
          invoice_number: string
          notes?: string | null
          org_id: string
          paid_amount?: number | null
          payment_status?: string | null
          payment_terms?: string | null
          status?: string | null
          subtotal: number
          tax_amount?: number | null
          total_amount: number
          updated_at?: string | null
        }
        Update: {
          balance?: number | null
          created_at?: string | null
          created_by?: string | null
          customer_id?: string
          delivery_status?: string | null
          discount_amount?: number | null
          due_date?: string | null
          id?: string
          invoice_date?: string
          invoice_number?: string
          notes?: string | null
          org_id?: string
          paid_amount?: number | null
          payment_status?: string | null
          payment_terms?: string | null
          status?: string | null
          subtotal?: number
          tax_amount?: number | null
          total_amount?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_invoices_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_orders: {
        Row: {
          approved_by: string | null
          cogs_amount: number | null
          created_at: string | null
          created_by: string | null
          currency: string | null
          customer_id: string
          delivery_date: string | null
          discount_amount: number | null
          final_amount: number | null
          id: string
          notes: string | null
          org_id: string
          so_date: string
          so_number: string
          status: string | null
          tax_amount: number | null
          total_amount: number | null
          updated_at: string | null
        }
        Insert: {
          approved_by?: string | null
          cogs_amount?: number | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          customer_id: string
          delivery_date?: string | null
          discount_amount?: number | null
          final_amount?: number | null
          id?: string
          notes?: string | null
          org_id: string
          so_date?: string
          so_number: string
          status?: string | null
          tax_amount?: number | null
          total_amount?: number | null
          updated_at?: string | null
        }
        Update: {
          approved_by?: string | null
          cogs_amount?: number | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          customer_id?: string
          delivery_date?: string | null
          discount_amount?: number | null
          final_amount?: number | null
          id?: string
          notes?: string | null
          org_id?: string
          so_date?: string
          so_number?: string
          status?: string | null
          tax_amount?: number | null
          total_amount?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_orders_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_details: {
        Row: {
          created_at: string | null
          delay_hours: number | null
          delay_reason: string | null
          id: string
          org_id: string
          priority: number | null
          schedule_id: string
          schedule_sequence: number
          schedule_status: string | null
          scheduled_end: string
          scheduled_start: string
          updated_at: string | null
          work_order_id: string
        }
        Insert: {
          created_at?: string | null
          delay_hours?: number | null
          delay_reason?: string | null
          id?: string
          org_id: string
          priority?: number | null
          schedule_id: string
          schedule_sequence: number
          schedule_status?: string | null
          scheduled_end: string
          scheduled_start: string
          updated_at?: string | null
          work_order_id: string
        }
        Update: {
          created_at?: string | null
          delay_hours?: number | null
          delay_reason?: string | null
          id?: string
          org_id?: string
          priority?: number | null
          schedule_id?: string
          schedule_sequence?: number
          schedule_status?: string | null
          scheduled_end?: string
          scheduled_start?: string
          updated_at?: string | null
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_details_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "production_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_details_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "v_production_schedule_details"
            referencedColumns: ["schedule_id"]
          },
          {
            foreignKeyName: "schedule_details_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "v_work_order_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_details_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduling_constraints: {
        Row: {
          constraint_type: string
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          max_lag_hours: number | null
          min_lag_hours: number | null
          org_id: string
          source_work_order_id: string | null
          target_work_order_id: string | null
          time_window_end: string | null
          time_window_start: string | null
          work_center_id: string | null
        }
        Insert: {
          constraint_type: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          max_lag_hours?: number | null
          min_lag_hours?: number | null
          org_id: string
          source_work_order_id?: string | null
          target_work_order_id?: string | null
          time_window_end?: string | null
          time_window_start?: string | null
          work_center_id?: string | null
        }
        Update: {
          constraint_type?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          max_lag_hours?: number | null
          min_lag_hours?: number | null
          org_id?: string
          source_work_order_id?: string | null
          target_work_order_id?: string | null
          time_window_end?: string | null
          time_window_start?: string | null
          work_center_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scheduling_constraints_source_work_order_id_fkey"
            columns: ["source_work_order_id"]
            isOneToOne: false
            referencedRelation: "v_work_order_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduling_constraints_source_work_order_id_fkey"
            columns: ["source_work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduling_constraints_target_work_order_id_fkey"
            columns: ["target_work_order_id"]
            isOneToOne: false
            referencedRelation: "v_work_order_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduling_constraints_target_work_order_id_fkey"
            columns: ["target_work_order_id"]
            isOneToOne: false
            referencedRelation: "work_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduling_constraints_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "v_capacity_summary"
            referencedColumns: ["work_center_id"]
          },
          {
            foreignKeyName: "scheduling_constraints_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "v_work_center_productivity"
            referencedColumns: ["work_center_id"]
          },
          {
            foreignKeyName: "scheduling_constraints_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "v_work_centers_utilization"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduling_constraints_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "work_centers"
            referencedColumns: ["id"]
          },
        ]
      }
      security_audit_reports: {
        Row: {
          created_at: string | null
          id: string
          org_id: string | null
          report_date: string | null
          report_text: string | null
          tables_with_missing_policies: string[] | null
          tables_without_rls: string[] | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          org_id?: string | null
          report_date?: string | null
          report_text?: string | null
          tables_with_missing_policies?: string[] | null
          tables_without_rls?: string[] | null
        }
        Update: {
          created_at?: string | null
          id?: string
          org_id?: string | null
          report_date?: string | null
          report_text?: string | null
          tables_with_missing_policies?: string[] | null
          tables_without_rls?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "security_audit_reports_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      stage_costs: {
        Row: {
          abnormal_scrap_cost: number | null
          abnormal_scrap_qty: number | null
          batch_id: string | null
          created_at: string | null
          created_by: string | null
          current_period_cost: number | null
          dl_cost: number | null
          dm_cost: number | null
          good_qty: number | null
          id: string
          input_qty: number | null
          is_final: boolean | null
          manufacturing_order_id: string
          mode: string | null
          moh_cost: number | null
          normal_scrap_cost: number | null
          normal_scrap_qty: number | null
          notes: string | null
          org_id: string
          regrind_cost: number | null
          regrind_proc_cost: number | null
          rework_qty: number | null
          scrap_qty: number | null
          stage_number: number
          total_cost: number | null
          transferred_in: number | null
          unit_cost: number | null
          updated_at: string | null
          updated_by: string | null
          waste_credit: number | null
          waste_credit_amount: number | null
          wip_beginning_cc_completion_pct: number | null
          wip_beginning_cost: number | null
          wip_beginning_dm_completion_pct: number | null
          wip_beginning_qty: number | null
          wip_end_cc_completion_pct: number | null
          wip_end_dm_completion_pct: number | null
          wip_end_qty: number | null
          work_center_id: string | null
        }
        Insert: {
          abnormal_scrap_cost?: number | null
          abnormal_scrap_qty?: number | null
          batch_id?: string | null
          created_at?: string | null
          created_by?: string | null
          current_period_cost?: number | null
          dl_cost?: number | null
          dm_cost?: number | null
          good_qty?: number | null
          id?: string
          input_qty?: number | null
          is_final?: boolean | null
          manufacturing_order_id: string
          mode?: string | null
          moh_cost?: number | null
          normal_scrap_cost?: number | null
          normal_scrap_qty?: number | null
          notes?: string | null
          org_id: string
          regrind_cost?: number | null
          regrind_proc_cost?: number | null
          rework_qty?: number | null
          scrap_qty?: number | null
          stage_number: number
          total_cost?: number | null
          transferred_in?: number | null
          unit_cost?: number | null
          updated_at?: string | null
          updated_by?: string | null
          waste_credit?: number | null
          waste_credit_amount?: number | null
          wip_beginning_cc_completion_pct?: number | null
          wip_beginning_cost?: number | null
          wip_beginning_dm_completion_pct?: number | null
          wip_beginning_qty?: number | null
          wip_end_cc_completion_pct?: number | null
          wip_end_dm_completion_pct?: number | null
          wip_end_qty?: number | null
          work_center_id?: string | null
        }
        Update: {
          abnormal_scrap_cost?: number | null
          abnormal_scrap_qty?: number | null
          batch_id?: string | null
          created_at?: string | null
          created_by?: string | null
          current_period_cost?: number | null
          dl_cost?: number | null
          dm_cost?: number | null
          good_qty?: number | null
          id?: string
          input_qty?: number | null
          is_final?: boolean | null
          manufacturing_order_id?: string
          mode?: string | null
          moh_cost?: number | null
          normal_scrap_cost?: number | null
          normal_scrap_qty?: number | null
          notes?: string | null
          org_id?: string
          regrind_cost?: number | null
          regrind_proc_cost?: number | null
          rework_qty?: number | null
          scrap_qty?: number | null
          stage_number?: number
          total_cost?: number | null
          transferred_in?: number | null
          unit_cost?: number | null
          updated_at?: string | null
          updated_by?: string | null
          waste_credit?: number | null
          waste_credit_amount?: number | null
          wip_beginning_cc_completion_pct?: number | null
          wip_beginning_cost?: number | null
          wip_beginning_dm_completion_pct?: number | null
          wip_beginning_qty?: number | null
          wip_end_cc_completion_pct?: number | null
          wip_end_dm_completion_pct?: number | null
          wip_end_qty?: number | null
          work_center_id?: string | null
        }
        Relationships: []
      }
      stage_wip_log: {
        Row: {
          batch_number: string | null
          closed_at: string | null
          closed_by: string | null
          conversion_completion_pct: number | null
          cost_beginning_wip: number | null
          cost_beginning_wip_conversion: number | null
          cost_beginning_wip_material: number | null
          cost_beginning_wip_transferred_in: number | null
          cost_completed_transferred: number | null
          cost_ending_wip: number | null
          cost_labor: number | null
          cost_material: number | null
          cost_overhead: number | null
          cost_per_eu_conversion: number | null
          cost_per_eu_material: number | null
          cost_per_eu_transferred_in: number | null
          cost_total: number | null
          cost_transferred_in: number | null
          created_at: string | null
          created_by: string | null
          equivalent_units_conversion: number | null
          equivalent_units_material: number | null
          equivalent_units_transferred_in: number | null
          eu_calculation_note: string | null
          eu_calculation_version: number | null
          id: string
          is_closed: boolean | null
          material_completion_pct: number | null
          mo_id: string
          notes: string | null
          org_id: string
          period_end: string
          period_start: string
          stage_id: string
          units_beginning_wip: number | null
          units_completed: number | null
          units_ending_wip: number | null
          units_started: number | null
          units_transferred_in: number | null
          units_transferred_out: number | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          batch_number?: string | null
          closed_at?: string | null
          closed_by?: string | null
          conversion_completion_pct?: number | null
          cost_beginning_wip?: number | null
          cost_beginning_wip_conversion?: number | null
          cost_beginning_wip_material?: number | null
          cost_beginning_wip_transferred_in?: number | null
          cost_completed_transferred?: number | null
          cost_ending_wip?: number | null
          cost_labor?: number | null
          cost_material?: number | null
          cost_overhead?: number | null
          cost_per_eu_conversion?: number | null
          cost_per_eu_material?: number | null
          cost_per_eu_transferred_in?: number | null
          cost_total?: number | null
          cost_transferred_in?: number | null
          created_at?: string | null
          created_by?: string | null
          equivalent_units_conversion?: number | null
          equivalent_units_material?: number | null
          equivalent_units_transferred_in?: number | null
          eu_calculation_note?: string | null
          eu_calculation_version?: number | null
          id?: string
          is_closed?: boolean | null
          material_completion_pct?: number | null
          mo_id: string
          notes?: string | null
          org_id: string
          period_end: string
          period_start: string
          stage_id: string
          units_beginning_wip?: number | null
          units_completed?: number | null
          units_ending_wip?: number | null
          units_started?: number | null
          units_transferred_in?: number | null
          units_transferred_out?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          batch_number?: string | null
          closed_at?: string | null
          closed_by?: string | null
          conversion_completion_pct?: number | null
          cost_beginning_wip?: number | null
          cost_beginning_wip_conversion?: number | null
          cost_beginning_wip_material?: number | null
          cost_beginning_wip_transferred_in?: number | null
          cost_completed_transferred?: number | null
          cost_ending_wip?: number | null
          cost_labor?: number | null
          cost_material?: number | null
          cost_overhead?: number | null
          cost_per_eu_conversion?: number | null
          cost_per_eu_material?: number | null
          cost_per_eu_transferred_in?: number | null
          cost_total?: number | null
          cost_transferred_in?: number | null
          created_at?: string | null
          created_by?: string | null
          equivalent_units_conversion?: number | null
          equivalent_units_material?: number | null
          equivalent_units_transferred_in?: number | null
          eu_calculation_note?: string | null
          eu_calculation_version?: number | null
          id?: string
          is_closed?: boolean | null
          material_completion_pct?: number | null
          mo_id?: string
          notes?: string | null
          org_id?: string
          period_end?: string
          period_start?: string
          stage_id?: string
          units_beginning_wip?: number | null
          units_completed?: number | null
          units_ending_wip?: number | null
          units_started?: number | null
          units_transferred_in?: number | null
          units_transferred_out?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stage_wip_log_mo_id_fkey"
            columns: ["mo_id"]
            isOneToOne: false
            referencedRelation: "manufacturing_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stage_wip_log_mo_id_fkey"
            columns: ["mo_id"]
            isOneToOne: false
            referencedRelation: "v_manufacturing_orders_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stage_wip_log_mo_id_fkey"
            columns: ["mo_id"]
            isOneToOne: false
            referencedRelation: "wip_by_stage"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stage_wip_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stage_wip_log_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "manufacturing_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      standard_costs: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          created_by: string | null
          effective_from: string
          effective_to: string | null
          id: string
          is_active: boolean | null
          labor_cost_per_unit: number | null
          material_cost_per_unit: number | null
          notes: string | null
          org_id: string
          overhead_cost_per_unit: number | null
          product_id: string
          stage_id: string
          standard_labor_hours: number | null
          standard_material_qty: number | null
          total_cost_per_unit: number | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          created_by?: string | null
          effective_from: string
          effective_to?: string | null
          id?: string
          is_active?: boolean | null
          labor_cost_per_unit?: number | null
          material_cost_per_unit?: number | null
          notes?: string | null
          org_id: string
          overhead_cost_per_unit?: number | null
          product_id: string
          stage_id: string
          standard_labor_hours?: number | null
          standard_material_qty?: number | null
          total_cost_per_unit?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          is_active?: boolean | null
          labor_cost_per_unit?: number | null
          material_cost_per_unit?: number | null
          notes?: string | null
          org_id?: string
          overhead_cost_per_unit?: number | null
          product_id?: string
          stage_id?: string
          standard_labor_hours?: number | null
          standard_material_qty?: number | null
          total_cost_per_unit?: number | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "standard_costs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "standard_costs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "standard_costs_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "manufacturing_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_adjustment_items: {
        Row: {
          adjustment_id: string
          batch_numbers: string[] | null
          conversion_factor_snapshot: number | null
          created_at: string
          current_qty: number
          current_qty_entered: number | null
          current_rate: number
          difference_qty: number
          id: string
          new_qty: number
          new_qty_entered: number | null
          new_rate: number | null
          organization_id: string
          product_id: string
          qty_entered: number | null
          reason: string | null
          serial_numbers: string[] | null
          uom_id: string | null
          value_difference: number
          warehouse_id: string | null
        }
        Insert: {
          adjustment_id: string
          batch_numbers?: string[] | null
          conversion_factor_snapshot?: number | null
          created_at?: string
          current_qty?: number
          current_qty_entered?: number | null
          current_rate?: number
          difference_qty: number
          id?: string
          new_qty: number
          new_qty_entered?: number | null
          new_rate?: number | null
          organization_id: string
          product_id: string
          qty_entered?: number | null
          reason?: string | null
          serial_numbers?: string[] | null
          uom_id?: string | null
          value_difference: number
          warehouse_id?: string | null
        }
        Update: {
          adjustment_id?: string
          batch_numbers?: string[] | null
          conversion_factor_snapshot?: number | null
          created_at?: string
          current_qty?: number
          current_qty_entered?: number | null
          current_rate?: number
          difference_qty?: number
          id?: string
          new_qty?: number
          new_qty_entered?: number | null
          new_rate?: number | null
          organization_id?: string
          product_id?: string
          qty_entered?: number | null
          reason?: string | null
          serial_numbers?: string[] | null
          uom_id?: string | null
          value_difference?: number
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_adjustment_items_adjustment_id_fkey"
            columns: ["adjustment_id"]
            isOneToOne: false
            referencedRelation: "stock_adjustments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustment_items_org_check"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustment_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustment_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustment_items_uom_id_fkey"
            columns: ["uom_id"]
            isOneToOne: false
            referencedRelation: "uoms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustment_items_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_adjustments: {
        Row: {
          adjustment_date: string
          adjustment_number: string
          adjustment_type: string
          approval_notes: string | null
          approved_at: string | null
          approved_by: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          canonical_gl_entry_id: string | null
          canonical_reversal_gl_entry_id: string | null
          created_at: string
          created_by: string
          decrease_account_id: string | null
          id: string
          increase_account_id: string | null
          inventory_account_id: string | null
          journal_entry_id: string | null
          org_id: string | null
          organization_id: string
          physical_count_session_id: string | null
          posting_date: string
          reason: string
          reference_number: string | null
          requires_approval: boolean | null
          reversal_journal_entry_id: string | null
          status: string
          submitted_at: string | null
          submitted_by: string | null
          total_items: number
          total_qty_difference: number | null
          total_value_difference: number | null
          updated_at: string | null
          updated_by: string | null
          warehouse_id: string | null
        }
        Insert: {
          adjustment_date: string
          adjustment_number: string
          adjustment_type: string
          approval_notes?: string | null
          approved_at?: string | null
          approved_by?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          canonical_gl_entry_id?: string | null
          canonical_reversal_gl_entry_id?: string | null
          created_at?: string
          created_by: string
          decrease_account_id?: string | null
          id?: string
          increase_account_id?: string | null
          inventory_account_id?: string | null
          journal_entry_id?: string | null
          org_id?: string | null
          organization_id: string
          physical_count_session_id?: string | null
          posting_date?: string
          reason: string
          reference_number?: string | null
          requires_approval?: boolean | null
          reversal_journal_entry_id?: string | null
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          total_items?: number
          total_qty_difference?: number | null
          total_value_difference?: number | null
          updated_at?: string | null
          updated_by?: string | null
          warehouse_id?: string | null
        }
        Update: {
          adjustment_date?: string
          adjustment_number?: string
          adjustment_type?: string
          approval_notes?: string | null
          approved_at?: string | null
          approved_by?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          canonical_gl_entry_id?: string | null
          canonical_reversal_gl_entry_id?: string | null
          created_at?: string
          created_by?: string
          decrease_account_id?: string | null
          id?: string
          increase_account_id?: string | null
          inventory_account_id?: string | null
          journal_entry_id?: string | null
          org_id?: string | null
          organization_id?: string
          physical_count_session_id?: string | null
          posting_date?: string
          reason?: string
          reference_number?: string | null
          requires_approval?: boolean | null
          reversal_journal_entry_id?: string | null
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          total_items?: number
          total_qty_difference?: number | null
          total_value_difference?: number | null
          updated_at?: string | null
          updated_by?: string | null
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_adjustments_canonical_gl_entry_id_fkey"
            columns: ["canonical_gl_entry_id"]
            isOneToOne: false
            referencedRelation: "gl_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_canonical_gl_entry_id_fkey"
            columns: ["canonical_gl_entry_id"]
            isOneToOne: false
            referencedRelation: "v_gl_entries_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_canonical_reversal_gl_entry_id_fkey"
            columns: ["canonical_reversal_gl_entry_id"]
            isOneToOne: false
            referencedRelation: "gl_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_canonical_reversal_gl_entry_id_fkey"
            columns: ["canonical_reversal_gl_entry_id"]
            isOneToOne: false
            referencedRelation: "v_gl_entries_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_decrease_account_id_fkey"
            columns: ["decrease_account_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_increase_account_id_fkey"
            columns: ["increase_account_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_inventory_account_id_fkey"
            columns: ["inventory_account_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_org_check"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_reversal_journal_entry_id_fkey"
            columns: ["reversal_journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_adjustments_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_ledger_entries: {
        Row: {
          actual_qty: number
          batch_no: string | null
          conversion_factor_snapshot: number | null
          created_at: string | null
          created_by: string | null
          docstatus: number | null
          id: string
          incoming_rate: number | null
          is_cancelled: boolean | null
          modified_at: string | null
          modified_by: string | null
          org_id: string
          outgoing_rate: number | null
          posting_date: string
          posting_datetime: string | null
          posting_time: string
          product_id: string
          qty_after_transaction: number
          qty_entered: number | null
          serial_nos: string[] | null
          source_line_id: string | null
          stock_queue: Json | null
          stock_value: number
          stock_value_difference: number
          uom_id: string | null
          valuation_rate: number
          voucher_id: string
          voucher_number: string | null
          voucher_type: string
          warehouse_id: string
        }
        Insert: {
          actual_qty: number
          batch_no?: string | null
          conversion_factor_snapshot?: number | null
          created_at?: string | null
          created_by?: string | null
          docstatus?: number | null
          id?: string
          incoming_rate?: number | null
          is_cancelled?: boolean | null
          modified_at?: string | null
          modified_by?: string | null
          org_id: string
          outgoing_rate?: number | null
          posting_date: string
          posting_datetime?: string | null
          posting_time?: string
          product_id: string
          qty_after_transaction: number
          qty_entered?: number | null
          serial_nos?: string[] | null
          source_line_id?: string | null
          stock_queue?: Json | null
          stock_value: number
          stock_value_difference: number
          uom_id?: string | null
          valuation_rate: number
          voucher_id: string
          voucher_number?: string | null
          voucher_type: string
          warehouse_id: string
        }
        Update: {
          actual_qty?: number
          batch_no?: string | null
          conversion_factor_snapshot?: number | null
          created_at?: string | null
          created_by?: string | null
          docstatus?: number | null
          id?: string
          incoming_rate?: number | null
          is_cancelled?: boolean | null
          modified_at?: string | null
          modified_by?: string | null
          org_id?: string
          outgoing_rate?: number | null
          posting_date?: string
          posting_datetime?: string | null
          posting_time?: string
          product_id?: string
          qty_after_transaction?: number
          qty_entered?: number | null
          serial_nos?: string[] | null
          source_line_id?: string | null
          stock_queue?: Json | null
          stock_value?: number
          stock_value_difference?: number
          uom_id?: string | null
          valuation_rate?: number
          voucher_id?: string
          voucher_number?: string | null
          voucher_type?: string
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_ledger_entries_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_ledger_entries_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_ledger_entries_uom_id_fkey"
            columns: ["uom_id"]
            isOneToOne: false
            referencedRelation: "uoms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_ledger_entries_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_reposting_queue: {
        Row: {
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          entries_processed: number | null
          error_message: string | null
          from_date: string
          id: string
          org_id: string
          product_id: string | null
          started_at: string | null
          status: string | null
          warehouse_id: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          entries_processed?: number | null
          error_message?: string | null
          from_date: string
          id?: string
          org_id: string
          product_id?: string | null
          started_at?: string | null
          status?: string | null
          warehouse_id?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          entries_processed?: number | null
          error_message?: string | null
          from_date?: string
          id?: string
          org_id?: string
          product_id?: string | null
          started_at?: string | null
          status?: string | null
          warehouse_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_reposting_queue_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_reposting_queue_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_reposting_queue_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_transfer_items: {
        Row: {
          available_qty_at_transfer: number | null
          created_at: string | null
          id: string
          organization_id: string
          product_id: string
          quantity: number
          transfer_id: string
          updated_at: string | null
        }
        Insert: {
          available_qty_at_transfer?: number | null
          created_at?: string | null
          id?: string
          organization_id: string
          product_id: string
          quantity: number
          transfer_id: string
          updated_at?: string | null
        }
        Update: {
          available_qty_at_transfer?: number | null
          created_at?: string | null
          id?: string
          organization_id?: string
          product_id?: string
          quantity?: number
          transfer_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_transfer_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfer_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfer_items_transfer_id_fkey"
            columns: ["transfer_id"]
            isOneToOne: false
            referencedRelation: "stock_transfers"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_transfers: {
        Row: {
          created_at: string | null
          created_by: string | null
          from_warehouse_id: string
          id: string
          notes: string | null
          organization_id: string
          reference_number: string
          status: string
          submitted_at: string | null
          submitted_by: string | null
          to_warehouse_id: string
          total_items: number | null
          transfer_date: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          from_warehouse_id: string
          id?: string
          notes?: string | null
          organization_id: string
          reference_number: string
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          to_warehouse_id: string
          total_items?: number | null
          transfer_date?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          from_warehouse_id?: string
          id?: string
          notes?: string | null
          organization_id?: string
          reference_number?: string
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          to_warehouse_id?: string
          total_items?: number | null
          transfer_date?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_transfers_from_warehouse_id_fkey"
            columns: ["from_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_to_warehouse_id_fkey"
            columns: ["to_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      storage_bins: {
        Row: {
          aisle: string | null
          barcode: string | null
          bin_code: string
          bin_type: string | null
          created_at: string | null
          dedicated_product_id: string | null
          id: string
          is_active: boolean | null
          is_locked: boolean | null
          is_occupied: boolean | null
          level: string | null
          location_id: string
          lock_reason: string | null
          max_volume: number | null
          max_weight: number | null
          position: string | null
          qr_code: string | null
          rack: string | null
          updated_at: string | null
          volume_unit: string | null
          warehouse_id: string
          weight_unit: string | null
        }
        Insert: {
          aisle?: string | null
          barcode?: string | null
          bin_code: string
          bin_type?: string | null
          created_at?: string | null
          dedicated_product_id?: string | null
          id?: string
          is_active?: boolean | null
          is_locked?: boolean | null
          is_occupied?: boolean | null
          level?: string | null
          location_id: string
          lock_reason?: string | null
          max_volume?: number | null
          max_weight?: number | null
          position?: string | null
          qr_code?: string | null
          rack?: string | null
          updated_at?: string | null
          volume_unit?: string | null
          warehouse_id: string
          weight_unit?: string | null
        }
        Update: {
          aisle?: string | null
          barcode?: string | null
          bin_code?: string
          bin_type?: string | null
          created_at?: string | null
          dedicated_product_id?: string | null
          id?: string
          is_active?: boolean | null
          is_locked?: boolean | null
          is_occupied?: boolean | null
          level?: string | null
          location_id?: string
          lock_reason?: string | null
          max_volume?: number | null
          max_weight?: number | null
          position?: string | null
          qr_code?: string | null
          rack?: string | null
          updated_at?: string | null
          volume_unit?: string | null
          warehouse_id?: string
          weight_unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "storage_bins_dedicated_product_id_fkey"
            columns: ["dedicated_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "storage_bins_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "storage_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "storage_bins_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      storage_locations: {
        Row: {
          capacity: number | null
          capacity_unit: string | null
          code: string
          created_at: string | null
          created_by: string | null
          current_utilization: number | null
          dimension_unit: string | null
          height: number | null
          id: string
          is_active: boolean | null
          is_pickable: boolean | null
          is_receivable: boolean | null
          length: number | null
          location_type: string | null
          name: string
          name_ar: string | null
          org_id: string | null
          parent_location_id: string | null
          temperature_controlled: boolean | null
          temperature_max: number | null
          temperature_min: number | null
          updated_at: string | null
          updated_by: string | null
          warehouse_id: string
          width: number | null
        }
        Insert: {
          capacity?: number | null
          capacity_unit?: string | null
          code: string
          created_at?: string | null
          created_by?: string | null
          current_utilization?: number | null
          dimension_unit?: string | null
          height?: number | null
          id?: string
          is_active?: boolean | null
          is_pickable?: boolean | null
          is_receivable?: boolean | null
          length?: number | null
          location_type?: string | null
          name: string
          name_ar?: string | null
          org_id?: string | null
          parent_location_id?: string | null
          temperature_controlled?: boolean | null
          temperature_max?: number | null
          temperature_min?: number | null
          updated_at?: string | null
          updated_by?: string | null
          warehouse_id: string
          width?: number | null
        }
        Update: {
          capacity?: number | null
          capacity_unit?: string | null
          code?: string
          created_at?: string | null
          created_by?: string | null
          current_utilization?: number | null
          dimension_unit?: string | null
          height?: number | null
          id?: string
          is_active?: boolean | null
          is_pickable?: boolean | null
          is_receivable?: boolean | null
          length?: number | null
          location_type?: string | null
          name?: string
          name_ar?: string | null
          org_id?: string | null
          parent_location_id?: string | null
          temperature_controlled?: boolean | null
          temperature_max?: number | null
          temperature_min?: number | null
          updated_at?: string | null
          updated_by?: string | null
          warehouse_id?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "storage_locations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "storage_locations_parent_location_id_fkey"
            columns: ["parent_location_id"]
            isOneToOne: false
            referencedRelation: "storage_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "storage_locations_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      super_admins: {
        Row: {
          created_at: string | null
          email: string
          id: string
          is_active: boolean | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          email: string
          id?: string
          is_active?: boolean | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
          is_active?: boolean | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      supplier_invoice_lines: {
        Row: {
          created_at: string | null
          description: string | null
          discount_percentage: number | null
          goods_receipt_line_id: string | null
          id: string
          line_number: number
          line_total: number | null
          notes: string | null
          org_id: string
          product_id: string
          quantity: number
          supplier_invoice_id: string
          tax_percentage: number | null
          unit_cost: number
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          discount_percentage?: number | null
          goods_receipt_line_id?: string | null
          id?: string
          line_number?: number
          line_total?: number | null
          notes?: string | null
          org_id: string
          product_id: string
          quantity: number
          supplier_invoice_id: string
          tax_percentage?: number | null
          unit_cost: number
        }
        Update: {
          created_at?: string | null
          description?: string | null
          discount_percentage?: number | null
          goods_receipt_line_id?: string | null
          id?: string
          line_number?: number
          line_total?: number | null
          notes?: string | null
          org_id?: string
          product_id?: string
          quantity?: number
          supplier_invoice_id?: string
          tax_percentage?: number | null
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "supplier_invoice_lines_goods_receipt_line_id_fkey"
            columns: ["goods_receipt_line_id"]
            isOneToOne: false
            referencedRelation: "goods_receipt_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_invoice_lines_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_invoice_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_invoice_lines_supplier_invoice_id_fkey"
            columns: ["supplier_invoice_id"]
            isOneToOne: false
            referencedRelation: "supplier_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_invoices: {
        Row: {
          balance: number | null
          created_at: string | null
          created_by: string | null
          discount_amount: number | null
          due_date: string | null
          goods_receipt_id: string | null
          id: string
          invoice_date: string
          invoice_number: string
          notes: string | null
          org_id: string
          paid_amount: number | null
          payment_terms: string | null
          purchase_order_id: string | null
          status: string | null
          subtotal: number
          tax_amount: number | null
          total_amount: number
          updated_at: string | null
          vendor_id: string
        }
        Insert: {
          balance?: number | null
          created_at?: string | null
          created_by?: string | null
          discount_amount?: number | null
          due_date?: string | null
          goods_receipt_id?: string | null
          id?: string
          invoice_date?: string
          invoice_number: string
          notes?: string | null
          org_id: string
          paid_amount?: number | null
          payment_terms?: string | null
          purchase_order_id?: string | null
          status?: string | null
          subtotal: number
          tax_amount?: number | null
          total_amount: number
          updated_at?: string | null
          vendor_id: string
        }
        Update: {
          balance?: number | null
          created_at?: string | null
          created_by?: string | null
          discount_amount?: number | null
          due_date?: string | null
          goods_receipt_id?: string | null
          id?: string
          invoice_date?: string
          invoice_number?: string
          notes?: string | null
          org_id?: string
          paid_amount?: number | null
          payment_terms?: string | null
          purchase_order_id?: string | null
          status?: string | null
          subtotal?: number
          tax_amount?: number | null
          total_amount?: number
          updated_at?: string | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_invoices_goods_receipt_id_fkey"
            columns: ["goods_receipt_id"]
            isOneToOne: false
            referencedRelation: "goods_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_invoices_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_invoices_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_invoices_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_payment_lines: {
        Row: {
          allocated_amount: number
          created_at: string | null
          discount_amount: number | null
          id: string
          invoice_id: string | null
          notes: string | null
          payment_id: string
        }
        Insert: {
          allocated_amount: number
          created_at?: string | null
          discount_amount?: number | null
          id?: string
          invoice_id?: string | null
          notes?: string | null
          payment_id: string
        }
        Update: {
          allocated_amount?: number
          created_at?: string | null
          discount_amount?: number | null
          id?: string
          invoice_id?: string | null
          notes?: string | null
          payment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_payment_lines_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "supplier_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_payment_lines_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "supplier_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_payments: {
        Row: {
          amount: number
          bank_account_id: string | null
          check_bank: string | null
          check_date: string | null
          check_number: string | null
          created_at: string | null
          created_by: string | null
          gl_entry_id: string | null
          id: string
          invoice_id: string | null
          notes: string | null
          org_id: string
          payment_account_id: string | null
          payment_date: string
          payment_method: string | null
          payment_number: string
          posted_at: string | null
          posted_by: string | null
          reference_number: string | null
          status: string | null
          updated_at: string | null
          vendor_id: string
        }
        Insert: {
          amount: number
          bank_account_id?: string | null
          check_bank?: string | null
          check_date?: string | null
          check_number?: string | null
          created_at?: string | null
          created_by?: string | null
          gl_entry_id?: string | null
          id?: string
          invoice_id?: string | null
          notes?: string | null
          org_id: string
          payment_account_id?: string | null
          payment_date?: string
          payment_method?: string | null
          payment_number: string
          posted_at?: string | null
          posted_by?: string | null
          reference_number?: string | null
          status?: string | null
          updated_at?: string | null
          vendor_id: string
        }
        Update: {
          amount?: number
          bank_account_id?: string | null
          check_bank?: string | null
          check_date?: string | null
          check_number?: string | null
          created_at?: string | null
          created_by?: string | null
          gl_entry_id?: string | null
          id?: string
          invoice_id?: string | null
          notes?: string | null
          org_id?: string
          payment_account_id?: string | null
          payment_date?: string
          payment_method?: string | null
          payment_number?: string
          posted_at?: string | null
          posted_by?: string | null
          reference_number?: string | null
          status?: string | null
          updated_at?: string | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_supplier_payments_invoice_id"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "supplier_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_supplier_payments_payment_account"
            columns: ["payment_account_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_payments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_payments_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      test_init: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      uom_aliases: {
        Row: {
          alias_display: string
          alias_normalized: string
          created_at: string
          id: string
          org_id: string | null
          source: string
          uom_id: string
        }
        Insert: {
          alias_display: string
          alias_normalized: string
          created_at?: string
          id?: string
          org_id?: string | null
          source?: string
          uom_id: string
        }
        Update: {
          alias_display?: string
          alias_normalized?: string
          created_at?: string
          id?: string
          org_id?: string | null
          source?: string
          uom_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "uom_aliases_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "uom_aliases_uom_id_fkey"
            columns: ["uom_id"]
            isOneToOne: false
            referencedRelation: "uoms"
            referencedColumns: ["id"]
          },
        ]
      }
      uom_backfill_issues: {
        Row: {
          created_at: string
          details: Json
          id: string
          issue_code: string
          org_id: string | null
          resolved_at: string | null
          resolved_by: string | null
          resolved_uom_id: string | null
          source_id: string | null
          source_table: string
          source_value: string | null
          status: string
        }
        Insert: {
          created_at?: string
          details?: Json
          id?: string
          issue_code: string
          org_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_uom_id?: string | null
          source_id?: string | null
          source_table: string
          source_value?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          details?: Json
          id?: string
          issue_code?: string
          org_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_uom_id?: string | null
          source_id?: string | null
          source_table?: string
          source_value?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "uom_backfill_issues_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "uom_backfill_issues_resolved_uom_id_fkey"
            columns: ["resolved_uom_id"]
            isOneToOne: false
            referencedRelation: "uoms"
            referencedColumns: ["id"]
          },
        ]
      }
      uom_categories: {
        Row: {
          code: string
          created_at: string
          dimension: string
          id: string
          is_system: boolean
          name: string
          name_ar: string | null
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          dimension: string
          id?: string
          is_system?: boolean
          name: string
          name_ar?: string | null
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          dimension?: string
          id?: string
          is_system?: boolean
          name?: string
          name_ar?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      uoms: {
        Row: {
          category_id: string
          code: string
          created_at: string
          decimal_places: number
          factor_to_category_base: number | null
          id: string
          is_active: boolean
          is_category_base: boolean
          is_product_specific: boolean
          name: string
          name_ar: string | null
          org_id: string | null
          rounding_mode: string
          symbol: string
          updated_at: string
        }
        Insert: {
          category_id: string
          code: string
          created_at?: string
          decimal_places?: number
          factor_to_category_base?: number | null
          id?: string
          is_active?: boolean
          is_category_base?: boolean
          is_product_specific?: boolean
          name: string
          name_ar?: string | null
          org_id?: string | null
          rounding_mode?: string
          symbol: string
          updated_at?: string
        }
        Update: {
          category_id?: string
          code?: string
          created_at?: string
          decimal_places?: number
          factor_to_category_base?: number | null
          id?: string
          is_active?: boolean
          is_category_base?: boolean
          is_product_specific?: boolean
          name?: string
          name_ar?: string | null
          org_id?: string | null
          rounding_mode?: string
          symbol?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "uoms_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "uom_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "uoms_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_organizations: {
        Row: {
          created_at: string | null
          id: string
          invited_by: string | null
          is_active: boolean | null
          is_org_admin: boolean | null
          joined_at: string | null
          org_id: string
          role: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          invited_by?: string | null
          is_active?: boolean | null
          is_org_admin?: boolean | null
          joined_at?: string | null
          org_id: string
          role?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          invited_by?: string | null
          is_active?: boolean | null
          is_org_admin?: boolean | null
          joined_at?: string | null
          org_id?: string
          role?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_organizations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          email: string | null
          full_name: string | null
          full_name_ar: string | null
          id: string
          last_login_at: string | null
          last_login_ip: unknown
          phone: string | null
          preferred_language: string | null
          two_factor_enabled: boolean | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          full_name_ar?: string | null
          id?: string
          last_login_at?: string | null
          last_login_ip?: unknown
          phone?: string | null
          preferred_language?: string | null
          two_factor_enabled?: boolean | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          full_name_ar?: string | null
          id?: string
          last_login_at?: string | null
          last_login_ip?: unknown
          phone?: string | null
          preferred_language?: string | null
          two_factor_enabled?: boolean | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          assigned_at: string | null
          assigned_by: string | null
          expires_at: string | null
          id: string
          org_id: string
          role_id: string
          user_id: string
        }
        Insert: {
          assigned_at?: string | null
          assigned_by?: string | null
          expires_at?: string | null
          id?: string
          org_id: string
          role_id: string
          user_id: string
        }
        Update: {
          assigned_at?: string | null
          assigned_by?: string | null
          expires_at?: string | null
          id?: string
          org_id?: string
          role_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      vendors: {
        Row: {
          address: string | null
          code: string
          contact_person: string | null
          created_at: string | null
          email: string | null
          id: string
          is_active: boolean | null
          name: string
          org_id: string
          phone: string | null
          tax_number: string | null
          updated_at: string | null
        }
        Insert: {
          address?: string | null
          code: string
          contact_person?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          org_id: string
          phone?: string | null
          tax_number?: string | null
          updated_at?: string | null
        }
        Update: {
          address?: string | null
          code?: string
          contact_person?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          org_id?: string
          phone?: string | null
          tax_number?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vendors_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      warehouse_gl_mapping: {
        Row: {
          cost_center: string | null
          created_at: string | null
          default_cogs_account: string | null
          default_sales_account: string | null
          expenses_included_in_valuation: string | null
          id: string
          org_id: string
          stock_account: string | null
          stock_adjustment_account: string | null
          stock_received_but_not_billed: string | null
          updated_at: string | null
          warehouse_id: string
        }
        Insert: {
          cost_center?: string | null
          created_at?: string | null
          default_cogs_account?: string | null
          default_sales_account?: string | null
          expenses_included_in_valuation?: string | null
          id?: string
          org_id: string
          stock_account?: string | null
          stock_adjustment_account?: string | null
          stock_received_but_not_billed?: string | null
          updated_at?: string | null
          warehouse_id: string
        }
        Update: {
          cost_center?: string | null
          created_at?: string | null
          default_cogs_account?: string | null
          default_sales_account?: string | null
          expenses_included_in_valuation?: string | null
          id?: string
          org_id?: string
          stock_account?: string | null
          stock_adjustment_account?: string | null
          stock_received_but_not_billed?: string | null
          updated_at?: string | null
          warehouse_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "warehouse_gl_mapping_default_cogs_account_fkey"
            columns: ["default_cogs_account"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_gl_mapping_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_gl_mapping_stock_account_fkey"
            columns: ["stock_account"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_gl_mapping_stock_adjustment_account_fkey"
            columns: ["stock_adjustment_account"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_gl_mapping_stock_received_but_not_billed_fkey"
            columns: ["stock_received_but_not_billed"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_gl_mapping_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: true
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      warehouses: {
        Row: {
          address: string | null
          capacity_unit: string | null
          city: string | null
          code: string
          contact_email: string | null
          contact_phone: string | null
          cost_center_id: string | null
          country: string | null
          created_at: string | null
          expense_account_id: string | null
          id: string
          inventory_account_id: string | null
          is_active: boolean | null
          is_group: boolean | null
          manager_name: string | null
          name: string
          name_ar: string | null
          org_id: string | null
          parent_warehouse_id: string | null
          total_capacity: number | null
          updated_at: string | null
          warehouse_type: string | null
        }
        Insert: {
          address?: string | null
          capacity_unit?: string | null
          city?: string | null
          code: string
          contact_email?: string | null
          contact_phone?: string | null
          cost_center_id?: string | null
          country?: string | null
          created_at?: string | null
          expense_account_id?: string | null
          id?: string
          inventory_account_id?: string | null
          is_active?: boolean | null
          is_group?: boolean | null
          manager_name?: string | null
          name: string
          name_ar?: string | null
          org_id?: string | null
          parent_warehouse_id?: string | null
          total_capacity?: number | null
          updated_at?: string | null
          warehouse_type?: string | null
        }
        Update: {
          address?: string | null
          capacity_unit?: string | null
          city?: string | null
          code?: string
          contact_email?: string | null
          contact_phone?: string | null
          cost_center_id?: string | null
          country?: string | null
          created_at?: string | null
          expense_account_id?: string | null
          id?: string
          inventory_account_id?: string | null
          is_active?: boolean | null
          is_group?: boolean | null
          manager_name?: string | null
          name?: string
          name_ar?: string | null
          org_id?: string | null
          parent_warehouse_id?: string | null
          total_capacity?: number | null
          updated_at?: string | null
          warehouse_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "warehouses_expense_account_id_fkey"
            columns: ["expense_account_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouses_inventory_account_id_fkey"
            columns: ["inventory_account_id"]
            isOneToOne: false
            referencedRelation: "gl_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouses_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouses_parent_warehouse_id_fkey"
            columns: ["parent_warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      work_center_calendars: {
        Row: {
          available_hours: number | null
          calendar_date: string
          created_at: string | null
          holiday_name: string | null
          id: string
          is_holiday: boolean | null
          is_working_day: boolean | null
          notes: string | null
          org_id: string
          planned_maintenance_hours: number | null
          shift_count: number | null
          updated_at: string | null
          work_center_id: string
        }
        Insert: {
          available_hours?: number | null
          calendar_date: string
          created_at?: string | null
          holiday_name?: string | null
          id?: string
          is_holiday?: boolean | null
          is_working_day?: boolean | null
          notes?: string | null
          org_id: string
          planned_maintenance_hours?: number | null
          shift_count?: number | null
          updated_at?: string | null
          work_center_id: string
        }
        Update: {
          available_hours?: number | null
          calendar_date?: string
          created_at?: string | null
          holiday_name?: string | null
          id?: string
          is_holiday?: boolean | null
          is_working_day?: boolean | null
          notes?: string | null
          org_id?: string
          planned_maintenance_hours?: number | null
          shift_count?: number | null
          updated_at?: string | null
          work_center_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_center_calendars_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "v_capacity_summary"
            referencedColumns: ["work_center_id"]
          },
          {
            foreignKeyName: "work_center_calendars_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "v_work_center_productivity"
            referencedColumns: ["work_center_id"]
          },
          {
            foreignKeyName: "work_center_calendars_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "v_work_centers_utilization"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_center_calendars_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "work_centers"
            referencedColumns: ["id"]
          },
        ]
      }
      work_center_load: {
        Row: {
          actual_load_hours: number | null
          available_capacity_hours: number | null
          calculated_at: string | null
          completed_work_orders: number | null
          created_at: string | null
          efficiency_pct: number | null
          id: string
          org_id: string
          period_end: string
          period_start: string
          planned_load_hours: number | null
          planned_work_orders: number | null
          status: string | null
          updated_at: string | null
          utilization_pct: number | null
          work_center_id: string
        }
        Insert: {
          actual_load_hours?: number | null
          available_capacity_hours?: number | null
          calculated_at?: string | null
          completed_work_orders?: number | null
          created_at?: string | null
          efficiency_pct?: number | null
          id?: string
          org_id: string
          period_end: string
          period_start: string
          planned_load_hours?: number | null
          planned_work_orders?: number | null
          status?: string | null
          updated_at?: string | null
          utilization_pct?: number | null
          work_center_id: string
        }
        Update: {
          actual_load_hours?: number | null
          available_capacity_hours?: number | null
          calculated_at?: string | null
          completed_work_orders?: number | null
          created_at?: string | null
          efficiency_pct?: number | null
          id?: string
          org_id?: string
          period_end?: string
          period_start?: string
          planned_load_hours?: number | null
          planned_work_orders?: number | null
          status?: string | null
          updated_at?: string | null
          utilization_pct?: number | null
          work_center_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_center_load_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "v_capacity_summary"
            referencedColumns: ["work_center_id"]
          },
          {
            foreignKeyName: "work_center_load_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "v_work_center_productivity"
            referencedColumns: ["work_center_id"]
          },
          {
            foreignKeyName: "work_center_load_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "v_work_centers_utilization"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_center_load_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "work_centers"
            referencedColumns: ["id"]
          },
        ]
      }
      work_centers: {
        Row: {
          calendar_id: string | null
          capacity_hours_per_day: number | null
          capacity_per_hour: number | null
          code: string
          created_at: string | null
          default_labor_rate: number | null
          default_overhead_rate: number | null
          description: string | null
          efficiency_percent: number | null
          efficiency_rate: number | null
          hourly_rate: number | null
          id: string
          is_active: boolean | null
          name: string
          name_ar: string | null
          normal_scrap_rate: number | null
          number_of_machines: number | null
          org_id: string
          updated_at: string | null
        }
        Insert: {
          calendar_id?: string | null
          capacity_hours_per_day?: number | null
          capacity_per_hour?: number | null
          code: string
          created_at?: string | null
          default_labor_rate?: number | null
          default_overhead_rate?: number | null
          description?: string | null
          efficiency_percent?: number | null
          efficiency_rate?: number | null
          hourly_rate?: number | null
          id?: string
          is_active?: boolean | null
          name: string
          name_ar?: string | null
          normal_scrap_rate?: number | null
          number_of_machines?: number | null
          org_id: string
          updated_at?: string | null
        }
        Update: {
          calendar_id?: string | null
          capacity_hours_per_day?: number | null
          capacity_per_hour?: number | null
          code?: string
          created_at?: string | null
          default_labor_rate?: number | null
          default_overhead_rate?: number | null
          description?: string | null
          efficiency_percent?: number | null
          efficiency_rate?: number | null
          hourly_rate?: number | null
          id?: string
          is_active?: boolean | null
          name?: string
          name_ar?: string | null
          normal_scrap_rate?: number | null
          number_of_machines?: number | null
          org_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      work_orders: {
        Row: {
          actual_end_date: string | null
          actual_run_time: number | null
          actual_setup_time: number | null
          actual_start_date: string | null
          actual_wait_time: number | null
          completed_quantity: number | null
          created_at: string | null
          created_by: string | null
          current_operator_id: string | null
          id: string
          mo_id: string
          notes: string | null
          operation_id: string | null
          operation_name: string
          operation_name_ar: string | null
          operation_sequence: number
          org_id: string
          planned_end_date: string | null
          planned_quantity: number
          planned_run_time: number | null
          planned_setup_time: number | null
          planned_start_date: string | null
          priority: number | null
          scrapped_quantity: number | null
          status: string | null
          updated_at: string | null
          work_center_id: string
          work_order_number: string
        }
        Insert: {
          actual_end_date?: string | null
          actual_run_time?: number | null
          actual_setup_time?: number | null
          actual_start_date?: string | null
          actual_wait_time?: number | null
          completed_quantity?: number | null
          created_at?: string | null
          created_by?: string | null
          current_operator_id?: string | null
          id?: string
          mo_id: string
          notes?: string | null
          operation_id?: string | null
          operation_name: string
          operation_name_ar?: string | null
          operation_sequence: number
          org_id: string
          planned_end_date?: string | null
          planned_quantity: number
          planned_run_time?: number | null
          planned_setup_time?: number | null
          planned_start_date?: string | null
          priority?: number | null
          scrapped_quantity?: number | null
          status?: string | null
          updated_at?: string | null
          work_center_id: string
          work_order_number: string
        }
        Update: {
          actual_end_date?: string | null
          actual_run_time?: number | null
          actual_setup_time?: number | null
          actual_start_date?: string | null
          actual_wait_time?: number | null
          completed_quantity?: number | null
          created_at?: string | null
          created_by?: string | null
          current_operator_id?: string | null
          id?: string
          mo_id?: string
          notes?: string | null
          operation_id?: string | null
          operation_name?: string
          operation_name_ar?: string | null
          operation_sequence?: number
          org_id?: string
          planned_end_date?: string | null
          planned_quantity?: number
          planned_run_time?: number | null
          planned_setup_time?: number | null
          planned_start_date?: string | null
          priority?: number | null
          scrapped_quantity?: number | null
          status?: string | null
          updated_at?: string | null
          work_center_id?: string
          work_order_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_orders_mo_id_fkey"
            columns: ["mo_id"]
            isOneToOne: false
            referencedRelation: "manufacturing_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_mo_id_fkey"
            columns: ["mo_id"]
            isOneToOne: false
            referencedRelation: "v_manufacturing_orders_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_mo_id_fkey"
            columns: ["mo_id"]
            isOneToOne: false
            referencedRelation: "wip_by_stage"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "routing_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "v_capacity_summary"
            referencedColumns: ["work_center_id"]
          },
          {
            foreignKeyName: "work_orders_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "v_work_center_productivity"
            referencedColumns: ["work_center_id"]
          },
          {
            foreignKeyName: "work_orders_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "v_work_centers_utilization"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "work_centers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_all_public_functions: {
        Row: {
          arguments: string | null
          function_name: unknown
          schema_name: unknown
          volatility: string | null
        }
        Relationships: []
      }
      v_capacity_summary: {
        Row: {
          actual_load_hours: number | null
          available_capacity_hours: number | null
          capacity_hours_per_day: number | null
          completed_work_orders: number | null
          load_status: string | null
          number_of_machines: number | null
          org_id: string | null
          period_end: string | null
          period_start: string | null
          planned_load_hours: number | null
          planned_work_orders: number | null
          utilization_pct: number | null
          work_center_id: string | null
          work_center_name: string | null
        }
        Relationships: []
      }
      v_cost_variance_report: {
        Row: {
          actual_end_date: string | null
          actual_labor_cost: number | null
          actual_overhead_cost: number | null
          labor_variance: number | null
          operation_name: string | null
          order_number: string | null
          org_id: string | null
          overhead_variance: number | null
          planned_labor_cost: number | null
          planned_overhead_cost: number | null
          status: string | null
          work_center_name: string | null
          work_order_number: string | null
        }
        Relationships: []
      }
      v_gl_entries_full: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          description_ar: string | null
          entry_date: string | null
          entry_number: string | null
          entry_type: string | null
          id: string | null
          journal_code: string | null
          journal_id: string | null
          journal_name: string | null
          journal_name_ar: string | null
          line_count: number | null
          org_id: string | null
          reference_id: string | null
          reference_number: string | null
          reference_type: string | null
          status: string | null
          total_credit: number | null
          total_debit: number | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_gl_entries_journal"
            columns: ["journal_id"]
            isOneToOne: false
            referencedRelation: "journals"
            referencedColumns: ["id"]
          },
        ]
      }
      v_labor_efficiency: {
        Row: {
          actual_end_date: string | null
          actual_run_time: number | null
          actual_setup_time: number | null
          actual_start_date: string | null
          completed_quantity: number | null
          operation_name: string | null
          order_number: string | null
          org_id: string | null
          overall_efficiency_pct: number | null
          planned_quantity: number | null
          planned_run_time: number | null
          planned_setup_time: number | null
          run_efficiency_pct: number | null
          scrap_rate_pct: number | null
          scrapped_quantity: number | null
          setup_efficiency_pct: number | null
          status: string | null
          work_center_id: string | null
          work_center_name: string | null
          work_order_number: string | null
        }
        Relationships: [
          {
            foreignKeyName: "work_orders_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "v_capacity_summary"
            referencedColumns: ["work_center_id"]
          },
          {
            foreignKeyName: "work_orders_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "v_work_center_productivity"
            referencedColumns: ["work_center_id"]
          },
          {
            foreignKeyName: "work_orders_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "v_work_centers_utilization"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "work_centers"
            referencedColumns: ["id"]
          },
        ]
      }
      v_manufacturing_orders_full: {
        Row: {
          completed_date: string | null
          completed_quantity: number | null
          created_at: string | null
          created_by: string | null
          due_date: string | null
          effective_product_id: string | null
          id: string | null
          item_id: string | null
          notes: string | null
          order_number: string | null
          org_id: string | null
          product_code: string | null
          product_id: string | null
          product_name: string | null
          quantity: number | null
          scrap_quantity: number | null
          start_date: string | null
          status: string | null
          total_cost: number | null
          unit_cost: number | null
          updated_at: string | null
        }
        Relationships: []
      }
      v_manufacturing_orders_summary: {
        Row: {
          avg_unit_cost: number | null
          earliest_start: string | null
          latest_due: string | null
          order_count: number | null
          org_id: string | null
          status: string | null
          total_completed: number | null
          total_cost: number | null
          total_quantity: number | null
          total_scrap: number | null
        }
        Relationships: []
      }
      v_material_consumption_report: {
        Row: {
          consumed_quantity: number | null
          consumption_date: string | null
          consumption_type: string | null
          item_code: string | null
          item_name: string | null
          order_number: string | null
          org_id: string | null
          planned_quantity: number | null
          status: string | null
          total_cost: number | null
          unit_cost: number | null
          variance_pct: number | null
          variance_qty: number | null
          work_order_number: string | null
        }
        Relationships: []
      }
      v_oee_report: {
        Row: {
          availability_pct: number | null
          available_time: number | null
          downtime: number | null
          good_quantity: number | null
          oee_pct: number | null
          operating_time: number | null
          org_id: string | null
          performance_pct: number | null
          production_date: string | null
          quality_pct: number | null
          total_produced: number | null
          work_center_id: string | null
          work_center_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "work_orders_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "v_capacity_summary"
            referencedColumns: ["work_center_id"]
          },
          {
            foreignKeyName: "work_orders_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "v_work_center_productivity"
            referencedColumns: ["work_center_id"]
          },
          {
            foreignKeyName: "work_orders_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "v_work_centers_utilization"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "work_centers"
            referencedColumns: ["id"]
          },
        ]
      }
      v_production_schedule_details: {
        Row: {
          completed_quantity: number | null
          duration_hours: number | null
          item_status: string | null
          mo_number: string | null
          operation_name: string | null
          period_end: string | null
          period_start: string | null
          planned_quantity: number | null
          schedule_id: string | null
          schedule_number: string | null
          schedule_sequence: number | null
          schedule_status: string | null
          scheduled_end: string | null
          scheduled_start: string | null
          work_center_name: string | null
          work_order_number: string | null
        }
        Relationships: []
      }
      v_trial_balance: {
        Row: {
          account_code: string | null
          account_name: string | null
          account_name_ar: string | null
          account_type: string | null
          balance: number | null
          first_transaction_date: string | null
          last_transaction_date: string | null
          org_id: string | null
          parent_code: string | null
          total_credit: number | null
          total_debit: number | null
          transaction_count: number | null
        }
        Relationships: []
      }
      v_work_center_efficiency_summary: {
        Row: {
          avg_overall_efficiency: number | null
          avg_run_efficiency: number | null
          avg_setup_efficiency: number | null
          completed_operations: number | null
          org_id: string | null
          production_date: string | null
          total_actual_run: number | null
          total_actual_setup: number | null
          total_planned_run: number | null
          total_planned_setup: number | null
          total_produced: number | null
          total_scrapped: number | null
          work_center_id: string | null
          work_center_name: string | null
          work_center_name_ar: string | null
        }
        Relationships: [
          {
            foreignKeyName: "work_orders_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "v_capacity_summary"
            referencedColumns: ["work_center_id"]
          },
          {
            foreignKeyName: "work_orders_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "v_work_center_productivity"
            referencedColumns: ["work_center_id"]
          },
          {
            foreignKeyName: "work_orders_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "v_work_centers_utilization"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_orders_work_center_id_fkey"
            columns: ["work_center_id"]
            isOneToOne: false
            referencedRelation: "work_centers"
            referencedColumns: ["id"]
          },
        ]
      }
      v_work_center_productivity: {
        Row: {
          active_work_orders: number | null
          avg_efficiency_pct: number | null
          capacity_hours_per_day: number | null
          org_id: string | null
          total_produced: number | null
          total_run_time_minutes: number | null
          total_scrapped: number | null
          total_work_orders: number | null
          work_center_id: string | null
          work_center_name: string | null
        }
        Relationships: []
      }
      v_work_centers_utilization: {
        Row: {
          active_orders: number | null
          avg_efficiency: number | null
          capacity_per_hour: number | null
          code: string | null
          created_at: string | null
          description: string | null
          efficiency_percent: number | null
          hourly_rate: number | null
          id: string | null
          is_active: boolean | null
          name: string | null
          name_ar: string | null
          org_id: string | null
          total_labor_cost: number | null
          total_overhead_cost: number | null
          updated_at: string | null
        }
        Relationships: []
      }
      v_work_order_status: {
        Row: {
          actual_run_time: number | null
          actual_setup_time: number | null
          completed_quantity: number | null
          current_operator_id: string | null
          id: string | null
          mo_number: string | null
          operation_name: string | null
          org_id: string | null
          planned_quantity: number | null
          planned_run_time: number | null
          planned_setup_time: number | null
          run_variance_pct: number | null
          scrapped_quantity: number | null
          setup_variance_pct: number | null
          status: string | null
          work_center_name: string | null
          work_order_number: string | null
        }
        Relationships: []
      }
      vw_stock_valuation_by_method: {
        Row: {
          avg_unit_cost: number | null
          max_unit_cost: number | null
          min_unit_cost: number | null
          org_id: string | null
          product_count: number | null
          total_quantity: number | null
          total_value: number | null
          valuation_method:
            | Database["public"]["Enums"]["valuation_method_enum"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "products_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      wip_by_stage: {
        Row: {
          current_unit_cost: number | null
          due_date: string | null
          id: string | null
          operations_completion_pct: number | null
          order_number: string | null
          org_id: string | null
          product_id: string | null
          product_name: string | null
          qty_planned: number | null
          qty_produced: number | null
          start_date: string | null
          status: string | null
          total_wip_cost: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      add_org_id_column: { Args: { table_name: string }; Returns: undefined }
      approve_journal_entry: {
        Args: {
          p_approval_level: number
          p_comments?: string
          p_entry_id: string
        }
        Returns: Json
      }
      assert_period_open: {
        Args: { p_date: string; p_org: string }
        Returns: undefined
      }
      assign_routing_to_mo: {
        Args: { p_mo_id: string; p_routing_id: string }
        Returns: {
          auto_backflush: boolean | null
          backflush_timing: string | null
          completed_date: string | null
          completed_quantity: number | null
          costing_method: string | null
          created_at: string | null
          created_by: string | null
          due_date: string | null
          id: string
          item_id: string | null
          notes: string | null
          order_number: string
          org_id: string
          product_id: string | null
          quantity: number
          routing_id: string | null
          scrap_quantity: number | null
          start_date: string | null
          status: string | null
          total_cost: number | null
          unit_cost: number | null
          updated_at: string | null
          work_orders_generated: boolean | null
        }
        SetofOptions: {
          from: "*"
          to: "manufacturing_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      auth_org_id: { Args: never; Returns: string }
      auto_schedule_work_orders: {
        Args: {
          p_schedule_id?: string
          p_start_date: string
          p_work_center_id: string
        }
        Returns: number
      }
      backflush_materials: {
        Args: { p_quantity_produced: number; p_work_order_id: string }
        Returns: {
          consumed_quantity: number
          consumption_date: string | null
          consumption_type: string | null
          conversion_factor_snapshot: number | null
          created_at: string | null
          created_by: string | null
          id: string
          item_id: string
          location_id: string | null
          lot_number: string | null
          mo_id: string
          notes: string | null
          org_id: string
          planned_quantity: number | null
          product_id: string | null
          qty_entered: number | null
          reservation_id: string | null
          stage_id: string | null
          status: string | null
          stock_valuation_result: Json | null
          total_cost: number | null
          unit_cost: number | null
          uom_id: string | null
          warehouse_id: string | null
          work_order_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "material_consumption"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      batch_post_journal_entries: {
        Args: { p_entry_ids: string[] }
        Returns: Json
      }
      build_bom_tree: {
        Args: {
          p_bom_id: string
          p_force_rebuild?: boolean
          p_org_id?: string
          p_quantity?: number
        }
        Returns: {
          cumulative_quantity: number
          has_children: boolean
          id: string
          is_critical: boolean
          item_code: string
          item_id: string
          item_name: string
          level_number: number
          line_type: string
          parent_id: string
          path: string
          quantity_required: number
          scrap_factor: number
          total_cost: number
          unit_cost: number
        }[]
      }
      calculate_available_capacity: {
        Args: {
          p_end_date: string
          p_start_date: string
          p_work_center_id: string
        }
        Returns: {
          avg_daily_hours: number
          total_available_hours: number
          working_days: number
        }[]
      }
      calculate_bom_cost: {
        Args: { p_bom_id: string; p_quantity?: number }
        Returns: number
      }
      calculate_bom_standard_cost: {
        Args: { p_bom_id: string; p_org_id?: string; p_quantity?: number }
        Returns: {
          labor_cost: number
          material_cost: number
          overhead_cost: number
          total_cost: number
          unit_cost: number
        }[]
      }
      calculate_labor_variances: {
        Args: { p_end_date?: string; p_mo_id: string; p_start_date?: string }
        Returns: {
          actual_hours: number
          actual_rate: number
          efficiency_variance: number
          rate_variance: number
          standard_hours: number
          standard_rate: number
          total_variance: number
          work_center_code: string
          work_center_name: string
        }[]
      }
      calculate_material_variances: {
        Args: { p_end_date?: string; p_mo_id: string; p_start_date?: string }
        Returns: {
          actual_cost: number
          actual_qty: number
          efficiency_variance: number
          price_variance: number
          product_code: string
          product_name: string
          qty_variance: number
          standard_cost: number
          standard_qty: number
          total_variance: number
        }[]
      }
      calculate_planned_load: {
        Args: {
          p_end_date: string
          p_start_date: string
          p_work_center_id: string
        }
        Returns: {
          in_progress_work_orders: number
          pending_work_orders: number
          total_planned_hours: number
          total_work_orders: number
        }[]
      }
      calculate_routing_cost: {
        Args: { p_bom_id: string; p_org_id?: string; p_quantity?: number }
        Returns: {
          operation_code: string
          operation_name: string
          operation_sequence: number
          run_cost: number
          setup_cost: number
          total_cost: number
          total_time_minutes: number
        }[]
      }
      calculate_routing_standard_cost: {
        Args: { p_quantity?: number; p_routing_id: string }
        Returns: {
          total_labor_cost: number
          total_overhead_cost: number
          total_routing_cost: number
        }[]
      }
      calculate_routing_total_time: {
        Args: { p_quantity?: number; p_routing_id: string }
        Returns: {
          total_lead_time: number
          total_move_time: number
          total_queue_time: number
          total_run_time: number
          total_setup_time: number
        }[]
      }
      calculate_total_routing_cost: {
        Args: { p_bom_id: string; p_org_id?: string; p_quantity?: number }
        Returns: number
      }
      can_proceed_transaction: {
        Args: { p_operation: string; p_org_id: string }
        Returns: boolean
      }
      check_entry_approval_required: {
        Args: { p_entry_id: string }
        Returns: boolean
      }
      check_materials_availability: {
        Args: { p_materials: Json[]; p_org_id: string }
        Returns: Json
      }
      cleanup_bom_tree_cache: { Args: never; Returns: number }
      compare_bom_costs: {
        Args: { p_bom_id: string; p_org_id?: string; p_quantity?: number }
        Returns: {
          actual_cost: number
          cost_type: string
          standard_cost: number
          variance: number
          variance_pct: number
        }[]
      }
      complete_operation: {
        Args: {
          p_notes?: string
          p_quantity_produced: number
          p_quantity_scrapped?: number
          p_work_order_id: string
        }
        Returns: {
          actual_end_date: string | null
          actual_run_time: number | null
          actual_setup_time: number | null
          actual_start_date: string | null
          actual_wait_time: number | null
          completed_quantity: number | null
          created_at: string | null
          created_by: string | null
          current_operator_id: string | null
          id: string
          mo_id: string
          notes: string | null
          operation_id: string | null
          operation_name: string
          operation_name_ar: string | null
          operation_sequence: number
          org_id: string
          planned_end_date: string | null
          planned_quantity: number
          planned_run_time: number | null
          planned_setup_time: number | null
          planned_start_date: string | null
          priority: number | null
          scrapped_quantity: number | null
          status: string | null
          updated_at: string | null
          work_center_id: string
          work_order_number: string
        }
        SetofOptions: {
          from: "*"
          to: "work_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      comprehensive_data_integrity_check: {
        Args: { p_org_id: string }
        Returns: Json
      }
      consume_materials_for_mo: {
        Args: { p_consumptions: Json[]; p_mo_id: string; p_org_id: string }
        Returns: Json
      }
      copy_routing: {
        Args: {
          p_new_code: string
          p_new_version?: number
          p_routing_id: string
        }
        Returns: string
      }
      create_crud_permissions: {
        Args: {
          p_include_approve?: boolean
          p_module_name: string
          p_resource: string
          p_resource_ar: string
        }
        Returns: undefined
      }
      create_mo_with_reservation: {
        Args: { p_materials: Json[]; p_mo_data: Json; p_org_id: string }
        Returns: Json
      }
      create_role_from_template: {
        Args: {
          p_created_by?: string
          p_custom_name?: string
          p_org_id: string
          p_template_id: string
        }
        Returns: string
      }
      create_simple_org_rls: {
        Args: { table_name: string }
        Returns: undefined
      }
      ensure_column: {
        Args: {
          p_column: string
          p_default: string
          p_table: string
          p_type: string
        }
        Returns: undefined
      }
      explode_bom: {
        Args: { p_bom_id: string; p_org_id?: string; p_quantity?: number }
        Returns: {
          is_critical: boolean
          item_code: string
          item_id: string
          item_name: string
          level_number: number
          line_type: string
          quantity_required: number
          scrap_factor: number
          unit_of_measure: string
        }[]
      }
      generate_collection_number: {
        Args: { org_uuid: string }
        Returns: string
      }
      generate_customer_receipt_number: { Args: never; Returns: string }
      generate_entry_number:
        | { Args: { p_entry_date: string; p_org_id: string }; Returns: string }
        | { Args: { p_journal_id: string }; Returns: string }
      generate_entry_number_enhanced: {
        Args: { p_entry_date?: string; p_journal_id: string }
        Returns: string
      }
      generate_sales_order_number: {
        Args: { org_uuid: string }
        Returns: string
      }
      generate_supplier_payment_number: { Args: never; Returns: string }
      generate_voucher_number: {
        Args: { p_org_id?: string; p_voucher_type: string }
        Returns: string
      }
      generate_work_orders_from_mo: {
        Args: { p_mo_id: string }
        Returns: {
          actual_end_date: string | null
          actual_run_time: number | null
          actual_setup_time: number | null
          actual_start_date: string | null
          actual_wait_time: number | null
          completed_quantity: number | null
          created_at: string | null
          created_by: string | null
          current_operator_id: string | null
          id: string
          mo_id: string
          notes: string | null
          operation_id: string | null
          operation_name: string
          operation_name_ar: string | null
          operation_sequence: number
          org_id: string
          planned_end_date: string | null
          planned_quantity: number
          planned_run_time: number | null
          planned_setup_time: number | null
          planned_start_date: string | null
          priority: number | null
          scrapped_quantity: number | null
          status: string | null
          updated_at: string | null
          work_center_id: string
          work_order_number: string
        }[]
        SetofOptions: {
          from: "*"
          to: "work_orders"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_account_details: {
        Args: { p_account_code: string; p_org_id: string }
        Returns: {
          account_id: string
          allow_posting: boolean
          category: string
          code: string
          name: string
          normal_balance: string
          parent_code: string
          subtype: string
        }[]
      }
      get_account_statement: {
        Args: {
          p_account_code: string
          p_from_date?: string
          p_to_date?: string
        }
        Returns: {
          credit: number
          debit: number
          description: string
          entry_date: string
          entry_number: string
          running_balance: number
        }[]
      }
      get_account_statement_by_code: {
        Args: {
          p_account_code: string
          p_from_date?: string
          p_include_unposted?: boolean
          p_to_date?: string
        }
        Returns: {
          balance: number
          credit: number
          debit: number
          description: string
          description_ar: string
          entry_date: string
          entry_number: string
          reference_number: string
          reference_type: string
          running_balance: number
        }[]
      }
      get_account_tree: {
        Args: { p_category?: string; p_org_id: string }
        Returns: {
          account_id: string
          category: string
          code: string
          level: number
          name: string
          parent_code: string
          path: string
        }[]
      }
      get_available_quantity: {
        Args: { p_item_id: string; p_location_id?: string; p_org_id: string }
        Returns: number
      }
      get_child_accounts: {
        Args: { p_org_id: string; p_parent_code: string }
        Returns: {
          account_id: string
          category: string
          code: string
          level: number
          name: string
        }[]
      }
      get_current_tenant_id: { Args: never; Returns: string }
      get_effective_org_id: { Args: never; Returns: string }
      get_exchange_rate: {
        Args: {
          p_from_currency: string
          p_rate_date?: string
          p_to_currency: string
        }
        Returns: number
      }
      get_fifo_rate: { Args: { p_stock_queue: Json }; Returns: number }
      get_gl_accounts_by_category: {
        Args: { p_category: string; p_org_id: string }
        Returns: {
          allow_posting: boolean
          category: string
          code: string
          id: string
          name: string
          parent_code: string
          subtype: string
        }[]
      }
      get_gl_mapping: {
        Args: { p_event_key: string; p_org_id: string }
        Returns: {
          credit_account: string
          debit_account: string
          description: string
          mapping_id: string
        }[]
      }
      get_labor_efficiency_summary: {
        Args: {
          p_end_date: string
          p_org_id: string
          p_start_date: string
          p_work_center_id?: string
        }
        Returns: {
          completed_operations: number
          efficiency_pct: number
          scrap_rate_pct: number
          total_actual_time: number
          total_planned_time: number
          total_produced: number
          total_scrapped: number
          work_center_id: string
          work_center_name: string
        }[]
      }
      get_lifo_rate: { Args: { p_stock_queue: Json }; Returns: number }
      get_oee_summary: {
        Args: {
          p_end_date: string
          p_org_id: string
          p_start_date: string
          p_work_center_id?: string
        }
        Returns: {
          availability_pct: number
          oee_pct: number
          performance_pct: number
          quality_pct: number
          work_center_id: string
          work_center_name: string
        }[]
      }
      get_organization_profile: { Args: { p_org_id: string }; Returns: Json }
      get_product_batches: {
        Args: { p_product_id: string }
        Returns: {
          age_days: number
          batch_no: number
          qty: number
          rate: number
          value: number
        }[]
      }
      get_segment_report: {
        Args: {
          p_account_type?: string
          p_from_date?: string
          p_segment_id?: string
          p_segment_type: string
          p_to_date?: string
        }
        Returns: {
          account_code: string
          account_name: string
          balance: number
          segment_code: string
          segment_name: string
          total_credit: number
          total_debit: number
        }[]
      }
      get_stock_aging: {
        Args: { p_category_id?: string; p_warehouse_id?: string }
        Returns: {
          days_in_stock: number
          first_receipt_date: string
          product_code: string
          product_id: string
          product_name: string
          quantity: number
          stock_value: number
          valuation_rate: number
        }[]
      }
      get_stock_balance: {
        Args: {
          p_posting_date?: string
          p_product_id: string
          p_warehouse_id: string
        }
        Returns: {
          quantity: number
          stock_value: number
          valuation_rate: number
        }[]
      }
      get_stock_balance_at_date: {
        Args: {
          p_posting_date: string
          p_product_id: string
          p_warehouse_id: string
        }
        Returns: {
          quantity: number
          stock_value: number
          valuation_rate: number
        }[]
      }
      get_stock_balance_with_method: {
        Args: {
          p_product_id: string
          p_valuation_method?: string
          p_warehouse_id: string
        }
        Returns: {
          quantity: number
          stock_queue: Json
          stock_value: number
          valuation_rate: number
        }[]
      }
      get_user_org_ids: { Args: never; Returns: string[] }
      get_user_permissions: {
        Args: { p_org_id: string; p_user_id: string }
        Returns: {
          action: string
          module_name: string
          permission_key: string
          resource: string
        }[]
      }
      get_weighted_average_from_queue: {
        Args: { p_stock_queue: Json }
        Returns: number
      }
      get_where_used: {
        Args: { p_item_id: string; p_org_id?: string }
        Returns: {
          bom_status: string
          is_active: boolean
          parent_bom_id: string
          parent_item_code: string
          parent_item_name: string
          quantity_per: number
        }[]
      }
      has_permission: {
        Args: { p_org_id: string; p_permission_key: string; p_user_id: string }
        Returns: boolean
      }
      identify_bottlenecks: {
        Args: { p_end_date: string; p_org_id: string; p_start_date: string }
        Returns: {
          available_hours: number
          bottleneck_severity: string
          is_bottleneck: boolean
          planned_hours: number
          utilization_pct: number
          work_center_id: string
          work_center_name: string
        }[]
      }
      is_org_admin: { Args: { p_org_id: string }; Returns: boolean }
      is_org_admin_for: { Args: { check_org_id: string }; Returns: boolean }
      is_super_admin: { Args: never; Returns: boolean }
      log_custom_activity: {
        Args: {
          p_action: string
          p_details?: Json
          p_entity_id?: string
          p_entity_type: string
          p_org_id: string
        }
        Returns: string
      }
      normalize_mo_status: { Args: { p_status: string }; Returns: string }
      post_journal_entry: { Args: { p_entry_id: string }; Returns: Json }
      reconcile_account: {
        Args: {
          p_account_id: string
          p_reconciliation_date: string
          p_statement_items?: Json
        }
        Returns: Json
      }
      release_expired_reservations: {
        Args: { p_org_id?: string }
        Returns: number
      }
      release_manufacturing_order: {
        Args: { p_mo_id: string }
        Returns: {
          auto_backflush: boolean | null
          backflush_timing: string | null
          completed_date: string | null
          completed_quantity: number | null
          costing_method: string | null
          created_at: string | null
          created_by: string | null
          due_date: string | null
          id: string
          item_id: string | null
          notes: string | null
          order_number: string
          org_id: string
          product_id: string | null
          quantity: number
          routing_id: string | null
          scrap_quantity: number | null
          start_date: string | null
          status: string | null
          total_cost: number | null
          unit_cost: number | null
          updated_at: string | null
          work_orders_generated: boolean | null
        }
        SetofOptions: {
          from: "*"
          to: "manufacturing_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reverse_journal_entry_enhanced: {
        Args: {
          p_entry_id: string
          p_reversal_date?: string
          p_reversal_reason?: string
        }
        Returns: Json
      }
      rpc_accept_invitation: { Args: { p_token: string }; Returns: Json }
      rpc_assign_product_base_uom: {
        Args: { p_org_id: string; p_product_id: string; p_uom_id: string }
        Returns: Json
      }
      rpc_cancel_stock_adjustment: {
        Args: { p_adjustment_id: string; p_reason: string }
        Returns: Json
      }
      rpc_complete_manufacturing_order: {
        Args: { p_payload: Json }
        Returns: Json
      }
      rpc_consume_reserved_materials: {
        Args: { p_consumptions: Json; p_mo_id: string }
        Returns: Json
      }
      rpc_consume_reserved_materials_v2: {
        Args: { p_consumptions: Json; p_mo_id: string; p_stage_id: string }
        Returns: Json
      }
      rpc_convert_product_uom: {
        Args: {
          p_at?: string
          p_product_id: string
          p_quantity: number
          p_uom_id: string
        }
        Returns: Json
      }
      rpc_cost_of_production_report: {
        Args: { p_mo_id: string; p_stage_no?: number; p_tenant?: string }
        Returns: Json
      }
      rpc_create_journal_entry: { Args: { p_payload: Json }; Returns: Json }
      rpc_create_mo_with_reservation: {
        Args: { p_materials?: Json; p_order: Json; p_tenant?: string }
        Returns: Json
      }
      rpc_create_org_uom: {
        Args: {
          p_aliases?: string[]
          p_category_id: string
          p_code: string
          p_decimal_places?: number
          p_factor_to_category_base?: number
          p_is_product_specific?: boolean
          p_name: string
          p_name_ar: string
          p_org_id: string
          p_symbol: string
        }
        Returns: Json
      }
      rpc_create_stock_adjustment: { Args: { p_payload: Json }; Returns: Json }
      rpc_create_uom_purchase_order: {
        Args: { p_payload: Json }
        Returns: Json
      }
      rpc_approve_purchase_order: {
        Args: { p_org_id: string; p_purchase_order_id: string }
        Returns: Json
      }
      rpc_generate_fiscal_periods: {
        Args: { p_tenant?: string; p_year: number }
        Returns: Json
      }
      rpc_get_invitation_preview: {
        Args: { p_token: string }
        Returns: {
          email: string
          expires_at: string
          is_valid: boolean
          org_name: string
          org_name_ar: string
          status: string
        }[]
      }
      rpc_get_org_uom_engine_enabled: {
        Args: { p_org_id: string }
        Returns: boolean
      }
      rpc_get_product_weight: {
        Args: {
          p_at?: string
          p_product_id: string
          p_quantity: number
          p_uom_id: string
        }
        Returns: Json
      }
      rpc_get_purchase_product_uoms: {
        Args: { p_org_id: string; p_product_id: string }
        Returns: Json
      }
      rpc_get_trial_balance: {
        Args: { p_as_of_date?: string; p_tenant: string }
        Returns: {
          account_code: string
          account_name: string
          account_name_ar: string
          account_type: string
          closing_credit: number
          closing_debit: number
          opening_credit: number
          opening_debit: number
          period_credit: number
          period_debit: number
        }[]
      }
      rpc_ignore_uom_backfill_issue: {
        Args: { p_issue_id: string; p_note?: string; p_org_id: string }
        Returns: Json
      }
      rpc_list_periods: {
        Args: { p_fiscal_year?: number; p_tenant?: string }
        Returns: Json
      }
      rpc_list_uom_purchase_order_options: {
        Args: { p_org_id: string }
        Returns: Json
      }
      rpc_list_uom_receivable_purchase_orders: {
        Args: { p_org_id: string }
        Returns: Json
      }
      rpc_manual_stock_movement: {
        Args: {
          p_movement_type: string
          p_notes?: string
          p_product_id: string
          p_quantity: number
          p_warehouse_id?: string
        }
        Returns: Json
      }
      rpc_manual_stock_movement_v2: { Args: { p_payload: Json }; Returns: Json }
      rpc_post_delivery_note: { Args: { p_payload: Json }; Returns: Json }
      rpc_post_event_journal: {
        Args: {
          p_amount: number
          p_event: string
          p_idempotency_key?: string
          p_jv_date?: string
          p_memo: string
          p_ref_id?: string
          p_ref_type: string
          p_tenant?: string
        }
        Returns: string
      }
      rpc_post_goods_receipt: { Args: { p_payload: Json }; Returns: Json }
      rpc_post_payroll_run: { Args: { p_payload: Json }; Returns: Json }
      rpc_post_settlement: { Args: { p_payload: Json }; Returns: Json }
      rpc_post_work_center_oh: {
        Args: {
          p_amount: number
          p_idempotency_key?: string
          p_jv_date?: string
          p_memo: string
          p_ref_id?: string
          p_ref_type: string
          p_tenant?: string
          p_work_center: string
        }
      rpc_submit_purchase_order: {
        Args: { p_org_id: string; p_purchase_order_id: string }
        Returns: Json
      }
        Returns: string
      }
      rpc_resolve_uom_backfill_issue: {
        Args: {
          p_issue_id: string
          p_note?: string
          p_org_id: string
          p_resolved_uom_id?: string
        }
        Returns: Json
      }
      rpc_set_org_admin: {
        Args: { p_org_id: string; p_target_user_id: string; p_value: boolean }
        Returns: Json
      }
      rpc_set_period_status: {
        Args: { p_period_code: string; p_status: string; p_tenant?: string }
        Returns: Json
      }
      rpc_set_product_physical_weight: {
        Args: {
          p_gross_weight: number
          p_net_weight: number
          p_product_id: string
          p_weight_uom_id: string
        }
        Returns: Json
      }
      rpc_set_product_uom_conversion: {
        Args: {
          p_allow_cross_dimension?: boolean
          p_barcode?: string
          p_factor_to_base: number
          p_notes?: string
          p_org_id: string
          p_product_id: string
          p_uom_id: string
          p_use_for_purchase?: boolean
          p_use_for_sale?: boolean
        }
        Returns: Json
      }
      rpc_subledger_gl_reconciliation: {
        Args: {
          p_as_of_date?: string
          p_inventory_prefixes?: string[]
          p_tenant?: string
          p_wip_prefixes?: string[]
        }
        Returns: Json
      }
      rpc_submit_settlement_review: { Args: { p_payload: Json }; Returns: Json }
      rpc_submit_stock_adjustment: {
        Args: { p_adjustment_id: string }
        Returns: Json
      }
      rpc_transition_mo_status: {
        Args: {
          p_mo_id: string
          p_notes?: string
          p_status: string
          p_tenant?: string
        }
        Returns: Json
      }
      rpc_upsert_event_mapping: {
        Args: {
          p_credit_account_code: string
          p_debit_account_code: string
          p_description?: string
          p_event_code: string
          p_tenant?: string
          p_work_center_code?: string
        }
        Returns: string
      }
      schedule_work_order: {
        Args: {
          p_schedule_id?: string
          p_scheduled_start: string
          p_work_order_id: string
        }
        Returns: {
          created_at: string | null
          delay_hours: number | null
          delay_reason: string | null
          id: string
          org_id: string
          priority: number | null
          schedule_id: string
          schedule_sequence: number
          schedule_status: string | null
          scheduled_end: string
          scheduled_start: string
          updated_at: string | null
          work_order_id: string
        }
        SetofOptions: {
          from: "*"
          to: "schedule_details"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      search_accounts: {
        Args: { p_org_id: string; p_search_term: string }
        Returns: {
          account_id: string
          category: string
          code: string
          name: string
          subtype: string
        }[]
      }
      select_optimal_bom: {
        Args: {
          p_item_id: string
          p_order_date?: string
          p_org_id?: string
          p_quantity: number
        }
        Returns: string
      }
      set_current_org: { Args: { org_uuid: string }; Returns: undefined }
      simulate_cogs: {
        Args: { p_product_id: string; p_quantity: number }
        Returns: {
          avg_rate: number
          cogs: number
          method: string
          remaining_qty: number
          remaining_value: number
        }[]
      }
      start_operation: {
        Args: {
          p_is_setup?: boolean
          p_operator_id?: string
          p_work_order_id: string
        }
        Returns: {
          actual_end_date: string | null
          actual_run_time: number | null
          actual_setup_time: number | null
          actual_start_date: string | null
          actual_wait_time: number | null
          completed_quantity: number | null
          created_at: string | null
          created_by: string | null
          current_operator_id: string | null
          id: string
          mo_id: string
          notes: string | null
          operation_id: string | null
          operation_name: string
          operation_name_ar: string | null
          operation_sequence: number
          org_id: string
          planned_end_date: string | null
          planned_quantity: number
          planned_run_time: number | null
          planned_setup_time: number | null
          planned_start_date: string | null
          priority: number | null
          scrapped_quantity: number | null
          status: string | null
          updated_at: string | null
          work_center_id: string
          work_order_number: string
        }
        SetofOptions: {
          from: "*"
          to: "work_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      translate_amount: {
        Args: {
          p_amount: number
          p_from_currency: string
          p_rate_date?: string
          p_to_currency: string
        }
        Returns: number
      }
      uom_normalize_alias: { Args: { p_value: string }; Returns: string }
      update_organization_profile: {
        Args: {
          p_address?: string
          p_city?: string
          p_commercial_registration?: string
          p_country?: string
          p_currency?: string
          p_email?: string
          p_fax?: string
          p_license_number?: string
          p_logo_url?: string
          p_mobile?: string
          p_name?: string
          p_name_ar?: string
          p_name_en?: string
          p_org_id: string
          p_phone?: string
          p_postal_code?: string
          p_primary_color?: string
          p_secondary_color?: string
          p_state?: string
          p_tax_number?: string
          p_timezone?: string
          p_website?: string
        }
        Returns: Json
      }
      update_warehouse_gl_mapping: {
        Args: {
          p_cogs_account?: string
          p_cost_center?: string
          p_expense_account?: string
          p_org_id: string
          p_stock_account?: string
          p_stock_adjustment_account?: string
          p_warehouse_id: string
        }
        Returns: boolean
      }
      update_work_center_load: {
        Args: {
          p_end_date: string
          p_start_date: string
          p_work_center_id: string
        }
        Returns: {
          actual_load_hours: number | null
          available_capacity_hours: number | null
          calculated_at: string | null
          completed_work_orders: number | null
          created_at: string | null
          efficiency_pct: number | null
          id: string
          org_id: string
          period_end: string
          period_start: string
          planned_load_hours: number | null
          planned_work_orders: number | null
          status: string | null
          updated_at: string | null
          utilization_pct: number | null
          work_center_id: string
        }
        SetofOptions: {
          from: "*"
          to: "work_center_load"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      upsert_attendance_day: {
        Args: {
          p_day: string
          p_employee_id: string
          p_month: number
          p_org_id: string
          p_payload: Json
          p_year: number
        }
        Returns: {
          created_at: string
          days: Json
          employee_id: string
          id: string
          metadata: Json | null
          month: number
          org_id: string
          updated_at: string
          updated_by: string | null
          year: number
        }
        SetofOptions: {
          from: "*"
          to: "hr_attendance_monthly"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      upsert_stage_cost: {
        Args: {
          p_dm?: number
          p_good_qty: number
          p_input_qty?: number
          p_mo: string
          p_mode?: string
          p_notes?: string
          p_regrind_cost?: number
          p_rework_qty?: number
          p_scrap_qty?: number
          p_stage: number
          p_tenant: string
          p_waste_credit?: number
          p_wc: string
          p_wip_beginning_cc_completion_pct?: number
          p_wip_beginning_cost?: number
          p_wip_beginning_dm_completion_pct?: number
          p_wip_beginning_qty?: number
          p_wip_end_cc_completion_pct?: number
          p_wip_end_dm_completion_pct?: number
          p_wip_end_qty?: number
        }
        Returns: {
          abnormal_scrap_cost: number
          costing_method: string
          current_period_cost: number
          eup: number
          labor_cost: number
          normal_scrap_cost: number
          overhead_cost: number
          stage_id: string
          total_cost: number
          transferred_in: number
          unit_cost: number
          wip_beginning_cost: number
        }[]
      }
      upsert_stage_cost_core: {
        Args: {
          p_dm?: number
          p_good_qty: number
          p_input_qty?: number
          p_mo: string
          p_mode?: string
          p_notes?: string
          p_regrind_cost?: number
          p_rework_qty?: number
          p_scrap_qty?: number
          p_stage: number
          p_tenant: string
          p_waste_credit?: number
          p_wc: string
          p_wip_beginning_cc_completion_pct?: number
          p_wip_beginning_cost?: number
          p_wip_beginning_dm_completion_pct?: number
          p_wip_beginning_qty?: number
          p_wip_end_cc_completion_pct?: number
          p_wip_end_dm_completion_pct?: number
          p_wip_end_qty?: number
        }
        Returns: {
          abnormal_scrap_cost: number
          costing_method: string
          current_period_cost: number
          eup: number
          labor_cost: number
          normal_scrap_cost: number
          overhead_cost: number
          stage_id: string
          total_cost: number
          transferred_in: number
          unit_cost: number
          wip_beginning_cost: number
        }[]
      }
      validate_foreign_key: {
        Args: {
          p_column_name: string
          p_org_id: string
          p_reference_table: string
          p_table_name: string
        }
        Returns: {
          orphaned_count: number
          orphaned_ids: string[]
        }[]
      }
      validate_mo_transition: {
        Args: { p_from: string; p_to: string }
        Returns: undefined
      }
      validate_posting_account: {
        Args: { p_account_code: string; p_org_id: string }
        Returns: boolean
      }
      validate_reservations: {
        Args: { p_org_id: string }
        Returns: {
          available: number
          item_id: string
          mo_id: string
          on_hand: number
          reserved: number
        }[]
      }
      validate_stock_balance: {
        Args: { p_org_id: string }
        Returns: {
          actual_quantity: number
          calculated_quantity: number
          difference: number
          item_id: string
          location_id: string
        }[]
      }
      validate_tenant_isolation: {
        Args: { p_org_id: string; p_table_name: string }
        Returns: {
          invalid_count: number
          record_count: number
          valid_count: number
        }[]
      }
      validate_warehouse_accounts: {
        Args: { p_expense_account: string; p_stock_account: string }
        Returns: {
          error_message: string
          is_valid: boolean
        }[]
      }
      wardah_apply_stock_incoming: {
        Args: {
          p_org: string
          p_posting_date: string
          p_product: string
          p_qty: number
          p_rate: number
          p_voucher_id: string
          p_voucher_number: string
          p_voucher_type: string
          p_warehouse: string
        }
        Returns: Json
      }
      wardah_apply_stock_outgoing: {
        Args: {
          p_org: string
          p_posting_date: string
          p_product: string
          p_qty: number
          p_voucher_id: string
          p_voucher_number: string
          p_voucher_type: string
          p_warehouse: string
        }
        Returns: Json
      }
      wardah_assert_org_admin: { Args: { p_org: string }; Returns: undefined }
      wardah_assert_org_member: { Args: { p_org: string }; Returns: undefined }
      wardah_is_org_admin: { Args: { p_org: string }; Returns: boolean }
      wardah_is_org_member: { Args: { p_org: string }; Returns: boolean }
      wardah_org_id: { Args: { p_explicit?: string }; Returns: string }
      wardah_periods_org_col: { Args: never; Returns: string }
      wardah_require_positive_bom_quantity: {
        Args: { p_bom_id: string; p_quantity: number }
        Returns: number
      }
      wardah_resolve_product_id: {
        Args: { p_at?: string; p_item_or_product: string; p_org: string }
        Returns: string
      }
      wardah_settlement_snapshot: {
        Args: { p_settlement_id: string }
        Returns: Json
      }
      wardah_uom_cost_to_base: {
        Args: {
          p_at?: string
          p_org: string
          p_product: string
          p_unit_cost_entered: number
          p_uom: string
        }
        Returns: number
      }
      wardah_uom_factor: {
        Args: { p_at?: string; p_org: string; p_product: string; p_uom: string }
        Returns: number
      }
      wardah_uom_to_base: {
        Args: {
          p_at?: string
          p_org: string
          p_product: string
          p_quantity: number
          p_uom: string
        }
        Returns: number
      }
    }
    Enums: {
      valuation_method_enum:
        | "Weighted Average"
        | "FIFO"
        | "LIFO"
        | "Moving Average"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      valuation_method_enum: [
        "Weighted Average",
        "FIFO",
        "LIFO",
        "Moving Average",
      ],
    },
  },
} as const

