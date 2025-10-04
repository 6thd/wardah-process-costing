import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { RefreshCw, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import { geminiService } from '@/services/gemini-service'
import GeminiDashboard from '@/features/reports/components/GeminiDashboard'

export function IframeDashboard() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [useOptimizedVersion, setUseOptimizedVersion] = useState(false)

  // Set up message listener
  useEffect(() => {
    const removeListener = geminiService.listenForMessages((message) => {
      console.log('Received message from Gemini dashboard:', message)
      // Handle messages from the iframe dashboard here
    })
    
    return () => {
      removeListener()
    }
  }, [])

  const refreshDashboard = () => {
    setLoading(true)
    setError(null)
    // Refresh the dashboard by toggling a state or calling a refresh function
    window.location.reload()
  }

  const openInNewTab = () => {
    window.open('/reports/gemini', '_blank')
  }

  const toggleDashboardVersion = () => {
    setUseOptimizedVersion(!useOptimizedVersion)
    setLoading(true)
    setError(null)
  }

  return (
    <div className={isRTL ? "text-right" : "text-left"} dir={isRTL ? "rtl" : "ltr"}>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">{t('geminiDashboard.title')}</h1>
        <div className="flex gap-2">
          <Button 
            onClick={toggleDashboardVersion}
            variant="outline"
            className="flex items-center gap-2"
          >
            {useOptimizedVersion ? '🔄 Enhanced Version' : '⚡ Optimized Version'}
          </Button>
          <Button 
            onClick={openInNewTab} 
            variant="outline"
            className="flex items-center gap-2"
          >
            <ExternalLink className="h-4 w-4" />
            {t('common.openInNewTab')}
          </Button>
          <Button 
            onClick={refreshDashboard} 
            disabled={loading}
            className="flex items-center gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {t('common.refresh')}
          </Button>
        </div>
      </div>
      
      {error && (
        <div className={cn(
          "mb-6 p-4 rounded-lg border",
          "bg-destructive/10 border-destructive/50 text-destructive"
        )}>
          <p className="font-medium">{t('common.error')}</p>
          <p className="mt-2 text-sm">{error}</p>
        </div>
      )}
      
      <div className="relative bg-card rounded-lg border overflow-hidden" style={{ height: 'calc(100vh - 200px)' }}>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10">
            <div className="flex flex-col items-center">
              <RefreshCw className="h-8 w-8 animate-spin mb-4" />
              <p className="text-muted-foreground">
                {useOptimizedVersion 
                  ? t('geminiDashboard.loadingOptimizedMessage') 
                  : t('geminiDashboard.loadingMessage')}
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                {useOptimizedVersion 
                  ? t('geminiDashboard.optimizedLoadingTip') 
                  : t('geminiDashboard.loadingTip')}
              </p>
            </div>
          </div>
        )}
        
        {/* Use the React-based dashboard component instead of iframe */}
        <div className="w-full h-full">
          <GeminiDashboard />
        </div>
      </div>
    </div>
  )
}