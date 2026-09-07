// Issue #239 follow-up: the recovery blocker is an application-scoped modal.
// Several guards latch `blocked` from the SAME failed permission read — a page
// ModuleGuard plus every inline PermissionGuard/withPermission below it — so an
// overlay rendered per guard instance stacks N opaque full-screen layers over
// the app and installs N sets of document-level capture listeners.
//
// Exactly one blocker must exist no matter how many guards are blocked.

import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
import { PermissionGuard } from '../withPermission';
import { clearPermissionCache } from '@/hooks/usePermissions';

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      user_id: 'user-1',
      org_id: 'org-a',
      is_super_admin: false,
      is_org_admin: false,
      permission_keys: ['sales.sales_orders.read', 'sales.sales_orders.delete'],
      sensitive_permission_keys: [],
      generated_at: new Date().toISOString(),
      ...overrides,
    },
    error: null,
  };
}

/** A page guard with three inline guards below it, as a table of rows would render. */
function Tree() {
  return (
    <MemoryRouter initialEntries={['/sales']}>
      <Routes>
        <Route
          path="/sales"
          element={
            <ModuleGuard moduleCode="sales">
              <div>
                <span>page-content</span>
                {['a', 'b', 'c'].map(row => (
                  <PermissionGuard key={row} module="sales" action="delete">
                    <button type="button">{`delete-${row}`}</button>
                  </PermissionGuard>
                ))}
              </div>
            </ModuleGuard>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

describe('PermissionRevalidationBoundary — one shared blocker for the whole app', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    clearPermissionCache();
    authState = { user: { id: 'user-1' }, currentOrgId: 'org-a', isAuthenticated: true };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders exactly one blocker when a page guard and inline guards all latch together', async () => {
    rpcMock.mockResolvedValueOnce(snapshot());
    render(<Tree />);

    await screen.findByText('page-content');
    await waitFor(() => expect(screen.getByText('delete-a')).toBeInTheDocument());

    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'network blip' } });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });

    await waitFor(() =>
      expect(screen.getAllByTestId('permission-revalidation-blocker').length).toBeGreaterThan(0)
    );

    // Four guards latch (1 page + 3 rows) but the blocker is application-scoped.
    expect(screen.getAllByTestId('permission-revalidation-blocker')).toHaveLength(1);

    // The guarded content is preserved behind it, not unmounted.
    expect(screen.getByText('page-content')).toBeInTheDocument();
    expect(screen.getByText('delete-a')).toBeInTheDocument();
  });

  it('installs the document input block once, and removes it fully on recovery', async () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');

    rpcMock.mockResolvedValueOnce(snapshot());
    render(<Tree />);
    await screen.findByText('page-content');
    await waitFor(() => expect(screen.getByText('delete-a')).toBeInTheDocument());

    addSpy.mockClear();
    removeSpy.mockClear();

    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'network blip' } });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() =>
      expect(screen.getByTestId('permission-revalidation-blocker')).toBeInTheDocument()
    );

    const blockedTypes = addSpy.mock.calls
      .filter(([, , capture]) => capture === true)
      .map(([type]) => type);
    // Every blocked event type is registered exactly once, not once per guard.
    expect(blockedTypes.length).toBe(new Set(blockedTypes).size);
    expect(blockedTypes.length).toBeGreaterThan(0);

    rpcMock.mockResolvedValueOnce(snapshot());
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() =>
      expect(screen.queryByTestId('permission-revalidation-blocker')).not.toBeInTheDocument()
    );

    const releasedTypes = removeSpy.mock.calls
      .filter(([, , capture]) => capture === true)
      .map(([type]) => type);
    // Nothing is left listening on document after recovery.
    expect(new Set(releasedTypes)).toEqual(new Set(blockedTypes));
  });
});
