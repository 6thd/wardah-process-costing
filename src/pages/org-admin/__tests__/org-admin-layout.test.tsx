import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useAuthMock = vi.fn();
const usePermissionsMock = vi.fn();

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => usePermissionsMock(),
}));

import OrgAdminLayout from '../index';

function renderLayout() {
  render(
    <MemoryRouter initialEntries={['/org-admin/roles']}>
      <Routes>
        <Route path="/org-admin" element={<OrgAdminLayout />}>
          <Route path="roles" element={<div>roles-screen</div>} />
        </Route>
        <Route path="/login" element={<div>login-screen</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('OrgAdminLayout — shared permission snapshot', () => {
  beforeEach(() => {
    useAuthMock.mockReset();
    usePermissionsMock.mockReset();
    useAuthMock.mockReturnValue({ user: { id: 'u1' }, loading: false });
    usePermissionsMock.mockReturnValue({
      isOrgAdmin: false,
      isSuperAdmin: false,
      loading: false,
    });
  });

  it('allows the org admin reported by the same snapshot used by navigation', () => {
    usePermissionsMock.mockReturnValue({
      isOrgAdmin: true,
      isSuperAdmin: false,
      loading: false,
    });

    renderLayout();

    expect(screen.getByText('roles-screen')).toBeInTheDocument();
  });

  it('allows a platform super admin', () => {
    usePermissionsMock.mockReturnValue({
      isOrgAdmin: false,
      isSuperAdmin: true,
      loading: false,
    });

    renderLayout();

    expect(screen.getByText('roles-screen')).toBeInTheDocument();
  });

  it('fails closed for an ordinary member', () => {
    renderLayout();

    expect(screen.queryByText('roles-screen')).not.toBeInTheDocument();
    expect(screen.getByText('غير مصرح بالوصول')).toBeInTheDocument();
  });
});
