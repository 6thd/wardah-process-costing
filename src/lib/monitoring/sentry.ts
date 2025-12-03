/**
 * Sentry Error Tracking Integration
 * 
 * Configures and initializes Sentry for error tracking
 */

/**
 * Initialize Sentry
 */
export function initSentry(): void {
  // Check if Sentry DSN is configured
  const sentryDsn = import.meta.env.VITE_SENTRY_DSN;

  if (!sentryDsn) {
    console.warn('Sentry DSN not configured. Error tracking disabled.');
    return;
  }

  // Dynamic import to avoid loading Sentry in development if not needed
  if (import.meta.env.PROD) {
    // @ts-ignore - Sentry may not be installed
    import('@sentry/react').then((Sentry) => {
      Sentry.init({
        dsn: sentryDsn,
        environment: import.meta.env.VITE_APP_ENV || 'production',
        integrations: [
          Sentry.browserTracingIntegration(),
          Sentry.replayIntegration({
            maskAllText: true,
            blockAllMedia: true,
          }),
        ],
        tracesSampleRate: 1.0,
        replaysSessionSampleRate: 0.1,
        replaysOnErrorSampleRate: 1.0,
        beforeSend(event, hint) {
          // Filter out sensitive data
          if (event.request) {
            // Remove sensitive headers
            if (event.request.headers) {
              delete event.request.headers['Authorization'];
              delete event.request.headers['Cookie'];
            }

            // Remove sensitive URL parameters
            if (event.request.url) {
              const url = new URL(event.request.url);
              url.searchParams.delete('token');
              url.searchParams.delete('api_key');
              event.request.url = url.toString();
            }
          }

          // Remove sensitive user data
          if (event.user) {
            delete event.user.email;
            delete event.user.ip_address;
          }

          return event;
        },
      });

      console.log('Sentry initialized');
    }).catch((error) => {
      console.error('Failed to initialize Sentry:', error);
    });
  }
}

/**
 * Capture exception
 */
export function captureException(error: Error, context?: Record<string, any>): void {
  if (typeof window !== 'undefined' && (window as any).Sentry) {
    const Sentry = (window as any).Sentry;
    Sentry.captureException(error, {
      extra: context,
    });
  }
}

/**
 * Capture message
 */
export function captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info'): void {
  if (typeof window !== 'undefined' && (window as any).Sentry) {
    const Sentry = (window as any).Sentry;
    Sentry.captureMessage(message, level);
  }
}

/**
 * Set user context
 */
export function setUserContext(userId: string, orgId: string, email?: string): void {
  if (typeof window !== 'undefined' && (window as any).Sentry) {
    const Sentry = (window as any).Sentry;
    Sentry.setUser({
      id: userId,
      org_id: orgId,
      email: email, // Only if explicitly provided
    });
  }
}

/**
 * Clear user context (on logout)
 */
export function clearUserContext(): void {
  if (typeof window !== 'undefined' && (window as any).Sentry) {
    const Sentry = (window as any).Sentry;
    Sentry.setUser(null);
  }
}

// Auto-initialize in production
if (import.meta.env.PROD) {
  initSentry();
}

export default {
  init: initSentry,
  captureException,
  captureMessage,
  setUserContext,
  clearUserContext,
};

