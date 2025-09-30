import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { getSupabase } from '../lib/supabase'
import type { AuthError, AuthChangeEvent, Session } from '@supabase/supabase-js'
import { loadConfig } from '../lib/config'

// Define a separate AppUser interface to include custom properties like full_name
export interface AppUser {
  id: string;
  email?: string;
  role?: string;
  full_name?: string; // This can come from your 'users' table
  created_at?: string;
  updated_at?: string;
}

interface AuthState {
  user: AppUser | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  checkAuth: () => Promise<void>
  updateUser: (updates: Partial<AppUser>) => void
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
          
          await loadConfig()
          
          if (email === 'admin@wardah.sa' && password === 'admin123') {
            const mockUser: AppUser = {
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
            return
          }
          
          const client = await getSupabase();
          if (!client) throw new Error('Supabase client not initialized');
          
          const { data, error } = await client.auth.signInWithPassword({
            email,
            password,
          })

          if (error) {
            throw error
          }

          if (data.user) {
            const { data: profile, error: profileError } = await client
              .from('users')
              .select('*')
              .eq('id', data.user.id)
              .single()

            if (profileError) {
              const fallbackUser: AppUser = {
                id: data.user.id,
                email: data.user.email || '',
                full_name: data.user.user_metadata?.full_name || data.user.email?.split('@')[0] || 'User',
                role: 'employee',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              }
              
              set({ 
                user: fallbackUser, 
                isAuthenticated: true, 
                isLoading: false 
              })
              return
            }

            set({ 
              user: profile, 
              isAuthenticated: true, 
              isLoading: false 
            })
          }
        } catch (error) {
          let errorMessage = 'Login failed'
          if (error instanceof Error) {
            errorMessage = error.message
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
          const client = await getSupabase();
          if (!client) throw new Error('Supabase client not initialized');
          
          const { error } = await client.auth.signOut()
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
          const config = await loadConfig()
          if (config.FEATURES?.demo_mode) {
            const mockUser: AppUser = {
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
            return
          }
          
          const client = await getSupabase();
          if (!client) {
            set({ isLoading: false });
            return;
          }
          
          const { data: { session } } = await client.auth.getSession()
          
          if (session?.user) {
            try {
              const { data: profile, error } = await client
                .from('users')
                .select('*')
                .eq('id', session.user.id)
                .single()

              if (!error && profile) {
                set({ 
                  user: profile, 
                  isAuthenticated: true 
                })
              } else {
                const newUser: AppUser = {
                  id: session.user.id,
                  email: session.user.email || '',
                  full_name: session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'User',
                  role: session.user.user_metadata?.role || 'employee',
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString()
                }
                
                const { error: insertError } = await client
                  .from('users')
                  .insert([newUser])
                  
                if (insertError) {
                  const fallbackUser: AppUser = {
                    id: session.user.id,
                    email: session.user.email || '',
                    full_name: session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'User',
                    role: session.user.user_metadata?.role || 'employee',
                    created_at: session.user.created_at || new Date().toISOString(),
                    updated_at: new Date().toISOString()
                  }
                  
                  set({ 
                    user: fallbackUser, 
                    isAuthenticated: true 
                  })
                } else {
                  set({ 
                    user: newUser, 
                    isAuthenticated: true 
                  })
                }
              }
            } catch (tableError) {
              const fallbackUser: AppUser = {
                id: session.user.id,
                email: session.user.email || '',
                full_name: session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'User',
                role: session.user.user_metadata?.role || 'employee',
                created_at: session.user.created_at || new Date().toISOString(),
                updated_at: new Date().toISOString()
              }
              
              set({ 
                user: fallbackUser, 
                isAuthenticated: true 
              })
            }
          } else {
            set({ 
              user: null, 
              isAuthenticated: false 
            })
          }
        } catch (error) {
          console.error('Auth check failed:', error)
          set({ 
            user: null, 
            isAuthenticated: false 
          })
        } finally {
          set({ isLoading: false })
        }
      },

      updateUser: (updates: Partial<AppUser>) => {
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
getSupabase().then(client => {
  if (client) {
    client.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      if (event === 'SIGNED_OUT') {
        useAuthStore.getState().logout()
      } else if (event === 'SIGNED_IN' && session) {
        useAuthStore.getState().checkAuth()
      }
    })
  }
}).catch(error => {
  console.error('Failed to initialize auth state change listener:', error)
});
