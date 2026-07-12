import { Routes, Route, Navigate } from 'react-router-dom'
import { DashboardOverview } from './dashboard-overview.tsx'
import { DashboardAnalytics } from './dashboard-analytics.tsx'
import { DashboardPerformance } from './dashboard-performance.tsx'

export function DashboardModule() {
  return (
    <Routes>
      <Route path="/" element={<DashboardOverview />} />
      <Route path="/overview" element={<DashboardOverview />} />
      <Route path="/analytics" element={<DashboardAnalytics />} />
      <Route path="/performance" element={<DashboardPerformance />} />
      <Route path="*" element={<Navigate to="/dashboard/overview" replace />} />
    </Routes>
  )
}
