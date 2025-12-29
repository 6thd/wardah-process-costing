import { ReactNode, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { Header } from './header'
import { Sidebar } from './sidebar'
import { useUIStore } from '@/store/ui-store'
import { cn } from '@/lib/utils'

interface MainLayoutProps {
  readonly children: ReactNode
}

export function MainLayout({ children }: MainLayoutProps) {
  
  const { i18n } = useTranslation()
  const { sidebarCollapsed, sidebarOpen } = useUIStore()
  const isRTL = i18n.language === 'ar'

  // Helper function to get sidebar margin class
  const getSidebarMarginClass = (collapsed: boolean, rtl: boolean): string => {
    if (collapsed) return "lg:mx-0"
    return rtl ? "lg:mr-64" : "lg:ml-64"
  }

  // Update document direction when language changes
  useEffect(() => {
    try {
      document.documentElement.dir = isRTL ? 'rtl' : 'ltr'
      document.documentElement.lang = i18n.language
      
      // Add RTL class to body for additional styling
      if (isRTL) {
        document.body.classList.add('rtl')
        document.body.classList.remove('ltr')
      } else {
        document.body.classList.add('ltr')
        document.body.classList.remove('rtl')
      }
    } catch (error) {
      console.error('Error updating document direction:', error)
    }
  }, [isRTL, i18n.language])

  return (
    <div className="min-h-screen bg-background" dir={isRTL ? 'rtl' : 'ltr'}>
      <Header />
      
      <div className={cn("flex", isRTL && "flex-row-reverse")}>
        {/* Sidebar */}
        <Sidebar />
        
        {/* Main Content */}
        <main 
            className={cn(
            "flex-1 transition-all duration-300",
            "pt-16", // Account for fixed header
            getSidebarMarginClass(sidebarCollapsed, isRTL)
          )}
        >
          <div className={cn(
            "container mx-auto p-6",
            isRTL ? "text-right" : "text-left"
          )}>
            {children}
          </div>
        </main>
      </div>
      
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Close sidebar"
          className="fixed inset-0 bg-black/50 z-40 lg:hidden border-0 p-0 cursor-default"
          onClick={() => useUIStore.getState().setSidebarOpen(false)}
        />
      )}
    </div>
  )
}