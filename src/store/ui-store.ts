import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'light' | 'dark' | 'system'
export type Language = 'ar' | 'en'

interface UIState {
  // Theme and appearance
  theme: Theme
  language: Language
  sidebarCollapsed: boolean
  sidebarOpen: boolean // For mobile
  
  // Loading states
  isInitialized: boolean
  globalLoading: boolean
  
  // Navigation
  currentModule: string
  breadcrumbs: Array<{ label: string; href?: string }>
  
  // Notifications
  notifications: Array<{
    id: string
    type: 'success' | 'error' | 'warning' | 'info'
    title: string
    message: string
    timestamp: Date
    read: boolean
  }>
  
  // Actions
  setTheme: (theme: Theme) => void
  setLanguage: (language: Language) => void
  setSidebarCollapsed: (collapsed: boolean) => void
  setSidebarOpen: (open: boolean) => void
  setCurrentModule: (module: string) => void
  setBreadcrumbs: (breadcrumbs: Array<{ label: string; href?: string }>) => void
  addNotification: (notification: Omit<UIState['notifications'][0], 'id' | 'timestamp' | 'read'>) => void
  markNotificationRead: (id: string) => void
  clearNotifications: () => void
  setGlobalLoading: (loading: boolean) => void
  initializeApp: () => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      // Initial state
      theme: 'system',
      language: 'ar',
      sidebarCollapsed: false,
      sidebarOpen: false,
      isInitialized: false,
      globalLoading: false,
      currentModule: 'dashboard',
      breadcrumbs: [],
      notifications: [],

      // Actions
      setTheme: (theme: Theme) => {
        set({ theme })
        
        // Apply theme to document
        const root = document.documentElement
        if (theme === 'system') {
          root.classList.remove('light', 'dark')
        } else {
          root.classList.remove('light', 'dark')
          root.classList.add(theme)
        }
      },

      setLanguage: (language: Language) => {
        set({ language })
        
        // Update document attributes
        document.documentElement.lang = language
        document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr'
      },

      setSidebarCollapsed: (collapsed: boolean) => {
        set({ sidebarCollapsed: collapsed })
      },

      setSidebarOpen: (open: boolean) => {
        set({ sidebarOpen: open })
      },

      setCurrentModule: (module: string) => {
        set({ currentModule: module })
      },

      setBreadcrumbs: (breadcrumbs: Array<{ label: string; href?: string }>) => {
        set({ breadcrumbs })
      },

      addNotification: (notification) => {
        const id = Math.random().toString(36).substr(2, 9)
        const newNotification = {
          ...notification,
          id,
          timestamp: new Date(),
          read: false,
        }
        
        set((state) => ({
          notifications: [newNotification, ...state.notifications].slice(0, 50) // Keep only latest 50
        }))
      },

      markNotificationRead: (id: string) => {
        set((state) => ({
          notifications: state.notifications.map(n => 
            n.id === id ? { ...n, read: true } : n
          )
        }))
      },

      clearNotifications: () => {
        set({ notifications: [] })
      },

      setGlobalLoading: (loading: boolean) => {
        set({ globalLoading: loading })
      },

      initializeApp: () => {
        const { theme, language } = get()
        
        // Apply theme
        const root = document.documentElement
        if (theme === 'system') {
          root.classList.remove('light', 'dark')
        } else {
          root.classList.remove('light', 'dark')
          root.classList.add(theme)
        }
        
        // Apply language
        document.documentElement.lang = language
        document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr'
        
        set({ isInitialized: true })
      },
    }),
    {
      name: 'ui-storage',
      partialize: (state) => ({
        theme: state.theme,
        language: state.language,
        sidebarCollapsed: state.sidebarCollapsed,
      }),
    }
  )
)