import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Eye, EyeOff, LogIn } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuthStore } from '@/store/auth-store'
import { useUIStore } from '@/store/ui-store'
import { cn } from '@/lib/utils'

export function LoginPage() {
  const { t, i18n } = useTranslation()
  const { login, isLoading, error } = useAuthStore()
  const { addNotification } = useUIStore()
  
  const [email, setEmail] = useState('admin@wardah.sa')
  const [password, setPassword] = useState('admin123')
  const [showPassword, setShowPassword] = useState(false)
  
  const isRTL = i18n.language === 'ar'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    try {
      await login(email, password)
      addNotification({
        type: 'success',
        title: t('auth.welcome'),
        message: 'تم تسجيل الدخول بنجاح'
      })
    } catch (err) {
      addNotification({
        type: 'error',
        title: t('auth.loginError'),
        message: 'يرجى التحقق من بيانات تسجيل الدخول'
      })
    }
  }

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="bg-card rounded-lg border p-8 shadow-lg">
        <div className={cn(
          "text-center mb-8",
          isRTL ? "text-right" : "text-left"
        )}>
          <div className="h-16 w-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <LogIn className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">{t('app.name')}</h1>
          <p className="text-muted-foreground mt-2">{t('app.subtitle')}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label htmlFor="email" className={cn(
              "text-sm font-medium",
              isRTL ? "text-right" : "text-left"
            )}>
              {t('auth.username')}
            </label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@wardah.sa"
              required
              disabled={isLoading}
              className={cn(isRTL ? "text-right" : "text-left")}
              dir={isRTL ? 'rtl' : 'ltr'}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className={cn(
              "text-sm font-medium",
              isRTL ? "text-right" : "text-left"
            )}>
              {t('auth.password')}
            </label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="admin123"
                required
                disabled={isLoading}
                className={cn(
                  isRTL ? "pl-10 text-right" : "pr-10 text-left"
                )}
                dir={isRTL ? 'rtl' : 'ltr'}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  "absolute top-0 h-full px-3 py-2 hover:bg-transparent",
                  isRTL ? "left-0" : "right-0"
                )}
                onClick={() => setShowPassword(!showPassword)}
                disabled={isLoading}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          {error && (
            <div className={cn(
              "text-sm text-destructive bg-destructive/10 p-3 rounded-md",
              isRTL ? "text-right" : "text-left"
            )}>
              {error}
            </div>
          )}

          <Button
            type="submit"
            className="w-full"
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <div className={cn(
                  "w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin",
                  isRTL ? "ml-2" : "mr-2"
                )} />
                {t('common.loading')}
              </>
            ) : (
              t('auth.login')
            )}
          </Button>
        </form>

        <div className={cn(
          "mt-6 text-center text-sm text-muted-foreground",
          isRTL ? "text-right" : "text-left"
        )}>
          <p>بيانات تجريبية:</p>
          <p>البريد: admin@wardah.sa</p>
          <p>كلمة المرور: admin123</p>
        </div>
      </div>
    </div>
  )
}