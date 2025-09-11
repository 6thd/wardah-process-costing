import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface User {
  id: string
  email: string
  name: string
  role: 'admin' | 'manager' | 'user'
  permissions: string[]
  avatar?: string
  company?: {
    id: string
    name: string
    logo?: string
  }
}

interface AuthState {
  user: User | null
  isLoading: boolean
  error: string | null
  
  // Actions
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  checkAuth: () => Promise<void>
  updateUser: (updates: Partial<User>) => void
  clearError: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isLoading: false,
      error: null,

      login: async (email: string, password: string) => {
        set({ isLoading: true, error: null })
        
        try {
          // Simulate API call - replace with actual authentication
          await new Promise(resolve => setTimeout(resolve, 1000))
          
          // Demo user - replace with actual API response
          if (email === 'admin@wardah.sa' && password === 'admin123') {
            const user: User = {
              id: '1',
              email: 'admin@wardah.sa',
              name: 'مدير النظام',
              role: 'admin',
              permissions: ['*'], // All permissions
              company: {
                id: '1',
                name: 'مصنع وردة للمنتجات البلاستيكية',
              }
            }
            
            set({ user, isLoading: false })
          } else {
            throw new Error('Invalid credentials')
          }
        } catch (error) {
          set({ 
            error: error instanceof Error ? error.message : 'Login failed',
            isLoading: false 
          })
        }
      },

      logout: () => {
        set({ user: null, error: null })
      },

      checkAuth: async () => {
        const { user } = get()
        if (!user) return
        
        set({ isLoading: true })
        
        try {
          // Simulate token validation - replace with actual API call
          await new Promise(resolve => setTimeout(resolve, 500))
          set({ isLoading: false })
        } catch (error) {
          set({ user: null, isLoading: false })
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
      name: 'auth-storage',
      partialize: (state) => ({ user: state.user }),
    }
  )
)