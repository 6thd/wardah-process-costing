import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMocks = vi.hoisted(() => {
  const callbackState = {
    current: undefined as undefined | ((event: string, session: unknown) => Promise<void> | void),
  };

  const secondEq = vi.fn();
  const firstEq = vi.fn(() => ({ eq: secondEq }));
  const select = vi.fn(() => ({ eq: firstEq }));
  const from = vi.fn(() => ({ select }));

  const getSession = vi.fn();
  const signOut = vi.fn();
  const refreshSession = vi.fn();
  const unsubscribe = vi.fn();
  const onAuthStateChange = vi.fn(
    (callback: (event: string, session: unknown) => Promise<void> | void) => {
      callbackState.current = callback;
      return { data: { subscription: { unsubscribe } } };
    }
  );

  return {
    callbackState,
    from,
    getSession,
    signOut,
    refreshSession,
    onAuthStateChange,
    secondEq,
  };
});

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    from: supabaseMocks.from,
    auth: {
      getSession: supabaseMocks.getSession,
      signOut: supabaseMocks.signOut,
      refreshSession: supabaseMocks.refreshSession,
      onAuthStateChange: supabaseMocks.onAuthStateChange,
    },
  }),
}));

import { AuthProvider, useAuth } from '@/contexts/AuthContext';

const authUser = {
  id: 'user-1',
  email: 'user@example.com',
  created_at: '2026-09-22T00:00:00.000Z',
  user_metadata: {},
};

function Probe() {
  const { user, signOut } = useAuth();

  return (
    <div>
      <span data-testid="auth-state">{user ? 'signed-in' : 'signed-out'}</span>
      <button type="button" onClick={() => void signOut()}>
        sign out
      </button>
    </div>
  );
}

describe('AuthContext sign-out completion', () => {
  beforeEach(() => {
    supabaseMocks.callbackState.current = undefined;
    supabaseMocks.getSession.mockReset();
    supabaseMocks.signOut.mockReset();
    supabaseMocks.refreshSession.mockReset();
    supabaseMocks.secondEq.mockReset();

    supabaseMocks.secondEq.mockResolvedValue({ data: [], error: null });
    supabaseMocks.refreshSession.mockResolvedValue({ data: { session: null }, error: null });
  });

  it('keeps authenticated UI state until Supabase has actually removed the persisted session', async () => {
    supabaseMocks.getSession.mockResolvedValue({
      data: { session: { user: authUser } },
      error: null,
    });

    let finishRemoteSignOut: (() => void) | undefined;
    supabaseMocks.signOut.mockImplementation(
      () =>
        new Promise(resolve => {
          finishRemoteSignOut = () => resolve({ error: null });
        })
    );

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByTestId('auth-state')).toHaveTextContent('signed-in'));

    fireEvent.click(screen.getByRole('button', { name: 'sign out' }));
    await waitFor(() => expect(supabaseMocks.signOut).toHaveBeenCalledTimes(1));

    // This is the regression lock: a hard navigation here must not be able to
    // rehydrate a still-live Supabase session after the UI already says logout.
    expect(screen.getByTestId('auth-state')).toHaveTextContent('signed-in');

    await act(async () => {
      finishRemoteSignOut?.();
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByTestId('auth-state')).toHaveTextContent('signed-out'));
  });

  it('handles an auth-driven SIGNED_OUT event and clears tenant-scoped local state', async () => {
    supabaseMocks.getSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    await waitFor(() => expect(supabaseMocks.callbackState.current).toBeTypeOf('function'));

    await act(async () => {
      await supabaseMocks.callbackState.current?.('SIGNED_OUT', null);
    });

    expect(screen.getByTestId('auth-state')).toHaveTextContent('signed-out');
    expect(localStorage.removeItem).toHaveBeenCalledWith('current_org_id');
  });
});
