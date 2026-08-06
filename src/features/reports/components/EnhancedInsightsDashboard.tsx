/**
 * Enhanced Reports Insights Dashboard Component
 * لوحة الرؤى المحسّنة مع ربط البيانات الحقيقية
 */

import { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, TrendingUp, TrendingDown, DollarSign, Calculator, Target, AlertTriangle } from 'lucide-react';
import { geminiFinancialService } from '@/services/gemini-financial-service';
import { getSupabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { PerformanceMonitor } from '@/lib/performance-monitor';

interface DashboardMetrics {
  kpis: any;
  breakEven: any;
  profitLoss: any;
  monthlyData: any[];
}

const INSIGHT_OPERATIONS = ['summary', 'predictions', 'optimization', 'risk', 'strategy', 'ask'] as const;
type InsightOperation = (typeof INSIGHT_OPERATIONS)[number];

interface InsightRequestMessage {
  type: 'WARDHAH_INSIGHT_REQUEST';
  requestId: string;
  operation: InsightOperation;
  locale: 'ar' | 'en';
  data?: Record<string, unknown>;
  question?: string;
}

function isValidInsightRequest(msg: unknown): msg is InsightRequestMessage {
  if (!msg || typeof msg !== 'object') return false;
  const m = msg as Record<string, unknown>;
  if (m.type !== 'WARDHAH_INSIGHT_REQUEST') return false;
  if (typeof m.requestId !== 'string' || m.requestId.length === 0 || m.requestId.length > 100) return false;
  if (typeof m.operation !== 'string' || !INSIGHT_OPERATIONS.includes(m.operation as InsightOperation)) return false;
  if (m.locale !== 'ar' && m.locale !== 'en') return false;
  if (m.operation === 'ask') {
    if (typeof m.question !== 'string' || m.question.length === 0 || m.question.length > 500) return false;
  } else if (m.data !== undefined && (typeof m.data !== 'object' || m.data === null || Array.isArray(m.data))) {
    return false;
  }
  return true;
}

export function EnhancedInsightsDashboard() {
  const { t, i18n } = useTranslation();
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

        // Format for the insights dashboard
        const formattedData = geminiFinancialService.formatForGeminiDashboard(kpis, monthlyData);

        // Send data to iframe (using same origin for security)
        if (iframeRef.current?.contentWindow) {
          iframeRef.current.contentWindow.postMessage({
            type: 'WARDHAH_DATA_SYNC',
            data: formattedData,
            kpis,
            breakEven,
            profitLoss
          }, globalThis.window.location.origin);
        }

        setMetrics({
          kpis,
          breakEven,
          profitLoss,
          monthlyData
        });

        toast.success(t('reportsInsights.syncSuccess'));
      } catch (error: any) {
        console.error('Error syncing data:', error);
        toast.error(error.message || t('reportsInsights.syncFailed'));
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

  // Listen for messages from the iframe. Every check below matters: origin
  // (same-origin only), source (must be exactly this iframe's window, not
  // any other frame that happens to share our origin), and message shape
  // (reject anything that doesn't match the expected request contract).
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.origin !== globalThis.window.location.origin) {
        console.warn('Ignoring message from unauthorized origin:', event.origin);
        return;
      }
      if (event.source !== iframeRef.current?.contentWindow) {
        return;
      }

      const msg = event.data;
      if (msg && typeof msg === 'object' && msg.type === 'REQUEST_WARDHAH_DATA') {
        syncWithWardah();
        return;
      }

      if (!isValidInsightRequest(msg)) return;

      const targetWindow = event.source as Window;
      const targetOrigin = globalThis.window.location.origin;

      try {
        // The Edge Function call carries the user's own current session —
        // never the iframe. The iframe only ever receives the final text.
        const supabase = getSupabase();
        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData.session) {
          targetWindow.postMessage({
            type: 'WARDHAH_INSIGHT_RESPONSE',
            requestId: msg.requestId,
            success: false,
            error: 'not_authenticated'
          }, targetOrigin);
          return;
        }

        const { data, error } = await supabase.functions.invoke('reports-insights', {
          body: {
            operation: msg.operation,
            locale: msg.locale,
            ...(msg.operation === 'ask' ? { question: msg.question } : { data: msg.data ?? {} })
          }
        });

        if (error) {
          targetWindow.postMessage({
            type: 'WARDHAH_INSIGHT_RESPONSE',
            requestId: msg.requestId,
            success: false,
            error: 'request_failed'
          }, targetOrigin);
          return;
        }

        targetWindow.postMessage({
          type: 'WARDHAH_INSIGHT_RESPONSE',
          requestId: msg.requestId,
          success: true,
          source: data?.source,
          text: data?.text
        }, targetOrigin);
      } catch (err) {
        console.error('Error handling insight request:', err);
        targetWindow.postMessage({
          type: 'WARDHAH_INSIGHT_RESPONSE',
          requestId: msg.requestId,
          success: false,
          error: 'request_failed'
        }, targetOrigin);
      }
    };

    globalThis.window.addEventListener('message', handleMessage);
    return () => globalThis.window.removeEventListener('message', handleMessage);
  }, []);

  return (
    <div className="container mx-auto p-6 space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Control Panel */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl">
                {t('reportsInsights.enhancedTitle')}
              </CardTitle>
              <CardDescription>
                {t('reportsInsights.enhancedDescription')}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setAutoRefresh(!autoRefresh)}
                className={cn(autoRefresh && 'bg-primary text-primary-foreground')}
              >
                <RefreshCw className={cn('h-4 w-4 mr-2', autoRefresh && 'animate-spin')} />
                {t('reportsInsights.autoRefresh')}
              </Button>
              <Button onClick={syncWithWardah} disabled={loading}>
                <RefreshCw className={cn('h-4 w-4 mr-2', loading && 'animate-spin')} />
                {t('reportsInsights.syncNow')}
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
                      <p className="text-sm opacity-90">{t('reportsInsights.totalSales')}</p>
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
                      <p className="text-sm opacity-90">{t('reportsInsights.netProfit')}</p>
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
                      <p className="text-sm opacity-90">{t('reportsInsights.breakEvenPoint')}</p>
                      <p className="text-2xl font-bold">{metrics.breakEven.breakEvenSales.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                      <p className="text-xs opacity-80">
                        {t('reportsInsights.marginOfSafety')}: {metrics.breakEven.marginOfSafetyPercent.toFixed(2)}%
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
                      <p className="text-sm opacity-90">{t('reportsInsights.contributionMargin')}</p>
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
                  {t('reportsInsights.breakEvenAnalysis')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1">{t('reportsInsights.breakEvenSales')}</p>
                    <p className="text-2xl font-bold">{metrics.breakEven.breakEvenSales.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                  </div>
                  <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1">{t('reportsInsights.marginOfSafety')}</p>
                    <p className="text-2xl font-bold">{metrics.breakEven.marginOfSafetyPercent.toFixed(2)}%</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {metrics.breakEven.marginOfSafety.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div className="p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1">{t('reportsInsights.fixedCosts')}</p>
                    <p className="text-2xl font-bold">{metrics.breakEven.fixedCosts.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                  </div>
                </div>

                {/* Status Alert */}
                {metrics.breakEven.marginOfSafetyPercent < 10 && (
                  <div className="mt-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-yellow-600" />
                    <p className="text-sm text-yellow-800 dark:text-yellow-200">
                      {t('reportsInsights.lowMarginWarning')}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Insights Dashboard Iframe */}
          <Card>
            <CardContent className="p-0">
              <div className="relative" style={{ height: 'calc(100vh - 400px)', minHeight: '600px' }}>
                {loading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-10">
                    <div className="flex flex-col items-center gap-4">
                      <RefreshCw className="h-8 w-8 animate-spin text-primary" />
                      <p className="text-muted-foreground">
                        {t('reportsInsights.loadingEnhanced')}
                      </p>
                    </div>
                  </div>
                )}
                <iframe
                  ref={iframeRef}
                  src="/reports-insights/dashboard.html?wardah=true&autoSync=true"
                  className="w-full h-full border-0 rounded-lg"
                  title="Reports Insights Dashboard"
                  onLoad={() => {
                    setLoading(false);
                    // AI-generated insight text is served by the
                    // reports-insights Edge Function above (via the message
                    // handler in this component) — never by a token or
                    // credential passed into the iframe. This iframe loads
                    // third-party CDN scripts that could read anything held
                    // in its own JS memory, so no credential is ever handed
                    // to it. Financial data reaches it via the
                    // WARDHAH_DATA_SYNC postMessage below, which carries
                    // only already-fetched, non-secret display data.
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

export default EnhancedInsightsDashboard;
