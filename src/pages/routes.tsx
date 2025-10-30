import { createBrowserRouter, Link, Outlet, Navigate } from "react-router-dom";
import { MainLayout } from "@/components/layout/main-layout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute"; // ✅ حماية المسارات
import { LoginPage } from "@/pages/login"; // ✅ صفحة تسجيل الدخول

// Import all the modules
import { DashboardModule } from "@/features/dashboard";
import { GeneralLedgerModule } from "@/features/general-ledger";
import { InventoryModule } from "@/features/inventory";
import { ManufacturingModule } from "@/features/manufacturing";
import { ReportsModule } from "@/features/reports"
import { GeminiDashboardModule } from "@/features/gemini-dashboard";
import { SettingsModule } from "@/features/settings";
import { HRModule } from "@/features/hr";
import { PurchasingModule } from "@/features/purchasing";
import { SalesModule } from "@/features/sales";
import { DesignSystemDemo } from "@/components/design-system-demo"

// Minimal Not Found Page component
const NotFoundPage = () => (
    <div style={{ padding: '2rem', textAlign: 'center', fontFamily: 'sans-serif' }}>
        <h1>404 - Page Not Found</h1>
        <p>Sorry, the page you are looking for does not exist.</p>
        <Link to="/" style={{ color: '#007bff', textDecoration: 'none' }}>
            Go back to the homepage
        </Link>
    </div>
);

// A wrapper for MainLayout that provides the children prop via an Outlet.
const AppLayout = () => {
  return (
    <MainLayout>
      <Outlet />
    </MainLayout>
  );
};

export const appRouter = createBrowserRouter([
  // ===================================
  // مسار تسجيل الدخول (غير محمي)
  // ===================================
  {
    path: "/login",
    element: <LoginPage />
  },
  
  // ===================================
  // المسارات المحمية (تحتاج تسجيل دخول)
  // ===================================
  {
    path: "/",
    element: <ProtectedRoute />, // 🔒 حماية جميع المسارات
    errorElement: <NotFoundPage />,
    children: [
      {
        element: <AppLayout />,
        children: [
          {
            index: true, // Default route
            element: <Navigate to="/dashboard" replace />,
          },
          {
            path: "dashboard/*",
            element: <DashboardModule />,
          },
          {
            path: "general-ledger/*",
            element: <GeneralLedgerModule />,
          },
          {
            path: "accounting/journal-entries",
            lazy: async () => {
              const { default: JournalEntries } = await import("@/features/accounting/journal-entries");
              return { Component: JournalEntries };
            },
          },
          {
            path: "accounting/trial-balance",
            lazy: async () => {
              const { default: TrialBalance } = await import("@/features/accounting/trial-balance");
              return { Component: TrialBalance };
            },
          },
          {
            path: "inventory/*",
            element: <InventoryModule />,
          },
          {
            path: "manufacturing/*",
            element: <ManufacturingModule />,
          },
          {
            path: "purchasing/*",
            element: <PurchasingModule />,
          },
          {
            path: "sales/*",
            element: <SalesModule />,
          },
          {
            path: "hr/*",
            element: <HRModule />,
          },
          {
            path: "reports/*",
            element: <ReportsModule />,
          },
          {
            path: "gemini-dashboard/*",
            element: <GeminiDashboardModule />,
          },
          {
            path: "settings/*",
            element: <SettingsModule />,
          },
          {
            path: "design-system",
            element: <DesignSystemDemo />,
          },
        ],
      }
    ],
  },
  
  // ===================================
  // Catch-all للصفحات غير الموجودة
  // ===================================
  {
    path: "*",
    element: <NotFoundPage />
  }
], {
  future: {
    v7_startTransition: true
  } as any
});