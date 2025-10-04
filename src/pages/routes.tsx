import { createBrowserRouter, Link, Outlet, Navigate } from "react-router-dom";
import { MainLayout } from "@/components/layout/main-layout";

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
  {
    path: "/",
    element: <AppLayout />,
    errorElement: <NotFoundPage />,
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
        path: "gemini-dashboard/*", // Added Gemini Dashboard route
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
  },
  {
    path: "*",
    element: <NotFoundPage /> // Catch-all for any other route
  }
], {
  future: {
    v7_startTransition: true
  } as any
});