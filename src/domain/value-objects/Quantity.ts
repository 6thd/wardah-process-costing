/**
 * Quantity Value Object
 * Represents quantities in manufacturing (units, hours, etc.)
 * Immutable and validates business rules
 */
export class Quantity {
  private constructor(
    public readonly value: number,
    public readonly unit: string = 'units'
  ) {
    if (value < 0) {
      throw new Error('Quantity cannot be negative');
    }
    if (!Number.isFinite(value)) {
      throw new Error('Quantity must be a finite number');
    }
  }

  static of(value: number, unit = 'units'): Quantity {
    return new Quantity(value, unit);
  }

  static zero(unit = 'units'): Quantity {
    return new Quantity(0, unit);
  }

  add(other: Quantity): Quantity {
    this.assertSameUnit(other);
    return new Quantity(this.value + other.value, this.unit);
  }

  subtract(other: Quantity): Quantity {
    this.assertSameUnit(other);
    const result = this.value - other.value;
    if (result < 0) {
      throw new Error('Subtraction would result in negative quantity');
    }
    return new Quantity(result, this.unit);
  }

  multiply(factor: number): Quantity {
    if (factor < 0) {
      throw new Error('Cannot multiply by negative factor');
    }
    return new Quantity(this.value * factor, this.unit);
  }

  divide(divisor: number): Quantity {
    if (divisor === 0) {
      throw new Error('Cannot divide by zero');
    }
    if (divisor < 0) {
      throw new Error('Cannot divide by negative divisor');
    }
    return new Quantity(this.value / divisor, this.unit);
  }

  isZero(): boolean {
    return this.value === 0;
  }

  isGreaterThan(other: Quantity): boolean {
    this.assertSameUnit(other);
    return this.value > other.value;
  }

  isLessThan(other: Quantity): boolean {
    this.assertSameUnit(other);
    return this.value < other.value;
  }

  equals(other: Quantity): boolean {
    return this.value === other.value && this.unit === other.unit;
  }

  toJSON(): { value: number; unit: string } {
    return {
      value: this.value,
      unit: this.unit,
    };
  }

  toString(): string {
    return `${this.value} ${this.unit}`;
  }

  private assertSameUnit(other: Quantity): void {
    if (this.unit !== other.unit) {
      throw new Error(
        `Cannot operate on different units: ${this.unit} and ${other.unit}`
      );
    }
  }
}
