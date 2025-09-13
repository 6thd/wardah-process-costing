import { supabase } from '@/lib/supabase'

/**
 * Interface for posting requests to the GL system
 */
export interface PostingRequest {
  event: string
  amount: number
  memo: string
  refType: string
  refId?: string
  idempotencyKey?: string
  jvDate?: string // YYYY-MM-DD
  tenantId?: string
}

/**
 * Interface for work center overhead posting requests
 */
export interface WorkCenterOHRequest {
  workCenter: string
  amount: number
  memo: string
  refType: string
  refId?: string
  idempotencyKey?: string
  jvDate?: string // YYYY-MM-DD
  tenantId?: string
}

/**
 * Interface for linking inventory moves to journal entries
 */
export interface LinkInventoryMoveRequest {
  moveId: string
  headerId: string
  tenantId?: string
}

/**
 * Interface for account balance requests
 */
export interface AccountBalanceRequest {
  accountCode: string
  asOfDate?: string // YYYY-MM-DD
  tenantId?: string
}

/**
 * Interface for trial balance requests
 */
export interface TrialBalanceRequest {
  asOfDate?: string // YYYY-MM-DD
  tenantId?: string
}

/**
 * Posting Service for GL Integration
 * Connects UI components to the enhanced GL posting functions
 */
export class PostingService {
  /**
   * Post an event journal entry
   */
  static async postEventJournal(request: PostingRequest): Promise<string> {
    const { data, error } = await supabase.rpc('rpc_post_event_journal', {
      p_event: request.event,
      p_amount: request.amount,
      p_memo: request.memo,
      p_ref_type: request.refType,
      p_ref_id: request.refId || null,
      p_tenant: request.tenantId || null,
      p_idempotency_key: request.idempotencyKey || null,
      p_jv_date: request.jvDate || null
    })

    if (error) throw new Error(error.message)
    return data as string
  }

  /**
   * Post work center overhead
   */
  static async postWorkCenterOH(request: WorkCenterOHRequest): Promise<string> {
    const { data, error } = await supabase.rpc('rpc_post_work_center_oh', {
      p_work_center: request.workCenter,
      p_amount: request.amount,
      p_memo: request.memo,
      p_ref_type: request.refType,
      p_ref_id: request.refId || null,
      p_tenant: request.tenantId || null,
      p_idempotency_key: request.idempotencyKey || null,
      p_jv_date: request.jvDate || null
    })

    if (error) throw new Error(error.message)
    return data as string
  }

  /**
   * Link an inventory move to a journal entry
   */
  static async linkInventoryMoveToJournal(request: LinkInventoryMoveRequest): Promise<void> {
    const { error } = await supabase.rpc('rpc_link_inventory_move_to_journal', {
      p_move_id: request.moveId,
      p_header_id: request.headerId,
      p_tenant: request.tenantId || null
    })

    if (error) throw new Error(error.message)
  }

  /**
   * Get account balance
   */
  static async getAccountBalance(request: AccountBalanceRequest): Promise<number> {
    const { data, error } = await supabase.rpc('rpc_get_account_balance', {
      p_account_code: request.accountCode,
      p_tenant: request.tenantId || null,
      p_as_of_date: request.asOfDate || null
    })

    if (error) throw new Error(error.message)
    return data as number
  }

  /**
   * Get trial balance
   */
  static async getTrialBalance(request: TrialBalanceRequest): Promise<any[]> {
    const { data, error } = await supabase.rpc('rpc_get_trial_balance', {
      p_tenant: request.tenantId || null,
      p_as_of_date: request.asOfDate || null
    })

    if (error) throw new Error(error.message)
    return data as any[]
  }
}

// Export default instance for convenience
export default PostingService