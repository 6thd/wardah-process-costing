/**
 * Auth-store behavior locks.
 *
 * These tests exercise the live user_profiles hydration path so profile
 * identity and session fallback stay covered behavior, not source-shape only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSignInWithPassword = vi.fn()
const mockGetSession = vi.fn()
const mockMaybeSingle = vi.fn()
const mockEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }))
const mockSelect = vi.fn(() => ({ eq: mockEq }))
const mockFrom = vi.fn(() => ({ select: mockSelect }))
const mockUnsubscribe = vi.fn()

vi.mock('@/lib/config', () => ({
  loadConfig: vi.fn(() => Promise.resolve({ FEATURES: {} })),
}))

vi.mock('../../lib/supabase', () => ({
  getSupabase: () => ({
    auth: {
      signInWithPassword: mockSignInWithPassword,
      getSession: mockGetSession,
      signOut: vi.fn().mockResolvedValue({ error: null }),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: mockUnsubscribe } },
      })),
    },
    from: mockFrom,
  }),
}))

const authUser = {
  id: 'auth-user-1',
  email: 'session@example.test',
  created_at: '2026-09-01T00:00:00.000Z',
  user_metadata: {
    full_name: 'Session Name',
    role: 'employee',
  },
}

const profile = {
  user_id: authUser.id,
  email: 'profile@example.test',
  full_name: 'Profile Name',
  created_at: '2026-09-02T00:00:00.000Z',
  updated_at: '2026-09-03T00:00:00.000Z',
}

async function freshStore() {
  vi.resetModules()
  const { useAuthStore } = await import('@/store/auth-store')
  useAuthStore.setState({
    user: null,
    isAuthenticated: false,
    isLoading: false,
    error: null,
  })
  return useAuthStore
}

describe('auth-store profile hydration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSignInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { message: 'Invalid login credentials' },
    })
    mockGetSession.mockResolvedValue({ data: { session: null } })
    mockMaybeSingle.mockResolvedValue({ data: null, error: null })
  })

  it('submitting the historical demo credentials still goes through Supabase', async () => {
    const useAuthStore = await freshStore()

    await useAuthStore.getState().login('admin@wardah.sa', 'admin123')

    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: 'admin@wardah.sa',
      password: 'admin123',
    })
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(useAuthStore.getState().user).toBeNull()
  })

  it('login hydrates the live user_profiles row by auth user_id while preserving auth identity', async () => {
    mockSignInWithPassword.mockResolvedValue({
      data: { user: authUser },
      error: null,
    })
    mockMaybeSingle.mockResolvedValue({ data: profile, error: null })

    const useAuthStore = await freshStore()
    await useAuthStore.getState().login(authUser.email, 'irrelevant-test-secret')

    expect(mockFrom).toHaveBeenCalledWith('user_profiles')
    expect(mockSelect).toHaveBeenCalledWith('user_id, email, full_name, created_at, updated_at')
    expect(mockEq).toHaveBeenCalledWith('user_id', authUser.id)
    expect(useAuthStore.getState().user).toEqual({
      id: authUser.id,
      email: profile.email,
      full_name: profile.full_name,
      role: 'employee',
      created_at: profile.created_at,
      updated_at: profile.updated_at,
    })
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(useAuthStore.getState().isLoading).toBe(false)
  })

  it('login falls back to the signed session when the profile read fails', async () => {
    mockSignInWithPassword.mockResolvedValue({
      data: { user: authUser },
      error: null,
    })
    mockMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'profile unavailable' },
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const useAuthStore = await freshStore()
    await useAuthStore.getState().login(authUser.email, 'irrelevant-test-secret')

    expect(useAuthStore.getState().user).toMatchObject({
      id: authUser.id,
      email: authUser.email,
      full_name: authUser.user_metadata.full_name,
      role: authUser.user_metadata.role,
      created_at: authUser.created_at,
    })
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('checkAuth hydrates an existing session from user_profiles without writing a profile', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: authUser } },
    })
    mockMaybeSingle.mockResolvedValue({ data: profile, error: null })

    const useAuthStore = await freshStore()
    await useAuthStore.getState().checkAuth()

    expect(mockFrom).toHaveBeenCalledWith('user_profiles')
    expect(mockEq).toHaveBeenCalledWith('user_id', authUser.id)
    expect(useAuthStore.getState().user).toMatchObject({
      id: authUser.id,
      email: profile.email,
      full_name: profile.full_name,
    })
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(useAuthStore.getState().isLoading).toBe(false)
  })

  it('checkAuth keeps the session authenticated when profile hydration returns an error', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: authUser } },
    })
    mockMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'profile unavailable' },
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const useAuthStore = await freshStore()
    await useAuthStore.getState().checkAuth()

    expect(useAuthStore.getState().user).toMatchObject({
      id: authUser.id,
      email: authUser.email,
      full_name: authUser.user_metadata.full_name,
    })
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('the login implementation contains no client-side demo credential bypass', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync('src/store/auth-store.ts', 'utf8')
    const loginFnMatch = src.match(/login:\s*async[\s\S]*?\n\s{6}\},\n/)
    expect(loginFnMatch).not.toBeNull()
    expect(loginFnMatch![0]).not.toMatch(/DEMO_CREDENTIALS/)
  })
})
