/**
 * HourlyRate Value Object
 * Represents labor hourly rates
 * Immutable and validates business rules
 */
import { Money } from './Money';

export class HourlyRate {
  private constructor(public readonly rate: Money) {
    if (rate.isZero()) {
      throw new Error('Hourly rate cannot be zero');
    }
  }

  static of(amount: number, currency = 'SAR'): HourlyRate {
    return new HourlyRate(Money.of(amount, currency));
  }

  calculateCost(hours: number): Money {
    if (hours < 0) {
      throw new Error('Hours cannot be negative');
    }
    return this.rate.multiply(hours);
  }

  equals(other: HourlyRate): boolean {
    return this.rate.equals(other.rate);
  }

  toJSON(): { amount: number; currency: string } {
    return this.rate.toJSON();
  }

  toString(): string {
    return `${this.rate.toString()}/hour`;
  }
}
