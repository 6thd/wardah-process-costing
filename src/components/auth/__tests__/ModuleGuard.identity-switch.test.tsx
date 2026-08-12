// src/components/auth/__tests__/ModuleGuard.identity-switch.test.tsx
//
// End-to-end proof for the usePermissions render-time switch guard, using the
// REAL hook rather than the mocked one in ModuleGuard.module-access.test.tsx.
// A mocked usePermissions can only assert what ModuleGuard does with a given
// loading/permission combination — it cannot show that the hook actually
// produces `loading: true` for the commit where an org switch has cleared
// permissions but the new org's answer hasn't arrived yet. That gap used to
// render "access denied" for a legitimate user mid-switch, because the
// visible permission keys were cleared without `loading` being set back to
// true in the same pass.

import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcMock = vi.fn();

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({ rpc: rpcMock }),
}));

let authState = {
  user: { id: 'user-1' } as { id: string } | null,
  currentOrgId: 'org-a' as string | null,
  isAuthenticated: true,
};

function setAuth(overrides: Partial<typeof authState>) {
  authState = { ...authState, ...overrides };
}

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => authState,
}));

vi.mock('@/lib/safe-storage', () => ({
  safeLocalStorage: { getItem: () => null, setItem: () => undefined },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { ModuleGuard } from '../ModuleGuard';

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      user_id: 'user-1',
      org_id: 'org-a',
      is_super_admin: false,
      is_org_admin: false,
      permission_keys: ['sales.orders.read'],
      sensitive_permission_keys: [],
      generated_at: new Date().toISOString(),
      ...overrides,
    },
    error: null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}

function Tree() {
  return (
    <MemoryRouter initialEntries={['/sales']}>
      <Routes>
        <Route
          path="/sales"
          element={
            <ModuleGuard moduleCode="sales">
              <div>sales-content</div>
            </ModuleGuard>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

describe('ModuleGuard — real usePermissions during an org switch', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    authState = { user: { id: 'user-1' }, currentOrgId: 'org-a', isAuthenticated: true };
  });

  it('shows the loader, not access denied, for the commit where the new org has not answered yet', async () => {
    rpcMock.mockResolvedValueOnce(snapshot());
    const { rerender } = render(<Tree />);
    await waitFor(() => expect(screen.getByText('sales-content')).toBeInTheDocument());

    // Switch org and deliberately leave the new org's response unresolved, so
    // the assertions below observe the in-between commit. Using a deferred
    // promise rather than one that can never settle: usePermissions' shared
    // in-flight request map is keyed by this exact (user, org) pair and is
    // module state, not React state, so an eternally-pending entry here
    // would still be sitting in that map for the next test in this file —
    // which asks for the very same org switch — and would hang awaiting a
    // promise nothing in that later test can ever resolve.
    const pending = deferred<{ data: unknown; error: null }>();
    rpcMock.mockImplementation(() => pending.promise);
    setAuth({ currentOrgId: 'org-b' });
    rerender(<Tree />);

    expect(screen.queryByText('auth.accessDenied')).not.toBeInTheDocument();
    expect(screen.queryByText('sales-content')).not.toBeInTheDocument();
    expect(screen.getByText('auth.checkingPermissions')).toBeInTheDocument();

    // Cleanup, not part of the assertion: let the in-flight entry settle so
    // it doesn't leak into the next test.
    act(() => { pending.resolve(snapshot({ org_id: 'org-b' })); });
    await waitFor(() => expect(screen.getByText('sales-content')).toBeInTheDocument());
  });

  it('never shows access denied on the way to the new org\'s content', async () => {
    const first = deferred<{ data: unknown; error: null }>();
    rpcMock.mockImplementation(() => first.promise);

    const { rerender } = render(<Tree />);
    act(() => { first.resolve(snapshot()); });
    await waitFor(() => expect(screen.getByText('sales-content')).toBeInTheDocument());

    const second = deferred<{ data: unknown; error: null }>();
    rpcMock.mockImplementation(() => second.promise);
    setAuth({ currentOrgId: 'org-b' });
    rerender(<Tree />);

    // Mid-switch: the loader, never a denial.
    expect(screen.queryByText('auth.accessDenied')).not.toBeInTheDocument();

    act(() => {
      second.resolve(snapshot({ org_id: 'org-b', permission_keys: ['sales.orders.read'] }));
    });
    await waitFor(() => expect(screen.getByText('sales-content')).toBeInTheDocument());
    expect(screen.queryByText('auth.accessDenied')).not.toBeInTheDocument();
  });
});
