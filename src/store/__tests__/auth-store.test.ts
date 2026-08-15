/**
 * RED→GREEN for removing the client-side demo-login bypass in
 * useAuthStore.login() (src/store/auth-store.ts), tied to the
 * demo-credentials hard-coded-password fix
 * (SonarCloud typescript:S2068, src/config/demo-credentials.ts).
 *
 * Before the fix, `login()` compared the submitted email/password against
 * DEMO_CREDENTIALS.admin literally and — in a dev build — fabricated an
 * authenticated session locally with no call to Supabase at all. Now that
 * demo-credentials.ts no longer carries any password value, that path
 * must be gone entirely: submitting the historical demo admin credentials
 * must always fall through to the real Supabase call, never to a
 * locally-fabricated session.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSignInWithPassword = vi.fn().mockResolvedValue({
  data: { user: null },
  error: { message: 'Invalid login credentials' },
})

vi.mock('@/lib/config', () => ({
  loadConfig: vi.fn(() => Promise.resolve({ FEATURES: {} })),
}))

vi.mock('../../lib/supabase', () => ({
  getSupabase: () => ({
    auth: {
      signInWithPassword: mockSignInWithPassword,
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    },
  }),
}))

describe('auth-store login(): no client-side demo bypass', () => {
  beforeEach(() => {
    mockSignInWithPassword.mockClear()
    vi.resetModules()
  })

  it('submitting the historical demo admin credentials never fabricates a local session — it always calls Supabase', async () => {
    const { useAuthStore } = await import('@/store/auth-store')

    await useAuthStore.getState().login('admin@wardah.sa', 'admin123')

    // The old bypass set isAuthenticated straight to true with no network call.
    // The only legitimate way to become authenticated now is a real Supabase call.
    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: 'admin@wardah.sa',
      password: 'admin123',
    })
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(useAuthStore.getState().user).toBeNull()
  })

  it('the source no longer references DEMO_CREDENTIALS inside login() at all', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync('src/store/auth-store.ts', 'utf8')
    const loginFnMatch = src.match(/login:\s*async[\s\S]*?\n\s{6}\},\n/)
    expect(loginFnMatch).not.toBeNull()
    expect(loginFnMatch![0]).not.toMatch(/DEMO_CREDENTIALS/)
  })
})
