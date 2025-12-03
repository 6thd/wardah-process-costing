/**
 * Validation Error
 * 
 * Thrown when input validation fails
 */

import { AppError } from './AppError';

export interface FieldError {
  field: string;
  message: string;
  code?: string;
}

export class ValidationError extends AppError {
  public readonly errors: FieldError[];

  constructor(message: string, errors: FieldError[] = []) {
    super(
      'VALIDATION_ERROR',
      message || 'البيانات المدخلة غير صحيحة',
      400,
      true,
      { errors }
    );
    
    this.errors = errors;
    this.name = 'ValidationError';
  }

  /**
   * Add a field error
   */
  addError(field: string, message: string, code?: string): void {
    this.errors.push({ field, message, code });
  }

  /**
   * Check if error exists for a field
   */
  hasError(field: string): boolean {
    return this.errors.some(e => e.field === field);
  }

  /**
   * Get error message for a field
   */
  getError(field: string): string | undefined {
    const error = this.errors.find(e => e.field === field);
    return error?.message;
  }
}

