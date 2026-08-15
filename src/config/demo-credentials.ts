/**
 * Demo Credentials Configuration
 *
 * There is no client-safe way to ship a demo login password: a VITE_*
 * value is inlined into the built browser bundle at compile time (Vite
 * resolves import.meta.env.VITE_* statically), so it is exactly as
 * visible as a hard-coded literal to anyone who views the deployed
 * source. The demo-login hint and any client-side demo auth path are
 * therefore fail-closed — password is always null — until a server-side
 * mechanism exists that never returns the password itself to the client.
 */

export const DEMO_CREDENTIALS = {
  admin: {
    email: 'admin@wardah.sa',
    password: null as string | null
  },
  manager: {
    email: 'manager@wardah.sa',
    password: null as string | null
  },
  employee: {
    email: 'employee@wardah.sa',
    password: null as string | null
  }
} as const;

// Type guard to check if running in development
export const isDevelopment = () => {
  return import.meta.env.DEV || import.meta.env.MODE === 'development';
};
