import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/theme-toggle'
import { LanguageToggle } from '@/components/language-toggle'
import { OrganizationSelector } from '@/components/organization-selector'
import { useUIStore } from '@/store/ui-store'
import { useAuthStore } from '@/store/auth-store'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/utils'
import { HeaderBrand } from './HeaderBrand'
import { HeaderSearch } from './HeaderSearch'
import { HeaderNotifications } from './HeaderNotifications'
import { HeaderUserMenu } from './HeaderUserMenu'

export function Header() {
  const { i18n } = useTranslation()
  const navigate = useNavigate()
  const { user: storeUser, logout: storeLogout } = useAuthStore()
  const { user: authUser, signOut } = useAuth()
  const { setSidebarOpen, setSidebarCollapsed, sidebarCollapsed, notifications } = useUIStore()

  const user = authUser || storeUser
  const isRTL = i18n.language === 'ar'

  const handleSidebarToggle = () => {
    if (globalThis.window?.innerWidth && globalThis.window.innerWidth < 1024) {
      setSidebarOpen(true)
    } else {
      setSidebarCollapsed(!sidebarCollapsed)
    }
  }

  const handleLogout = async () => {
    try {
      await signOut()
      storeLogout()
      navigate('/login')
    } catch (error) {
      console.error('Logout error:', error)
    }
  }

  return (
    <header className="fixed top-0 left-0 right-0 h-16 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border z-50">
      <div className={cn(
        "flex items-center justify-between h-full px-4 lg:px-6",
        isRTL ? "flex-row-reverse" : "flex-row"
      )}>
        {/* Left Section (Right in RTL) */}
        <div className={cn(
          "flex items-center gap-4",
          isRTL ? "flex-row-reverse" : "flex-row"
        )}>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSidebarToggle}
            className="h-9 w-9 p-0"
          >
            <Menu className="h-4 w-4" />
          </Button>
          
          <HeaderBrand isRTL={isRTL} />
        </div>

        <HeaderSearch isRTL={isRTL} />

        {/* Right Section (Left in RTL) */}
        <div className={cn(
          "flex items-center gap-2",
          isRTL ? "flex-row-reverse" : "flex-row"
        )}>
          {/* Connection Status */}
          <div id="connectionStatus" className="text-sm text-gray-600 dark:text-gray-400">
            غير متصل
          </div>
          
          <ThemeToggle />
          <LanguageToggle />
          <OrganizationSelector />
          
          <HeaderNotifications notifications={notifications} isRTL={isRTL} />
          <HeaderUserMenu user={user} onLogout={handleLogout} isRTL={isRTL} />
        </div>
      </div>
    </header>
  )
}