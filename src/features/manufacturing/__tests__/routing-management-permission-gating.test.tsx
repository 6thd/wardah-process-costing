// src/features/manufacturing/__tests__/routing-management-permission-gating.test.tsx
//
// Round 6 accepted manufacturing.stages.create/.update/.delete as a "nearest
// resource" stand-in for routing writes, and its own test file title said so
// explicitly. Round 7 overturns that: routingService.ts reads/writes
// `routings`, `routing_operations` and `operation_resources` — tables with
// no relationship to manufacturing_stages beyond both living under
// Manufacturing. No manufacturing.routing.* key exists in the live catalog,
// so a manufacturing.stages.* grant must not create, update, delete, copy or
// even read a single routing row. This mirrors route-permissions.ts's
// /routing, /routing/new and /routing/:id entries, which are unregistered
// for the same reason and fail closed at ModuleGuard — this file proves the
// component itself is fail-closed too, in case anything ever reaches it
// without going through ModuleGuard.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hasPermissionKeyMock = vi.fn((_key: string) => false);
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermissionKey: (key: string) => hasPermissionKeyMock(key) }),
}));

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

vi.mock('@/store/auth-store', () => ({
  useAuthStore: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('@/lib/supabase', () => ({
  getEffectiveTenantId: () => Promise.resolve('org-1'),
}));

const deleteRoutingMutate = vi.fn();
const approveRoutingMutate = vi.fn();
const copyRoutingMutate = vi.fn();
const useRoutingsMock = vi.fn();

const ROUTING = {
  id: 'routing-1',
  routing_code: 'RT-001',
  routing_name: 'Main Routing',
  routing_name_ar: 'المسار الرئيسي',
  version: 1,
  status: 'DRAFT',
  is_active: true,
  effective_date: '2026-01-01',
};

vi.mock('@/hooks/manufacturing/useRouting', () => ({
  useRoutings: (...args: unknown[]) => useRoutingsMock(...args),
  useDeleteRouting: () => ({ mutate: (...args: unknown[]) => deleteRoutingMutate(...args) }),
  useApproveRouting: () => ({ mutate: (...args: unknown[]) => approveRoutingMutate(...args) }),
  useCopyRouting: () => ({ mutate: (...args: unknown[]) => copyRoutingMutate(...args) }),
}));

import { RoutingManagement } from '../routing/RoutingManagement';

function setPermissions(keys: readonly string[]) {
  hasPermissionKeyMock.mockImplementation((key: string) => keys.includes(key));
}

function renderList() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <RoutingManagement />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionKeyMock.mockReturnValue(false);
  useRoutingsMock.mockReturnValue({ data: [ROUTING], isLoading: false, refetch: vi.fn() });
});

describe('Round 7 P1: RoutingManagement — no manufacturing.routing.* key exists; read and every write fail closed regardless of stages.* grants', () => {
  it('calls useRoutings with enabled:false even when the caller holds every stages.* key — the list read itself has no defensible key', async () => {
    setPermissions([
      'manufacturing.stages.read',
      'manufacturing.stages.create',
      'manufacturing.stages.update',
      'manufacturing.stages.delete',
    ]);
    renderList();

    await waitFor(() => expect(useRoutingsMock).toHaveBeenCalled());
    const [, options] = useRoutingsMock.mock.calls[0];
    expect(options).toMatchObject({ enabled: false });
  });

  it('hides the create trigger, delete, and copy actions even with every stages.* key granted', async () => {
    setPermissions([
      'manufacturing.stages.read',
      'manufacturing.stages.create',
      'manufacturing.stages.update',
      'manufacturing.stages.delete',
    ]);
    renderList();

    await waitFor(() => expect(screen.getByText('RT-001')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'routingMgmt.newRouting' })).not.toBeInTheDocument();
    // Only the "refresh" button remains — no create/edit/delete/copy/approve action is reachable.
    expect(screen.queryAllByRole('button')).toHaveLength(1);
  });

  it('a stages.delete grant does not call the delete gateway — delete is hard fail-closed, not gated on the nearest key', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    setPermissions(['manufacturing.stages.read', 'manufacturing.stages.delete']);
    renderList();

    await waitFor(() => expect(screen.getByText('RT-001')).toBeInTheDocument());
    const deleteBtn = screen.queryAllByRole('button').find((b) => b.className.includes('text-red-600'));
    expect(deleteBtn).toBeUndefined();
    expect(deleteRoutingMutate).not.toHaveBeenCalled();
  });

  it('a stages.create grant does not offer copy and does not call the copy gateway', async () => {
    setPermissions(['manufacturing.stages.read', 'manufacturing.stages.create']);
    renderList();

    await waitFor(() => expect(screen.getByText('RT-001')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'routingMgmt.newRouting' })).not.toBeInTheDocument();
    expect(copyRoutingMutate).not.toHaveBeenCalled();
  });

  it('approve is never offered regardless of permission — no manufacturing.stages.approve exists in the live catalog', async () => {
    setPermissions([
      'manufacturing.stages.read',
      'manufacturing.stages.create',
      'manufacturing.stages.update',
      'manufacturing.stages.delete',
      // Even a stray grant for a key that has no equivalent in the live catalog must not open the gate.
      'manufacturing.stages.approve',
    ]);
    renderList();

    await waitFor(() => expect(screen.getByText('RT-001')).toBeInTheDocument());
    const approveButtons = screen.queryAllByRole('button').filter((b) => b.className.includes('text-green-600'));
    expect(approveButtons).toHaveLength(0);
    expect(approveRoutingMutate).not.toHaveBeenCalled();
  });
});
