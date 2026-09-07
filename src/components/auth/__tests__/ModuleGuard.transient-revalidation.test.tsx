// Issue #239: transient permission revalidation failures must fail closed
// without destroying the already-mounted page state.

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
      permission_keys: ['sales.sales_orders.read'],
      sensitive_permission_keys: [],
      generated_at: new Date().toISOString(),
      ...overrides,
    },
    error: null,
  };
}

let mountCount = 0;
let submitCount = 0;

function DraftForm() {
  mountCount += 1;
  return (
    <form
      onSubmit={event => {
        event.preventDefault();
        submitCount += 1;
      }}
    >
      <input aria-label="draft-note" defaultValue="" />
      <button type="submit">save-draft</button>
    </form>
  );
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

describe('ModuleGuard — transient permission revalidation failure (#239)', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    clearPermissionCache();
    mountCount = 0;
    submitCount = 0;
    authState = { user: { id: 'user-1' }, currentOrgId: 'org-a', isAuthenticated: true };
  });

  it('keeps the page mounted and state intact, but blocks interaction until a fresh snapshot succeeds', async () => {
    rpcMock.mockResolvedValueOnce(snapshot());
    render(<Tree />);

    const input = await screen.findByLabelText('draft-note') as HTMLInputElement;
    await userEvent.type(input, 'unsaved text');
    expect(input.value).toBe('unsaved text');
    expect(mountCount).toBe(1);

    // A refocus revalidation reaches no trustworthy backend answer.
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'network blip' } });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });

    await waitFor(() =>
      expect(screen.getByTestId('permission-revalidation-blocker')).toBeInTheDocument()
    );

    // The same component instance survives, including local DOM state.
    expect(screen.getByLabelText('draft-note')).toBeInTheDocument();
    expect((screen.getByLabelText('draft-note') as HTMLInputElement).value).toBe('unsaved text');
    expect(mountCount).toBe(1);

    // Fail closed at the UI boundary while trust is unavailable.
    await userEvent.click(screen.getByText('save-draft'));
    expect(submitCount).toBe(0);

    // A later successful revalidation restores interaction without remounting.
    rpcMock.mockResolvedValueOnce(snapshot());
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() =>
      expect(screen.queryByTestId('permission-revalidation-blocker')).not.toBeInTheDocument()
    );

    expect((screen.getByLabelText('draft-note') as HTMLInputElement).value).toBe('unsaved text');
    expect(mountCount).toBe(1);

    await userEvent.click(screen.getByText('save-draft'));
    expect(submitCount).toBe(1);
  });

  it('still removes the page when a successful revalidation reports a real revocation', async () => {
    rpcMock.mockResolvedValueOnce(snapshot());
    render(<Tree />);
    await screen.findByLabelText('draft-note');

    rpcMock.mockResolvedValueOnce(snapshot({ permission_keys: [] }));
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });

    await waitFor(() => expect(screen.getByText('auth.accessDenied')).toBeInTheDocument());
    expect(screen.queryByLabelText('draft-note')).not.toBeInTheDocument();
    expect(screen.queryByTestId('permission-revalidation-blocker')).not.toBeInTheDocument();
  });
});
