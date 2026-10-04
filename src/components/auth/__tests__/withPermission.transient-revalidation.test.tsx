// Issue #239: `withPermission` and `PermissionGuard` share the recovery
// boundary with ModuleGuard, so they need the same three guarantees proved
// against them directly — a transient read failure preserves the mounted
// subtree behind the blocker, a real revocation still tears it down, and the
// ordinary denied/loading paths are unchanged.

import { useEffect } from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
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

import { withPermission, PermissionGuard } from '../withPermission';
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
let unmountCount = 0;

function Panel() {
  useEffect(() => {
    mountCount += 1;
    return () => {
      unmountCount += 1;
    };
  }, []);

  return (
    <div>
      <span>panel-content</span>
      <input aria-label="draft-note" defaultValue="" />
    </div>
  );
}

function revalidate() {
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

beforeEach(() => {
  rpcMock.mockReset();
  clearPermissionCache();
  mountCount = 0;
  unmountCount = 0;
  authState = { user: { id: 'user-1' }, currentOrgId: 'org-a', isAuthenticated: true };
});

describe('withPermission — transient permission revalidation failure (#239)', () => {
  const Protected = withPermission(Panel, { module: 'sales', action: 'read' });

  it('preserves the mounted component and its unsaved state behind the blocker', async () => {
    rpcMock.mockResolvedValueOnce(snapshot());
    render(<Protected />);

    const input = (await screen.findByLabelText('draft-note')) as HTMLInputElement;
    input.value = 'unsaved text';
    await waitFor(() => expect(mountCount).toBe(1));

    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'network blip' } });
    revalidate();

    await waitFor(() =>
      expect(screen.getByTestId('permission-revalidation-blocker')).toBeInTheDocument()
    );
    expect(screen.getByText('panel-content')).toBeInTheDocument();
    expect((screen.getByLabelText('draft-note') as HTMLInputElement).value).toBe('unsaved text');
    expect(unmountCount).toBe(0);

    rpcMock.mockResolvedValueOnce(snapshot());
    revalidate();
    await waitFor(() =>
      expect(screen.queryByTestId('permission-revalidation-blocker')).not.toBeInTheDocument()
    );
    expect(mountCount).toBe(1);
    expect(unmountCount).toBe(0);
  });

  it('still shows the denial card when a successful revalidation reports a revocation', async () => {
    rpcMock.mockResolvedValueOnce(snapshot());
    render(<Protected />);
    await screen.findByText('panel-content');

    rpcMock.mockResolvedValueOnce(snapshot({ permission_keys: [] }));
    revalidate();

    await waitFor(() => expect(screen.getByText('ليس لديك صلاحية')).toBeInTheDocument());
    expect(screen.queryByText('panel-content')).not.toBeInTheDocument();
    expect(screen.queryByTestId('permission-revalidation-blocker')).not.toBeInTheDocument();
    expect(unmountCount).toBe(1);
  });

  it('renders a custom fallback instead of the denial card when one is supplied', async () => {
    const WithFallback = withPermission(Panel, {
      module: 'sales',
      action: 'write',
      fallback: () => <span>custom-fallback</span>,
    });

    rpcMock.mockResolvedValueOnce(snapshot());
    render(<WithFallback />);

    await waitFor(() => expect(screen.getByText('custom-fallback')).toBeInTheDocument());
    expect(screen.queryByText('panel-content')).not.toBeInTheDocument();
  });

  it('renders nothing when access is denied and showError is off', async () => {
    const Silent = withPermission(Panel, {
      module: 'sales',
      action: 'write',
      showError: false,
    });

    rpcMock.mockResolvedValueOnce(snapshot());
    const { container } = render(<Silent />);

    await waitFor(() => expect(screen.queryByText('panel-content')).not.toBeInTheDocument());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});

describe('PermissionGuard — transient permission revalidation failure (#239)', () => {
  it('keeps the guarded children mounted behind the blocker and recovers in place', async () => {
    rpcMock.mockResolvedValueOnce(snapshot());
    render(
      <PermissionGuard module="sales" action="read">
        <Panel />
      </PermissionGuard>
    );

    await screen.findByText('panel-content');
    await waitFor(() => expect(mountCount).toBe(1));

    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'network blip' } });
    revalidate();

    await waitFor(() =>
      expect(screen.getByTestId('permission-revalidation-blocker')).toBeInTheDocument()
    );
    expect(screen.getByText('panel-content')).toBeInTheDocument();
    expect(unmountCount).toBe(0);

    rpcMock.mockResolvedValueOnce(snapshot());
    revalidate();
    await waitFor(() =>
      expect(screen.queryByTestId('permission-revalidation-blocker')).not.toBeInTheDocument()
    );
    expect(mountCount).toBe(1);
    expect(unmountCount).toBe(0);
  });

  it('falls back — and never blocks — when a successful revalidation revokes access', async () => {
    rpcMock.mockResolvedValueOnce(snapshot());
    render(
      <PermissionGuard module="sales" action="read" fallback={<span>guard-fallback</span>}>
        <Panel />
      </PermissionGuard>
    );

    await screen.findByText('panel-content');

    rpcMock.mockResolvedValueOnce(snapshot({ permission_keys: [] }));
    revalidate();

    await waitFor(() => expect(screen.getByText('guard-fallback')).toBeInTheDocument());
    expect(screen.queryByText('panel-content')).not.toBeInTheDocument();
    expect(screen.queryByTestId('permission-revalidation-blocker')).not.toBeInTheDocument();
    expect(unmountCount).toBe(1);
  });

  it('renders null when access is denied and no fallback is supplied', async () => {
    rpcMock.mockResolvedValueOnce(snapshot());
    const { container } = render(
      <PermissionGuard module="sales" action="write">
        <Panel />
      </PermissionGuard>
    );

    await waitFor(() => expect(screen.queryByText('panel-content')).not.toBeInTheDocument());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
