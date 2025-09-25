
import { createBrowserRouter, Link, Outlet } from "react-router-dom";
import { MainLayout } from "@/components/layout/main-layout";
import { GeneralLedgerModule } from "@/features/general-ledger";

// Minimal Not Found Page component to resolve the broken import.
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
        path: "general-ledger/*",
        element: <GeneralLedgerModule />,
      },
      {
        index: true,
        element: <GeneralLedgerModule /> // Default route loads the GL module
      }
    ],
  },
  {
    path: "*",
    element: <NotFoundPage /> // Catch-all for any other route
  }
], {
  future: {
    v7_startTransition: true,
  },
});
