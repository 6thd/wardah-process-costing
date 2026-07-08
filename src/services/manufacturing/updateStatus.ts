/**
 * Manufacturing Service - Status Update Module
 * Refactored from supabase-service.ts to reduce complexity
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  normalizeStatus,
  prepareStatusUpdateData,
  shouldSetEndDate,
  shouldSetStartDate,
  loadRelatedItemData,
  isTableNotFoundError,
  isRelationshipNotFoundError,
  performSimpleUpdate
} from './helpers';

function isMissingFunctionError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === 'PGRST202' || error.message?.includes('Could not find the function') || false;
}

type ManufacturingOrderStatus = 
  | 'draft' 
  | 'confirmed' 
  | 'pending' 
  | 'in-progress' 
  | 'completed' 
  | 'cancelled' 
  | 'on-hold' 
  | 'quality-check';

interface UpdateStatusParams {
  id: string;
  status: ManufacturingOrderStatus;
  providedUpdateData?: Record<string, unknown>;
}

/**
 * Apply automatic date logic based on status transition
 */
async function applyAutomaticDates(
  supabase: SupabaseClient,
  id: string,
  status: string,
  updateData: Record<string, unknown>,
  providedUpdateData?: Record<string, unknown>
): Promise<void> {
  // Skip if dates were provided explicitly
  if (providedUpdateData?.start_date || providedUpdateData?.end_date) {
    return;
  }

  // Set end_date for completed status
  if (shouldSetEndDate(status, providedUpdateData) && !updateData.end_date) {
    updateData.end_date = new Date().toISOString();
  }

  // Set start_date for in-progress status
  if (shouldSetStartDate(status, providedUpdateData) && !updateData.start_date) {
    const { data: currentOrder } = await supabase
      .from('manufacturing_orders')
      .select('start_date')
      .eq('id', id)
      .single();

    if (currentOrder && !currentOrder.start_date) {
      updateData.start_date = new Date().toISOString();
    }
  }
}

/**
 * Handle relationship not found error by retrying without joins
 */
async function handleRelationshipError(
  supabase: SupabaseClient,
  id: string,
  updateData: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  return performSimpleUpdate(supabase, 'manufacturing_orders', id, updateData);
}

/**
 * Handle update error and retry
 */
async function handleUpdateError(
  getClient: () => Promise<SupabaseClient>,
  id: string,
  status: string,
  error: unknown
): Promise<Record<string, unknown> | null> {
  if (isTableNotFoundError(error)) {
    throw new Error('manufacturing_orders table does not exist');
  }

  if (isRelationshipNotFoundError(error)) {
    const supabase = await getClient();
    const updateData: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString()
    };

    if (status === 'completed') {
      updateData.end_date = new Date().toISOString();
    }

    return performSimpleUpdate(supabase, 'manufacturing_orders', id, updateData);
  }

  throw error;
}

/**
 * Process successful update response
 */
async function processUpdateResponse(
  supabase: SupabaseClient,
  data: Record<string, unknown> | null
): Promise<Record<string, unknown> | null> {
  if (!data) {
    return null;
  }

  const dataWithStatus = data as { status?: string };
  dataWithStatus.status = normalizeStatus(dataWithStatus.status);
  await loadRelatedItemData(supabase, data);

  return data;
}

/**
 * Main update status function with reduced complexity
 * Attempts rpc_transition_mo_status first (enforces state machine at DB level),
 * falls back to direct UPDATE if Migration 78 has not been applied yet.
 */
// eslint-disable-next-line complexity
export async function updateManufacturingOrderStatus(
  getClient: () => Promise<SupabaseClient>,
  params: UpdateStatusParams
): Promise<Record<string, unknown> | null> {
  const { id, status, providedUpdateData } = params;

  try {
    const supabase = await getClient();

    // ===== المسار الذرّي: آلة الحالات عبر RPC =====
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      'rpc_transition_mo_status',
      { p_mo_id: id, p_status: status, p_notes: null, p_tenant: null }
    );

    if (!rpcError && rpcData?.success) {
      // RPC نجح — أعِد الحالة الموحَّدة
      return {
        id,
        status: normalizeStatus(rpcData.new_status),
        ...rpcData
      };
    }

    // خطأ DB حقيقي (مثل MO_INVALID_TRANSITION) — يجب أن يصل للمستخدم
    if (rpcError && !isMissingFunctionError(rpcError)) {
      throw new Error(rpcError.message);
    }

    // ===== Fallback: المسار القديم (Migration 78 غير مطبَّق بعد) =====
    const updateData = prepareStatusUpdateData(status, providedUpdateData);
    await applyAutomaticDates(supabase, id, status, updateData, providedUpdateData);

    const { data, error } = await supabase
      .from('manufacturing_orders')
      .update(updateData)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      if (isRelationshipNotFoundError(error)) {
        const simpleData = await handleRelationshipError(supabase, id, updateData);
        if (simpleData) return simpleData;
      }
      return await handleUpdateError(getClient, id, status, error);
    }

    return await processUpdateResponse(supabase, data);
  } catch (error: unknown) {
    return await handleUpdateError(getClient, id, status, error);
  }
}
