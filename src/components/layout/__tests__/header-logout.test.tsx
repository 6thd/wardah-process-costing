import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  signOut: vi.fn(),
  navigate: vi.fn(),
  setState: vi.fn(),
  setSidebarOpen: vi.fn(),
  setSidebarCollapsed: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en' } }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1', email: 'user@example.com', user_metadata: {} },
    signOut: mocks.signOut,
  }),
}));

vi.mock('@/store/auth-store', () => {
  const useAuthStore = Object.assign(
    vi.fn(() => ({ user: null })),
    { setState: mocks.setState }
  );
  return { useAuthStore };
});

vi.mock('@/store/ui-store', () => ({
  useUIStore: () => ({
    setSidebarOpen: mocks.setSidebarOpen,
    setSidebarCollapsed: mocks.setSidebarCollapsed,
    sidebarCollapsed: false,
    notifications: [],
  }),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    variant: _variant,
    size: _size,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock('lucide-react', () => ({
  Menu: () => null,
}));

vi.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));
vi.mock('@/components/language-toggle', () => ({ LanguageToggle: () => null }));
vi.mock('@/components/organization-selector', () => ({ OrganizationSelector: () => null }));
vi.mock('@/components/layout/HeaderBrand', () => ({ HeaderBrand: () => null }));
vi.mock('@/components/layout/HeaderSearch', () => ({ HeaderSearch: () => null }));
vi.mock('@/components/layout/HeaderNotifications', () => ({ HeaderNotifications: () => null }));
vi.mock('@/components/layout/HeaderUserMenu', () => ({
  HeaderUserMenu: ({ onLogout }: { onLogout: () => Promise<void> }) => (
    <button type="button" data-testid="header-logout" onClick={() => void onLogout()}>
      logout
    </button>
  ),
}));

import { Header } from '@/components/layout/header';

describe('Header logout sequencing', () => {
  beforeEach(() => {
    mocks.signOut.mockReset();
    mocks.navigate.mockReset();
    mocks.setState.mockReset();
  });

  it('waits for AuthContext signOut, then clears only the Zustand mirror and navigates', async () => {
    let finishSignOut: (() => void) | undefined;
    mocks.signOut.mockImplementation(
      () =>
        new Promise<void>(resolve => {
          finishSignOut = resolve;
        })
    );

    render(<Header />);

    fireEvent.click(screen.getByTestId('header-logout'));
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledTimes(1));

    expect(mocks.setState).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();

    await act(async () => {
      finishSignOut?.();
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(mocks.setState).toHaveBeenCalledWith({
        user: null,
        isAuthenticated: false,
      })
    );
    expect(mocks.navigate).toHaveBeenCalledWith('/login');
  });
});
