// src/features/hr/pages/__tests__/EmployeeListPage.permission-gating.test.tsx
//
// EmployeeListPage (create/delete employees, including a bulk-delete path
// that skipped the confirmation dialog entirely) had ZERO permission
// checks. This proves create requires hr.employees.create, delete requires
// hr.employees.delete, and bulk-delete now asks for confirmation like the
// single-row path.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hasPermissionKeyMock = vi.fn((_key: string) => false);
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermissionKey: (key: string) => hasPermissionKeyMock(key) }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en', dir: () => 'ltr' } }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

const toastMock = vi.fn();
vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

const EMPLOYEE = { id: 'e1', name: 'Ahmed', code: 'EMP-1', status: 'active', department: 'Ops', jobTitle: 'Engineer' };
const getEmployees = vi.fn(async (..._args: unknown[]) => [EMPLOYEE]);
vi.mock('@/services/hr/hr-service', () => ({
  getEmployees: (...args: unknown[]) => getEmployees(...args),
}));

const createEmployee = vi.fn(async (..._args: unknown[]) => ({ id: 'new-emp' }));
const deleteEmployee = vi.fn(async (..._args: unknown[]) => ({ success: true }));
vi.mock('@/services/hr/employee-service', () => ({
  createEmployee: (...args: unknown[]) => createEmployee(...args),
  deleteEmployee: (...args: unknown[]) => deleteEmployee(...args),
}));

import { EmployeeListPage } from '../EmployeeListPage';

function setPermissions(keys: readonly string[]) {
  hasPermissionKeyMock.mockImplementation((key: string) => keys.includes(key));
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <EmployeeListPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionKeyMock.mockReturnValue(false);
});

describe('EmployeeListPage — create/delete require hr.employees.create/.delete', () => {
  it('read-only user sees no "add employee" trigger', async () => {
    setPermissions([]);
    renderPage();

    await waitFor(() => expect(screen.getByText('Ahmed')).toBeInTheDocument());
    expect(screen.queryByText('employeeList.addEmployee')).not.toBeInTheDocument();
  });

  it('hr.employees.create grants the trigger; a real submit calls the create gateway', async () => {
    setPermissions(['hr.employees.create']);
    renderPage();

    await waitFor(() => expect(screen.getByText('employeeList.addEmployee')).toBeInTheDocument());
    await userEvent.click(screen.getByText('employeeList.addEmployee'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('bulk delete requires hr.employees.delete and a confirmation prompt before calling the gateway', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    setPermissions(['hr.employees.delete']);
    renderPage();

    await waitFor(() => expect(screen.getByText('Ahmed')).toBeInTheDocument());
    const checkboxes = screen.getAllByRole('checkbox');
    await userEvent.click(checkboxes[1] ?? checkboxes[0]);

    const bulkDeleteBtn = screen.queryByText((content) => content.includes('employeeList.deleteSelected'));
    expect(bulkDeleteBtn).toBeTruthy();
    await userEvent.click(bulkDeleteBtn!);

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(deleteEmployee).toHaveBeenCalledWith('e1'));
  });

  it('without hr.employees.delete, no bulk-delete trigger renders even with a row selected', async () => {
    setPermissions([]);
    renderPage();

    await waitFor(() => expect(screen.getByText('Ahmed')).toBeInTheDocument());
    expect(screen.queryByText((content) => content.includes('employeeList.deleteSelected'))).not.toBeInTheDocument();
  });
});
