/**
 * Inventory Data Validator
 * 
 * Validates inventory data integrity
 */

import { supabase } from '@/lib/supabase';
import { getEffectiveTenantId } from '@/lib/supabase';
import { AppError } from '@/lib/errors/AppError';

/**
 * Validation result
 */
export interface InventoryValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  issues: Array<{
    type: 'negative_stock' | 'mismatch' | 'orphaned' | 'duplicate';
    item_id: string;
    location_id?: string;
    message: string;
    details?: Record<string, any>;
  }>;
}

/**
 * Inventory Data Validator
 */
class InventoryValidator {
  /**
   * Validate stock quantities are not negative
   */
  async validateStockQuantities(): Promise<InventoryValidationResult> {
    const orgId = await getEffectiveTenantId();
    if (!orgId) {
      throw new AppError('TENANT_ERROR', 'Organization ID not found', 400);
    }

    const result: InventoryValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
      issues: [],
    };

    try {
      // Check for negative stock
      const { data, error } = await supabase
        .from('stock_quants')
        .select('id, item_id, location_id, quantity')
        .eq('org_id', orgId)
        .lt('quantity', 0);

      if (error) {
        result.errors.push(`Failed to validate stock: ${error.message}`);
        result.valid = false;
        return result;
      }

      if (data && data.length > 0) {
        result.valid = false;
        result.errors.push(`Found ${data.length} items with negative stock`);

        data.forEach(item => {
          result.issues.push({
            type: 'negative_stock',
            item_id: item.item_id,
            location_id: item.location_id,
            message: `Negative stock: ${item.quantity}`,
            details: { quantity: item.quantity },
          });
        });
      }
    } catch (error) {
      result.errors.push(
        `Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      result.valid = false;
    }

    return result;
  }

  /**
   * Validate stock moves balance
   */
  async validateStockMovesBalance(): Promise<InventoryValidationResult> {
    const orgId = await getEffectiveTenantId();
    if (!orgId) {
      throw new AppError('TENANT_ERROR', 'Organization ID not found', 400);
    }

    const result: InventoryValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
      issues: [],
    };

    try {
      // Get stock moves summary by item
      const { data, error } = await supabase.rpc('validate_stock_balance', {
        p_org_id: orgId,
      });

      if (error) {
        result.warnings.push(`Could not validate stock balance: ${error.message}`);
        return result;
      }

      if (data && data.length > 0) {
        // Check for mismatches
        const mismatches = data.filter((item: any) => {
          const calculated = item.calculated_quantity || 0;
          const actual = item.actual_quantity || 0;
          return Math.abs(calculated - actual) > 0.01; // Allow small floating point differences
        });

        if (mismatches.length > 0) {
          result.valid = false;
          result.errors.push(
            `Found ${mismatches.length} items with stock balance mismatches`
          );

          mismatches.forEach((item: any) => {
            result.issues.push({
              type: 'mismatch',
              item_id: item.item_id,
              message: `Stock mismatch: Calculated ${item.calculated_quantity}, Actual ${item.actual_quantity}`,
              details: {
                calculated: item.calculated_quantity,
                actual: item.actual_quantity,
                difference: item.calculated_quantity - item.actual_quantity,
              },
            });
          });
        }
      }
    } catch (error) {
      result.warnings.push(
        `Balance validation error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    return result;
  }

  /**
   * Validate material reservations
   */
  async validateReservations(): Promise<InventoryValidationResult> {
    const orgId = await getEffectiveTenantId();
    if (!orgId) {
      throw new AppError('TENANT_ERROR', 'Organization ID not found', 400);
    }

    const result: InventoryValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
      issues: [],
    };

    try {
      // Check for reservations that exceed available stock
      const { data, error } = await supabase.rpc('validate_reservations', {
        p_org_id: orgId,
      });

      if (error) {
        result.warnings.push(`Could not validate reservations: ${error.message}`);
        return result;
      }

      if (data && data.length > 0) {
        const invalid = data.filter((r: any) => r.available < r.reserved);

        if (invalid.length > 0) {
          result.valid = false;
          result.errors.push(
            `Found ${invalid.length} reservations exceeding available stock`
          );

          invalid.forEach((reservation: any) => {
            result.issues.push({
              type: 'mismatch',
              item_id: reservation.item_id,
              message: `Reservation exceeds stock: Reserved ${reservation.reserved}, Available ${reservation.available}`,
              details: {
                reserved: reservation.reserved,
                available: reservation.available,
                mo_id: reservation.mo_id,
              },
            });
          });
        }
      }
    } catch (error) {
      result.warnings.push(
        `Reservation validation error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    return result;
  }

  /**
   * Run all inventory validations
   */
  async validateAll(): Promise<InventoryValidationResult> {
    const stockResult = await this.validateStockQuantities();
    const balanceResult = await this.validateStockMovesBalance();
    const reservationResult = await this.validateReservations();

    // Combine all results
    return {
      valid: stockResult.valid && balanceResult.valid && reservationResult.valid,
      errors: [
        ...stockResult.errors,
        ...balanceResult.errors,
        ...reservationResult.errors,
      ],
      warnings: [
        ...stockResult.warnings,
        ...balanceResult.warnings,
        ...reservationResult.warnings,
      ],
      issues: [
        ...stockResult.issues,
        ...balanceResult.issues,
        ...reservationResult.issues,
      ],
    };
  }
}

// Export singleton instance
export const inventoryValidator = new InventoryValidator();

export default inventoryValidator;

