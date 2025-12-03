/**
 * Forbidden Error
 * 
 * Thrown when user doesn't have permission to perform an action
 */

import { AppError } from './AppError';

export class ForbiddenError extends AppError {
  constructor(
    message: string = 'ليس لديك صلاحية للقيام بهذا الإجراء',
    resource?: string,
    action?: string
  ) {
    super(
      'FORBIDDEN',
      message,
      403,
      true,
      { resource, action }
    );
    
    this.name = 'ForbiddenError';
  }
}

