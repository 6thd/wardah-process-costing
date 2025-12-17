import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { geminiService } from '@/services/gemini-service'
import { Button } from '@/components/ui/button'
import { RefreshCw, AlertCircle } from 'lucide-react'
import { formatCurrency, cn } from '@/lib/utils'

export function GeminiDashboard() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const syncData = async () => {
    setLoading(true)
    setError(null)
    
    try {
      // Check if the service is configured
      if (!geminiService.isConfigured()) {
        throw new Error(t('geminiDashboard.syncError') + ': ' + t('messages.connectionError'))
      }
      
      const syncedData = await geminiService.syncAllData()
      setData(syncedData)
      
      // Show success message
      console.log(t('geminiDashboard.syncSuccess'))
    } catch (err: any) {
      setError(err.message || t('geminiDashboard.syncError'))
      console.error('Failed to sync data:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Try to sync data on initial load
    syncData()
  }, [])

  return (
    <div className={isRTL ? "text-right" : "text-left"}>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">{t('geminiDashboard.title')}</h1>
        <Button 
          onClick={syncData} 
          disabled={loading}
          className="flex items-center gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          {t('geminiDashboard.syncWithWardah')}
        </Button>
      </div>
      
      {error && (
        <div className={cn(
          "mb-6 p-4 rounded-lg border",
          "bg-destructive/10 border-destructive/50 text-destructive"
        )}>
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            <span className="font-medium">{t('common.error')}</span>
          </div>
          <p className="mt-2 text-sm">{error}</p>
        </div>
      )}
      
      {data ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
          <div className="bg-card rounded-lg border p-6">
            <div className="flex flex-row items-center justify-between space-y-0 pb-2">
              <h3 className="text-sm font-medium text-muted-foreground">
                {t('dashboard.metrics.totalSales')}
              </h3>
            </div>
            <div className="mt-2">
              <div className="text-2xl font-bold">
                {formatCurrency(data.financialData.totalSales)}
              </div>
            </div>
          </div>
          
          <div className="bg-card rounded-lg border p-6">
            <div className="flex flex-row items-center justify-between space-y-0 pb-2">
              <h3 className="text-sm font-medium text-muted-foreground">
                {t('dashboard.metrics.totalProductionCost')}
              </h3>
            </div>
            <div className="mt-2">
              <div className="text-2xl font-bold">
                {formatCurrency(data.financialData.totalCosts)}
              </div>
            </div>
          </div>
          
          <div className="bg-card rounded-lg border p-6">
            <div className="flex flex-row items-center justify-between space-y-0 pb-2">
              <h3 className="text-sm font-medium text-muted-foreground">
                {t('dashboard.metrics.grossProfitMargin')}
              </h3>
            </div>
            <div className="mt-2">
              <div className="text-2xl font-bold">
                {data.financialData.netProfit > 0 ? '+' : ''}{formatCurrency(data.financialData.netProfit)}
              </div>
            </div>
          </div>
          
          <div className="bg-card rounded-lg border p-6">
            <div className="flex flex-row items-center justify-between space-y-0 pb-2">
              <h3 className="text-sm font-medium text-muted-foreground">
                {t('dashboard.metrics.totalInventoryValue')}
              </h3>
            </div>
            <div className="mt-2">
              <div className="text-2xl font-bold">
                {formatCurrency(data.financialData.inventoryValue)}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-card rounded-lg border p-6 mb-6">
          <div className="flex flex-col items-center justify-center py-12">
            <RefreshCw className={`h-8 w-8 mb-4 ${loading ? 'animate-spin' : ''}`} />
            <p className="text-muted-foreground">
              {loading ? t('common.loading') : t('geminiDashboard.loadingMessage')}
            </p>
          </div>
        </div>
      )}
      
      <div className="bg-card rounded-lg border p-6">
        <h3 className="text-lg font-medium mb-4">{t('reports.title')}</h3>
        <p className="text-muted-foreground">
          {t('geminiDashboard.loadingMessage')}
        </p>
      </div>
    </div>
  )
}