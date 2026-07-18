/**
 * Inventory Transaction Service
 *
 * Reservations remain simple RLS-scoped writes. Material consumption is routed
 * through rpc_consume_reserved_materials so reservation state, bins, product
 * aggregates, and stock ledger entries are updated in one database transaction.
 */

import { supabase as _supabase, getEffectiveTenantId } from '@/lib/supabase'
import { InsufficientInventoryError } from '@/lib/errors/InsufficientInventoryError'
import { AppError } from '@/lib/errors/AppError'

const supabase =
  _supabase as import('@supabase/supabase-js').SupabaseClient

export interface MaterialReservation {
  id: string
  org_id: string
  mo_id: string
  item_id: string
  quantity_reserved: number
  quantity_consumed: number
  quantity_released: number
  status: 'reserved' | 'consumed' | 'released' | 'expired' | 'cancelled'
  reserved_at: string
  consumed_at?: string
  released_at?: string
  expires_at?: string
  notes?: string
}

export interface MaterialRequirement {
  item_id: string
  quantity: number
  location_id?: string
  unit_cost?: number
}

export interface MaterialConsumption {
  item_id: string
  quantity: number
  quantity_reserved: number
  unit_cost: number
  location_id?: string
  warehouse_id?: string
}

export interface StockAvailability {
  item_id: string
  item_name?: string
  required: number
  available: number
  on_hand: number
  reserved: number
  sufficient: boolean
}

class InventoryTransactionService {
  private async requireOrgId(): Promise<string> {
    const orgId = await getEffectiveTenantId()
    if (!orgId) {
      throw new AppError('TENANT_ERROR', 'Organization ID not found', 400)
    }
    return orgId
  }

  async checkAvailability(
    requirements: MaterialRequirement[],
  ): Promise<StockAvailability[]> {
    const orgId = await this.requireOrgId()
    const results: StockAvailability[] = []

    for (const requirement of requirements) {
      const { data, error } = await supabase.rpc('get_available_quantity', {
        p_org_id: orgId,
        p_item_id: requirement.item_id,
        p_location_id: requirement.location_id || null,
      })
      if (error) {
        throw new AppError(
          'STOCK_CHECK_ERROR',
          `Failed to check stock for item ${requirement.item_id}: ${error.message}`,
          500,
          true,
          { item_id: requirement.item_id, error },
        )
      }

      const { data: reservations, error: reservationError } = await supabase
        .from('material_reservations')
        .select('quantity_reserved, quantity_consumed, quantity_released')
        .eq('org_id', orgId)
        .eq('item_id', requirement.item_id)
        .eq('status', 'reserved')
      if (reservationError) throw reservationError

      const reserved = (reservations || []).reduce(
        (sum, reservation) =>
          sum +
          Number(reservation.quantity_reserved || 0) -
          Number(reservation.quantity_consumed || 0) -
          Number(reservation.quantity_released || 0),
        0,
      )

      const { data: bins, error: binsError } = await supabase
        .from('bins')
        .select('actual_qty')
        .eq('org_id', orgId)
        .eq('product_id', requirement.item_id)
      if (binsError) throw binsError

      const onHand = (bins || []).reduce(
        (sum, bin) => sum + Number(bin.actual_qty || 0),
        0,
      )
      const available = Number(data ?? Math.max(onHand - reserved, 0))

      results.push({
        item_id: requirement.item_id,
        required: requirement.quantity,
        available,
        on_hand: onHand,
        reserved,
        sufficient: available >= requirement.quantity,
      })
    }

    return results
  }

