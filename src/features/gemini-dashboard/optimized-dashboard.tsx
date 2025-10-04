import { useEffect, useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { RefreshCw, ExternalLink, AlertTriangle, CheckCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { geminiService } from '@/services/gemini-service'

export function OptimizedDashboard() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loadStatus, setLoadStatus] = useState({
    html: 'pending',
    resources: 'pending'
  })
  const iframeRef = useRef<HTMLIFrameElement>(null)

  // Path to the Gemini dashboard HTML file
  const dashboardPath = '/gemini-dashboard/gemini_enhanced_dashboard.html'

  const handleLoad = () => {
    setLoading(false)
    setLoadStatus(prev => ({ ...prev, html: 'success' }))
    // Initialize the integration when the dashboard loads
    geminiService.initializeIntegration()
  }

  const handleError = () => {
    setLoading(false)
    setError(t('messages.connectionError'))
    setLoadStatus(prev => ({ ...prev, html: 'error' }))
  }

  const refreshDashboard = () => {
    setLoading(true)
    setError(null)
    setLoadStatus({
      html: 'pending',
      resources: 'pending'
    })
    
    if (iframeRef.current) {
      iframeRef.current.src = iframeRef.current.src
    }
  }

  const openInNewTab = () => {
    window.open(dashboardPath, '_blank')
  }

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

  // Improved loading with timeout and status tracking
  useEffect(() => {
    let timeoutId: NodeJS.Timeout
    
    const startLoadTimeout = () => {
      timeoutId = setTimeout(() => {
        if (loading) {
          setError(t('geminiDashboard.timeoutError'))
          setLoading(false)
        }
      }, 10000) // Reduced timeout to 10 seconds
    }
    
    startLoadTimeout()
    
    return () => {
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [loading, t])

  return (
    <div className={isRTL ? "text-right" : "text-left"} dir={isRTL ? "rtl" : "ltr"}>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">{t('geminiDashboard.title')}</h1>
        <div className="flex gap-2">
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
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            <p className="font-medium">{t('common.error')}</p>
          </div>
          <p className="mt-2 text-sm">{error}</p>
        </div>
      )}
      
      {loading && (
        <div className="mb-6 p-4 rounded-lg border bg-muted/50">
          <div className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5 animate-spin" />
            <p className="font-medium">{t('geminiDashboard.loadingStatus')}</p>
          </div>
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <div className={cn(
                "h-2 w-2 rounded-full",
                loadStatus.html === 'pending' ? 'bg-yellow-500' : 
                loadStatus.html === 'success' ? 'bg-green-500' : 'bg-red-500'
              )}></div>
              <span>{t('geminiDashboard.loadingHtml')}</span>
              {loadStatus.html === 'success' && <CheckCircle className="h-4 w-4 text-green-500" />}
            </div>
          </div>
        </div>
      )}
      
      <div className="relative bg-card rounded-lg border overflow-hidden" style={{ height: 'calc(100vh - 200px)' }}>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10">
            <div className="flex flex-col items-center">
              <RefreshCw className="h-8 w-8 animate-spin mb-4" />
              <p className="text-muted-foreground">{t('geminiDashboard.loadingMessage')}</p>
              <p className="text-xs text-muted-foreground mt-2">{t('geminiDashboard.loadingTip')}</p>
            </div>
          </div>
        )}
        
        <iframe
          ref={iframeRef}
          id="gemini-dashboard-iframe"
          src={dashboardPath}
          className="w-full h-full border-0"
          onLoad={handleLoad}
          onError={handleError}
          title="Gemini Enhanced Dashboard"
          loading="lazy"
        />
      </div>
    </div>
  )
}