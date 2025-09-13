import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { supabase, type User } from '../lib/supabase'
import type { AuthError, AuthChangeEvent, Session } from '@supabase/supabase-js'

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  checkAuth: () => Promise<void>
  updateUser: (updates: Partial<User>) => void
  clearError: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,

      login: async (email: string, password: string) => {
        try {
          set({ isLoading: true, error: null })
          
          console.log('🔑 Attempting login for:', email)
          
          // Always try demo credentials first in development
          // This hardcoded credential check should be removed before deploying to production
          if (email === 'admin@wardah.sa' && password === 'admin123') {
            console.log('⚠️ USING DEMO CREDENTIALS - REMOVE BEFORE PRODUCTION')
            const mockUser: User = {
              id: 'demo-user-1',
              email: 'admin@wardah.sa',
              full_name: 'مدير النظام',
              role: 'admin',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            }
            
            set({ 
              user: mockUser, 
              isAuthenticated: true, 
              isLoading: false 
            })
            console.log('✅ Demo login successful')
            return
          }
          
          console.log('🔄 Attempting Supabase authentication...')
          
          // Actual Supabase authentication
          const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
          })

          if (error) {
            console.log('❌ Supabase auth error:', error)
            throw error
          }

          console.log('✅ Supabase auth successful for:', data.user?.email)

          if (data.user) {
            console.log('🔍 Fetching user profile from database...')
            
            // Get user profile from your users table
            const { data: profile, error: profileError } = await supabase
              .from('users')
              .select('*')
              .eq('id', data.user.id)
              .single()

            if (profileError) {
              console.log('⚠️ Profile fetch failed:', profileError.message)
              console.log('🔄 Creating fallback user profile...')
              
              // Fallback: create basic user profile from auth data
              const fallbackUser: User = {
                id: data.user.id,
                email: data.user.email || '',
                full_name: data.user.email?.split('@')[0] || 'User',
                role: 'employee',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              }
              
              set({ 
                user: fallbackUser, 
                isAuthenticated: true, 
                isLoading: false 
              })
              console.log('✅ Fallback login successful')
              return
            }

            console.log('✅ User profile loaded:', profile.email)
            set({ 
              user: profile, 
              isAuthenticated: true, 
              isLoading: false 
            })
          }
        } catch (error) {
          console.error('Login error details:', {
            error,
            message: (error as AuthError).message,
            status: (error as any)?.status,
            code: (error as any)?.code
          })
          
          let errorMessage = 'Login failed'
          if (error instanceof Error) {
            errorMessage = error.message
            
            // Provide more specific error messages
            if (errorMessage.includes('Invalid login credentials')) {
              errorMessage = 'Invalid email or password. Please check your credentials.'
            } else if (errorMessage.includes('Email not confirmed')) {
              errorMessage = 'Please check your email and confirm your account.'
            } else if (errorMessage.includes('Too many requests')) {
              errorMessage = 'Too many login attempts. Please try again later.'
            }
          }
          
          set({ 
            error: errorMessage, 
            isLoading: false 
          })
        }
      },

      logout: async () => {
        try {
          const { error } = await supabase.auth.signOut()
          if (error) throw error
          
          set({ 
            user: null, 
            isAuthenticated: false 
          })
        } catch (error) {
          set({ error: (error as AuthError).message })
        }
      },

      checkAuth: async () => {
        try {
          set({ isLoading: true })
          console.log('🔍 Checking authentication status...')
          
          // In demo mode, we can simulate an authenticated user
          const configResponse = await fetch('/config.json')
          if (configResponse.ok) {
            const config = await configResponse.json()
            console.log('🔧 Config loaded:', config)
            if (config.FEATURES?.demo_mode) {
              console.log('⚠️ DEMO MODE: Simulating authenticated user')
              // In demo mode, we can create a mock user
              const mockUser: User = {
                id: 'demo-user-1',
                email: 'admin@wardah.sa',
                full_name: 'مدير النظام',
                role: 'admin',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              }
              
              set({ 
                user: mockUser, 
                isAuthenticated: true,
                isLoading: false
              })
              console.log('✅ Demo user authenticated')
              return
            }
          }
          
          const { data: { session } } = await supabase.auth.getSession()
          console.log('Session data:', session)
          
          if (session?.user) {
            const { data: profile, error } = await supabase
              .from('users')
              .select('*')
              .eq('id', session.user.id)
              .single()

            if (!error && profile) {
              console.log('✅ User profile loaded from session:', profile.email)
              set({ 
                user: profile, 
                isAuthenticated: true 
              })
            } else {
              console.log('⚠️ Profile fetch failed, creating fallback user profile...')
              // Fallback: create basic user profile from session data
              const fallbackUser: User = {
                id: session.user.id,
                email: session.user.email || '',
                full_name: session.user.email?.split('@')[0] || 'User',
                role: 'employee',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              }
              
              set({ 
                user: fallbackUser, 
                isAuthenticated: true 
              })
              console.log('✅ Fallback user profile created')
            }
          } else {
            // No session, ensure we're not authenticated
            console.log('⚠️ No active session found')
            set({ 
              user: null, 
              isAuthenticated: false 
            })
          }
        } catch (error) {
          console.error('Auth check failed:', error)
          // In case of error, ensure we have a clean state
          set({ 
            user: null, 
            isAuthenticated: false 
          })
        } finally {
          set({ isLoading: false })
        }
      },

      updateUser: (updates: Partial<User>) => {
        const { user } = get()
        if (user) {
          set({ user: { ...user, ...updates } })
        }
      },

      clearError: () => {
        set({ error: null })
      },
    }),
    {
      name: 'wardah-auth',
      partialize: (state) => ({ 
        user: state.user, 
        isAuthenticated: state.isAuthenticated 
      }),
    }
  )
)

// Initialize auth check on app load
supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
  console.log('🔄 Auth state changed:', event, session?.user?.email || 'no user')
  if (event === 'SIGNED_OUT') {
    useAuthStore.getState().logout()
  } else if (event === 'SIGNED_IN' && session) {
    useAuthStore.getState().checkAuth()
  }
})