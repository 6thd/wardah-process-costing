/**
 * Tests for the demo-credentials hint on the login page.
 *
 * Tied to the SonarCloud typescript:S2068 fix (src/config/demo-credentials.ts):
 * there is no client-safe way to ship a demo password (a VITE_* value is
 * inlined into the built bundle just like a literal), so the hint must be
 * fail-closed — hidden whenever no safe password value is configured,
 * regardless of dev/prod mode — not merely gated on isDevelopment().
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LoginPage } from '@/pages/login';

const mockGetSession = vi.fn().mockResolvedValue({ data: { session: null }, error: null });
const mockSignInWithPassword = vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'Invalid login credentials' } });
const mockIsDevelopment = vi.fn();
let mockAdminPassword: string | null = null;

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    auth: {
      getSession: mockGetSession,
      signInWithPassword: mockSignInWithPassword,
    },
  }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}));

vi.mock('@/config/demo-credentials', () => ({
  get DEMO_CREDENTIALS() {
    return {
      admin: { email: 'admin@wardah.sa', password: mockAdminPassword },
    };
  },
  isDevelopment: () => mockIsDevelopment(),
}));

describe('LoginPage demo-credentials gate', () => {
  beforeEach(() => {
    window.location.hash = '';
    mockSignInWithPassword.mockClear();
    mockAdminPassword = null;
  });

  it('fails closed: hides the demo-credentials hint in development when no safe password is configured', async () => {
    mockIsDevelopment.mockReturnValue(true);
    mockAdminPassword = null; // today's real state — no client-safe value exists

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );

    // Not just the password — the whole hint, including the email, must stay hidden.
    expect(screen.queryByText(/بيانات تجريبية/)).not.toBeInTheDocument();
    expect(screen.queryByText(/admin@wardah\.sa/)).not.toBeInTheDocument();
  });

  it('renders the demo-credentials hint in development only when a safe password value is actually configured', async () => {
    mockIsDevelopment.mockReturnValue(true);
    mockAdminPassword = 'a-safe-value-from-a-future-server-mechanism';

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );

    expect(await screen.findByText(/admin@wardah\.sa/)).toBeInTheDocument();
    expect(screen.getByText(/a-safe-value-from-a-future-server-mechanism/)).toBeInTheDocument();
  });

  it('hides the demo-credentials hint outside development even if a password value were present', () => {
    mockIsDevelopment.mockReturnValue(false);
    mockAdminPassword = 'a-safe-value-from-a-future-server-mechanism';

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );

    expect(screen.queryByText(/admin@wardah\.sa/)).not.toBeInTheDocument();
  });

  it('normal login is unaffected: submitting real credentials still calls Supabase signInWithPassword', async () => {
    mockIsDevelopment.mockReturnValue(true);
    mockAdminPassword = null;

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );

    fireEvent.change(screen.getByLabelText('البريد الإلكتروني'), { target: { value: 'real.user@wardah.sa' } });
    fireEvent.change(screen.getByLabelText('كلمة المرور'), { target: { value: 'a-real-user-password' } });
    fireEvent.click(screen.getByRole('button', { name: /تسجيل الدخول/ }));

    await waitFor(() => expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: 'real.user@wardah.sa',
      password: 'a-real-user-password',
    }));
  });

  it('mounting the page with no safe demo config makes no login attempt on its own', async () => {
    mockIsDevelopment.mockReturnValue(true);
    mockAdminPassword = null;

    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );

    // Give any accidental effect a tick to fire, then assert nothing did.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockSignInWithPassword).not.toHaveBeenCalled();
  });
});
