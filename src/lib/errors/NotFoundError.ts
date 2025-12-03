/**
 * Not Found Error
 * 
 * Thrown when a requested resource is not found
 */

import { AppError } from './AppError';

export class NotFoundError extends AppError {
  constructor(
    resource: string,
    id?: string,
    message?: string
  ) {
    super(
      'NOT_FOUND',
      message || `${resource}${id ? ` with ID ${id}` : ''} not found`,
      404,
      true,
      { resource, id }
    );
    
    this.name = 'NotFoundError';
  }
}

