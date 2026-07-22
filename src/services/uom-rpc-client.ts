import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Database, Json } from '@/types/database.generated'

type UomRpcFunctions = {
  rpc_convert_product_uom: {
    Args: {
      p_product_id: string
      p_quantity: number
      p_uom_id: string
      p_at: string
    }
    Returns: Json
  }
  rpc_set_product_uom_conversion: {
    Args: {
      p_org_id: string
      p_product_id: string
      p_uom_id: string
      p_factor_to_base: number
      p_use_for_purchase: boolean
      p_use_for_sale: boolean
      p_barcode: string | null
      p_notes: string | null
      p_allow_cross_dimension: boolean
    }
    Returns: Json
  }
  rpc_set_product_physical_weight: {
    Args: {
      p_product_id: string
      p_net_weight: number
      p_gross_weight: number | null
      p_weight_uom_id: string
    }
    Returns: Json
  }
  rpc_get_product_weight: {
    Args: {
      p_product_id: string
      p_quantity: number
      p_uom_id: string
      p_at: string
    }
    Returns: Json
  }
}

type UomDatabase = Omit<Database, 'public'> & {
  public: Omit<Database['public'], 'Functions'> & {
    Functions: Database['public']['Functions'] & UomRpcFunctions
  }
}

/**
 * Compatibility boundary for UoM RPCs introduced by migrations 129–142.
 *
 * This single, explicit cast exists only while the committed generated schema
 * is being regenerated from the Fresh DB chain. Callers still receive full
 * argument typing, and all JSON responses remain runtime-validated by the
 * UoM service before use.
 */
export const uomRpcClient = supabase as unknown as SupabaseClient<UomDatabase>
