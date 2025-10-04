import { Suspense } from 'react';
import { RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { Toaster } from '@/components/ui/sonner';
import { ThemeProvider } from '@/components/theme-provider';
import { WardahThemeProvider } from '@/components/wardah-theme-provider';
import { ErrorBoundary } from '@/components/error-boundary';
import { appRouter } from '@/pages/routes'; // Correctly import the router

// Import the core CSS styles
import '@/styles/wardah-ui-core.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1, // Retry failed queries once
      staleTime: 5 * 60 * 1000, // 5 minutes
    },
  },
});

function App() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ErrorBoundary>
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
      </ErrorBoundary>
    </Suspense>
  );
}

export default App;