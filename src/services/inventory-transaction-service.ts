/**
 * Inventory Transaction Service
 * 
 * Handles all inventory transactions including:
 * - Material reservations
 * - Material consumption
 * - Reservation releases
 * - Stock availability checks
 */

import { supabase, getEffectiveTenantId } from '@/lib/supabase';
import { InsufficientInventoryError } from '@/lib/errors/InsufficientInventoryError';
import { AppError } from '@/lib/errors/AppError';
import { executeTransaction } from '@/lib/db-transaction';

/**
 * Material reservation
 */
export interface MaterialReservation {
  id: string;
  org_id: string;
  mo_id: string;
  item_id: string;
  quantity_reserved: number;
  quantity_consumed: number;
  quantity_released: number;
  status: 'reserved' | 'consumed' | 'released' | 'expired' | 'cancelled';
  reserved_at: string;
  consumed_at?: string;
  released_at?: string;
  expires_at?: string;
  notes?: string;
}

/**
 * Material requirement for reservation
 */
export interface MaterialRequirement {
  item_id: string;
  quantity: number;
  location_id?: string;
  unit_cost?: number;
}

/**
 * Material consumption record
 */
export interface MaterialConsumption {
  item_id: string;
  quantity: number;
  quantity_reserved: number;
  unit_cost: number;
  location_id?: string;
}

/**
 * Stock availability check result
 */
export interface StockAvailability {
  item_id: string;
  item_name?: string;
  required: number;
  available: number;
  on_hand: number;
  reserved: number;
  sufficient: boolean;
}

/**
 * Inventory Transaction Service
 */
class InventoryTransactionService {
  /**
   * Check stock availability for materials
   */
  async checkAvailability(
    requirements: MaterialRequirement[]
  ): Promise<StockAvailability[]> {
    const orgId = await getEffectiveTenantId();
    if (!orgId) {
      throw new AppError('TENANT_ERROR', 'Organization ID not found', 400);
    }

    const results: StockAvailability[] = [];

    for (const req of requirements) {
      const { data, error } = await supabase.rpc('get_available_quantity', {
        p_org_id: orgId,
        p_item_id: req.item_id,
        p_location_id: req.location_id || null,
      });

      if (error) {
        throw new AppError(
          'STOCK_CHECK_ERROR',
          `Failed to check stock for item ${req.item_id}: ${error.message}`,
          500,
          true,
          { item_id: req.item_id, error }
        );
      }

      const available = data || 0;

      // Get reserved quantity
      const { data: reservedData } = await supabase
        .from('material_reservations')
        .select('quantity_reserved, quantity_consumed, quantity_released')
        .eq('org_id', orgId)
        .eq('item_id', req.item_id)
        .eq('status', 'reserved');

      const reserved = reservedData?.reduce((sum, r) => {
        return sum + (r.quantity_reserved - (r.quantity_consumed || 0) - (r.quantity_released || 0));
      }, 0) || 0;

      // Get on-hand quantity
      const { data: stockData } = await supabase
        .from('stock_quants')
        .select('quantity')
        .eq('org_id', orgId)
        .eq('item_id', req.item_id)
        .maybeSingle();

      const on_hand = stockData?.quantity || 0;

      results.push({
        item_id: req.item_id,
        required: req.quantity,
        available,
        on_hand,
        reserved,
        sufficient: available >= req.quantity,
      });
    }

    return results;
  }

  /**
   * Reserve materials for a manufacturing order
   */
  async reserveMaterials(
    moId: string,
    materials: MaterialRequirement[],
    expiresAt?: Date
  ): Promise<MaterialReservation[]> {
    const orgId = await getEffectiveTenantId();
    if (!orgId) {
      throw new AppError('TENANT_ERROR', 'Organization ID not found', 400);
    }

    // Check availability first
    const availability = await this.checkAvailability(materials);
    const insufficient = availability.filter(a => !a.sufficient);

    if (insufficient.length > 0) {
      const item = insufficient[0];
      throw new InsufficientInventoryError(
        item.item_id,
        item.required,
        item.available,
        item.item_name
      );
    }

    // Create reservations
    const reservations: MaterialReservation[] = [];

    for (const material of materials) {
      const { data, error } = await supabase
        .from('material_reservations')
        .insert({
          org_id: orgId,
          mo_id: moId,
          item_id: material.item_id,
          quantity_reserved: material.quantity,
          status: 'reserved',
          expires_at: expiresAt?.toISOString() || null,
        })
        .select()
        .single();

      if (error) {
        throw new AppError(
          'RESERVATION_ERROR',
          `Failed to reserve material: ${error.message}`,
          500,
          true,
          { material, error }
        );
      }

      reservations.push(data as MaterialReservation);
    }

    return reservations;
  }

