// src/components/auth/__tests__/ModuleGuard.background-revalidation.test.tsx
//
// Issue #237: a tab refocus (visibilitychange) made usePermissions()
// revalidate its snapshot by flipping `loading` back to true. Every consumer
// built on that hook — ModuleGuard included — renders a loading screen IN
// PLACE OF `children` while `loading` is true, so the already-mounted page
// got unmounted and remounted a moment later, destroying any component-local
// state it held (in-progress form input, wizard step, ...).
//
// These exercise the real ModuleGuard + real usePermissions against a
// mocked Supabase RPC, the same way ModuleGuard.identity-switch.test.tsx
// does — a mocked usePermissions could only assert what ModuleGuard does
// with a given loading/permission combination, not that the hook actually
// produces (or stops producing) `loading: true` for a background
// revalidation.

import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
import { clearPermissionCache } from '@/hooks/usePermissions';

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      user_id: 'user-1',
      org_id: 'org-a',
      is_super_admin: false,
      is_org_admin: false,
      // Same (moduleCode, path, key) combination already proven to satisfy
      // the route-permission contract in ModuleGuard.identity-switch.test.tsx.
      permission_keys: ['sales.sales_orders.read'],
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

// Counts real mounts of this exact component, not re-renders — proves an
// unmount/remount occurred rather than just a prop/state change.
let mountCount = 0;

function DraftForm() {
  mountCount += 1;
  return <input aria-label="draft-note" defaultValue="" />;
}

function Tree() {
  return (
    <MemoryRouter initialEntries={['/sales']}>
      <Routes>
        <Route
          path="/sales"
          element={
            <ModuleGuard moduleCode="sales">
              <DraftForm />
            </ModuleGuard>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

describe('ModuleGuard — background permission revalidation on tab refocus (#237)', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    clearPermissionCache();
    mountCount = 0;
    authState = { user: { id: 'user-1' }, currentOrgId: 'org-a', isAuthenticated: true };
  });

  it('shows LoadingState and blocks content on the very first load (fail-closed, unchanged)', async () => {
    const pending = deferred<{ data: unknown; error: null }>();
    rpcMock.mockImplementation(() => pending.promise);

    render(<Tree />);

    expect(screen.getByText('auth.checkingPermissions')).toBeInTheDocument();
    expect(screen.queryByLabelText('draft-note')).not.toBeInTheDocument();

    act(() => { pending.resolve(snapshot()); });
    await waitFor(() => expect(screen.getByLabelText('draft-note')).toBeInTheDocument());
    expect(mountCount).toBe(1);
  });

  it('does not unmount the page or lose in-progress input on a same-permission background revalidation', async () => {
    rpcMock.mockResolvedValueOnce(snapshot());
    render(<Tree />);
    await waitFor(() => expect(screen.getByLabelText('draft-note')).toBeInTheDocument());
    expect(mountCount).toBe(1);

    const input = screen.getByLabelText('draft-note') as HTMLInputElement;
    await userEvent.type(input, 'unsaved draft text');
    expect(input.value).toBe('unsaved draft text');

    // Tab refocus: usePermissions revalidates against the backend. The
    // revalidation promise is deliberately resolved in `finally` below: if
    // the in-flight assertions throw (the RED case, pre-fix), the promise
    // must still settle so it doesn't linger in the hook's shared
    // cross-instance in-flight map and hang every later test that asks for
    // this same (user, org) key.
    const revalidation = deferred<{ data: unknown; error: null }>();
    rpcMock.mockImplementation(() => revalidation.promise);
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });

    try {
      // The revalidation must not swap the page out for a loading screen
      // while it is in flight — that swap is exactly what destroyed
      // `input`'s value before this fix.
      expect(screen.queryByText('auth.checkingPermissions')).not.toBeInTheDocument();
      expect(screen.getByLabelText('draft-note')).toBeInTheDocument();
    } finally {
      act(() => { revalidation.resolve(snapshot()); });
    }
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(mountCount).toBe(1);
    expect((screen.getByLabelText('draft-note') as HTMLInputElement).value).toBe('unsaved draft text');
  });

  it('still enforces a permission revoked during background revalidation', async () => {
    rpcMock.mockResolvedValueOnce(snapshot());
    render(<Tree />);
    await waitFor(() => expect(screen.getByLabelText('draft-note')).toBeInTheDocument());

    const revalidation = deferred<{ data: unknown; error: null }>();
    rpcMock.mockImplementation(() => revalidation.promise);
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });

    // The backend reports the grant was revoked in another tab.
    act(() => { revalidation.resolve(snapshot({ permission_keys: [] })); });

    await waitFor(() => expect(screen.getByText('auth.accessDenied')).toBeInTheDocument());
    expect(screen.queryByLabelText('draft-note')).not.toBeInTheDocument();
  });

  it('coalesces one background revalidation across two mounted ModuleGuard consumers (dedup preserved)', async () => {
    rpcMock.mockResolvedValue(snapshot());

    function TwoConsumers() {
      return (
        <MemoryRouter initialEntries={['/sales']}>
          <Routes>
            <Route
              path="/sales"
              element={
                <>
                  <ModuleGuard moduleCode="sales"><div>sidebar-widget</div></ModuleGuard>
                  <ModuleGuard moduleCode="sales"><DraftForm /></ModuleGuard>
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      );
    }

    render(<TwoConsumers />);
    await waitFor(() => expect(screen.getByLabelText('draft-note')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('sidebar-widget')).toBeInTheDocument());

    rpcMock.mockClear();
    const shared = deferred<{ data: unknown; error: null }>();
    rpcMock.mockImplementation(() => shared.promise);

    act(() => { document.dispatchEvent(new Event('visibilitychange')); });

    expect(rpcMock).toHaveBeenCalledTimes(1);

    act(() => { shared.resolve(snapshot()); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(mountCount).toBe(1);
  });
});
