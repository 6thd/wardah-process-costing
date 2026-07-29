import type { ComponentType } from "react";
import { createBrowserRouter, Link, Outlet, Navigate } from "react-router-dom";
import { MainLayout } from "@/components/layout/main-layout";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute"; // ✅ حماية المسارات
import { ModuleGuard } from "@/components/auth/ModuleGuard"; // ✅ حماية الموديولات
import { LoginPage } from "@/pages/login"; // ✅ صفحة تسجيل الدخول
import { SignUpPage } from "@/pages/signup"; // ✅ صفحة التسجيل الجديد
import { MODULE_CODES } from "@/config/module-permissions"; // ✅ أكواد الموديولات

// P4-D1: كل الموديولات lazy — كانت كلها eager فتُشحن حزمة واحدة 3.9MB.
// نفس نمط accounting المثبت سابقاً؛ Login/SignUp/التخطيط تبقى فورية.

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

/** مسار كسول محمي بـ ModuleGuard — يوحّد النمط لكل الموديولات */
function guardedLazy(
  moduleCode: string,
  loader: () => Promise<Record<string, unknown>>,
  exportName: string
) {
  return async () => {
    const mod = await loader() as Record<string, ComponentType>;
    const Component = mod[exportName];
    return {
      Component: () => (
        <ModuleGuard moduleCode={moduleCode} action="view">
          <Component />
        </ModuleGuard>
      ),
    };
  };
}

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
            // الداشبورد متاح للجميع
            lazy: async () => {
              const { DashboardModule } = await import("@/features/dashboard");
              return { Component: DashboardModule };
            },
          },
          {
            path: "general-ledger/*",
            lazy: guardedLazy(
              MODULE_CODES.GENERAL_LEDGER,
              () => import("@/features/general-ledger"),
              "GeneralLedgerModule"
            ),
          },
          {
            path: "accounting/*",
            lazy: guardedLazy(
              MODULE_CODES.ACCOUNTING,
              () => import("@/features/accounting"),
              "AccountingModule"
            ),
          },
          {
            path: "inventory/*",
            lazy: guardedLazy(
              MODULE_CODES.INVENTORY,
              () => import("@/features/inventory"),
              "InventoryModule"
            ),
          },
          {
            path: "manufacturing/*",
            lazy: guardedLazy(
              MODULE_CODES.MANUFACTURING,
              () => import("@/features/manufacturing"),
              "ManufacturingModule"
            ),
          },
          {
            path: "purchasing/*",
            lazy: guardedLazy(
              MODULE_CODES.PURCHASING,
              () => import("@/features/purchasing/PurchasingModuleHotfix"),
              "PurchasingModuleHotfix"
            ),
          },
          {
            path: "sales/*",
            lazy: guardedLazy(
              MODULE_CODES.SALES,
              () => import("@/features/sales"),
              "SalesModule"
            ),
          },
          {
            path: "hr/*",
            lazy: guardedLazy(
              MODULE_CODES.HR,
              () => import("@/features/hr"),
              "HRModule"
            ),
          },
          {
            path: "reports/*",
            lazy: guardedLazy(
              MODULE_CODES.REPORTS,
              () => import("@/features/reports"),
              "ReportsModule"
            ),
          },
          {
            // توافق URLs: الوحدة اليتيمة gemini-dashboard حُذفت (كانت غلافاً
            // مكرّراً لمكوّن reports) — التوجيه يبقى للّوحة الحقيقية.
            path: "gemini-dashboard/*",
            element: <Navigate to="/reports/gemini" replace />,
          },
          {
            path: "settings/*",
            lazy: guardedLazy(
              MODULE_CODES.SETTINGS,
              () => import("@/features/settings"),
              "SettingsModule"
            ),
          },
          {
            path: "design-system",
            lazy: async () => {
              const { DesignSystemDemo } = await import("@/components/design-system-demo");
              return { Component: DesignSystemDemo };
            },
          },
          // ===================================
          // 🔴 Super Admin (داخل MainLayout)
          // ===================================
          {
            path: "super-admin/*",
            lazy: async () => {
              const { SuperAdminModule } = await import("@/pages/super-admin");
              return { Component: SuperAdminModule };
            },
          },
          // ===================================
          // 🟢 Org Admin (داخل MainLayout)
          // ===================================
          {
            path: "org-admin/*",
            lazy: async () => {
              const { OrgAdminModule } = await import("@/pages/org-admin/module");
              return { Component: OrgAdminModule };
            },
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