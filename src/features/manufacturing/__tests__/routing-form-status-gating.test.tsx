// src/features/manufacturing/__tests__/routing-form-status-gating.test.tsx
//
// Round 6 P1: RoutingManagement correctly fails closed on approve (no
// manufacturing.stages.approve key exists in the live catalog), but
// RoutingForm still exposed an editable "status" selector and submitted it
// using only manufacturing.stages.create/.update. A user holding nothing
// but the create/update grant could set status=APPROVED (or OBSOLETE)
// directly through the form — a full bypass of the fail-closed approve gate.
//
// This file proves: (1) a new routing is always created as DRAFT regardless
// of any tampering with form state, and (2) editing an existing routing can
// never change its status through the general update form — the submitted
// payload must never contain a status field, so the database preserves
// whatever status the row already had.

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

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const createRoutingMutateAsync = vi.fn().mockResolvedValue({ id: 'routing-new', routing_code: 'RT-NEW' });
const updateRoutingMutateAsync = vi.fn().mockResolvedValue({ id: 'routing-1' });

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
  useRouting: (id: string) => ({
    data: id === EXISTING_ROUTING.id ? EXISTING_ROUTING : undefined,
    isLoading: false,
  }),
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
});

describe('RoutingForm — status cannot be set/changed through create/update grants alone', () => {
  it('never renders an editable status control on the create form', async () => {
    setPermissions(['manufacturing.stages.create']);
    renderNew();

    await waitFor(() => expect(screen.getByLabelText('routingForm.code *')).toBeInTheDocument());
    // No combobox/select for status must be reachable/settable by the user.
    expect(screen.queryByRole('combobox', { name: /status/i })).not.toBeInTheDocument();
    expect(screen.queryByText('routingForm.statusApproved')).not.toBeInTheDocument();
    expect(screen.queryByText('routingForm.statusObsolete')).not.toBeInTheDocument();
  });

  it('creating a routing with only manufacturing.stages.create always submits status=DRAFT', async () => {
    setPermissions(['manufacturing.stages.create']);
    renderNew();

    await waitFor(() => expect(screen.getByLabelText('routingForm.code *')).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText('routingForm.code *'), 'RT-002');
    await userEvent.type(screen.getByLabelText('routingForm.nameEn *'), 'New Routing');
    await userEvent.click(screen.getByRole('button', { name: /routingForm.save/ }));

    await waitFor(() => expect(createRoutingMutateAsync).toHaveBeenCalled());
    const submitted = createRoutingMutateAsync.mock.calls[0][0];
    expect(submitted.status).toBe('DRAFT');
  });

  it('never renders an editable status control on the edit form', async () => {
    setPermissions(['manufacturing.stages.update']);
    renderEdit();

    await waitFor(() => expect(screen.getByDisplayValue('RT-001')).toBeInTheDocument());
    expect(screen.queryByRole('combobox', { name: /status/i })).not.toBeInTheDocument();
    expect(screen.queryByText('routingForm.statusApproved')).not.toBeInTheDocument();
    expect(screen.queryByText('routingForm.statusObsolete')).not.toBeInTheDocument();
  });

  it('editing a routing with only manufacturing.stages.update never includes status in the update payload', async () => {
    setPermissions(['manufacturing.stages.update']);
    renderEdit();

    await waitFor(() => expect(screen.getByDisplayValue('RT-001')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /routingForm.save/ }));

    await waitFor(() => expect(updateRoutingMutateAsync).toHaveBeenCalled());
    const submitted = updateRoutingMutateAsync.mock.calls[0][0];
    expect(submitted.id).toBe('routing-1');
    expect(submitted.data).not.toHaveProperty('status');
  });
});
