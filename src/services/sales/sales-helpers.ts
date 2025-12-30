/**
 * Helper functions for Sales Orders Service
 * Extracted to reduce cognitive complexity
 */

import type { SupabaseClient } from '@supabase/supabase-js';

interface OrderWithCustomer {
  customer_id?: string;
  customer?: unknown;
  [key: string]: unknown;
}

/**
 * Check if error is table not found
 */
export function isTableNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { code?: string; message?: string };
  return err.code === 'PGRST205' || err.message?.includes('Could not find the table') === true;
}

/**
 * Check if error is relationship not found
 */
export function isRelationshipNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { code?: string; message?: string };
  return err.message?.includes('Could not find a relationship') === true || 
         err.message?.includes('relationship') === true;
}

/**
 * Try to fetch sales orders with relationships
 */
export async function fetchSalesOrdersWithRelations(
  supabase: SupabaseClient
): Promise<{ data: unknown[] | null; error: unknown }> {
  return await supabase
    .from('sales_orders')
    .select(`
      *,
      customer:customers(*),
      user:users(full_name),
      sales_order_items(
        *,
        item:products(*)
      )
    `)
    .order('created_at', { ascending: false });
}

/**
 * Try to fetch sales orders without relationships
 */
export async function fetchSalesOrdersSimple(
  supabase: SupabaseClient
): Promise<OrderWithCustomer[]> {
  const { data, error } = await supabase
    .from('sales_orders')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []) as OrderWithCustomer[];
}

/**
 * Try to fetch sales invoices as fallback
 */
export async function fetchSalesInvoicesAsFallback(
  supabase: SupabaseClient
): Promise<OrderWithCustomer[]> {
  const { data, error } = await supabase
    .from('sales_invoices')
    .select('*')
    .order('invoice_date', { ascending: false })
    .limit(100);

  if (error) {
    console.error('Error fetching sales_invoices:', error);
    return [];
  }

  return (data || []).map((inv: Record<string, unknown>) => ({
    ...inv,
    so_date: inv.invoice_date,
    so_number: inv.invoice_number,
    status: inv.payment_status || inv.delivery_status || 'draft'
  })) as OrderWithCustomer[];
}

/**
 * Fetch customers separately and attach to orders
 */
export async function attachCustomersToOrders(
  supabase: SupabaseClient,
  orders: OrderWithCustomer[]
): Promise<OrderWithCustomer[]> {
  const customerIds = [...new Set(
    orders
      .map(order => order.customer_id)
      .filter(Boolean) as string[]
  )];

  if (customerIds.length === 0) {
    return orders;
  }

  try {
    const { data: customers } = await supabase
      .from('customers')
      .select('*')
      .in('id', customerIds);

    if (!customers) {
      return orders;
    }

    const customerMap = new Map(
      customers.map(c => [c.id as string, c])
    );

    return orders.map(order => ({
      ...order,
      customer: order.customer_id ? customerMap.get(order.customer_id as string) || null : null
    }));
  } catch {
    console.warn('Could not fetch customers separately');
    return orders;
  }
}

