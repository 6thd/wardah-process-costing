import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export function LoadingScreen() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'

  console.log('🔄 Rendering LoadingScreen component')

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className={cn(
        "text-center",
        isRTL ? "text-right" : "text-left"
      )}>
        <div className="relative mb-6">
          <div className="h-20 w-20 mx-auto rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
          <Loader2 className="absolute inset-0 h-8 w-8 m-auto text-primary animate-pulse" />
        </div>
        <h2 className="text-xl font-semibold mb-2">{t('app.name')}</h2>
        <p className="text-muted-foreground">{t('common.loading')}</p>
      </div>
    </div>
  )
}