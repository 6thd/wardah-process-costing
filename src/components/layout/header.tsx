import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { 
  Menu, Bell, User, Search, Settings, LogOut,
  Shield, Building2, KeyRound, Activity, 
  HelpCircle, UserCog, History, Smartphone
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuGroup,
  DropdownMenuShortcut,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { ThemeToggle } from '@/components/theme-toggle'
import { LanguageToggle } from '@/components/language-toggle'
import { OrganizationSelector } from '@/components/organization-selector'
import { useUIStore } from '@/store/ui-store'
import { useAuthStore } from '@/store/auth-store'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/utils'
import { getGlassClasses } from '@/lib/wardah-ui-utils'

export function Header() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { user: storeUser, logout: storeLogout } = useAuthStore()
  const { user: authUser, signOut } = useAuth()
  const { setSidebarOpen, setSidebarCollapsed, sidebarCollapsed, notifications } = useUIStore()

  // استخدام المستخدم من AuthContext أو AuthStore
  const user = authUser || storeUser
  const isRTL = i18n.language === 'ar'
  const unreadCount = notifications.filter(n => !n.read).length

  const handleSidebarToggle = () => {
    if (window.innerWidth < 1024) {
      setSidebarOpen(true)
    } else {
      setSidebarCollapsed(!sidebarCollapsed)
    }
  }

  // تسجيل الخروج
  const handleLogout = async () => {
    try {
      await signOut()
      storeLogout()
      navigate('/login')
    } catch (error) {
      console.error('Logout error:', error)
    }
  }

  const userFullName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'مستخدم';
  const userEmail = user?.email || '';
  const userAvatarFallback = userFullName?.charAt(0)?.toUpperCase();

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
          {/* Connection Status */}
          <div id="connectionStatus" className="text-sm text-gray-600 dark:text-gray-400">
            غير متصل
          </div>
          
          <ThemeToggle />
          <LanguageToggle />
          <OrganizationSelector />
          
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
            <DropdownMenuContent align={isRTL ? "start" : "end"} className={cn("w-80", getGlassClasses())}>
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

          {/* User Menu - قائمة المستخدم المتطورة */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-9 px-2 hover:bg-accent/50 transition-colors">
                <Avatar className="h-7 w-7 ring-2 ring-primary/20">
                  <AvatarImage src={user?.user_metadata?.avatar_url || undefined} />
                  <AvatarFallback className="text-xs bg-gradient-to-br from-primary to-primary/60 text-primary-foreground">
                    {userAvatarFallback}
                  </AvatarFallback>
                </Avatar>
                <span className={cn(
                  "hidden md:inline-block text-sm font-medium",
                  isRTL ? "mr-2" : "ml-2"
                )}>
                  {userFullName}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent 
              align={isRTL ? "start" : "end"} 
              className={cn("w-72", getGlassClasses())}
              sideOffset={8}
            >
              {/* معلومات المستخدم */}
              <DropdownMenuLabel className="p-4">
                <div className={cn("flex items-center gap-3", isRTL ? "flex-row-reverse" : "")}>
                  <Avatar className="h-12 w-12 ring-2 ring-primary/30">
                    <AvatarImage src={user?.user_metadata?.avatar_url || undefined} />
                    <AvatarFallback className="text-lg bg-gradient-to-br from-primary to-primary/60 text-primary-foreground">
                      {userAvatarFallback}
                    </AvatarFallback>
                  </Avatar>
                  <div className={cn("flex flex-col", isRTL ? "items-end" : "items-start")}>
                    <span className="font-semibold text-base">{userFullName}</span>
                    <span className="text-xs text-muted-foreground">{userEmail}</span>
                    <Badge variant="secondary" className="mt-1 text-[10px]">
                      <Shield className="h-3 w-3 mr-1" />
                      {isRTL ? 'مسؤول المنظمة' : 'Org Admin'}
                    </Badge>
                  </div>
                </div>
              </DropdownMenuLabel>
              
              <DropdownMenuSeparator />
              
              {/* إدارة الحساب */}
              <DropdownMenuGroup>
                <DropdownMenuLabel className={cn("text-xs text-muted-foreground px-2", isRTL ? "text-right" : "")}>
                  {isRTL ? 'إدارة الحساب' : 'Account Management'}
                </DropdownMenuLabel>
                
                <DropdownMenuItem 
                  onClick={() => navigate('/settings/profile')}
                  className={cn("cursor-pointer", isRTL ? "flex-row-reverse" : "")}
                >
                  <User className={cn("h-4 w-4", isRTL ? "ml-2" : "mr-2")} />
                  <span className="flex-1">{isRTL ? 'الملف الشخصي' : 'My Profile'}</span>
                  <DropdownMenuShortcut>⌘P</DropdownMenuShortcut>
                </DropdownMenuItem>
                
                <DropdownMenuItem 
                  onClick={() => navigate('/settings/preferences')}
                  className={cn("cursor-pointer", isRTL ? "flex-row-reverse" : "")}
                >
                  <UserCog className={cn("h-4 w-4", isRTL ? "ml-2" : "mr-2")} />
                  <span className="flex-1">{isRTL ? 'تفضيلات الحساب' : 'Preferences'}</span>
                </DropdownMenuItem>
                
                <DropdownMenuItem 
                  onClick={() => navigate('/settings/security')}
                  className={cn("cursor-pointer", isRTL ? "flex-row-reverse" : "")}
                >
                  <KeyRound className={cn("h-4 w-4", isRTL ? "ml-2" : "mr-2")} />
                  <span className="flex-1">{isRTL ? 'الأمان وكلمة المرور' : 'Security'}</span>
                </DropdownMenuItem>
              </DropdownMenuGroup>
              
              <DropdownMenuSeparator />
              
              {/* إدارة المنظمة */}
              <DropdownMenuGroup>
                <DropdownMenuLabel className={cn("text-xs text-muted-foreground px-2", isRTL ? "text-right" : "")}>
                  {isRTL ? 'إدارة المنظمة' : 'Organization'}
                </DropdownMenuLabel>
                
                <DropdownMenuItem 
                  onClick={() => navigate('/org-admin/users')}
                  className={cn("cursor-pointer", isRTL ? "flex-row-reverse" : "")}
                >
                  <Building2 className={cn("h-4 w-4", isRTL ? "ml-2" : "mr-2")} />
                  <span className="flex-1">{isRTL ? 'إدارة المستخدمين' : 'Manage Users'}</span>
                </DropdownMenuItem>
                
                <DropdownMenuItem 
                  onClick={() => navigate('/org-admin/roles')}
                  className={cn("cursor-pointer", isRTL ? "flex-row-reverse" : "")}
                >
                  <Shield className={cn("h-4 w-4", isRTL ? "ml-2" : "mr-2")} />
                  <span className="flex-1">{isRTL ? 'الأدوار والصلاحيات' : 'Roles & Permissions'}</span>
                </DropdownMenuItem>
                
                <DropdownMenuItem 
                  onClick={() => navigate('/settings')}
                  className={cn("cursor-pointer", isRTL ? "flex-row-reverse" : "")}
                >
                  <Settings className={cn("h-4 w-4", isRTL ? "ml-2" : "mr-2")} />
                  <span className="flex-1">{isRTL ? 'الإعدادات' : 'Settings'}</span>
                  <DropdownMenuShortcut>⌘S</DropdownMenuShortcut>
                </DropdownMenuItem>
              </DropdownMenuGroup>
              
              <DropdownMenuSeparator />
              
              {/* النشاط والدعم */}
              <DropdownMenuGroup>
                <DropdownMenuItem 
                  onClick={() => navigate('/activity-log')}
                  className={cn("cursor-pointer", isRTL ? "flex-row-reverse" : "")}
                >
                  <History className={cn("h-4 w-4", isRTL ? "ml-2" : "mr-2")} />
                  <span className="flex-1">{isRTL ? 'سجل النشاط' : 'Activity Log'}</span>
                </DropdownMenuItem>
                
                <DropdownMenuItem 
                  onClick={() => navigate('/active-sessions')}
                  className={cn("cursor-pointer", isRTL ? "flex-row-reverse" : "")}
                >
                  <Smartphone className={cn("h-4 w-4", isRTL ? "ml-2" : "mr-2")} />
                  <span className="flex-1">{isRTL ? 'الجلسات النشطة' : 'Active Sessions'}</span>
                  <Badge variant="secondary" className="text-[10px]">2</Badge>
                </DropdownMenuItem>
                
                <DropdownMenuItem 
                  onClick={() => window.open('https://docs.wardah.sa', '_blank')}
                  className={cn("cursor-pointer", isRTL ? "flex-row-reverse" : "")}
                >
                  <HelpCircle className={cn("h-4 w-4", isRTL ? "ml-2" : "mr-2")} />
                  <span className="flex-1">{isRTL ? 'المساعدة والدعم' : 'Help & Support'}</span>
                </DropdownMenuItem>
              </DropdownMenuGroup>
              
              <DropdownMenuSeparator />
              
              {/* تسجيل الخروج */}
              <DropdownMenuItem 
                onClick={handleLogout} 
                className={cn(
                  "cursor-pointer text-destructive focus:text-destructive focus:bg-destructive/10",
                  isRTL ? "flex-row-reverse" : ""
                )}
              >
                <LogOut className={cn("h-4 w-4", isRTL ? "ml-2" : "mr-2")} />
                <span className="flex-1">{isRTL ? 'تسجيل الخروج' : 'Sign Out'}</span>
                <DropdownMenuShortcut>⇧⌘Q</DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}