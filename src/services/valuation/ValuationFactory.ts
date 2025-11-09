/**
 * Valuation Factory
 * Creates the appropriate valuation strategy based on the product's valuation method
 */

import { ValuationStrategy } from './ValuationStrategy';
import { WeightedAverageValuation } from './WeightedAverageValuation';
import { FIFOValuation } from './FIFOValuation';
import { LIFOValuation } from './LIFOValuation';

export type ValuationMethod = 'Weighted Average' | 'FIFO' | 'LIFO' | 'Moving Average';

export class ValuationFactory {
  
  /**
   * Get the appropriate valuation strategy based on method
   * 
   * @param method - Valuation method: 'Weighted Average', 'FIFO', 'LIFO', or 'Moving Average'
   * @returns ValuationStrategy instance
   */
  static getStrategy(method: ValuationMethod | string | null | undefined): ValuationStrategy {
    
    // Normalize input
    const normalizedMethod = (method || 'Weighted Average').trim();
    
    switch (normalizedMethod) {
      case 'FIFO':
        console.log('🔧 Using FIFO valuation strategy');
        return new FIFOValuation();
      
      case 'LIFO':
        console.log('🔧 Using LIFO valuation strategy');
        return new LIFOValuation();
      
      case 'Weighted Average':
      case 'Moving Average':
      default:
        console.log('🔧 Using Weighted Average valuation strategy');
        return new WeightedAverageValuation();
    }
  }

  /**
   * Check if a valuation method is valid
   */
  static isValidMethod(method: string): boolean {
    const validMethods = ['Weighted Average', 'FIFO', 'LIFO', 'Moving Average'];
    return validMethods.includes(method);
  }

  /**
   * Get list of all supported valuation methods
   */
  static getSupportedMethods(): ValuationMethod[] {
    return ['Weighted Average', 'FIFO', 'LIFO', 'Moving Average'];
  }

  /**
   * Get method name in Arabic
   */
  static getMethodNameAr(method: ValuationMethod): string {
    const names: Record<ValuationMethod, string> = {
      'Weighted Average': 'المتوسط المرجح',
      'FIFO': 'الوارد أولاً صادر أولاً',
      'LIFO': 'الوارد أخيراً صادر أولاً',
      'Moving Average': 'المتوسط المتحرك'
    };
    return names[method] || names['Weighted Average'];
  }

  /**
   * Get method description
   */
  static getMethodDescription(method: ValuationMethod): string {
    const descriptions: Record<ValuationMethod, string> = {
      'Weighted Average': 'Calculates a new weighted average cost whenever stock is received. Simple and most commonly used.',
      'FIFO': 'First In First Out - Issues stock from oldest batches first. Suitable for perishable goods.',
      'LIFO': 'Last In First Out - Issues stock from newest batches first. Can provide tax benefits in certain scenarios.',
      'Moving Average': 'Continuously updates average cost with each transaction. Similar to Weighted Average.'
    };
    return descriptions[method] || descriptions['Weighted Average'];
  }
}
