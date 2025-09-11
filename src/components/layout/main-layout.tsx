import { ReactNode, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { Header } from './header'
import { Sidebar } from './sidebar'
import { useUIStore } from '@/store/ui-store'
import { cn } from '@/lib/utils'

interface MainLayoutProps {
  children: ReactNode
}

export function MainLayout({ children }: MainLayoutProps) {
  const { i18n } = useTranslation()
  const { sidebarCollapsed, sidebarOpen } = useUIStore()
  const isRTL = i18n.language === 'ar'

  // Update document direction when language changes
  useEffect(() => {
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
            sidebarCollapsed 
              ? "lg:mx-0" 
              : isRTL 
                ? "lg:mr-64" 
                : "lg:ml-64"
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
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => useUIStore.getState().setSidebarOpen(false)}
        />
      )}
    </div>
  )
}