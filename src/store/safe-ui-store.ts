import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'light' | 'dark' | 'system'
export type Language = 'ar' | 'en'

interface SafeUIState {
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
  currentSubPage: string
  
  // Preferences
  lastVisitedTab: string
  autoSaveEnabled: boolean
  compactMode: boolean
  
  // Actions
  setTheme: (theme: Theme) => void
  setLanguage: (language: Language) => void
  setSidebarCollapsed: (collapsed: boolean) => void
  setSidebarOpen: (open: boolean) => void
  setCurrentModule: (module: string) => void
  setCurrentSubPage: (subPage: string) => void
  setLastVisitedTab: (tab: string) => void
  setAutoSaveEnabled: (enabled: boolean) => void
  setCompactMode: (compact: boolean) => void
  setGlobalLoading: (loading: boolean) => void
  initializeApp: () => void
}

export const useSafeUIStore = create<SafeUIState>()(
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
      currentSubPage: '',
      lastVisitedTab: 'dashboard',
      autoSaveEnabled: true,
      compactMode: false,

      // Actions
      setTheme: (theme: Theme) => {
        console.log('🎨 Safe UI Store: Setting theme to', theme)
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
        console.log('🌍 Safe UI Store: Setting language to', language)
        set({ language })
        
        // Update document attributes
        document.documentElement.lang = language
        document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr'
      },

      setSidebarCollapsed: (collapsed: boolean) => {
        console.log('📱 Safe UI Store: Setting sidebar collapsed to', collapsed)
        set({ sidebarCollapsed: collapsed })
      },

      setSidebarOpen: (open: boolean) => {
        console.log('📱 Safe UI Store: Setting sidebar open to', open)
        set({ sidebarOpen: open })
      },

      setCurrentModule: (module: string) => {
        console.log('🧭 Safe UI Store: Setting current module to', module)
        set({ currentModule: module })
      },

      setCurrentSubPage: (subPage: string) => {
        console.log('📄 Safe UI Store: Setting current sub-page to', subPage)
        set({ currentSubPage: subPage })
      },

      setLastVisitedTab: (tab: string) => {
        console.log('🔖 Safe UI Store: Setting last visited tab to', tab)
        set({ lastVisitedTab: tab })
      },

      setAutoSaveEnabled: (enabled: boolean) => {
        console.log('💾 Safe UI Store: Setting auto-save to', enabled)
        set({ autoSaveEnabled: enabled })
      },

      setCompactMode: (compact: boolean) => {
        console.log('📐 Safe UI Store: Setting compact mode to', compact)
        set({ compactMode: compact })
      },

      setGlobalLoading: (loading: boolean) => {
        console.log('⏳ Safe UI Store: Setting global loading to', loading)
        set({ globalLoading: loading })
      },

      initializeApp: () => {
        console.log('🚀 Safe UI Store: Initializing application...')
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
        console.log('✅ Safe UI Store: App initialized successfully')
      },
    }),
    {
      name: 'safe-ui-storage',
      partialize: (state) => ({
        theme: state.theme,
        language: state.language,
        sidebarCollapsed: state.sidebarCollapsed,
        lastVisitedTab: state.lastVisitedTab,
        autoSaveEnabled: state.autoSaveEnabled,
        compactMode: state.compactMode,
      }),
    }
  )
)

// Export a simple initialization function
export const initializeSafeUI = () => {
  console.log('🔧 Initializing Safe UI Store...')
  useSafeUIStore.getState().initializeApp()
}