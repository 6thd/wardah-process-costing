import { AppError } from './AppError';

/**
 * Too Many Requests Error
 * 
 * Thrown when rate limit is exceeded
 */
export class TooManyRequestsError extends AppError {
  constructor(
    message: string = 'Too many requests. Please try again later.',
    public retryAfter?: number // seconds
  ) {
    super('TOO_MANY_REQUESTS', message, 429);
    this.name = 'TooManyRequestsError';
  }
}

