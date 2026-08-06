/**
 * Tests for the isDevelopment() gate added around the demo-credentials
 * hint on the login page — it must never render outside development.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LoginPage } from '@/pages/login';

const mockGetSession = vi.fn().mockResolvedValue({ data: { session: null }, error: null });
const mockIsDevelopment = vi.fn();

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    auth: {
      getSession: mockGetSession,
      signInWithPassword: vi.fn(),
    },
  }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}));

vi.mock('@/config/demo-credentials', () => ({
  DEMO_CREDENTIALS: {
    admin: { email: 'admin@wardah.sa', password: 'admin123' },
  },
  isDevelopment: () => mockIsDevelopment(),
}));

describe('LoginPage demo-credentials gate', () => {
  beforeEach(() => {
    window.location.hash = '';
  });

  it('renders the demo-credentials hint in development', async () => {
    mockIsDevelopment.mockReturnValue(true);
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );

    expect(await screen.findByText(/admin@wardah\.sa/)).toBeInTheDocument();
    expect(screen.getByText(/admin123/)).toBeInTheDocument();
  });

  it('hides the demo-credentials hint outside development', () => {
    mockIsDevelopment.mockReturnValue(false);
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    );

    expect(screen.queryByText(/admin@wardah\.sa/)).not.toBeInTheDocument();
    expect(screen.queryByText(/admin123/)).not.toBeInTheDocument();
  });
});
