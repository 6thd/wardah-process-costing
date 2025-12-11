/**
 * ProcessStage Entity - Domain Layer
 */

import { Money } from '../value-objects/Money';
import { Quantity } from '../value-objects/Quantity';

export enum StageStatus {
  NOT_STARTED = 'NOT_STARTED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  ON_HOLD = 'ON_HOLD'
}

export interface ProcessStageData {
  id: string;
  name: string;
  sequence: number;
  status: StageStatus;
  unitsStarted: number;
  unitsCompleted: number;
  completionPercentage: number;
  accumulatedCost: number;
  currency?: string;
}

export class ProcessStage {
  private readonly _id: string;
  private readonly _name: string;
  private readonly _sequence: number;
  private _status: StageStatus;
  private readonly _unitsStarted: Quantity;
  private readonly _unitsCompleted: Quantity;
  private readonly _completionPercentage: number;
  private readonly _accumulatedCost: Money;

  private constructor(id: string, name: string, sequence: number, status: StageStatus,
    unitsStarted: Quantity, unitsCompleted: Quantity, completionPercentage: number, accumulatedCost: Money) {
    this._id = id; this._name = name; this._sequence = sequence; this._status = status;
    this._unitsStarted = unitsStarted; this._unitsCompleted = unitsCompleted;
    this._completionPercentage = completionPercentage; this._accumulatedCost = accumulatedCost;
  }

  static create(id: string, name: string, sequence: number, unitsStarted: number = 0, currency: string = 'SAR'): ProcessStage {
    if (sequence < 1) throw new Error('Sequence must be at least 1');
    return new ProcessStage(id, name, sequence, StageStatus.NOT_STARTED, Quantity.of(unitsStarted), Quantity.of(0), 0, Money.zero(currency));
  }

  static fromRawData(data: ProcessStageData): ProcessStage {
    return new ProcessStage(data.id, data.name, data.sequence, data.status,
      Quantity.of(data.unitsStarted), Quantity.of(data.unitsCompleted),
      data.completionPercentage, Money.of(data.accumulatedCost, data.currency || 'SAR'));
  }

  get id(): string { return this._id; }
  get name(): string { return this._name; }
  get sequence(): number { return this._sequence; }
  get status(): StageStatus { return this._status; }
  get unitsStarted(): Quantity { return this._unitsStarted; }
  get unitsCompleted(): Quantity { return this._unitsCompleted; }
  get completionPercentage(): number { return this._completionPercentage; }
  get accumulatedCost(): Money { return this._accumulatedCost; }

  get unitsInProgress(): Quantity { return Quantity.of(this._unitsStarted.value - this._unitsCompleted.value); }

  get wipPercentage(): number {
    if (this._unitsStarted.isZero()) return 0;
    return (this.unitsInProgress.value / this._unitsStarted.value) * 100;
  }

  get totalWIP(): Money {
    if (this._unitsStarted.isZero()) return Money.zero(this._accumulatedCost.currency);
    const wipUnits = this.unitsInProgress.value * (this._completionPercentage / 100);
    const costPerUnit = this._accumulatedCost.amount / this._unitsStarted.value;
    return Money.of(wipUnits * costPerUnit, this._accumulatedCost.currency);
  }

  get equivalentUnits(): number {
    const wipEquivalent = this.unitsInProgress.value * (this._completionPercentage / 100);
    return this._unitsCompleted.value + wipEquivalent;
  }

  get costPerEquivalentUnit(): Money {
    const equivalent = this.equivalentUnits;
    if (equivalent === 0) return Money.zero(this._accumulatedCost.currency);
    return this._accumulatedCost.divide(equivalent);
  }

  start(): ProcessStage {
    if (this._status !== StageStatus.NOT_STARTED && this._status !== StageStatus.ON_HOLD) {
      throw new Error(+"Cannot start stage from status: "+this._status);
    }
    return new ProcessStage(this._id, this._name, this._sequence, StageStatus.IN_PROGRESS,
      this._unitsStarted, this._unitsCompleted, this._completionPercentage, this._accumulatedCost);
  }

  complete(): ProcessStage {
    if (this._status !== StageStatus.IN_PROGRESS) throw new Error(+"Cannot complete stage from status: "+this._status);
    return new ProcessStage(this._id, this._name, this._sequence, StageStatus.COMPLETED,
      this._unitsStarted, this._unitsStarted, 100, this._accumulatedCost);
  }

  putOnHold(): ProcessStage {
    if (this._status !== StageStatus.IN_PROGRESS) throw new Error(+"Cannot put on hold from status: "+this._status);
    return new ProcessStage(this._id, this._name, this._sequence, StageStatus.ON_HOLD,
      this._unitsStarted, this._unitsCompleted, this._completionPercentage, this._accumulatedCost);
  }

  resume(): ProcessStage {
    if (this._status !== StageStatus.ON_HOLD) throw new Error(+"Cannot resume from status: "+this._status);
    return new ProcessStage(this._id, this._name, this._sequence, StageStatus.IN_PROGRESS,
      this._unitsStarted, this._unitsCompleted, this._completionPercentage, this._accumulatedCost);
  }

  withUnitsStarted(units: number): ProcessStage {
    if (units < 0) throw new Error('Units cannot be negative');
    return new ProcessStage(this._id, this._name, this._sequence, this._status,
      Quantity.of(units), this._unitsCompleted, this._completionPercentage, this._accumulatedCost);
  }

  withUnitsCompleted(units: number): ProcessStage {
    if (units < 0) throw new Error('Units cannot be negative');
    if (units > this._unitsStarted.value) throw new Error('Completed units cannot exceed started units');
    return new ProcessStage(this._id, this._name, this._sequence, this._status,
      this._unitsStarted, Quantity.of(units), this._completionPercentage, this._accumulatedCost);
  }

  withCompletionPercentage(percentage: number): ProcessStage {
    if (percentage < 0 || percentage > 100) throw new Error('Completion percentage must be between 0 and 100');
    return new ProcessStage(this._id, this._name, this._sequence, this._status,
      this._unitsStarted, this._unitsCompleted, percentage, this._accumulatedCost);
  }

  withAccumulatedCost(amount: number): ProcessStage {
    return new ProcessStage(this._id, this._name, this._sequence, this._status,
      this._unitsStarted, this._unitsCompleted, this._completionPercentage, Money.of(amount, this._accumulatedCost.currency));
  }

  addCost(amount: number): ProcessStage {
    return new ProcessStage(this._id, this._name, this._sequence, this._status,
      this._unitsStarted, this._unitsCompleted, this._completionPercentage,
      this._accumulatedCost.add(Money.of(amount, this._accumulatedCost.currency)));
  }

  toJSON(): ProcessStageData {
    return { id: this._id, name: this._name, sequence: this._sequence, status: this._status,
      unitsStarted: this._unitsStarted.value, unitsCompleted: this._unitsCompleted.value,
      completionPercentage: this._completionPercentage, accumulatedCost: this._accumulatedCost.amount,
      currency: this._accumulatedCost.currency };
  }
}
