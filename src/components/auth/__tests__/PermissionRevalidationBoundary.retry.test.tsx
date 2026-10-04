// Issue #239 follow-up (P2): a transient failure must have a way out.
//
// On an unreadable snapshot `usePermissions` clears its grants, sets `error`
// and marks the next attempt an initial/recovery load — but it schedules no
// retry of its own. The only re-reads in the app are `visibilitychange` and an
// explicit `refreshPermissions()`, and the blocker suppresses click/keydown/
// paste/drop/submit while showing a bare spinner. So a failure that happens
// while the tab is already visible leaves the app blocked indefinitely: the
// network can come back and nothing re-asks.
//
// The blocker must retry on its own, and must offer a working manual retry
// that is exempt from its own input block.

import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
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
import { clearPermissionCache } from '@/hooks/usePermissions';

function snapshot() {
  return {
    data: {
      user_id: 'user-1',
      org_id: 'org-a',
      is_super_admin: false,
      is_org_admin: false,
      permission_keys: ['sales.sales_orders.read'],
      sensitive_permission_keys: [],
      generated_at: new Date().toISOString(),
    },
    error: null,
  };
}

const FAILURE = { data: null, error: { message: 'network blip' } };

function Tree() {
  return (
    <MemoryRouter initialEntries={['/sales']}>
      <Routes>
        <Route
          path="/sales"
          element={
            <ModuleGuard moduleCode="sales">
              <span>page-content</span>
            </ModuleGuard>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

async function renderBlocked() {
  rpcMock.mockResolvedValueOnce(snapshot());
  render(<Tree />);
  await screen.findByText('page-content');

  rpcMock.mockResolvedValue(FAILURE);
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
  await waitFor(() =>
    expect(screen.getByTestId('permission-revalidation-blocker')).toBeInTheDocument()
  );
}

beforeEach(() => {
  rpcMock.mockReset();
  clearPermissionCache();
  authState = { user: { id: 'user-1' }, currentOrgId: 'org-a', isAuthenticated: true };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PermissionRevalidationBoundary — recovery path out of a block (#239 P2)', () => {
  it('retries on its own, with no user action and no visibilitychange, until it recovers', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await renderBlocked();

    const callsWhenBlocked = rpcMock.mock.calls.length;

    // The network comes back, but nothing in the app asks again on its own today.
    rpcMock.mockResolvedValue(snapshot());
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });

    expect(rpcMock.mock.calls.length).toBeGreaterThan(callsWhenBlocked);
    await waitFor(() =>
      expect(screen.queryByTestId('permission-revalidation-blocker')).not.toBeInTheDocument()
    );
    expect(screen.getByText('page-content')).toBeInTheDocument();
  });

  it('offers a manual retry that works despite the blocker suppressing input', async () => {
    await renderBlocked();

    const retry = screen.getByTestId('permission-revalidation-retry');
    const callsWhenBlocked = rpcMock.mock.calls.length;

    rpcMock.mockResolvedValue(snapshot());
    // A real dispatched click traverses the document capture listeners the
    // blocker installs — the retry control must be exempt from them.
    fireEvent.pointerDown(retry);
    fireEvent.click(retry);

    await waitFor(() => expect(rpcMock.mock.calls.length).toBeGreaterThan(callsWhenBlocked));
    await waitFor(() =>
      expect(screen.queryByTestId('permission-revalidation-blocker')).not.toBeInTheDocument()
    );
    expect(screen.getByText('page-content')).toBeInTheDocument();
  });

  it('still suppresses interaction with the preserved page while blocked', async () => {
    await renderBlocked();

    const blocked = vi.fn();
    const probe = document.createElement('button');
    probe.addEventListener('click', blocked);
    document.body.appendChild(probe);

    fireEvent.click(probe);
    expect(blocked).not.toHaveBeenCalled();

    probe.remove();
  });
});
