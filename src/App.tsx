import { Suspense } from 'react';
import { RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { Toaster } from '@/components/ui/sonner';
import { ThemeProvider } from '@/components/theme-provider';
import { WardahThemeProvider } from '@/components/wardah-theme-provider';
import { ErrorBoundary } from '@/components/error-boundary';
import { AuthProvider } from '@/contexts/AuthContext'; // ✅ Auth Context الجديد
import { appRouter } from '@/pages/routes'; // Correctly import the router

// Import the core CSS styles
import '@/styles/wardah-ui-core.css';

// تكوين محسن لـ React Query
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1, // Retry failed queries once
      staleTime: 5 * 60 * 1000, // 5 دقائق - تقليل الطلبات المتكررة
      gcTime: 10 * 60 * 1000, // 10 دقائق
      refetchOnWindowFocus: false, // عدم إعادة التحميل عند العودة للنافذة
      refetchOnReconnect: false, // عدم إعادة التحميل عند إعادة الاتصال
    },
  },
});

/** P4-D1: هيكل تحميل يطابق تخطيط التطبيق بدل نص Loading... العاري */
function AppLoadingFallback() {
  return (
    <div dir="rtl" className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center space-y-3">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary mx-auto" />
        <p className="text-muted-foreground text-sm">جارٍ تحميل الوحدة…</p>
      </div>
    </div>
  );
}

function App() {
  return (
    <Suspense fallback={<AppLoadingFallback />}>
      <ErrorBoundary>
        <AuthProvider>
          <QueryClientProvider client={queryClient}>
            <ThemeProvider defaultTheme="system" storageKey="vite-ui-theme">
              <WardahThemeProvider>
                {/* Opting into React Router v7 future behavior early */}
                <RouterProvider
                  router={appRouter}
                  future={{ v7_startTransition: true } as { v7_startTransition: boolean }}
                />
                <Toaster />
                {/* P4-C4: أدوات التطوير لا تُشحن للإنتاج */}
                {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
              </WardahThemeProvider>
            </ThemeProvider>
          </QueryClientProvider>
        </AuthProvider>
      </ErrorBoundary>
    </Suspense>
  );
}

export default App;