import { Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { MainLayout } from '@/components/layout/main-layout'
import { AuthLayout } from '@/components/layout/auth-layout'
import { LoadingScreen } from '@/components/loading-screen'

// Feature imports
import { ManufacturingModule } from '@/features/manufacturing'
import { InventoryModule } from '@/features/inventory'
import { PurchasingModule } from '@/features/purchasing'
import { SalesModule } from '@/features/sales'
import { ReportsModule } from '@/features/reports'
import { SettingsModule } from '@/features/settings'
import { DashboardModule } from '@/features/dashboard'

// Auth imports
import { LoginPage } from '@/features/auth/login'

// Store imports
import { useAuthStore } from '@/store/auth-store'
import { useUIStore } from '@/store/ui-store'

function App() {
  const { i18n } = useTranslation()
  const { user, isLoading, checkAuth } = useAuthStore()
  const { initializeApp } = useUIStore()

  useEffect(() => {
    // Initialize the application
    const init = async () => {
      await checkAuth()
      initializeApp()
    }
    
    init()
  }, [checkAuth, initializeApp])

  useEffect(() => {
    // Set document direction based on language
    document.documentElement.dir = i18n.language === 'ar' ? 'rtl' : 'ltr'
    document.documentElement.lang = i18n.language
  }, [i18n.language])

  if (isLoading) {
    return <LoadingScreen />
  }

  // If user is not authenticated, show auth layout
  if (!user) {
    return (
      <AuthLayout>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </AuthLayout>
    )
  }

  // Main application routes
  return (
    <MainLayout>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard/*" element={<DashboardModule />} />
        <Route path="/manufacturing/*" element={<ManufacturingModule />} />
        <Route path="/inventory/*" element={<InventoryModule />} />
        <Route path="/purchasing/*" element={<PurchasingModule />} />
        <Route path="/sales/*" element={<SalesModule />} />
        <Route path="/reports/*" element={<ReportsModule />} />
        <Route path="/settings/*" element={<SettingsModule />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </MainLayout>
  )
}

export default App