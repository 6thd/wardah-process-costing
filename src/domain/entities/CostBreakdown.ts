/**
 * CostBreakdown Entity - Domain Layer
 */

import { Money } from '../value-objects/Money';
import { Quantity } from '../value-objects/Quantity';

export interface CostBreakdownData {
  materialCost: number;
  laborCost: number;
  overheadCost: number;
  quantity: number;
  currency?: string;
}

export class CostBreakdown {
  private readonly _materialCost: Money;
  private readonly _laborCost: Money;
  private readonly _overheadCost: Money;
  private readonly _quantity: Quantity;

  private constructor(
    materialCost: Money,
    laborCost: Money,
    overheadCost: Money,
    quantity: Quantity
  ) {
    this._materialCost = materialCost;
    this._laborCost = laborCost;
    this._overheadCost = overheadCost;
    this._quantity = quantity;
  }

  static create(
    materialCost: number,
    laborCost: number,
    overheadCost: number,
    quantity: number,
    currency: string = 'SAR'
  ): CostBreakdown {
    if (quantity <= 0) {
      throw new Error('Quantity must be positive');
    }
    return new CostBreakdown(
      Money.of(materialCost, currency),
      Money.of(laborCost, currency),
      Money.of(overheadCost, currency),
      Quantity.of(quantity)
    );
  }

  static fromRawData(data: CostBreakdownData): CostBreakdown {
    return CostBreakdown.create(
      data.materialCost,
      data.laborCost,
      data.overheadCost,
      data.quantity,
      data.currency
    );
  }

  static zero(currency: string = 'SAR'): CostBreakdown {
    return new CostBreakdown(
      Money.zero(currency),
      Money.zero(currency),
      Money.zero(currency),
      Quantity.of(1)
    );
  }

  get materialCost(): Money { return this._materialCost; }
  get laborCost(): Money { return this._laborCost; }
  get overheadCost(): Money { return this._overheadCost; }
  get quantity(): Quantity { return this._quantity; }

  get totalCost(): Money {
    return this._materialCost.add(this._laborCost).add(this._overheadCost);
  }

  costPerUnit(): Money {
    if (this._quantity.isZero()) return Money.zero(this._materialCost.currency);
    return this.totalCost.divide(this._quantity.value);
  }

  materialPercentage(): number {
    const total = this.totalCost.amount;
    if (total === 0) return 0;
    return (this._materialCost.amount / total) * 100;
  }

  laborPercentage(): number {
    const total = this.totalCost.amount;
    if (total === 0) return 0;
    return (this._laborCost.amount / total) * 100;
  }

  overheadPercentage(): number {
    const total = this.totalCost.amount;
    if (total === 0) return 0;
    return (this._overheadCost.amount / total) * 100;
  }

  varianceFrom(other: CostBreakdown): CostBreakdown {
    return new CostBreakdown(
      this._materialCost.subtract(other._materialCost),
      this._laborCost.subtract(other._laborCost),
      this._overheadCost.subtract(other._overheadCost),
      this._quantity
    );
  }

  percentageVarianceFrom(other: CostBreakdown): { material: number; labor: number; overhead: number; total: number } {
    const safePercentage = (current: number, base: number): number => {
      if (base === 0) return current === 0 ? 0 : 100;
      return ((current - base) / base) * 100;
    };
    return {
      material: safePercentage(this._materialCost.amount, other._materialCost.amount),
      labor: safePercentage(this._laborCost.amount, other._laborCost.amount),
      overhead: safePercentage(this._overheadCost.amount, other._overheadCost.amount),
      total: safePercentage(this.totalCost.amount, other.totalCost.amount)
    };
  }

  withMaterialCost(amount: number): CostBreakdown {
    return new CostBreakdown(Money.of(amount, this._materialCost.currency), this._laborCost, this._overheadCost, this._quantity);
  }

  withLaborCost(amount: number): CostBreakdown {
    return new CostBreakdown(this._materialCost, Money.of(amount, this._laborCost.currency), this._overheadCost, this._quantity);
  }

  withOverheadCost(amount: number): CostBreakdown {
    return new CostBreakdown(this._materialCost, this._laborCost, Money.of(amount, this._overheadCost.currency), this._quantity);
  }

  withQuantity(value: number): CostBreakdown {
    if (value <= 0) throw new Error('Quantity must be positive');
    return new CostBreakdown(this._materialCost, this._laborCost, this._overheadCost, Quantity.of(value));
  }

  add(other: CostBreakdown): CostBreakdown {
    return new CostBreakdown(
      this._materialCost.add(other._materialCost),
      this._laborCost.add(other._laborCost),
      this._overheadCost.add(other._overheadCost),
      Quantity.of(this._quantity.value + other._quantity.value)
    );
  }

  scale(factor: number): CostBreakdown {
    if (factor < 0) throw new Error('Scale factor cannot be negative');
    return new CostBreakdown(
      this._materialCost.multiply(factor),
      this._laborCost.multiply(factor),
      this._overheadCost.multiply(factor),
      this._quantity
    );
  }

  equals(other: CostBreakdown): boolean {
    return (
      this._materialCost.equals(other._materialCost) &&
      this._laborCost.equals(other._laborCost) &&
      this._overheadCost.equals(other._overheadCost) &&
      this._quantity.value === other._quantity.value
    );
  }

  toJSON(): CostBreakdownData {
    return {
      materialCost: this._materialCost.amount,
      laborCost: this._laborCost.amount,
      overheadCost: this._overheadCost.amount,
      quantity: this._quantity.value,
      currency: this._materialCost.currency
    };
  }
}
