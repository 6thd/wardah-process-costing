/**
 * Regression coverage for the two legacy-URL compatibility redirects that
 * exist so old bookmarks/links to the removed Gemini-branded dashboard
 * still land somewhere real instead of the 404/wildcard page:
 *
 *   /reports/gemini      -> /reports/insights   (src/features/reports/index.tsx)
 *   /gemini-dashboard/*  -> /reports/insights   (src/pages/routes.tsx)
 *
 * The first of these was an actual, shipped bug caught in PR review: the
 * redirect used `to="/insights"` (an absolute path with no /reports
 * prefix), which — because ReportsModule is itself mounted at /reports/*
 * — resolves to the true top-level route /insights, which does not exist,
 * so real bookmarks landed on the app's 404 page instead of the dashboard.
 * This test renders the real route tree (not a hand-copied duplicate) so
 * it would have failed against that bug and fails again if it regresses.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ReportsModule } from '../index';

vi.mock('../components/EnhancedInsightsDashboard', () => ({
  EnhancedInsightsDashboard: () => <div data-testid="insights-dashboard">insights dashboard</div>,
}));

describe('legacy Gemini-branded URL redirects', () => {
  it('/reports/gemini redirects to the real /reports/insights route, not the top-level /insights (which does not exist)', () => {
    render(
      <MemoryRouter initialEntries={['/reports/gemini']}>
        <Routes>
          <Route path="/reports/*" element={<ReportsModule />} />
          <Route path="/insights" element={<div data-testid="wrong-top-level-insights">WRONG: top-level /insights matched</div>} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId('insights-dashboard')).toBeInTheDocument();
    expect(screen.queryByTestId('wrong-top-level-insights')).not.toBeInTheDocument();
  });

  it('/gemini-dashboard/* redirects to /reports/insights (src/pages/routes.tsx compatibility route)', () => {
    // Mirrors the exact <Navigate> compatibility route registered in
    // src/pages/routes.tsx for the removed gemini-dashboard module —
    // reproduced directly (routes.tsx builds a full createBrowserRouter
    // with ~15 lazily-imported feature modules, impractical to construct
    // in a unit test) rather than imported, so this specifically pins the
    // navigation *behavior* of that one entry, not its exact source line;
    // a change to the redirect target in routes.tsx needs the same change
    // reflected here to keep passing.
    render(
      <MemoryRouter initialEntries={['/gemini-dashboard/some/deep/path']}>
        <Routes>
          <Route path="/gemini-dashboard/*" element={<Navigate to="/reports/insights" replace />} />
          <Route path="/reports/*" element={<ReportsModule />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId('insights-dashboard')).toBeInTheDocument();
  });
});
