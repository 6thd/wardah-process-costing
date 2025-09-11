import { useTranslation } from 'react-i18next'
import { Menu, Bell, User, Search, Settings, LogOut } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { ThemeToggle } from '@/components/theme-toggle'
import { LanguageToggle } from '@/components/language-toggle'

import { useUIStore } from '@/store/ui-store'
import { useAuthStore } from '@/store/auth-store'
import { cn } from '@/lib/utils'

export function Header() {
  const { t, i18n } = useTranslation()
  const { user, logout } = useAuthStore()
  const { setSidebarOpen, setSidebarCollapsed, sidebarCollapsed, notifications } = useUIStore()

  const isRTL = i18n.language === 'ar'
  const unreadCount = notifications.filter(n => !n.read).length

  const handleSidebarToggle = () => {
    // On mobile, toggle sidebar open/close
    // On desktop, toggle collapsed state
    if (window.innerWidth < 1024) {
      setSidebarOpen(true)
    } else {
      setSidebarCollapsed(!sidebarCollapsed)
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
          
          <div className={cn(
            "hidden lg:flex items-center gap-2",
            isRTL ? "flex-row-reverse" : "flex-row"
          )}>
            <h1 className={cn(
              "text-xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent",
              isRTL ? "text-right" : "text-left"
            )}>
              {t('app.name')}
            </h1>
            <Badge variant="secondary" className="text-xs">
              {t('app.version')}
            </Badge>
          </div>
        </div>

        {/* Center Section - Search */}
        <div className="hidden md:flex flex-1 max-w-md mx-4">
          <div className="relative w-full">
            <Search className={cn(
              "absolute top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground",
              isRTL ? "right-3" : "left-3"
            )} />
            <Input
              placeholder={t('common.search')}
              className={cn(
                "bg-muted/50",
                isRTL ? "pr-10 text-right" : "pl-10 text-left"
              )}
              dir={isRTL ? 'rtl' : 'ltr'}
            />
          </div>
        </div>

        {/* Right Section (Left in RTL) */}
        <div className={cn(
          "flex items-center gap-2",
          isRTL ? "flex-row-reverse" : "flex-row"
        )}>
          <ThemeToggle />
          <LanguageToggle />
          
          {/* Notifications */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-9 w-9 p-0 relative">
                <Bell className="h-4 w-4" />
                {unreadCount > 0 && (
                  <Badge className={cn(
                    "absolute h-5 w-5 rounded-full p-0 text-xs",
                    isRTL ? "-left-1 -top-1" : "-right-1 -top-1"
                  )}>
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align={isRTL ? "start" : "end"} className="w-80">
              <DropdownMenuLabel className={isRTL ? "text-right" : "text-left"}>
                {t('dashboard.recentActivities')}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {notifications.length === 0 ? (
                <div className={cn(
                  "p-4 text-center text-muted-foreground",
                  isRTL ? "text-right" : "text-left"
                )}>
                  {t('messages.noDataFound')}
                </div>
              ) : (
                notifications.slice(0, 5).map((notification) => (
                  <DropdownMenuItem key={notification.id} className={cn(
                    "flex-col items-start p-3",
                    isRTL ? "text-right" : "text-left"
                  )}>
                    <div className={cn(
                      "flex items-center gap-2 w-full",
                      isRTL ? "flex-row-reverse" : "flex-row"
                    )}>
                      <div className={`w-2 h-2 rounded-full ${
                        notification.type === 'success' ? 'bg-success' :
                        notification.type === 'error' ? 'bg-destructive' :
                        notification.type === 'warning' ? 'bg-warning' :
                        'bg-info'
                      }`} />
                      <span className="font-medium text-sm">{notification.title}</span>
                      {!notification.read && (
                        <div className={cn(
                          "w-2 h-2 bg-primary rounded-full",
                          isRTL ? "mr-auto" : "ml-auto"
                        )} />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {notification.message}
                    </p>
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* User Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-9 px-2">
                <Avatar className="h-7 w-7">
                  <AvatarImage src={user?.avatar} />
                  <AvatarFallback className="text-xs">
                    {user?.name.charAt(0)}
                  </AvatarFallback>
                </Avatar>
                <span className={cn(
                  "hidden md:inline-block text-sm",
                  isRTL ? "mr-2" : "ml-2"
                )}>
                  {user?.name}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align={isRTL ? "start" : "end"}>
              <DropdownMenuLabel className={isRTL ? "text-right" : "text-left"}>
                <div className="flex flex-col">
                  <span>{user?.name}</span>
                  <span className="text-xs text-muted-foreground">{user?.email}</span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem className={isRTL ? "text-right" : "text-left"}>
                <User className={cn("h-4 w-4", isRTL ? "ml-2" : "mr-2")} />
                {t('settings.users')}
              </DropdownMenuItem>
              <DropdownMenuItem className={isRTL ? "text-right" : "text-left"}>
                <Settings className={cn("h-4 w-4", isRTL ? "ml-2" : "mr-2")} />
                {t('navigation.settings')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem 
                onClick={logout} 
                className={cn(
                  "text-destructive",
                  isRTL ? "text-right" : "text-left"
                )}
              >
                <LogOut className={cn("h-4 w-4", isRTL ? "ml-2" : "mr-2")} />
                {t('auth.logout')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}