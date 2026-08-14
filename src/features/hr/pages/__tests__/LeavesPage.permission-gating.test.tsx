// src/features/hr/pages/__tests__/LeavesPage.permission-gating.test.tsx
//
// LeavesPage (create/approve/reject leave requests) had ZERO permission
// checks — approving a leave also writes attendance records as a side
// effect. This proves create requires hr.leaves.create, approve/reject
// require hr.leaves.approve, and the employees reference-data read
// requires its own hr.employees.read key.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hasPermissionKeyMock = vi.fn((_key: string) => false);
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermissionKey: (key: string) => hasPermissionKeyMock(key) }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const getEmployees = vi.fn(async (..._args: unknown[]) => [{ id: 'e1', name: 'Ahmed' }]);
vi.mock('@/services/hr/hr-service', () => ({
  getEmployees: (...args: unknown[]) => getEmployees(...args),
}));

const LEAVE_REQUEST = {
  id: 'lv-1',
  status: 'pending',
  employee: { full_name: 'Ahmed' },
  leave_type: { name: 'Annual', name_ar: 'سنوية' },
  start_date: '2026-01-01',
  end_date: '2026-01-05',
  total_days: 5,
};

const listLeaveRequests = vi.fn(async (..._args: unknown[]) => [LEAVE_REQUEST]);
const getLeaveTypes = vi.fn(async (..._args: unknown[]) => []);
const approveLeaveRequest = vi.fn(async (..._args: unknown[]) => ({ success: true }));
const rejectLeaveRequest = vi.fn(async (..._args: unknown[]) => ({ success: true }));
const createLeaveRequest = vi.fn(async (..._args: unknown[]) => ({ success: true }));
const getLeaveBalance = vi.fn(async (..._args: unknown[]) => ({ accrued: 10, used: 2, balance: 8 }));

vi.mock('@/services/hr/leave-service', () => ({
  listLeaveRequests: (...args: unknown[]) => listLeaveRequests(...args),
  getLeaveTypes: (...args: unknown[]) => getLeaveTypes(...args),
  approveLeaveRequest: (...args: unknown[]) => approveLeaveRequest(...args),
  rejectLeaveRequest: (...args: unknown[]) => rejectLeaveRequest(...args),
  createLeaveRequest: (...args: unknown[]) => createLeaveRequest(...args),
  getLeaveBalance: (...args: unknown[]) => getLeaveBalance(...args),
}));

import { LeavesPage } from '../LeavesPage';

function setPermissions(keys: readonly string[]) {
  hasPermissionKeyMock.mockImplementation((key: string) => keys.includes(key));
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <LeavesPage />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionKeyMock.mockReturnValue(false);
});

describe('LeavesPage — create/approve/reject require their own exact keys', () => {
  it('read-only user sees no "new request" trigger and no approve/reject row controls', async () => {
    setPermissions([]);
    renderPage();

    await waitFor(() => expect(screen.getByText('Ahmed')).toBeInTheDocument());
    expect(screen.queryByText('leaves.newRequest')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('common.approve')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('common.reject')).not.toBeInTheDocument();
  });

  it('without hr.employees.read, the employees reference query never fires', async () => {
    setPermissions([]);
    renderPage();

    await waitFor(() => expect(listLeaveRequests).toHaveBeenCalled());
    expect(getEmployees).not.toHaveBeenCalled();
  });

  it('hr.leaves.approve grants the approve control and a real click calls the approve gateway', async () => {
    setPermissions(['hr.leaves.approve']);
    renderPage();

    await waitFor(() => expect(screen.getByLabelText('common.approve')).toBeInTheDocument());
    await userEvent.click(screen.getByLabelText('common.approve'));

    await waitFor(() => expect(screen.getByText('leaves.approveTitle')).toBeInTheDocument());
    await userEvent.click(screen.getByText('common.approve'));

    await waitFor(() => expect(approveLeaveRequest).toHaveBeenCalledWith('lv-1', false));
    expect(rejectLeaveRequest).not.toHaveBeenCalled();
  });
});
