/**
 * Tests for the login page after removing the demo-credentials feature.
 *
 * Tied to the SonarCloud typescript:S2068 fix: there is no client-safe way
 * to ship a demo password (a VITE_* value is inlined into the built bundle
 * just like a literal), so rather than leaving a dead conditional path
 * waiting for a future "safe" value, the demo-credentials hint and its
 * backing config (src/config/demo-credentials.ts) were removed entirely.
 * A future demo-login experience needs a server-side design that never
 * returns the password to the client at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LoginPage } from '@/pages/login';

const mockGetSession = vi.fn().mockResolvedValue({ data: { session: null }, error: null });
const mockSignInWithPassword = vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'Invalid login credentials' } });

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

describe('LoginPage', () => {
  beforeEach(() => {
    window.location.hash = '';
    mockSignInWithPassword.mockClear();
  });

  it('never renders any demo-credentials hint — the feature and its backing config were removed', () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );

    expect(screen.queryByText(/بيانات تجريبية/)).not.toBeInTheDocument();
    expect(screen.queryByText(/admin@wardah\.sa/)).not.toBeInTheDocument();
    expect(screen.queryByText(/manager@wardah\.sa/)).not.toBeInTheDocument();
    expect(screen.queryByText(/employee@wardah\.sa/)).not.toBeInTheDocument();
  });

  it('the source no longer imports the removed demo-credentials module', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/pages/login.tsx', 'utf8');
    expect(src).not.toMatch(/demo-credentials/);
  });

  it('normal login is unaffected: submitting real credentials still calls Supabase signInWithPassword', async () => {
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

  it('mounting the page makes no login attempt on its own', async () => {
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
