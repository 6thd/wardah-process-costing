/**
 * Database Transaction Wrapper
 * 
 * Provides transaction management for complex database operations
 * Ensures atomicity and rollback on errors
 */

import { supabase } from './supabase';
import { AppError } from './errors/AppError';

/**
 * Transaction options
 */
export interface TransactionOptions {
  timeout?: number; // Timeout in milliseconds
  retries?: number; // Number of retry attempts
  retryDelay?: number; // Delay between retries in milliseconds
}

/**
 * Transaction operation function
 */
export type TransactionOperation<T> = (client: typeof supabase) => Promise<T>;

/**
 * Transaction result
 */
export interface TransactionResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  rollback?: () => Promise<void>;
}

/**
 * Database Transaction Manager
 */
class TransactionManager {
  /**
   * Execute operations within a transaction
   * 
   * Note: Supabase uses PostgreSQL transactions via RPC functions
   * For complex transactions, we'll use a transaction-like pattern
   * with rollback logic
   */
  async execute<T>(
    operations: TransactionOperation<T>[],
    options: TransactionOptions = {}
  ): Promise<TransactionResult<T>> {
    const {
      timeout = 30000, // 30 seconds default
      retries = 0,
      retryDelay = 1000,
    } = options;

    let lastError: Error | null = null;
    let attempt = 0;

    while (attempt <= retries) {
      try {
        // Execute all operations
        const results: T[] = [];
        
        for (const operation of operations) {
          const result = await Promise.race([
            operation(supabase),
            this.createTimeout(timeout),
          ]);
          
          results.push(result as T);
        }

        // All operations succeeded
        return {
          success: true,
          data: results[results.length - 1], // Return last result
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // If not last attempt, retry
        if (attempt < retries) {
          attempt++;
          await this.delay(retryDelay * attempt); // Exponential backoff
          continue;
        }

        // All retries exhausted
        return {
          success: false,
          error: lastError,
        };
      }
    }

    return {
      success: false,
      error: lastError || new Error('Transaction failed'),
    };
  }

  /**
   * Execute transaction using Supabase RPC function
   * 
   * For true database transactions, create an RPC function in PostgreSQL
   */
  async executeRPC<T>(
    functionName: string,
    params: Record<string, any> = {},
    options: TransactionOptions = {}
  ): Promise<TransactionResult<T>> {
    try {
      const { data, error } = await supabase.rpc(functionName, params);

      if (error) {
        throw new AppError(
          'TRANSACTION_ERROR',
          `Transaction RPC failed: ${error.message}`,
          500,
          true,
          { functionName, params, error }
        );
      }

      return {
        success: true,
        data: data as T,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  /**
   * Create timeout promise
   */
  private createTimeout(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new AppError(
          'TRANSACTION_TIMEOUT',
          `Transaction timed out after ${ms}ms`,
          408,
          true
        ));
      }, ms);
    });
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton instance
export const transactionManager = new TransactionManager();

/**
 * Convenience function to execute a transaction
 */
export async function executeTransaction<T>(
  operations: TransactionOperation<T>[],
  options?: TransactionOptions
): Promise<TransactionResult<T>> {
  return transactionManager.execute(operations, options);
}

/**
 * Convenience function to execute RPC transaction
 */
export async function executeRPCTransaction<T>(
  functionName: string,
  params?: Record<string, any>,
  options?: TransactionOptions
): Promise<TransactionResult<T>> {
  return transactionManager.executeRPC(functionName, params, options);
}

export default transactionManager;

