/**
 * Enhanced Reports Insights Dashboard Component
 * لوحة الرؤى المحسّنة مع ربط البيانات الحقيقية
 *
 * The embedded dashboard (public/reports-insights/dashboard.html) is loaded
 * in a sandboxed iframe (`sandbox="allow-scripts allow-downloads"`, no
 * `allow-same-origin`) so its browsing context has an opaque origin — even
 * third-party script content running inside it cannot read this page's DOM,
 * cookies, or localStorage. All authentication, Supabase access, quota
 * enforcement, and AI-provider calls happen exclusively in this component
 * and the reports-insights Edge Function — the iframe never holds a
 * credential of any kind and never calls anything directly.
 *
 * Transport: a MessageChannel, not repeated window.postMessage. `window
 * .postMessage(msg, '*')` is used exactly once, in the iframe's onLoad
 * handler below, solely to hand one MessagePort to the iframe (an opaque
 * origin cannot be targeted by anything other than '*', so this one call is
 * unavoidable — it carries no data, only a communication channel). Every
 * KPI/insight message after that handshake travels over that port instead:
 * MessagePort.postMessage() has no targetOrigin/broadcast concept at all —
 * a channel's two ports are a private, unforgeable pair once created, so
 * nothing else in the page (another frame, an injected script sharing this
 * window) can ever observe or inject into this traffic, which is a
 * strictly stronger guarantee than re-checking `event.source` on every
 * message would have been. The one remaining risk is the handshake message
 * itself being spoofed by a sender that is not this component's own
 * iframe's parent-of — the iframe side (dashboard.js) still checks
 * `event.source === window.parent` on that single message before trusting
 * the port it carries.
 */

import { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, TrendingUp, TrendingDown, DollarSign, Calculator, Target, AlertTriangle } from 'lucide-react';
import { geminiFinancialService, type BreakEvenAnalysis } from '@/services/gemini-financial-service';
import { getSupabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { PerformanceMonitor } from '@/lib/performance-monitor';

interface DashboardMetrics {
  kpis: any;
  breakEven: BreakEvenAnalysis;
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

interface DataRequestMessage {
  type: 'REQUEST_WARDHAH_DATA';
  requestId: string;
}

function isValidRequestId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 100;
}

function isValidInsightRequest(msg: unknown): msg is InsightRequestMessage {
  if (!msg || typeof msg !== 'object') return false;
  const m = msg as Record<string, unknown>;
  if (m.type !== 'WARDHAH_INSIGHT_REQUEST') return false;
  if (!isValidRequestId(m.requestId)) return false;
  if (typeof m.operation !== 'string' || !INSIGHT_OPERATIONS.includes(m.operation as InsightOperation)) return false;
  if (m.locale !== 'ar' && m.locale !== 'en') return false;
  if (m.operation === 'ask') {
    if (typeof m.question !== 'string' || m.question.length === 0 || m.question.length > 500) return false;
  }
  // data is optional context on every operation, including 'ask' (the
  // dashboard's already-computed financial figures, so the model can
  // answer questions grounded in the organization's real numbers).
  if (m.data !== undefined && (typeof m.data !== 'object' || m.data === null || Array.isArray(m.data))) {
    return false;
  }
  return true;
}

function isValidDataRequest(msg: unknown): msg is DataRequestMessage {
  if (!msg || typeof msg !== 'object') return false;
  const m = msg as Record<string, unknown>;
  return m.type === 'REQUEST_WARDHAH_DATA' && isValidRequestId(m.requestId);
}

/** Classifies an Edge Function invocation failure without ever showing the
 * caller a fabricated "success" — the iframe's local deterministic fallback
 * handles UX degradation on its own; this only decides what to log and what
 * error code to relay so a real bug is never indistinguishable from a
 * classified provider hiccup in the logs. */
function classifyInvokeError(error: unknown): { code: string; status?: number } {
  const withContext = error as { context?: { status?: number }; message?: string } | null;
  const status = withContext?.context?.status;
  if (status === 401) return { code: 'not_authenticated', status };
  if (status === 403) return { code: 'forbidden', status };
  if (status === 429) return { code: 'quota_exceeded', status };
  if (typeof status === 'number' && status >= 500) return { code: 'internal_error', status };
  return { code: 'request_failed', status };
}

export function EnhancedInsightsDashboard() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);
  // Set once the handshake below completes; null beforehand, so every
  // send site can just no-op safely if the iframe hasn't finished loading
  // yet instead of needing its own readiness bookkeeping.
  const portRef = useRef<MessagePort | null>(null);
  // Guards the one-time handshake in the iframe's onLoad below against a
  // second `load` event (a re-navigation/reload of the iframe) silently
  // opening a brand-new MessageChannel and re-sending a second handshake.
  // dashboard.js's own handshake listener already only ever accepts the
  // first WARDHAH_CHANNEL_INIT it receives (see its module comment), but
  // without this guard a second `load` here would still tear down the
  // working port and leave the iframe holding a port nothing writes to
  // anymore — this makes port delivery exactly-once on this side too.
  const handshakeSentRef = useRef(false);

  // Replies to (or forwards) a single message received over the channel.
  // Pulled out of the port's onmessage handler so it has no event/source
  // plumbing to thread through — the channel itself is the identity
  // boundary now (see the module comment at the top of this file).
  const handleIframeMessage = async (msg: unknown) => {
    if (isValidDataRequest(msg)) {
      syncWithWardah();
      return;
    }

    if (!isValidInsightRequest(msg)) return;

    const reply = (response: Record<string, unknown>) => {
      portRef.current?.postMessage({ type: 'WARDHAH_INSIGHT_RESPONSE', requestId: msg.requestId, ...response });
    };

    try {
      const supabase = getSupabase();
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        reply({ success: false, error: 'not_authenticated' });
        return;
      }

      const { data, error } = await supabase.functions.invoke('reports-insights', {
        body: {
          operation: msg.operation,
          locale: msg.locale,
          requestId: msg.requestId,
          ...(msg.operation === 'ask'
            ? { question: msg.question, ...(msg.data !== undefined ? { data: msg.data } : {}) }
            : { data: msg.data ?? {} })
        }
      });

      if (error) {
        const { code, status } = classifyInvokeError(error);
        // A real 5xx or an unclassified failure is logged distinctly
        // from an expected 401/403/429 so it is never mistaken for
        // normal, classified degradation in the logs — the iframe still
        // falls back to its local deterministic text either way (that
        // fallback is a UX decision made once, in the iframe, not a
        // reason to blur what actually happened server-side).
        if (code === 'internal_error' || code === 'request_failed') {
          console.error('reports-insights invoke failed', { requestId: msg.requestId, operation: msg.operation, code, status });
        }
        reply({ success: false, error: code });
        return;
      }

      reply({ success: true, source: data?.source, text: data?.text });
    } catch (err) {
      console.error('Error handling insight request:', err);
      reply({ success: false, error: 'request_failed' });
    }
  };

  // Auto-sync with Wardah data
  const syncWithWardah = async () => {
    return PerformanceMonitor.measure('Dashboard Sync', async () => {
      try {
        setLoading(true);

        const kpis = await geminiFinancialService.fetchRealFinancialKPIs();
        const breakEven = await geminiFinancialService.calculateBreakEvenAnalysis();
        const monthlyData = await geminiFinancialService.fetchMonthlyFinancialData();

        const startDate = new Date(new Date().getFullYear(), 0, 1);
        const endDate = new Date();
        const profitLoss = await geminiFinancialService.analyzeProfitLoss(startDate, endDate);

        const formattedData = geminiFinancialService.formatForGeminiDashboard(kpis, monthlyData);

        // No-ops until the handshake in the iframe's onLoad below has run
        // — harmless, since onLoad triggers its own sync immediately
        // after establishing the port.
        portRef.current?.postMessage({
          type: 'WARDHAH_DATA_SYNC',
          requestId: `sync-${crypto.randomUUID()}`,
          data: formattedData,
          kpis,
          breakEven,
          profitLoss
        });

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
    // Populates this component's own KPI cards, which read Supabase
    // directly and don't depend on the iframe/channel at all. The
    // iframe-facing half of syncWithWardah() safely no-ops until the
    // channel handshake (iframe onLoad, below) has completed.
    syncWithWardah();

    if (autoRefresh) {
      refreshIntervalRef.current = setInterval(() => {
        syncWithWardah();
      }, 5 * 60 * 1000);
    }

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh]);

  useEffect(() => {
    return () => {
      portRef.current?.close();
      portRef.current = null;
    };
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
                      {metrics.breakEven.available ? (
                        <>
                          <p className="text-2xl font-bold">{metrics.breakEven.breakEvenSales.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                          <p className="text-xs opacity-80">
                            {t('reportsInsights.marginOfSafety')}: {metrics.breakEven.marginOfSafetyPercent.toFixed(2)}%
                          </p>
                        </>
                      ) : (
                        <p className="text-sm opacity-90">{t('reportsInsights.breakEvenUnavailable')}</p>
                      )}
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
                      {/* Contribution margin = revenue minus VARIABLE costs
                          specifically, not gross profit (revenue minus
                          COGS) — gl_accounts has no fixed/variable cost
                          classification to compute it from (same gap as
                          break-even above), so this never shows a number
                          under this label. */}
                      <p className="text-sm opacity-90">{t('reportsInsights.breakEvenUnavailable')}</p>
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
                {metrics.breakEven.available ? (
                  <>
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

                    {metrics.breakEven.marginOfSafetyPercent < 10 && (
                      <div className="mt-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5 text-yellow-600" />
                        <p className="text-sm text-yellow-800 dark:text-yellow-200">
                          {t('reportsInsights.lowMarginWarning')}
                        </p>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">{t('reportsInsights.breakEvenUnavailable')}</p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Insights Dashboard Iframe — fully sandboxed, opaque origin */}
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
                  sandbox="allow-scripts allow-downloads"
                  allow="fullscreen"
                  allowFullScreen
                  onLoad={() => {
                    setLoading(false);

                    // Exactly-once handshake guard: a second `load` event
                    // (iframe re-navigation/reload) must not tear down the
                    // working port and open a new one — see
                    // handshakeSentRef's declaration above.
                    if (handshakeSentRef.current) return;
                    handshakeSentRef.current = true;

                    // One-time handshake: hand the iframe a private
                    // MessagePort. This is the only postMessage(..., '*')
                    // left in this component — required because the
                    // iframe's opaque origin cannot be targeted any other
                    // way — and it carries no data, only the channel that
                    // every subsequent message travels over instead (see
                    // the module comment at the top of this file).
                    //
                    // Accepted, reviewed exception to typescript:S2819
                    // ("specify a target origin"): a real origin string
                    // cannot ever match an opaque origin, so '*' is not a
                    // weaker choice here, it is the only one that can ever
                    // deliver. Every other postMessage call this PR touches
                    // (on both sides of this boundary) was converted to a
                    // MessageChannel port specifically to eliminate this
                    // finding everywhere it could be eliminated; this one
                    // call is the handshake that hands out that channel in
                    // the first place, so it structurally cannot be one.
                    portRef.current?.close();
                    const channel = new MessageChannel();
                    portRef.current = channel.port1;
                    channel.port1.onmessage = (event) => { handleIframeMessage(event.data); };
                    iframeRef.current?.contentWindow?.postMessage( // NOSONAR typescript:S2819 — see comment above
                      { type: 'WARDHAH_CHANNEL_INIT' },
                      '*',
                      [channel.port2]
                    );

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
