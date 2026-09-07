// Issue #239: transient permission revalidation failures must fail closed
// without destroying the already-mounted page state.

import { useEffect } from 'react';
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}

let mountCount = 0;
let unmountCount = 0;
let submitCount = 0;

function DraftForm() {
  useEffect(() => {
    mountCount += 1;
    return () => {
      unmountCount += 1;
    };
  }, []);

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
    unmountCount = 0;
    submitCount = 0;
    authState = { user: { id: 'user-1' }, currentOrgId: 'org-a', isAuthenticated: true };
  });

  it('keeps the page mounted and state intact, but blocks interaction until a fresh snapshot succeeds', async () => {
    rpcMock.mockResolvedValueOnce(snapshot());
    render(<Tree />);

    const input = await screen.findByLabelText('draft-note') as HTMLInputElement;
    await waitFor(() => expect(mountCount).toBe(1));
    await userEvent.type(input, 'unsaved text');
    expect(input.value).toBe('unsaved text');
    expect(unmountCount).toBe(0);

    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'network blip' } });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });

    await waitFor(() =>
      expect(screen.getByTestId('permission-revalidation-blocker')).toBeInTheDocument()
    );

    expect(screen.getByLabelText('draft-note')).toBeInTheDocument();
    expect((screen.getByLabelText('draft-note') as HTMLInputElement).value).toBe('unsaved text');
    expect(mountCount).toBe(1);
    expect(unmountCount).toBe(0);

    await userEvent.click(screen.getByText('save-draft'));
    expect(submitCount).toBe(0);

    rpcMock.mockResolvedValueOnce(snapshot());
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() =>
      expect(screen.queryByTestId('permission-revalidation-blocker')).not.toBeInTheDocument()
    );

    expect((screen.getByLabelText('draft-note') as HTMLInputElement).value).toBe('unsaved text');
    expect(mountCount).toBe(1);
    expect(unmountCount).toBe(0);

    await userEvent.click(screen.getByText('save-draft'));
    expect(submitCount).toBe(1);
  });

  it('still removes the page when a successful revalidation reports a real revocation', async () => {
    rpcMock.mockResolvedValueOnce(snapshot());
    render(<Tree />);
    await screen.findByLabelText('draft-note');
    await waitFor(() => expect(mountCount).toBe(1));

    rpcMock.mockResolvedValueOnce(snapshot({ permission_keys: [] }));
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });

    await waitFor(() => expect(screen.getByText('auth.accessDenied')).toBeInTheDocument());
    expect(screen.queryByLabelText('draft-note')).not.toBeInTheDocument();
    expect(screen.queryByTestId('permission-revalidation-blocker')).not.toBeInTheDocument();
    expect(unmountCount).toBe(1);
  });

  it('drops preserved old-org content immediately if the identity changes while recovery is blocked', async () => {
    rpcMock.mockResolvedValueOnce(snapshot());
    const { rerender } = render(<Tree />);
    await screen.findByLabelText('draft-note');
    await waitFor(() => expect(mountCount).toBe(1));

    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'network blip' } });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() =>
      expect(screen.getByTestId('permission-revalidation-blocker')).toBeInTheDocument()
    );

    const pending = deferred<{ data: unknown; error: null }>();
    rpcMock.mockImplementation(() => pending.promise);
    authState = { ...authState, currentOrgId: 'org-b' };
    rerender(<Tree />);

    expect(screen.queryByLabelText('draft-note')).not.toBeInTheDocument();
    expect(screen.queryByTestId('permission-revalidation-blocker')).not.toBeInTheDocument();
    expect(screen.getByText('auth.checkingPermissions')).toBeInTheDocument();
    expect(unmountCount).toBe(1);

    act(() => {
      pending.resolve(snapshot({ org_id: 'org-b' }));
    });
    await waitFor(() => expect(screen.getByLabelText('draft-note')).toBeInTheDocument());
  });
});