  /**
   * Consume reserved materials
   */
  async consumeReservedMaterials(
    moId: string,
    consumptions: MaterialConsumption[]
  ): Promise<void> {
    const orgId = await getEffectiveTenantId();
    if (!orgId) {
      throw new AppError('TENANT_ERROR', 'Organization ID not found', 400);
    }

    // Use transaction to ensure atomicity
    // Note: For now, we'll execute operations sequentially
    // In production, use database transactions via RPC functions
    for (const consumption of consumptions) {
      // Update reservation
      const { error: updateError } = await supabase
        .from('material_reservations')
        .update({
          status: 'consumed',
          quantity_consumed: consumption.quantity,
          consumed_at: new Date().toISOString(),
        })
        .eq('org_id', orgId)
        .eq('mo_id', moId)
        .eq('item_id', consumption.item_id)
        .eq('status', 'reserved');

      if (updateError) {
        throw new AppError(
          'CONSUMPTION_ERROR',
          `Failed to consume material: ${updateError.message}`,
          500,
          true,
          { consumption, error: updateError }
        );
      }

      // Create stock move
      const { error: moveError } = await supabase
        .from('stock_moves')
        .insert({
          org_id: orgId,
          item_id: consumption.item_id,
          move_type: 'manufacturing_consume',
          quantity: -consumption.quantity, // Negative for consumption
          unit_cost: consumption.unit_cost,
          reference_type: 'manufacturing_order',
          reference_id: moId,
        });

      if (moveError) {
        throw new AppError(
          'STOCK_MOVE_ERROR',
          `Failed to create stock move: ${moveError.message}`,
          500,
          true,
          { consumption, error: moveError }
        );
      }
    }
  }

  /**
   * Release reservation
   */
  async releaseReservation(
    reservationId: string,
    quantity?: number
  ): Promise<void> {
    const orgId = await getEffectiveTenantId();
    if (!orgId) {
      throw new AppError('TENANT_ERROR', 'Organization ID not found', 400);
    }

    const reservation = await supabase
      .from('material_reservations')
      .select('*')
      .eq('id', reservationId)
      .eq('org_id', orgId)
      .single();

    if (reservation.error || !reservation.data) {
      throw new AppError(
        'RESERVATION_NOT_FOUND',
        'Reservation not found',
        404
      );
    }

    const releaseQty = quantity || (reservation.data.quantity_reserved - (reservation.data.quantity_consumed || 0));

    const { error } = await supabase
      .from('material_reservations')
      .update({
        status: 'released',
        quantity_released: releaseQty,
        released_at: new Date().toISOString(),
      })
      .eq('id', reservationId)
      .eq('org_id', orgId);

    if (error) {
      throw new AppError(
        'RELEASE_ERROR',
        `Failed to release reservation: ${error.message}`,
        500,
        true,
        { reservationId, error }
      );
    }
  }

  /**
   * Release all reservations for a manufacturing order
   */
  async releaseAllReservations(moId: string): Promise<void> {
    const orgId = await getEffectiveTenantId();
    if (!orgId) {
      throw new AppError('TENANT_ERROR', 'Organization ID not found', 400);
    }

    // Get current values first, then update
    const { data: reservations } = await supabase
      .from('material_reservations')
      .select('id, quantity_reserved, quantity_consumed')
      .eq('org_id', orgId)
      .eq('mo_id', moId)
      .eq('status', 'reserved');

    if (reservations && reservations.length > 0) {
      for (const reservation of reservations) {
        const quantityReleased = (reservation.quantity_reserved || 0) - (reservation.quantity_consumed || 0);
        
        const { error } = await supabase
          .from('material_reservations')
          .update({
            status: 'released',
            quantity_released: quantityReleased,
            released_at: new Date().toISOString(),
          })
          .eq('id', reservation.id);
        
        if (error) {
          throw new AppError(
            'RELEASE_ERROR',
            `Failed to release reservation: ${error.message}`,
            500,
            true,
            { reservationId: reservation.id, error }
          );
        }
      }
    }
  }

  /**
   * Get reservations for a manufacturing order
   */
  async getReservations(moId: string): Promise<MaterialReservation[]> {
    const orgId = await getEffectiveTenantId();
    if (!orgId) {
      throw new AppError('TENANT_ERROR', 'Organization ID not found', 400);
    }

    const { data, error } = await supabase
      .from('material_reservations')
      .select('*')
      .eq('org_id', orgId)
      .eq('mo_id', moId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new AppError(
        'FETCH_ERROR',
        `Failed to fetch reservations: ${error.message}`,
        500,
        true,
        { moId, error }
      );
    }

    return (data || []) as MaterialReservation[];
  }
}

// Export singleton instance
export const inventoryTransactionService = new InventoryTransactionService();

export default inventoryTransactionService;

