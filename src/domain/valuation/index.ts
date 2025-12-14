/**
 * Domain Valuation Module - Exports
 * 
 * Clean Architecture: Pure domain logic for inventory valuation.
 * No external dependencies.
 */

export {
  FIFOValuationStrategy,
  LIFOValuationStrategy,
  WeightedAverageValuationStrategy,
  MovingAverageValuationStrategy,
  ValuationStrategyFactory,
  valuationStrategyFactory
} from './ValuationStrategies';

// Re-export types from interface
export type {
  IValuationMethodStrategy,
  IValuationStrategyFactory,
  ValuationMethod,
  StockBatch,
  IncomingRateResult,
  OutgoingRateResult,
  InventoryMovementType,
  ValuationMovementInput,
  ValuationMovementResult,
  BatchValuationDetail,
  ItemValuationSummary,
  ValuationComparison
} from '../interfaces/IValuationMethodStrategy';


