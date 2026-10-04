import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const authContext = readFileSync('src/contexts/AuthContext.tsx', 'utf8');
const header = readFileSync('src/components/layout/header.tsx', 'utf8');

describe('logout completion contract', () => {
  it('awaits Supabase signOut before exposing signed-out React state', () => {
    const start = authContext.indexOf('const signOut = useCallback');
    const end = authContext.indexOf('const refreshSession', start);
    const block = authContext.slice(start, end);

    const remoteSignOut = block.indexOf('await supabase.auth.signOut()');
    const localClear = block.indexOf('setUser(null)');

    expect(remoteSignOut).toBeGreaterThan(-1);
    expect(localClear).toBeGreaterThan(remoteSignOut);
    expect(block).toContain('tenantIdCacheRef.current = null');
  });

  it('clears the tenant cache on auth-driven SIGNED_OUT as well', () => {
    const start = authContext.indexOf('// Clear organizations on sign out');
    const block = authContext.slice(start, start + 600);

    expect(start).toBeGreaterThan(-1);
    expect(block).toContain('tenantIdCacheRef.current = null');
  });

  it('does not issue a second Supabase signOut request from the header', () => {
    expect(header).toContain('await signOut()');
    expect(header).not.toContain('storeLogout');
    expect(header).toContain('useAuthStore.setState({ user: null, isAuthenticated: false })');
  });
});
