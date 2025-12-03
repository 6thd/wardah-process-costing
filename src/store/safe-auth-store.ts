import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { safeStorageAdapter } from '@/lib/safe-storage'

export interface SafeUser {
  id: string
  email: string
  full_name: string
  role: 'admin' | 'manager' | 'employee'
  created_at: string
  updated_at: string
}

interface SafeAuthState {
  user: SafeUser | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null
  
  // Actions
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  updateUser: (updates: Partial<SafeUser>) => void
  clearError: () => void
}

// Demo users for testing (no external dependencies)
const DEMO_USERS: Record<string, { password: string; user: SafeUser }> = {
  'admin@wardah.sa': {
    password: 'admin123',
    user: {
      id: 'demo-admin-1',
      email: 'admin@wardah.sa',
      full_name: 'مدير النظام',
      role: 'admin',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  },
  'manager@wardah.sa': {
    password: 'manager123',
    user: {
      id: 'demo-manager-1',
      email: 'manager@wardah.sa',
      full_name: 'مدير الإنتاج',
      role: 'manager',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  },
  'employee@wardah.sa': {
    password: 'employee123',
    user: {
      id: 'demo-employee-1',
      email: 'employee@wardah.sa',
      full_name: 'موظف النظام',
      role: 'employee',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  }
}

export const useSafeAuthStore = create<SafeAuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,

      login: async (email: string, password: string) => {
        try {
          set({ isLoading: true, error: null })
          console.log('🔑 Safe Auth Store: Attempting login for:', email)
          
          // Simulate network delay
          await new Promise(resolve => setTimeout(resolve, 800))
          
          // Check demo credentials
          const demoAccount = DEMO_USERS[email]
          if (!demoAccount) {
            throw new Error('Invalid email address')
          }
          
          if (demoAccount.password !== password) {
            throw new Error('Invalid password')
          }
          
          console.log('✅ Safe Auth Store: Login successful for:', email)
          set({ 
            user: demoAccount.user, 
            isAuthenticated: true, 
            isLoading: false 
          })
          
        } catch (error) {
          console.error('❌ Safe Auth Store: Login failed:', error)
          
          let errorMessage = 'Login failed'
          if (error instanceof Error) {
            errorMessage = error.message
          }
          
          set({ 
            error: errorMessage, 
            isLoading: false 
          })
        }
      },

      logout: () => {
        console.log('🚪 Safe Auth Store: Logging out user')
        set({ 
          user: null, 
          isAuthenticated: false,
          error: null
        })
      },

      updateUser: (updates: Partial<SafeUser>) => {
        const { user } = get()
        if (user) {
          console.log('👤 Safe Auth Store: Updating user:', updates)
          set({ user: { ...user, ...updates, updated_at: new Date().toISOString() } })
        }
      },

      clearError: () => {
        console.log('🧹 Safe Auth Store: Clearing error')
        set({ error: null })
      },
    }),
    {
      name: 'safe-auth-storage',
      storage: createJSONStorage(() => safeStorageAdapter),
      partialize: (state) => ({ 
        user: state.user, 
        isAuthenticated: state.isAuthenticated 
      }),
    }
  )
)

// Export demo credentials for reference
export const DEMO_CREDENTIALS = {
  admin: { email: 'admin@wardah.sa', password: 'admin123' },
  manager: { email: 'manager@wardah.sa', password: 'manager123' },
  employee: { email: 'employee@wardah.sa', password: 'employee123' }
}