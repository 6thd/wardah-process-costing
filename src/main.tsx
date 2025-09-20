import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'

import App from './App'
import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { ErrorBoundary } from '@/components/error-boundary'
import { createOptimizedQueryClient } from '@/lib/persistentCache'

import './globals.css'
import './i18n'

console.log('🔧 Starting application bootstrap...')

// Create an optimized client
const queryClient = createOptimizedQueryClient()

console.log('✅ Query client created')

const rootElement = document.getElementById('root')
console.log('🔍 Root element:', rootElement)

if (rootElement) {
  console.log('🔧 Creating React root...')
  createRoot(rootElement).render(
    <StrictMode>
      <ErrorBoundary>
        <BrowserRouter>
          <QueryClientProvider client={queryClient}>
            <ThemeProvider defaultTheme="system" storageKey="wardah-erp-theme">
              <App />
              <Toaster 
                position="top-center"
                dir="rtl"
                toastOptions={{
                  style: {
                    fontFamily: 'Cairo, sans-serif',
                  },
                }}
              />
            </ThemeProvider>
            <ReactQueryDevtools initialIsOpen={false} />
          </QueryClientProvider>
        </BrowserRouter>
      </ErrorBoundary>
    </StrictMode>,
  )
  console.log('✅ React root created and app rendered')
} else {
  console.error('❌ Root element not found!')
}