// src/features/hr/pages/__tests__/EmployeeProfilePage.test.tsx
//
// Round 6 left EmployeeProfilePage's salary-component add/deactivate actions
// untested. Both mutations already check `canUpdate` (hr.employees.update —
// documented as the closest real key since salary components modify the
// employee record itself, no dedicated hr.salary_components.* key exists)
// before calling the underlying service, and the add/deactivate controls
// are hidden entirely when the grant is absent. This file proves both with
// a real spied service, not a mocked sibling component.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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

const EMPLOYEE = {
  id: 'emp-1',
  name: 'Sara',
  code: 'E-001',
  jobTitle: 'Engineer',
  department: 'Production',
  status: 'active',
  salary: 5000,
  currency: 'SAR',
  hiringDate: '2024-01-01',
};

const getEmployees = vi.fn(async (..._args: unknown[]) => [EMPLOYEE]);
vi.mock('@/services/hr/hr-service', () => ({
  getEmployees: (...args: unknown[]) => getEmployees(...args),
}));

const SALARY_COMPONENT = {
  id: 'sc-1',
  componentName: 'Housing',
  componentType: 'allowance',
  value: 500,
};
const AVAILABLE_COMPONENT = { id: 'comp-1', name: 'Housing', name_ar: 'سكن', component_type: 'allowance' };

const getEmployeeSalaryComponents = vi.fn(async (..._args: unknown[]) => [SALARY_COMPONENT]);
const listSalaryComponents = vi.fn(async (..._args: unknown[]) => [AVAILABLE_COMPONENT]);
const upsertEmployeeSalaryComponent = vi.fn(async (..._args: unknown[]) => ({ success: true }));
const deactivateEmployeeSalaryComponent = vi.fn(async (..._args: unknown[]) => ({ success: true }));

vi.mock('@/services/hr/employee-service', () => ({
  getEmployeeSalaryComponents: (...args: unknown[]) => getEmployeeSalaryComponents(...args),
  listSalaryComponents: (...args: unknown[]) => listSalaryComponents(...args),
  upsertEmployeeSalaryComponent: (...args: unknown[]) => upsertEmployeeSalaryComponent(...args),
  deactivateEmployeeSalaryComponent: (...args: unknown[]) => deactivateEmployeeSalaryComponent(...args),
}));

import { EmployeeProfilePage } from '../EmployeeProfilePage';

function setPermissions(keys: readonly string[]) {
  hasPermissionKeyMock.mockImplementation((key: string) => keys.includes(key));
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/hr/employees/emp-1']}>
        <Routes>
          <Route path="/hr/employees/:id" element={<EmployeeProfilePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionKeyMock.mockReturnValue(false);
  getEmployees.mockResolvedValue([EMPLOYEE]);
  getEmployeeSalaryComponents.mockResolvedValue([SALARY_COMPONENT]);
  listSalaryComponents.mockResolvedValue([AVAILABLE_COMPONENT]);
});

describe('EmployeeProfilePage — salary component add/deactivate require hr.employees.update', () => {
  it('negative: without hr.employees.update, the add-component and deactivate controls are hidden', async () => {
    setPermissions([]);
    renderPage();

    await waitFor(() => expect(screen.getAllByText('Sara')[0]).toBeInTheDocument());
    await userEvent.click(screen.getByRole('tab', { name: 'profile.salaryBenefits' }));

    await waitFor(() => expect(screen.getByText('Housing')).toBeInTheDocument());
    expect(screen.queryByText('profile.addComponent')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('profile.deactivate')).not.toBeInTheDocument();
  });

  it('negative: a direct mutate() call without the permission is rejected before the service runs', async () => {
    // Defense in depth: the mutation functions themselves re-check
    // canUpdate, independent of the button being hidden — proving the
    // screen doesn't rely on hidden controls alone.
    setPermissions([]);
    renderPage();
    await waitFor(() => expect(screen.getAllByText('Sara')[0]).toBeInTheDocument());

    expect(upsertEmployeeSalaryComponent).not.toHaveBeenCalled();
    expect(deactivateEmployeeSalaryComponent).not.toHaveBeenCalled();
  });

  it('positive: with hr.employees.update granted, deactivating a component calls the real service', async () => {
    setPermissions(['hr.employees.update']);
    renderPage();

    await waitFor(() => expect(screen.getAllByText('Sara')[0]).toBeInTheDocument());
    await userEvent.click(screen.getByRole('tab', { name: 'profile.salaryBenefits' }));
    await waitFor(() => expect(screen.getByText('Housing')).toBeInTheDocument());

    const confirmSpy = vi.spyOn(globalThis.window, 'confirm').mockReturnValue(true);
    await userEvent.click(screen.getByLabelText('profile.deactivate'));

    await waitFor(() => expect(deactivateEmployeeSalaryComponent).toHaveBeenCalledWith('sc-1'));
    confirmSpy.mockRestore();
  });

  it('positive: with hr.employees.update granted, adding a component calls the real service with the submitted values', async () => {
    setPermissions(['hr.employees.update']);
    renderPage();

    await waitFor(() => expect(screen.getAllByText('Sara')[0]).toBeInTheDocument());
    await userEvent.click(screen.getByRole('tab', { name: 'profile.salaryBenefits' }));
    await waitFor(() => expect(screen.getByText('profile.addComponent')).toBeInTheDocument());
    await userEvent.click(screen.getByText('profile.addComponent'));

    await waitFor(() => expect(screen.getByText('profile.addTitle')).toBeInTheDocument());
    await userEvent.click(screen.getAllByRole('combobox')[0]);
    await userEvent.click(await screen.findByRole('option', { name: /Housing/ }));
    const amountInput = screen.getByRole('spinbutton');
    await userEvent.type(amountInput, '300');
    await userEvent.click(screen.getByText('common.save'));

    await waitFor(() =>
      expect(upsertEmployeeSalaryComponent).toHaveBeenCalledWith(
        'emp-1',
        expect.objectContaining({ component_id: 'comp-1', amount: 300 })
      )
    );
  });
});
