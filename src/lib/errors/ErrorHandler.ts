/**
 * Error Handler Service
 * 
 * Centralized error handling and reporting
 */

import { toast } from 'sonner';
import { AppError } from './AppError';
import { ValidationError } from './ValidationError';

/**
 * Localized error messages
 */
const ERROR_MESSAGES: Record<string, string> = {
  VALIDATION_ERROR: 'البيانات المدخلة غير صحيحة',
  NOT_FOUND: 'العنصر المطلوب غير موجود',
  UNAUTHORIZED: 'يجب تسجيل الدخول أولاً',
  FORBIDDEN: 'ليس لديك صلاحية للقيام بهذا الإجراء',
  INSUFFICIENT_INVENTORY: 'المخزون غير كافٍ',
  NETWORK_ERROR: 'خطأ في الاتصال بالشبكة',
  TIMEOUT_ERROR: 'انتهت مهلة الطلب',
  DUPLICATE_ENTRY: 'هذا العنصر موجود مسبقاً',
  CONSTRAINT_VIOLATION: 'لا يمكن تنفيذ العملية بسبب قيود البيانات',
  TENANT_ISOLATION_ERROR: 'خطأ في عزل بيانات المستأجر',
  INVALID_STATE_TRANSITION: 'لا يمكن تغيير الحالة إلى الحالة المطلوبة',
  SERVER_ERROR: 'حدث خطأ في الخادم',
  UNKNOWN_ERROR: 'حدث خطأ غير متوقع',
};

/**
 * Error Handler class
 */
class ErrorHandler {
  /**
   * Handle an error
   */
  static handle(error: unknown): void {
    if (error instanceof AppError) {
      this.handleAppError(error);
    } else if (error instanceof Error) {
      this.handleUnknownError(error);
    } else {
      this.handleUnknownError(new Error(String(error)));
    }
  }

  /**
   * Handle AppError
   */
  private static handleAppError(error: AppError): void {
    // Log in development
    if (import.meta.env.DEV) {
      console.error('AppError:', error);
      console.error('Error context:', error.context);
    }

    // Send to monitoring (if configured)
    if (import.meta.env.PROD) {
      this.sendToMonitoring(error);
    }

    // Get localized message
    const message = this.getLocalizedMessage(error.code, error.message);

    // Show toast notification
    if (error.statusCode >= 500) {
      // Server errors - show generic message
      toast.error(message, {
        description: 'يرجى المحاولة لاحقاً أو التواصل مع الدعم الفني',
        duration: 5000,
      });
    } else if (error instanceof ValidationError) {
      // Validation errors - show field errors
      if (error.errors.length > 0) {
        const firstError = error.errors[0];
        toast.error(firstError.message, {
          description: error.errors.length > 1 
            ? `و ${error.errors.length - 1} أخطاء أخرى`
            : undefined,
        });
      } else {
        toast.error(message);
      }
    } else {
      // Other client errors
      toast.error(message);
    }
  }

  /**
   * Handle unknown errors
   */
  private static handleUnknownError(error: Error): void {
    console.error('Unknown Error:', error);

    if (import.meta.env.PROD) {
      this.sendToMonitoring(error);
    }

    toast.error('حدث خطأ غير متوقع', {
      description: 'يرجى تحديث الصفحة والمحاولة مرة أخرى',
      duration: 5000,
    });
  }

  /**
   * Get localized error message
   */
  private static getLocalizedMessage(code: string, fallback: string): string {
    return ERROR_MESSAGES[code] || fallback || ERROR_MESSAGES.UNKNOWN_ERROR;
  }

  /**
   * Send error to monitoring service (Sentry, etc.)
   */
  private static sendToMonitoring(error: Error | AppError): void {
    // Check if Sentry is available
    if (typeof globalThis.window !== 'undefined' && (globalThis.window as { Sentry?: unknown }).Sentry) {
      const Sentry = (globalThis.window as { Sentry: { captureException: (error: Error | AppError, options: unknown) => void } }).Sentry;
      
      Sentry.captureException(error, {
        tags: {
          component: 'ErrorHandler',
          error_code: error instanceof AppError ? error.code : undefined,
          status_code: error instanceof AppError ? error.statusCode : undefined,
        },
        extra: error instanceof AppError ? error.context : {},
        level: error instanceof AppError && error.statusCode >= 500 ? 'error' : 'warning',
      });
    }
  }

  /**
   * Handle async errors in promises
   */
  static handleAsync<T>(
    promise: Promise<T>,
    context?: string
  ): Promise<T> {
    return promise.catch((error) => {
      if (context) {
        console.error(`Error in ${context}:`, error);
      }
      this.handle(error);
      throw error;
    });
  }

  /**
   * Wrap a function with error handling
   */
  static wrap<T extends (...args: any[]) => any>(
    fn: T,
    context?: string
  ): T {
    return ((...args: any[]) => {
      try {
        const result = fn(...args);
        
        // If result is a promise, handle it
        if (result instanceof Promise) {
          return this.handleAsync(result, context);
        }
        
        return result;
      } catch (error) {
        if (context) {
          console.error(`Error in ${context}:`, error);
        }
        this.handle(error);
        throw error;
      }
    }) as T;
  }
}

export default ErrorHandler;

