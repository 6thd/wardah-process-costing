import { createBrowserRouter, Link, Outlet, Navigate } from "react-router-dom";
import { MainLayout } from "@/components/layout/main-layout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute"; // ✅ حماية المسارات
import { ModuleGuard } from "@/components/auth/ModuleGuard"; // ✅ حماية الموديولات
import { LoginPage } from "@/pages/login"; // ✅ صفحة تسجيل الدخول
import { SignUpPage } from "@/pages/signup"; // ✅ صفحة التسجيل الجديد
import { SuperAdminModule } from "@/pages/super-admin"; // ✅ لوحة Super Admin
import { OrgAdminModule } from "@/pages/org-admin/module"; // ✅ لوحة Org Admin
import { MODULE_CODES } from "@/config/module-permissions"; // ✅ أكواد الموديولات

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
  // مسارات المصادقة (غير محمية)
  // ===================================
  {
    path: "/login",
    element: <LoginPage />
  },
  {
    path: "/signup",
    element: <SignUpPage />
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
            element: <DashboardModule />, // الداشبورد متاح للجميع
          },
          {
            path: "general-ledger/*",
            element: (
              <ModuleGuard moduleCode={MODULE_CODES.GENERAL_LEDGER} action="view">
                <GeneralLedgerModule />
              </ModuleGuard>
            ),
          },
          {
            path: "accounting/*",
            lazy: async () => {
              const { AccountingModule } = await import("@/features/accounting");
              return { 
                Component: () => (
                  <ModuleGuard moduleCode={MODULE_CODES.ACCOUNTING} action="view">
                    <AccountingModule />
                  </ModuleGuard>
                )
              };
            },
          },
          {
            path: "inventory/*",
            element: (
              <ModuleGuard moduleCode={MODULE_CODES.INVENTORY} action="view">
                <InventoryModule />
              </ModuleGuard>
            ),
          },
          {
            path: "manufacturing/*",
            element: (
              <ModuleGuard moduleCode={MODULE_CODES.MANUFACTURING} action="view">
                <ManufacturingModule />
              </ModuleGuard>
            ),
          },
          {
            path: "purchasing/*",
            element: (
              <ModuleGuard moduleCode={MODULE_CODES.PURCHASING} action="view">
                <PurchasingModule />
              </ModuleGuard>
            ),
          },
          {
            path: "sales/*",
            element: (
              <ModuleGuard moduleCode={MODULE_CODES.SALES} action="view">
                <SalesModule />
              </ModuleGuard>
            ),
          },
          {
            path: "hr/*",
            element: (
              <ModuleGuard moduleCode={MODULE_CODES.HR} action="view">
                <HRModule />
              </ModuleGuard>
            ),
          },
          {
            path: "reports/*",
            element: (
              <ModuleGuard moduleCode={MODULE_CODES.REPORTS} action="view">
                <ReportsModule />
              </ModuleGuard>
            ),
          },
          {
            path: "gemini-dashboard/*",
            element: (
              <ModuleGuard moduleCode={MODULE_CODES.REPORTS} action="view">
                <GeminiDashboardModule />
              </ModuleGuard>
            ),
          },
          {
            path: "settings/*",
            element: (
              <ModuleGuard moduleCode={MODULE_CODES.SETTINGS} action="view">
                <SettingsModule />
              </ModuleGuard>
            ),
          },
          {
            path: "design-system",
            element: <DesignSystemDemo />,
          },
          // ===================================
          // 🔴 Super Admin (داخل MainLayout)
          // ===================================
          {
            path: "super-admin/*",
            element: <SuperAdminModule />,
          },
          // ===================================
          // 🟢 Org Admin (داخل MainLayout)
          // ===================================
          {
            path: "org-admin/*",
            element: <OrgAdminModule />,
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