  async reserveMaterials(
    moId: string,
    materials: MaterialRequirement[],
    expiresAt?: Date,
  ): Promise<MaterialReservation[]> {
    const orgId = await this.requireOrgId()
    const availability = await this.checkAvailability(materials)
    const insufficient = availability.find((item) => !item.sufficient)

    if (insufficient) {
      throw new InsufficientInventoryError(
        insufficient.item_id,
        insufficient.required,
        insufficient.available,
        insufficient.item_name,
      )
    }

    const reservations: MaterialReservation[] = []
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
        .single()

      if (error) {
        throw new AppError(
          'RESERVATION_ERROR',
          `Failed to reserve material: ${error.message}`,
          500,
          true,
          { material, error },
        )
      }
      reservations.push(data as MaterialReservation)
    }
    return reservations
  }

  async consumeReservedMaterials(
    moId: string,
    consumptions: MaterialConsumption[],
  ): Promise<void> {
    await this.requireOrgId()
    if (!consumptions.length) return

    const { data, error } = await supabase.rpc(
      'rpc_consume_reserved_materials',
      {
        p_mo_id: moId,
        p_consumptions: consumptions.map((consumption) => ({
          item_id: consumption.item_id,
          quantity: consumption.quantity,
          warehouse_id: consumption.warehouse_id,
          location_id: consumption.location_id,
        })),
      },
    )

    if (error) {
      throw new AppError(
        'CONSUMPTION_ERROR',
        `Failed to consume reserved materials: ${error.message}`,
        500,
        true,
        { moId, consumptions, error },
      )
    }

    const result = data as { success?: boolean; error?: string } | null
    if (!result?.success) {
      throw new AppError(
        'CONSUMPTION_ERROR',
        result?.error || 'Material consumption transaction failed',
        500,
        true,
        { moId, consumptions, result },
      )
    }
  }

  async releaseReservation(
    reservationId: string,
    quantity?: number,
  ): Promise<void> {
    const orgId = await this.requireOrgId()
    const { data: reservation, error: fetchError } = await supabase
      .from('material_reservations')
      .select('*')
      .eq('id', reservationId)
      .eq('org_id', orgId)
      .single()

    if (fetchError || !reservation) {
      throw new AppError('RESERVATION_NOT_FOUND', 'Reservation not found', 404)
    }

    const remaining =
      Number(reservation.quantity_reserved || 0) -
      Number(reservation.quantity_consumed || 0) -
      Number(reservation.quantity_released || 0)
    const releaseQuantity = quantity ?? remaining

    if (releaseQuantity <= 0 || releaseQuantity > remaining) {
      throw new AppError(
        'INVALID_RELEASE_QUANTITY',
        'Release quantity must be positive and no greater than the remaining reservation',
        400,
      )
    }

    const newReleased =
      Number(reservation.quantity_released || 0) + releaseQuantity
    const fullyClosed =
      newReleased + Number(reservation.quantity_consumed || 0) >=
      Number(reservation.quantity_reserved || 0)

    const { error } = await supabase
      .from('material_reservations')
      .update({
        status: fullyClosed ? 'released' : 'reserved',
        quantity_released: newReleased,
        released_at: new Date().toISOString(),
      })
      .eq('id', reservationId)
      .eq('org_id', orgId)

    if (error) {
      throw new AppError(
        'RELEASE_ERROR',
        `Failed to release reservation: ${error.message}`,
        500,
        true,
        { reservationId, error },
      )
    }
  }

  async releaseAllReservations(moId: string): Promise<void> {
    const orgId = await this.requireOrgId()
    const { data: reservations, error: fetchError } = await supabase
      .from('material_reservations')
      .select('id, quantity_reserved, quantity_consumed, quantity_released')
      .eq('org_id', orgId)
      .eq('mo_id', moId)
      .eq('status', 'reserved')
    if (fetchError) throw fetchError

    for (const reservation of reservations || []) {
      const remaining =
        Number(reservation.quantity_reserved || 0) -
        Number(reservation.quantity_consumed || 0) -
        Number(reservation.quantity_released || 0)
      if (remaining > 0) await this.releaseReservation(reservation.id, remaining)
    }
  }

  async getReservations(moId: string): Promise<MaterialReservation[]> {
    const orgId = await this.requireOrgId()
    const { data, error } = await supabase
      .from('material_reservations')
      .select('*')
      .eq('org_id', orgId)
      .eq('mo_id', moId)
      .order('created_at', { ascending: true })

    if (error) {
      throw new AppError(
        'FETCH_ERROR',
        `Failed to fetch reservations: ${error.message}`,
        500,
        true,
        { moId, error },
      )
    }
    return (data || []) as MaterialReservation[]
  }
}

export const inventoryTransactionService = new InventoryTransactionService()
export default inventoryTransactionService
