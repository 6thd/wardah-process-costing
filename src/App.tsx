// src/App.tsx
import React, { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { loadConfig } from '@/lib/config';
import { useAuthStore } from '@/store/auth-store';
import { useUIStore } from '@/store/ui-store';

import { MainLayout } from '@/components/layout/main-layout';
import { AuthLayout } from '@/components/layout/auth-layout';
import { LoadingScreen } from '@/components/loading-screen';

import LoginPage from '@/features/auth/login';
import { DashboardModule } from '@/features/dashboard';
import { ManufacturingModule } from '@/features/manufacturing';
import { InventoryModule } from '@/features/inventory';
import { PurchasingModule } from '@/features/purchasing';
import { SalesModule } from '@/features/sales';
import { ReportsModule } from '@/features/reports';
import { SettingsModule } from '@/features/settings';
import { GeneralLedgerModule } from '@/features/general-ledger';
import { TestGLAccounts } from '@/TestGLAccounts'; // Add this import
import { Debug404 } from '@/debug-404'; // Add this import
import { TestDatabaseConnection } from '@/TestDatabaseConnection'; // Add this import
import { CheckDatabaseSetup } from '@/CheckDatabaseSetup'; // Add this import
import { InitializeDatabase } from '@/InitializeDatabase'; // Add this import

const App: React.FC = () => {
  const location = useLocation();
  const { i18n } = useTranslation();
  const { isLoading, isAuthenticated, checkAuth } = useAuthStore();
  const { initializeApp, isInitialized } = useUIStore();

  console.log('🔄 App component rendered with state:', { isLoading, isAuthenticated, isInitialized });
  console.log('📍 Current location:', location.pathname);

  // Initial app bootstrap
  useEffect(() => {
    console.log('🔧 App useEffect triggered for initialization');
    const init = async () => {
      try {
        console.log('🔧 Starting application initialization...');
        console.log('Loading config...');
        const config = await loadConfig();
        console.log('✅ Configuration loaded:', config);
        console.log('Checking auth...');
        await checkAuth();
        console.log('✅ Authentication checked');
        console.log('Initializing app...');
        initializeApp();
        console.log('✅ App initialized');
      } catch (error) {
        console.error('❌ Application initialization failed:', error);
        console.error('Error details:', {
          message: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : 'No stack trace'
        });
      }
    };
    init();
  }, [checkAuth, initializeApp]);

  // Handle language direction
  useEffect(() => {
    document.documentElement.dir = i18n.language === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = i18n.language;
    console.log('🌐 Language changed to:', i18n.language);
  }, [i18n.language]);

  // Log state changes for debugging
  useEffect(() => {
    console.log('🔄 App state updated:', { isLoading, isAuthenticated, isInitialized });
  }, [isLoading, isAuthenticated, isInitialized]);

  if (isLoading) {
    console.log('⏳ App is loading...');
    return <LoadingScreen />;
  }

  if (!isAuthenticated) {
    console.log('🔒 User not authenticated, showing login');
    return (
      <AuthLayout>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </AuthLayout>
    );
  }

  console.log('🔓 User authenticated, showing main app');
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
        <Route path="/general-ledger/*" element={<GeneralLedgerModule />} />
        <Route path="/test-gl" element={<TestGLAccounts />} /> {/* Add this route */}
        <Route path="/test-db" element={<TestDatabaseConnection />} /> {/* Add this route */}
        <Route path="/check-setup" element={<CheckDatabaseSetup />} /> {/* Add this route */}
        <Route path="/debug-404" element={<Debug404 />} /> {/* Add this route */}
        <Route path="/initialize-db" element={<InitializeDatabase />} /> {/* Add this route */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </MainLayout>
  );
};

export default App;