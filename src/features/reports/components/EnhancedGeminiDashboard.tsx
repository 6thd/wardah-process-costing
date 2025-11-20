/**
 * Enhanced Gemini Dashboard Component
 * لوحة Gemini المحسّنة مع ربط البيانات الحقيقية
 */

import { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, TrendingUp, TrendingDown, DollarSign, Calculator, Target, AlertTriangle } from 'lucide-react';
import { geminiFinancialService } from '@/services/gemini-financial-service';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { PerformanceMonitor } from '@/lib/performance-monitor';

interface DashboardMetrics {
  kpis: any;
  breakEven: any;
  profitLoss: any;
  monthlyData: any[];
}

export function EnhancedGeminiDashboard() {
  const { i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Auto-sync with Wardah data
  const syncWithWardah = async () => {
    return PerformanceMonitor.measure('Dashboard Sync', async () => {
      try {
        setLoading(true);

        // Fetch real financial data
        const kpis = await geminiFinancialService.fetchRealFinancialKPIs();
        const breakEven = await geminiFinancialService.calculateBreakEvenAnalysis();
        const monthlyData = await geminiFinancialService.fetchMonthlyFinancialData();

        const startDate = new Date(new Date().getFullYear(), 0, 1);
        const endDate = new Date();
        const profitLoss = await geminiFinancialService.analyzeProfitLoss(startDate, endDate);

        // Format for Gemini dashboard
        const formattedData = geminiFinancialService.formatForGeminiDashboard(kpis, monthlyData);

        // Send data to iframe
        if (iframeRef.current?.contentWindow) {
          iframeRef.current.contentWindow.postMessage({
            type: 'WARDHAH_DATA_SYNC',
            data: formattedData,
            kpis,
            breakEven,
            profitLoss
          }, '*');
        }

        setMetrics({
          kpis,
          breakEven,
          profitLoss,
          monthlyData
        });

        toast.success(isRTL ? 'تم مزامنة البيانات بنجاح' : 'Data synced successfully');
      } catch (error: any) {
        console.error('Error syncing data:', error);
        toast.error(error.message || (isRTL ? 'فشل في مزامنة البيانات' : 'Failed to sync data'));
      } finally {
        setLoading(false);
      }
    });
  };

  useEffect(() => {
    // Initial sync
    syncWithWardah();

    // Auto-refresh every 5 minutes if enabled
    if (autoRefresh) {
      refreshIntervalRef.current = setInterval(() => {
        syncWithWardah();
      }, 5 * 60 * 1000); // 5 minutes
    }

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [autoRefresh]);

  // Listen for messages from iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data.type === 'REQUEST_WARDHAH_DATA') {
        syncWithWardah();
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  return (
    <div className="container mx-auto p-6 space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Control Panel */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl">
                {isRTL ? 'لوحة Gemini المالية الذكية' : 'Gemini AI Financial Dashboard'}
              </CardTitle>
              <CardDescription>
                {isRTL
                  ? 'تحليل مالي متقدم مع Google Gemini AI - بيانات حقيقية من وردة ERP'
                  : 'Advanced financial analysis with Google Gemini AI - Real data from Wardah ERP'}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setAutoRefresh(!autoRefresh)}
                className={cn(autoRefresh && 'bg-primary text-primary-foreground')}
              >
                <RefreshCw className={cn('h-4 w-4 mr-2', autoRefresh && 'animate-spin')} />
                {isRTL ? 'تحديث تلقائي' : 'Auto Refresh'}
              </Button>
              <Button onClick={syncWithWardah} disabled={loading}>
                <RefreshCw className={cn('h-4 w-4 mr-2', loading && 'animate-spin')} />
                {isRTL ? 'مزامنة الآن' : 'Sync Now'}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Real-time Metrics Summary */}
          {metrics && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm opacity-90">{isRTL ? 'إجمالي المبيعات' : 'Total Sales'}</p>
                      <p className="text-2xl font-bold">{metrics.kpis.totalSales.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                    </div>
                    <DollarSign className="h-8 w-8 opacity-80" />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-br from-green-500 to-green-600 text-white">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm opacity-90">{isRTL ? 'صافي الربح' : 'Net Profit'}</p>
                      <p className="text-2xl font-bold">{metrics.kpis.netProfit.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                      <p className="text-xs opacity-80">{metrics.kpis.profitMargin.toFixed(2)}%</p>
                    </div>
                    {metrics.kpis.netProfit >= 0 ? (
                      <TrendingUp className="h-8 w-8 opacity-80" />
                    ) : (
                      <TrendingDown className="h-8 w-8 opacity-80" />
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-br from-purple-500 to-purple-600 text-white">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm opacity-90">{isRTL ? 'نقطة التعادل' : 'Break-Even Point'}</p>
                      <p className="text-2xl font-bold">{metrics.breakEven.breakEvenSales.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                      <p className="text-xs opacity-80">
                        {isRTL ? 'هامش الأمان' : 'Margin of Safety'}: {metrics.breakEven.marginOfSafetyPercent.toFixed(2)}%
                      </p>
                    </div>
                    <Target className="h-8 w-8 opacity-80" />
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-br from-orange-500 to-orange-600 text-white">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm opacity-90">{isRTL ? 'هامش المساهمة' : 'Contribution Margin'}</p>
                      <p className="text-2xl font-bold">{(metrics.kpis.contributionMarginRatio * 100).toFixed(2)}%</p>
                      <p className="text-xs opacity-80">
                        {metrics.kpis.contributionMargin.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                    <Calculator className="h-8 w-8 opacity-80" />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Break-Even Analysis Card */}
          {metrics && (
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Target className="h-5 w-5" />
                  {isRTL ? 'تحليل نقطة التعادل' : 'Break-Even Analysis'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1">{isRTL ? 'نقطة التعادل (مبيعات)' : 'Break-Even (Sales)'}</p>
                    <p className="text-2xl font-bold">{metrics.breakEven.breakEvenSales.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                  </div>
                  <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1">{isRTL ? 'هامش الأمان' : 'Margin of Safety'}</p>
                    <p className="text-2xl font-bold">{metrics.breakEven.marginOfSafetyPercent.toFixed(2)}%</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {metrics.breakEven.marginOfSafety.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1">{isRTL ? 'التكاليف الثابتة' : 'Fixed Costs'}</p>
                    <p className="text-2xl font-bold">{metrics.breakEven.fixedCosts.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                  </div>
                </div>

                {/* Status Alert */}
                {metrics.breakEven.marginOfSafetyPercent < 10 && (
                  <div className="mt-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-yellow-600" />
                    <p className="text-sm text-yellow-800 dark:text-yellow-200">
                      {isRTL
                        ? 'تحذير: هامش الأمان منخفض. يجب زيادة المبيعات أو تقليل التكاليف.'
                        : 'Warning: Low margin of safety. Consider increasing sales or reducing costs.'}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Gemini Dashboard Iframe */}
          <Card>
            <CardContent className="p-0">
              <div className="relative" style={{ height: 'calc(100vh - 400px)', minHeight: '600px' }}>
                {loading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10">
                    <div className="flex flex-col items-center gap-4">
                      <RefreshCw className="h-8 w-8 animate-spin text-primary" />
                      <p className="text-muted-foreground">
                        {isRTL ? 'جاري تحميل لوحة Gemini...' : 'Loading Gemini Dashboard...'}
                      </p>
                    </div>
                  </div>
                )}
                <iframe
                  ref={iframeRef}
                  src="/gemini-dashboard/gemini_enhanced_dashboard.html?wardah=true&autoSync=true"
                  className="w-full h-full border-0 rounded-lg"
                  title="Gemini Enhanced Dashboard"
                  onLoad={() => {
                    setLoading(false);
                    // Auto-sync after iframe loads
                    setTimeout(() => {
                      syncWithWardah();
                    }, 1000);
                  }}
                />
              </div>
            </CardContent>
          </Card>
        </CardContent>
      </Card>
    </div>
  );
}

export default EnhancedGeminiDashboard;

