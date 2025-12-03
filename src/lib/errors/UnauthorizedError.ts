/**
 * Unauthorized Error
 * 
 * Thrown when user is not authenticated
 */

import { AppError } from './AppError';

export class UnauthorizedError extends AppError {
  constructor(message: string = 'يجب تسجيل الدخول أولاً') {
    super(
      'UNAUTHORIZED',
      message,
      401,
      true
    );
    
    this.name = 'UnauthorizedError';
  }
}

