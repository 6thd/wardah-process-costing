/**
 * Helper functions for Sales Orders Create
 * Extracted to reduce cognitive complexity
 */

import type { SupabaseClient } from '@supabase/supabase-js';

interface SalesOrderItem {
  quantity: number;
  unit_price?: number;
  total_price: number;
  [key: string]: unknown;
}

/**
 * Calculate total amount from order items
 */
export function calculateTotalAmount(items: SalesOrderItem[]): number {
  return items.reduce((sum: number, item: SalesOrderItem) => sum + (item.total_price || 0), 0);
}

/**
 * Build select query with user data
 */
export function buildSelectWithUser(): string {
  return `
    *,
    customer:customers(*),
    user:users(full_name),
    sales_order_items(
      *,
      item:products(*)
    )
  `;
}

/**
 * Build select query without user data
 */
export function buildSelectWithoutUser(): string {
  return `
    *,
    customer:customers(*),
    sales_order_items(
      *,
      item:products(*)
    )
  `;
}

/**
 * Update sales order with fallback if user not found
 */
export async function updateSalesOrderWithFallback(
  supabase: SupabaseClient,
  orderId: string,
  totalAmount: number
): Promise<Record<string, unknown>> {
  // First try with user data
  const { data, error: updateError } = await supabase
    .from('sales_orders')
    .update({ total_amount: totalAmount })
    .eq('id', orderId)
    .select(buildSelectWithUser())
    .single();

  if (!updateError) {
    return data as unknown as Record<string, unknown>;
  }

  // If user not found, try without user data
  if (updateError.message?.includes('404')) {
    console.warn('User not found for sales order, updating without user data:', orderId);
    const { data: fallbackData, error: fallbackError } = await supabase
      .from('sales_orders')
      .update({ total_amount: totalAmount })
      .eq('id', orderId)
      .select(buildSelectWithoutUser())
      .single();

    if (fallbackError) {
      throw fallbackError;
    }

    return fallbackData as unknown as Record<string, unknown>;
  }

  throw updateError;
}

