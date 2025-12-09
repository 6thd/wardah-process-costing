/**
 * Demo Credentials Configuration
 * 
 * NOSONAR - These are demo/test credentials for development only.
 * They should NEVER be used in production.
 * 
 * In production, use environment variables or Supabase Auth Dashboard.
 */

// NOSONAR - Demo credentials for development/testing
export const DEMO_CREDENTIALS = {
  admin: {
    email: 'admin@wardah.sa',
    // NOSONAR - Demo password for development only
    password: import.meta.env.VITE_DEMO_ADMIN_PASSWORD || 'admin123'
  },
  manager: {
    email: 'manager@wardah.sa',
    // NOSONAR - Demo password for development only
    password: import.meta.env.VITE_DEMO_MANAGER_PASSWORD || 'manager123'
  },
  employee: {
    email: 'employee@wardah.sa',
    // NOSONAR - Demo password for development only
    password: import.meta.env.VITE_DEMO_EMPLOYEE_PASSWORD || 'employee123'
  }
} as const;

// Type guard to check if running in development
export const isDevelopment = () => {
  return import.meta.env.DEV || import.meta.env.MODE === 'development';
};

// Warning message for production
export const DEMO_CREDENTIALS_WARNING = isDevelopment()
  ? '⚠️ DEVELOPMENT MODE: Using demo credentials'
  : '🚨 PRODUCTION MODE: Demo credentials disabled';

