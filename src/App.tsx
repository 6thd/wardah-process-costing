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

function App() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ErrorBoundary>
        <AuthProvider>
          <QueryClientProvider client={queryClient}>
            <ThemeProvider defaultTheme="system" storageKey="vite-ui-theme">
              <WardahThemeProvider>
                {/* Opting into React Router v7 future behavior early */}
                <RouterProvider 
                  router={appRouter} 
                  future={{ v7_startTransition: true } as any}
                />
                <Toaster />
                <ReactQueryDevtools initialIsOpen={false} />
              </WardahThemeProvider>
            </ThemeProvider>
          </QueryClientProvider>
        </AuthProvider>
      </ErrorBoundary>
    </Suspense>
  );
}

export default App;