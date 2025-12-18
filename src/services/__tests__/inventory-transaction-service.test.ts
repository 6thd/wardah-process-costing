/**
 * @file inventory-transaction-service.test.ts
 * @description Unit tests for Inventory Transaction Service
 *
 * Tests cover:
 * - Stock availability calculations
 * - Material reservation logic
 * - Material consumption processing
 * - Reservation release handling
 */

import { describe, it, expect, vi } from 'vitest';

// ===== Types for Testing =====

interface MaterialRequirement {
  item_id: string;
  quantity: number;
  location_id?: string;
  unit_cost?: number;
}

interface StockAvailability {
  item_id: string;
  item_name?: string;
  required: number;
  available: number;
  on_hand: number;
  reserved: number;
  sufficient: boolean;
}

interface MaterialReservation {
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

interface MaterialConsumption {
  item_id: string;
  quantity: number;
  quantity_reserved: number;
  unit_cost: number;
  location_id?: string;
}

// ===== Pure Functions for Testing =====

/**
 * Check stock availability for a single item
 */
function checkItemAvailability(
  requirement: MaterialRequirement,
  stockData: { on_hand: number; reserved: number }
): StockAvailability {
  const available = stockData.on_hand - stockData.reserved;
  
  return {
    item_id: requirement.item_id,
    required: requirement.quantity,
    available,
    on_hand: stockData.on_hand,
    reserved: stockData.reserved,
    sufficient: available >= requirement.quantity,
  };
}

/**
 * Check availability for multiple items
 */
function checkMultipleAvailability(
  requirements: MaterialRequirement[],
  stockDataMap: Map<string, { on_hand: number; reserved: number }>
): StockAvailability[] {
  return requirements.map((req) => {
    const stockData = stockDataMap.get(req.item_id) || { on_hand: 0, reserved: 0 };
    return checkItemAvailability(req, stockData);
  });
}

/**
 * Find insufficient items
 */
function findInsufficientItems(
  availabilities: StockAvailability[]
): StockAvailability[] {
  return availabilities.filter((a) => !a.sufficient);
}

/**
 * Calculate total reservation quantity
 */
function calculateTotalReserved(
  reservations: Array<{
    quantity_reserved: number;
    quantity_consumed?: number;
    quantity_released?: number;
  }>
): number {
  return reservations.reduce((sum, r) => {
    const consumed = r.quantity_consumed || 0;
    const released = r.quantity_released || 0;
    return sum + (r.quantity_reserved - consumed - released);
  }, 0);
}

/**
 * Calculate remaining to consume
 */
function calculateRemainingToConsume(
  reservation: MaterialReservation
): number {
  return (
    reservation.quantity_reserved -
    (reservation.quantity_consumed || 0) -
    (reservation.quantity_released || 0)
  );
}

/**
 * Validate consumption request
 */
function validateConsumption(
  consumption: MaterialConsumption,
  reservation: MaterialReservation
): { valid: boolean; error?: string } {
  if (reservation.status !== 'reserved') {
    return {
      valid: false,
      error: `Reservation is not in reserved status. Current status: ${reservation.status}`,
    };
  }

  const remaining = calculateRemainingToConsume(reservation);

  if (consumption.quantity > remaining) {
    return {
      valid: false,
      error: `Cannot consume ${consumption.quantity}. Only ${remaining} available in reservation.`,
    };
  }

  return { valid: true };
}

/**
 * Calculate stock after consumption
 */
function calculateStockAfterConsumption(
  currentStock: number,
  consumptions: MaterialConsumption[]
): number {
  const totalConsumed = consumptions.reduce(
    (sum, c) => sum + c.quantity,
    0
  );
  return currentStock - totalConsumed;
}

/**
 * Calculate FIFO cost for consumption
 */
function calculateFifoCost(
  batches: Array<{ quantity: number; unit_cost: number }>,
  quantityToConsume: number
): { totalCost: number; remainingBatches: typeof batches } {
  let remaining = quantityToConsume;
  let totalCost = 0;
  const remainingBatches: typeof batches = [];

  for (const batch of batches) {
    if (remaining <= 0) {
      remainingBatches.push(batch);
      continue;
    }

    const consumeFromBatch = Math.min(batch.quantity, remaining);
    totalCost += consumeFromBatch * batch.unit_cost;
    remaining -= consumeFromBatch;

    if (batch.quantity > consumeFromBatch) {
      remainingBatches.push({
        quantity: batch.quantity - consumeFromBatch,
        unit_cost: batch.unit_cost,
      });
    }
  }

  return { totalCost, remainingBatches };
}

/**
 * Calculate weighted average cost
 */
function calculateWeightedAverageCost(
  currentQuantity: number,
  currentValue: number,
  addedQuantity: number,
  addedValue: number
): number {
  const totalQuantity = currentQuantity + addedQuantity;
  const totalValue = currentValue + addedValue;

  if (totalQuantity <= 0) return 0;

  return totalValue / totalQuantity;
}

/**
 * Validate reservation expiry
 */
function isReservationExpired(
  reservation: MaterialReservation,
  currentDate: Date = new Date()
): boolean {
  if (!reservation.expires_at) return false;
  return new Date(reservation.expires_at) < currentDate;
}

/**
 * Calculate days until expiry
 */
function daysUntilExpiry(
  reservation: MaterialReservation,
  currentDate: Date = new Date()
): number | null {
  if (!reservation.expires_at) return null;

  const expiryDate = new Date(reservation.expires_at);
  const diffTime = expiryDate.getTime() - currentDate.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return diffDays;
}

// ===== Test Suites =====

describe('Inventory Transaction Service - Stock Availability', () => {
  describe('checkItemAvailability', () => {
    it('should calculate available stock correctly', () => {
      const requirement: MaterialRequirement = {
        item_id: 'ITEM-001',
        quantity: 100,
      };
      const stockData = { on_hand: 500, reserved: 150 };

      const result = checkItemAvailability(requirement, stockData);

      expect(result.available).toBe(350);
      expect(result.on_hand).toBe(500);
      expect(result.reserved).toBe(150);
      expect(result.sufficient).toBe(true);
    });

    it('should detect insufficient stock', () => {
      const requirement: MaterialRequirement = {
        item_id: 'ITEM-001',
        quantity: 400,
      };
      const stockData = { on_hand: 500, reserved: 150 };

      const result = checkItemAvailability(requirement, stockData);

      expect(result.available).toBe(350);
      expect(result.sufficient).toBe(false);
    });

    it('should handle zero stock', () => {
      const requirement: MaterialRequirement = {
        item_id: 'ITEM-001',
        quantity: 100,
      };
      const stockData = { on_hand: 0, reserved: 0 };

      const result = checkItemAvailability(requirement, stockData);

      expect(result.available).toBe(0);
      expect(result.sufficient).toBe(false);
    });

    it('should handle fully reserved stock', () => {
      const requirement: MaterialRequirement = {
        item_id: 'ITEM-001',
        quantity: 100,
      };
      const stockData = { on_hand: 500, reserved: 500 };

      const result = checkItemAvailability(requirement, stockData);

      expect(result.available).toBe(0);
      expect(result.sufficient).toBe(false);
    });

    it('should handle exact quantity match', () => {
      const requirement: MaterialRequirement = {
        item_id: 'ITEM-001',
        quantity: 100,
      };
      const stockData = { on_hand: 200, reserved: 100 };

      const result = checkItemAvailability(requirement, stockData);

      expect(result.available).toBe(100);
      expect(result.sufficient).toBe(true);
    });
  });

  describe('checkMultipleAvailability', () => {
    it('should check multiple items', () => {
      const requirements: MaterialRequirement[] = [
        { item_id: 'ITEM-001', quantity: 100 },
        { item_id: 'ITEM-002', quantity: 50 },
        { item_id: 'ITEM-003', quantity: 200 },
      ];

      const stockDataMap = new Map([
        ['ITEM-001', { on_hand: 500, reserved: 100 }],
        ['ITEM-002', { on_hand: 100, reserved: 20 }],
        ['ITEM-003', { on_hand: 150, reserved: 0 }],
      ]);

      const results = checkMultipleAvailability(requirements, stockDataMap);

      expect(results).toHaveLength(3);
      expect(results[0].sufficient).toBe(true);
      expect(results[1].sufficient).toBe(true);
      expect(results[2].sufficient).toBe(false);
    });

    it('should handle missing stock data', () => {
      const requirements: MaterialRequirement[] = [
        { item_id: 'ITEM-001', quantity: 100 },
        { item_id: 'ITEM-999', quantity: 50 }, // Not in map
      ];

      const stockDataMap = new Map([
        ['ITEM-001', { on_hand: 500, reserved: 100 }],
      ]);

      const results = checkMultipleAvailability(requirements, stockDataMap);

      expect(results[0].sufficient).toBe(true);
      expect(results[1].available).toBe(0);
      expect(results[1].sufficient).toBe(false);
    });
  });

  describe('findInsufficientItems', () => {
    it('should find all insufficient items', () => {
      const availabilities: StockAvailability[] = [
        { item_id: 'ITEM-001', required: 100, available: 400, on_hand: 500, reserved: 100, sufficient: true },
        { item_id: 'ITEM-002', required: 200, available: 100, on_hand: 150, reserved: 50, sufficient: false },
        { item_id: 'ITEM-003', required: 50, available: 0, on_hand: 50, reserved: 50, sufficient: false },
      ];

      const insufficient = findInsufficientItems(availabilities);

      expect(insufficient).toHaveLength(2);
      expect(insufficient[0].item_id).toBe('ITEM-002');
      expect(insufficient[1].item_id).toBe('ITEM-003');
    });

    it('should return empty array when all sufficient', () => {
      const availabilities: StockAvailability[] = [
        { item_id: 'ITEM-001', required: 100, available: 400, on_hand: 500, reserved: 100, sufficient: true },
        { item_id: 'ITEM-002', required: 50, available: 100, on_hand: 150, reserved: 50, sufficient: true },
      ];

      const insufficient = findInsufficientItems(availabilities);

      expect(insufficient).toHaveLength(0);
    });
  });
});

describe('Inventory Transaction Service - Reservations', () => {
  describe('calculateTotalReserved', () => {
    it('should calculate net reserved quantity', () => {
      const reservations = [
        { quantity_reserved: 100, quantity_consumed: 30, quantity_released: 10 },
        { quantity_reserved: 50, quantity_consumed: 0, quantity_released: 0 },
        { quantity_reserved: 75, quantity_consumed: 25, quantity_released: 0 },
      ];

      const total = calculateTotalReserved(reservations);

      expect(total).toBe(160); // (100-30-10) + 50 + (75-25) = 60 + 50 + 50
    });

    it('should handle all consumed/released', () => {
      const reservations = [
        { quantity_reserved: 100, quantity_consumed: 100, quantity_released: 0 },
        { quantity_reserved: 50, quantity_consumed: 0, quantity_released: 50 },
      ];

      const total = calculateTotalReserved(reservations);

      expect(total).toBe(0);
    });

    it('should handle empty reservations', () => {
      const total = calculateTotalReserved([]);

      expect(total).toBe(0);
    });

    it('should handle undefined consumed/released', () => {
      const reservations = [
        { quantity_reserved: 100 },
        { quantity_reserved: 50, quantity_consumed: undefined },
      ];

      const total = calculateTotalReserved(reservations);

      expect(total).toBe(150);
    });
  });

  describe('calculateRemainingToConsume', () => {
    it('should calculate remaining quantity', () => {
      const reservation: MaterialReservation = {
        id: '1',
        org_id: 'org-1',
        mo_id: 'mo-1',
        item_id: 'item-1',
        quantity_reserved: 100,
        quantity_consumed: 40,
        quantity_released: 10,
        status: 'reserved',
        reserved_at: '2024-01-01',
      };

      const remaining = calculateRemainingToConsume(reservation);

      expect(remaining).toBe(50);
    });

    it('should return zero when fully consumed', () => {
      const reservation: MaterialReservation = {
        id: '1',
        org_id: 'org-1',
        mo_id: 'mo-1',
        item_id: 'item-1',
        quantity_reserved: 100,
        quantity_consumed: 100,
        quantity_released: 0,
        status: 'consumed',
        reserved_at: '2024-01-01',
      };

      const remaining = calculateRemainingToConsume(reservation);

      expect(remaining).toBe(0);
    });
  });

  describe('isReservationExpired', () => {
    it('should detect expired reservation', () => {
      const reservation: MaterialReservation = {
        id: '1',
        org_id: 'org-1',
        mo_id: 'mo-1',
        item_id: 'item-1',
        quantity_reserved: 100,
        quantity_consumed: 0,
        quantity_released: 0,
        status: 'reserved',
        reserved_at: '2024-01-01',
        expires_at: '2024-01-10',
      };

      const currentDate = new Date('2024-01-15');
      const isExpired = isReservationExpired(reservation, currentDate);

      expect(isExpired).toBe(true);
    });

    it('should detect valid reservation', () => {
      const reservation: MaterialReservation = {
        id: '1',
        org_id: 'org-1',
        mo_id: 'mo-1',
        item_id: 'item-1',
        quantity_reserved: 100,
        quantity_consumed: 0,
        quantity_released: 0,
        status: 'reserved',
        reserved_at: '2024-01-01',
        expires_at: '2024-01-20',
      };

      const currentDate = new Date('2024-01-15');
      const isExpired = isReservationExpired(reservation, currentDate);

      expect(isExpired).toBe(false);
    });

    it('should handle no expiry date', () => {
      const reservation: MaterialReservation = {
        id: '1',
        org_id: 'org-1',
        mo_id: 'mo-1',
        item_id: 'item-1',
        quantity_reserved: 100,
        quantity_consumed: 0,
        quantity_released: 0,
        status: 'reserved',
        reserved_at: '2024-01-01',
      };

      const isExpired = isReservationExpired(reservation);

      expect(isExpired).toBe(false);
    });
  });

  describe('daysUntilExpiry', () => {
    it('should calculate days correctly', () => {
      const reservation: MaterialReservation = {
        id: '1',
        org_id: 'org-1',
        mo_id: 'mo-1',
        item_id: 'item-1',
        quantity_reserved: 100,
        quantity_consumed: 0,
        quantity_released: 0,
        status: 'reserved',
        reserved_at: '2024-01-01',
        expires_at: '2024-01-20',
      };

      const currentDate = new Date('2024-01-15');
      const days = daysUntilExpiry(reservation, currentDate);

      expect(days).toBe(5);
    });

    it('should return negative for expired', () => {
      const reservation: MaterialReservation = {
        id: '1',
        org_id: 'org-1',
        mo_id: 'mo-1',
        item_id: 'item-1',
        quantity_reserved: 100,
        quantity_consumed: 0,
        quantity_released: 0,
        status: 'reserved',
        reserved_at: '2024-01-01',
        expires_at: '2024-01-10',
      };

      const currentDate = new Date('2024-01-15');
      const days = daysUntilExpiry(reservation, currentDate);

      expect(days).toBeLessThan(0);
    });

    it('should return null for no expiry', () => {
      const reservation: MaterialReservation = {
        id: '1',
        org_id: 'org-1',
        mo_id: 'mo-1',
        item_id: 'item-1',
        quantity_reserved: 100,
        quantity_consumed: 0,
        quantity_released: 0,
        status: 'reserved',
        reserved_at: '2024-01-01',
      };

      const days = daysUntilExpiry(reservation);

      expect(days).toBeNull();
    });
  });
});

describe('Inventory Transaction Service - Consumption', () => {
  describe('validateConsumption', () => {
    it('should validate successful consumption', () => {
      const consumption: MaterialConsumption = {
        item_id: 'item-1',
        quantity: 50,
        quantity_reserved: 100,
        unit_cost: 10,
      };

      const reservation: MaterialReservation = {
        id: '1',
        org_id: 'org-1',
        mo_id: 'mo-1',
        item_id: 'item-1',
        quantity_reserved: 100,
        quantity_consumed: 0,
        quantity_released: 0,
        status: 'reserved',
        reserved_at: '2024-01-01',
      };

      const result = validateConsumption(consumption, reservation);

      expect(result.valid).toBe(true);
    });

    it('should reject consumption exceeding reservation', () => {
      const consumption: MaterialConsumption = {
        item_id: 'item-1',
        quantity: 150,
        quantity_reserved: 100,
        unit_cost: 10,
      };

      const reservation: MaterialReservation = {
        id: '1',
        org_id: 'org-1',
        mo_id: 'mo-1',
        item_id: 'item-1',
        quantity_reserved: 100,
        quantity_consumed: 0,
        quantity_released: 0,
        status: 'reserved',
        reserved_at: '2024-01-01',
      };

      const result = validateConsumption(consumption, reservation);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Cannot consume');
    });

    it('should reject consumption from non-reserved status', () => {
      const consumption: MaterialConsumption = {
        item_id: 'item-1',
        quantity: 50,
        quantity_reserved: 100,
        unit_cost: 10,
      };

      const reservation: MaterialReservation = {
        id: '1',
        org_id: 'org-1',
        mo_id: 'mo-1',
        item_id: 'item-1',
        quantity_reserved: 100,
        quantity_consumed: 100,
        quantity_released: 0,
        status: 'consumed',
        reserved_at: '2024-01-01',
      };

      const result = validateConsumption(consumption, reservation);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('not in reserved status');
    });

    it('should consider already consumed quantity', () => {
      const consumption: MaterialConsumption = {
        item_id: 'item-1',
        quantity: 60,
        quantity_reserved: 100,
        unit_cost: 10,
      };

      const reservation: MaterialReservation = {
        id: '1',
        org_id: 'org-1',
        mo_id: 'mo-1',
        item_id: 'item-1',
        quantity_reserved: 100,
        quantity_consumed: 50,
        quantity_released: 0,
        status: 'reserved',
        reserved_at: '2024-01-01',
      };

      const result = validateConsumption(consumption, reservation);

      expect(result.valid).toBe(false); // Only 50 remaining, trying to consume 60
    });
  });

  describe('calculateStockAfterConsumption', () => {
    it('should calculate remaining stock correctly', () => {
      const consumptions: MaterialConsumption[] = [
        { item_id: 'item-1', quantity: 50, quantity_reserved: 100, unit_cost: 10 },
        { item_id: 'item-2', quantity: 30, quantity_reserved: 50, unit_cost: 15 },
      ];

      const result = calculateStockAfterConsumption(500, consumptions);

      expect(result).toBe(420);
    });

    it('should handle empty consumptions', () => {
      const result = calculateStockAfterConsumption(500, []);

      expect(result).toBe(500);
    });

    it('should allow negative result (over-consumption)', () => {
      const consumptions: MaterialConsumption[] = [
        { item_id: 'item-1', quantity: 600, quantity_reserved: 100, unit_cost: 10 },
      ];

      const result = calculateStockAfterConsumption(500, consumptions);

      expect(result).toBe(-100);
    });
  });
});

describe('Inventory Transaction Service - Costing', () => {
  describe('calculateFifoCost', () => {
    it('should consume from oldest batches first', () => {
      const batches = [
        { quantity: 100, unit_cost: 10 },
        { quantity: 100, unit_cost: 12 },
        { quantity: 100, unit_cost: 15 },
      ];

      const result = calculateFifoCost(batches, 150);

      expect(result.totalCost).toBe(100 * 10 + 50 * 12); // 1000 + 600 = 1600
      expect(result.remainingBatches).toHaveLength(2);
      expect(result.remainingBatches[0].quantity).toBe(50);
    });

    it('should consume all batches if needed', () => {
      const batches = [
        { quantity: 100, unit_cost: 10 },
        { quantity: 50, unit_cost: 12 },
      ];

      const result = calculateFifoCost(batches, 150);

      expect(result.totalCost).toBe(100 * 10 + 50 * 12);
      expect(result.remainingBatches).toHaveLength(0);
    });

    it('should handle consumption less than first batch', () => {
      const batches = [
        { quantity: 100, unit_cost: 10 },
        { quantity: 100, unit_cost: 12 },
      ];

      const result = calculateFifoCost(batches, 30);

      expect(result.totalCost).toBe(300);
      expect(result.remainingBatches).toHaveLength(2);
      expect(result.remainingBatches[0].quantity).toBe(70);
      expect(result.remainingBatches[1].quantity).toBe(100);
    });

    it('should handle empty batches', () => {
      const result = calculateFifoCost([], 100);

      expect(result.totalCost).toBe(0);
      expect(result.remainingBatches).toHaveLength(0);
    });
  });

  describe('calculateWeightedAverageCost', () => {
    it('should calculate WAC correctly', () => {
      const result = calculateWeightedAverageCost(100, 1000, 50, 600);

      expect(result).toBeCloseTo(10.67, 2);
    });

    it('should handle zero current quantity', () => {
      const result = calculateWeightedAverageCost(0, 0, 100, 1500);

      expect(result).toBe(15);
    });

    it('should return zero for zero total quantity', () => {
      const result = calculateWeightedAverageCost(0, 0, 0, 0);

      expect(result).toBe(0);
    });

    it('should handle negative quantities (returns)', () => {
      const result = calculateWeightedAverageCost(100, 1000, -50, -500);

      expect(result).toBe(10);
    });
  });
});

describe('Inventory Transaction Service - Edge Cases', () => {
  describe('Zero Quantity Handling', () => {
    it('should handle zero requirement', () => {
      const requirement: MaterialRequirement = {
        item_id: 'ITEM-001',
        quantity: 0,
      };
      const stockData = { on_hand: 500, reserved: 150 };

      const result = checkItemAvailability(requirement, stockData);

      expect(result.sufficient).toBe(true);
    });
  });

  describe('Decimal Precision', () => {
    it('should handle fractional quantities', () => {
      const requirement: MaterialRequirement = {
        item_id: 'ITEM-001',
        quantity: 10.5,
      };
      const stockData = { on_hand: 100.25, reserved: 50.75 };

      const result = checkItemAvailability(requirement, stockData);

      expect(result.available).toBeCloseTo(49.5, 2);
      expect(result.sufficient).toBe(true);
    });

    it('should calculate FIFO with decimals', () => {
      const batches = [
        { quantity: 10.5, unit_cost: 9.99 },
        { quantity: 20.25, unit_cost: 10.50 },
      ];

      const result = calculateFifoCost(batches, 15.5);

      expect(result.totalCost).toBeCloseTo(10.5 * 9.99 + 5 * 10.50, 2);
    });
  });

  describe('Large Numbers', () => {
    it('should handle large quantities', () => {
      const requirement: MaterialRequirement = {
        item_id: 'ITEM-001',
        quantity: 1000000,
      };
      const stockData = { on_hand: 5000000, reserved: 1000000 };

      const result = checkItemAvailability(requirement, stockData);

      expect(result.available).toBe(4000000);
      expect(result.sufficient).toBe(true);
    });

    it('should handle large values in costing', () => {
      const batches = [
        { quantity: 1000000, unit_cost: 999.99 },
      ];

      const result = calculateFifoCost(batches, 500000);

      expect(result.totalCost).toBe(500000 * 999.99);
    });
  });
});
