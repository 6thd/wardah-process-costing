// Issue #239 follow-up (P1): the recovery latch must not outlive the route it
// was granted for.
//
// One ModuleGuard wraps a whole module (`sales/*` -> SalesModule), and that
// module routes internally to pages that carry DIFFERENT permission keys
// (`/orders` -> sales.sales_orders.read, `/customers` -> sales.customers.read).
// Latching recovery on user+org alone means a navigation during a transient
// failure keeps `recoveryBlocked` true, so `!hasAccess && !recoveryBlocked`
// never fires and the guard mounts a screen whose own route requirement was
// never satisfied — starting its data-loading effects behind the overlay.
//
// The latch must be scoped to the guarded route as well as the identity.

import { useEffect } from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
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

/** Only `sales.sales_orders.read` — deliberately NOT `sales.customers.read`. */
function ordersOnlySnapshot(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      user_id: 'user-1',
      org_id: 'org-a',
      is_super_admin: false,
      is_org_admin: false,
      permission_keys: ['sales.sales_orders.read'],
      sensitive_permission_keys: [],
      generated_at: new Date().toISOString(),
      ...overrides,
    },
    error: null,
  };
}

const mounted: string[] = [];

function Page({ name }: { readonly name: string }) {
  useEffect(() => {
    // Stands in for the real page's data-loading effect.
    mounted.push(name);
  }, [name]);
  return <span>{name}</span>;
}

let navigate: ((to: string) => void) | null = null;

function NavigationHandle() {
  navigate = useNavigate();
  return null;
}

/** Mirrors routes.tsx: one ModuleGuard over a module that routes internally. */
function Tree() {
  return (
    <MemoryRouter initialEntries={['/sales/orders']}>
      <NavigationHandle />
      <Routes>
        <Route
          path="/sales/*"
          element={
            <ModuleGuard moduleCode="sales">
              <Routes>
                <Route path="orders" element={<Page name="orders-page" />} />
                <Route path="customers" element={<Page name="customers-page" />} />
              </Routes>
            </ModuleGuard>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

describe('ModuleGuard — recovery latch is scoped to the route (#239 P1)', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    clearPermissionCache();
    mounted.length = 0;
    navigate = null;
    authState = { user: { id: 'user-1' }, currentOrgId: 'org-a', isAuthenticated: true };
  });

  it('does not mount a different route the user was never granted while recovery is blocked', async () => {
    rpcMock.mockResolvedValueOnce(ordersOnlySnapshot());
    render(<Tree />);

    await screen.findByText('orders-page');
    expect(mounted).toEqual(['orders-page']);

    // Background revalidation becomes unreadable: the orders page is preserved.
    rpcMock.mockResolvedValue({ data: null, error: { message: 'network blip' } });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });

    await waitFor(() =>
      expect(screen.getByTestId('permission-revalidation-blocker')).toBeInTheDocument()
    );
    expect(screen.getByText('orders-page')).toBeInTheDocument();

    // Browser Back/Forward, or any in-module navigation, during the outage.
    act(() => { navigate!('/sales/customers'); });

    // `/sales/customers` requires sales.customers.read, which this user has
    // never held. It must not render, and must not run its mount effects.
    await waitFor(() => expect(screen.queryByText('orders-page')).not.toBeInTheDocument());
    expect(screen.queryByText('customers-page')).not.toBeInTheDocument();
    expect(mounted).toEqual(['orders-page']);
  });

  it('keeps preserving the original route when no navigation happens', async () => {
    rpcMock.mockResolvedValueOnce(ordersOnlySnapshot());
    render(<Tree />);
    await screen.findByText('orders-page');

    rpcMock.mockResolvedValue({ data: null, error: { message: 'network blip' } });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });

    await waitFor(() =>
      expect(screen.getByTestId('permission-revalidation-blocker')).toBeInTheDocument()
    );
    // The whole point of #239: staying put keeps the page and its state.
    expect(screen.getByText('orders-page')).toBeInTheDocument();
    expect(mounted).toEqual(['orders-page']);
  });
});
