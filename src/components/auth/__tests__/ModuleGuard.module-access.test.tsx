import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const usePermissionsMock = vi.fn();

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => usePermissionsMock(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { ModuleGuard } from '../ModuleGuard';

function renderGuard(action?: string) {
  render(
    <MemoryRouter initialEntries={['/sales']}>
      <Routes>
        <Route
          path="/sales"
          element={
            <ModuleGuard moduleCode="sales" action={action}>
              <div>sales-content</div>
            </ModuleGuard>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

describe('ModuleGuard — backend module snapshot contract', () => {
  beforeEach(() => {
    usePermissionsMock.mockReset();
    usePermissionsMock.mockReturnValue({
      hasPermission: vi.fn(() => false),
      hasModuleAccess: vi.fn(() => false),
      isOrgAdmin: false,
      isSuperAdmin: false,
      loading: false,
    });
  });

  it('allows a module when any exact backend key belongs to it', () => {
    usePermissionsMock.mockReturnValue({
      hasPermission: vi.fn(() => false),
      hasModuleAccess: vi.fn((moduleCode: string) => moduleCode === 'sales'),
      isOrgAdmin: false,
      isSuperAdmin: false,
      loading: false,
    });

    renderGuard();

    expect(screen.getByText('sales-content')).toBeInTheDocument();
  });

  it('fails closed when the snapshot contains no key for the module', () => {
    renderGuard();

    expect(screen.queryByText('sales-content')).not.toBeInTheDocument();
    expect(screen.getByText('auth.accessDenied')).toBeInTheDocument();
  });

  it('keeps an explicitly requested action narrower than module access', () => {
    const hasPermission = vi.fn(() => false);
    usePermissionsMock.mockReturnValue({
      hasPermission,
      hasModuleAccess: vi.fn(() => true),
      isOrgAdmin: false,
      isSuperAdmin: false,
      loading: false,
    });

    renderGuard('approve');

    expect(hasPermission).toHaveBeenCalledWith('sales', 'approve');
    expect(screen.queryByText('sales-content')).not.toBeInTheDocument();
  });
});
