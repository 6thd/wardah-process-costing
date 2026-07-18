import { Suspense } from 'react';
import { RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { Toaster } from '@/components/ui/sonner';
import { ThemeProvider } from '@/components/theme-provider';
import { WardahThemeProvider } from '@/components/wardah-theme-provider';
import { ErrorBoundary } from '@/components/error-boundary';
import { OrganizationLocaleProvider } from '@/components/organization-locale-provider';
import { AuthProvider } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { appRouter } from '@/pages/routes';

import '@/styles/wardah-ui-core.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
});

let lastAuthUserId: string | null | undefined;
supabase.auth?.onAuthStateChange?.((_event, session) => {
  const uid = session?.user?.id ?? null;
  if (lastAuthUserId !== undefined && lastAuthUserId !== uid) {
    queryClient.clear();
  }
  lastAuthUserId = uid;
});

function AppLoadingFallback() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center space-y-3">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary mx-auto" />
        <p className="text-muted-foreground text-sm">Loading…</p>
      </div>
    </div>
  );
}

function App() {
  return (
    <Suspense fallback={<AppLoadingFallback />}>
      <ErrorBoundary>
        <AuthProvider>
          <OrganizationLocaleProvider>
            <QueryClientProvider client={queryClient}>
              <ThemeProvider defaultTheme="system" storageKey="vite-ui-theme">
                <WardahThemeProvider>
                  <RouterProvider
                    router={appRouter}
                    future={{ v7_startTransition: true } as { v7_startTransition: boolean }}
                  />
                  <Toaster />
                  {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
                </WardahThemeProvider>
              </ThemeProvider>
            </QueryClientProvider>
          </OrganizationLocaleProvider>
        </AuthProvider>
      </ErrorBoundary>
    </Suspense>
  );
}

export default App;
