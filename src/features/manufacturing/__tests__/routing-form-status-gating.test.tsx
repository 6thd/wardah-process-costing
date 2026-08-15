// src/features/manufacturing/__tests__/routing-form-status-gating.test.tsx
//
// Round 6 P1 proved status couldn't be tampered through the create/update
// form even when manufacturing.stages.create/.update were the write gate.
// Round 7 P1 overturns the gate itself: routingService.ts reads/writes
// `routings`, `routing_operations` and `operation_resources` — tables with
// no relationship to manufacturing_stages beyond both living under
// Manufacturing. No manufacturing.routing.* key exists in the live catalog,
// so create and update must both be hard fail-closed regardless of any
// stages.* grant (mirrors route-permissions.ts's unregistered /routing/new
// and /routing/:id, and RoutingManagement.tsx's read/write gating). This
// file proves: (1) the create/update mutation gateway is never invoked no
// matter what stages.* keys are held, and (2) the edit-mode single-routing
// read is never fetched either — no accepted read permission exists.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hasPermissionKeyMock = vi.fn((_key: string) => false);
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermissionKey: (key: string) => hasPermissionKeyMock(key) }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

vi.mock('@/lib/supabase', () => ({
  getEffectiveTenantId: () => Promise.resolve('org-1'),
}));

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: toastError, success: vi.fn() } }));

const createRoutingMutateAsync = vi.fn().mockResolvedValue({ id: 'routing-new', routing_code: 'RT-NEW' });
const updateRoutingMutateAsync = vi.fn().mockResolvedValue({ id: 'routing-1' });
const useRoutingMock = vi.fn();

const EXISTING_ROUTING = {
  id: 'routing-1',
  routing_code: 'RT-001',
  routing_name: 'Main Routing',
  routing_name_ar: 'المسار الرئيسي',
  version: 1,
  status: 'DRAFT' as const,
  is_active: true,
  effective_date: '2026-01-01',
};

vi.mock('@/hooks/manufacturing/useRouting', () => ({
  useRouting: (...args: unknown[]) => useRoutingMock(...args),
  useCreateRouting: () => ({
    mutateAsync: createRoutingMutateAsync,
    isPending: false,
  }),
  useUpdateRouting: () => ({
    mutateAsync: updateRoutingMutateAsync,
    isPending: false,
  }),
}));

import { RoutingForm } from '../routing/RoutingForm';

function setPermissions(keys: readonly string[]) {
  hasPermissionKeyMock.mockImplementation((key: string) => keys.includes(key));
}

function renderNew() {
  return render(
    <MemoryRouter initialEntries={['/manufacturing/routing/new']}>
      <Routes>
        <Route path="/manufacturing/routing/new" element={<RoutingForm />} />
      </Routes>
    </MemoryRouter>
  );
}

function renderEdit() {
  return render(
    <MemoryRouter initialEntries={[`/manufacturing/routing/${EXISTING_ROUTING.id}`]}>
      <Routes>
        <Route path="/manufacturing/routing/:id" element={<RoutingForm />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionKeyMock.mockReturnValue(false);
  useRoutingMock.mockReturnValue({ data: undefined, isLoading: false });
});

describe('Round 7 P1: RoutingForm — create/update hard fail-closed; no manufacturing.routing.* key exists', () => {
  it('never renders an editable status control on the create form', async () => {
    setPermissions(['manufacturing.stages.create']);
    renderNew();

    await waitFor(() => expect(screen.getByLabelText('routingForm.code *')).toBeInTheDocument());
    expect(screen.queryByRole('combobox', { name: /status/i })).not.toBeInTheDocument();
    expect(screen.queryByText('routingForm.statusApproved')).not.toBeInTheDocument();
    expect(screen.queryByText('routingForm.statusObsolete')).not.toBeInTheDocument();
  });

  it('submitting the create form with manufacturing.stages.create granted never calls the create gateway', async () => {
    setPermissions(['manufacturing.stages.create']);
    renderNew();

    await waitFor(() => expect(screen.getByLabelText('routingForm.code *')).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText('routingForm.code *'), 'RT-002');
    await userEvent.type(screen.getByLabelText('routingForm.nameEn *'), 'New Routing');
    await userEvent.click(screen.getByRole('button', { name: /routingForm.save/ }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(createRoutingMutateAsync).not.toHaveBeenCalled();
  });

  it('submitting the edit form with manufacturing.stages.update granted never calls the update gateway', async () => {
    setPermissions(['manufacturing.stages.update']);
    useRoutingMock.mockReturnValue({ data: EXISTING_ROUTING, isLoading: false });
    renderEdit();

    await waitFor(() => expect(screen.getByDisplayValue('RT-001')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /routingForm.save/ }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(updateRoutingMutateAsync).not.toHaveBeenCalled();
  });

  it('the edit-mode single-routing read is disabled — no accepted read permission exists for any stages.* grant', async () => {
    setPermissions([
      'manufacturing.stages.read',
      'manufacturing.stages.create',
      'manufacturing.stages.update',
    ]);
    renderEdit();

    await waitFor(() => expect(useRoutingMock).toHaveBeenCalled());
    const [, options] = useRoutingMock.mock.calls[0];
    expect(options).toMatchObject({ enabled: false });
  });
});
